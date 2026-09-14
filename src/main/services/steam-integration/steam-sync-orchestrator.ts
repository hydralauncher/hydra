import { db, gamesSublevel, levelKeys } from "@main/level";
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
  SteamSyncRunStatus,
  SteamSyncState,
  UnlockedAchievement,
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
  isSteamSourceRateLimited,
  isSteamSyncConflict,
  withSteamSourceRetry,
} from "./steam-source-retry";
import {
  SteamAccountMismatchError,
  SteamPrivateProfileError,
  SteamRateLimitedError,
  SteamSessionRequiredError,
  SteamSyncAbortedError,
  SteamSyncInProgressError,
  SteamSyncRunNotPendingError,
  SteamWebApiHttpError,
  isSteamSyncAbortError,
} from "./steam-sync-errors";
import type { SteamWebApiToken } from "./steam-store-session-config";
import {
  getSteamWebApiToken,
  readSteamCommunitySession,
  type SteamCommunitySession,
} from "./steam-store-session";
import {
  catalogueFromSteamSchema,
  fetchSteamCommunityPlayerAchievements,
  shouldFetchSteamCommunityAchievements,
} from "./steam-community-achievements";
import { AchievementMemoryStore } from "../achievements/achievement-memory-store";
import { mergeUnlockedAchievementLists } from "../achievements/merge-unlocked-achievements";
import {
  fetchSteamFamilyGroupForUser,
  fetchSteamFamilyPlaytimeSummary,
  fetchSteamGameAchievementSchema,
  fetchSteamLastPlayedTimes,
  fetchSteamOwnedGames,
  fetchSteamSharedLibraryApps,
} from "./steam-web-api";
import {
  countSteamFamilyPlaytimeEntries,
  mergeSteamFamilyPlaytimeMaps,
  mergeSteamOwnedAndFamilyGames,
  parseSteamFamilyGroupId,
  parseSteamFamilyPlaytimeByAppId,
  parseSteamLastPlayedTimes,
  parseSteamSharedLibraryApps,
  playtimeMapFromSharedApps,
} from "./steam-family-library";
import { buildSteamSnapshot } from "./steam-sync-snapshot";

const INTEGRATION_ENDPOINT = "/profile/integrations/steam";
const ACHIEVEMENT_FETCH_CONCURRENCY = 8;

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

const steamWebApiErrorBody = (error: unknown): string | null => {
  let body: unknown = null;

  if (error instanceof SteamWebApiHttpError) {
    body = error.body;
  } else if (typeof error === "object" && error !== null && "body" in error) {
    body = (error as { body: unknown }).body;
  }

  if (body == null) return null;

  return typeof body === "string" ? body : JSON.stringify(body);
};

const formatAchievementHttpDetail = (error: unknown, status: number | null) => {
  const message = getHydraApiErrorMessage(error);
  const body = steamWebApiErrorBody(error);
  const extras = [message, body].filter(Boolean);

  if (extras.length === 0) {
    return `HTTP ${status}`;
  }

  return `HTTP ${status}, ${extras.join(", ")}`;
};

const steamUnlocksToLocal = (
  achievements: SteamSourceAchievement[]
): UnlockedAchievement[] =>
  achievements.flatMap((achievement) => {
    if (!achievement.unlocked || !achievement.unlockTime) {
      return [];
    }

    return [
      {
        name: achievement.name,
        unlockTime: Date.parse(achievement.unlockTime),
      },
    ];
  });

const getSteamSyncFailureMessage = (error: unknown): string => {
  if (
    error instanceof SteamPrivateProfileError ||
    error instanceof SteamRateLimitedError ||
    error instanceof SteamSyncRunNotPendingError ||
    error instanceof SteamSessionRequiredError ||
    error instanceof SteamAccountMismatchError
  ) {
    return error.message;
  }

  if (isSteamSourceRateLimited(error)) {
    return "profile/steam-rate-limited";
  }

  return getHydraApiErrorMessage(error) ?? "steam-sync-failed";
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
  private hasEmittedFinished = false;

  getState() {
    return this.state;
  }

  async reconcilePersistedRun(latestSyncRunStatus?: SteamSyncRunStatus | null) {
    if (latestSyncRunStatus === "PENDING") {
      return;
    }

    await clearPersistedSyncRunId();
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

    this.hasEmittedFinished = false;
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
    if (this.hasEmittedFinished) return;

    this.hasEmittedFinished = true;
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

  private async resolveSteamSession(signal: AbortSignal) {
    const status = await HydraApi.get<SteamIntegrationStatus>(
      INTEGRATION_ENDPOINT,
      undefined,
      { signal }
    );

    if (!status.connected) {
      throw new SteamSessionRequiredError();
    }

    const token = await getSteamWebApiToken(signal);
    if (token.steamId64 !== status.steamId64) {
      steamSyncLogger.error(
        "Steam store session does not match linked SteamID64",
        token.steamId64,
        status.steamId64
      );
      throw new SteamAccountMismatchError();
    }

    return token;
  }

  private async fetchLibrary(token: SteamWebApiToken, signal: AbortSignal) {
    steamSyncLogger.log("GET Steam GetOwnedGames");

    try {
      const response = await fetchWithRetry(
        "library",
        () => fetchSteamOwnedGames(token, signal),
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

      const ownedGames = parseSteamSourceLibrary(response);
      const games = await this.mergeFamilyLibrary(ownedGames, token, signal);
      steamSyncLogger.log("Library games found", games.length);
      return games;
    } catch (error) {
      if (
        error instanceof SteamWebApiHttpError &&
        (error.status === 401 || error.status === 403)
      ) {
        throw new SteamSessionRequiredError();
      }

      if (isSteamSourceLibraryFatal(error)) {
        steamSyncLogger.error("Steam library is private");
        throw new SteamPrivateProfileError();
      }

      throw error;
    }
  }

  private async mergeFamilyLibrary(
    ownedGames: SteamSourceLibraryGame[],
    token: SteamWebApiToken,
    signal: AbortSignal
  ) {
    try {
      steamSyncLogger.log("GET Steam GetFamilyGroupForUser");
      const groupPayload = await fetchWithRetry(
        "family group",
        () => fetchSteamFamilyGroupForUser(token, signal),
        signal
      );
      const familyGroupId = parseSteamFamilyGroupId(groupPayload);
      if (!familyGroupId) {
        steamSyncLogger.log("Steam family group not found");
        return ownedGames;
      }

      steamSyncLogger.log("GET Steam GetSharedLibraryApps");
      const sharedPayload = await fetchWithRetry(
        "family library",
        () => fetchSteamSharedLibraryApps(token, familyGroupId, signal),
        signal
      );
      const familyApps = parseSteamSharedLibraryApps(sharedPayload);
      const playtimeSources = [playtimeMapFromSharedApps(familyApps)];

      try {
        steamSyncLogger.log("GET Steam ClientGetLastPlayedTimes");
        const lastPlayedPayload = await fetchWithRetry(
          "last played times",
          () => fetchSteamLastPlayedTimes(token, signal),
          signal
        );
        playtimeSources.push(parseSteamLastPlayedTimes(lastPlayedPayload));
      } catch (error) {
        if (isSteamSyncAbortError(error)) {
          throw error;
        }

        steamSyncLogger.log("Steam last played times unavailable", error);
      }

      try {
        steamSyncLogger.log("GET Steam GetPlaytimeSummary");
        const playtimePayload = await fetchWithRetry(
          "family playtime",
          () => fetchSteamFamilyPlaytimeSummary(token, familyGroupId, signal),
          signal
        );
        playtimeSources.push(
          parseSteamFamilyPlaytimeByAppId(playtimePayload, token.steamId64)
        );
      } catch (error) {
        if (isSteamSyncAbortError(error)) {
          throw error;
        }

        steamSyncLogger.log("Steam family playtime unavailable", error);
      }

      const playtimeByAppId = mergeSteamFamilyPlaytimeMaps(...playtimeSources);
      const games = mergeSteamOwnedAndFamilyGames(
        ownedGames,
        familyApps,
        playtimeByAppId
      );
      steamSyncLogger.log(
        "Family library games found",
        familyApps.length,
        "merged total",
        games.length,
        "with playtime",
        countSteamFamilyPlaytimeEntries(playtimeByAppId)
      );
      return games;
    } catch (error) {
      if (isSteamSyncAbortError(error)) {
        throw error;
      }

      steamSyncLogger.log("Steam family library unavailable", error);
      return ownedGames;
    }
  }

  private async persistLocalAchievementCounts(
    steamAppId: string,
    schemaCount: number,
    unlockedCount: number
  ) {
    const gameKey = levelKeys.game("steam", steamAppId);
    const localGame = await gamesSublevel.get(gameKey).catch(() => undefined);
    if (!localGame) return;

    await gamesSublevel.put(gameKey, {
      ...localGame,
      achievementCount: Math.max(localGame.achievementCount ?? 0, schemaCount),
      unlockedAchievementCount: Math.max(
        localGame.unlockedAchievementCount ?? 0,
        unlockedCount
      ),
    });
  }

  private async fetchAchievements(
    token: SteamWebApiToken,
    communitySession: SteamCommunitySession,
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

          const scrapeCommunity = shouldFetchSteamCommunityAchievements(
            game.playTimeInSeconds
          );

          steamSyncLogger.log(
            `GET Steam achievements ${index + 1}/${games.length}`,
            game.steamAppId,
            game.name,
            scrapeCommunity ? "community" : "schema only"
          );

          let schemaPayload: unknown;
          const loadSchema = async (steamAppId: string) => {
            schemaPayload = await fetchSteamGameAchievementSchema(
              token,
              steamAppId,
              signal
            );
            return schemaPayload;
          };

          const response = scrapeCommunity
            ? await fetchWithRetry(
                `achievements ${game.steamAppId}`,
                () =>
                  fetchSteamCommunityPlayerAchievements({
                    steamId64: token.steamId64,
                    steamAppId: game.steamAppId,
                    signal,
                    communityFetch: communitySession.fetch,
                    timeZoneOffsetSeconds:
                      communitySession.timeZoneOffsetSeconds,
                    loadSchema,
                  }),
                signal
              )
            : { achievements: [] };

          if (schemaPayload == null) {
            try {
              schemaPayload = await loadSchema(game.steamAppId);
            } catch (schemaError) {
              steamSyncLogger.log(
                `Schema unavailable for ${game.steamAppId} ${game.name}`,
                schemaError
              );
            }
          }

          if (response != null && typeof response !== "object") {
            steamSyncLogger.log(
              "Unexpected Steam achievements payload",
              game.steamAppId,
              typeof response
            );
          }

          const achievements = parseSteamSourceAchievements(response);
          const catalogue =
            schemaPayload != null
              ? catalogueFromSteamSchema(game.steamAppId, schemaPayload)
              : [];
          const schemaCount =
            catalogue.length > 0 ? catalogue.length : achievements.length;

          const current = AchievementMemoryStore.get("steam", game.steamAppId);
          const unlockedAchievements = mergeUnlockedAchievementLists(
            steamUnlocksToLocal(achievements),
            current?.unlockedAchievements ?? []
          );

          steamSyncLogger.log(
            `Achievements for ${game.steamAppId} ${game.name}: ${unlockedAchievements.length} unlocked / ${schemaCount}`
          );

          AchievementMemoryStore.set("steam", game.steamAppId, {
            achievements:
              catalogue.length > 0 ? catalogue : (current?.achievements ?? []),
            unlockedAchievements,
            language: current?.language,
            catalogueValidator: current?.catalogueValidator,
          });

          await this.persistLocalAchievementCounts(
            game.steamAppId,
            schemaCount,
            unlockedAchievements.length
          );

          achievementsByAppId.set(game.steamAppId, achievements);
        } catch (error) {
          if (
            error instanceof SteamSessionRequiredError ||
            (error instanceof Error &&
              error.name === "SteamSessionRequiredError")
          ) {
            throw error instanceof SteamSessionRequiredError
              ? error
              : new SteamSessionRequiredError();
          }

          const status = getSteamSourceHttpStatus(error);
          const detail = formatAchievementHttpDetail(error, status);

          if (status === 401) {
            throw new SteamSessionRequiredError();
          }

          if (isSteamSourceAchievementSkippable(error)) {
            steamSyncLogger.log(
              `Skipping achievements for ${game.steamAppId} ${game.name} (${detail})`
            );
            achievementsByAppId.set(game.steamAppId, undefined);

            if (status === 429) {
              rateLimited = true;
              this.setState(idleState());
              this.emitFinished({
                ok: false,
                message: "profile/steam-rate-limited",
              });
            }

            if (status === 409) {
              runGone = true;
            }
          } else {
            steamSyncLogger.error(
              `Failed achievements for ${game.steamAppId} ${game.name} (${detail})`
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

    if (rateLimited) {
      throw new SteamRateLimitedError();
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

      const token = await this.resolveSteamSession(signal);
      throwIfAborted(signal);

      const communitySession = await readSteamCommunitySession();
      if (!communitySession.hasLoginCookie) {
        throw new SteamSessionRequiredError();
      }

      const games = await this.fetchLibrary(token, signal);
      throwIfAborted(signal);

      this.setState({
        status: "running",
        syncRunId,
        phase: "achievements",
        gamesFound: games.length,
        gamesProcessed: 0,
      });

      const achievementsByAppId = await this.fetchAchievements(
        token,
        communitySession,
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

      const message = getSteamSyncFailureMessage(error);

      steamSyncLogger.error("Steam sync failed", message);
      this.setState(idleState());
      this.emitFinished({ ok: false, message });
      if (
        !snapshotPublished &&
        !(error instanceof SteamSyncRunNotPendingError)
      ) {
        await this.cancelPendingRun(syncRunId);
      }
      await clearPersistedSyncRunId();
    }
  }
}

export const steamSyncOrchestrator = new SteamSyncOrchestrator();
