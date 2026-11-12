import type { EmulatorSystem, GameShop, RetroArchPlatform } from "@types";

import { platformToRetroArchPlatform } from "./retroarch-platform.js";
import { parseRecompilationCloudSaveObjectId } from "./recompilations.js";

export type CloudSaveEmulatorProvider = "rpcs3" | "shadps4" | "retroarch";

export const getCloudSaveEmulatorProvider = (
  shop: GameShop,
  platform?: string | null
): CloudSaveEmulatorProvider | null => {
  if (shop !== "launchbox" || !platform) return null;
  if (/playstation\s*3|\bps3\b/i.test(platform)) return "rpcs3";
  if (/playstation\s*4|\bps4\b/i.test(platform)) return "shadps4";
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

export type DiscCloudSaveEmulatorProvider = "rpcs3" | "shadps4";

const DISC_PROVIDER_SYSTEMS: Record<
  DiscCloudSaveEmulatorProvider,
  EmulatorSystem
> = {
  rpcs3: "ps3",
  shadps4: "ps4",
};

export const DISC_CLOUD_SAVE_EMULATOR_PROVIDERS = Object.keys(
  DISC_PROVIDER_SYSTEMS
) as DiscCloudSaveEmulatorProvider[];

export const DISC_CLOUD_SAVE_EMULATOR_SYSTEMS = Object.values(
  DISC_PROVIDER_SYSTEMS
);

export const isDiscCloudSaveEmulatorProvider = (
  provider: CloudSaveEmulatorProvider | null | undefined
): provider is DiscCloudSaveEmulatorProvider =>
  provider !== null &&
  provider !== undefined &&
  Object.hasOwn(DISC_PROVIDER_SYSTEMS, provider);

export const getDiscCloudSaveEmulatorProvider = (
  shop: GameShop,
  platform?: string | null
): DiscCloudSaveEmulatorProvider | null => {
  const provider = getCloudSaveEmulatorProvider(shop, platform);
  return isDiscCloudSaveEmulatorProvider(provider) ? provider : null;
};

export const discCloudSaveEmulatorSystem = (
  provider: DiscCloudSaveEmulatorProvider
): EmulatorSystem => DISC_PROVIDER_SYSTEMS[provider];

export const DISC_CLOUD_SAVE_ERROR_CODE = new RegExp(
  `cloud_save_(?:${Object.keys(DISC_PROVIDER_SYSTEMS).join("|")})_[a-z0-9_]+`
);

export const discCloudSaveWrongGameErrorCode = (
  provider: DiscCloudSaveEmulatorProvider
) => `cloud_save_${provider}_save_wrong_game`;

/** A port's disc is the port's own game, so the emulator has no disc there. */
export const hasCloudSaveDisc = (game: { discs?: RomDisc[] }) =>
  game.discs?.some(
    (disc) => Boolean(disc.path.trim()) && !disc.recompilationSlug
  ) ?? false;

export const hasCloudSaveExecutableSelection = (game: {
  shop: GameShop;
  platform?: string | null;
  executablePath?: string | null;
  selectedDiscPath?: string | null;
  discs?: RomDisc[];
}) => {
  const provider = getCloudSaveEmulatorProvider(game.shop, game.platform);
  if (provider === "retroarch") return hasSelectedRetroArchRom(game);
  if (isDiscCloudSaveEmulatorProvider(provider)) return hasCloudSaveDisc(game);
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
