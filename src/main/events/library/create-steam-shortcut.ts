import { registerEvent } from "../register-event";
import type { Game, GameShop, ShopAssets } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import {
  composeSteamShortcut,
  CreateSteamShortcutOptions,
  getSteamLocation,
  getSteamShortcuts,
  getSteamUsersIds,
  logger,
  SystemPath,
  writeSteamShortcuts,
} from "@main/services";
import fs from "node:fs";
import axios from "axios";
import path from "node:path";
import { ASSETS_PATH } from "@main/constants";
import { getGameAssets } from "../catalogue/get-game-assets";
import {
  convertSteamShortcutAsset,
  SteamShortcutAssetFormat,
} from "./steam-shortcut-assets";
import {
  buildRunDeepLink,
  getShortcutArguments,
} from "@main/helpers/shortcut-launch";

const downloadAsset = async (
  downloadPath: string,
  format: SteamShortcutAssetFormat,
  url?: string | null
) => {
  try {
    if (!url) {
      return null;
    }

    fs.mkdirSync(path.dirname(downloadPath), { recursive: true });

    let source: Buffer;

    if (url.startsWith("local:")) {
      const localPath = url.slice("local:".length);
      if (!fs.existsSync(localPath)) {
        return null;
      }
      source = await fs.promises.readFile(localPath);
    } else {
      const response = await axios.get<ArrayBuffer>(url, {
        responseType: "arraybuffer",
      });
      source = Buffer.from(response.data);
    }

    const converted = await convertSteamShortcutAsset(source, format);
    await fs.promises.writeFile(downloadPath, converted);

    return downloadPath;
  } catch (error) {
    logger.error("Failed to download asset", error);
    return null;
  }
};

const resolveShortcutAssetUrls = (game: Game, assets: ShopAssets | null) => ({
  icon: game.customIconUrl ?? assets?.iconUrl ?? null,
  hero: game.customHeroImageUrl ?? assets?.libraryHeroImageUrl ?? null,
  logo: game.customLogoImageUrl ?? assets?.logoImageUrl ?? null,
  cover: game.customCoverImageUrl ?? assets?.coverImageUrl ?? null,
  library: assets?.libraryImageUrl ?? null,
});

const downloadAssetsFromSteam = async (
  game: Game,
  assets: ShopAssets | null
) => {
  const gameAssetsPath = path.join(
    ASSETS_PATH,
    `${game.shop}-${game.objectId}`
  );
  const urls = resolveShortcutAssetUrls(game, assets);

  return await Promise.all([
    downloadAsset(path.join(gameAssetsPath, "icon.ico"), "ico", urls.icon),
    downloadAsset(path.join(gameAssetsPath, "hero.jpg"), "jpeg", urls.hero),
    downloadAsset(path.join(gameAssetsPath, "logo.png"), "png", urls.logo),
    downloadAsset(path.join(gameAssetsPath, "cover.jpg"), "jpeg", urls.cover),
    downloadAsset(
      path.join(gameAssetsPath, "library.jpg"),
      "jpeg",
      urls.library
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
  objectId: string,
  options?: CreateSteamShortcutOptions
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (game) {
    if (!game.executablePath && game.shop !== "launchbox") {
      throw new Error("No executable path found for game");
    }

    const assets = await getGameAssets(objectId, shop);

    const steamUserIds = await getSteamUsersIds();

    if (!steamUserIds.length) {
      logger.error("No Steam user ID found");
      throw new Error("No Steam user ID found");
    }

    const [iconImage, heroImage, logoImage, coverImage, libraryImage] =
      await downloadAssetsFromSteam(game, assets);

    const isClassicsGame = game.shop === "launchbox";
    const executablePath = isClassicsGame
      ? process.execPath
      : game.executablePath!;
    const launchOptions = isClassicsGame
      ? getShortcutArguments(buildRunDeepLink(game.shop, game.objectId))
      : "";

    const newShortcut = composeSteamShortcut(
      game.title,
      executablePath,
      iconImage,
      options,
      launchOptions
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

    await gamesSublevel.put(gameKey, {
      ...game,
      steamShortcutAppId: newShortcut.appid,
    });

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
