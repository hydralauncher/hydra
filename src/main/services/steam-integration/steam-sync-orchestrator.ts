import { db, levelKeys } from "@main/level";
import { HydraApi } from "../hydra-api";
import { mergeWithRemoteGames } from "../library-sync";
import { steamSyncLogger } from "../logger";
import { WindowManager } from "../window-manager";
import type {
  SteamIntegrationStatus,
  SteamSourceAchievement,
  SteamSourceLibraryGame,
  SteamSnapshotPayload,
  SteamSyncFinishedPayload,
  SteamSyncState,
} from "@types";
import {
  parseSteamSourceAchievements,
  parseSteamSourceLibrary,
} from "./steam-source-payload";
import {
  getSteamSourceHttpStatus,
  isSteamPrivateProfilePayload,
  isSteamSourceAchievementSkippable,
  isSteamSourceLibraryFatal,
  isSteamSyncConflict,
  withSteamSourceRetry,
} from "./steam-source-retry";
import {
  SteamPrivateProfileError,
  SteamSyncAbortedError,
  SteamSyncInProgressError,
  SteamSyncRunNotPendingError,
  isSteamSyncAbortError,
} from "./steam-sync-errors";
import { buildSteamSnapshot } from "./steam-sync-snapshot";

const INTEGRATION_ENDPOINT = "/profile/integrations/steam";
const ACHIEVEMENT_FETCH_CONCURRENCY = 3;

const idleState = (): SteamSyncState => ({ status: "idle" });

const getHydraApiErrorMessage = (error: unknown): string | null => {
  if (typeof error === "object" && error !== null) {
    const response = (error as { response?: { data?: { message?: unknown } } })
      .response;
    const responseMessage = response?.data?.message;

    if (typeof responseMessage === "string") {
      return responseMessage;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return null;
};

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) {
    throw new SteamSyncAbortedError();
  }
};

const persistSyncRunId = async (syncRunId: string) => {
  await db.put(
    levelKeys.steamSyncRun,
    { syncRunId },
    { valueEncoding: "json" }
  );
};

const clearPersistedSyncRunId = async () => {
  try {
    await db.del(levelKeys.steamSyncRun);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "NotFoundError") {
      steamSyncLogger.error("Failed to clear persisted Steam sync run", error);
    }
  }
};

const fetchWithRetry = <T>(
  label: string,
  fn: () => Promise<T>,
  signal: AbortSignal
) =>
  withSteamSourceRetry(fn, {
    signal,
    onRetry: (status, delayMs, failedAttempt) => {
      steamSyncLogger.log(
        `${label} retry ${failedAttempt} after HTTP ${status}, waiting ${delayMs}ms`
      );
    },
  });

const mapPool = async <T, R>(
  items: T[],
  concurrency: number,
  signal: AbortSignal,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    for (;;) {
      throwIfAborted(signal);

      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;

      results[index] = await fn(items[index], index);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  if (workerCount === 0) return results;

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
};

class SteamSyncOrchestrator {
  private state: SteamSyncState = idleState();
  private abortController: AbortController | null = null;
  private runPromise: Promise<void> | null = null;

  getState() {
    return this.state;
  }

  async start() {
    if (this.state.status === "running" || this.state.status === "cancelling") {
      steamSyncLogger.log(
        "Start ignored, sync already",
        this.state.status,
        this.state.syncRunId
      );
      return this.state;
    }

    this.abortController = new AbortController();
    this.setState({
      status: "running",
      syncRunId: "",
      phase: "starting",
      gamesFound: 0,
      gamesProcessed: 0,
    });

    const { signal } = this.abortController;
    this.runPromise = this.run(signal).finally(() => {
      this.runPromise = null;
      this.abortController = null;
    });

    return this.state;
  }

  async cancel() {
    if (this.state.status !== "running") {
      steamSyncLogger.log("Cancel ignored, sync is", this.state.status);
      return;
    }

    const syncRunId = this.state.syncRunId;
    steamSyncLogger.log("Cancel requested", syncRunId || "(no run id yet)");
    this.setState({ status: "cancelling", syncRunId });
    this.abortController?.abort();
    await this.runPromise?.catch(() => {});
  }

  private setState(state: SteamSyncState) {
    this.state = state;
    WindowManager.sendToAppWindows("on-steam-sync-progress", state);
  }

  private emitFinished(payload: SteamSyncFinishedPayload) {
    WindowManager.sendToAppWindows("on-steam-sync-finished", payload);
  }

  private async createOrResumeRun(signal: AbortSignal) {
    steamSyncLogger.log("POST", `${INTEGRATION_ENDPOINT}/sync`);

    try {
      const { syncRunId } = await HydraApi.post<{ syncRunId: string }>(
        `${INTEGRATION_ENDPOINT}/sync`,
        undefined,
        { signal }
      );

      steamSyncLogger.log("Created sync run", syncRunId);
      return syncRunId;
    } catch (error) {
      if (!isSteamSyncConflict(error)) {
        throw error;
      }

      steamSyncLogger.log("POST /sync returned 409, reading latestSyncRun");

      const status = await HydraApi.get<SteamIntegrationStatus>(
        INTEGRATION_ENDPOINT,
        undefined,
        { signal }
      );

      if (
        status.connected &&
        status.latestSyncRun?.status === "PENDING" &&
        status.latestSyncRun.id
      ) {
        steamSyncLogger.log("Resuming PENDING run", status.latestSyncRun.id);
        return status.latestSyncRun.id;
      }

      if (status.connected && status.latestSyncRun?.status === "RUNNING") {
        steamSyncLogger.log(
          "Another Steam sync is RUNNING",
          status.latestSyncRun.id
        );
        throw new SteamSyncInProgressError();
      }

      steamSyncLogger.error("409 without a resumable PENDING run", status);
      throw error;
    }
  }

  private async cancelPendingRun(syncRunId: string) {
    if (!syncRunId) return;

    steamSyncLogger.log("DELETE pending run", syncRunId);

    try {
      await HydraApi.delete(`${INTEGRATION_ENDPOINT}/sync/${syncRunId}`);
      steamSyncLogger.log("Pending run cancelled", syncRunId);
    } catch (error) {
      steamSyncLogger.error("Failed to cancel pending run", syncRunId, error);
    }
  }

  private async fetchLibrary(syncRunId: string, signal: AbortSignal) {
    const path = `${INTEGRATION_ENDPOINT}/sync/${syncRunId}/source/library`;
    steamSyncLogger.log("GET library", path);

    try {
      const response = await fetchWithRetry(
        "library",
        () => HydraApi.get<unknown>(path, undefined, { signal }),
        signal
      );

      if (response != null && typeof response !== "object") {
        steamSyncLogger.log(
          "Unexpected Steam library payload",
          typeof response
        );
      }

      if (isSteamPrivateProfilePayload(response)) {
        throw new SteamPrivateProfileError();
      }

      const games = parseSteamSourceLibrary(response);
      steamSyncLogger.log("Library games found", games.length);
      return games;
    } catch (error) {
      if (isSteamSourceLibraryFatal(error)) {
        steamSyncLogger.error("Steam library is private");
        throw new SteamPrivateProfileError();
      }

      throw error;
    }
  }

  private async fetchAchievements(
    syncRunId: string,
    games: SteamSourceLibraryGame[],
    signal: AbortSignal
  ) {
    const achievementsByAppId = new Map<
      string,
      SteamSourceAchievement[] | undefined
    >();
    let gamesProcessed = 0;
    let rateLimited = false;
    let runGone = false;

    await mapPool(
      games,
      ACHIEVEMENT_FETCH_CONCURRENCY,
      signal,
      async (game, index) => {
        throwIfAborted(signal);

        try {
          if (rateLimited || runGone) {
            steamSyncLogger.log(
              `Skipping achievements for ${game.steamAppId} ${game.name} (HTTP ${runGone ? "409" : "429"})`
            );
            achievementsByAppId.set(game.steamAppId, undefined);
            return;
          }

          const path = `${INTEGRATION_ENDPOINT}/sync/${syncRunId}/source/games/${game.steamAppId}/achievements`;
          steamSyncLogger.log(
            `GET achievements ${index + 1}/${games.length}`,
            game.steamAppId,
            game.name
          );

          const response = await HydraApi.get<unknown>(path, undefined, {
            signal,
          });

          if (response != null && typeof response !== "object") {
            steamSyncLogger.log(
              "Unexpected Steam achievements payload",
              game.steamAppId,
              typeof response
            );
          }

          const achievements = parseSteamSourceAchievements(response);
          const unlocked = achievements.filter(
            (achievement) => achievement.unlocked
          ).length;

          steamSyncLogger.log(
            `Achievements for ${game.steamAppId} ${game.name}: ${unlocked} unlocked / ${achievements.length}`
          );
          achievementsByAppId.set(game.steamAppId, achievements);
        } catch (error) {
          const status = getSteamSourceHttpStatus(error);
          const message = getHydraApiErrorMessage(error);

          if (isSteamSourceAchievementSkippable(error)) {
            steamSyncLogger.log(
              `Skipping achievements for ${game.steamAppId} ${game.name} (HTTP ${status}${message ? `, ${message}` : ""})`
            );
            achievementsByAppId.set(game.steamAppId, undefined);

            if (status === 429) {
              rateLimited = true;
            }

            if (status === 409) {
              runGone = true;
            }
          } else {
            steamSyncLogger.error(
              `Failed achievements for ${game.steamAppId} ${game.name} (HTTP ${status}${message ? `, ${message}` : ""})`
            );
            throw error;
          }
        } finally {
          gamesProcessed += 1;

          if (this.state.status === "running") {
            this.setState({
              ...this.state,
              phase: "achievements",
              gamesFound: games.length,
              gamesProcessed,
            });
          }
        }
      }
    );

    if (runGone) {
      throw new SteamSyncRunNotPendingError();
    }

    return achievementsByAppId;
  }

  private async publishSnapshot(
    syncRunId: string,
    snapshot: SteamSnapshotPayload,
    signal: AbortSignal
  ) {
    throwIfAborted(signal);

    const unlockedCount = snapshot.games.reduce(
      (total, game) => total + game.achievements.length,
      0
    );

    steamSyncLogger.log(
      "PUT snapshot",
      snapshot.games.length,
      "games,",
      unlockedCount,
      "unlocked achievements"
    );

    await HydraApi.put(
      `${INTEGRATION_ENDPOINT}/sync/${syncRunId}/snapshot`,
      snapshot,
      { signal }
    );

    steamSyncLogger.log("Snapshot published");
  }

  private async run(signal: AbortSignal) {
    let syncRunId = "";
    let snapshotPublished = false;

    steamSyncLogger.log("Steam sync started");

    try {
      syncRunId = await this.createOrResumeRun(signal);
      throwIfAborted(signal);

      await persistSyncRunId(syncRunId);
      this.setState({
        status: "running",
        syncRunId,
        phase: "library",
        gamesFound: 0,
        gamesProcessed: 0,
      });

      const games = await this.fetchLibrary(syncRunId, signal);
      throwIfAborted(signal);

      this.setState({
        status: "running",
        syncRunId,
        phase: "achievements",
        gamesFound: games.length,
        gamesProcessed: 0,
      });

      const achievementsByAppId = await this.fetchAchievements(
        syncRunId,
        games,
        signal
      );
      throwIfAborted(signal);

      const snapshot = buildSteamSnapshot(games, achievementsByAppId);
      this.setState({
        status: "running",
        syncRunId,
        phase: "publishing",
        gamesFound: games.length,
        gamesProcessed: games.length,
      });

      await this.publishSnapshot(syncRunId, snapshot, signal);
      snapshotPublished = true;

      steamSyncLogger.log("Merging remote games into local library");
      await mergeWithRemoteGames();
      steamSyncLogger.log("Library merge finished");
      WindowManager.sendToAppWindows("on-library-batch-complete");

      const status =
        await HydraApi.get<SteamIntegrationStatus>(INTEGRATION_ENDPOINT);

      steamSyncLogger.log("Steam sync succeeded", {
        lastSyncedAt:
          status.connected || status.snapshotPreserved
            ? status.lastSyncedAt
            : null,
        latestSyncRun:
          status.connected || status.snapshotPreserved
            ? status.latestSyncRun
            : null,
      });

      await clearPersistedSyncRunId();
      this.setState(idleState());
      this.emitFinished({ ok: true, status });
    } catch (error) {
      const aborted = isSteamSyncAbortError(error);

      if (aborted) {
        steamSyncLogger.log("Steam sync aborted", syncRunId || "(no run id)");
        if (!snapshotPublished) {
          await this.cancelPendingRun(syncRunId);
        }
        await clearPersistedSyncRunId();
        this.setState(idleState());
        this.emitFinished({ ok: false, message: "steam-sync-aborted" });
        return;
      }

      if (error instanceof SteamSyncInProgressError) {
        steamSyncLogger.error("Steam sync already running on the server");
        this.setState(idleState());
        this.emitFinished({ ok: false, message: error.message });
        return;
      }

      const message =
        error instanceof SteamPrivateProfileError ||
        error instanceof SteamSyncRunNotPendingError
          ? error.message
          : (getHydraApiErrorMessage(error) ?? "steam-sync-failed");

      steamSyncLogger.error("Steam sync failed", message);
      if (
        !snapshotPublished &&
        !(error instanceof SteamSyncRunNotPendingError)
      ) {
        await this.cancelPendingRun(syncRunId);
      }
      await clearPersistedSyncRunId();
      this.setState(idleState());
      this.emitFinished({ ok: false, message });
    }
  }
}

export const steamSyncOrchestrator = new SteamSyncOrchestrator();
