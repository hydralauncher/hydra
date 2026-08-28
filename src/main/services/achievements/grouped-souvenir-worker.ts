import { randomUUID } from "node:crypto";
import fs from "node:fs";

import {
  SOUVENIR_RETRY_BASE_DELAY_MS,
  SOUVENIR_RETRY_MAX_DELAY_MS,
  SOUVENIR_TERMINAL_RETENTION_MS,
} from "@main/constants";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import type {
  AchievementSouvenirSyncCleanupResult,
  AchievementSouvenirSyncDetails,
  AchievementSouvenirSyncItem,
  AchievementSouvenirSyncRetryResult,
  AchievementSouvenirSyncStatus,
  PendingAchievementSouvenir,
  PendingSouvenirAchievement,
  UpdatedUnlockedAchievements,
  User,
} from "@types";

import { HydraApi } from "../hydra-api";
import { achievementsLogger } from "../logger";
import { ScreenshotService } from "../screenshot";
import { WindowManager } from "../window-manager";
import { AchievementImageService } from "./achievement-image-service";
import { AchievementMemoryStore } from "./achievement-memory-store";
import { AchievementSouvenirStore } from "./achievement-souvenir-store";
import {
  LocalSouvenirAssetStore,
  PendingGroupedSouvenirStore,
} from "./grouped-souvenir-store";
import {
  getGroupedSouvenirFailure,
  isMissingGroupedSouvenirScreenshot,
  type GroupedSouvenirRequestStage,
} from "./grouped-souvenir-retry-policy";
import {
  getAchievementSouvenirSyncStatusForOwner,
  prepareAchievementSouvenirForRetry,
} from "./grouped-souvenir-sync-status";
import { getGameAchievementData } from "./get-game-achievement-data";
import { mergeUnlockedAchievementLists } from "./merge-unlocked-achievements";
import { buildGroupedSouvenirSyncPayload } from "./grouped-souvenir-payload";

const CONCURRENT_UPDATE_ATTEMPTS = 3;
const CONCURRENT_UPDATE_RETRY_DELAY_MS = 250;
const INCOMPLETE_UPLOAD_REAUTHORIZE_ATTEMPTS = 3;

const getRetryDelay = (attemptCount: number) =>
  Math.min(
    SOUVENIR_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attemptCount - 1),
    SOUVENIR_RETRY_MAX_DELAY_MS
  );

const getCurrentUser = () =>
  db.get<string, User>(levelKeys.user, { valueEncoding: "json" });

const EMPTY_SYNC_STATUS: AchievementSouvenirSyncStatus = {
  pendingCount: 0,
  failedCount: 0,
  errorCodes: [],
};

const EMPTY_SYNC_DETAILS: AchievementSouvenirSyncDetails = {
  status: EMPTY_SYNC_STATUS,
  items: [],
};

interface GroupedSouvenirRunResult {
  syncedCount: number;
  missingScreenshotCount: number;
}

const EMPTY_RUN_RESULT: GroupedSouvenirRunResult = {
  syncedCount: 0,
  missingScreenshotCount: 0,
};

const getCurrentOwner = async () => {
  if (!HydraApi.isLoggedIn()) return null;
  return (await getCurrentUser().catch(() => null))?.id ?? null;
};

const getAchievementDisplayNames = async (
  souvenir: PendingAchievementSouvenir
) => {
  const game = await gamesSublevel.get(souvenir.gameKey).catch(() => null);
  const metadata = game
    ? AchievementMemoryStore.get(game.shop, game.objectId)?.achievements
    : null;

  return {
    gameTitle: game?.title ?? null,
    achievementNames: souvenir.achievements.map((achievement) => {
      return (
        metadata?.find((entry) => entry.name === achievement.name)
          ?.displayName ?? achievement.name
      );
    }),
  };
};

const toAchievementSouvenirSyncItem = async (
  souvenir: PendingAchievementSouvenir
): Promise<AchievementSouvenirSyncItem> => {
  const { gameTitle, achievementNames } =
    await getAchievementDisplayNames(souvenir);

  return {
    clientId: souvenir.clientId,
    status: souvenir.status === "terminal" ? "failed" : "pending",
    screenshotPath: souvenir.screenshotPath,
    gameTitle,
    achievementNames,
    capturedAt: souvenir.capturedAt,
    lastErrorCode: souvenir.lastErrorCode,
  };
};

export const getAchievementSouvenirSyncStatus = async () => {
  const ownerId = await getCurrentOwner();
  if (!ownerId) return EMPTY_SYNC_STATUS;

  const souvenirs = await PendingGroupedSouvenirStore.list();
  return getAchievementSouvenirSyncStatusForOwner(souvenirs, ownerId);
};

export const getAchievementSouvenirSyncDetails = async () => {
  const ownerId = await getCurrentOwner();
  if (!ownerId) return EMPTY_SYNC_DETAILS;

  const souvenirs = await PendingGroupedSouvenirStore.list();
  const ownedSouvenirs = souvenirs
    .filter((souvenir) => souvenir.ownerId === ownerId)
    .toSorted((a, b) => b.capturedAt - a.capturedAt);

  return {
    status: getAchievementSouvenirSyncStatusForOwner(souvenirs, ownerId),
    items: await Promise.all(ownedSouvenirs.map(toAchievementSouvenirSyncItem)),
  } satisfies AchievementSouvenirSyncDetails;
};

const publishAchievementSouvenirSyncStatus = async () => {
  const status = await getAchievementSouvenirSyncStatus();
  WindowManager.sendToAppWindows("on-achievement-souvenir-sync-status", status);
  return status;
};

const isRetryDue = (souvenir: PendingAchievementSouvenir, now: number) => {
  if (souvenir.status === "terminal") return false;
  if (!souvenir.lastAttemptAt) return true;

  return now - souvenir.lastAttemptAt >= getRetryDelay(souvenir.attemptCount);
};

const cleanupExpiredTerminalRecords = async (
  pending: PendingAchievementSouvenir[],
  now: number
) => {
  for (const souvenir of pending) {
    if (
      souvenir.status !== "terminal" ||
      !souvenir.lastAttemptAt ||
      now - souvenir.lastAttemptAt < SOUVENIR_TERMINAL_RETENTION_MS
    ) {
      continue;
    }

    await PendingGroupedSouvenirStore.delete(souvenir.clientId);
    await fs.promises
      .rm(souvenir.screenshotPath, { force: true })
      .catch((error) => {
        achievementsLogger.error(
          "Failed to delete expired grouped souvenir screenshot",
          { clientId: souvenir.clientId, error }
        );
      });
  }
};

const reconcileAchievementMemory = async (
  response: UpdatedUnlockedAchievements
) => {
  const current = AchievementMemoryStore.get(response.shop, response.objectId);
  AchievementMemoryStore.set(response.shop, response.objectId, {
    achievements: current?.achievements ?? [],
    unlockedAchievements: mergeUnlockedAchievementLists(
      response.achievements,
      current?.unlockedAchievements ?? []
    ),
    language: current?.language,
    catalogueValidator: current?.catalogueValidator,
  });

  const achievements = await getUnlockedAchievements(
    response.objectId,
    response.shop,
    true
  ).catch(() => null);

  if (achievements) {
    WindowManager.mainWindow?.webContents.send(
      `on-update-achievements-${response.objectId}-${response.shop}`,
      achievements
    );
  }
};

const synchronizeAchievements = (
  pending: PendingAchievementSouvenir,
  achievements: PendingSouvenirAchievement[],
  includeSouvenir: boolean
) =>
  HydraApi.put<UpdatedUnlockedAchievements>(
    "/profile/games/achievements",
    buildGroupedSouvenirSyncPayload(pending, achievements, includeSouvenir)
  );

const waitForConcurrentUpdate = (attempt: number) =>
  new Promise((resolve) => {
    setTimeout(
      resolve,
      CONCURRENT_UPDATE_RETRY_DELAY_MS * Math.max(1, attempt)
    );
  });

const synchronizePendingSouvenir = async (
  pending: PendingAchievementSouvenir
) => {
  for (let attempt = 1; attempt <= CONCURRENT_UPDATE_ATTEMPTS; attempt++) {
    try {
      return await synchronizeAchievements(pending, pending.achievements, true);
    } catch (error) {
      const failure = getGroupedSouvenirFailure(
        error,
        pending.clientId,
        "synchronization"
      );
      if (
        failure.code !== "concurrent_update" ||
        attempt === CONCURRENT_UPDATE_ATTEMPTS
      ) {
        throw error;
      }

      achievementsLogger.warn(
        "Retrying grouped souvenir after a concurrent achievement update",
        { clientId: pending.clientId, attempt }
      );
      await waitForConcurrentUpdate(attempt);
    }
  }

  throw new Error("Concurrent souvenir synchronization retry exhausted");
};

const authorizePendingSouvenir = async (
  attempted: PendingAchievementSouvenir
) => {
  const { authorization, image } =
    await AchievementImageService.authorizeAchievementImage(
      attempted.screenshotPath,
      attempted.remoteGameId,
      attempted.clientId
    );

  const imageKeyChanged = authorization.imageKey !== attempted.imageKey;
  const authorized: PendingAchievementSouvenir = {
    ...attempted,
    imageKey: authorization.imageKey,
    ...(imageKeyChanged && { uploadedAt: undefined }),
  };
  await PendingGroupedSouvenirStore.put(authorized);

  if (
    !authorized.uploadedAt &&
    authorization.status === "pending" &&
    authorization.presignedUrl
  ) {
    await AchievementImageService.uploadAuthorizedAchievementImage(
      authorization.presignedUrl,
      image
    );
    authorized.uploadedAt = Date.now();
    await PendingGroupedSouvenirStore.put(authorized);
  } else if (!authorized.uploadedAt && authorization.status === "pending") {
    throw new Error("Souvenir upload authorization has no upload URL");
  }

  return authorized;
};

const completeAchievementOnlyRecovery = async (
  pending: PendingAchievementSouvenir
) => {
  const recoveryAchievements =
    pending.recoveryAchievements ?? pending.achievements;

  let response: UpdatedUnlockedAchievements;
  try {
    response = await synchronizeAchievements(
      pending,
      recoveryAchievements,
      false
    );
  } catch (error) {
    await PendingGroupedSouvenirStore.put({
      ...pending,
      status: "pending",
      lastAttemptAt: Date.now(),
    });
    achievementsLogger.error(
      "Failed to synchronize achievements without an abandoned souvenir",
      { clientId: pending.clientId, error }
    );
    return;
  }

  await PendingGroupedSouvenirStore.put({
    ...pending,
    status: "terminal",
    recoveryMode: undefined,
    recoveryAchievements: undefined,
    lastAttemptAt: Date.now(),
  });
  achievementsLogger.warn(
    "Synchronized achievements without an abandoned souvenir",
    { clientId: pending.clientId, errorCode: pending.lastErrorCode }
  );

  try {
    await reconcileAchievementMemory(response);
  } catch (error) {
    achievementsLogger.error(
      "Failed to refresh local achievements after abandoning a souvenir",
      { clientId: pending.clientId, error }
    );
  }
};

const prepareAchievementOnlyRecovery = async (
  pending: PendingAchievementSouvenir,
  errorCode: string,
  achievements: PendingSouvenirAchievement[]
) => {
  const recovery: PendingAchievementSouvenir = {
    ...pending,
    status: "pending",
    lastErrorCode: errorCode,
    recoveryMode: "sync_achievements_only",
    recoveryAchievements: achievements,
  };
  await PendingGroupedSouvenirStore.put(recovery);
  await completeAchievementOnlyRecovery(recovery);
};

const getFailureState = (
  pending: PendingAchievementSouvenir,
  errorCode: string
) => ({
  lastErrorCode: errorCode,
  lastErrorCount:
    pending.lastErrorCode === errorCode ? (pending.lastErrorCount ?? 0) + 1 : 1,
});

const getCurrentCatalogueAchievements = async (
  pending: PendingAchievementSouvenir
) => {
  const game = await gamesSublevel.get(pending.gameKey).catch(() => null);
  if (!game) return null;

  const catalogue = await getGameAchievementData(
    game.objectId,
    game.shop,
    false
  ).catch((error) => {
    achievementsLogger.error(
      "Failed to refresh the achievement catalogue for souvenir recovery",
      { clientId: pending.clientId, error }
    );
    return null;
  });
  if (!catalogue) return null;

  const catalogueNames = new Set(
    catalogue.map((achievement) => achievement.name.toUpperCase())
  );
  return pending.achievements.filter((achievement) =>
    catalogueNames.has(achievement.name.toUpperCase())
  );
};

const persistGroupedSouvenirFailure = async (
  pending: PendingAchievementSouvenir,
  error: unknown,
  stage: GroupedSouvenirRequestStage
) => {
  const failure = getGroupedSouvenirFailure(error, pending.clientId, stage);
  const failureState = getFailureState(pending, failure.code);

  if (failure.action === "reauthorize_same_id") {
    await PendingGroupedSouvenirStore.put({
      ...pending,
      imageKey: undefined,
      uploadedAt: undefined,
      status: "pending",
      ...failureState,
    });
  } else if (failure.action === "rotate_id_and_reupload") {
    const rotated = {
      ...pending,
      clientId: randomUUID(),
      imageKey: undefined,
      uploadedAt: undefined,
      status: "pending" as const,
      ...failureState,
    };
    await PendingGroupedSouvenirStore.replaceClientId(
      pending.clientId,
      rotated
    );
  } else if (failure.action === "rebuild") {
    const validAchievements = await getCurrentCatalogueAchievements(pending);
    if (validAchievements === null) {
      await PendingGroupedSouvenirStore.put({
        ...pending,
        status: "pending",
        ...failureState,
      });
    } else if (validAchievements.length === 0) {
      await prepareAchievementOnlyRecovery(
        { ...pending, ...failureState },
        failure.code,
        []
      );
      return;
    } else {
      await PendingGroupedSouvenirStore.put({
        ...pending,
        achievements: validAchievements,
        status: "pending",
        ...failureState,
      });
    }
  } else if (failure.action === "abandon") {
    await prepareAchievementOnlyRecovery(
      { ...pending, ...failureState },
      failure.code,
      pending.achievements
    );
    return;
  } else {
    const shouldReauthorizeIncompleteUpload =
      failure.code === "achievements/souvenir-upload-incomplete" &&
      failureState.lastErrorCount >= INCOMPLETE_UPLOAD_REAUTHORIZE_ATTEMPTS;
    await PendingGroupedSouvenirStore.put({
      ...pending,
      ...(shouldReauthorizeIncompleteUpload && {
        imageKey: undefined,
        uploadedAt: undefined,
      }),
      status: "pending",
      ...failureState,
    });
  }

  achievementsLogger.error("Failed to synchronize grouped souvenir", {
    clientId: pending.clientId,
    action: failure.action,
    errorCode: failure.code,
    error,
  });
};

const processPendingSouvenir = async (
  pending: PendingAchievementSouvenir
): Promise<"synced" | "missing-screenshot" | "failed"> => {
  const attempted: PendingAchievementSouvenir = {
    ...pending,
    attemptCount: pending.attemptCount + 1,
    lastAttemptAt: Date.now(),
  };
  await PendingGroupedSouvenirStore.put(attempted);

  if (attempted.recoveryMode === "sync_achievements_only") {
    await completeAchievementOnlyRecovery(attempted);
    return "failed";
  }

  let requestStage: GroupedSouvenirRequestStage = "authorization";
  try {
    const authorized = await authorizePendingSouvenir(attempted);
    requestStage = "synchronization";
    const response = await synchronizePendingSouvenir(authorized);

    const acknowledgement = response.souvenirs?.find(
      (souvenir) => souvenir.clientId === authorized.clientId
    );
    if (!acknowledgement) {
      throw new Error(
        "Grouped souvenir response did not acknowledge client ID"
      );
    }

    await PendingGroupedSouvenirStore.acknowledge(
      authorized,
      acknowledgement.id
    );

    try {
      const game = await gamesSublevel
        .get(authorized.gameKey)
        .catch(() => null);
      if (game) AchievementSouvenirStore.invalidate(game.shop, game.objectId);
      await reconcileAchievementMemory(response);
      await ScreenshotService.cleanupOldScreenshots();
    } catch (error) {
      achievementsLogger.error(
        "Failed to refresh local state after synchronizing grouped souvenir",
        { clientId: authorized.clientId, error }
      );
    }
    return "synced";
  } catch (error) {
    const failed = await PendingGroupedSouvenirStore.get(
      pending.clientId
    ).catch(() => null);
    if (!failed) return "failed";

    if (isMissingGroupedSouvenirScreenshot(error)) {
      await PendingGroupedSouvenirStore.delete(pending.clientId);
      achievementsLogger.warn(
        "Removed grouped souvenir because its screenshot is missing",
        { clientId: pending.clientId, screenshotPath: pending.screenshotPath }
      );
      return "missing-screenshot";
    }

    await persistGroupedSouvenirFailure(failed, error, requestStage);
    return "failed";
  }
};

class GroupedSouvenirWorker {
  private running: Promise<GroupedSouvenirRunResult> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  public trigger() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
        void this.scheduleNextRun();
      });
    }

    return this.running;
  }

  public stop() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  public waitForIdle() {
    return this.running ?? Promise.resolve(EMPTY_RUN_RESULT);
  }

  private async run(): Promise<GroupedSouvenirRunResult> {
    if (!HydraApi.isLoggedIn()) return EMPTY_RUN_RESULT;

    const user = await getCurrentUser().catch(() => null);
    if (!user?.id) return EMPTY_RUN_RESULT;

    const now = Date.now();
    const pending = await PendingGroupedSouvenirStore.list();
    await cleanupExpiredTerminalRecords(pending, now);
    const result = { ...EMPTY_RUN_RESULT };

    for (const souvenir of pending) {
      if (souvenir.ownerId !== user.id || !isRetryDue(souvenir, now)) continue;
      const outcome = await processPendingSouvenir(souvenir);
      if (outcome === "synced") result.syncedCount += 1;
      if (outcome === "missing-screenshot") {
        result.missingScreenshotCount += 1;
      }
    }

    await publishAchievementSouvenirSyncStatus();
    if (result.syncedCount > 0) {
      WindowManager.sendToAppWindows(
        "on-achievement-souvenir-sync-completed",
        result.syncedCount
      );
    }
    if (result.missingScreenshotCount > 0) {
      WindowManager.sendToAppWindows(
        "on-achievement-souvenir-screenshots-missing",
        result.missingScreenshotCount
      );
    }
    return result;
  }

  private async scheduleNextRun() {
    if (!HydraApi.isLoggedIn()) return;

    const user = await getCurrentUser().catch(() => null);
    if (!user?.id) return;

    const pending = await PendingGroupedSouvenirStore.list();
    const nextRetryAt = pending
      .filter(
        (souvenir) =>
          souvenir.ownerId === user.id && souvenir.status === "pending"
      )
      .map(
        (souvenir) =>
          (souvenir.lastAttemptAt ?? 0) + getRetryDelay(souvenir.attemptCount)
      )
      .toSorted((a, b) => a - b)[0];
    const nextTerminalCleanupAt = pending
      .filter(
        (souvenir) =>
          souvenir.ownerId === user.id &&
          souvenir.status === "terminal" &&
          souvenir.lastAttemptAt !== undefined
      )
      .map(
        (souvenir) => souvenir.lastAttemptAt! + SOUVENIR_TERMINAL_RETENTION_MS
      )
      .toSorted((a, b) => a - b)[0];
    const nextRunAt = [nextRetryAt, nextTerminalCleanupAt]
      .filter((value): value is number => value !== undefined)
      .toSorted((a, b) => a - b)[0];

    if (nextRunAt === undefined) return;
    const delay = Math.max(0, nextRunAt - Date.now());
    this.retryTimer = setTimeout(() => void this.trigger(), delay);
    this.retryTimer.unref?.();
  }
}

export const groupedSouvenirWorker = new GroupedSouvenirWorker();

export const retryAchievementSouvenirSync =
  async (): Promise<AchievementSouvenirSyncRetryResult> => {
    achievementsLogger.info(
      "Manual grouped souvenir synchronization retry requested"
    );

    const ownerId = await getCurrentOwner();
    if (!ownerId) {
      return {
        status: EMPTY_SYNC_STATUS,
        attemptedCount: 0,
        syncedCount: 0,
        missingScreenshotCount: 0,
      };
    }

    await groupedSouvenirWorker.waitForIdle();

    const souvenirs = await PendingGroupedSouvenirStore.list();
    const initialStatus = getAchievementSouvenirSyncStatusForOwner(
      souvenirs,
      ownerId
    );
    const attemptedCount = initialStatus.pendingCount;
    achievementsLogger.info(
      "Manual grouped souvenir synchronization retry started",
      initialStatus
    );

    try {
      for (const souvenir of souvenirs) {
        if (souvenir.ownerId !== ownerId || souvenir.status !== "pending") {
          continue;
        }

        await PendingGroupedSouvenirStore.put(
          prepareAchievementSouvenirForRetry(souvenir)
        );
      }

      await publishAchievementSouvenirSyncStatus();
      const runResult = await groupedSouvenirWorker.trigger();
      const status = await getAchievementSouvenirSyncStatus();
      achievementsLogger.info(
        "Manual grouped souvenir synchronization retry completed",
        status
      );
      return {
        status,
        attemptedCount,
        syncedCount: runResult.syncedCount,
        missingScreenshotCount: runResult.missingScreenshotCount,
      };
    } catch (error) {
      achievementsLogger.error(
        "Manual grouped souvenir synchronization retry failed",
        { initialStatus, error }
      );
      throw error;
    }
  };

export const cleanupAchievementSouvenirSync =
  async (): Promise<AchievementSouvenirSyncCleanupResult> => {
    achievementsLogger.info(
      "Grouped souvenir synchronization cleanup requested"
    );

    const ownerId = await getCurrentOwner();
    if (!ownerId) {
      return {
        status: EMPTY_SYNC_STATUS,
        deletedCount: 0,
        failedFilePaths: [],
      };
    }

    groupedSouvenirWorker.stop();
    await groupedSouvenirWorker.waitForIdle();
    groupedSouvenirWorker.stop();

    const souvenirs = await PendingGroupedSouvenirStore.list();
    const ownedSouvenirs = souvenirs.filter(
      (souvenir) => souvenir.ownerId === ownerId
    );
    const failedFilePaths: string[] = [];

    for (const souvenir of ownedSouvenirs) {
      try {
        await fs.promises.rm(souvenir.screenshotPath, { force: true });
      } catch (error) {
        failedFilePaths.push(souvenir.screenshotPath);
        achievementsLogger.error(
          "Failed to delete grouped souvenir screenshot during cleanup",
          { clientId: souvenir.clientId, error }
        );
      }

      await PendingGroupedSouvenirStore.delete(souvenir.clientId);
    }

    const status = await publishAchievementSouvenirSyncStatus();
    const result = {
      status,
      deletedCount: ownedSouvenirs.length,
      failedFilePaths,
    } satisfies AchievementSouvenirSyncCleanupResult;
    achievementsLogger.info(
      "Grouped souvenir synchronization cleanup completed",
      result
    );
    return result;
  };

export const deleteLocalSouvenirAsset = async (souvenirId: string) => {
  const asset = await LocalSouvenirAssetStore.get(souvenirId).catch(() => null);
  if (!asset) return;

  await fs.promises.rm(asset.screenshotPath, { force: true });
  await LocalSouvenirAssetStore.delete(souvenirId);
};

const deletePendingSouvenirs = async (
  matches: (souvenir: PendingAchievementSouvenir) => boolean
) => {
  const pending = await PendingGroupedSouvenirStore.list();

  for (const souvenir of pending) {
    if (!matches(souvenir)) continue;
    await PendingGroupedSouvenirStore.delete(souvenir.clientId);
    await fs.promises
      .rm(souvenir.screenshotPath, { force: true })
      .catch((error) => {
        achievementsLogger.error(
          "Failed to delete cancelled grouped souvenir screenshot",
          { clientId: souvenir.clientId, error }
        );
      });
  }
};

export const cancelPendingSouvenirsForGame = async (gameKey: string) => {
  const matchesGame = (souvenir: PendingAchievementSouvenir) =>
    souvenir.gameKey === gameKey;

  await deletePendingSouvenirs(matchesGame);
  await groupedSouvenirWorker.waitForIdle();
  await deletePendingSouvenirs(matchesGame);
};

export const cancelPendingSouvenirsForShop = async (shop: string) => {
  const matchesShop = (souvenir: PendingAchievementSouvenir) =>
    souvenir.gameKey.startsWith(`${shop}:`);

  await deletePendingSouvenirs(matchesShop);
  await groupedSouvenirWorker.waitForIdle();
  await deletePendingSouvenirs(matchesShop);
};

export const deleteLocalSouvenirAssetsForGame = async (gameKey: string) => {
  const assets = await LocalSouvenirAssetStore.list();

  for (const asset of assets) {
    if (asset.gameKey !== gameKey) continue;
    await deleteLocalSouvenirAsset(asset.souvenirId).catch((error) => {
      achievementsLogger.error(
        "Failed to delete local grouped souvenir asset during game reset",
        { souvenirId: asset.souvenirId, error }
      );
    });
  }
};

export const deleteLocalSouvenirAssetsForShop = async (shop: string) => {
  const assets = await LocalSouvenirAssetStore.list();

  for (const asset of assets) {
    if (!asset.gameKey.startsWith(`${shop}:`)) continue;
    await deleteLocalSouvenirAsset(asset.souvenirId).catch((error) => {
      achievementsLogger.error(
        "Failed to delete local grouped souvenir asset during integration reset",
        { souvenirId: asset.souvenirId, error }
      );
    });
  }
};
