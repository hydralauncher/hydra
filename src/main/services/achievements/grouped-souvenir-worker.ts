import {
  achievementSyncCoordinator,
  ACHIEVEMENT_SYNC_REQUEST_TIMEOUT_MS,
} from "./achievement-sync-coordinator";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

import {
  SOUVENIR_RETRY_BASE_DELAY_MS,
  SOUVENIR_RETRY_MAX_DELAY_MS,
  SOUVENIR_TERMINAL_RETENTION_MS,
  SOUVENIR_PAUSED_RETENTION_MS,
  SOUVENIR_SYNC_METADATA_TIMEOUT_MS,
} from "@main/constants";
import {
  db,
  gamesSublevel,
  gamesShopAssetsSublevel,
  gamesArtworkSelectionSublevel,
  levelKeys,
} from "@main/level";
import { composeAssetsWithArtwork } from "@shared";
import type {
  AchievementSouvenirSyncCleanupResult,
  AchievementSouvenirSyncDetails,
  AchievementSouvenirSyncItem,
  AchievementSouvenirSyncRetryResult,
  AchievementSouvenirSyncStatus,
  PendingAchievementSouvenir,
  PendingSouvenirAchievement,
  Game,
  SteamAchievement,
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
  GAME_NOT_FOUND_ERROR_CODE,
  isGroupedSouvenirNetworkFailure,
  isMissingGroupedSouvenirScreenshot,
  isRejectedGroupedSouvenirRequest,
  type GroupedSouvenirFailure,
  type GroupedSouvenirRecoveryAction,
  type GroupedSouvenirRequestStage,
} from "./grouped-souvenir-retry-policy";
import {
  getAchievementSouvenirSyncStatusForOwner,
  prepareAchievementSouvenirForRetry,
} from "./grouped-souvenir-sync-status";
import { getGameAchievementData } from "./get-game-achievement-data";
import { reconcileAchievementMemory as reconcileMemory } from "./reconcile-achievement-memory";
import { buildGroupedSouvenirSyncPayload } from "./grouped-souvenir-payload";
import { buildAchievementSouvenirSyncItem } from "./grouped-souvenir-sync-item";

const CONCURRENT_UPDATE_ATTEMPTS = 3;
const CONCURRENT_UPDATE_RETRY_DELAY_MS = 250;
const INCOMPLETE_UPLOAD_REAUTHORIZE_ATTEMPTS = 3;
const REJECTED_REQUEST_ATTEMPTS = 20;
const AUTOMATIC_RETRY_ATTEMPTS = 200;

const RETENTION_BY_STATUS: Partial<
  Record<PendingAchievementSouvenir["status"], number>
> = {
  terminal: SOUVENIR_TERMINAL_RETENTION_MS,
  paused: SOUVENIR_PAUSED_RETENTION_MS,
};

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

export const getAchievementSouvenirSyncStatus = async () => {
  const ownerId = await getCurrentOwner();
  if (!ownerId) return EMPTY_SYNC_STATUS;

  const souvenirs = await PendingGroupedSouvenirStore.list();
  return getAchievementSouvenirSyncStatusForOwner(souvenirs, ownerId);
};

interface SouvenirSyncMetadata {
  game: Game | null;
  catalogue: SteamAchievement[];
}

const getCleanupAchievementData = async (game: Game) => {
  const fallback = () =>
    AchievementMemoryStore.get(game.shop, game.objectId)?.achievements ?? [];
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SteamAchievement[]>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(fallback());
    }, SOUVENIR_SYNC_METADATA_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      getGameAchievementData(game.objectId, game.shop, true, undefined, {
        signal: controller.signal,
        timeout: SOUVENIR_SYNC_METADATA_TIMEOUT_MS,
      }).catch(fallback),
      deadline,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const getSouvenirSyncMetadata = async (
  gameKey: string
): Promise<SouvenirSyncMetadata> => {
  const game = await gamesSublevel.get(gameKey).catch(() => null);
  if (!game) return { game: null, catalogue: [] };

  const [assets, selection, catalogue] = await Promise.all([
    gamesShopAssetsSublevel.get(gameKey).catch(() => null),
    gamesArtworkSelectionSublevel.get(gameKey).catch(() => null),
    getCleanupAchievementData(game),
  ]);
  const artwork = composeAssetsWithArtwork(assets ?? null, selection);
  return {
    game: { ...game, iconUrl: artwork?.iconUrl ?? game.iconUrl },
    catalogue,
  };
};

export const getAchievementSouvenirSyncDetails = async () => {
  const ownerId = await getCurrentOwner();
  if (!ownerId) return EMPTY_SYNC_DETAILS;

  const souvenirs = await PendingGroupedSouvenirStore.list();
  const ownedSouvenirs = souvenirs
    .filter((souvenir) => souvenir.ownerId === ownerId)
    .toSorted((a, b) => b.capturedAt - a.capturedAt);

  const metadataByGame = new Map<string, Promise<SouvenirSyncMetadata>>();
  const toSyncItem = async (
    souvenir: PendingAchievementSouvenir
  ): Promise<AchievementSouvenirSyncItem> => {
    let metadata = metadataByGame.get(souvenir.gameKey);
    if (!metadata) {
      metadata = getSouvenirSyncMetadata(souvenir.gameKey);
      metadataByGame.set(souvenir.gameKey, metadata);
    }
    const { game, catalogue } = await metadata;
    return buildAchievementSouvenirSyncItem(souvenir, game, catalogue);
  };

  return {
    status: getAchievementSouvenirSyncStatusForOwner(souvenirs, ownerId),
    items: await Promise.all(ownedSouvenirs.map(toSyncItem)),
  } satisfies AchievementSouvenirSyncDetails;
};

const publishAchievementSouvenirSyncStatus = async () => {
  const status = await getAchievementSouvenirSyncStatus();
  WindowManager.sendToAppWindows("on-achievement-souvenir-sync-status", status);
  return status;
};

const isRetryDue = (souvenir: PendingAchievementSouvenir, now: number) => {
  if (souvenir.status !== "pending") return false;
  if (!souvenir.lastAttemptAt) return true;

  return now - souvenir.lastAttemptAt >= getRetryDelay(souvenir.attemptCount);
};

const markSouvenirTerminal = async (
  pending: PendingAchievementSouvenir,
  errorCode: string
) => {
  await PendingGroupedSouvenirStore.put({
    ...pending,
    status: "terminal",
    recoveryMode: undefined,
    recoveryAchievements: undefined,
    pausedSubscriptionExpiresAt: undefined,
    lastErrorCode: errorCode,
    lastAttemptAt: Date.now(),
  });
  achievementsLogger.warn("Stopped grouped souvenir synchronization", {
    clientId: pending.clientId,
    errorCode,
  });
};

const pauseSouvenir = async (
  pending: PendingAchievementSouvenir,
  errorCode: string
) => {
  await PendingGroupedSouvenirStore.put({
    ...pending,
    status: "paused",
    lastErrorCode: errorCode,
  });
  achievementsLogger.warn("Paused grouped souvenir synchronization", {
    clientId: pending.clientId,
    errorCode,
  });
};

const getRetentionExpiresAt = (souvenir: PendingAchievementSouvenir) => {
  const retention = RETENTION_BY_STATUS[souvenir.status];
  if (!retention || !souvenir.lastAttemptAt) return undefined;
  return souvenir.lastAttemptAt + retention;
};

const removeExpiredRecord = async (souvenir: PendingAchievementSouvenir) => {
  try {
    await fs.promises.rm(souvenir.screenshotPath, { force: true });
  } catch (error) {
    achievementsLogger.error(
      "Failed to delete expired grouped souvenir screenshot",
      { clientId: souvenir.clientId, error }
    );
    return;
  }
  await PendingGroupedSouvenirStore.delete(souvenir.clientId);
};

const removeExpiredRecords = async (
  pending: PendingAchievementSouvenir[],
  now: number
) => {
  const isExpired = (souvenir: PendingAchievementSouvenir) => {
    const expiresAt = getRetentionExpiresAt(souvenir);
    return expiresAt !== undefined && now >= expiresAt;
  };
  await Promise.all(pending.filter(isExpired).map(removeExpiredRecord));
  return pending.filter((souvenir) => !isExpired(souvenir));
};

const reconcileAchievementMemory = async (
  response: UpdatedUnlockedAchievements,
  ownerId: string
) => {
  const context = HydraApi.getAuthContext();
  if (context?.userId !== ownerId)
    throw new Error("achievement-sync-context-changed");
  return achievementSyncCoordinator.runMerge(
    levelKeys.game(response.shop, response.objectId),
    (current) => reconcileMemory(response, current),
    () => HydraApi.isAuthContextCurrent(context)
  );
};

const synchronizeAchievements = (
  pending: PendingAchievementSouvenir,
  achievements: PendingSouvenirAchievement[],
  includeSouvenir: boolean
) => {
  const context = HydraApi.getAuthContext();
  if (context?.userId !== pending.ownerId)
    throw new Error("achievement-sync-context-changed");
  return achievementSyncCoordinator.runRequest(
    pending.gameKey,
    () =>
      HydraApi.put<UpdatedUnlockedAchievements>(
        "/profile/games/achievements",
        buildGroupedSouvenirSyncPayload(pending, achievements, includeSouvenir),
        { authContext: context, timeout: ACHIEVEMENT_SYNC_REQUEST_TIMEOUT_MS }
      ),
    () => HydraApi.isAuthContextCurrent(context)
  );
};

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

const getFailureState = (
  pending: PendingAchievementSouvenir,
  errorCode: string,
  error: unknown
) => ({
  lastErrorCode: errorCode,
  lastErrorCount:
    pending.lastErrorCode === errorCode ? (pending.lastErrorCount ?? 0) + 1 : 1,
  rejectedAttemptCount:
    (pending.rejectedAttemptCount ?? 0) +
    (isRejectedGroupedSouvenirRequest(error) ? 1 : 0),
  answeredFailureCount:
    (pending.answeredFailureCount ?? 0) +
    (isGroupedSouvenirNetworkFailure(error) ? 0 : 1),
});

const getLimitedAction = (
  pending: PendingAchievementSouvenir,
  failure: GroupedSouvenirFailure,
  failureState: ReturnType<typeof getFailureState>,
  error: unknown
): GroupedSouvenirRecoveryAction => {
  const startsAchievementOnlyRecovery =
    failure.action === "abandon" && !pending.recoveryMode;
  if (
    failure.action === "terminal" ||
    failure.action === "pause" ||
    startsAchievementOnlyRecovery
  ) {
    return failure.action;
  }
  if (
    isRejectedGroupedSouvenirRequest(error) &&
    failureState.rejectedAttemptCount >= REJECTED_REQUEST_ATTEMPTS
  ) {
    return "terminal";
  }
  if (
    !isGroupedSouvenirNetworkFailure(error) &&
    failureState.answeredFailureCount >= AUTOMATIC_RETRY_ATTEMPTS
  ) {
    return "pause";
  }
  return failure.action;
};

const classifyFailure = (
  pending: PendingAchievementSouvenir,
  error: unknown,
  stage: GroupedSouvenirRequestStage
): {
  failure: GroupedSouvenirFailure;
  failureState: ReturnType<typeof getFailureState>;
} => {
  const failure = getGroupedSouvenirFailure(error, pending.clientId, stage);
  const failureState = getFailureState(pending, failure.code, error);
  const action = getLimitedAction(pending, failure, failureState, error);
  return { failure: { ...failure, action }, failureState };
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
    const { failure, failureState } = classifyFailure(
      pending,
      error,
      "synchronization"
    );
    if (failure.action === "terminal") {
      await markSouvenirTerminal({ ...pending, ...failureState }, failure.code);
      return;
    }
    if (failure.action === "pause") {
      await pauseSouvenir({ ...pending, ...failureState }, failure.code);
      return;
    }
    await PendingGroupedSouvenirStore.put({
      ...pending,
      ...failureState,
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
    pausedSubscriptionExpiresAt: undefined,
    lastAttemptAt: Date.now(),
  });
  achievementsLogger.warn(
    "Synchronized achievements without an abandoned souvenir",
    { clientId: pending.clientId, errorCode: pending.lastErrorCode }
  );

  try {
    await reconcileAchievementMemory(response, pending.ownerId);
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
  const { failure, failureState } = classifyFailure(pending, error, stage);

  if (failure.action === "terminal") {
    await markSouvenirTerminal({ ...pending, ...failureState }, failure.code);
    return;
  } else if (failure.action === "pause") {
    await pauseSouvenir({ ...pending, ...failureState }, failure.code);
    return;
  } else if (failure.action === "reauthorize_same_id") {
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

const getSubscriptionExpiryAtAttempt = async (ownerId: string) => {
  const user = await getCurrentUser().catch(() => null);
  if (user?.id !== ownerId) return null;
  const expiresAt = new Date(user.subscription?.expiresAt ?? 0).getTime();
  return Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null;
};

const processPendingSouvenir = async (
  pending: PendingAchievementSouvenir
): Promise<"synced" | "missing-screenshot" | "failed"> => {
  const attempted: PendingAchievementSouvenir = {
    ...pending,
    attemptCount: pending.attemptCount + 1,
    lastAttemptAt: Date.now(),
    pausedSubscriptionExpiresAt: await getSubscriptionExpiryAtAttempt(
      pending.ownerId
    ),
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
      await reconcileAchievementMemory(response, authorized.ownerId);
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
  private queueChanges: Promise<unknown> = Promise.resolve();

  public serializeQueueChanges<T>(change: () => Promise<T>): Promise<T> {
    const result = this.queueChanges.then(change);
    this.queueChanges = result.catch(() => undefined);
    return result;
  }

  public trigger() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (!this.running) {
      this.running = this.serializeQueueChanges(() => this.run()).finally(
        () => {
          this.running = null;
          void this.scheduleNextRun();
        }
      );
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

  public async resumeAfterSubscriptionRefresh(
    ownerId: string,
    expiresAt: Date | string | null
  ) {
    const expiration = new Date(expiresAt ?? 0).getTime();
    if (
      !HydraApi.isLoggedIn() ||
      expiration <= Date.now() ||
      !Number.isFinite(expiration)
    )
      return;
    const canRun = await this.serializeQueueChanges(async () => {
      const user = await getCurrentUser().catch(() => null);
      if (
        !HydraApi.isLoggedIn() ||
        user?.id !== ownerId ||
        expiration <= Date.now()
      )
        return false;

      const pending = await PendingGroupedSouvenirStore.list();
      for (const souvenir of pending) {
        const rejectedUnderSameSubscription =
          souvenir.pausedSubscriptionExpiresAt === expiration;
        if (
          souvenir.ownerId !== ownerId ||
          souvenir.status !== "paused" ||
          rejectedUnderSameSubscription
        )
          continue;

        await PendingGroupedSouvenirStore.put({
          ...souvenir,
          status: "pending",
          pausedSubscriptionExpiresAt: undefined,
          lastAttemptAt: undefined,
        });
      }
      return true;
    });
    if (canRun) await this.trigger();
  }

  private async run(): Promise<GroupedSouvenirRunResult> {
    if (!HydraApi.isLoggedIn()) return EMPTY_RUN_RESULT;

    const user = await getCurrentUser().catch(() => null);
    if (!user?.id) return EMPTY_RUN_RESULT;

    const now = Date.now();
    const pending = await removeExpiredRecords(
      await PendingGroupedSouvenirStore.list(),
      now
    );
    const result = { ...EMPTY_RUN_RESULT };

    for (const souvenir of pending) {
      if (souvenir.ownerId !== user.id || souvenir.status === "terminal")
        continue;
      const game = await gamesSublevel.get(souvenir.gameKey).catch(() => null);
      if (game?.isDeleted) {
        await markSouvenirTerminal(souvenir, GAME_NOT_FOUND_ERROR_CODE);
        continue;
      }
      if (!isRetryDue(souvenir, now)) continue;
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

    const now = Date.now();
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
      .filter((cleanupAt) => cleanupAt > now)
      .toSorted((a, b) => a - b)[0];
    const nextRunAt = [nextRetryAt, nextTerminalCleanupAt]
      .filter((value): value is number => value !== undefined)
      .toSorted((a, b) => a - b)[0];

    if (nextRunAt === undefined) return;
    const delay = Math.max(0, nextRunAt - now);
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
    let attemptedCount = 0;
    achievementsLogger.info(
      "Manual grouped souvenir synchronization retry started",
      initialStatus
    );

    try {
      let canResumeSubscription = false;
      if (
        souvenirs.some(
          (souvenir) =>
            souvenir.ownerId === ownerId && souvenir.status === "paused"
        )
      ) {
        const { getUserData } = await import("../user/get-user-data");
        const user = await getUserData({
          allowCached: false,
          triggerSouvenirSync: false,
        });
        canResumeSubscription =
          user?.id === ownerId && HydraApi.hasActiveSubscription();
      }
      await groupedSouvenirWorker.serializeQueueChanges(async () => {
        const souvenirs = await PendingGroupedSouvenirStore.list();
        if ((await getCurrentOwner()) !== ownerId) return;
        for (const souvenir of souvenirs) {
          if (
            souvenir.ownerId !== ownerId ||
            souvenir.status === "terminal" ||
            (souvenir.status === "paused" && !canResumeSubscription)
          ) {
            continue;
          }

          attemptedCount += 1;
          await PendingGroupedSouvenirStore.put(
            prepareAchievementSouvenirForRetry({
              ...souvenir,
              status: "pending",
              pausedSubscriptionExpiresAt: undefined,
            })
          );
        }

        await publishAchievementSouvenirSyncStatus();
      });
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

    return groupedSouvenirWorker.serializeQueueChanges(async () => {
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
    });
  };

export const deleteLocalSouvenirAsset = async (souvenirId: string) => {
  const asset = await LocalSouvenirAssetStore.get(souvenirId).catch(() => null);
  if (!asset) return;

  await fs.promises.rm(asset.screenshotPath, { force: true });
  await LocalSouvenirAssetStore.delete(souvenirId);
};

const deletePendingSouvenirs = (
  matches: (souvenir: PendingAchievementSouvenir) => boolean
) =>
  groupedSouvenirWorker.serializeQueueChanges(async () => {
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
  });

export const cancelPendingSouvenirsForGame = (gameKey: string) =>
  deletePendingSouvenirs((souvenir) => souvenir.gameKey === gameKey);

export const cancelPendingSouvenirsForShop = (shop: string) =>
  deletePendingSouvenirs((souvenir) => souvenir.gameKey.startsWith(`${shop}:`));

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
