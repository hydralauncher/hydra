import { logger, SevenZip, WindowManager } from "@main/services";
import type { LegacySaveExportResult } from "@types";
import axios from "axios";
import { app, BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { registerEvent } from "../register-event";
import {
  exportGameArtifactArchive,
  sanitizeLegacySaveArchiveName,
} from "./export-game-artifact-operation";
import { requestGameArtifactDownload } from "./game-artifact-download";

const exportGameArtifact = async (
  event: Electron.IpcMainInvokeEvent,
  gameArtifactId: string,
  suggestedName: string
): Promise<LegacySaveExportResult> => {
  const senderWindow =
    BrowserWindow.fromWebContents(event.sender) ??
    WindowManager.mainWindow ??
    null;

  if (!senderWindow) {
    throw new Error("Unable to open the legacy save export dialog");
  }

  const archiveName = sanitizeLegacySaveArchiveName(suggestedName);

  try {
    return await exportGameArtifactArchive({
      createTemporaryDirectory: () =>
        fs.promises.mkdtemp(
          path.join(app.getPath("temp"), "hydra-legacy-save-")
        ),
      downloadTar: async (destinationPath) => {
        const { downloadUrl } =
          await requestGameArtifactDownload(gameArtifactId);
        const response = await axios.get<Readable>(downloadUrl, {
          responseType: "stream",
        });

        await pipeline(
          response.data,
          fs.createWriteStream(destinationPath, { flags: "wx" })
        );
      },
      extractTar: async (tarPath, destinationPath) => {
        await fs.promises.mkdir(destinationPath, { recursive: true });
        await tar.x({ file: tarPath, cwd: destinationPath });
      },
      createZip: (sourcePath, destinationPath) =>
        SevenZip.createZip({ sourcePath, destinationPath }),
      selectDestination: async () => {
        const result = await dialog.showSaveDialog(senderWindow, {
          defaultPath: path.join(
            app.getPath("downloads"),
            `${archiveName}.zip`
          ),
          filters: [{ name: "ZIP archive", extensions: ["zip"] }],
          properties: ["createDirectory", "showOverwriteConfirmation"],
        });

        return result.canceled ? null : (result.filePath ?? null);
      },
      copyZip: (sourcePath, destinationPath) =>
        fs.promises.copyFile(sourcePath, destinationPath),
      cleanupTemporaryDirectory: async (temporaryDirectory) => {
        try {
          await fs.promises.rm(temporaryDirectory, {
            recursive: true,
            force: true,
          });
        } catch (error) {
          logger.error(
            "Failed to clean up legacy save export temporary files",
            error
          );
        }
      },
    });
  } catch (error) {
    logger.error("Failed to export legacy save", error);
    throw error;
  }
};

registerEvent("exportGameArtifact", exportGameArtifact);
