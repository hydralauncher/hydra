import { BrowserWindow, dialog } from "electron";
import { writeFile } from "node:fs/promises";
import { downloadSourcesSublevel } from "@main/level";
import { serializeDownloadSources } from "@main/services/download-source-backup";
import { registerEvent } from "../register-event";

const exportDownloadSources = async (event: Electron.IpcMainInvokeEvent) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) throw new Error("Source window is not available");

  const sources = await downloadSourcesSublevel.values().all();
  if (!sources.length) throw new Error("No download sources to export");

  const result = await dialog.showSaveDialog(senderWindow, {
    defaultPath: "hydra-download-sources.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return false;

  await writeFile(result.filePath, serializeDownloadSources(sources), "utf8");
  return true;
};

registerEvent("exportDownloadSources", exportDownloadSources);
