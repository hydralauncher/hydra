import type { EpicConnectedConnection } from "../../../types/epic-integration.types";
import type { EpicAuthContext } from "./integration-core";
import type { EpicConnectionStore, EpicSessionBundle } from "./store";
import { EpicIntegrationError } from "./auth-protocol.js";
import { LegendarySyncRunner } from "./legendary-sync.js";
import { queueEpicOperation } from "./operation-queue.js";
import { withEpicTiming } from "./timing.js";

interface SharedEpicRefresh {
  controller: AbortController;
  operation: Promise<unknown>;
  consumers: Set<symbol>;
  settled: boolean;
}

export class EpicSessionProvider {
  private tail: Promise<unknown> = Promise.resolve();
  private refreshOperation?: (
    context: EpicAuthContext,
    connection: EpicConnectedConnection,
    bundle: EpicSessionBundle,
    signal: AbortSignal
  ) => Promise<EpicSessionBundle>;
  private readonly refreshes = new Map<string, SharedEpicRefresh>();
  constructor(
    private readonly store: EpicConnectionStore,
    private readonly userData: string,
    private readonly binary: () => Promise<string>,
    private readonly current: (
      context: EpicAuthContext,
      connection: EpicConnectedConnection
    ) => boolean
  ) {}
  setRefreshOperation(
    operation: NonNullable<EpicSessionProvider["refreshOperation"]>
  ) {
    this.refreshOperation = operation;
  }
  private waitForRefresh(refresh: SharedEpicRefresh, signal: AbortSignal) {
    const consumer = Symbol("epic-refresh-consumer");
    refresh.consumers.add(consumer);
    return new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: unknown) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", abort);
        refresh.consumers.delete(consumer);
        if (refresh.consumers.size === 0 && !refresh.settled)
          refresh.controller.abort();
        if (error) reject(error);
        else resolve();
      };
      const abort = () =>
        finish(new EpicIntegrationError("operation-cancelled"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      refresh.operation.then(() => finish(), finish);
    });
  }
  /** Metadata workers receive no refresh token and cannot rotate the session. */
  async accessSnapshot(
    context: EpicAuthContext,
    connection: EpicConnectedConnection,
    signal: AbortSignal,
    force = false
  ): Promise<Record<string, unknown>> {
    await this.token(context, connection, signal, force);
    const stored = await this.store.read(context);
    if (
      signal.aborted ||
      !this.current(context, connection) ||
      stored?.connection.connectionId !== connection.connectionId ||
      stored.connection.epicAccountId !== connection.epicAccountId ||
      !stored.bundle ||
      Date.parse(stored.bundle.user.expires_at as string) <= Date.now()
    )
      throw new EpicIntegrationError("operation-cancelled");
    const user = stored.bundle.user;
    return {
      access_token: user.access_token,
      account_id: user.account_id,
      displayName: user.displayName,
      expires_at: user.expires_at,
      token_type: user.token_type,
      ...(typeof user.country === "string" ? { country: user.country } : {}),
    };
  }
  serialize<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const { queued, result } = queueEpicOperation(this.tail, task, signal, {
      queue: "session",
    });
    this.tail = queued.catch(() => undefined);
    return result;
  }
  /** A managed install releases this lease once Legendary prepared its transfer. */
  async useBundle<T>(
    context: EpicAuthContext,
    connection: EpicConnectedConnection,
    signal: AbortSignal,
    task: (
      bundle: EpicSessionBundle,
      save: (rotated: EpicSessionBundle) => Promise<void>
    ) => Promise<T>
  ): Promise<T> {
    return this.serialize(async () => {
      if (signal.aborted || !this.current(context, connection))
        throw new EpicIntegrationError("operation-cancelled");
      const stored = await withEpicTiming("session.store.read", () =>
        this.store.read(context)
      );
      if (
        !stored?.bundle ||
        stored.connection.connectionId !== connection.connectionId ||
        stored.connection.epicAccountId !== connection.epicAccountId ||
        Date.parse(stored.bundle.user.refresh_expires_at as string) <=
          Date.now()
      )
        throw new EpicIntegrationError("session-expired");
      const source = stored.bundle;
      return withEpicTiming("session.bundle.task", () =>
        task(source, async (rotated) => {
          await withEpicTiming("session.store.refresh", () =>
            this.store.refreshSession(
              context,
              connection,
              rotated,
              () => this.current(context, connection),
              source
            )
          );
        })
      );
    }, signal);
  }
  /** Offline launch needs account identity, not refreshed Epic credentials. */
  async useLocalIdentity<T>(
    context: EpicAuthContext,
    connection: EpicConnectedConnection,
    signal: AbortSignal,
    task: (identity: { account_id: string; displayName: string }) => Promise<T>,
    isCurrent: () => boolean = () => this.current(context, connection)
  ): Promise<T> {
    return this.serialize(async () => {
      if (signal.aborted || !isCurrent())
        throw new EpicIntegrationError("operation-cancelled");
      const stored = await withEpicTiming("session.store.read", () =>
        this.store.read(context)
      );
      if (
        !stored ||
        stored.connection.connectionId !== connection.connectionId ||
        stored.connection.epicAccountId !== connection.epicAccountId
      )
        throw new EpicIntegrationError("stale-connection");
      if (signal.aborted || !isCurrent())
        throw new EpicIntegrationError("operation-cancelled");
      return withEpicTiming("session.identity.task", () =>
        task({
          account_id: connection.epicAccountId,
          displayName: connection.displayName,
        })
      );
    }, signal);
  }
  async use<T>(
    context: EpicAuthContext,
    connection: EpicConnectedConnection,
    signal: AbortSignal,
    task: (runner: LegendarySyncRunner) => Promise<T>
  ): Promise<T> {
    return this.serialize(async () => {
      if (signal.aborted || !this.current(context, connection))
        throw new EpicIntegrationError("operation-cancelled");
      const stored = await withEpicTiming("session.store.read", () =>
        this.store.read(context)
      );
      if (
        !stored?.bundle ||
        stored.connection.connectionId !== connection.connectionId ||
        stored.connection.epicAccountId !== connection.epicAccountId
      )
        throw new EpicIntegrationError("session-expired");
      if (
        Date.parse(stored.bundle.user.refresh_expires_at as string) <=
        Date.now()
      )
        throw new EpicIntegrationError("session-expired");
      const source = stored.bundle;
      const runner = await withEpicTiming("session.runner.create", async () =>
        LegendarySyncRunner.create(
          await withEpicTiming("session.binary.resolve", () => this.binary()),
          this.userData,
          connection.epicAccountId,
          source,
          signal,
          (bundle) =>
            withEpicTiming("session.store.refresh", () =>
              this.store
                .refreshSession(
                  context,
                  connection,
                  bundle,
                  () => this.current(context, connection),
                  source
                )
                .then(() => undefined)
            )
        )
      );
      try {
        return await withEpicTiming("session.runner.task", () => task(runner));
      } finally {
        await withEpicTiming("session.runner.cleanup", () => runner.cleanup());
      }
    }, signal);
  }
  async token(
    context: EpicAuthContext,
    connection: EpicConnectedConnection,
    signal: AbortSignal,
    force = false
  ): Promise<string> {
    if (signal.aborted) throw new EpicIntegrationError("operation-cancelled");
    const stored = await withEpicTiming("session.store.read", () =>
      this.store.read(context)
    );
    if (
      !stored?.bundle ||
      stored.connection.connectionId !== connection.connectionId ||
      stored.connection.epicAccountId !== connection.epicAccountId ||
      !this.current(context, connection)
    )
      throw new EpicIntegrationError("session-expired");
    if (
      force ||
      Date.parse(stored.bundle.user.expires_at as string) <= Date.now()
    ) {
      const key = JSON.stringify([
        context.environment,
        context.userId,
        context.generation,
        connection.connectionId,
        connection.epicAccountId,
      ]);
      let refresh = this.refreshes.get(key);
      if (!refresh || refresh.controller.signal.aborted) {
        const controller = new AbortController();
        const operation = this.refreshOperation;
        const pending = operation
          ? this.useBundle(
              context,
              connection,
              controller.signal,
              async (bundle, save) => {
                const rotated = await operation(
                  context,
                  connection,
                  bundle,
                  controller.signal
                );
                if (!this.current(context, connection))
                  throw new EpicIntegrationError("operation-cancelled");
                // A completed OAuth rotation must survive its last consumer
                // closing, or the next operation would reuse an invalid token.
                await save(rotated);
                if (controller.signal.aborted)
                  throw new EpicIntegrationError("operation-cancelled");
              }
            )
          : this.use(context, connection, controller.signal, (runner) =>
              runner.refresh(force)
            );
        refresh = {
          controller,
          operation: pending,
          consumers: new Set(),
          settled: false,
        };
        this.refreshes.set(key, refresh);
        const current = refresh;
        const settled = () => {
          current.settled = true;
          if (this.refreshes.get(key) === current) this.refreshes.delete(key);
        };
        void pending.then(settled, settled);
      }
      await this.waitForRefresh(refresh, signal);
    }
    const refreshed = await withEpicTiming("session.store.read", () =>
      this.store.read(context)
    );
    if (signal.aborted) throw new EpicIntegrationError("operation-cancelled");
    if (
      !this.current(context, connection) ||
      refreshed?.connection.connectionId !== connection.connectionId ||
      refreshed.connection.epicAccountId !== connection.epicAccountId ||
      !refreshed.bundle ||
      Date.parse(refreshed.bundle.user.expires_at as string) <= Date.now()
    )
      throw new EpicIntegrationError("session-expired");
    return refreshed.bundle.user.access_token as string;
  }
}
