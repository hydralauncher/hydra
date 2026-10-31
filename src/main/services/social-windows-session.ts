import type {
  SocialWindowsBounds,
  SocialWindowsSession,
  UserPreferences,
} from "@types";

import { db, levelKeys } from "@main/level";
import { HydraApi } from "./hydra-api";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import { FriendsSnapshotCache } from "./friends-snapshot";
import { getSocialWindowsRestorePlan } from "./social-windows-restore-plan";

export const saveSocialWindowsSession = async () => {
  if (!HydraApi.isLoggedIn()) return;

  try {
    await WindowManager.saveOpenSocialWindowsBounds();
    await db.put<string, SocialWindowsSession>(
      levelKeys.socialWindowsSession,
      WindowManager.getSocialWindowsSession(),
      { valueEncoding: "json" }
    );
  } catch (error) {
    logger.error("Failed to save the friends and chat windows", error);
  }
};

export const loadSocialWindowsBounds = async () => {
  const bounds = await db
    .get<string, SocialWindowsBounds | null>(levelKeys.socialWindowsBounds, {
      valueEncoding: "json",
    })
    .catch(() => null);

  WindowManager.setSocialWindowsBounds(bounds);
};

const readSavedSession = () =>
  db
    .get<
      string,
      Partial<SocialWindowsSession> | null
    >(levelKeys.socialWindowsSession, { valueEncoding: "json" })
    .catch(() => null);

export const restoreSocialWindows = async () => {
  const [session, userPreferences] = await Promise.all([
    readSavedSession(),
    db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null),
  ]);

  if (!HydraApi.isLoggedIn()) return;

  await db.del(levelKeys.socialWindowsSession).catch(() => undefined);

  const plan = getSocialWindowsRestorePlan(session, userPreferences);
  if (plan.showOrder.length === 0) return;

  if (plan.openFriendsWindow) void FriendsSnapshotCache.prefetch();

  const windowsReady = Promise.all([
    plan.openFriendsWindow
      ? WindowManager.openFriendsWindow({ deferShow: true })
      : null,
    plan.chatFriends.length > 0
      ? WindowManager.restoreChatWindow(
          plan.chatFriends,
          plan.activeChatFriendId,
          { deferShow: true }
        )
      : null,
  ]);

  const [isMainWindowShown] = await Promise.all([
    WindowManager.waitForMainWindowShown(),
    windowsReady,
  ]);

  if (!isMainWindowShown || WindowManager.isBigPictureOpen()) {
    WindowManager.discardDeferredSocialWindows();
    return;
  }

  for (const kind of plan.showOrder) {
    WindowManager.showDeferredSocialWindow(kind);
  }
};
