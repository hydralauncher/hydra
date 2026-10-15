import type {
  EpicConnectedConnection,
  EpicErrorCode,
  EpicSnapshotGame,
  EpicSyncFinished,
  EpicSyncRun,
  EpicSyncState,
  EpicSyncTrigger,
  EpicAchievementSummary,
} from "../../../types/epic-integration.types";
import type { EpicAuthContext } from "./integration-core";
import {
  EPIC_RECONCILE_INTERVAL_MS,
  EPIC_SYNC_TIMEOUT_MS,
  EPIC_HYDRA_TIMEOUT_MS,
  EPIC_PENDING_EXPIRATION_MS,
  EPIC_RUNNING_EXPIRATION_MS,
} from "./constants.js";
import { EpicIntegrationError } from "./auth-protocol.js";
import {
  buildEpicSnapshotChunks,
  type EpicSnapshotChunk,
} from "./sync-snapshot.js";
import { applyEpicPlaytime } from "./library-normalizer.js";
import { epicWait } from "./source-retry.js";
import { epicSyncHttpError } from "./sync-protocol.js";
import {
  EPIC_ACHIEVEMENT_BUDGET_MS,
  EPIC_ACHIEVEMENT_PUBLICATION_RESERVE_MS,
} from "./constants.js";

export interface EpicSyncContext {
  auth: EpicAuthContext;
  connection: EpicConnectedConnection;
}
export interface EpicSyncJournal {
  syncRunId: string;
  totalChunks: number | null;
  mergePending: boolean;
  requiresReconnect?: boolean;
}
export interface EpicSyncDependencies {
  capture(): Promise<EpicSyncContext>;
  current(context: EpicSyncContext): boolean;
  library(
    context: EpicSyncContext,
    signal: AbortSignal
  ): Promise<EpicSnapshotGame[]>;
  playtime(
    context: EpicSyncContext,
    signal: AbortSignal,
    fresh: boolean
  ): Promise<Map<string, number>>;
  achievements?(
    context: EpicSyncContext,
    games: EpicSnapshotGame[],
    signal: AbortSignal,
    progress: (processed: number, total: number) => void,
    budget: number
  ): Promise<{ games: EpicSnapshotGame[]; requiresReconnect: boolean }>;
  start(
    context: EpicSyncContext,
    trigger: EpicSyncTrigger,
    signal: AbortSignal
  ): Promise<string>;
  run(
    context: EpicSyncContext,
    id: string,
    signal: AbortSignal
  ): Promise<EpicSyncRun>;
  upload(
    context: EpicSyncContext,
    id: string,
    index: number,
    chunk: EpicSnapshotChunk,
    signal: AbortSignal
  ): Promise<void>;
  commit(
    context: EpicSyncContext,
    id: string,
    signal: AbortSignal
  ): Promise<void>;
  cancel(
    context: EpicSyncContext,
    id: string,
    signal: AbortSignal
  ): Promise<void>;
  journal(context: EpicSyncContext): Promise<EpicSyncJournal | null>;
  saveJournal(
    context: EpicSyncContext,
    value: EpicSyncJournal | null
  ): Promise<void>;
  merge(
    context: EpicSyncContext,
    progress: (processed: number, total: number) => void,
    signal: AbortSignal
  ): Promise<boolean>;
  emit(state: EpicSyncState): void;
  finished(result: EpicSyncFinished): void;
}
interface Operation {
  context: EpicSyncContext;
  controller: AbortController;
  task: Promise<void>;
  trigger: EpicSyncTrigger;
  id: string | null;
}

export class EpicSyncOrchestrator {
  private operation: Operation | null = null;
  private state: EpicSyncState = { status: "idle", hydraUserId: null };
  private preparing: Promise<EpicSyncState> | null = null;
  constructor(private readonly deps: EpicSyncDependencies) {}
  getState() {
    return { ...this.state };
  }
  resetState(hydraUserId: string | null) {
    if (this.operation) return;
    this.state = { status: "idle", hydraUserId };
    this.deps.emit(this.getState());
  }
  async wait() {
    await this.operation?.task;
  }
  private assert(context: EpicSyncContext) {
    if (!this.deps.current(context))
      throw new EpicIntegrationError("operation-cancelled");
  }
  private publish(
    operation: Operation,
    phase: EpicSyncState["phase"],
    processed = 0,
    total: number | null = null
  ) {
    this.assert(operation.context);
    this.state = {
      status: operation.controller.signal.aborted ? "cancelling" : "running",
      hydraUserId: operation.context.auth.userId,
      connectionId: operation.context.connection.connectionId,
      syncRunId: operation.id,
      phase,
      processed,
      total,
    };
    this.deps.emit(this.getState());
  }
  start(
    connectionId: string,
    trigger: EpicSyncTrigger = "MANUAL"
  ): Promise<EpicSyncState> {
    if (this.preparing !== null)
      return this.preparing.then(() => this.start(connectionId, trigger));
    this.preparing = this.prepare(connectionId, trigger).finally(() => {
      this.preparing = null;
    });
    return this.preparing;
  }
  private async prepare(connectionId: string, trigger: EpicSyncTrigger) {
    const context = await this.deps.capture();
    this.assert(context);
    if (context.connection.connectionId !== connectionId)
      throw new EpicIntegrationError("stale-connection");
    if (this.operation) {
      if (this.deps.current(this.operation.context)) return this.getState();
      await this.abortAndWait();
      this.assert(context);
    }
    const operation: Operation = {
      context,
      trigger,
      controller: new AbortController(),
      id: null,
      task: Promise.resolve(),
    };
    this.operation = operation;
    this.publish(operation, "starting");
    operation.task = this.execute(operation);
    return this.getState();
  }
  async abortAndWait() {
    const operation = this.operation;
    operation?.controller.abort();
    await operation?.task;
  }
  async cancel(connectionId: string) {
    if (this.operation) {
      if (this.operation.context.connection.connectionId !== connectionId)
        throw new EpicIntegrationError("stale-connection");
      this.operation.controller.abort();
      this.state = { ...this.state, status: "cancelling" };
      this.deps.emit(this.getState());
      await this.operation.task;
      return;
    }
    const context = await this.deps.capture();
    if (context.connection.connectionId !== connectionId)
      throw new EpicIntegrationError("stale-connection");
    const run = context.connection.latestSyncRun;
    if (run?.status === "PENDING") {
      await this.deps.cancel(
        context,
        run.id,
        AbortSignal.timeout(EPIC_SYNC_TIMEOUT_MS)
      );
      this.assert(context);
      await this.deps.saveJournal(context, null);
    }
    this.state = { status: "idle", hydraUserId: context.auth.userId };
    this.deps.emit(this.getState());
  }
  private async terminal(operation: Operation, signal: AbortSignal) {
    for (;;) {
      this.assert(operation.context);
      const run = await this.deps.run(operation.context, operation.id!, signal);
      if (run.status !== "RUNNING") return run;
      await epicWait(EPIC_RECONCILE_INTERVAL_MS, signal);
    }
  }
  private async execute(operation: Operation) {
    const { context, controller } = operation;
    const timer = setTimeout(() => controller.abort(), EPIC_SYNC_TIMEOUT_MS);
    let publication: EpicSyncFinished["publication"] = "not-published";
    let requiresMerge = false;
    let error: EpicErrorCode | undefined;
    let journal: EpicSyncJournal | null = null;
    const startedAt = Date.now();
    let requiresReconnect = false;
    let achievementSummary: EpicAchievementSummary | undefined;
    let achievementsRequested =
      context.connection.capabilities?.achievementsSnapshotVersion === 1;
    const startRun = async () => {
      const id = await this.deps.start(
        context,
        operation.trigger,
        controller.signal
      );
      achievementsRequested =
        context.connection.capabilities?.achievementsSnapshotVersion === 1;
      return id;
    };
    try {
      journal = await this.deps.journal(context);
      let resuming = !!journal;
      if (journal) {
        operation.id = journal.syncRunId;
        publication = "unknown";
        let run = await this.deps.run(context, operation.id, controller.signal);
        if (run.achievementSnapshotVersion !== 1) achievementsRequested = false;
        requiresReconnect = journal.requiresReconnect ?? false;
        const expired =
          (run.status === "PENDING" &&
            Date.now() - Date.parse(run.createdAt) >=
              EPIC_PENDING_EXPIRATION_MS) ||
          (run.status === "RUNNING" &&
            run.startedAt !== null &&
            Date.now() - Date.parse(run.startedAt) >=
              EPIC_RUNNING_EXPIRATION_MS);
        if (expired) {
          // The server decides expiry under its lock; never claim RUNNING locally.
          operation.id = await startRun();
          journal = {
            syncRunId: operation.id,
            totalChunks: null,
            mergePending: false,
          };
          await this.deps.saveJournal(context, journal);
          resuming = false;
          run = await this.deps.run(context, operation.id, controller.signal);
        } else if (run.status === "RUNNING")
          run = await this.terminal(operation, controller.signal);
        if (run.status !== "SUCCEEDED") publication = "not-published";
        if (run.status === "SUCCEEDED") publication = "published";
        else if (run.status === "FAILED") {
          await this.deps.saveJournal(context, null);
          journal = null;
          operation.id = null;
          resuming = false;
        } else if (
          run.status === "PENDING" &&
          run.achievementSnapshotVersion !== 1 &&
          context.connection.capabilities?.achievementsSnapshotVersion === 1
        ) {
          // Replace legacy staging before collecting a snapshot for a versioned run.
          await this.deps.cancel(context, operation.id!, controller.signal);
          await this.deps.saveJournal(context, null);
          journal = null;
          operation.id = null;
          resuming = false;
        }
      }
      if (publication !== "published") {
        // Only IDs returned to this launcher (or recovered from its journal) are writable.
        if (!operation.id) {
          operation.id = await startRun();
          this.assert(context);
          journal = {
            syncRunId: operation.id,
            totalChunks: null,
            mergePending: false,
          };
          await this.deps.saveJournal(context, journal);
        }
        // Replace warnings from an older attempt before collecting a fresh snapshot.
        // A later staging replacement must retain this collection's reconnect result.
        requiresReconnect = false;
        this.publish(operation, "library");
        const games = await this.deps.library(context, controller.signal);
        this.publish(operation, "playtime", 0, games.length);
        let snapshot = applyEpicPlaytime(
          games,
          await this.deps.playtime(context, controller.signal, true)
        );
        this.assert(context);
        if (achievementsRequested && this.deps.achievements) {
          this.publish(operation, "achievements", 0, snapshot.length);
          const result = await this.deps.achievements(
            context,
            snapshot,
            controller.signal,
            (processed, total) =>
              this.publish(operation, "achievements", processed, total),
            Math.min(
              EPIC_ACHIEVEMENT_BUDGET_MS,
              Math.max(
                1,
                EPIC_SYNC_TIMEOUT_MS -
                  (Date.now() - startedAt) -
                  EPIC_ACHIEVEMENT_PUBLICATION_RESERVE_MS
              )
            )
          );
          this.assert(context);
          snapshot = result.games;
          requiresReconnect = result.requiresReconnect;
        }
        const chunks = buildEpicSnapshotChunks(
          context.connection.connectionId,
          snapshot
        );
        if (
          resuming &&
          (!journal ||
            journal.totalChunks === null ||
            journal.totalChunks !== chunks.length)
        ) {
          await this.deps.cancel(context, operation.id!, controller.signal);
          operation.id = await startRun();
        }
        journal = {
          syncRunId: operation.id!,
          totalChunks: chunks.length,
          mergePending: false,
          requiresReconnect,
        };
        await this.deps.saveJournal(context, journal);
        for (const [index, chunk] of chunks.entries()) {
          this.publish(operation, "publishing", index, chunks.length);
          await this.deps.upload(
            context,
            operation.id!,
            index,
            chunk,
            controller.signal
          );
        }
        this.publish(operation, "publishing", chunks.length, chunks.length);
        publication = "unknown";
        try {
          await this.deps.commit(context, operation.id!, controller.signal);
          publication = "published";
        } catch (commitError) {
          this.assert(context);
          const run = await this.terminal(
            operation,
            AbortSignal.timeout(EPIC_HYDRA_TIMEOUT_MS)
          );
          if (run.status === "SUCCEEDED") publication = "published";
          else {
            publication = "not-published";
            throw commitError;
          }
        }
      }
      if (achievementsRequested) {
        const run = await this.deps.run(
          context,
          operation.id!,
          AbortSignal.timeout(EPIC_HYDRA_TIMEOUT_MS)
        );
        this.assert(context);
        achievementSummary = run.achievementSummary ?? undefined;
      }
      this.assert(context);
      requiresMerge = true;
      await this.deps.saveJournal(context, {
        syncRunId: operation.id!,
        totalChunks: journal?.totalChunks ?? null,
        mergePending: true,
        requiresReconnect,
      });
      this.publish(operation, "merging");
      if (
        !(await this.deps.merge(
          context,
          (processed, total) =>
            this.publish(operation, "merging", processed, total),
          controller.signal
        ))
      )
        throw new EpicIntegrationError("merge-failed");
      this.assert(context);
      requiresMerge = false;
      await this.deps.saveJournal(context, null);
      this.publish(operation, "finishing");
    } catch (cause) {
      error = epicSyncHttpError(cause);
      if (controller.signal.aborted && publication !== "published")
        error = "operation-cancelled";
      // Cancellation can only discard staging. A confirmed commit still needs reconciliation.
      if (
        controller.signal.aborted &&
        publication === "not-published" &&
        operation.id &&
        this.deps.current(context)
      ) {
        try {
          await this.deps.cancel(
            context,
            operation.id,
            AbortSignal.timeout(EPIC_HYDRA_TIMEOUT_MS)
          );
          await this.deps.saveJournal(context, null);
        } catch {
          /* Journal remains for the next reconciliation. */
        }
      }
    } finally {
      clearTimeout(timer);
      if (this.operation === operation) this.operation = null;
      if (this.deps.current(context)) {
        this.state = {
          status: "idle",
          hydraUserId: context.auth.userId,
          connectionId: context.connection.connectionId,
          requiresReconnect: requiresReconnect || error === "session-expired",
          ...(achievementSummary ? { achievementSummary } : {}),
          ...(error ? { error } : {}),
        };
        this.deps.emit(this.getState());
        this.deps.finished({
          hydraUserId: context.auth.userId,
          connectionId: context.connection.connectionId,
          origin:
            operation.trigger === "FIRST_LINK"
              ? "first-link"
              : operation.trigger === "STARTUP"
                ? "startup"
                : "manual",
          ok: !error,
          ...(error ? { error } : {}),
          publication,
          requiresMerge,
          ...(achievementSummary ? { achievementSummary } : {}),
        });
      }
    }
  }
}
