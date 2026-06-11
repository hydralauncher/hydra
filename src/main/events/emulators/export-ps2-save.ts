import { BrowserWindow, dialog } from "electron";

import { registerEvent } from "../register-event";
import { WindowManager, emulators, logger } from "@main/services";
import type { Ps2ExportResult } from "@types";

const exportPs2Save = async (
  event: Electron.IpcMainInvokeEvent,
  cardFilePath: string,
  folderName: string,
  suggestedName: string
): Promise<Ps2ExportResult> => {
  const senderWindow =
    BrowserWindow.fromWebContents(event.sender) ??
    WindowManager.mainWindow ??
    null;
  if (!senderWindow) return { ok: false, error: "no-window" };

  const result = await dialog.showSaveDialog(senderWindow, {
    defaultPath: `${suggestedName}.psu`,
    filters: [{ name: "PS2 Save", extensions: ["psu"] }],
  });
  if (result.canceled || !result.filePath) {
    return { ok: false, error: "cancelled" };
  }

  try {
    const res = await emulators.exportSaveToPsu(
      cardFilePath,
      folderName,
      new emulators.LocalPsuBackup(result.filePath),
      { readSaveContents: emulators.readSaveContents }
    );
    return { ok: true, location: res.location, sizeBytes: res.sizeBytes };
  } catch (err) {
    logger.error("Failed to export PS2 save to .psu", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

registerEvent("exportPs2Save", exportPs2Save);
