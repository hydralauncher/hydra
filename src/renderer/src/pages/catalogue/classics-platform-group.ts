export type ClassicsPlatformGroup = "sony" | "nintendo" | "other";

export const getClassicsPlatformGroup = (
  platform: string
): ClassicsPlatformGroup => {
  const normalizedPlatform = platform.toLowerCase();

  if (normalizedPlatform.startsWith("sony ")) return "sony";
  if (normalizedPlatform.includes("nintendo")) return "nintendo";

  return "other";
};
