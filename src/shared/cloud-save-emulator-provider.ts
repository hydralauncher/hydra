import type { GameShop, RetroArchPlatform } from "@types";

import { platformToRetroArchPlatform } from "./retroarch-platform.js";
import { parseRecompilationCloudSaveObjectId } from "./recompilations.js";

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

type RomDisc = { path: string; recompilationSlug?: string };

export const getRetroArchRomDiscs = <T extends RomDisc>(discs?: T[]) =>
  (discs ?? []).filter((disc) => !disc.recompilationSlug);

export const getSelectedRetroArchRomPath = (game: {
  selectedDiscPath?: string | null;
  discs?: RomDisc[];
}) => {
  const romDiscs = getRetroArchRomDiscs(game.discs);
  const selectsPort = (game.discs ?? []).some(
    (disc) => disc.recompilationSlug && disc.path === game.selectedDiscPath
  );
  const selected = selectsPort ? undefined : game.selectedDiscPath;

  if (selected === null) return null;
  if (selected !== undefined) {
    return romDiscs.some((disc) => disc.path === selected) ? selected : null;
  }
  return romDiscs.length === 1 ? romDiscs[0].path : null;
};

export const hasSelectedRetroArchRom = (game: {
  selectedDiscPath?: string | null;
  discs?: RomDisc[];
}) => getSelectedRetroArchRomPath(game) !== null;

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
  platform?: string | null,
  objectId?: string
) =>
  shop === "steam" ||
  shop === "epic" ||
  getCloudSaveEmulatorProvider(shop, platform) !== null ||
  (objectId !== undefined &&
    parseRecompilationCloudSaveObjectId(shop, objectId) !== null);
