import { BrowserWindow, dialog } from "electron";
import { open } from "node:fs/promises";
import { downloadSourcesSublevel } from "@main/level";
import {
  MAX_DOWNLOAD_SOURCE_BACKUP_BYTES,
  importDownloadSourceUrls,
  parseDownloadSourceBackup,
} from "@main/services/download-source-backup";
import { addDownloadSource } from "@main/services/add-download-source";
import { registerEvent } from "../register-event";
import { downloadSourceOperationGate } from "@main/services/download-source-operation-gate";

const importDownloadSources = async (event: Electron.IpcMainInvokeEvent) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) throw new Error("Source window is not available");

  const result = await dialog.showOpenDialog(senderWindow, {
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const file = await open(result.filePaths[0], "r");
  let contents: string;
  try {
    if ((await file.stat()).size > MAX_DOWNLOAD_SOURCE_BACKUP_BYTES) {
      throw new Error("Download source backup is too large");
    }
    // Bound the read even if the selected file changes after stat().
    const buffer = Buffer.alloc(MAX_DOWNLOAD_SOURCE_BACKUP_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_DOWNLOAD_SOURCE_BACKUP_BYTES) {
      throw new Error("Download source backup is too large");
    }
    contents = buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }

  const urls = parseDownloadSourceBackup(contents);
  return downloadSourceOperationGate.run(async () => {
    const existingSources = await downloadSourcesSublevel.values().all();
    return importDownloadSourceUrls(urls, existingSources, addDownloadSource);
  });
};

registerEvent("importDownloadSources", importDownloadSources);
