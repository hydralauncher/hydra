import { HydraApi, logger, Ludusavi, WindowManager } from "@main/services";
import { registerEvent } from "../register-event";
import fs from "node:fs";
import path from "node:path";
import * as tar from "tar";
import crypto from "node:crypto";
import type { GameShop } from "@types";
import axios from "axios";
import os from "node:os";
import { backupsPath } from "@main/constants";
import { app } from "electron";
import { normalizePath } from "@main/helpers";
import { gamesSublevel, levelKeys } from "@main/level";

const bundleBackup = async (
  shop: GameShop,
  objectId: string,
  winePrefix: string | null
) => {
  const backupPath = path.join(backupsPath, `${shop}-${objectId}`);

  // Remove existing backup
  if (fs.existsSync(backupPath)) {
    fs.rmSync(backupPath, { recursive: true });
  }

  await Ludusavi.backupGame(shop, objectId, backupPath, winePrefix);

  const tarLocation = path.join(backupsPath, `${crypto.randomUUID()}.tar`);

  await tar.create(
    {
      gzip: false,
      file: tarLocation,
      cwd: backupPath,
    },
    ["."]
  );

  return tarLocation;
};

const uploadSaveGame = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  downloadOptionTitle: string | null
) => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));

  const bundleLocation = await bundleBackup(
    shop,
    objectId,
    game?.winePrefixPath ?? null
  );

  fs.stat(bundleLocation, async (err, stat) => {
    if (err) {
      logger.error("Failed to get zip file stats", err);
      throw err;
    }

    const { uploadUrl } = await HydraApi.post<{
      id: string;
      uploadUrl: string;
    }>("/profile/games/artifacts", {
      artifactLengthInBytes: stat.size,
      shop,
      objectId,
      hostname: os.hostname(),
      homeDir: normalizePath(app.getPath("home")),
      downloadOptionTitle,
      platform: os.platform(),
    });

    fs.readFile(bundleLocation, async (err, fileBuffer) => {
      if (err) {
        logger.error("Failed to read zip file", err);
        throw err;
      }

      await axios.put(uploadUrl, fileBuffer, {
        headers: {
          "Content-Type": "application/tar",
        },
        onUploadProgress: (progressEvent) => {
          logger.log(progressEvent);
        },
      });

      WindowManager.mainWindow?.webContents.send(
        `on-upload-complete-${objectId}-${shop}`,
        true
      );

      fs.rm(bundleLocation, (err) => {
        if (err) {
          logger.error("Failed to remove tar file", err);
          throw err;
        }
      });
    });
  });
};

registerEvent("uploadSaveGame", uploadSaveGame);
