import path from "node:path";
import fs from "node:fs";

import { getDownloadsPath } from "../helpers/get-downloads-path";
import { DownloadOrchestrator, logger, retroarch } from "@main/services";
import { registerEvent } from "../register-event";
import { isWithin } from "../emulators/rom-path-utils";
import { GameShop } from "@types";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";

const deleteGameFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<void> => {
  const gameKey = levelKeys.game(shop, objectId);
  const download = await downloadsSublevel.get(gameKey);

  if (!download) return;

  const deleteFile = async (filePath: string, isDirectory = false) => {
    if (fs.existsSync(filePath)) {
      await new Promise<void>((resolve, reject) => {
        fs.rm(
          filePath,
          {
            recursive: isDirectory,
            force: true,
            maxRetries: 5,
            retryDelay: 200,
          },
          (error) => {
            if (error) {
              logger.error(error);
              reject();
            }
            resolve();
          }
        );
      });
    }
  };

  const folderPath = download.folderName
    ? path.join(
        download.downloadPath ?? (await getDownloadsPath()),
        download.folderName
      )
    : null;

  if (folderPath) {
    const metaPath = `${folderPath}.meta`;

    await deleteFile(folderPath, true);
    await deleteFile(metaPath);
  }

  await downloadsSublevel.del(gameKey);
  await DownloadOrchestrator.syncAfterDownloadRemoved({ shop, objectId });

  const game = await gamesSublevel.get(gameKey);
  if (game) {
    const discs = game.discs ?? [];
    const remainingDiscs = folderPath
      ? discs.filter((disc) => !isWithin(disc.path, folderPath))
      : discs;
    const hasUnlinkedDiscs = remainingDiscs.length !== discs.length;
    const isSelectedDiscRemaining = remainingDiscs.some(
      (disc) => disc.path === game.selectedDiscPath
    );

    await gamesSublevel.put(gameKey, {
      ...game,
      installerSizeInBytes: null,
      executablePath: null,
      installedSizeInBytes: null,
      automaticCloudSync: false,
      ...(hasUnlinkedDiscs && {
        discs: remainingDiscs,
        selectedDiscPath: isSelectedDiscRemaining
          ? game.selectedDiscPath
          : (remainingDiscs[0]?.path ?? null),
      }),
    });

    if (hasUnlinkedDiscs) {
      await retroarch.refreshRetroArchLibraryStats().catch((error) => {
        logger.error(
          "[deleteGameFolder] Failed to refresh RetroArch library stats",
          error
        );
      });
    }
  }
};

registerEvent("deleteGameFolder", deleteGameFolder);
