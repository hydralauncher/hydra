import type {
  RecompilationOs,
  RecompilationReleaseAsset,
  RecompilationTested,
  RecompilationTestedFeatureKey,
} from "@types";

export const RECOMPILATION_TESTED_FEATURE_KEYS: RecompilationTestedFeatureKey[] =
  ["launch", "playtime", "cloudSaves", "controllerBigPicture"];

export const getRecompilationOs = (
  platform: string
): RecompilationOs | null => {
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "macos";
  return null;
};

const RECOMPILATION_CLOUD_SAVE_ID = /^(\d{1,20}):([a-z0-9][a-z0-9._-]{0,99})$/i;

export const toRecompilationCloudSaveObjectId = (
  objectId: string,
  slug: string
) => `${objectId}:${slug}`;

export const parseRecompilationCloudSaveObjectId = (
  shop: string,
  objectId: string
): { objectId: string; slug: string } | null => {
  if (shop !== "launchbox") return null;
  const match = RECOMPILATION_CLOUD_SAVE_ID.exec(objectId);
  return match ? { objectId: match[1], slug: match[2] } : null;
};

export const toCloudSaveApiGame = <Shop extends string>(
  shop: Shop,
  objectId: string
): { shop: Shop; objectId: string; recompilationSlug?: string } => {
  const port = parseRecompilationCloudSaveObjectId(shop, objectId);
  return port
    ? { shop, objectId: port.objectId, recompilationSlug: port.slug }
    : { shop, objectId };
};

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

const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const decodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

export const isRecompilationAssetFromRepository = (
  asset: RecompilationReleaseAsset,
  repository: string,
  tag: string
) => {
  const url = parseUrl(asset.url);
  if (
    url?.protocol !== "https:" ||
    url.host !== "github.com" ||
    url.username ||
    url.password
  ) {
    return false;
  }

  const prefix = `/${repository}/releases/download/`;
  if (!url.pathname.startsWith(prefix)) return false;

  const segments = url.pathname.slice(prefix.length).split("/");
  return (
    segments.length === 2 &&
    segments[1] !== "" &&
    decodeSegment(segments[0]) === tag
  );
};

export const countWorkingRecompilationFeatures = (
  tested: RecompilationTested
) =>
  tested.features.filter(
    (feature) =>
      feature.status === "works" &&
      RECOMPILATION_TESTED_FEATURE_KEYS.includes(feature.key)
  ).length;
