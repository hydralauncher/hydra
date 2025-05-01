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
import type { Game, UserPreferences } from "@types";
import { db, levelKeys } from "@main/level";
import { restartAndInstallUpdate } from "@main/events/autoupdater/restart-and-install-update";
import { SystemPath } from "../system-path";

async function downloadImage(url: string | null) {
  if (!url) return undefined;
  if (!url.startsWith("http")) return undefined;

  const fileName = url.split("/").pop()!;
  const outputPath = path.join(SystemPath.getPath("temp"), fileName);
  const writer = fs.createWriteStream(outputPath);

  const response = await axios.get(url, {
    responseType: "stream",
  });

  response.data.pipe(writer);

  return new Promise<string | undefined>((resolve) => {
    writer.on("finish", () => {
      resolve(outputPath);
    });
    writer.on("error", () => {
      logger.error("Failed to download image", { url });
      resolve(undefined);
    });
  });
}

export const publishDownloadCompleteNotification = async (game: Game) => {
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (userPreferences?.downloadNotificationsEnabled) {
    new Notification({
      title: t("download_complete", {
        ns: "notifications",
      }),
      body: t("game_ready_to_install", {
        ns: "notifications",
        title: game.title,
      }),
      icon: await downloadImage(game.iconUrl),
    }).show();
  }
};

export const publishNotificationUpdateReadyToInstall = async (
  version: string
) => {
  new Notification({
    title: t("new_update_available", {
      ns: "notifications",
      version,
    }),
    body: t("restart_to_install_update", {
      ns: "notifications",
    }),
    icon: trayIcon,
  })
    .on("click", () => {
      restartAndInstallUpdate();
    })
    .show();
};

export const publishNewFriendRequestNotification = async () => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (!userPreferences?.friendRequestNotificationsEnabled) return;

  new Notification({
    title: t("new_friend_request_title", {
      ns: "notifications",
    }),
    body: t("new_friend_request_description", {
      ns: "notifications",
    }),
    icon: trayIcon,
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
    sound.play(achievementSoundPath);
  }
};

export const publishExtractionCompleteNotification = async (game: Game) => {
  new Notification({
    title: t("extraction_complete", { ns: "notifications" }),
    body: t("game_extracted", {
      ns: "notifications",
      title: game.title,
    }),
    icon: trayIcon,
  }).show();
};

export const publishNewAchievementNotification = async (info: {
  achievements: { displayName: string; iconUrl: string }[];
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
          body: info.achievements.map((a) => a.displayName).join(", "),
          icon: (await downloadImage(info.gameIcon)) ?? icon,
        }
      : {
          title: t("achievement_unlocked", { ns: "achievement" }),
          body: info.achievements[0].displayName,
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
    sound.play(achievementSoundPath);
  }
};
