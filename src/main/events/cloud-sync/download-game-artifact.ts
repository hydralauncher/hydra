import { HydraApi, logger, Ludusavi, WindowManager } from "@main/services";
import fs from "node:fs";
import AdmZip from "adm-zip";
import { registerEvent } from "../register-event";
import axios from "axios";
import { app } from "electron";
import path from "node:path";
import { backupsPath } from "@main/constants";
import type { GameShop } from "@types";

const downloadGameArtifact = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  gameArtifactId: string
) => {
  const { downloadUrl, objectKey } = await HydraApi.post<{
    downloadUrl: string;
    objectKey: string;
  }>(`/games/artifacts/${gameArtifactId}/download`);

  const response = await axios.get(downloadUrl, {
    responseType: "stream",
  });

  const zipLocation = path.join(app.getPath("userData"), objectKey);
  const backupPath = path.join(backupsPath, `${shop}-${objectId}`);

  const writer = fs.createWriteStream(zipLocation);

  response.data.pipe(writer);

  writer.on("error", (err) => {
    logger.error("Failed to write zip", err);
    throw err;
  });

  writer.on("close", () => {
    const zip = new AdmZip(zipLocation);
    zip.extractAllToAsync(backupPath, true, true, (err) => {
      if (err) {
        logger.error("Failed to extract zip", err);
        throw err;
      }

      Ludusavi.restoreBackup(backupPath).then(() => {
        WindowManager.mainWindow?.webContents.send(
          `on-download-complete-${objectId}-${shop}`,
          true
        );
      });
    });
  });
};

registerEvent("downloadGameArtifact", downloadGameArtifact);
