export const BUNDLED_UMU_VERSION = "1.4.4";

export interface UmuRelease {
  version: string;
  downloadUrl: string;
  sha256: string;
}

const ZIPAPP_ASSET_PATTERN = /^umu-launcher-(\d+(?:\.\d+)*)-zipapp\.tar$/;
const SHA256_DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/i;
const VERSION_PATTERN = /^\d+(?:\.\d+)*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isValidUmuVersion = (version: unknown): version is string =>
  typeof version === "string" && VERSION_PATTERN.test(version);

export const compareUmuVersions = (left: string, right: string) => {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
};

export const parseUmuRelease = (payload: unknown): UmuRelease | null => {
  if (!isRecord(payload) || payload.draft === true || payload.prerelease) {
    return null;
  }
  if (!Array.isArray(payload.assets)) return null;

  for (const asset of payload.assets) {
    if (!isRecord(asset) || typeof asset.name !== "string") continue;
    const nameMatch = ZIPAPP_ASSET_PATTERN.exec(asset.name);
    if (!nameMatch) continue;
    const digestMatch =
      typeof asset.digest === "string"
        ? SHA256_DIGEST_PATTERN.exec(asset.digest)
        : null;
    if (
      !digestMatch ||
      typeof asset.browser_download_url !== "string" ||
      !asset.browser_download_url.startsWith("https://github.com/")
    ) {
      return null;
    }
    return {
      version: nameMatch[1],
      downloadUrl: asset.browser_download_url,
      sha256: digestMatch[1].toLowerCase(),
    };
  }

  return null;
};
