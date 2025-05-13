import { registerEvent } from "../register-event";
import type { GameShop, GameStats } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import {
  composeSteamShortcut,
  getSteamLocation,
  getSteamShortcuts,
  getSteamUserId,
  HydraApi,
  logger,
  SystemPath,
  writeSteamShortcuts,
} from "@main/services";
import fs from "node:fs";
import axios from "axios";
import path from "node:path";

const downloadAsset = async (downloadPath: string, url?: string | null) => {
  try {
    if (fs.existsSync(downloadPath)) {
      return downloadPath;
    }

    if (!url) {
      return null;
    }

    fs.mkdirSync(path.dirname(downloadPath), { recursive: true });

    const response = await axios.get(url, { responseType: "arraybuffer" });
    fs.writeFileSync(downloadPath, response.data);

    return downloadPath;
  } catch (error) {
    logger.error("Failed to download asset", error);
    return null;
  }
};

const createSteamShortcut = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (game) {
    if (!game.executablePath) {
      throw new Error("No executable path found for game");
    }

    const { assets } = await HydraApi.get<GameStats>(
      `/games/stats?objectId=${objectId}&shop=${shop}`
    );

    const steamUserId = getSteamUserId();

    if (!steamUserId) {
      logger.error("No Steam user ID found");
      return;
    }

    logger.info("Got Steam user id", steamUserId);

    const steamShortcuts = await getSteamShortcuts(steamUserId);

    if (
      steamShortcuts.some(
        (shortcut) =>
          shortcut.Exe === game.executablePath &&
          shortcut.appname === game.title
      )
    ) {
      return;
    }

    const icon = await downloadAsset(
      path.join(
        SystemPath.getPath("userData"),
        "Icons",
        `${game.shop}-${game.objectId}.ico`
      ),
      assets?.iconUrl
    );

    const newShortcut = composeSteamShortcut(
      game.title,
      game.executablePath,
      icon
    );

    const gridPath = path.join(
      await getSteamLocation(),
      "userdata",
      steamUserId.toString(),
      "config",
      "grid"
    );

    fs.mkdirSync(gridPath, { recursive: true });

    await Promise.allSettled([
      downloadAsset(
        path.join(gridPath, `${newShortcut.appid}_hero.jpg`),
        assets?.libraryHeroImageUrl
      ),
      downloadAsset(
        path.join(gridPath, `${newShortcut.appid}_logo.png`),
        assets?.logoImageUrl
      ),
      downloadAsset(
        path.join(gridPath, `${newShortcut.appid}p.jpg`),
        assets?.coverImageUrl
      ),
      downloadAsset(
        path.join(gridPath, `${newShortcut.appid}.jpg`),
        assets?.libraryImageUrl
      ),
    ]);

    steamShortcuts.push(newShortcut);

    logger.info(newShortcut);
    logger.info("Writing Steam shortcuts", steamShortcuts);

    return writeSteamShortcuts(steamUserId, steamShortcuts);
  }
};

registerEvent("createSteamShortcut", createSteamShortcut);
