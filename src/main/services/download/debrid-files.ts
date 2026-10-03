import type { TorrentFilesResponse } from "@types";
import { createHash } from "node:crypto";
import { DownloadError, Downloader } from "../../../shared/constants.js";

const pendingErrors = new Map<Downloader, ReadonlySet<string>>([
  [Downloader.TorBox, new Set([DownloadError.TorBoxTorrentNotReady])],
  [
    Downloader.RealDebrid,
    new Set([
      DownloadError.NotCachedOnRealDebrid,
      DownloadError.RealDebridTorrentNotReady,
      DownloadError.RealDebridLinksNotReady,
    ]),
  ],
  [
    Downloader.Premiumize,
    new Set([
      DownloadError.NotCachedOnPremiumize,
      DownloadError.PremiumizeTransferStarted,
    ]),
  ],
  [Downloader.AllDebrid, new Set([DownloadError.NotCachedOnAllDebrid])],
]);

export function isDebridPendingError(
  error: unknown,
  downloader: Downloader
): boolean {
  if (!(error instanceof Error)) return false;
  return pendingErrors.get(downloader)?.has(error.message) ?? false;
}

export interface DebridFile {
  index: number;
  path: string;
  size: number;
}

export function getDebridRootFolderName(paths: string[]): string | undefined {
  if (paths.length < 2) return undefined;
  const components = paths.map((item) => item.split(/[\\/]/).filter(Boolean));
  const root = components[0][0];
  return root &&
    root !== "." &&
    root !== ".." &&
    components.every((parts) => parts.length > 1 && parts[0] === root)
    ? root
    : undefined;
}

export function stableDebridFileIndex(path: string, size: number): number {
  const digest = createHash("sha256")
    .update(`${path.normalize("NFC")}\0${size}`)
    .digest("hex");
  return Number.parseInt(digest.slice(0, 13), 16);
}

export function isZipDownloadUrl(url: string, filename?: string): boolean {
  if (filename?.toLowerCase().endsWith(".zip")) return true;
  try {
    return decodeURIComponent(new URL(url).pathname)
      .toLowerCase()
      .endsWith(".zip");
  } catch {
    return false;
  }
}

export function assertRealDebridFileLink(
  expectedPath: string,
  expectedSize: number,
  actualName: string,
  actualSize: number
): void {
  const expected = expectedPath
    .split(/[\\/]/)
    .at(-1)
    ?.normalize("NFC")
    .toLowerCase();
  const actual = actualName
    .split(/[\\/]/)
    .at(-1)
    ?.normalize("NFC")
    .toLowerCase();
  if (
    (expectedSize > 0 && actualSize !== expectedSize) ||
    (expected && actual && expected !== actual)
  ) {
    throw new Error(
      "Real-Debrid returned a link for a different torrent file."
    );
  }
}

export function selectDebridFiles<T extends DebridFile>(
  files: T[],
  indices?: number[]
): T[] {
  if (new Set(files.map((file) => file.index)).size !== files.length) {
    throw new Error("Debrid returned files with duplicate identities.");
  }
  if (indices === undefined) return files;

  const requested = new Set(indices);
  const selected = files.filter((file) => requested.has(file.index));
  if (
    requested.size === 0 ||
    selected.length !== requested.size ||
    indices.some((index) => !Number.isSafeInteger(index))
  ) {
    throw new Error("The selected debrid files are no longer available.");
  }
  return selected;
}

export function toTorrentFilesResponse(
  name: string,
  files: DebridFile[]
): TorrentFilesResponse {
  return {
    infoHash: "",
    name,
    totalSize: files.reduce((total, file) => total + file.size, 0),
    files: files.map((file) => ({
      index: file.index,
      path: file.path,
      length: file.size,
    })),
  };
}
