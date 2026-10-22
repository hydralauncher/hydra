import { app, nativeImage, shell } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { registerEvent } from "../register-event";
import { logger } from "@main/services";

const MAX_CACHED_ICONS = 200;
const ICON_SIZE = 32;
const IMAGE_ICON_EXTENSIONS = new Set([".ico", ".png"]);
const iconCache = new Map<string, string | null>();

const resolveShortcutIconSource = (filePath: string) => {
  if (
    process.platform !== "win32" ||
    path.extname(filePath).toLowerCase() !== ".lnk"
  ) {
    return filePath;
  }

  try {
    const shortcut = shell.readShortcutLink(filePath);
    if (shortcut.icon && existsSync(shortcut.icon)) return shortcut.icon;
    if (shortcut.target && existsSync(shortcut.target)) return shortcut.target;
  } catch (error) {
    logger.warn("Failed to read shortcut", { filePath, error });
  }

  return filePath;
};

const loadImageIcon = (iconPath: string) => {
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return null;

  return image
    .resize({ width: ICON_SIZE, height: ICON_SIZE, quality: "best" })
    .toDataURL();
};

const loadFileIcon = async (filePath: string) => {
  const iconSource = resolveShortcutIconSource(filePath);

  try {
    if (IMAGE_ICON_EXTENSIONS.has(path.extname(iconSource).toLowerCase())) {
      const imageIcon = loadImageIcon(iconSource);
      if (imageIcon) return imageIcon;
    }

    const icon = await app.getFileIcon(iconSource, { size: "large" });
    return icon.isEmpty() ? null : icon.toDataURL();
  } catch (error) {
    logger.warn("Failed to read file icon", { filePath, iconSource, error });
    return null;
  }
};

const getFileIcon = async (
  _event: Electron.IpcMainInvokeEvent,
  filePath: unknown
): Promise<string | null> => {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return null;
  if (iconCache.has(filePath)) return iconCache.get(filePath) ?? null;
  if (!existsSync(filePath)) return null;

  const icon = await loadFileIcon(filePath);

  if (iconCache.size >= MAX_CACHED_ICONS) {
    const oldestKey = iconCache.keys().next().value;
    if (oldestKey !== undefined) iconCache.delete(oldestKey);
  }
  iconCache.set(filePath, icon);

  return icon;
};

registerEvent("getFileIcon", getFileIcon);
