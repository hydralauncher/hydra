import type { Game, UserPreferences } from "@types";

import { INTERVALS } from "@main/constants";
import { db, levelKeys } from "@main/level";
import { HydraApi } from "../hydra-api";
import { achievementsLogger } from "../logger";
import { ScreenshotService } from "../screenshot";
import { AchievementImageService } from "../achievements/achievement-image-service";
import { AchievementSouvenirStore } from "../achievements/achievement-souvenir-store";
import {
  RetroAchievementsClient,
  type RetroAchievementsRecentAchievement,
} from "./retro-achievements-client";
import { resolveRetroAchievementsGameId } from "./retro-achievements-sync";

const POLL_WINDOW_IN_MINUTES = 1;
const MAX_UNLOCK_AGE_IN_MS = INTERVALS.retroAchievementsSouvenirWatcher * 3;

const watchers = new Map<string, ReturnType<typeof setInterval>>();

const toMillis = (date?: string) => {
  if (!date) return null;

  const time = new Date(`${date.replace(" ", "T")}Z`).getTime();
  return Number.isNaN(time) ? null : time;
};

const isSouvenirCaptureEnabled = async () => {
  if (process.platform === "linux") return false;
  if (!HydraApi.hasActiveSubscription()) return false;

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  return userPreferences?.enableAchievementSouvenirs === true;
};

const captureSouvenir = async (
  game: Game,
  achievement: RetroAchievementsRecentAchievement,
  unlockTime: number
) => {
  const screenshotPath = await ScreenshotService.captureGameScreenshot(
    game.title,
    achievement.Title
  );

  const imageKey =
    await AchievementImageService.uploadAchievementImage(screenshotPath);

  await HydraApi.put("/profile/games/achievements", {
    id: game.remoteId,
    achievements: [
      {
        name: String(achievement.AchievementID),
        unlockTime,
        imageKey,
      },
    ],
  });

  AchievementSouvenirStore.invalidate(game.shop, game.objectId);

  await ScreenshotService.cleanupOldScreenshots();
};

const pollRecentUnlocks = async (
  game: Game,
  raGameId: number,
  capturedAchievementIds: Set<number>
) => {
  if (!(await isSouvenirCaptureEnabled())) return;

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  const username = userPreferences?.retroAchievementsUsername;
  const webApiKey = userPreferences?.retroAchievementsWebApiKey;

  if (!username || !webApiKey) return;

  const recentAchievements =
    await RetroAchievementsClient.getUserRecentAchievements({
      username,
      webApiKey,
      minutes: POLL_WINDOW_IN_MINUTES,
    });

  for (const achievement of recentAchievements) {
    if (achievement.GameID !== raGameId) continue;
    if (capturedAchievementIds.has(achievement.AchievementID)) continue;

    const unlockTime = toMillis(achievement.Date);

    if (unlockTime === null) continue;
    if (Date.now() - unlockTime > MAX_UNLOCK_AGE_IN_MS) continue;

    capturedAchievementIds.add(achievement.AchievementID);

    await captureSouvenir(game, achievement, unlockTime).catch((error) => {
      achievementsLogger.error(
        "Failed to capture RetroAchievements souvenir",
        game.objectId,
        achievement.AchievementID,
        error
      );
    });
  }
};

export const startRetroAchievementsSouvenirWatcher = async (
  gameKey: string,
  game: Game
) => {
  if (watchers.has(gameKey)) return;
  if (!game.remoteId) return;
  if (!(await isSouvenirCaptureEnabled())) return;

  const raGameId = await resolveRetroAchievementsGameId(
    game.objectId,
    game.shop
  );

  if (!raGameId) return;

  const capturedAchievementIds = new Set<number>();
  let isPolling = false;

  const watcher = setInterval(() => {
    if (isPolling) return;
    isPolling = true;

    pollRecentUnlocks(game, raGameId, capturedAchievementIds)
      .catch((error) => {
        achievementsLogger.error(
          "Failed to poll RetroAchievements unlocks",
          game.objectId,
          error
        );
      })
      .finally(() => {
        isPolling = false;
      });
  }, INTERVALS.retroAchievementsSouvenirWatcher);

  watcher.unref?.();
  watchers.set(gameKey, watcher);
};

export const stopRetroAchievementsSouvenirWatcher = (gameKey: string) => {
  const watcher = watchers.get(gameKey);

  if (!watcher) return;

  clearInterval(watcher);
  watchers.delete(gameKey);
};
