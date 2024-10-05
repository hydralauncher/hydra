import { HydraApi, logger, Ludusavi, WindowManager } from "@main/services";
import fs from "node:fs";
import * as tar from "tar";
import { registerEvent } from "../register-event";
import axios from "axios";
import { app } from "electron";
import path from "node:path";
import { backupsPath } from "@main/constants";
import type { GameShop } from "@types";

import YAML from "yaml";

export interface LudusaviBackup {
  files: {
    [key: string]: {
      hash: string;
      size: number;
    };
  };
}

const replaceLudusaviBackupWithCurrentUser = (
  gameBackupPath: string,
  backupHomeDir: string
) => {
  const mappingYamlPath = path.join(gameBackupPath, "mapping.yaml");

  const data = fs.readFileSync(mappingYamlPath, "utf8");
  const manifest = YAML.parse(data) as {
    backups: LudusaviBackup[];
    drives: Record<string, string>;
  };

  const currentHomeDir = app.getPath("home");

  // TODO: Only works on Windows
  const usersDirPath = path.join(gameBackupPath, "drive-C", "Users");

  fs.renameSync(
    path.join(usersDirPath, path.basename(backupHomeDir)),
    path.join(usersDirPath, path.basename(currentHomeDir))
  );

  const backups = manifest.backups.map((backup: LudusaviBackup) => {
    const files = Object.entries(backup.files).reduce((prev, [key, value]) => {
      return {
        ...prev,
        [key.replace(backupHomeDir, currentHomeDir)]: value,
      };
    }, {});

    return {
      ...backup,
      files,
    };
  });

  console.log(backups);

  fs.writeFileSync(mappingYamlPath, YAML.stringify({ ...manifest, backups }));
};

const downloadGameArtifact = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  gameArtifactId: string
) => {
  const { downloadUrl, objectKey, homeDir } = await HydraApi.post<{
    downloadUrl: string;
    objectKey: string;
    homeDir: string;
  }>(`/profile/games/artifacts/${gameArtifactId}/download`);

  const zipLocation = path.join(app.getPath("userData"), objectKey);
  const backupPath = path.join(backupsPath, `${shop}-${objectId}`);

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
    logger.error("Failed to write zip", err);
    throw err;
  });

  fs.mkdirSync(backupPath, { recursive: true });

  writer.on("close", () => {
    tar
      .x({
        file: zipLocation,
        cwd: backupPath,
      })
      .then(async () => {
        const [game] = await Ludusavi.findGames(shop, objectId);
        if (!game) throw new Error("Game not found in Ludusavi manifest");

        replaceLudusaviBackupWithCurrentUser(
          path.join(backupPath, game),
          path.normalize(homeDir).replace(/\\/g, "/")
        );

        Ludusavi.restoreBackup(backupPath).then(() => {
          WindowManager.mainWindow?.webContents.send(
            `on-backup-download-complete-${objectId}-${shop}`,
            true
          );
        });
      });
  });
};

registerEvent("downloadGameArtifact", downloadGameArtifact);
