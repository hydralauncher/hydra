const FIRST_VOLUME_SUFFIXES = [/\.part0*1\.rar$/i, /\.(?:7z|zip|rar)\.0*1$/i];

/** Returns ordered part URIs, or undefined for a single-link download. */
export function getDownloadParts(
  uri: string,
  parts: unknown
): string[] | undefined {
  if (parts === undefined || parts === null) return undefined;
  if (
    !Array.isArray(parts) ||
    parts.length < 2 ||
    parts[0] !== uri ||
    parts.some((part) => typeof part !== "string" || !part) ||
    new Set(parts).size !== parts.length
  ) {
    throw new Error("The multi-part download links are invalid.");
  }
  return parts;
}

/** Names the folder that holds every part, from the first part's filename. */
export function getMultipartFolderName(firstPartFilename: string): string {
  const filename = firstPartFilename.split(/[\\/]/).at(-1) ?? "";
  let base = filename;
  for (const suffix of FIRST_VOLUME_SUFFIXES) base = base.replace(suffix, "");
  if (base === filename) base = filename.replace(/\.[^.]+$/, "");
  return base.replace(/[\s._-]+$/, "") || "download";
}

/**
 * Split archives use one volume size, so unknown parts are estimated from the
 * largest known part. Only the last part is smaller.
 */
export function estimateMultipartTotalBytes(
  sizes: (number | undefined)[],
  fallback: number | null
): number {
  const known = sizes.filter(
    (size): size is number => typeof size === "number" && size > 0
  );
  const knownBytes = known.reduce((sum, size) => sum + size, 0);
  if (known.length === sizes.length) return knownBytes;
  if (known.length === 0) return fallback ?? 0;
  return knownBytes + (sizes.length - known.length) * Math.max(...known);
}
