import { CloudSync, HydraApi, logger, WindowManager } from "@main/services";
import fs from "node:fs";
import * as tar from "tar";
import { registerEvent } from "../register-event";
import axios from "axios";
import path from "node:path";
import { backupsPath, publicProfilePath } from "@main/constants";
import type { GameShop, LudusaviBackupMapping } from "@types";

import YAML from "yaml";
import { addTrailingSlash, normalizePath } from "@main/helpers";
import { SystemPath } from "@main/services/system-path";
import { gamesSublevel, levelKeys } from "@main/level";

export const transformLudusaviBackupPathIntoWindowsPath = (
  backupPath: string,
  winePrefixPath?: string | null
) => {
  return backupPath
    .replace(winePrefixPath ? addTrailingSlash(winePrefixPath) : "", "")
    .replace("drive_c", "C:");
};

export const addWinePrefixToWindowsPath = (
  windowsPath: string,
  winePrefixPath?: string | null
) => {
  if (!winePrefixPath) {
    return windowsPath;
  }

  return path.join(winePrefixPath, windowsPath.replace("C:", "drive_c"));
};

const restoreLudusaviBackup = (
  backupPath: string,
  title: string,
  homeDir: string,
  winePrefixPath?: string | null,
  artifactWinePrefixPath?: string | null
) => {
  const gameBackupPath = path.join(backupPath, title);
  const mappingYamlPath = path.join(gameBackupPath, "mapping.yaml");

  const data = fs.readFileSync(mappingYamlPath, "utf8");
  const manifest = YAML.parse(data) as {
    backups: LudusaviBackupMapping[];
    drives: Record<string, string>;
  };

  const userProfilePath =
    CloudSync.getWindowsLikeUserProfilePath(winePrefixPath);

  manifest.backups.forEach((backup) => {
    Object.keys(backup.files).forEach((key) => {
      const sourcePathWithDrives = Object.entries(manifest.drives).reduce(
        (prev, [driveKey, driveValue]) => {
          return prev.replace(driveValue, driveKey);
        },
        key
      );

      const sourcePath = path.join(gameBackupPath, sourcePathWithDrives);

      logger.info(`Source path: ${sourcePath}`);

      const destinationPath = transformLudusaviBackupPathIntoWindowsPath(
        key,
        artifactWinePrefixPath
      )
        .replace(
          homeDir,
          addWinePrefixToWindowsPath(userProfilePath, winePrefixPath)
        )
        .replace(
          publicProfilePath,
          addWinePrefixToWindowsPath(publicProfilePath, winePrefixPath)
        );

      logger.info(`Moving ${sourcePath} to ${destinationPath}`);

      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

      if (fs.existsSync(destinationPath)) {
        fs.unlinkSync(destinationPath);
      }

      fs.renameSync(sourcePath, destinationPath);
    });
  });
};

const downloadGameArtifact = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  gameArtifactId: string
) => {
  try {
    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));

    const {
      downloadUrl,
      objectKey,
      homeDir,
      winePrefixPath: artifactWinePrefixPath,
    } = await HydraApi.post<{
      downloadUrl: string;
      objectKey: string;
      homeDir: string;
      winePrefixPath: string | null;
    }>(`/profile/games/artifacts/${gameArtifactId}/download`);

    const zipLocation = path.join(SystemPath.getPath("userData"), objectKey);
    const backupPath = path.join(backupsPath, `${shop}-${objectId}`);

    if (fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, {
        recursive: true,
        force: true,
      });
    }

    const response = await axios.get(downloadUrl, {
      responseType: "stream",
      onDownloadProgress: (progressEvent) => {
        WindowManager.mainWindow?.webContents.send(
          `on-backup-download-progress-${objectId}-${shop}`,
          progressEvent
        );
      },
    });

    const writer = fs.createWriteStream(zipLocation);

    response.data.pipe(writer);

    writer.on("error", (err) => {
      logger.error("Failed to write tar file", err);
      throw err;
    });

    fs.mkdirSync(backupPath, { recursive: true });

    writer.on("close", async () => {
      await tar.x({
        file: zipLocation,
        cwd: backupPath,
      });

      restoreLudusaviBackup(
        backupPath,
        objectId,
        normalizePath(homeDir),
        game?.winePrefixPath,
        artifactWinePrefixPath
      );

      WindowManager.mainWindow?.webContents.send(
        `on-backup-download-complete-${objectId}-${shop}`,
        true
      );
    });
  } catch (err) {
    logger.error("Failed to download game artifact", err);

    WindowManager.mainWindow?.webContents.send(
      `on-backup-download-complete-${objectId}-${shop}`,
      false
    );
  }
};

registerEvent("downloadGameArtifact", downloadGameArtifact);
