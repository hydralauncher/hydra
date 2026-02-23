import { registerEvent } from "../register-event";
import { GameShop } from "@types";
import path from "node:path";
import { GameFilesManager } from "@main/services";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { FILE_EXTENSIONS_TO_EXTRACT } from "@shared";

const extractGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<boolean> => {
  const gameKey = levelKeys.game(shop, objectId);

  const [download, game] = await Promise.all([
    downloadsSublevel.get(gameKey),
    gamesSublevel.get(gameKey),
  ]);

  if (!download || !game) return false;

  await downloadsSublevel.put(gameKey, {
    ...download,
    extracting: true,
    extractionProgress: 0,
  });

  const gameFilesManager = new GameFilesManager(shop, objectId);

  if (
    FILE_EXTENSIONS_TO_EXTRACT.some((ext) => download.folderName?.endsWith(ext))
  ) {
    gameFilesManager.extractDownloadedFile().catch(() => {
      // Errors are handled and persisted by GameFilesManager
    });
  } else {
    gameFilesManager
      .extractFilesInDirectory(
        path.join(download.downloadPath, download.folderName!)
      )
      .then((success) => {
        if (success) {
          gameFilesManager.setExtractionComplete(false).catch(() => {
            // Extraction completion failures are already logged downstream
          });
        }
      })
      .catch(() => {
        // Errors are handled and persisted by GameFilesManager
      });
  }

  return true;
};

registerEvent("extractGameDownload", extractGameDownload);
