export interface ArchiveOrgFileUri {
  identifier: string;
  path: string;
}

const ARCHIVE_ORG_BASE_URL = "https://archive.org";
const CANONICAL_HOSTS = new Set(["archive.org", "www.archive.org"]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/;
const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9]{1,10}$/;

const decodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const buildFilePath = (segments: string[]) => {
  const filePath = segments
    .map(decodeSegment)
    .filter((segment) => segment !== "." && segment !== "..")
    .join("/");

  return FILE_EXTENSION_PATTERN.test(filePath) ? filePath : null;
};

const parseFileUri = (
  segments: string[],
  identifierIndex: number,
  pathname: string
): ArchiveOrgFileUri | null => {
  if (pathname.endsWith("/")) return null;

  const identifier = segments[identifierIndex];
  if (!identifier || !IDENTIFIER_PATTERN.test(identifier)) return null;

  const path = buildFilePath(segments.slice(identifierIndex + 1));
  if (!path) return null;

  return { identifier, path };
};

export const parseArchiveOrgFileUri = (
  uri: string
): ArchiveOrgFileUri | null => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(uri.trim());
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return null;
  }

  const host = parsedUrl.hostname.toLowerCase();
  const segments = parsedUrl.pathname.split("/").filter(Boolean);

  if (CANONICAL_HOSTS.has(host)) {
    if (segments[0] !== "download") return null;
    return parseFileUri(segments, 1, parsedUrl.pathname);
  }

  if (!host.endsWith(".archive.org")) return null;

  const itemsIndex = segments.indexOf("items");
  if (itemsIndex === -1) return null;

  return parseFileUri(segments, itemsIndex + 1, parsedUrl.pathname);
};

export const isArchiveOrgFileUri = (uri: string) =>
  parseArchiveOrgFileUri(uri) !== null;

export const resolveArchiveOrgFile = (uri: string) => {
  const parsedUri = parseArchiveOrgFileUri(uri);
  if (!parsedUri) return null;

  const { identifier, path } = parsedUri;
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return {
    url: `${ARCHIVE_ORG_BASE_URL}/download/${encodeURIComponent(identifier)}/${encodedPath}`,
    filename: path.split("/").at(-1) ?? path,
  };
};
