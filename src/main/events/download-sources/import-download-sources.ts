import fs from "node:fs";
import { randomUUID } from "node:crypto";

import { downloadSourcesSublevel } from "@main/level";
import { logger } from "@main/services";
import type {
  DownloadSource,
  DownloadSourcesConfig,
  DownloadSourcesImportResult,
} from "@types";
import { DownloadSourceStatus } from "@shared";
import { registerEvent } from "../register-event";

const SUPPORTED_CONFIG_VERSION = 1;
const DOWNLOAD_SOURCE_STATUS_SET = new Set(
  Object.values(DownloadSourceStatus) as string[]
);

type RawDownloadSource = Partial<DownloadSource> & {
  id?: string;
  url?: string;
  name?: string;
};

const sanitizeDownloadCount = (value: unknown): number => {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || !isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
};

const sanitizeDate = (value: unknown): string => {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }

  return new Date().toISOString();
};

const normalizeSource = (raw: RawDownloadSource): DownloadSource => {
  const url = typeof raw.url === "string" ? raw.url.trim() : "";

  if (!url) {
    throw new Error("INVALID_URL");
  }

  const initialId = typeof raw.id === "string" ? raw.id.trim() : "";
  const id = initialId.length ? initialId : randomUUID();

  const name =
    typeof raw.name === "string" && raw.name.trim().length
      ? raw.name.trim()
      : url;

  const rawStatus = typeof raw.status === "string" ? raw.status : undefined;
  const status =
    rawStatus &&
    DOWNLOAD_SOURCE_STATUS_SET.has(rawStatus as DownloadSourceStatus)
      ? (rawStatus as DownloadSourceStatus)
      : DownloadSourceStatus.PendingMatching;

  const fingerprint =
    typeof raw.fingerprint === "string" && raw.fingerprint.trim().length
      ? raw.fingerprint.trim()
      : undefined;

  return {
    id,
    name,
    url,
    status,
    downloadCount: sanitizeDownloadCount(raw.downloadCount),
    fingerprint,
    isRemote: raw.isRemote ? true : undefined,
    createdAt: sanitizeDate(raw.createdAt),
  };
};

const importDownloadSources = async (
  _event: Electron.IpcMainInvokeEvent,
  filePath: string
): Promise<DownloadSourcesImportResult> => {
  if (!filePath) {
    throw new Error("FILE_PATH_REQUIRED");
  }

  let fileContent: string;

  try {
    fileContent = await fs.promises.readFile(filePath, "utf-8");
  } catch (error) {
    logger.error("Failed to read download sources file", error);
    throw new Error("DOWNLOAD_SOURCES_FILE_READ_FAILED");
  }

  let parsedConfig: DownloadSourcesConfig;

  try {
    parsedConfig = JSON.parse(fileContent) as DownloadSourcesConfig;
  } catch (error) {
    logger.error("Invalid download sources configuration file", error);
    throw new Error("DOWNLOAD_SOURCES_INVALID_JSON");
  }

  if (!parsedConfig || typeof parsedConfig !== "object") {
    throw new Error("DOWNLOAD_SOURCES_INVALID_CONFIG");
  }

  if (
    typeof parsedConfig.version !== "number" ||
    Number.isNaN(parsedConfig.version)
  ) {
    throw new Error("DOWNLOAD_SOURCES_INVALID_VERSION");
  }

  if (parsedConfig.version > SUPPORTED_CONFIG_VERSION) {
    throw new Error("DOWNLOAD_SOURCES_UNSUPPORTED_VERSION");
  }

  if (!Array.isArray(parsedConfig.sources)) {
    throw new Error("DOWNLOAD_SOURCES_INVALID_SOURCES");
  }

  const existingSources = await downloadSourcesSublevel.values().all();

  const existingUrls = new Set(
    existingSources.map((source) => source.url.trim().toLowerCase())
  );
  const existingIds = new Set(existingSources.map((source) => source.id));

  const importedIds = new Set<string>();
  const importedUrls = new Set<string>();

  let imported = 0;
  let skipped = 0;

  for (const rawSource of parsedConfig.sources as RawDownloadSource[]) {
    try {
      const normalized = normalizeSource(rawSource);
      const normalizedUrl = normalized.url.toLowerCase();

      if (existingUrls.has(normalizedUrl) || importedUrls.has(normalizedUrl)) {
        skipped += 1;
        continue;
      }

      let sourceId = normalized.id;

      if (existingIds.has(sourceId) || importedIds.has(sourceId)) {
        sourceId = randomUUID();
      }

      const sourceToPersist: DownloadSource = {
        ...normalized,
        id: sourceId,
      };

      await downloadSourcesSublevel.put(sourceId, sourceToPersist);

      existingIds.add(sourceId);
      existingUrls.add(normalizedUrl);
      importedIds.add(sourceId);
      importedUrls.add(normalizedUrl);
      imported += 1;
    } catch (error) {
      skipped += 1;
      logger.error("Failed to import download source", error);
    }
  }

  return {
    imported,
    skipped,
  };
};

registerEvent("importDownloadSources", importDownloadSources);
