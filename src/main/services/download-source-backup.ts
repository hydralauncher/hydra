import type { DownloadSourceImportResult } from "@types";

export const MAX_DOWNLOAD_SOURCE_BACKUP_BYTES = 1024 * 1024;

interface SourceUrl {
  url: string;
}

const sourceUrlKey = (value: string) => {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Invalid download source URL protocol");
  }
  return url.href;
};

export const serializeDownloadSources = (sources: SourceUrl[]) =>
  JSON.stringify(
    { version: 1, sources: sources.map(({ url }) => ({ url })) },
    null,
    2
  ) + "\n";

export const parseDownloadSourceBackup = (contents: string): string[] => {
  if (Buffer.byteLength(contents, "utf8") > MAX_DOWNLOAD_SOURCE_BACKUP_BYTES) {
    throw new Error("Download source backup is too large");
  }

  const backup = JSON.parse(contents.replace(/^\uFEFF/, ""));
  if (
    !backup ||
    backup.version !== 1 ||
    !Array.isArray(backup.sources) ||
    backup.sources.length === 0
  ) {
    throw new Error("Invalid download source backup");
  }

  // Validate the entire file before adding any sources.
  return backup.sources.map((source: unknown) => {
    if (
      !source ||
      typeof source !== "object" ||
      !("url" in source) ||
      typeof source.url !== "string"
    ) {
      throw new Error("Invalid download source backup entry");
    }
    const url = source.url.trim();
    sourceUrlKey(url);
    return url;
  });
};

export const importDownloadSourceUrls = async (
  urls: string[],
  existingSources: SourceUrl[],
  addSource: (url: string) => Promise<unknown>
): Promise<DownloadSourceImportResult> => {
  const knownUrls = new Set(
    existingSources.map(({ url }) => {
      try {
        return sourceUrlKey(url);
      } catch {
        return url;
      }
    })
  );
  const result: DownloadSourceImportResult = {
    imported: 0,
    skipped: 0,
    failed: [],
  };

  for (const url of urls) {
    const key = sourceUrlKey(url);
    if (knownUrls.has(key)) {
      result.skipped++;
      continue;
    }
    knownUrls.add(key);

    try {
      await addSource(url);
      result.imported++;
    } catch {
      result.failed.push(url);
    }
  }

  return result;
};
