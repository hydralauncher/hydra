import type { GameShop, RetroArchPlatform } from "@types";

import { platformToRetroArchPlatform } from "./retroarch-platform.js";

export type CloudSaveEmulatorProvider =
  | "rpcs3"
  | "retroarch"
  | "duckstation"
  | "pcsx2"
  | "ppsspp"
  | "dolphin";

export const getCloudSaveEmulatorProvider = (
  shop: GameShop,
  platform?: string | null
): CloudSaveEmulatorProvider | null => {
  if (shop !== "launchbox" || !platform) return null;
  if (/playstation\s*3|\bps3\b/i.test(platform)) return "rpcs3";
  if (/playstation\s*2|\bps2\b/i.test(platform)) return "pcsx2";
  if (/playstation\s*portable|\bpsp\b/i.test(platform)) return "ppsspp";
  if (/^(?:sony\s+)?playstation\s*(?:1)?$|\bps1\b|\bpsx\b/i.test(platform)) {
    return "duckstation";
  }
  if (/game\s*cube|\bngc\b|\bwii\b/i.test(platform)) return "dolphin";
  return platformToRetroArchPlatform(platform) ? "retroarch" : null;
};

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
