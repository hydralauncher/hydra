import path from "node:path";
import fs from "node:fs";

import { getDownloadsPath } from "../helpers/get-downloads-path";
import {
  DownloadManager,
  DownloadOrchestrator,
  logger,
  retroarch,
} from "@main/services";
import { Downloader } from "@shared";
import { getEpicDownloadService } from "@main/services/epic/download";
import { hasManagedEpicSession } from "@main/services/epic/launch";
import { EpicManagedError } from "@main/services/epic/legendary-managed-runtime";
import { isPathContained } from "@main/services/epic/installation";
import { isGameRunning } from "@main/services/game-running-state";
import { updateGameRecord } from "@main/services/game-record-updater";
import { HydraApi } from "@main/services/hydra-api";
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

  if (download.downloader === Downloader.Epic) {
    const context = HydraApi.getAuthContext();
    if (
      !context ||
      !download.epic ||
      download.epic.owner.environment !== context.environment ||
      download.epic.owner.userId !== context.userId
    )
      throw new EpicManagedError("stale-connection");
    const assertIdle = () => {
      if (isGameRunning(objectId, shop) || hasManagedEpicSession(gameKey))
        throw new EpicManagedError("game-running");
    };
    const assertContext = () => {
      if (!HydraApi.isAuthContextCurrent(context))
        throw new EpicManagedError("stale-connection");
    };
    const assertDownload = async () => {
      assertContext();
      const latest = await downloadsSublevel.get(gameKey);
      assertContext();
      if (
        !latest ||
        latest.downloader !== Downloader.Epic ||
        latest.timestamp !== download.timestamp ||
        latest.downloadPath !== download.downloadPath ||
        latest.folderName !== download.folderName ||
        latest.epic?.artifactId !== download.epic?.artifactId ||
        latest.epic?.connectionId !== download.epic?.connectionId
      )
        throw new EpicManagedError("operation-cancelled");
    };
    if (isGameRunning(objectId, shop) || hasManagedEpicSession(gameKey))
      throw new EpicManagedError("game-running");
    await DownloadManager.cancelDownload(gameKey);
    await assertDownload();
    if (!download.folderName || !download.epic)
      throw new EpicManagedError("invalid-path");
    const folderName = download.folderName;
    await getEpicDownloadService().forgetInstallation(
      download,
      async () => {
        await assertDownload();
        assertIdle();
        const baseStat = await fs.promises
          .lstat(download.downloadPath)
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
        if (!baseStat) return;
        const base = await fs.promises.realpath(download.downloadPath);
        if (
          !baseStat.isDirectory() ||
          baseStat.isSymbolicLink() ||
          path.relative(download.downloadPath, base) !== ""
        )
          throw new EpicManagedError("invalid-path");
        const candidate = path.resolve(base, folderName);
        if (!isPathContained(base, candidate))
          throw new EpicManagedError("invalid-path");
        const stat = await fs.promises
          .lstat(candidate)
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
        if (stat) {
          const directory = await fs.promises.realpath(candidate);
          if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            !isPathContained(base, directory) ||
            path.relative(directory, candidate) !== ""
          )
            throw new EpicManagedError("invalid-path");
          await assertDownload();
          assertIdle();
          await fs.promises.rm(directory, { recursive: true, force: true });
        }
      },
      async () => {
        // All local invalidation stays under the same workspace lease as file removal.
        await assertDownload();
        await updateGameRecord(gameKey, (latest) => {
          assertContext();
          const installation = latest.epicInstallation;
          if (
            installation &&
            (installation.artifactId !== download.epic!.artifactId ||
              installation.platform !== download.epic!.platform ||
              installation.owner.environment !==
                download.epic!.owner.environment ||
              installation.owner.userId !== download.epic!.owner.userId ||
              installation.owner.epicAccountId !==
                download.epic!.owner.epicAccountId)
          )
            throw new EpicManagedError("operation-cancelled");
          return {
            executablePath: null,
            installedSizeInBytes: null,
            installerSizeInBytes: null,
            epicInstallation: undefined,
          };
        });
        await assertDownload();
        await downloadsSublevel.del(gameKey);
      }
    );
    await DownloadOrchestrator.syncAfterDownloadRemoved({ shop, objectId });
    return;
  }

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
          : null,
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
