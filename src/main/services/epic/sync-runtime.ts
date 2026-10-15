import { resolveEpicSessionPlaytimePolicy } from "./playtime-policy";
import { createHash } from "node:crypto";
import type { Game } from "@types";
import type {
  EpicConnectionState,
  EpicSyncTrigger,
  EpicSyncRun,
} from "../../../types/epic-integration.types";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { HydraApi } from "../hydra-api";
import { WindowManager } from "../window-manager";
import { logger } from "../logger";
import { mergeWithRemoteGames } from "../library-sync/merge-with-remote-games";
import {
  mergeImportedProfileGame,
  type ImportedProfileGame,
} from "../library-sync/merge-imported-profile-game";
import {
  getHydraPlaytimeRevision,
  libraryWriteQueue,
} from "../library-sync/library-write-queue";
import {
  EpicSyncOrchestrator,
  type EpicSyncContext,
  type EpicSyncJournal,
} from "./sync-orchestrator";
import { EpicSessionProvider } from "./session-provider";
import { EpicPlaytimeSource } from "./playtime-source";
import { EpicAchievementSource } from "./achievement-source";
import { parseEpicAchievementTargets } from "./achievement-protocol";
import { buildEpicSnapshotChunks } from "./sync-snapshot";
import { AchievementMemoryStore } from "../achievements/achievement-memory-store";
import { EpicConnectionStore } from "./store";
import { getEpicDownloadService } from "./download";
import { scheduleEpicStoreAutoImport } from "./egs-auto-import";
import {
  isEpicInstallExecutable,
  listEpicStoreInstallations,
} from "./session-attribution";
import {
  EpicIntegrationError,
  EPIC_CONNECTION_ID_PATTERN,
  isRecord,
} from "./auth-protocol";
import {
  parseEpicSyncRun,
  EPIC_RUN_ID_PATTERN,
  EPIC_LEGACY_RUN_ID_PATTERN,
} from "./sync-protocol";
import {
  EPIC_ENDPOINT,
  EPIC_EXIT_SYNC_DELAYS_MS,
  EPIC_HYDRA_TIMEOUT_MS,
  EPIC_IMPORT_LOOKUP_TIMEOUT_MS,
  EPIC_SYNC_TIMEOUT_MS,
} from "./constants";
import {
  normalizeEpicLibrary,
  getEpicGamePlaytime,
  isEpicObjectId,
} from "./library-normalizer";
import { matchesEpicImportScope } from "./import-cleanup";
import {
  managedWorkspacePath,
  epicOwnerMatches,
} from "./legendary-managed-runtime";

type OwnGame = ImportedProfileGame & {
  epicImport: { connectionId: string; artifactIds: string[] } | null;
};
interface Individual {
  controller: AbortController;
  promise: Promise<number | null>;
}
export class EpicSyncRuntime {
  readonly session: EpicSessionProvider;
  readonly source: EpicPlaytimeSource;
  readonly orchestrator: EpicSyncOrchestrator;
  private readonly individual = new Map<string, Individual>();
  private readonly aliases = new Map<
    string,
    { context: EpicSyncContext; artifactIds: string[] }
  >();
  private readonly exitTimers = new Map<
    string,
    {
      timers: ReturnType<typeof setTimeout>[];
      cancelled: boolean;
      first?: Promise<number | null>;
    }
  >();
  private attemptedStartup = new Set<string>();
  constructor(
    store: EpicConnectionStore,
    private readonly userData: string,
    binary: () => Promise<string>,
    private readonly connection: () => Promise<EpicConnectionState>,
    private readonly peek: () => EpicConnectionState | null
  ) {
    this.session = new EpicSessionProvider(
      store,
      userData,
      binary,
      (auth, connection) => this.current({ auth, connection })
    );
    this.source = new EpicPlaytimeSource(this.session);
    const achievementSource = new EpicAchievementSource(this.session);
    const options = (context: EpicSyncContext, signal: AbortSignal) => ({
      authContext: context.auth,
      signal,
      timeout: EPIC_HYDRA_TIMEOUT_MS,
      logResponseBody: false,
    });
    const journalKey = (context: EpicSyncContext) =>
      `epicSyncRun:${createHash("sha256")
        .update(
          JSON.stringify([
            context.auth.environment,
            context.auth.userId,
            context.connection.connectionId,
          ])
        )
        .digest("hex")}`;
    this.orchestrator = new EpicSyncOrchestrator({
      capture: () => this.capture(),
      current: (context) => this.current(context),
      library: (context, signal) =>
        this.session.use(
          context.auth,
          context.connection,
          signal,
          async (runner) =>
            normalizeEpicLibrary(await runner.library(), (diagnostic) =>
              logger.error("Epic library validation failed", diagnostic)
            )
        ),
      playtime: (context, signal, fresh) =>
        this.source.get(context.auth, context.connection, signal, fresh),
      achievements: async (context, games, signal, progress, budget) => {
        const key = `${journalKey(context)}:achievementPending`;
        const pending = await db
          .get<string, string[]>(key, { valueEncoding: "json" })
          .catch(() => []);
        const result = await achievementSource.collect(
          context,
          games,
          signal,
          async (objectIds, sourceSignal) =>
            parseEpicAchievementTargets(
              await HydraApi.post(
                `${EPIC_ENDPOINT}/achievement-targets`,
                { connectionId: context.connection.connectionId, objectIds },
                options(context, sourceSignal)
              ),
              objectIds
            ),
          Array.isArray(pending) ? pending : [],
          progress,
          budget
        );
        if (!this.current(context) || signal.aborted)
          throw new EpicIntegrationError("operation-cancelled");
        try {
          buildEpicSnapshotChunks(
            context.connection.connectionId,
            result.games
          );
        } catch (error) {
          if (
            !(error instanceof EpicIntegrationError) ||
            error.code !== "snapshot-too-large"
          )
            throw error;
          result.games = result.games.map((game) => ({
            ...game,
            achievements: null,
          }));
          buildEpicSnapshotChunks(
            context.connection.connectionId,
            result.games
          );
          result.pendingObjectIds = result.games.map(
            (game) => `${game.namespace}:${game.catalogItemId}`
          );
        }
        await libraryWriteQueue.run(
          () => db.put(key, result.pendingObjectIds, { valueEncoding: "json" }),
          () => this.current(context)
        );
        return result;
      },
      start: async (context, trigger, signal) => {
        let result: { syncRunId: string };
        try {
          result = await HydraApi.post<{ syncRunId: string }>(
            `${EPIC_ENDPOINT}/sync`,
            {
              connectionId: context.connection.connectionId,
              trigger,
              ...(context.connection.capabilities
                ?.achievementsSnapshotVersion === 1
                ? { achievementSnapshotVersion: 1 }
                : {}),
            },
            options(context, signal)
          );
        } catch (error) {
          if (this.current(context) && !signal.aborted) {
            const state = await this.connection().catch(() => null);
            if (
              this.current(context) &&
              state?.connection?.connected &&
              state.connection.connectionId ===
                context.connection.connectionId &&
              ["PENDING", "RUNNING"].includes(
                state.connection.latestSyncRun?.status ?? ""
              )
            )
              throw new EpicIntegrationError("sync-active");
          }
          throw error;
        }
        if (!EPIC_RUN_ID_PATTERN.test(result.syncRunId))
          throw new EpicIntegrationError("invalid-response");
        return result.syncRunId;
      },
      run: async (context, id, signal) =>
        parseEpicSyncRun(
          await HydraApi.get<EpicSyncRun>(
            `${EPIC_ENDPOINT}/sync/${id}`,
            undefined,
            options(context, signal)
          )
        ),
      upload: (context, id, index, chunk, signal) =>
        HydraApi.put(
          `${EPIC_ENDPOINT}/sync/${id}/snapshot/chunks/${index}`,
          chunk,
          options(context, signal)
        ).then(() => undefined),
      commit: (context, id, signal) =>
        HydraApi.post(
          `${EPIC_ENDPOINT}/sync/${id}/snapshot/commit`,
          { connectionId: context.connection.connectionId },
          options(context, signal)
        ).then(() => undefined),
      cancel: (context, id, signal) =>
        HydraApi.delete(
          `${EPIC_ENDPOINT}/sync/${id}?connectionId=${encodeURIComponent(context.connection.connectionId)}`,
          options(context, signal)
        ),
      journal: async (context) => {
        const value = await db.get<string, EpicSyncJournal>(
          journalKey(context),
          { valueEncoding: "json" }
        );
        if (value && EPIC_LEGACY_RUN_ID_PATTERN.test(value.syncRunId)) {
          await libraryWriteQueue.run(
            () => db.del(journalKey(context)),
            () => this.current(context)
          );
          return null;
        }
        return value &&
          EPIC_RUN_ID_PATTERN.test(value.syncRunId) &&
          (value.totalChunks === null ||
            (Number.isInteger(value.totalChunks) && value.totalChunks > 0))
          ? value
          : null;
      },
      saveJournal: (context, value) =>
        libraryWriteQueue.run(
          async () => {
            if (value)
              await db.put(journalKey(context), value, {
                valueEncoding: "json",
              });
            else await db.del(journalKey(context));
          },
          () => this.current(context)
        ),
      merge: async (context, progress, signal) => {
        if (this.current(context))
          for (const [key] of AchievementMemoryStore.all())
            if (key.startsWith("epic:"))
              AchievementMemoryStore.delete("epic", key.slice("epic:".length));
        const result = await mergeWithRemoteGames(
          progress,
          context.auth,
          context.connection.connectionId,
          () => this.current(context),
          { signal, timeout: EPIC_HYDRA_TIMEOUT_MS }
        );
        if (result && !signal.aborted) await this.connection();
        if (result && !signal.aborted && this.current(context))
          void this.importEpicStoreInstallations();
        return result;
      },
      emit: (state) => this.send("on-epic-sync-progress", state),
      finished: (result) => {
        this.send("on-epic-sync-finished", result);
        this.send("on-library-batch-complete");
      },
    });
  }
  private importEpicStoreInstallations() {
    return scheduleEpicStoreAutoImport({
      listInstallations: (signal) => listEpicStoreInstallations(signal),
      listGames: () => gamesSublevel.values().all(),
      hasDownload: async (objectId) =>
        Boolean(
          await downloadsSublevel.get(`epic:${objectId}`).catch(() => undefined)
        ),
      importInstallation: (objectId, store, signal) =>
        getEpicDownloadService().importStoreInstallation(
          objectId,
          store,
          signal
        ),
      afterImported: () => this.send("on-library-batch-complete"),
      warn: (message, details) => logger.warn(message, details),
    });
  }
  private send(channel: string, data?: unknown) {
    for (const window of WindowManager.appWindows)
      if (window && !window.isDestroyed())
        window.webContents.send(channel, data);
  }
  current(context: EpicSyncContext) {
    const state = this.peek();
    return (
      HydraApi.isAuthContextCurrent(context.auth) &&
      state?.verification === "confirmed" &&
      !state.operation &&
      state.connection?.connected === true &&
      state.connection.connectionId === context.connection.connectionId &&
      state.connection.epicAccountId === context.connection.epicAccountId
    );
  }
  /** Previously linked private cache is sufficient only for explicit offline launch. */
  currentLocal(context: EpicSyncContext) {
    const state = this.peek();
    return (
      HydraApi.isAuthContextCurrent(context.auth) &&
      state?.hydraUserId === context.auth.userId &&
      !state.operation &&
      state.connection?.connected === true &&
      state.connection.connectionId === context.connection.connectionId &&
      state.connection.epicAccountId === context.connection.epicAccountId
    );
  }
  captureLocal(): EpicSyncContext | null {
    const auth = HydraApi.getAuthContext();
    const state = this.peek();
    if (!auth || !state?.connection?.connected) return null;
    const context = { auth, connection: state.connection };
    return this.currentLocal(context) ? context : null;
  }
  async capture(): Promise<EpicSyncContext> {
    const auth = HydraApi.getAuthContext();
    if (!auth) throw new EpicIntegrationError("hydra-auth-required");
    const state = await this.connection();
    if (
      !HydraApi.isAuthContextCurrent(auth) ||
      state.verification !== "confirmed" ||
      !state.connection?.connected
    )
      throw new EpicIntegrationError("stale-connection");
    if (state.operation)
      throw new EpicIntegrationError("operation-in-progress");
    return { auth, connection: state.connection };
  }
  async start(connectionId: unknown, trigger: EpicSyncTrigger = "MANUAL") {
    if (
      typeof connectionId !== "string" ||
      !EPIC_CONNECTION_ID_PATTERN.test(connectionId)
    )
      throw new EpicIntegrationError("stale-connection");
    return this.orchestrator.start(connectionId, trigger);
  }
  async startup(firstLink = false) {
    try {
      const context = await this.capture();
      const key = JSON.stringify([
        context.auth.environment,
        context.auth.userId,
        context.auth.generation,
        context.connection.connectionId,
      ]);
      if (this.attemptedStartup.has(key)) return;
      this.attemptedStartup.add(key);
      await this.start(
        context.connection.connectionId,
        firstLink ? "FIRST_LINK" : "STARTUP"
      );
    } catch {
      /* Automatic sync leaves errors on the integration card. */
    }
  }
  async authenticated(firstLink: boolean) {
    const auth = HydraApi.getAuthContext();
    const state = this.peek();
    if (!auth || !state?.connection?.connected) return;
    this.source.invalidate();
    this.attemptedStartup.delete(
      JSON.stringify([
        auth.environment,
        auth.userId,
        auth.generation,
        state.connection.connectionId,
      ])
    );
    this.orchestrator.resetState(auth.userId);
    await this.startup(firstLink);
  }
  invalidate() {
    this.source.invalidate();
    for (const [key] of AchievementMemoryStore.all())
      if (key.startsWith("epic:"))
        AchievementMemoryStore.delete("epic", key.slice("epic:".length));
    this.aliases.clear();
    for (const entry of this.individual.values()) entry.controller.abort();
    for (const id of this.exitTimers.keys()) this.cancelExit(id);
    void this.orchestrator.abortAndWait();
  }
  async stop() {
    this.invalidate();
    await this.orchestrator.abortAndWait();
    await Promise.allSettled(
      [...this.individual.values()].map((entry) => entry.promise)
    );
  }
  async ownGame(
    context: EpicSyncContext,
    objectId: string,
    signal: AbortSignal
  ): Promise<OwnGame | null> {
    const result = await HydraApi.get<OwnGame>(
      `/profile/games/epic/${encodeURIComponent(objectId)}`,
      undefined,
      {
        authContext: context.auth,
        signal,
        timeout: EPIC_HYDRA_TIMEOUT_MS,
        logResponseBody: false,
      }
    );
    if (
      !this.current(context) ||
      result.shop !== "epic" ||
      result.objectId !== objectId ||
      !result.hasActiveEpicImport ||
      !result.epicImport ||
      result.epicImport.connectionId !== context.connection.connectionId ||
      !Array.isArray(result.epicImport.artifactIds) ||
      !result.epicImport.artifactIds.length ||
      !result.epicImport.artifactIds.every(
        (id) => typeof id === "string" && id.length > 0
      )
    )
      return null;
    this.aliases.set(objectId, {
      context,
      artifactIds: result.epicImport.artifactIds,
    });
    return result;
  }
  async syncGame(
    objectId: string,
    fresh = false,
    previous?: number
  ): Promise<number | null> {
    if (!isEpicObjectId(objectId)) return null;
    const context = await this.capture();
    const key = JSON.stringify([
      context.auth,
      context.connection.connectionId,
      objectId,
    ]);
    const existing = this.individual.get(key);
    if (existing) {
      if (!fresh) return existing.promise;
      await existing.promise.catch(() => undefined);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EPIC_SYNC_TIMEOUT_MS);
    const promise = (async () => {
      await this.orchestrator.wait();
      if (!this.current(context) || controller.signal.aborted) return null;
      const key = levelKeys.game("epic", objectId);
      const game = await gamesSublevel.get(key);
      if (
        !game ||
        game.isDeleted ||
        !game.hasActiveEpicImport ||
        !matchesEpicImportScope(
          game,
          context.auth,
          context.connection.connectionId
        )
      )
        return null;
      const owned = await this.ownGame(context, objectId, controller.signal);
      if (!owned?.epicImport) return null;
      const times = await this.source.get(
        context.auth,
        context.connection,
        controller.signal,
        fresh
      );
      const seconds = getEpicGamePlaytime(owned.epicImport.artifactIds, times);
      if (seconds === null || !this.current(context)) return null;
      if (seconds !== previous)
        await HydraApi.put(
          `${EPIC_ENDPOINT}/games/${encodeURIComponent(objectId)}`,
          {
            connectionId: context.connection.connectionId,
            artifactIds: owned.epicImport.artifactIds,
            playTimeInSeconds: seconds,
          },
          {
            authContext: context.auth,
            signal: controller.signal,
            timeout: EPIC_HYDRA_TIMEOUT_MS,
            logResponseBody: false,
          }
        );
      const hydraRevision = getHydraPlaytimeRevision(key);
      const remote = await this.ownGame(context, objectId, controller.signal);
      if (!remote) return null;
      await libraryWriteQueue.run(
        async () => {
          const latest = await gamesSublevel.get(key);
          if (
            !latest ||
            latest.isDeleted ||
            !matchesEpicImportScope(
              latest,
              context.auth,
              context.connection.connectionId
            )
          )
            return;
          const merged = mergeImportedProfileGame(latest, remote);
          if (getHydraPlaytimeRevision(key) !== hydraRevision) {
            merged.playTimeInMilliseconds = latest.playTimeInMilliseconds;
            merged.lastTimePlayed = latest.lastTimePlayed;
            merged.hasManuallyUpdatedPlaytime =
              latest.hasManuallyUpdatedPlaytime;
          }
          await gamesSublevel.put(key, merged);
        },
        () => this.current(context)
      );
      this.send("on-library-batch-complete");
      return seconds;
    })().finally(() => {
      clearTimeout(timer);
      if (this.individual.get(key)?.promise === promise)
        this.individual.delete(key);
    });
    this.individual.set(key, { controller, promise });
    return promise;
  }
  async sessionPolicy(game: Game, matchedPath: string) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fallback = resolveEpicSessionPlaytimePolicy(
      false,
      false,
      game.enableHydraPlaytimeTracking === true
    );
    try {
      return await Promise.race([
        this.resolveSessionPolicy(game, matchedPath, controller.signal),
        new Promise<typeof fallback>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(fallback);
          }, EPIC_IMPORT_LOOKUP_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  private async resolveSessionPolicy(
    game: Game,
    matchedPath: string,
    signal: AbortSignal
  ) {
    let confirmed = false;
    let active = false;
    const auth = HydraApi.getAuthContext();
    const state = this.peek();
    const context =
      auth && state?.verification === "confirmed" && state.connection?.connected
        ? { auth, connection: state.connection }
        : null;
    if (
      context &&
      matchesEpicImportScope(
        game,
        context.auth,
        context.connection.connectionId
      )
    ) {
      let artifacts: string[] | undefined;
      try {
        const own = await this.ownGame(context, game.objectId, signal);
        artifacts = own?.epicImport?.artifactIds;
        active = !!artifacts;
      } catch (error) {
        if (
          !(
            isRecord(error) &&
            isRecord(error.response) &&
            error.response.status === 404
          )
        ) {
          const cached = this.aliases.get(game.objectId);
          if (cached && this.current(cached.context)) {
            artifacts = cached.artifactIds;
            active = game.hasActiveEpicImport === true;
          }
        }
      }
      if (active && artifacts)
        confirmed = await isEpicInstallExecutable(
          game.objectId,
          artifacts,
          matchedPath,
          game.winePrefixPath,
          signal,
          game.epicInstallation &&
            epicOwnerMatches(game.epicInstallation.owner, {
              environment: context.auth.environment,
              userId: context.auth.userId,
              epicAccountId: context.connection.epicAccountId,
            })
            ? [
                managedWorkspacePath(
                  this.userData,
                  game.epicInstallation.owner,
                  game.epicInstallation.artifactId,
                  game.epicInstallation.platform
                ),
              ]
            : []
        );
    }
    return resolveEpicSessionPlaytimePolicy(
      active && !!context && this.current(context),
      confirmed && !signal.aborted,
      game.enableHydraPlaytimeTracking === true
    );
  }
  cancelExit(objectId: string) {
    const entry = this.exitTimers.get(objectId);
    if (entry) {
      entry.cancelled = true;
      for (const timer of entry.timers) clearTimeout(timer);
    }
    this.exitTimers.delete(objectId);
    for (const [key, task] of this.individual)
      if (key.endsWith(`${JSON.stringify(objectId)}]`)) task.controller.abort();
  }
  scheduleExit(game: Game) {
    this.cancelExit(game.objectId);
    const entry: {
      timers: ReturnType<typeof setTimeout>[];
      cancelled: boolean;
      first?: Promise<number | null>;
    } = { timers: [], cancelled: false };
    entry.timers = EPIC_EXIT_SYNC_DELAYS_MS.map((delay, index) =>
      setTimeout(() => {
        if (entry.cancelled) return;
        if (!index) {
          entry.first = this.syncGame(game.objectId, true).catch(() => null);
        } else {
          void (async () => {
            const previous = await entry.first;
            if (entry.cancelled) return;
            await this.syncGame(
              game.objectId,
              true,
              previous ?? undefined
            ).catch(() => null);
            if (this.exitTimers.get(game.objectId) === entry)
              this.exitTimers.delete(game.objectId);
          })();
        }
      }, delay)
    );
    this.exitTimers.set(game.objectId, entry);
  }
}
