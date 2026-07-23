import { Notification } from "electron";
import { t } from "i18next";
import trayIcon from "@resources/tray-icon.png?asset";
import fs from "node:fs";
import axios from "axios";
import path from "node:path";
import sound from "sound-play";
import { achievementSoundPath } from "@main/constants";
import icon from "@resources/icon.png?asset";
import { NotificationOptions, toXmlString } from "./xml";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import type { Game, UserPreferences, UserProfile } from "@types";
import { db, levelKeys, themesSublevel } from "@main/level";
import { restartAndInstallUpdate } from "@main/events/autoupdater/restart-and-install-update";
import { SystemPath } from "../system-path";
import { getThemeSoundPath } from "@main/helpers";
import { LocalNotificationManager } from "./local-notifications";
import {
  buildDownloadFileName,
  transcodeNotificationIcon,
} from "./notification-icon";

const getStaticImage = async (imagePath: string) => {
  try {
    return await transcodeNotificationIcon(
      imagePath,
      SystemPath.getPath("temp")
    );
  } catch (error) {
    logger.error("Failed to transcode notification icon", imagePath, error);
    return undefined;
  }
};

async function downloadImage(url: string | null, signal?: AbortSignal) {
  if (signal?.aborted) return undefined;
  if (!url) return undefined;
  if (!url.startsWith("http")) return undefined;

  const fileName = buildDownloadFileName(url);
  const outputPath = path.join(SystemPath.getPath("temp"), fileName);
  const writer = fs.createWriteStream(outputPath);

  const response = await axios.get(url, {
    responseType: "stream",
    signal,
  });

  return new Promise<string | undefined>((resolve) => {
    let settled = false;
    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => {
      writer.destroy();
      finish(undefined);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    writer.on("finish", async () => {
      const staticImagePath = await getStaticImage(outputPath);
      finish(signal?.aborted ? undefined : staticImagePath);
    });
    writer.on("error", () => {
      if (!signal?.aborted) logger.error("Failed to download image", { url });
      finish(undefined);
    });
    response.data.pipe(writer);
  });
}

async function getAchievementSoundPath(): Promise<string> {
  try {
    const allThemes = await themesSublevel.values().all();
    const activeTheme = allThemes.find((theme) => theme.isActive);

    if (activeTheme?.hasCustomSound) {
      const themeSoundPath = getThemeSoundPath(
        activeTheme.id,
        activeTheme.name
      );
      if (themeSoundPath) {
        return themeSoundPath;
      }
    }
  } catch (error) {
    logger.error("Failed to get theme sound path", error);
  }

  return achievementSoundPath;
}

export const publishDownloadCompleteNotification = async (game: Game) => {
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  const title = t("download_complete", { ns: "notifications" });
  const body = t("game_ready_to_install", {
    ns: "notifications",
    title: game.title,
  });

  if (userPreferences?.downloadNotificationsEnabled) {
    new Notification({
      title,
      body,
      icon: await downloadImage(game.iconUrl),
    }).show();
  }

  // Create local notification
  await LocalNotificationManager.createNotification(
    "DOWNLOAD_COMPLETE",
    title,
    body,
    {
      pictureUrl: game.iconUrl,
      url: `/game/${game.shop}/${game.objectId}`,
    }
  );
};

export const publishNotificationUpdateReadyToInstall = async (
  version: string
) => {
  const title = t("new_update_available", {
    ns: "notifications",
    version,
  });
  const body = t("restart_to_install_update", {
    ns: "notifications",
  });

  new Notification({
    title,
    body,
    icon: trayIcon,
  })
    .on("click", () => {
      restartAndInstallUpdate();
    })
    .show();

  // Create local notification
  await LocalNotificationManager.createNotification(
    "UPDATE_AVAILABLE",
    title,
    body
  );
};

export const publishNewFriendRequestNotification = async (
  user: UserProfile,
  signal?: AbortSignal
) => {
  if (signal?.aborted) return;
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (signal?.aborted) return;
  if (!userPreferences?.friendRequestNotificationsEnabled) return;

  const notificationIcon =
    (user?.profileImageUrl
      ? await downloadImage(user.profileImageUrl, signal)
      : undefined) ?? trayIcon;
  if (signal?.aborted) return;

  new Notification({
    title: t("new_friend_request_title", {
      ns: "notifications",
    }),
    body: t("new_friend_request_description", {
      ns: "notifications",
      displayName: user.displayName,
    }),
    icon: notificationIcon,
  }).show();
};

export const publishFriendStartedPlayingGameNotification = async (
  friend: UserProfile,
  signal?: AbortSignal
) => {
  if (signal?.aborted) return;
  const notificationIcon =
    (friend?.profileImageUrl
      ? await downloadImage(friend.profileImageUrl, signal)
      : undefined) ?? trayIcon;
  if (signal?.aborted) return;

  new Notification({
    title: t("friend_started_playing_game", {
      ns: "notifications",
      displayName: friend.displayName,
    }),
    body: friend?.currentGame?.title,
    icon: notificationIcon,
  }).show();
};

export const publishCombinedNewAchievementNotification = async (
  achievementCount,
  gameCount
) => {
  const options: NotificationOptions = {
    title: t("achievement_unlocked", { ns: "achievement" }),
    body: t("new_achievements_unlocked", {
      ns: "achievement",
      gameCount,
      achievementCount,
    }),
    icon,
    silent: true,
  };

  new Notification({
    ...options,
    toastXml: toXmlString(options),
  }).show();

  if (WindowManager.mainWindow) {
    WindowManager.mainWindow.webContents.send("on-achievement-unlocked");
  } else if (process.platform !== "linux") {
    const soundPath = await getAchievementSoundPath();
    sound.play(soundPath);
  }
};

export const publishExtractionCompleteNotification = async (game: Game) => {
  const title = t("extraction_complete", { ns: "notifications" });
  const body = t("game_extracted", {
    ns: "notifications",
    title: game.title,
  });

  new Notification({
    title,
    body,
    icon: trayIcon,
  }).show();

  // Create local notification
  await LocalNotificationManager.createNotification(
    "EXTRACTION_COMPLETE",
    title,
    body,
    {
      pictureUrl: game.iconUrl,
      url: `/game/${game.shop}/${game.objectId}`,
    }
  );
};

export const publishNewAchievementNotification = async (info: {
  achievements: { title: string; iconUrl: string }[];
  unlockedAchievementCount: number;
  totalAchievementCount: number;
  gameTitle: string;
  gameIcon: string | null;
}) => {
  const partialOptions =
    info.achievements.length > 1
      ? {
          title: t("achievements_unlocked_for_game", {
            ns: "achievement",
            gameTitle: info.gameTitle,
            achievementCount: info.achievements.length,
          }),
          body: info.achievements.map((a) => a.title).join(", "),
          icon: (await downloadImage(info.gameIcon)) ?? icon,
        }
      : {
          title: t("achievement_unlocked", { ns: "achievement" }),
          body: info.achievements[0].title,
          icon: (await downloadImage(info.achievements[0].iconUrl)) ?? icon,
        };

  const options: NotificationOptions = {
    ...partialOptions,
    silent: true,
    progress: {
      value: info.unlockedAchievementCount / info.totalAchievementCount,
      valueOverride: t("achievement_progress", {
        ns: "achievement",
        unlockedCount: info.unlockedAchievementCount,
        totalCount: info.totalAchievementCount,
      }),
    },
  };

  new Notification({
    ...options,
    toastXml: toXmlString(options),
  }).show();

  if (WindowManager.mainWindow) {
    WindowManager.mainWindow.webContents.send("on-achievement-unlocked");
  } else if (process.platform !== "linux") {
    const soundPath = await getAchievementSoundPath();
    sound.play(soundPath);
  }
};
