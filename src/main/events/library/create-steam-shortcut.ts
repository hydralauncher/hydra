import { registerEvent } from "../register-event";
import type { GameShop, GameStats } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import {
  composeSteamShortcut,
  getSteamLocation,
  getSteamShortcuts,
  getSteamUsersIds,
  HydraApi,
  logger,
  SystemPath,
  writeSteamShortcuts,
} from "@main/services";
import fs from "node:fs";
import axios from "axios";
import path from "node:path";
import { ASSETS_PATH } from "@main/constants";

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

const downloadAssetsFromSteam = async (
  shop: GameShop,
  objectId: string,
  assets: GameStats["assets"]
) => {
  const gameAssetsPath = path.join(ASSETS_PATH, `${shop}-${objectId}`);

  return await Promise.all([
    downloadAsset(path.join(gameAssetsPath, "icon.ico"), assets?.iconUrl),
    downloadAsset(
      path.join(gameAssetsPath, "hero.jpg"),
      assets?.libraryHeroImageUrl
    ),
    downloadAsset(path.join(gameAssetsPath, "logo.png"), assets?.logoImageUrl),
    downloadAsset(
      path.join(gameAssetsPath, "cover.jpg"),
      assets?.coverImageUrl
    ),
    downloadAsset(
      path.join(gameAssetsPath, "library.jpg"),
      assets?.libraryImageUrl
    ),
  ]);
};

const copyAssetIfExists = async (
  sourcePath: string | null,
  destinationPath: string
) => {
  if (sourcePath && fs.existsSync(sourcePath)) {
    logger.info("Copying Steam asset", sourcePath, destinationPath);
    await fs.promises.cp(sourcePath, destinationPath);
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

    const steamUserIds = await getSteamUsersIds();

    if (!steamUserIds.length) {
      logger.error("No Steam user ID found");
      return;
    }

    const [iconImage, heroImage, logoImage, coverImage, libraryImage] =
      await downloadAssetsFromSteam(game.shop, game.objectId, assets);

    const newShortcut = composeSteamShortcut(
      game.title,
      game.executablePath,
      iconImage
    );

    for (const steamUserId of steamUserIds) {
      logger.info("Adding shortcut for Steam user", steamUserId);

      const steamShortcuts = await getSteamShortcuts(steamUserId);

      if (steamShortcuts.some((shortcut) => shortcut.appname === game.title)) {
        continue;
      }

      const gridPath = path.join(
        await getSteamLocation(),
        "userdata",
        steamUserId.toString(),
        "config",
        "grid"
      );

      await fs.promises.mkdir(gridPath, { recursive: true });

      await Promise.all([
        copyAssetIfExists(
          heroImage,
          path.join(gridPath, `${newShortcut.appid}_hero.jpg`)
        ),
        copyAssetIfExists(
          logoImage,
          path.join(gridPath, `${newShortcut.appid}_logo.png`)
        ),
        copyAssetIfExists(
          coverImage,
          path.join(gridPath, `${newShortcut.appid}p.jpg`)
        ),
        copyAssetIfExists(
          libraryImage,
          path.join(gridPath, `${newShortcut.appid}.jpg`)
        ),
      ]);

      steamShortcuts.push(newShortcut);

      logger.info(newShortcut);
      logger.info("Writing Steam shortcuts", steamShortcuts);

      await writeSteamShortcuts(steamUserId, steamShortcuts);
    }

    if (process.platform === "linux" && !game.winePrefixPath) {
      const steamWinePrefixes = path.join(
        SystemPath.getPath("home"),
        ".local",
        "share",
        "Steam",
        "steamapps",
        "compatdata"
      );

      const winePrefixPath = path.join(
        steamWinePrefixes,
        newShortcut.appid.toString(),
        "pfx"
      );

      await fs.promises.mkdir(winePrefixPath, { recursive: true });

      await gamesSublevel.put(gameKey, {
        ...game,
        winePrefixPath,
      });
    }
  }
};

registerEvent("createSteamShortcut", createSteamShortcut);
