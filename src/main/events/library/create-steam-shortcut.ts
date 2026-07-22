import { registerEvent } from "../register-event";
import type { Game, GameShop, ShopAssets, SteamShortcut } from "@types";
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
  getHydraExecutablePath,
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

const addShortcutForSteamUser = async (
  steamUserId: number,
  shortcut: SteamShortcut,
  game: Game,
  assets: Array<string | null>
) => {
  logger.info("Adding shortcut for Steam user", steamUserId);

  const steamShortcuts = await getSteamShortcuts(steamUserId);
  const duplicate =
    game.shop === "launchbox"
      ? steamShortcuts.some(
          (item) => item.LaunchOptions === shortcut.LaunchOptions
        )
      : steamShortcuts.some((item) => item.appname === game.title);
  if (duplicate) return;

  const gridPath = path.join(
    await getSteamLocation(),
    "userdata",
    steamUserId.toString(),
    "config",
    "grid"
  );
  await fs.promises.mkdir(gridPath, { recursive: true });

  const [heroImage, logoImage, coverImage, libraryImage] = assets;
  await Promise.all([
    copyAssetIfExists(
      heroImage,
      path.join(gridPath, `${shortcut.appid}_hero.jpg`)
    ),
    copyAssetIfExists(
      logoImage,
      path.join(gridPath, `${shortcut.appid}_logo.png`)
    ),
    copyAssetIfExists(
      coverImage,
      path.join(gridPath, `${shortcut.appid}p.jpg`)
    ),
    copyAssetIfExists(
      libraryImage,
      path.join(gridPath, `${shortcut.appid}.jpg`)
    ),
  ]);

  steamShortcuts.push(shortcut);
  logger.info(shortcut);
  logger.info("Writing Steam shortcuts", steamShortcuts);
  await writeSteamShortcuts(steamUserId, steamShortcuts);
};

const configureLinuxWinePrefix = async (game: Game, appId: number) => {
  if (
    process.platform !== "linux" ||
    game.shop === "launchbox" ||
    game.winePrefixPath
  ) {
    return;
  }

  const winePrefixPath = path.join(
    SystemPath.getPath("home"),
    ".local",
    "share",
    "Steam",
    "steamapps",
    "compatdata",
    appId.toString(),
    "pfx"
  );
  await fs.promises.mkdir(winePrefixPath, { recursive: true });

  const gameKey = levelKeys.game(game.shop, game.objectId);
  await gamesSublevel.put(gameKey, {
    ...game,
    steamShortcutAppId: appId,
    winePrefixPath,
  });
};

const createSteamShortcut = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  options?: CreateSteamShortcutOptions
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) return;
  if (!game.executablePath && game.shop !== "launchbox") {
    throw new Error("No executable path found for game");
  }
  const classicsDiscPath =
    game.selectedDiscPath ?? game.discs?.[0]?.path ?? null;
  if (
    game.shop === "launchbox" &&
    (!classicsDiscPath || !fs.existsSync(classicsDiscPath))
  ) {
    throw new Error(
      "Classic games need an available disc before creating a shortcut"
    );
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
    ? getHydraExecutablePath()
    : game.executablePath!;
  const deepLink = isClassicsGame
    ? buildRunDeepLink(game.shop, game.objectId)
    : null;
  const launchOptions = deepLink ? getShortcutArguments(deepLink) : "";

  const newShortcut = composeSteamShortcut(
    game.title,
    executablePath,
    iconImage,
    options,
    {
      appIdSeed: deepLink ?? undefined,
      launchOptions,
    }
  );

  for (const steamUserId of steamUserIds) {
    await addShortcutForSteamUser(steamUserId, newShortcut, game, [
      heroImage,
      logoImage,
      coverImage,
      libraryImage,
    ]);
  }

  await gamesSublevel.put(gameKey, {
    ...game,
    steamShortcutAppId: newShortcut.appid,
  });

  await configureLinuxWinePrefix(game, newShortcut.appid);
};

registerEvent("createSteamShortcut", createSteamShortcut);
