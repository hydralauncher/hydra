import path from "node:path";
import fs from "node:fs";

import { registerEvent } from "../register-event";
import { logger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import type { Download, Game } from "@types";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";

const isInsideFolder = (folder: string, target: string) => {
  const relative = path.relative(folder, target);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
};

const findExtractedPs4Folder = (game: Game | undefined, download: Download) =>
  game?.discs?.find(
    (disc) =>
      !disc.recompilationSlug &&
      isInsideFolder(download.downloadPath, disc.path) &&
      fs.existsSync(disc.path) &&
      fs.statSync(disc.path).isDirectory()
  )?.path;

const forgetDeletedArchive = async (
  download: Download,
  archivePath: string
) => {
  const gameKey = levelKeys.game(download.shop, download.objectId);
  const game = await gamesSublevel.get(gameKey);

  if (game) {
    await gamesSublevel.put(gameKey, { ...game, installerSizeInBytes: null });
  }

  const extractedFolder =
    path.extname(archivePath).toLowerCase() === ".pkg"
      ? findExtractedPs4Folder(game, download)
      : undefined;
  if (extractedFolder) {
    await downloadsSublevel.put(gameKey, {
      ...download,
      folderName: path.relative(download.downloadPath, extractedFolder),
    });
  }
};

export const deleteArchiveFile = async (filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      logger.info(`Deleted archive: ${filePath}`);
    }

    const normalizedPath = path.normalize(filePath);
    const downloads = await downloadsSublevel.values().all();
    const download = downloads.find(
      (item) =>
        item.folderName &&
        path.normalize(path.join(item.downloadPath, item.folderName)) ===
          normalizedPath
    );
    if (download) await forgetDeletedArchive(download, normalizedPath);

    return true;
  } catch (err) {
    logger.error(`Failed to delete archive: ${filePath}`, err);
    return false;
  }
};

/** Asks whether to delete archives the user picked once they are extracted. */
export const promptExtractedArchives = (archivePaths: string[]) => {
  const existing = archivePaths.filter((archivePath) =>
    fs.existsSync(archivePath)
  );
  if (existing.length === 0) return;
  WindowManager.sendToAppWindows("on-archive-deletion-prompt", existing);
};

const deleteArchive = async (
  _event: Electron.IpcMainInvokeEvent,
  filePath: string
) => deleteArchiveFile(filePath);

registerEvent("deleteArchive", deleteArchive);
