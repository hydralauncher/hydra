import type {
  RecompilationOs,
  RecompilationReleaseAsset,
  RecompilationTested,
  RecompilationTestedFeatureKey,
} from "@types";

export const RECOMPILATION_TESTED_FEATURE_KEYS: RecompilationTestedFeatureKey[] =
  ["launch", "playtime", "cloudSaves", "achievements", "controllerBigPicture"];

export const getRecompilationOs = (
  platform: string
): RecompilationOs | null => {
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "macos";
  return null;
};

/** The release file Hydra installs on this OS, as chosen by the API. */
export const pickRecompilationInstallAsset = (
  assets: RecompilationReleaseAsset[],
  platform: string
): RecompilationReleaseAsset | null => {
  const os = getRecompilationOs(platform);
  if (!os) return null;

  return (
    assets.find((asset) => asset.isInstallTarget && asset.os === os) ?? null
  );
};

export const isRecompilationAssetFromRepository = (
  asset: RecompilationReleaseAsset,
  repository: string,
  tag: string
) =>
  asset.url.startsWith(
    `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/`
  ) ||
  asset.url.startsWith(
    `https://github.com/${repository}/releases/download/${tag}/`
  );

/** How many of the five features passed, for "3 de 5 recursos". */
export const countWorkingRecompilationFeatures = (
  tested: RecompilationTested
) => tested.features.filter((feature) => feature.status === "works").length;
