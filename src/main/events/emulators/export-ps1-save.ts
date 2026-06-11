import { BrowserWindow, dialog } from "electron";

import { registerEvent } from "../register-event";
import { WindowManager, emulators, logger } from "@main/services";
import type { MemcardExportResult } from "@types";

const exportPs1Save = async (
  event: Electron.IpcMainInvokeEvent,
  cardFilePath: string,
  identifier: string,
  suggestedName: string
): Promise<MemcardExportResult> => {
  const senderWindow =
    BrowserWindow.fromWebContents(event.sender) ??
    WindowManager.mainWindow ??
    null;
  if (!senderWindow) return { ok: false, error: "no-window" };

  const result = await dialog.showSaveDialog(senderWindow, {
    defaultPath: `${suggestedName}.mcs`,
    filters: [{ name: "PS1 Save", extensions: ["mcs"] }],
  });
  if (result.canceled || !result.filePath) {
    return { ok: false, error: "cancelled" };
  }

  try {
    const res = await emulators.exportSaveToMcs(
      cardFilePath,
      identifier,
      new emulators.LocalPsuBackup(result.filePath),
      { readSaveContents: emulators.readPs1SaveContents }
    );
    return { ok: true, location: res.location, sizeBytes: res.sizeBytes };
  } catch (err) {
    logger.error("Failed to export PS1 save to .mcs", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

registerEvent("exportPs1Save", exportPs1Save);
