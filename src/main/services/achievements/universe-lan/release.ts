import { createHash } from "node:crypto";

export const UNIVERSE_LAN_REPOSITORY = "grasmanek94/UniverseLAN";
export const UNIVERSE_LAN_RELEASES_URL = `https://api.github.com/repos/${UNIVERSE_LAN_REPOSITORY}/releases?per_page=20`;

const DOWNLOAD_URL_PREFIX = `https://github.com/${UNIVERSE_LAN_REPOSITORY}/releases/download/`;

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
  digest?: string | null;
}

export interface GitHubRelease {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GitHubReleaseAsset[];
}

export interface UniverseLanPackage {
  sdkVersion: string;
  build: string;
  assetName: string;
  downloadUrl: string;
  sha256: string;
}

const SHA256_DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/i;

const assetNamePattern = (sdkVersion: string) => {
  const escapedDot = String.raw`\.`;
  const escapedSdkVersion = sdkVersion.replaceAll(".", escapedDot);

  return new RegExp(
    String.raw`^UniverseLAN-${escapedSdkVersion}-Build-(\d+)-x64_x86\.zip$`
  );
};

/**
 * Picks the newest stable release that ships a build for this exact Galaxy SDK
 * version. UniverseLAN is not ABI compatible across SDK versions, so there is
 * deliberately no "closest version" fallback. Assets without a sha256 digest
 * are skipped because the download could not be verified.
 */
export const selectUniverseLanPackage = (
  releases: GitHubRelease[],
  sdkVersion: string
): UniverseLanPackage | null => {
  const pattern = assetNamePattern(sdkVersion);
  let selected: UniverseLanPackage | null = null;

  for (const release of releases) {
    if (release.draft || release.prerelease) continue;

    for (const asset of release.assets ?? []) {
      const nameMatch = pattern.exec(asset.name);
      const digestMatch = SHA256_DIGEST_PATTERN.exec(asset.digest ?? "");

      if (!nameMatch || !digestMatch) continue;
      if (!asset.browser_download_url.startsWith(DOWNLOAD_URL_PREFIX)) continue;

      const candidate: UniverseLanPackage = {
        sdkVersion,
        build: nameMatch[1],
        assetName: asset.name,
        downloadUrl: asset.browser_download_url,
        sha256: digestMatch[1].toLowerCase(),
      };

      if (!selected || Number(candidate.build) > Number(selected.build)) {
        selected = candidate;
      }
    }
  }

  return selected;
};

export const sha256 = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");

export class UniverseLanIntegrityError extends Error {
  constructor(assetName: string) {
    super(`Checksum mismatch for ${assetName}`);
    this.name = "UniverseLanIntegrityError";
  }
}

export const assertPackageIntegrity = (
  universeLanPackage: UniverseLanPackage,
  data: Buffer
) => {
  if (sha256(data) !== universeLanPackage.sha256) {
    throw new UniverseLanIntegrityError(universeLanPackage.assetName);
  }
};
