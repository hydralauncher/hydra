import { randomUUID } from "node:crypto";
import type {
  EpicConnectedConnection,
  EpicConnection,
  EpicConnectionState,
  EpicErrorCode,
  EpicOperationResult,
  EpicSessionState,
  EpicStartAuthResult,
} from "../../../types/epic-integration.types";
import {
  EpicIntegrationError,
  isRecord,
  validateEpicAuthorizationCode,
} from "./auth-protocol.js";
import type { EpicAuthWindow, EpicAuthWindowCallbacks } from "./auth-window";
import type { EpicSessionRunner } from "./legendary-auth";
import type {
  EpicConnectionStore,
  EpicStoredConnection,
  EpicStoreScope,
} from "./store";

export interface EpicAuthContext extends EpicStoreScope {
  generation: number;
}

interface EpicRequestOptions {
  authContext: EpicAuthContext;
  timeout: number;
  signal: AbortSignal;
}

export interface EpicIntegrationDependencies {
  getAuthContext(): EpicAuthContext | null;
  isAuthContextCurrent(context: EpicAuthContext): boolean;
  store: Pick<
    EpicConnectionStore,
    "open" | "read" | "save" | "remove" | "cacheConnection" | "close"
  >;
  availability(): EpicConnectionState["availability"];
  checkBinary(): Promise<string>;
  createRunner(binary: string, signal: AbortSignal): Promise<EpicSessionRunner>;
  openWindow(callbacks: EpicAuthWindowCallbacks): EpicAuthWindow;
  get(options: EpicRequestOptions): Promise<unknown>;
  post(exchangeCode: string, options: EpicRequestOptions): Promise<unknown>;
  delete(connectionId: string, options: EpicRequestOptions): Promise<void>;
  emit(state: EpicConnectionState): void;
}

interface EpicOperation {
  id: string;
  context: EpicAuthContext;
  controller: AbortController;
  status: NonNullable<EpicConnectionState["operation"]>["status"];
  cancelled: boolean;
  cleanedUp?: boolean;
  window?: EpicAuthWindow;
  runner?: EpicSessionRunner;
  task?: Promise<EpicOperationResult>;
  preparation?: Promise<EpicStartAuthResult>;
  finishing?: Promise<"cleanup-failed" | undefined>;
}

const EPIC_HYDRA_REQUEST_TIMEOUT_MS = 20_000;

function validateEpicConnection(response: unknown): EpicConnection {
  if (!isRecord(response) || typeof response.connected !== "boolean") {
    throw new EpicIntegrationError("invalid-response");
  }
  if (!response.connected) return { connected: false };
  if (
    typeof response.connectionId !== "string" ||
    !/^[a-zA-Z0-9]{8,128}$/.test(response.connectionId) ||
    typeof response.epicAccountId !== "string" ||
    !/^[a-f0-9]{32}$/.test(response.epicAccountId) ||
    typeof response.displayName !== "string" ||
    !response.displayName.trim() ||
    typeof response.connectedAt !== "string" ||
    !Number.isFinite(Date.parse(response.connectedAt))
  ) {
    throw new EpicIntegrationError("invalid-response");
  }
  // Only public identity fields may reach the renderer.
  return {
    connected: true,
    connectionId: response.connectionId,
    epicAccountId: response.epicAccountId,
    displayName: response.displayName,
    connectedAt: response.connectedAt,
  };
}

function safeHttpError(response: unknown): EpicErrorCode | undefined {
  if (!isRecord(response)) return undefined;
  const status = response.status;
  if (status === 401) return "hydra-auth-required";
  if (status === 404 || status === 503) return "api-unavailable";
  if (status === 409) {
    const message = isRecord(response.data) ? response.data.message : undefined;
    if (message === "profile/epic-disconnect-required")
      return "different-account";
    if (message === "profile/epic-connection-changed")
      return "stale-connection";
    return "account-in-use";
  }
  if (status === 400 || status === 422) return "invalid-proof";
  if (status === 502) return "network";
  return undefined;
}

function safeError(error: unknown): EpicErrorCode {
  if (error instanceof EpicIntegrationError) return error.code;
  if (!isRecord(error)) return "network";
  if (
    error.code === "persistence-failed" ||
    error.code === "cleanup-failed" ||
    error.code === "invalid-response" ||
    error.code === "stale-connection" ||
    error.code === "operation-cancelled"
  )
    return error.code;
  const httpError = safeHttpError(error.response);
  if (httpError) return httpError;
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT")
    return "timeout";
  if (error.code === "ERR_CANCELED" || error.name === "AbortError")
    return "operation-cancelled";
  return "network";
}

function getEpicAccountId(user: Record<string, unknown>): string {
  if (
    typeof user.account_id !== "string" ||
    !/^[a-f0-9]{32}$/i.test(user.account_id)
  )
    throw new EpicIntegrationError("invalid-response");
  return user.account_id.toLowerCase();
}

export class EpicIntegrationCore {
  private operation: EpicOperation | null = null;
  private state: EpicConnectionState | null = null;
  private revision = 0;
  private stopping = false;
  private shuttingDown: Promise<void> | null = null;
  private stateContext: EpicAuthContext | null = null;
  private cached: {
    context: EpicAuthContext;
    connection: EpicConnectedConnection | null;
    sessionState: EpicSessionState;
    refreshExpiresAt?: number;
    error?: EpicErrorCode;
  } | null = null;
  private readonly reads = new Set<Promise<EpicConnectionState>>();
  private pendingCleanup: Promise<unknown> = Promise.resolve();
  private readonly queries = new Set<AbortController>();
  private readonly cleanupRetries = new Set<EpicOperation>();

  constructor(private readonly dependencies: EpicIntegrationDependencies) {}

  private isCurrent(context: EpicAuthContext) {
    return !this.stopping && this.dependencies.isAuthContextCurrent(context);
  }

  private isActive(operation: EpicOperation) {
    return (
      this.operation === operation &&
      !operation.cancelled &&
      this.isCurrent(operation.context)
    );
  }

  private assertActive(operation: EpicOperation) {
    if (!this.isActive(operation))
      throw new EpicIntegrationError("operation-cancelled");
  }

  private requestOptions(
    context: EpicAuthContext,
    signal: AbortSignal
  ): EpicRequestOptions {
    if (!this.isCurrent(context))
      throw new EpicIntegrationError("operation-cancelled");
    return {
      authContext: context,
      timeout: EPIC_HYDRA_REQUEST_TIMEOUT_MS,
      signal,
    };
  }

  public async initialize() {
    if (this.stopping) throw new EpicIntegrationError("operation-cancelled");
    await this.dependencies.store.open();
  }

  private matches(a: EpicAuthContext | null | undefined, b: EpicAuthContext) {
    return (
      a?.userId === b.userId &&
      a.environment === b.environment &&
      a.generation === b.generation
    );
  }

  private cacheStored(
    context: EpicAuthContext,
    stored: EpicStoredConnection | null
  ) {
    this.cached = {
      context,
      connection: stored?.connection ?? null,
      sessionState: stored?.sessionState ?? "missing",
      ...(stored?.bundle
        ? {
            refreshExpiresAt: Date.parse(
              stored.bundle.user.refresh_expires_at as string
            ),
          }
        : {}),
    };
  }

  private snapshot(
    context = this.dependencies.getAuthContext()
  ): EpicConnectionState {
    const availability = this.dependencies.availability();
    if (!context)
      return {
        hydraLoggedIn: false,
        hydraUserId: null,
        availability,
        connection: null,
        verification: "unconfirmed",
        sessionState: "missing",
        operation: null,
      };
    const cached = this.matches(this.cached?.context, context)
      ? this.cached
      : null;
    const previous = this.matches(this.stateContext, context)
      ? this.state
      : null;
    const active =
      this.operation && this.isActive(this.operation) ? this.operation : null;
    const error = cached?.error ?? previous?.error;
    const sessionState =
      cached?.sessionState === "ready" && cached.refreshExpiresAt! <= Date.now()
        ? "expired"
        : (cached?.sessionState ?? "missing");
    return {
      hydraLoggedIn: true,
      hydraUserId: context.userId,
      availability,
      connection: previous?.connection ??
        cached?.connection ?? { connected: false },
      verification: previous?.verification ?? "unconfirmed",
      sessionState,
      operation: active ? { id: active.id, status: active.status } : null,
      ...(error ? { error } : {}),
    };
  }

  private emit(context: EpicAuthContext | null, error?: EpicErrorCode) {
    if (this.stopping || (context && !this.isCurrent(context))) return;
    this.state = { ...this.snapshot(context), ...(error ? { error } : {}) };
    this.stateContext = context;
    this.dependencies.emit(this.state);
  }

  private invalidateQueries() {
    this.revision++;
    for (const query of this.queries) query.abort();
  }

  private async hydrate(context: EpicAuthContext, isCurrent: () => boolean) {
    try {
      const stored = await this.dependencies.store.read(context);
      if (isCurrent()) this.cacheStored(context, stored);
    } catch (error) {
      if (isCurrent())
        this.cached = {
          context,
          connection: this.matches(this.cached?.context, context)
            ? this.cached!.connection
            : null,
          sessionState: "unavailable",
          error: safeError(error),
        };
    }
  }

  private remoteState(
    context: EpicAuthContext,
    connection: EpicConnection,
    error?: EpicErrorCode
  ) {
    this.stateContext = context;
    this.state = {
      ...this.snapshot(context),
      connection,
      verification: "confirmed",
      ...(error
        ? { error, sessionState: "unavailable" as const }
        : { error: undefined }),
    };
    this.revision++;
    this.dependencies.emit(this.state);
    return this.state;
  }

  private async applyRemote(
    context: EpicAuthContext,
    connection: EpicConnection,
    isCurrent: () => boolean,
    expectedConnectionId?: string
  ) {
    if (!isCurrent()) throw new EpicIntegrationError("operation-cancelled");
    let error: EpicErrorCode | undefined;
    let stored: EpicStoredConnection | null = null;
    try {
      if (connection.connected)
        stored = await this.dependencies.store.cacheConnection(
          context,
          connection,
          isCurrent
        );
      else
        await this.dependencies.store.remove(
          context,
          isCurrent,
          expectedConnectionId
        );
    } catch (cause) {
      error = safeError(cause);
      if (error === "operation-cancelled" || error === "stale-connection")
        throw cause;
    }
    if (!isCurrent()) throw new EpicIntegrationError("operation-cancelled");
    this.cacheStored(context, stored);
    if (error)
      this.cached = {
        context,
        connection: connection.connected ? connection : null,
        sessionState: "unavailable",
        error,
      };
    return this.remoteState(context, connection, error);
  }

  public getConnection(): Promise<EpicConnectionState> {
    const context = this.dependencies.getAuthContext();
    if (
      this.stopping ||
      !context ||
      this.dependencies.availability().reason === "unsupported-platform" ||
      this.operation?.status === "connecting" ||
      this.operation?.status === "disconnecting"
    ) {
      return Promise.resolve(this.snapshot(context));
    }
    const task = this.queryConnection(context);
    this.reads.add(task);
    void task.finally(() => this.reads.delete(task)).catch(() => undefined);
    return task;
  }

  private async queryConnection(
    context: EpicAuthContext
  ): Promise<EpicConnectionState> {
    const revision = ++this.revision;
    const controller = new AbortController();
    const isCurrent = () =>
      !controller.signal.aborted &&
      this.isCurrent(context) &&
      revision === this.revision;
    this.queries.add(controller);
    try {
      const [, remote] = await Promise.allSettled([
        this.hydrate(context, isCurrent),
        this.dependencies.get(this.requestOptions(context, controller.signal)),
      ]);
      if (!isCurrent()) return this.snapshot();
      if (remote.status === "rejected") throw remote.reason;
      const state = await this.applyRemote(
        context,
        validateEpicConnection(remote.value),
        isCurrent
      );
      return this.isCurrent(context) &&
        !controller.signal.aborted &&
        this.state === state
        ? state
        : this.snapshot();
    } catch (error) {
      if (!isCurrent()) return this.snapshot();
      this.stateContext = context;
      this.state = {
        ...this.snapshot(context),
        verification: "unconfirmed",
        error: safeError(error),
      };
      this.dependencies.emit(this.state);
      return this.state;
    } finally {
      this.queries.delete(controller);
    }
  }

  public async startAuth(): Promise<EpicStartAuthResult> {
    await this.pendingCleanup;
    if (this.stopping) return { ok: false, error: "operation-cancelled" };
    if (!(await this.retryCleanup()))
      return { ok: false, error: "cleanup-failed" };
    if (this.stopping) return { ok: false, error: "operation-cancelled" };
    if (this.operation) return { ok: false, error: "operation-in-progress" };
    const context = this.dependencies.getAuthContext();
    if (!context) return { ok: false, error: "hydra-auth-required" };
    const available = this.dependencies.availability();
    if (!available.available)
      return { ok: false, error: available.reason ?? "legendary-unavailable" };
    const operation: EpicOperation = {
      id: randomUUID(),
      context,
      controller: new AbortController(),
      status: "awaiting-login",
      cancelled: false,
    };
    this.operation = operation;
    operation.preparation = this.prepareAuth(operation);
    try {
      return await operation.preparation;
    } finally {
      operation.preparation = undefined;
    }
  }

  private async prepareAuth(
    operation: EpicOperation
  ): Promise<EpicStartAuthResult> {
    const context = operation.context;
    try {
      const [connectionResult, binaryResult] = await Promise.allSettled([
        this.getConnection(),
        this.dependencies.checkBinary(),
      ]);
      this.assertActive(operation);
      if (connectionResult.status === "rejected") throw connectionResult.reason;
      const state = connectionResult.value;
      if (state.verification !== "confirmed" || state.error) {
        throw new EpicIntegrationError(state.error ?? "api-unavailable");
      }
      if (binaryResult.status === "rejected") throw binaryResult.reason;
      operation.runner = await this.dependencies.createRunner(
        binaryResult.value,
        operation.controller.signal
      );
      this.assertActive(operation);
      operation.window = this.dependencies.openWindow({
        onCode: (code) => this.completeAuth(operation, code),
        onCancel: () => this.cancelAuth(operation.id),
        onError: (error) => this.failWindow(operation, error),
      });
      this.emit(context);
      return { ok: true, operationId: operation.id };
    } catch (error) {
      const code = safeError(error);
      const cleanupError = await this.finish(operation, code);
      return { ok: false, error: cleanupError ?? code };
    }
  }

  private async failWindow(
    operation: EpicOperation,
    error: "auth-failed" | "invalid-response"
  ): Promise<EpicOperationResult> {
    if (!this.isActive(operation))
      return { ok: false, error: "invalid-operation" };
    if (operation.status !== "awaiting-login" || operation.task !== undefined)
      return { ok: false, error: "operation-in-progress" };
    // Invalidate immediately so a late callback cannot start a process during cleanup.
    operation.cancelled = true;
    operation.controller.abort();
    operation.window?.close();
    const cleanupError = await this.finish(operation, error);
    return { ok: false, error: cleanupError ?? error };
  }

  private async completeAuth(
    operation: EpicOperation,
    input: unknown
  ): Promise<EpicOperationResult> {
    if (!this.isActive(operation)) {
      return { ok: false, error: "invalid-operation" };
    }
    if (operation.status !== "awaiting-login" || operation.task !== undefined) {
      return { ok: false, error: "operation-in-progress" };
    }
    let code: string;
    try {
      code = validateEpicAuthorizationCode(input);
    } catch {
      return this.failWindow(operation, "invalid-response");
    }
    operation.status = "authenticating";
    operation.window?.close();
    this.emit(operation.context);
    operation.task = this.connect(operation, code);
    return operation.task;
  }

  private async connect(
    operation: EpicOperation,
    code: string
  ): Promise<EpicOperationResult> {
    let failure: EpicErrorCode | undefined;
    let result: EpicOperationResult = { ok: false, error: "auth-failed" };
    try {
      this.assertActive(operation);
      if (!operation.runner) throw new EpicIntegrationError("auth-failed");
      const firstBundle = await operation.runner.authenticate(code);
      this.assertActive(operation);
      const accountId = getEpicAccountId(firstBundle.user);
      const linked = this.state?.connection;
      if (linked?.connected && linked.epicAccountId !== accountId) {
        throw new EpicIntegrationError("different-account");
      }
      const exchangeCode = await operation.runner.getExchangeCode();
      this.assertActive(operation);
      // get-token may refresh and rewrite user.json. Persist only the latest file.
      const bundle = await operation.runner.readBundle();
      this.assertActive(operation);
      if (getEpicAccountId(bundle.user) !== accountId) {
        throw new EpicIntegrationError("invalid-response");
      }
      operation.status = "connecting";
      this.invalidateQueries();
      this.emit(operation.context);
      const connection = await this.confirmConnection(
        operation,
        exchangeCode,
        accountId
      );
      this.assertActive(operation);
      // The server link is real even if local persistence subsequently fails.
      this.remoteState(operation.context, connection);
      if (!(await this.cleanupOperation(operation)))
        throw new EpicIntegrationError("cleanup-failed");
      this.assertActive(operation);
      await this.dependencies.store.save(
        operation.context,
        connection,
        bundle,
        () => this.isActive(operation),
        (stored) => {
          this.cacheStored(operation.context, stored);
          this.operation = null;
          this.stateContext = operation.context;
          this.state = {
            ...this.snapshot(operation.context),
            connection,
            verification: "confirmed",
            error: undefined,
          };
        }
      );
      this.emit(operation.context);
      result = { ok: true };
    } catch (error) {
      failure = safeError(error);
      if (
        this.isCurrent(operation.context) &&
        (failure === "persistence-failed" || failure === "cleanup-failed")
      ) {
        this.cached = {
          context: operation.context,
          connection: this.state?.connection?.connected
            ? this.state.connection
            : null,
          sessionState: "unavailable",
          error: failure,
        };
      }
      result = { ok: false, error: failure };
    } finally {
      const cleanupError = await this.finish(operation, failure);
      if (cleanupError) result = { ok: false, error: cleanupError };
    }
    return result;
  }

  private async confirmConnection(
    operation: EpicOperation,
    exchangeCode: string,
    accountId: string
  ): Promise<EpicConnectedConnection> {
    let connection: EpicConnection;
    try {
      connection = validateEpicConnection(
        await this.dependencies.post(
          exchangeCode,
          this.requestOptions(operation.context, operation.controller.signal)
        )
      );
    } catch (error) {
      connection = await this.reconcileConnect(operation, accountId, error);
    }
    this.assertActive(operation);
    if (!connection.connected || connection.epicAccountId !== accountId)
      throw new EpicIntegrationError("invalid-response");
    return connection;
  }

  private async readRemote(operation: EpicOperation): Promise<EpicConnection> {
    return validateEpicConnection(
      await this.dependencies.get(
        this.requestOptions(operation.context, operation.controller.signal)
      )
    );
  }

  private async reconcileConnect(
    operation: EpicOperation,
    accountId: string,
    error: unknown
  ): Promise<EpicConnection> {
    this.assertActive(operation);
    const cause = safeError(error);
    if (cause === "different-account" || cause === "stale-connection") {
      if (this.state) this.state.verification = "unconfirmed";
      try {
        const latest = await this.readRemote(operation);
        this.assertActive(operation);
        await this.applyRemote(operation.context, latest, () =>
          this.isActive(operation)
        );
      } catch {
        this.assertActive(operation);
      }
      // The backend rejected the candidate. Never commit it or repeat POST.
      throw new EpicIntegrationError(cause);
    }
    if (
      cause !== "network" &&
      cause !== "timeout" &&
      cause !== "invalid-response"
    )
      throw error;
    if (this.state) this.state.verification = "unconfirmed";
    // A redeemed proof is single-use. Reconcile instead of retrying POST.
    const connection = await this.readRemote(operation);
    this.assertActive(operation);
    if (!connection.connected || connection.epicAccountId !== accountId) {
      await this.applyRemote(operation.context, connection, () =>
        this.isActive(operation)
      );
      throw new EpicIntegrationError(cause);
    }
    return connection;
  }

  private async finish(operation: EpicOperation, error?: EpicErrorCode) {
    operation.finishing ??= this.finishOnce(operation, error);
    return operation.finishing;
  }

  private async cleanupOperation(operation: EpicOperation) {
    if (operation.cleanedUp) return true;
    let cleanupFailed = false;
    try {
      await operation.window?.cleanup();
    } catch {
      cleanupFailed = true;
    }
    try {
      await operation.runner?.cleanup();
    } catch {
      cleanupFailed = true;
    }
    operation.cleanedUp = !cleanupFailed;
    return !cleanupFailed;
  }

  private async retryCleanup() {
    await Array.from(this.cleanupRetries).reduce(
      async (previous, operation) => {
        await previous;
        if (await this.cleanupOperation(operation))
          this.cleanupRetries.delete(operation);
      },
      Promise.resolve()
    );
    return this.cleanupRetries.size === 0;
  }

  private async finishOnce(operation: EpicOperation, error?: EpicErrorCode) {
    const cleanupFailed = !(await this.cleanupOperation(operation));
    if (cleanupFailed) this.cleanupRetries.add(operation);
    const owned = this.operation === operation;
    if (owned) this.operation = null;
    if (owned && this.isCurrent(operation.context)) {
      if (this.state) this.state.error = undefined;
      this.emit(operation.context, cleanupFailed ? "cleanup-failed" : error);
    }
    return cleanupFailed ? ("cleanup-failed" as const) : undefined;
  }

  public async cancelAuth(operationId: string): Promise<EpicOperationResult> {
    const operation = this.operation;
    if (operation?.id !== operationId || !this.isCurrent(operation.context)) {
      return { ok: false, error: "invalid-operation" };
    }
    const result = await this.cancelActive();
    if (
      result === "cleanup-failed" ||
      (isRecord(result) && result.error === "cleanup-failed")
    ) {
      return { ok: false, error: "cleanup-failed" };
    }
    return { ok: true };
  }

  private cancelActive() {
    const operation = this.operation;
    if (!operation) return this.pendingCleanup;
    operation.cancelled = true;
    operation.controller.abort();
    for (const query of this.queries) query.abort();
    operation.window?.close();
    this.pendingCleanup =
      operation.task ??
      operation.preparation ??
      this.finish(operation, "operation-cancelled");
    return this.pendingCleanup;
  }

  public async authContextChanged() {
    this.invalidateQueries();
    const cleanup = this.cancelActive();
    const context = this.dependencies.getAuthContext();
    this.state = null;
    this.stateContext = null;
    this.cached = null;
    this.emit(context);
    await cleanup;
    if (context && this.isCurrent(context)) await this.getConnection();
  }

  shutdown(): Promise<void> {
    if (this.shuttingDown) return this.shuttingDown;
    this.stopping = true;
    this.invalidateQueries();
    this.shuttingDown = (async () => {
      try {
        await this.cancelActive();
        await Promise.allSettled([...this.reads]);
        if (!(await this.retryCleanup()))
          throw new EpicIntegrationError("cleanup-failed");
      } finally {
        await this.dependencies.store.close();
      }
    })();
    return this.shuttingDown;
  }

  public async disconnect(connectionId: unknown): Promise<EpicOperationResult> {
    const context = this.dependencies.getAuthContext();
    if (this.stopping) return { ok: false, error: "operation-cancelled" };
    if (!context) return { ok: false, error: "hydra-auth-required" };
    if (
      typeof connectionId !== "string" ||
      !/^[a-zA-Z0-9]{8,128}$/.test(connectionId)
    ) {
      return { ok: false, error: "stale-connection" };
    }
    if (this.operation?.status === "disconnecting") {
      return { ok: false, error: "operation-in-progress" };
    }
    await this.cancelActive();
    if (!this.isCurrent(context))
      return { ok: false, error: "operation-cancelled" };
    if (this.operation) return { ok: false, error: "operation-in-progress" };
    const operation: EpicOperation = {
      id: randomUUID(),
      context,
      controller: new AbortController(),
      status: "disconnecting",
      cancelled: false,
    };
    this.operation = operation;
    this.invalidateQueries();
    this.emit(context);
    operation.task = this.performDisconnect(operation, connectionId);
    return operation.task;
  }

  private async performDisconnect(
    operation: EpicOperation,
    connectionId: string
  ): Promise<EpicOperationResult> {
    const context = operation.context;
    let failure: EpicErrorCode | undefined;
    let result: EpicOperationResult = { ok: false, error: "network" };
    try {
      const cached = this.snapshot(context).connection;
      if (cached?.connected && cached.connectionId !== connectionId) {
        throw new EpicIntegrationError("stale-connection");
      }
      try {
        await this.dependencies.delete(
          connectionId,
          this.requestOptions(context, operation.controller.signal)
        );
      } catch (error) {
        await this.reconcileDisconnect(operation, connectionId, error);
      }
      this.assertActive(operation);
      const updatedState = await this.applyRemote(
        context,
        { connected: false },
        () => this.isActive(operation),
        connectionId
      );
      if (updatedState.error)
        throw new EpicIntegrationError(updatedState.error);
      result = { ok: true };
    } catch (error) {
      failure = safeError(error);
      result = { ok: false, error: failure };
    } finally {
      const cleanupError = await this.finish(operation, failure);
      if (cleanupError) result = { ok: false, error: cleanupError };
    }
    return result;
  }

  private async reconcileDisconnect(
    operation: EpicOperation,
    connectionId: string,
    error: unknown
  ) {
    this.assertActive(operation);
    const cause = safeError(error);
    const stale =
      cause === "account-in-use" ||
      cause === "stale-connection" ||
      cause === "different-account";
    if (!stale && cause !== "network" && cause !== "timeout") throw error;
    if (this.state) this.state.verification = "unconfirmed";
    const latest = await this.readRemote(operation);
    this.assertActive(operation);
    await this.applyRemote(operation.context, latest, () =>
      this.isActive(operation)
    );
    if (stale) throw new EpicIntegrationError("stale-connection");
    if (latest.connected)
      throw new EpicIntegrationError(
        latest.connectionId === connectionId ? cause : "stale-connection"
      );
  }
}
