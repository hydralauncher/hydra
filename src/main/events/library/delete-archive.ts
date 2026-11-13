import path from "node:path";
import fs from "node:fs";

import { registerEvent } from "../register-event";
import { logger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";

const isInsideFolder = (folder: string, target: string) => {
  const relative = path.relative(folder, target);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
};

export const deleteArchiveFile = async (filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      logger.info(`Deleted archive: ${filePath}`);
    }

    // Find the game that has this archive and clear installer size
    const normalizedPath = path.normalize(filePath);
    const downloads = await downloadsSublevel.values().all();

    for (const download of downloads) {
      if (!download.folderName) continue;

      const downloadPath = path.normalize(
        path.join(download.downloadPath, download.folderName)
      );

      if (downloadPath === normalizedPath) {
        const gameKey = levelKeys.game(download.shop, download.objectId);
        const game = await gamesSublevel.get(gameKey);

        if (game) {
          await gamesSublevel.put(gameKey, {
            ...game,
            installerSizeInBytes: null,
          });
        }

        const extractedFolder =
          path.extname(normalizedPath).toLowerCase() === ".pkg"
            ? game?.discs?.find(
                (disc) =>
                  !disc.recompilationSlug &&
                  isInsideFolder(download.downloadPath, disc.path) &&
                  fs.existsSync(disc.path) &&
                  fs.statSync(disc.path).isDirectory()
              )?.path
            : undefined;
        if (extractedFolder) {
          await downloadsSublevel.put(gameKey, {
            ...download,
            folderName: path.relative(download.downloadPath, extractedFolder),
          });
        }
        break;
      }
    }

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
