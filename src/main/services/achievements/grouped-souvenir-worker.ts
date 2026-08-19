import fs from "node:fs";

import {
  SOUVENIR_RETRY_BASE_DELAY_MS,
  SOUVENIR_RETRY_MAX_DELAY_MS,
  SOUVENIR_TERMINAL_RETENTION_MS,
} from "@main/constants";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import type {
  PendingAchievementSouvenir,
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
  getGroupedSouvenirErrorCode,
  isTerminalGroupedSouvenirError,
} from "./grouped-souvenir-retry-policy";

const getRetryDelay = (attemptCount: number) =>
  Math.min(
    SOUVENIR_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attemptCount - 1),
    SOUVENIR_RETRY_MAX_DELAY_MS
  );

const getCurrentUser = () =>
  db.get<string, User>(levelKeys.user, { valueEncoding: "json" });

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
    unlockedAchievements: response.achievements,
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

const processPendingSouvenir = async (pending: PendingAchievementSouvenir) => {
  const attempted: PendingAchievementSouvenir = {
    ...pending,
    attemptCount: pending.attemptCount + 1,
    lastAttemptAt: Date.now(),
    lastErrorCode: undefined,
  };
  await PendingGroupedSouvenirStore.put(attempted);

  try {
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

    const response = await HydraApi.put<UpdatedUnlockedAchievements>(
      "/profile/games/achievements",
      {
        id: authorized.remoteGameId,
        achievements: authorized.achievements,
        souvenirs: [
          {
            clientId: authorized.clientId,
            imageKey: authorized.imageKey,
            capturedAt: authorized.capturedAt,
            achievementNames: authorized.achievements.map(
              (achievement) => achievement.name
            ),
          },
        ],
      }
    );

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
  } catch (error) {
    const failed = await PendingGroupedSouvenirStore.get(
      pending.clientId
    ).catch(() => null);
    if (!failed) return;

    const terminal = isTerminalGroupedSouvenirError(error, pending.clientId);

    await PendingGroupedSouvenirStore.put({
      ...failed,
      status: terminal ? "terminal" : "pending",
      lastErrorCode: getGroupedSouvenirErrorCode(error),
    });
    achievementsLogger.error("Failed to synchronize grouped souvenir", {
      clientId: pending.clientId,
      terminal,
      error,
    });
  }
};

class GroupedSouvenirWorker {
  private running: Promise<void> | null = null;
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
    return this.running ?? Promise.resolve();
  }

  private async run() {
    if (!HydraApi.isLoggedIn()) return;

    const user = await getCurrentUser().catch(() => null);
    if (!user?.id) return;

    const now = Date.now();
    const pending = await PendingGroupedSouvenirStore.list();
    await cleanupExpiredTerminalRecords(pending, now);

    for (const souvenir of pending) {
      if (souvenir.ownerId !== user.id || !isRetryDue(souvenir, now)) continue;
      await processPendingSouvenir(souvenir);
    }
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
