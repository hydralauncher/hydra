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
import { ASSETS_PATH } from "@main/constants";
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
    fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });

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

const deleteIfExists = (filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    logger.warn(`Failed to delete existing shortcut: ${filePath}`, error);
  }
};

const getWindowsOutputPath = (location: ShortcutLocation) => {
  return location === "desktop"
    ? SystemPath.getPath("desktop")
    : path.join(
        SystemPath.getPath("appData"),
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs"
      );
};

const createWindowsShortcut = (
  shortcutName: string,
  outputPath: string,
  deepLink: string,
  iconPath?: string | null
) => {
  const windowVbsPath = app.isPackaged
    ? path.join(process.resourcesPath, "windows.vbs")
    : undefined;

  const linkPath = path.join(outputPath, `${shortcutName}.lnk`);
  const urlPath = path.join(outputPath, `${shortcutName}.url`);

  deleteIfExists(linkPath);
  deleteIfExists(urlPath);

  const nativeShortcutCreated = createDesktopShortcut({
    windows: {
      filePath: process.execPath,
      arguments: deepLink,
      name: shortcutName,
      outputPath,
      icon: iconPath ?? process.execPath,
      VBScriptPath: windowVbsPath,
    },
  });

  if (nativeShortcutCreated) {
    return true;
  }

  return createUrlShortcut(urlPath, deepLink, iconPath ?? process.execPath);
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
    throw new Error("Could not find this game in your library.");
  }

  if (location === "start_menu" && process.platform !== "win32") {
    throw new Error("Start Menu shortcuts are only available on Windows.");
  }

  const shortcutName =
    removeSymbolsFromName(game.title).trim() || game.objectId;
  const deepLink = `hydralauncher://run?shop=${shop}&objectId=${objectId}`;
  const outputPath =
    process.platform === "win32"
      ? getWindowsOutputPath(location)
      : SystemPath.getPath("desktop");

  if (!outputPath) {
    throw new Error("Could not resolve the shortcut output folder.");
  }

  fs.mkdirSync(outputPath, { recursive: true });

  const assets = shop === "custom" ? null : await getGameAssets(objectId, shop);
  const iconPath = await downloadIcon(shop, objectId, [
    assets?.iconUrl,
    game.iconUrl,
    assets?.coverImageUrl,
  ]);

  if (process.platform === "win32") {
    const success = createWindowsShortcut(
      shortcutName,
      outputPath,
      deepLink,
      iconPath
    );

    if (!success) {
      const locationName = location === "desktop" ? "desktop" : "Start Menu";
      throw new Error(
        `Failed to create ${locationName} shortcut in ${outputPath}.`
      );
    }

    return true;
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

  const success = createDesktopShortcut({
    windows: { ...options, VBScriptPath: windowVbsPath },
    linux: options,
    osx: options,
  });

  if (!success) {
    throw new Error("Failed to create desktop shortcut.");
  }

  return true;
};

registerEvent("createGameShortcut", createGameShortcut);
