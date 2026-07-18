import type { IncomingMessage } from "node:http";
import WebSocket, { type ClientOptions, type RawData } from "ws";

interface RealtimeEnvelopeBase {
  v: 1;
  eventId: string;
  publishedAt: number | string;
}

export type RealtimeEnvelope = RealtimeEnvelopeBase &
  (
    | {
        event: "friendRequest";
        payload: { invalidate: "friendRequests"; senderId?: string };
      }
    | {
        event: "friendGameSession";
        payload: { objectId: string; shop: string; friendId: string };
      }
    | {
        event: "friendPresence";
        payload: { friendId: string; isOnline: boolean; version: number };
      }
    | {
        event: "notification";
        payload: { invalidate: "notifications" };
      }
  );

export interface RealtimeToken {
  token: string;
  url: string;
  expiresIn?: number;
}

export interface RealtimeSocket {
  readyState: number;
  on(event: "open", listener: () => void): this;
  on(event: "message", listener: (data: RawData) => void): this;
  on(event: "ping" | "pong", listener: () => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (code: number, reason: Buffer) => void): this;
  on(
    event: "unexpected-response",
    listener: (request: unknown, response: IncomingMessage) => void
  ): this;
  ping(): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

interface RealtimeClientOptions {
  fallbackUrl?: string;
  mintToken: (signal: AbortSignal) => Promise<RealtimeToken>;
  onEvent: (
    envelope: RealtimeEnvelope,
    signal: AbortSignal
  ) => void | Promise<void>;
  onReconnect: (signal: AbortSignal) => void;
  onEventFailure?: (signal: AbortSignal) => void;
  createSocket?: (url: string, options: ClientOptions) => RealtimeSocket;
  random?: () => number;
  now?: () => number;
  heartbeatIntervalMs?: number;
  shouldStop?: (error: unknown) => boolean;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
  };
}

interface AttemptResult {
  connected: boolean;
  retryAfterMs: number | null;
  serverDrain: boolean;
}

const TERMINAL_ATTEMPT = Symbol("terminal-attempt");

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const DROPPED_CONNECTION_SPREAD_MS = 30_000;
const RESUME_RECONNECT_SPREAD_MS = 5_000;
const MIN_RANDOMIZED_DELAY_MS = 250;
const TOKEN_EXPIRY_SKEW_MS = 30_000;
const MAX_SEEN_EVENT_IDS = 1_000;
const SERVICE_RESTART_CLOSE = 1_012;
const TRY_AGAIN_LATER_CLOSE = 1_013;

export const fullJitterDelay = (
  attempt: number,
  random: () => number = Math.random
) => {
  const cap = Math.min(
    INITIAL_RECONNECT_DELAY_MS * 2 ** Math.max(0, attempt - 1),
    MAX_RECONNECT_DELAY_MS
  );

  return Math.floor(random() * cap);
};

export const parseRetryAfter = (
  value: string | string[] | undefined,
  now = Date.now()
) => {
  const retryAfter = Array.isArray(value) ? value[0] : value;
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
};

export const parseRealtimeEnvelope = (
  data: RawData | string
): RealtimeEnvelope | null => {
  try {
    const value = JSON.parse(
      typeof data === "string" ? data : data.toString()
    ) as unknown;

    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;

    const envelope = value as Record<string, unknown>;
    const validPublishedAt =
      (typeof envelope.publishedAt === "number" &&
        Number.isFinite(envelope.publishedAt)) ||
      (typeof envelope.publishedAt === "string" &&
        envelope.publishedAt.length > 0 &&
        !Number.isNaN(Date.parse(envelope.publishedAt)));

    if (
      envelope.v !== 1 ||
      typeof envelope.eventId !== "string" ||
      envelope.eventId.length === 0 ||
      !envelope.payload ||
      typeof envelope.payload !== "object" ||
      Array.isArray(envelope.payload) ||
      !validPublishedAt
    ) {
      return null;
    }

    const payload = envelope.payload as Record<string, unknown>;
    switch (envelope.event) {
      case "friendRequest":
        if (
          payload.invalidate !== "friendRequests" ||
          (payload.senderId !== undefined &&
            typeof payload.senderId !== "string")
        ) {
          return null;
        }
        break;
      case "friendGameSession":
        if (
          typeof payload.objectId !== "string" ||
          typeof payload.shop !== "string" ||
          typeof payload.friendId !== "string"
        ) {
          return null;
        }
        break;
      case "friendPresence":
        if (
          typeof payload.friendId !== "string" ||
          typeof payload.isOnline !== "boolean" ||
          typeof payload.version !== "number" ||
          !Number.isInteger(payload.version) ||
          payload.version <= 0
        ) {
          return null;
        }
        break;
      case "notification":
        if (payload.invalidate !== "notifications") return null;
        break;
      default:
        return null;
    }

    return envelope as unknown as RealtimeEnvelope;
  } catch {
    return null;
  }
};

const retryHintFromCloseReason = (reason: Buffer) => {
  try {
    const hint = JSON.parse(reason.toString()) as {
      retryAfterMs?: unknown;
      retryAfterSeconds?: unknown;
    };
    if (typeof hint.retryAfterMs === "number" && hint.retryAfterMs >= 0) {
      return hint.retryAfterMs;
    }
    if (
      typeof hint.retryAfterSeconds === "number" &&
      hint.retryAfterSeconds >= 0
    ) {
      return hint.retryAfterSeconds * 1_000;
    }
  } catch {
    return null;
  }

  return null;
};

export class RealtimeWebSocketClient {
  private epoch = 0;
  private masterAbort: AbortController | null = null;
  private socket: RealtimeSocket | null = null;
  private currentAttemptAbort: AbortController | null = null;
  private sleepAbort: AbortController | null = null;
  private forceReconnectRequested = false;
  private cachedToken: {
    value: string;
    url: string;
    expiresAt: number;
  } | null = null;
  private readonly seenEventIds = new Set<string>();
  private readonly pendingEventIds = new Set<string>();
  private readonly highestPresenceVersion = new Map<string, number>();
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly createSocket: NonNullable<
    RealtimeClientOptions["createSocket"]
  >;
  private readonly heartbeatIntervalMs: number;
  private readonly log: NonNullable<RealtimeClientOptions["log"]>;

  constructor(private readonly options: RealtimeClientOptions) {
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.createSocket =
      options.createSocket ??
      ((url, socketOptions) => new WebSocket(url, socketOptions));
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    this.log = options.log ?? console;
  }

  connect() {
    this.stop(false);
    this.masterAbort = new AbortController();
    void this.runLoop(this.epoch, this.masterAbort.signal);
  }

  close() {
    this.stop(true);
  }

  reconnectNow() {
    if (!this.masterAbort) return;
    this.forceReconnectRequested = true;
    this.currentAttemptAbort?.abort();
    this.sleepAbort?.abort();
  }

  private stop(clearSession: boolean) {
    this.epoch++;
    this.masterAbort?.abort();
    this.masterAbort = null;
    this.forceReconnectRequested = false;
    this.currentAttemptAbort?.abort();
    this.currentAttemptAbort = null;
    this.socket?.terminate();
    this.socket = null;
    this.sleepAbort?.abort();
    this.sleepAbort = null;
    this.pendingEventIds.clear();

    if (clearSession) {
      this.cachedToken = null;
      this.seenEventIds.clear();
      this.highestPresenceVersion.clear();
    }
  }

  private async runLoop(epoch: number, signal: AbortSignal) {
    let attempt = 0;
    let hasConnectedBefore = false;

    while (epoch === this.epoch && !signal.aborted) {
      if (this.forceReconnectRequested) {
        this.forceReconnectRequested = false;
        await this.wait(
          MIN_RANDOMIZED_DELAY_MS +
            Math.floor(this.random() * RESUME_RECONNECT_SPREAD_MS),
          signal
        );
        if (signal.aborted) return;
      }

      const attemptAbort = new AbortController();
      const abortAttempt = () => attemptAbort.abort();
      signal.addEventListener("abort", abortAttempt, { once: true });
      this.currentAttemptAbort = attemptAbort;

      const result = await this.connectOnce(epoch, attemptAbort.signal, () => {
        attempt = 0;
        if (hasConnectedBefore) this.options.onReconnect(attemptAbort.signal);
        hasConnectedBefore = true;
      })
        .catch((error: unknown) => {
          if (attemptAbort.signal.aborted) {
            return {
              connected: false,
              retryAfterMs: null,
              serverDrain: false,
            };
          }
          if (this.options.shouldStop?.(error)) return TERMINAL_ATTEMPT;
          if (!signal.aborted)
            this.log.error("Realtime WebSocket error", error);
          return {
            connected: false,
            retryAfterMs: null,
            serverDrain: false,
          };
        })
        .finally(() => {
          signal.removeEventListener("abort", abortAttempt);
          attemptAbort.abort();
          if (this.currentAttemptAbort === attemptAbort) {
            this.currentAttemptAbort = null;
          }
        });

      if (result === TERMINAL_ATTEMPT) {
        if (epoch === this.epoch) this.masterAbort = null;
        return;
      }

      if (epoch !== this.epoch || signal.aborted) return;

      const resumeRequested = this.forceReconnectRequested;
      this.forceReconnectRequested = false;
      attempt++;

      let delay: number;
      if (resumeRequested) {
        delay =
          MIN_RANDOMIZED_DELAY_MS +
          Math.floor(this.random() * RESUME_RECONNECT_SPREAD_MS);
      } else if (result.retryAfterMs !== null) {
        delay =
          result.retryAfterMs +
          MIN_RANDOMIZED_DELAY_MS +
          Math.floor(this.random() * INITIAL_RECONNECT_DELAY_MS);
      } else if (result.connected || result.serverDrain) {
        delay =
          INITIAL_RECONNECT_DELAY_MS +
          Math.floor(this.random() * DROPPED_CONNECTION_SPREAD_MS);
      } else {
        delay = fullJitterDelay(attempt, this.random);
      }

      this.log.info(
        `Realtime WebSocket reconnecting in ${Math.round(delay / 1_000)}s`
      );
      await this.wait(delay, signal);
    }
  }

  private async getToken(epoch: number, signal: AbortSignal) {
    if (
      this.cachedToken &&
      this.cachedToken.expiresAt - TOKEN_EXPIRY_SKEW_MS > this.now()
    ) {
      return this.cachedToken;
    }

    const { token, url, expiresIn } = await this.abortable(
      this.options.mintToken(signal),
      signal
    );
    if (signal.aborted || epoch !== this.epoch) return null;

    const realtimeUrl = url || this.options.fallbackUrl;
    if (!realtimeUrl) throw new Error("Realtime token response omitted URL");
    const expiresAt =
      this.readJwtExpiration(token) ??
      (typeof expiresIn === "number" && expiresIn > 0
        ? this.now() + expiresIn * 1_000
        : this.now());

    this.cachedToken = { value: token, url: realtimeUrl, expiresAt };
    return this.cachedToken;
  }

  private readJwtExpiration(token: string) {
    try {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString()
      ) as { exp?: unknown };
      return typeof payload.exp === "number" ? payload.exp * 1_000 : null;
    } catch {
      return null;
    }
  }

  private abortable<T>(promise: Promise<T>, signal: AbortSignal) {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Realtime attempt aborted", "AbortError"));
        return;
      }

      const onAbort = () =>
        reject(new DOMException("Realtime attempt aborted", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(resolve, reject).finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
    });
  }

  private async connectOnce(
    epoch: number,
    signal: AbortSignal,
    onOpen: () => void
  ): Promise<AttemptResult> {
    const credentials = await this.getToken(epoch, signal);
    if (!credentials || signal.aborted || epoch !== this.epoch) {
      return { connected: false, retryAfterMs: null, serverDrain: false };
    }

    return new Promise((resolve) => {
      let connected = false;
      let settled = false;
      let retryAfterMs: number | null = null;
      let heartbeat: NodeJS.Timeout | null = null;
      let alive = true;
      const socket = this.createSocket(credentials.url, {
        headers: { Authorization: `Bearer ${credentials.value}` },
        handshakeTimeout: 15_000,
      });
      this.socket = socket;
      const isActive = () =>
        !signal.aborted && epoch === this.epoch && this.socket === socket;

      const finish = (serverDrain = false) => {
        if (settled) return;
        settled = true;
        if (heartbeat) clearInterval(heartbeat);
        signal.removeEventListener("abort", abort);
        if (this.socket === socket) this.socket = null;
        resolve({ connected, retryAfterMs, serverDrain });
      };
      const abort = () => {
        socket.terminate();
        finish();
      };

      signal.addEventListener("abort", abort, { once: true });
      socket.on("open", () => {
        if (!isActive()) return socket.terminate();
        connected = true;
        alive = true;
        this.log.info("Realtime WebSocket connected");
        onOpen();

        // WebSocket control frames avoid application messages that wake a
        // hibernating Durable Object solely to service launcher heartbeats.
        heartbeat = setInterval(() => {
          if (!isActive()) return;
          if (!alive) {
            socket.terminate();
            return;
          }
          alive = false;
          socket.ping();
        }, this.heartbeatIntervalMs);
      });
      socket.on("ping", () => {
        if (!isActive()) return;
        alive = true;
      });
      socket.on("pong", () => {
        if (!isActive()) return;
        alive = true;
      });
      socket.on("message", (data) => {
        if (!isActive()) return;
        alive = true;
        const envelope = parseRealtimeEnvelope(data);
        if (!envelope) {
          this.log.warn("Ignored malformed realtime WebSocket message");
          return;
        }
        if (envelope.event === "friendPresence") {
          const highestVersion =
            this.highestPresenceVersion.get(envelope.payload.friendId) ?? 0;
          if (envelope.payload.version <= highestVersion) return;
          this.highestPresenceVersion.set(
            envelope.payload.friendId,
            envelope.payload.version
          );
        }
        if (
          this.seenEventIds.has(envelope.eventId) ||
          this.pendingEventIds.has(envelope.eventId)
        )
          return;

        this.pendingEventIds.add(envelope.eventId);
        void Promise.resolve()
          .then(() => this.options.onEvent(envelope, signal))
          .then(() => {
            if (epoch !== this.epoch || !this.masterAbort) return;
            this.seenEventIds.add(envelope.eventId);
            if (this.seenEventIds.size > MAX_SEEN_EVENT_IDS) {
              const oldest = this.seenEventIds.values().next().value;
              if (oldest) this.seenEventIds.delete(oldest);
            }
          })
          .catch((error: unknown) => {
            if (!isActive()) return;
            this.log.error(
              `Failed to handle realtime ${envelope.event} event`,
              error
            );
            try {
              this.options.onEventFailure?.(signal);
            } catch (resyncError) {
              this.log.error("Failed to start realtime resync", resyncError);
            }
          })
          .finally(() => {
            if (epoch === this.epoch) {
              this.pendingEventIds.delete(envelope.eventId);
            }
          });
      });
      socket.on("unexpected-response", (_request, response) => {
        if (!isActive()) {
          response.resume();
          return;
        }
        retryAfterMs = parseRetryAfter(
          response.headers["retry-after"],
          this.now()
        );
        if (response.statusCode === 401 || response.statusCode === 403) {
          this.cachedToken = null;
        }
        response.resume();
        socket.terminate();
        finish(response.statusCode === 503);
      });
      socket.on("error", (error) => {
        if (isActive()) this.log.error("Realtime socket error", error);
      });
      socket.on("close", (code, reason) => {
        if (epoch !== this.epoch) return finish();
        retryAfterMs ??= retryHintFromCloseReason(reason);
        finish(
          code === SERVICE_RESTART_CLOSE || code === TRY_AGAIN_LATER_CLOSE
        );
      });
    });
  }

  private sleep(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();

      const onAbort = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async wait(ms: number, signal: AbortSignal) {
    const sleepAbort = new AbortController();
    const abortSleep = () => sleepAbort.abort();
    signal.addEventListener("abort", abortSleep, { once: true });
    this.sleepAbort = sleepAbort;

    await (this.options.sleep?.(ms, sleepAbort.signal) ??
      this.sleep(ms, sleepAbort.signal));

    signal.removeEventListener("abort", abortSleep);
    if (this.sleepAbort === sleepAbort) this.sleepAbort = null;
  }
}
