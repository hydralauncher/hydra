import type { TorrentFilesResponse } from "@types";
import { createHash } from "node:crypto";

export interface DebridFile {
  index: number;
  path: string;
  size: number;
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
