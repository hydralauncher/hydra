import { HydraApi, logger, Ludusavi, WindowManager } from "@main/services";
import fs from "node:fs";
import * as tar from "tar";
import { registerEvent } from "../register-event";
import axios from "axios";
import { app } from "electron";
import path from "node:path";
import { artifactMetadataFileName, backupsPath } from "@main/constants";
import type { GameShop } from "@types";

import YAML from "yaml";
import { normalizePath } from "@main/helpers";

export interface LudusaviBackup {
  files: {
    [key: string]: {
      hash: string;
      size: number;
    };
  };
}

const replaceLudusaviBackupWithCurrentUser = (
  backupPath: string,
  title: string
) => {
  const gameBackupPath = path.join(backupPath, title);
  const mappingYamlPath = path.join(gameBackupPath, "mapping.yaml");

  const data = fs.readFileSync(mappingYamlPath, "utf8");
  const manifest = YAML.parse(data) as {
    backups: LudusaviBackup[];
    drives: Record<string, string>;
  };

  const metadataPath = path.join(backupPath, artifactMetadataFileName);

  if (!fs.existsSync(metadataPath)) {
    logger.error(`metadata not found in backup ${gameBackupPath}`);
    return;
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as {
    home: string;
    documents: string;
  };

  const currentHomeDir = normalizePath(app.getPath("home"));
  const currentDocumentsDir = normalizePath(app.getPath("documents"));

  /* Renaming logic */
  const mappedHomeDir = path.join(
    gameBackupPath,
    metadata.home.replace("C:", "drive-C")
  );
  const mappedDocumentsDir = path.join(
    gameBackupPath,
    metadata.documents.replace("C:", "drive-C")
  );

  if (fs.existsSync(mappedHomeDir)) {
    fs.renameSync(
      mappedHomeDir,
      path.join(gameBackupPath, currentHomeDir.replace("C:", "drive-C"))
    );
  }

  if (fs.existsSync(mappedDocumentsDir)) {
    fs.renameSync(
      mappedDocumentsDir,
      path.join(gameBackupPath, currentDocumentsDir.replace("C:", "drive-C"))
    );
  }

  const backups = manifest.backups.map((backup: LudusaviBackup) => {
    const files = Object.entries(backup.files).reduce((prev, [key, value]) => {
      const updatedKey = key
        .replace(metadata.documents, currentDocumentsDir)
        .replace(metadata.home, currentHomeDir);

      return {
        ...prev,
        [updatedKey]: value,
      };
    }, {});

    return {
      ...backup,
      files,
    };
  });

  fs.writeFileSync(mappingYamlPath, YAML.stringify({ ...manifest, backups }));
};

const downloadGameArtifact = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  gameArtifactId: string
) => {
  const { downloadUrl, objectKey } = await HydraApi.post<{
    downloadUrl: string;
    objectKey: string;
  }>(`/profile/games/artifacts/${gameArtifactId}/download`);

  const zipLocation = path.join(app.getPath("userData"), objectKey);
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

        replaceLudusaviBackupWithCurrentUser(backupPath, game);

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
