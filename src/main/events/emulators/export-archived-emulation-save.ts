import path from "node:path";

import { app, BrowserWindow, dialog } from "electron";

import { emulators, WindowManager } from "@main/services";
import type { EmulationSavePlatform } from "@types";

import { registerEvent } from "../register-event";
import {
  loadArchivedEmulationSaves,
  sanitizeArchivedEmulationFileName,
} from "./archived-emulation-save-policy";
import { writeArchivedEmulationSave } from "./write-archived-emulation-save";

type ArchiveExportResult =
  | { status: "saved"; filePath: string }
  | { status: "cancelled" };

const exportArchivedEmulationSave = async (
  event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform,
  objectId: string | null,
  saveId: string
): Promise<ArchiveExportResult> => {
  const senderWindow =
    BrowserWindow.fromWebContents(event.sender) ??
    WindowManager.mainWindow ??
    null;
  if (!senderWindow) throw new Error("archive_export_window_unavailable");

  const saves = await loadArchivedEmulationSaves(
    platform,
    objectId,
    emulators.listEmulationSaves
  );
  const save = saves.find((item) => item.id === saveId);
  if (!save) throw new Error("archive_emulation_save_not_found");

  const fileName = sanitizeArchivedEmulationFileName(save.fileName);
  const extension = path.extname(fileName).slice(1);
  const selection = await dialog.showSaveDialog(senderWindow, {
    defaultPath: path.join(app.getPath("downloads"), fileName),
    ...(extension && /^[a-z0-9]{1,8}$/i.test(extension)
      ? {
          filters: [
            {
              name: `${extension.toUpperCase()} save`,
              extensions: [extension],
            },
          ],
        }
      : {}),
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (selection.canceled || !selection.filePath) {
    return { status: "cancelled" };
  }

  const destination = selection.filePath;
  const bytes = await emulators.downloadEmulationSaveBytes(save.id);
  await writeArchivedEmulationSave(destination, bytes);
  return { status: "saved", filePath: destination };
};

registerEvent("exportArchivedEmulationSave", exportArchivedEmulationSave);
