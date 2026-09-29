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

export const isCloudSaveV2Eligible = (
  shop: GameShop,
  platform?: string | null
) => shop === "steam" || getCloudSaveEmulatorProvider(shop, platform) !== null;
