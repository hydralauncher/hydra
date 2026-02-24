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

  if (!download || !game) {
    const gameFilesManager = new GameFilesManager(shop, objectId);
    await gameFilesManager.failExtraction(
      new Error("Could not start extraction because download metadata is missing")
    );
    return false;
  }

  await downloadsSublevel.put(gameKey, {
    ...download,
    extracting: true,
    extractionProgress: 0,
  });

  const gameFilesManager = new GameFilesManager(shop, objectId);
  const targetFolderName = download.folderName;

  if (!targetFolderName) {
    await gameFilesManager.failExtraction(
      new Error("No downloaded archive was found to extract")
    );
    return false;
  }

  if (
    FILE_EXTENSIONS_TO_EXTRACT.some((ext) =>
      targetFolderName.toLowerCase().endsWith(ext)
    )
  ) {
    gameFilesManager.extractDownloadedFile().catch((error) => {
      gameFilesManager.failExtraction(error).catch(() => {
        // Fail state persistence is already logged in GameFilesManager
      });
    });
  } else {
    gameFilesManager
      .extractFilesInDirectory(
        path.join(download.downloadPath, targetFolderName)
      )
      .then((success) => {
        if (success) {
          gameFilesManager.setExtractionComplete(false).catch(() => {
            // Extraction completion failures are already logged downstream
          });
        }
      })
      .catch((error) => {
        gameFilesManager.failExtraction(error).catch(() => {
          // Fail state persistence is already logged in GameFilesManager
        });
      });
  }

  return true;
};

registerEvent("extractGameDownload", extractGameDownload);
