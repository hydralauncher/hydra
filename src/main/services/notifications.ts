import { Notification, app, nativeImage } from "electron";
import { t } from "i18next";
import { parseICO } from "icojs";
import trayIcon from "@resources/tray-icon.png?asset";
import { Game } from "@main/entity";
import { gameRepository, userPreferencesRepository } from "@main/repository";
import { Toast } from "powertoast";
import fs from "node:fs";
import axios from "axios";
import path from "node:path";
import sound from "sound-play";

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

export const publishNewAchievementNotification = async (achievement: {
  displayName: string;
  icon: string;
}) => {
  const iconPath = await downloadImage(achievement.icon);

  new Toast({
    aumid: "gg.hydralauncher.hydra",
    title: "New achievement unlocked",
    message: achievement.displayName,
    icon: iconPath,
    silent: true,
    progress: {
      value: 30,
      valueOverride: "30/100 achievements",
    },
  }).show();

  const audioPath = path.join(app.getAppPath(), "resources", "achievement.wav");

  console.log(audioPath);
  sound.play(audioPath);
};
