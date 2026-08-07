import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BrowserWindow, dialog } from "electron";

import { registerEvent } from "../register-event";
import { WindowManager, LocalDownloadSources, logger } from "@main/services";
import { downloadSourcesSublevel } from "@main/level";
import { DownloadSourceStatus } from "@shared";
import type { DownloadSource, DownloadSourceDownload } from "@types";

interface ParsedLocalSource {
  name: string;
  downloads: DownloadSourceDownload[];
}

const parseAndValidate = (raw: string): ParsedLocalSource => {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("invalid_json");
  }

  if (!data || typeof data !== "object") throw new Error("invalid_source");

  const source = data as Record<string, unknown>;
  const name = typeof source.name === "string" ? source.name : "";
  const downloads = source.downloads;

  if (!name || !Array.isArray(downloads)) throw new Error("invalid_source");

  const validDownloads: DownloadSourceDownload[] = [];
  for (const item of downloads) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    if (typeof d.title !== "string" || !Array.isArray(d.uris)) continue;
    validDownloads.push({
      title: d.title,
      uris: (d.uris as unknown[]).filter(
        (u): u is string => typeof u === "string"
      ),
      uploadDate: typeof d.uploadDate === "string" ? d.uploadDate : "",
      fileSize: typeof d.fileSize === "string" ? d.fileSize : "",
    });
  }

  if (validDownloads.length === 0) throw new Error("invalid_source");

  return { name, downloads: validDownloads };
};

const addLocalDownloadSource = async (
  event: Electron.IpcMainInvokeEvent
): Promise<DownloadSource | null> => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const parentWindow = senderWindow ?? WindowManager.mainWindow;
  if (!parentWindow) throw new Error("Main window is not available");

  const result = await dialog.showOpenDialog(parentWindow, {
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];

  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = parseAndValidate(raw);

    const existingSources = await downloadSourcesSublevel.values().all();
    if (existingSources.some((s) => s.isLocal && s.url === filePath)) {
      throw new Error("already exists");
    }

    const source: DownloadSource = {
      id: `local-${randomUUID()}`,
      name: parsed.name,
      url: filePath,
      status: DownloadSourceStatus.Matched,
      downloadCount: parsed.downloads.length,
      isLocal: true,
      createdAt: new Date().toISOString(),
    };

    await LocalDownloadSources.addSource(source, parsed.downloads);
    logger.info(
      `Added local download source "${parsed.name}" with ${parsed.downloads.length} downloads`
    );

    return source;
  } catch (error) {
    logger.error("Failed to add local download source:", error);
    throw error;
  }
};

registerEvent("addLocalDownloadSource", addLocalDownloadSource);
