import { registerEvent } from "../register-event";
import createDesktopShortcut from "create-desktop-shortcuts";
import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import axios from "axios";
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { removeSymbolsFromName } from "@shared";
import { GameShop, ShortcutLocation } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { SystemPath } from "@main/services/system-path";
import { ASSETS_PATH, windowsStartMenuPath } from "@main/constants";
import { getGameAssets } from "../catalogue/get-game-assets";
import { logger } from "@main/services";

const downloadIcon = async (
  shop: GameShop,
  objectId: string,
  iconUrl?: string | null
): Promise<string | null> => {
  if (!iconUrl) {
    return null;
  }

  const iconDir = path.join(ASSETS_PATH, `${shop}-${objectId}`);
  const iconPath = path.join(iconDir, "icon.ico");

  try {
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }

    fs.mkdirSync(iconDir, { recursive: true });

    const response = await axios.get(iconUrl, { responseType: "arraybuffer" });
    const imageBuffer = Buffer.from(response.data);

    // Convert any image format to PNG using sharp, then to ICO
    const pngBuffer = await sharp(imageBuffer).png().toBuffer();
    const icoBuffer = await pngToIco(pngBuffer);
    fs.writeFileSync(iconPath, icoBuffer);

    return iconPath;
  } catch (error) {
    logger.error("Failed to download/convert game icon", error);
    return null;
  }
};

const createUrlShortcut = (
  shortcutPath: string,
  url: string,
  iconPath?: string | null
): boolean => {
  try {
    let content = `[InternetShortcut]\nURL=${url}\n`;

    if (iconPath) {
      content += `IconFile=${iconPath}\nIconIndex=0\n`;
    }

    fs.writeFileSync(shortcutPath, content);
    return true;
  } catch (error) {
    logger.error("Failed to create URL shortcut", error);
    return false;
  }
};

const createGameShortcut = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  location: ShortcutLocation
): Promise<boolean> => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) {
    return false;
  }

  const shortcutName = removeSymbolsFromName(game.title);
  const deepLink = `hydralauncher://run?shop=${shop}&objectId=${objectId}`;
  const outputPath =
    location === "desktop"
      ? SystemPath.getPath("desktop")
      : windowsStartMenuPath;

  const assets = shop === "custom" ? null : await getGameAssets(objectId, shop);
  const iconPath = await downloadIcon(shop, objectId, assets?.iconUrl);

  if (process.platform === "win32") {
    const shortcutPath = path.join(outputPath, `${shortcutName}.url`);
    return createUrlShortcut(shortcutPath, deepLink, iconPath);
  }

  const windowVbsPath = app.isPackaged
    ? path.join(process.resourcesPath, "windows.vbs")
    : undefined;

  const options = {
    filePath: process.execPath,
    arguments: deepLink,
    name: shortcutName,
    outputPath,
    icon: iconPath ?? undefined,
  };

  return createDesktopShortcut({
    windows: { ...options, VBScriptPath: windowVbsPath },
    linux: options,
    osx: options,
  });
};

registerEvent("createGameShortcut", createGameShortcut);
