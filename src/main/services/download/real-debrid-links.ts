import { DownloadError } from "../../../shared/constants.js";
import type { RealDebridTorrentInfo } from "../../../types/download.types.js";

const LINK_POLL_ATTEMPTS = 10;
const LINK_POLL_DELAY_MS = 1000;
const PROVIDER_LINK_SETTLE_MS = 60_000;

const waitForNextPoll = () =>
  new Promise<void>((resolve) => setTimeout(resolve, LINK_POLL_DELAY_MS));

export async function waitForRealDebridLinks(
  getInfo: () => Promise<RealDebridTorrentInfo>,
  wait: () => Promise<void> = waitForNextPoll
) {
  for (let attempt = 0; attempt < LINK_POLL_ATTEMPTS; attempt++) {
    const info = await getInfo();
    if (info.status !== "downloaded") return null;

    const selectedFiles = info.files.filter((file) => file.selected);
    if (
      selectedFiles.length > 0 &&
      selectedFiles.length === info.links.length
    ) {
      return { info, selectedFiles };
    }

    if (attempt === LINK_POLL_ATTEMPTS - 1) {
      throw new Error(DownloadError.RealDebridLinksNotReady, {
        cause: {
          selectedFiles: selectedFiles.length,
          links: info.links.length,
        },
      });
    }

    await wait();
  }

  throw new Error(DownloadError.RealDebridLinksNotReady);
}

export function isRealDebridArchiveCandidate(
  info: RealDebridTorrentInfo,
  selectedIndices?: number[],
  now = Date.now()
) {
  const selectedFiles = info.files.filter((file) => file.selected);
  const endedAt = Date.parse(info.ended);

  if (
    info.status !== "downloaded" ||
    info.links.length !== 1 ||
    selectedFiles.length < 2 ||
    !Number.isFinite(endedAt) ||
    now - endedAt < PROVIDER_LINK_SETTLE_MS
  ) {
    return false;
  }

  if (selectedIndices !== undefined) {
    const requested = new Set(selectedIndices);
    if (
      requested.size !== selectedFiles.length ||
      selectedFiles.some((file) => !requested.has(file.id))
    ) {
      return false;
    }
  }

  return true;
}

export function canUseRealDebridArchiveLink(
  info: RealDebridTorrentInfo,
  filename: string,
  selectedIndices?: number[],
  now = Date.now()
) {
  if (!isRealDebridArchiveCandidate(info, selectedIndices, now)) return false;

  const normalizedFilename = filename.split(/[\\/]/).at(-1)?.toLowerCase();
  if (!normalizedFilename || !/\.(zip|rar|7z)$/.test(normalizedFilename)) {
    return false;
  }

  return !info.files.some(
    (file) =>
      file.selected &&
      file.path.split(/[\\/]/).at(-1)?.toLowerCase() === normalizedFilename
  );
}

export function hasRealDebridSelection(
  info: RealDebridTorrentInfo,
  selectedIndices?: number[]
): boolean {
  if (!selectedIndices) return true;

  const selected = info.files.filter((file) => file.selected);
  const requested = new Set(selectedIndices);
  return (
    requested.size === selected.length &&
    selected.every((file) => requested.has(file.id))
  );
}
