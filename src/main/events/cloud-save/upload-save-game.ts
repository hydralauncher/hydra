import { HydraApi, logger, Ludusavi, WindowManager } from "@main/services";
import { registerEvent } from "../register-event";
import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import crypto from "node:crypto";
import { GameShop } from "@types";
import axios from "axios";
import os from "node:os";
import { app } from "electron";
import { backupsPath } from "@main/constants";

const compressBackupToArtifact = async (
  shop: GameShop,
  objectId: string,
  cb: (zipLocation: string) => void
) => {
  const backupPath = path.join(backupsPath, `${shop}-${objectId}`);

  await Ludusavi.backupGame(shop, objectId, backupPath);

  const archive = archiver("zip", {
    zlib: { level: 9 },
  });

  const zipLocation = path.join(
    app.getPath("userData"),
    `${crypto.randomUUID()}.zip`
  );

  const output = fs.createWriteStream(zipLocation);

  output.on("close", () => {
    cb(zipLocation);
  });

  output.on("error", (err) => {
    logger.error("Failed to compress folder", err);
    throw err;
  });

  archive.pipe(output);

  archive.directory(backupPath, false);
  archive.finalize();
};

const uploadSaveGame = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  compressBackupToArtifact(shop, objectId, (zipLocation) => {
    fs.stat(zipLocation, async (err, stat) => {
      if (err) {
        logger.error("Failed to get zip file stats", err);
        throw err;
      }

      const { uploadUrl } = await HydraApi.post<{
        id: string;
        uploadUrl: string;
      }>("/games/artifacts", {
        artifactLengthInBytes: stat.size,
        shop,
        objectId,
        hostname: os.hostname(),
      });

      fs.readFile(zipLocation, async (err, fileBuffer) => {
        if (err) {
          logger.error("Failed to read zip file", err);
          throw err;
        }

        await axios.put(uploadUrl, fileBuffer, {
          headers: {
            "Content-Type": "application/zip",
          },
          onUploadProgress: (progressEvent) => {
            console.log(progressEvent);
          },
        });

        WindowManager.mainWindow?.webContents.send(
          `on-upload-complete-${objectId}-${shop}`,
          true
        );

        fs.rm(zipLocation, (err) => {
          if (err) {
            logger.error("Failed to remove zip file", err);
            throw err;
          }
        });
      });
    });
  });
};

registerEvent("uploadSaveGame", uploadSaveGame);
