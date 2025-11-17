import fs from "node:fs";

import { downloadSourcesSublevel } from "@main/level";
import { logger } from "@main/services";
import type {
  DownloadSource,
  DownloadSourcesConfig,
  DownloadSourcesExportResult,
} from "@types";
import { registerEvent } from "../register-event";

const CURRENT_CONFIG_VERSION = 1;

const normalizeSource = (source: DownloadSource): DownloadSource => {
  return {
    ...source,
    downloadCount: Number.isFinite(source.downloadCount)
      ? source.downloadCount
      : 0,
    createdAt:
      typeof source.createdAt === "string"
        ? source.createdAt
        : new Date().toISOString(),
  };
};

const exportDownloadSources = async (
  _event: Electron.IpcMainInvokeEvent,
  filePath: string
): Promise<DownloadSourcesExportResult> => {
  if (!filePath) {
    throw new Error("FILE_PATH_REQUIRED");
  }

  const normalizedPath = filePath.endsWith(".json")
    ? filePath
    : `${filePath}.json`;

  const sources = await downloadSourcesSublevel.values().all();

  const config: DownloadSourcesConfig = {
    version: CURRENT_CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    sources: sources.map(normalizeSource),
  };

  try {
    await fs.promises.writeFile(
      normalizedPath,
      JSON.stringify(config, null, 2),
      "utf-8"
    );
  } catch (error) {
    logger.error("Failed to export download sources", error);
    throw error;
  }

  return {
    exported: config.sources.length,
  };
};

registerEvent("exportDownloadSources", exportDownloadSources);
