import { HydraApi, logger, Ludusavi, WindowManager } from "@main/services";
import { registerEvent } from "../register-event";
import fs from "node:fs";
import path from "node:path";
import * as tar from "tar";
import crypto from "node:crypto";
import { GameShop } from "@types";
import axios from "axios";
import os from "node:os";
import { backupsPath } from "@main/constants";
import { app } from "electron";

const bundleBackup = async (shop: GameShop, objectId: string) => {
  const backupPath = path.join(backupsPath, `${shop}-${objectId}`);

  // Remove existing backup
  if (fs.existsSync(backupPath)) {
    fs.rmSync(backupPath, { recursive: true });
  }

  await Ludusavi.backupGame(shop, objectId, backupPath);

  const tarLocation = path.join(backupsPath, `${crypto.randomUUID()}.zip`);

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
  shop: GameShop
) => {
  const bundleLocation = await bundleBackup(shop, objectId);

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
      homeDir: path.normalize(app.getPath("home")).replace(/\\/g, "/"),
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
          console.log(progressEvent);
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
