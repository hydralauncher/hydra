import { Notification, app, nativeImage } from "electron";
import { t } from "i18next";
import { parseICO } from "icojs";
import trayIcon from "@resources/tray-icon.png?asset";
import { Game } from "@main/entity";
import { gameRepository, userPreferencesRepository } from "@main/repository";
import axios from "axios";
import fs from "node:fs";
import path from "node:path";

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

export const publishNewRepacksNotifications = async (count: number) => {
  const userPreferences = await userPreferencesRepository.findOne({
    where: { id: 1 },
  });

  if (userPreferences?.repackUpdatesNotificationsEnabled) {
    new Notification({
      title: t("repack_list_updated", {
        ns: "notifications",
      }),
      body: t("repack_count", {
        ns: "notifications",
        count: count,
      }),
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

const downloadImage = async (url: string, iconPath: string) => {
  const response = await axios.get(url, { responseType: "stream" });
  const writer = fs.createWriteStream(iconPath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
};

export const publishNewAchievementNotification = async (
  game: string,
  name: string,
  iconUrl: string
) => {
  const iconPath = path.join(
    app.getPath("temp"),
    iconUrl.split("/").pop() || "image.jpg"
  );

  await downloadImage(iconUrl, iconPath);

  new Notification({
    title: t("game_achievement_unlocked", {
      ns: "notifications",
      game,
    }),
    body: name,
    icon: iconPath,
  }).show();
};

export const publishNewFriendRequestNotification = async () => {};
