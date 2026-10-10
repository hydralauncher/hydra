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
  archiveOnly?: boolean;
}

const decodeHtmlEntities = (value: string): string =>
  value.replace(
    /&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi,
    (entity, code: string) => {
      const normalized = code.toLowerCase();
      if (normalized.startsWith("#")) {
        const hex = normalized.startsWith("#x");
        const point = Number.parseInt(
          normalized.slice(hex ? 2 : 1),
          hex ? 16 : 10
        );
        return point > 0 &&
          point <= 0x10ffff &&
          !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point)
          : entity;
      }
      return (
        {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          nbsp: " ",
        }[normalized] ?? entity
      );
    }
  );

const sanitizeSegment = (segment: string): string => {
  const trimmed = Array.from(
    decodeHtmlEntities(segment).normalize("NFC"),
    (char) =>
      char.codePointAt(0)! < 32 || /[<>:"/\\|?*]/.test(char) ? "_" : char
  )
    .join("")
    .trim();
  let lastNonDot = trimmed.length - 1;
  while (lastNonDot >= 0 && trimmed[lastNonDot] === ".") lastNonDot--;
  const cleaned =
    lastNonDot === trimmed.length - 1
      ? trimmed
      : `${trimmed.slice(0, lastNonDot + 1)}_`;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)
    ? `_${cleaned}`
    : cleaned;
};

export function buildTorBoxDownloadManifest(
  torrent: TorBoxTorrentInfo,
  magnetName?: string
): TorBoxDownloadManifest {
  if (!Number.isSafeInteger(torrent.id) || torrent.id < 0) {
    throw new Error("TorBox returned an invalid torrent ID.");
  }
  const sharedRoot = torrent.files?.[0]?.name?.split(/[\\/]+/)[0];
  const hasSharedRoot =
    sharedRoot &&
    torrent.files.every((file) => {
      const parts = file.name?.split(/[\\/]+/) ?? [];
      return (
        parts.length > 1 &&
        sanitizeSegment(parts[0]).toLowerCase() ===
          sanitizeSegment(sharedRoot).toLowerCase()
      );
    });
  const providerName = hasSharedRoot ? sharedRoot : torrent.name;
  const isOpaqueName = (value: string | undefined) =>
    /^[a-f0-9]{32,64}(?:\.zip)?$/i.test(value ?? "");
  const name = sanitizeSegment(
    isOpaqueName(providerName) && magnetName && !isOpaqueName(magnetName)
      ? magnetName
      : providerName
  );
  if (!name || name === "." || name === ".." || !torrent.files?.length) {
    throw new Error("TorBox did not provide downloadable files.");
  }

  const seenIds = new Set<number>();
  const seenPaths = new Set<string>();
  const seenDirectories = new Set<string>();
  const files = torrent.files.map((file): TorBoxDownloadFile => {
    if (!Number.isSafeInteger(file.id) || file.id < 0 || seenIds.has(file.id)) {
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
      sanitizeSegment(parts[0]).toLowerCase() ===
        sanitizeSegment(providerName).toLowerCase()
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

  const totalSize = files.reduce((total, file) => total + file.size, 0);
  if (!Number.isSafeInteger(totalSize)) {
    throw new TypeError("TorBox returned an invalid total file size.");
  }
  return {
    torrentId: torrent.id,
    name,
    files,
    totalSize,
    archiveOnly: files.length === 1 && torrent.files[0].zipped === true,
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
