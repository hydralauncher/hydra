import type { GameShop, RetroArchPlatform } from "@types";

import { platformToRetroArchPlatform } from "./retroarch-platform.js";

export type CloudSaveEmulatorProvider = "rpcs3" | "retroarch";

export const getCloudSaveEmulatorProvider = (
  shop: GameShop,
  platform?: string | null
): CloudSaveEmulatorProvider | null => {
  if (shop !== "launchbox" || !platform) return null;
  if (/playstation\s*3|\bps3\b/i.test(platform)) return "rpcs3";
  return platformToRetroArchPlatform(platform) ? "retroarch" : null;
};

export const canSelectCloudSaveCustomFile = (
  shop: GameShop,
  platform?: string | null
) => getCloudSaveEmulatorProvider(shop, platform) !== null;

export const getCloudSaveRetroArchPlatform = (
  shop: GameShop,
  platform?: string | null
): RetroArchPlatform | null =>
  getCloudSaveEmulatorProvider(shop, platform) === "retroarch"
    ? platformToRetroArchPlatform(platform)
    : null;

export const hasSelectedRetroArchRom = (game: {
  selectedDiscPath?: string | null;
  discs?: Array<{ path: string }>;
}) => {
  const discs = game.discs ?? [];
  if (game.selectedDiscPath === null) return false;
  if (game.selectedDiscPath !== undefined) {
    return discs.some((disc) => disc.path === game.selectedDiscPath);
  }
  return discs.length === 1;
};

export const hasRpcs3CloudSaveDisc = (game: {
  discs?: Array<{ path: string }>;
}) => game.discs?.some((disc) => Boolean(disc.path.trim())) ?? false;

export const hasCloudSaveExecutableSelection = (game: {
  shop: GameShop;
  platform?: string | null;
  executablePath?: string | null;
  selectedDiscPath?: string | null;
  discs?: Array<{ path: string }>;
}) => {
  const provider = getCloudSaveEmulatorProvider(game.shop, game.platform);
  if (provider === "retroarch") return hasSelectedRetroArchRom(game);
  if (provider === "rpcs3") return hasRpcs3CloudSaveDisc(game);
  return Boolean(game.executablePath || game.shop === "launchbox");
};

export const isCloudSaveV2Eligible = (
  shop: GameShop,
  platform?: string | null
) => shop === "steam" || getCloudSaveEmulatorProvider(shop, platform) !== null;
