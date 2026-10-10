import { DownloadError } from "../../../shared/constants.js";
import type { RealDebridTorrentInfo } from "../../../types/download.types.js";
import { setTimeout as sleep } from "node:timers/promises";

const LINK_POLL_ATTEMPTS = 10;
const LINK_POLL_DELAY_MS = 1000;

const waitForNextPoll = (signal?: AbortSignal) =>
  sleep(LINK_POLL_DELAY_MS, undefined, { signal });

export function throwIfRealDebridTorrentFailed(info: RealDebridTorrentInfo) {
  if (["error", "dead", "virus", "magnet_error"].includes(info.status)) {
    throw new Error(`Real-Debrid torrent failed (${info.status}).`);
  }
}

export async function waitForRealDebridLinks(
  getInfo: () => Promise<RealDebridTorrentInfo>,
  wait: (signal?: AbortSignal) => Promise<void> = waitForNextPoll,
  initialInfo?: RealDebridTorrentInfo,
  signal?: AbortSignal
) {
  return pollRealDebridLinks(getInfo, wait, initialInfo, signal);
}

async function pollRealDebridLinks(
  getInfo: () => Promise<RealDebridTorrentInfo>,
  wait: (signal?: AbortSignal) => Promise<void>,
  initialInfo?: RealDebridTorrentInfo,
  signal?: AbortSignal,
  attempt = 0
): Promise<{
  info: RealDebridTorrentInfo;
  selectedFiles: RealDebridTorrentInfo["files"];
} | null> {
  signal?.throwIfAborted();
  const info = attempt === 0 && initialInfo ? initialInfo : await getInfo();
  signal?.throwIfAborted();
  throwIfRealDebridTorrentFailed(info);
  if (info.status !== "downloaded") return null;
  const selectedFiles = info.files.filter((file) => file.selected);
  if (selectedFiles.length > 0 && selectedFiles.length === info.links.length)
    return { info, selectedFiles };
  if (attempt === LINK_POLL_ATTEMPTS - 1) {
    throw new Error(DownloadError.RealDebridLinksNotReady, {
      cause: { selectedFiles: selectedFiles.length, links: info.links.length },
    });
  }
  await wait(signal);
  return pollRealDebridLinks(getInfo, wait, undefined, signal, attempt + 1);
}

export function isRealDebridArchiveCandidate(
  info: RealDebridTorrentInfo,
  selectedIndices?: number[]
) {
  const selectedFiles = info.files.filter((file) => file.selected);

  if (
    info.status !== "downloaded" ||
    info.links.length !== 1 ||
    selectedFiles.length < 2 ||
    !Number.isFinite(Date.parse(info.ended))
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
  selectedIndices?: number[]
) {
  if (!isRealDebridArchiveCandidate(info, selectedIndices)) return false;

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
  const selected = info.files.filter((file) => file.selected);
  const requested = new Set(
    selectedIndices ?? info.files.map((file) => file.id)
  );
  return (
    requested.size === selected.length &&
    selected.every((file) => requested.has(file.id))
  );
}
