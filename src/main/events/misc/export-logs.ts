import { app, BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { logsPath } from "@main/constants";
import { logger, SevenZip } from "@main/services";
import { registerEvent } from "../register-event";

const exportLogs = async (
  event: Electron.IpcMainInvokeEvent
): Promise<string | null> => {
  const archiveName = `${path.basename(logsPath)}.zip`;
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions: Electron.SaveDialogOptions = {
    defaultPath: path.join(app.getPath("downloads"), archiveName),
    filters: [{ name: "ZIP archive", extensions: ["zip"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  };

  const { canceled, filePath } = senderWindow
    ? await dialog.showSaveDialog(senderWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (canceled || !filePath) return null;

  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-logs-export-")
  );

  try {
    const snapshotPath = path.join(temporaryDirectory, path.basename(logsPath));
    const temporaryZipPath = path.join(temporaryDirectory, archiveName);

    await fs.promises.mkdir(snapshotPath, { recursive: true });
    await fs.promises.cp(logsPath, snapshotPath, {
      recursive: true,
      force: true,
    });

    await SevenZip.createZip({
      sourcePath: snapshotPath,
      destinationPath: temporaryZipPath,
    });

    await fs.promises.copyFile(temporaryZipPath, filePath);
    logger.info("Exported logs", { filePath });

    return filePath;
  } finally {
    await fs.promises
      .rm(temporaryDirectory, { recursive: true, force: true })
      .catch((error) => {
        logger.warn("Failed to clean up logs export directory", error);
      });
  }
};

registerEvent("exportLogs", exportLogs);
