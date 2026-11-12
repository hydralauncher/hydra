import path from "node:path";

const isMagnetUri = (value: string) =>
  value.trim().toLowerCase().startsWith("magnet:");

const decodeFilenameValue = (value: string): string | undefined => {
  const normalized = value.trim();
  if (!normalized) return undefined;

  const sanitize = (name: string) =>
    path
      .basename(name)
      .replaceAll(/[<>:"/\\|?*]/g, "_")
      .split("")
      .filter((char) => char.charCodeAt(0) >= 32)
      .join("")
      .trim();

  try {
    const decoded = decodeURIComponent(normalized);
    const sanitized = sanitize(decoded);
    return sanitized || undefined;
  } catch {
    const sanitized = sanitize(normalized);
    return sanitized || undefined;
  }
};

export const getContentDispositionFilename = (
  header: string | null
): string | undefined => {
  if (!header) return undefined;

  const filenameStarMatch = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (filenameStarMatch?.[1]) {
    const rawValue = filenameStarMatch[1].trim().replace(/^["']|["']$/g, "");
    const encodedPart = rawValue.includes("''")
      ? rawValue.split("''").slice(1).join("''")
      : rawValue;
    const decoded = decodeFilenameValue(encodedPart);
    if (decoded) return decoded;
  }

  const filenameMatch = /filename\s*=\s*([^;]+)/i.exec(header);
  if (filenameMatch?.[1]) {
    const rawValue = filenameMatch[1].trim().replace(/^["']|["']$/g, "");
    const decoded = decodeFilenameValue(rawValue);
    if (decoded) return decoded;
  }

  return undefined;
};

const getFilenameHintFromHash = (
  value: string | undefined
): string | undefined => {
  if (!value || isMagnetUri(value) || !value.includes("#")) return undefined;

  const hashPart = value.split("#")[1];

  if (!hashPart || hashPart.startsWith("http")) return undefined;
  if (!hashPart.includes(".") || hashPart.includes("=")) return undefined;

  return hashPart;
};

const getFilenameFromPath = (value: string): string | undefined => {
  if (isMagnetUri(value)) return undefined;

  try {
    const filename = new URL(value).pathname.split("/").at(-1);

    if (filename?.includes(".")) {
      return decodeURIComponent(filename);
    }
  } catch {
    return undefined;
  }

  return undefined;
};

export const extractDownloadFilename = (
  url: string,
  originalUrl?: string
): string | undefined =>
  getFilenameHintFromHash(originalUrl) ??
  getFilenameHintFromHash(url) ??
  getFilenameFromPath(url);
