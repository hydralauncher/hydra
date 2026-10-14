import { randomUUID } from "node:crypto";
import type { EpicErrorCode } from "../../../types/epic-integration.types";
import type { EpicManagedTarget } from "./legendary-managed-runtime";
import type { EpicSessionProvider } from "./session-provider";
import { EpicIntegrationError } from "./auth-protocol.js";
import {
  EPIC_PLAYTIME_MAX_PENDING_SEGMENTS,
  EPIC_PLAYTIME_AUTH_ATTEMPTS,
  EPIC_PLAYTIME_OBSERVATION_GAP_MS,
  EPIC_PLAYTIME_ORIGIN,
  EPIC_PLAYTIME_REPORT_INTERVAL_MS,
  EPIC_SOURCE_TIMEOUT_MS,
} from "./constants.js";

type Target = Pick<EpicManagedTarget, "auth" | "connection" | "artifactId">;
interface Segment {
  utc: number;
  monotonic: number;
  observed: number;
  cursor: number;
}
export interface EpicPlaytimeSession {
  readonly objectId: string;
  readonly target: Target;
  readonly controller: AbortController;
  segment: Segment | null;
  lastEnd: number;
  closed: boolean;
  pending: number;
  tail: Promise<void>;
}
interface Dependencies {
  session: Pick<EpicSessionProvider, "token">;
  current(target: Target): boolean;
  confirmed(objectId: string, target: Target): Promise<unknown>;
  error(objectId: string, code: EpicErrorCode): void;
  fetch?: typeof fetch;
  now?: () => number;
  monotonic?: () => number;
  timeout?: number;
}

/** Additive Epic writes have no verified idempotency: a submitted interval is never replayed. */
export class EpicPlaytimeReporter {
  private readonly machineId = randomUUID();
  private readonly sessions = new Set<EpicPlaytimeSession>();
  private readonly writes = new Set<Promise<void>>();
  private suspended = false;
  private draining = false;
  constructor(private readonly dependencies: Dependencies) {}

  begin(objectId: string, target: Target): EpicPlaytimeSession {
    const session: EpicPlaytimeSession = {
      objectId,
      target: {
        auth: { ...target.auth },
        connection: { ...target.connection },
        artifactId: target.artifactId,
      },
      controller: new AbortController(),
      segment: null,
      lastEnd: 0,
      closed: false,
      pending: 0,
      tail: Promise.resolve(),
    };
    this.sessions.add(session);
    this.observe(session);
    return session;
  }
  observe(session: EpicPlaytimeSession) {
    if (session.closed || this.draining) return;
    if (this.suspended || !this.dependencies.current(session.target)) {
      this.interrupt(session);
      return;
    }
    const monotonic = (
      this.dependencies.monotonic ?? performance.now.bind(performance)
    )();
    if (
      session.segment &&
      (monotonic < session.segment.observed ||
        monotonic - session.segment.observed > EPIC_PLAYTIME_OBSERVATION_GAP_MS)
    )
      this.interrupt(session);
    if (!session.segment) {
      const utc =
        Math.floor((this.dependencies.now ?? Date.now)() / 1000) * 1000;
      // A backwards wall-clock adjustment must not overlap already submitted UTC intervals.
      if (utc < session.lastEnd) return;
      session.segment = { utc, monotonic, observed: monotonic, cursor: 0 };
    } else session.segment.observed = monotonic;
    this.flush(session, true);
  }
  interrupt(session: EpicPlaytimeSession) {
    this.flush(session, false);
    session.segment = null;
  }
  interruptAll() {
    for (const session of this.sessions) this.interrupt(session);
  }
  suspend() {
    this.suspended = true;
    this.interruptAll();
  }
  resume() {
    this.suspended = false;
  }
  restoreAfterFailedShutdown() {
    this.draining = false;
  }
  finish(session: EpicPlaytimeSession) {
    if (session.closed) return;
    session.closed = true;
    this.interrupt(session);
    if (!session.pending) this.sessions.delete(session);
  }
  discard(session: EpicPlaytimeSession) {
    session.closed = true;
    session.segment = null;
    session.controller.abort();
    this.sessions.delete(session);
  }
  invalidate() {
    for (const session of this.sessions) this.discard(session);
  }
  async idle() {
    await Promise.all([...this.writes]);
  }
  async drain() {
    this.draining = true;
    for (const session of this.sessions) this.finish(session);
    const timeout = setTimeout(
      () => this.invalidate(),
      this.dependencies.timeout ?? EPIC_SOURCE_TIMEOUT_MS
    );
    try {
      await this.idle();
    } finally {
      clearTimeout(timeout);
      this.invalidate();
    }
  }
  private flush(session: EpicPlaytimeSession, fullOnly: boolean) {
    const segment = session.segment;
    if (!segment) return;
    const end = Math.floor((segment.observed - segment.monotonic) / 1000);
    const limit = EPIC_PLAYTIME_REPORT_INTERVAL_MS / 1000;
    while (end > segment.cursor) {
      const seconds = Math.min(limit, end - segment.cursor);
      if (fullOnly && seconds < limit) return;
      const startTime = segment.utc + segment.cursor * 1000;
      segment.cursor += seconds;
      const endTime = segment.utc + segment.cursor * 1000;
      session.lastEnd = endTime;
      if (session.pending >= EPIC_PLAYTIME_MAX_PENDING_SEGMENTS) {
        this.dependencies.error(session.objectId, "operation-in-progress");
        continue;
      }
      session.pending++;
      const write = session.tail
        .then(() => this.send(session, startTime, endTime))
        .finally(() => {
          session.pending--;
          this.writes.delete(write);
          if (session.closed && !session.pending) this.sessions.delete(session);
        });
      session.tail = write;
      this.writes.add(write);
    }
  }
  private assertCurrent(session: EpicPlaytimeSession, signal: AbortSignal) {
    if (signal.aborted) throw new EpicIntegrationError("operation-cancelled");
    if (!this.dependencies.current(session.target))
      throw new EpicIntegrationError("stale-connection");
  }
  private async send(session: EpicPlaytimeSession, start: number, end: number) {
    const timeout = new AbortController();
    const signal = AbortSignal.any([session.controller.signal, timeout.signal]);
    const timer = setTimeout(
      () => timeout.abort(),
      this.dependencies.timeout ?? EPIC_SOURCE_TIMEOUT_MS
    );
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new EpicIntegrationError("operation-cancelled"));
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      await Promise.race([this.put(session, start, end, signal), cancelled]);
      this.assertCurrent(session, signal);
      // Reconciliation errors cannot turn a confirmed additive write into a retry.
      void this.dependencies
        .confirmed(session.objectId, session.target)
        .catch(() => {
          this.dependencies.error(session.objectId, "merge-failed");
        });
    } catch (error) {
      if (!session.controller.signal.aborted)
        this.dependencies.error(
          session.objectId,
          timeout.signal.aborted
            ? "timeout"
            : error instanceof EpicIntegrationError
              ? error.code
              : "network"
        );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
  private async put(
    session: EpicPlaytimeSession,
    start: number,
    end: number,
    signal: AbortSignal
  ) {
    const { auth, connection, artifactId } = session.target;
    this.assertCurrent(session, signal);
    let token = await this.dependencies.session.token(auth, connection, signal);
    const payload = JSON.stringify({
      playtimeAddList: [
        {
          machineId: this.machineId,
          artifactId,
          startTime: new Date(start).toISOString(),
          endTime: new Date(end).toISOString(),
          startSegment: true,
          endSegment: true,
        },
      ],
    });
    for (let attempt = 0; attempt < EPIC_PLAYTIME_AUTH_ATTEMPTS; attempt++) {
      this.assertCurrent(session, signal);
      const response = await (this.dependencies.fetch ?? fetch)(
        `${EPIC_PLAYTIME_ORIGIN}/library/api/public/playtime/account/${connection.epicAccountId}/bulk`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: payload,
          redirect: "error",
          signal,
        }
      );
      await response.body?.cancel();
      if (response.ok) return;
      if (response.status === 401 && attempt === 0) {
        this.assertCurrent(session, signal);
        token = await this.dependencies.session.token(
          auth,
          connection,
          signal,
          true
        );
        continue;
      }
      throw new EpicIntegrationError(
        response.status === 401
          ? "session-expired"
          : response.status === 403
            ? "source-permission"
            : response.status === 429
              ? "rate-limit"
              : "api-unavailable"
      );
    }
  }
}
