import type { TorBoxTorrentInfo } from "@types";

export interface TorBoxDownloadFile {
  id: number;
  path: string;
  size: number;
}

export interface TorBoxDownloadManifest {
  torrentId: number;
  name: string;
  files: TorBoxDownloadFile[];
  totalSize: number;
}

const sanitizeSegment = (segment: string): string => {
  const cleaned = Array.from(segment.normalize("NFC"), (char) =>
    char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? "_" : char
  )
    .join("")
    .trim()
    .replaceAll(/[. ]+$/g, "_");
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)
    ? `_${cleaned}`
    : cleaned;
};

export function buildTorBoxDownloadManifest(
  torrent: TorBoxTorrentInfo
): TorBoxDownloadManifest {
  const name = sanitizeSegment(torrent.name);
  if (!name || name === "." || name === ".." || !torrent.files?.length) {
    throw new Error("TorBox did not provide downloadable files.");
  }

  const seenIds = new Set<number>();
  const seenPaths = new Set<string>();
  const seenDirectories = new Set<string>();
  const files = torrent.files.map((file): TorBoxDownloadFile => {
    if (file.zipped) {
      throw new Error(
        "TorBox has already zipped this torrent, so its original files are unavailable."
      );
    }
    if (!Number.isSafeInteger(file.id) || seenIds.has(file.id)) {
      throw new Error("TorBox returned an invalid file ID.");
    }
    seenIds.add(file.id);

    const rawPath = file.name || file.short_name;
    if (!rawPath || /^[\\/]/.test(rawPath) || /^[a-zA-Z]:/.test(rawPath)) {
      throw new Error("TorBox returned an unsafe file path.");
    }

    const parts = rawPath.split(/[\\/]+/);
    if (
      parts.some((part) => !part || part === "." || part === "..") ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0
    ) {
      throw new Error("TorBox returned an unsafe file path or size.");
    }

    const relativeParts =
      parts.length > 1 &&
      sanitizeSegment(parts[0]).toLowerCase() === name.toLowerCase()
        ? parts.slice(1)
        : parts;
    const safeParts = relativeParts.map(sanitizeSegment);
    if (
      safeParts.length === 0 ||
      safeParts.some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error("TorBox returned an unsafe file path.");
    }

    const filePath = [name, ...safeParts].join("/");
    const collisionKey = filePath.toLowerCase();
    const directoryKeys = safeParts
      .slice(0, -1)
      .map((_, index) =>
        [name, ...safeParts.slice(0, index + 1)].join("/").toLowerCase()
      );
    if (
      seenPaths.has(collisionKey) ||
      seenDirectories.has(collisionKey) ||
      directoryKeys.some((directory) => seenPaths.has(directory))
    ) {
      throw new Error("TorBox returned files with the same local path.");
    }
    seenPaths.add(collisionKey);
    directoryKeys.forEach((directory) => seenDirectories.add(directory));

    return { id: file.id, path: filePath, size: file.size };
  });

  return {
    torrentId: torrent.id,
    name,
    files,
    totalSize: files.reduce((total, file) => total + file.size, 0),
  };
}

export function selectTorBoxFiles(
  manifest: TorBoxDownloadManifest,
  fileIds?: number[]
): TorBoxDownloadFile[] {
  if (fileIds === undefined) return manifest.files;
  const requested = new Set(fileIds);
  const selected = manifest.files.filter((file) => requested.has(file.id));
  if (selected.length === 0 || selected.length !== requested.size) {
    throw new Error("The selected TorBox files are no longer available.");
  }
  return selected;
}
