export const DOWNLOAD_SOURCES_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export const getDownloadSourcesSignature = (sourceIds: string[]): string =>
  JSON.stringify([...sourceIds].sort((a, b) => a.localeCompare(b)));

export const shouldRefreshDownloadSources = ({
  lastCheckedAt,
  lastSourceSignature,
  sourceSignature,
  now,
}: {
  lastCheckedAt: number | null;
  lastSourceSignature: string | null;
  sourceSignature: string;
  now: number;
}): boolean =>
  lastCheckedAt === null ||
  lastSourceSignature !== sourceSignature ||
  now - lastCheckedAt >= DOWNLOAD_SOURCES_REFRESH_INTERVAL_MS;

export const shouldAdvanceDownloadSourcesBaseline = (
  isManualRefresh: boolean
): boolean => !isManualRefresh;
