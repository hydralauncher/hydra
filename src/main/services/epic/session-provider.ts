import type { EpicConnectedConnection } from "../../../types/epic-integration.types";
import type { EpicAuthContext } from "./integration-core";
import type { EpicConnectionStore } from "./store";
import { EpicIntegrationError } from "./auth-protocol.js";
import { LegendarySyncRunner } from "./legendary-sync.js";

export class EpicSessionProvider {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: EpicConnectionStore,
    private readonly userData: string,
    private readonly binary: () => Promise<string>,
    private readonly current: (
      context: EpicAuthContext,
      connection: EpicConnectedConnection
    ) => boolean
  ) {}
  serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => undefined).then(task);
    this.tail = result.catch(() => undefined);
    return result;
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
      const stored = await this.store.read(context);
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
      const runner = await LegendarySyncRunner.create(
        await this.binary(),
        this.userData,
        connection.epicAccountId,
        stored.bundle,
        signal,
        (bundle) =>
          this.store
            .refreshSession(context, connection, bundle, () =>
              this.current(context, connection)
            )
            .then(() => undefined)
      );
      try {
        return await task(runner);
      } finally {
        await runner.cleanup();
      }
    });
  }
  async token(
    context: EpicAuthContext,
    connection: EpicConnectedConnection,
    signal: AbortSignal,
    force = false
  ): Promise<string> {
    const stored = await this.store.read(context);
    if (
      !stored?.bundle ||
      stored.connection.connectionId !== connection.connectionId ||
      !this.current(context, connection)
    )
      throw new EpicIntegrationError("session-expired");
    if (
      force ||
      Date.parse(stored.bundle.user.expires_at as string) <= Date.now()
    )
      await this.use(context, connection, signal, (runner) =>
        runner.refresh(force)
      );
    const refreshed = await this.store.read(context);
    if (
      !this.current(context, connection) ||
      refreshed?.connection.connectionId !== connection.connectionId ||
      !refreshed.bundle ||
      Date.parse(refreshed.bundle.user.expires_at as string) <= Date.now()
    )
      throw new EpicIntegrationError("session-expired");
    return refreshed.bundle.user.access_token as string;
  }
}
