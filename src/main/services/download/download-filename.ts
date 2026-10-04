const isMagnetUri = (value: string) =>
  value.trim().toLowerCase().startsWith("magnet:");

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
