import axios from "axios";
import fs from "node:fs/promises";
import path from "node:path";

import { SystemPath } from "@main/services/system-path";

import { buildHydraManifestIndex } from "./indexer";
import { getSaveManifestSource } from "./source";
import type { HydraManifestIndex } from "./types";

const MANIFEST_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const RAW_MANIFEST_FILE_NAME = "cloud-save-manifest.yaml";
const INDEX_FILE_NAME = "cloud-save-manifest-index.json";

let manifestIndexCache: HydraManifestIndex | null = null;
let manifestIndexPromise: Promise<HydraManifestIndex> | null = null;

const getRawManifestCachePath = () =>
  path.join(SystemPath.getPath("userData"), RAW_MANIFEST_FILE_NAME);

const getManifestIndexCachePath = () =>
  path.join(SystemPath.getPath("userData"), INDEX_FILE_NAME);

const isHydraManifestIndex = (value: unknown): value is HydraManifestIndex => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<HydraManifestIndex>;
  return (
    candidate.version === 1 &&
    typeof candidate.fetchedAt === "number" &&
    typeof candidate.sourceUrl === "string" &&
    candidate.games !== null &&
    typeof candidate.games === "object"
  );
};

const isManifestIndexExpired = (index: HydraManifestIndex): boolean =>
  index.fetchedAt + MANIFEST_CACHE_TTL_MS <= Date.now();

const writeFileAtomically = async (
  filePath: string,
  content: string
): Promise<void> => {
  const directoryPath = path.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  await fs.mkdir(directoryPath, { recursive: true });

  try {
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

const readRawManifestFromDisk = async (): Promise<string | null> => {
  try {
    return await fs.readFile(getRawManifestCachePath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
};

const readRawManifestFetchedAtFromDisk = async (): Promise<number | null> => {
  try {
    const stats = await fs.stat(getRawManifestCachePath());
    return stats.mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
};

const writeRawManifestToDisk = async (rawYaml: string): Promise<void> => {
  await writeFileAtomically(getRawManifestCachePath(), rawYaml);
};

const readManifestIndexFromDisk =
  async (): Promise<HydraManifestIndex | null> => {
    try {
      const rawIndex = await fs.readFile(getManifestIndexCachePath(), "utf8");
      const parsed = JSON.parse(rawIndex) as unknown;

      return isHydraManifestIndex(parsed) ? parsed : null;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" ||
        error instanceof SyntaxError
      ) {
        return null;
      }

      throw error;
    }
  };

const writeManifestIndexToDisk = async (
  index: HydraManifestIndex
): Promise<void> => {
  await writeFileAtomically(
    getManifestIndexCachePath(),
    JSON.stringify(index, null, 2)
  );
};

const rebuildManifestIndexFromRawYaml = (
  rawYaml: string,
  sourceUrl: string,
  fetchedAt: number
): HydraManifestIndex => {
  return buildHydraManifestIndex(rawYaml, sourceUrl, fetchedAt);
};

const loadHydraManifestIndex = async (): Promise<HydraManifestIndex> => {
  let fallbackManifestIndex = manifestIndexCache;

  const diskManifestIndex = await readManifestIndexFromDisk();
  if (diskManifestIndex) {
    manifestIndexCache = diskManifestIndex;

    if (!isManifestIndexExpired(diskManifestIndex)) {
      return diskManifestIndex;
    }

    fallbackManifestIndex = diskManifestIndex;
  }

  const rawManifestYaml = await readRawManifestFromDisk();
  if (rawManifestYaml) {
    try {
      const rawManifestFetchedAt =
        (await readRawManifestFetchedAtFromDisk()) ?? Date.now();
      const sourceUrl =
        diskManifestIndex?.sourceUrl ?? getSaveManifestSource().url;
      const rebuiltManifestIndex = rebuildManifestIndexFromRawYaml(
        rawManifestYaml,
        sourceUrl,
        rawManifestFetchedAt
      );

      await writeManifestIndexToDisk(rebuiltManifestIndex);
      manifestIndexCache = rebuiltManifestIndex;

      if (!isManifestIndexExpired(rebuiltManifestIndex)) {
        return rebuiltManifestIndex;
      }

      fallbackManifestIndex = rebuiltManifestIndex;
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
    }
  }

  try {
    const downloadedManifest = await downloadRawManifest();
    const freshManifestIndex = rebuildManifestIndexFromRawYaml(
      downloadedManifest.rawYaml,
      downloadedManifest.sourceUrl,
      downloadedManifest.fetchedAt
    );

    await writeRawManifestToDisk(downloadedManifest.rawYaml);
    await writeManifestIndexToDisk(freshManifestIndex);

    manifestIndexCache = freshManifestIndex;
    return freshManifestIndex;
  } catch (error) {
    if (fallbackManifestIndex) {
      manifestIndexCache = fallbackManifestIndex;
      return fallbackManifestIndex;
    }

    throw error;
  }
};

export const downloadRawManifest = async (): Promise<{
  rawYaml: string;
  sourceUrl: string;
  fetchedAt: number;
}> => {
  const manifestSource = getSaveManifestSource();
  const { data } = await axios.get<string>(manifestSource.url, {
    responseType: "text",
  });

  return {
    rawYaml: data,
    sourceUrl: manifestSource.url,
    fetchedAt: Date.now(),
  };
};

export const getHydraManifestIndex = async (): Promise<HydraManifestIndex> => {
  if (manifestIndexCache && !isManifestIndexExpired(manifestIndexCache)) {
    return manifestIndexCache;
  }

  manifestIndexPromise ??= loadHydraManifestIndex().finally(() => {
    manifestIndexPromise = null;
  });

  return manifestIndexPromise;
};

export const __resetManifestCacheForTests = () => {
  manifestIndexCache = null;
  manifestIndexPromise = null;
};
