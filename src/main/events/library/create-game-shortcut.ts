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

const isValidHttpUrl = (url: string | null | undefined): url is string => {
  return !!url && (url.startsWith("http://") || url.startsWith("https://"));
};

const isIcoUrl = (url: string): boolean => {
  return url.toLowerCase().endsWith(".ico");
};

const downloadIcon = async (
  shop: GameShop,
  objectId: string,
  iconUrls: (string | null | undefined)[]
): Promise<string | null> => {
  const iconDir = path.join(ASSETS_PATH, `${shop}-${objectId}`);
  const iconPath = path.join(iconDir, "icon.ico");

  try {
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  } catch {
    // Ignore fs errors
  }

  const validUrls = iconUrls.filter(isValidHttpUrl);

  if (validUrls.length === 0) {
    logger.warn("No valid icon URLs found for game shortcut");
    return null;
  }

  fs.mkdirSync(iconDir, { recursive: true });

  for (const iconUrl of validUrls) {
    try {
      logger.log(`Trying to download icon from: ${iconUrl}`);
      const response = await axios.get(iconUrl, {
        responseType: "arraybuffer",
      });
      const imageBuffer = Buffer.from(response.data);

      // If source is already ICO, use it directly
      if (isIcoUrl(iconUrl)) {
        fs.writeFileSync(iconPath, imageBuffer);
        logger.log(`Copied ICO directly to: ${iconPath}`);
        return iconPath;
      }

      // Convert to square PNG (256x256 is standard for ICO), then to ICO
      const pngBuffer = await sharp(imageBuffer)
        .resize(256, 256, { fit: "cover" })
        .png()
        .toBuffer();
      const icoBuffer = await pngToIco(pngBuffer);
      fs.writeFileSync(iconPath, icoBuffer);

      logger.log(`Successfully created icon at: ${iconPath}`);
      return iconPath;
    } catch (error) {
      logger.warn(`Failed to convert icon from ${iconUrl}:`, error);
    }
  }

  logger.error("Failed to download/convert game icon from any source");
  return null;
};

const createUrlShortcut = (
  shortcutPath: string,
  url: string,
  iconPath?: string | null
): boolean => {
  try {
    // Delete existing shortcut first so icon updates properly
    if (fs.existsSync(shortcutPath)) {
      fs.unlinkSync(shortcutPath);
    }

    let content = `[InternetShortcut]\nURL=${url}\n`;

    if (iconPath) {
      content += `IconFile=${iconPath}\nIconIndex=0\n`;
    }

    logger.log(`Creating shortcut at: ${shortcutPath}`);
    logger.log(`Shortcut content:\n${content}`);

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
  const iconPath = await downloadIcon(shop, objectId, [
    assets?.iconUrl,
    game.iconUrl,
    assets?.coverImageUrl,
  ]);

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
