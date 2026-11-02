import { t } from "i18next";

import { db, levelKeys } from "@main/level";
import { getGameAssets } from "@main/events/catalogue/get-game-assets";
import {
  buildLeaderboardNotificationTarget,
  buildLeaderboardNotificationText,
  GLOBAL_LEADERBOARDS_FEATURE,
  parseLeaderboardNotification,
  type LeaderboardNotificationInfo,
} from "@shared";
import type {
  GameShop,
  Notification,
  NotificationsResponse,
  User,
  UserPreferences,
} from "@types";
import { HydraApi } from "./hydra-api";
import { logger } from "./logger";
import { publishLeaderboardNotification } from "./notifications";
import { WindowManager } from "./window-manager";

const FETCH_TAKE = 20;
const FRESH_MS = 60 * 60 * 1000;
const MAX_SHOWN_KEYS = 100;
const FEATURES_REQUEST_TIMEOUT_MS = 10_000;

const isGlobalLeaderboardsEnabled = (signal: AbortSignal) =>
  HydraApi.get<string[]>("/features", null, {
    needsAuth: false,
    timeout: FEATURES_REQUEST_TIMEOUT_MS,
    signal,
  })
    .then(
      (features) =>
        Array.isArray(features) &&
        features.includes(GLOBAL_LEADERBOARDS_FEATURE)
    )
    .catch((error) => {
      if (!signal.aborted) logger.warn("Could not load feature flags", error);
      return false;
    });

const shownKey = (notification: Notification) =>
  `${notification.id}:${notification.createdAt}`;

const readShownKeys = () =>
  db
    .get<string, string[]>(levelKeys.leaderboardNotificationsShown, {
      valueEncoding: "json",
    })
    .catch(() => [] as string[]);

const gameImageUrl = async (info: LeaderboardNotificationInfo) => {
  if (!info.game) return null;
  const assets = await getGameAssets(
    info.game.objectId,
    info.game.shop as GameShop
  ).catch(() => null);
  return assets?.iconUrl ?? assets?.coverImageUrl ?? null;
};

const showSystemNotification = async (
  notification: Notification,
  info: LeaderboardNotificationInfo,
  signal: AbortSignal
) => {
  const text = buildLeaderboardNotificationText(t, info);
  await publishLeaderboardNotification(
    {
      title: text.title,
      body: text.description,
      imageUrl: await gameImageUrl(info),
    },
    async () => {
      const user = await db
        .get<string, User | null>(levelKeys.user, { valueEncoding: "json" })
        .catch(() => null);
      const target = buildLeaderboardNotificationTarget(
        notification.url,
        info,
        user?.id ?? null
      );
      if (target) WindowManager.focusMainWindowAndNavigate(target);
    },
    signal
  );
};

export const publishLeaderboardNotifications = async (signal: AbortSignal) => {
  if (!(await isGlobalLeaderboardsEnabled(signal)) || signal.aborted) return;

  const [response, preferences, shown] = await Promise.all([
    HydraApi.get<NotificationsResponse>(
      "/profile/notifications",
      { filter: "unread", take: FETCH_TAKE },
      { signal }
    ),
    db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null),
    readShownKeys(),
  ]);
  if (signal.aborted) return;

  const shownKeys = new Set(shown);
  const fresh = response.notifications.flatMap((notification) => {
    const info = parseLeaderboardNotification(notification);
    if (!info?.push || shownKeys.has(shownKey(notification))) return [];
    if (Date.now() - new Date(notification.createdAt).getTime() > FRESH_MS)
      return [];
    return [{ notification, info }];
  });
  if (fresh.length === 0) return;

  const shownLog = [...shown];
  const markShown = (notification: Notification) => {
    shownLog.push(shownKey(notification));
    return db.put<string, string[]>(
      levelKeys.leaderboardNotificationsShown,
      shownLog.slice(-MAX_SHOWN_KEYS),
      { valueEncoding: "json" }
    );
  };

  for (const { notification, info } of fresh) {
    if (signal.aborted) return;
    if (
      info.direction === "down" &&
      preferences?.leaderboardDropNotificationsEnabled === false
    ) {
      await markShown(notification);
      continue;
    }

    if (WindowManager.isMainWindowFocused()) {
      WindowManager.mainWindow?.webContents.send(
        "on-leaderboard-notification",
        notification
      );
      await markShown(notification);
      continue;
    }

    try {
      await showSystemNotification(notification, info, signal);
    } catch (error) {
      logger.error("Failed to show leaderboard notification", error);
      continue;
    }
    if (signal.aborted) return;
    await markShown(notification);
  }
};
