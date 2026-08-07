export const SUPPORTED_CLASSICS_PLATFORMS = ["ps1", "ps2", "ps3"];

export const isSupportedClassicsPlatform = (platform: string) =>
  SUPPORTED_CLASSICS_PLATFORMS.includes(platform);

export const sanitizeClassicsPlatforms = (platforms?: string[] | null) =>
  (platforms ?? []).filter(isSupportedClassicsPlatform);

export const resolveClassicsPlatformsForRequest = (
  platforms?: string[] | null
) => {
  const selected = sanitizeClassicsPlatforms(platforms);

  return selected.length ? selected : [...SUPPORTED_CLASSICS_PLATFORMS];
};
