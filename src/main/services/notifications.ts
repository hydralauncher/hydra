import { Notification, app, nativeImage } from "electron";
import { t } from "i18next";
import { parseICO } from "icojs";
import trayIcon from "@resources/tray-icon.png?asset";
import { Game } from "@main/entity";
import { gameRepository, userPreferencesRepository } from "@main/repository";
import { toXmlString } from "powertoast";
import fs from "node:fs";
import axios from "axios";
import path from "node:path";
import sound from "sound-play";
import { achievementSoundPath } from "@main/constants";
import icon from "@resources/icon.png?asset";

const getGameIconNativeImage = async (gameId: number) => {
  try {
    const game = await gameRepository.findOne({
      where: {
        id: gameId,
      },
    });

    if (!game?.iconUrl) return undefined;

    const images = await parseICO(
      Buffer.from(game.iconUrl.split("base64,")[1], "base64")
    );

    const highResIcon = images.find((image) => image.width >= 128);
    if (!highResIcon) return undefined;

    return nativeImage.createFromBuffer(Buffer.from(highResIcon.buffer));
  } catch (err) {
    return undefined;
  }
};

export const publishDownloadCompleteNotification = async (game: Game) => {
  const userPreferences = await userPreferencesRepository.findOne({
    where: { id: 1 },
  });

  const icon = await getGameIconNativeImage(game.id);

  if (userPreferences?.downloadNotificationsEnabled) {
    new Notification({
      title: t("download_complete", {
        ns: "notifications",
      }),
      body: t("game_ready_to_install", {
        ns: "notifications",
        title: game.title,
      }),
      icon,
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
  }).show();
};

export const publishNewFriendRequestNotification = async () => {};

async function downloadImage(url: string) {
  const fileName = url.split("/").pop()!;
  const outputPath = path.join(app.getPath("temp"), fileName);
  const writer = fs.createWriteStream(outputPath);

  const response = await axios.get(url, {
    responseType: "stream",
  });

  response.data.pipe(writer);

  return new Promise<string>((resolve, reject) => {
    writer.on("finish", () => {
      resolve(outputPath);
    });
    writer.on("error", reject);
  });
}

export const publishCombinedNewAchievementNotification = async (
  achievementCount,
  gameCount,
  achievementIcon?: string
) => {
  const iconPath = achievementIcon
    ? await downloadImage(achievementIcon)
    : icon;

  new Notification({
    title: "New achievement unlocked",
    body: t("new_achievements_unlocked", {
      ns: "achievement",
      gameCount,
      achievementCount,
    }),
    icon: iconPath,
    silent: true,
    toastXml: toXmlString({
      title: "New achievement unlocked",
      message: t("new_achievements_unlocked", {
        ns: "achievement",
        gameCount,
        achievementCount,
      }),
      icon: iconPath,
      silent: true,
    }),
  }).show();

  sound.play(achievementSoundPath);
};

export const publishNewAchievementNotification = async (achievement: {
  displayName: string;
  achievementIcon: string;
  unlockedAchievementCount: number;
  totalAchievementCount: number;
}) => {
  const iconPath = await downloadImage(achievement.achievementIcon);

  new Notification({
    title: "New achievement unlocked",
    body: achievement.displayName,
    icon: iconPath,
    silent: true,
    toastXml: toXmlString({
      title: "New achievement unlocked",
      message: achievement.displayName,
      icon: iconPath,
      silent: true,
      progress: {
        value: Math.round(
          (achievement.unlockedAchievementCount * 100) /
            achievement.totalAchievementCount
        ),
        valueOverride: `${achievement.unlockedAchievementCount}/${achievement.totalAchievementCount} achievements`,
      },
    }),
  }).show();

  sound.play(achievementSoundPath);
};
