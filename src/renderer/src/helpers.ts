import type {
  EmulatorBinary,
  EmulatorSystem,
  GameShop,
  LibraryGame,
  SouvenirSort,
} from "@types";

import {
  platformToRetroArchPlatform,
  RETROARCH_PLATFORM_LABELS,
} from "@shared";

import Color from "color";
import i18next from "i18next";
import { v4 as uuidv4 } from "uuid";
import { THEME_WEB_STORE_URL } from "./constants";
import { levelDBService } from "./services/leveldb.service";
import { logger } from "./logger";
import type { LibraryCategory } from "./pages/library/category-filter";
import type { SortOption } from "./pages/library/filter-options";

// Pixel-art flag icons from R74n PixelFlags (https://r74n.com/pixelflags).
import flagUS from "./assets/flags/us.png";
import flagEU from "./assets/flags/eu.png";
import flagJP from "./assets/flags/jp.png";
import flagKR from "./assets/flags/kr.png";
import flagAsia from "./assets/flags/asia.png";

export const ensureArray = <T>(value: unknown, source: string): T[] => {
  if (Array.isArray(value)) return value as T[];

  let preview: string | undefined;
  try {
    preview =
      typeof value === "string"
        ? value.slice(0, 200)
        : JSON.stringify(value)?.slice(0, 200);
  } catch {
    preview = `<unserializable ${typeof value}>`;
  }

  logger.warn(
    `Expected an array from ${source}, received (${typeof value}): ${preview}`
  );
  return [];
};

export const platformToSystem = (
  platform?: string | null
): EmulatorSystem | null => {
  if (!platform) return null;
  const p = platform.toLowerCase();
  if (/playstation\s*3|\bps3\b/.test(p)) return "ps3";
  if (/playstation\s*2|\bps2\b/.test(p)) return "ps2";
  if (/playstation|\bps1\b|\bpsx\b/.test(p)) return "ps1";
  return null;
};

export const SYSTEM_TO_BINARY: Record<EmulatorSystem, EmulatorBinary> = {
  ps1: "duckstation",
  ps2: "pcsx2",
  ps3: "rpcs3",
};

export {
  platformToRetroArchPlatform,
  RETROARCH_PLATFORM_LABELS,
} from "@shared";

export const RETROARCH_EMULATION_SETTINGS_PATH =
  "/settings?tab=emulation&system=retroarch";

export const retroarchLaunchErrorToastKey = (
  code: "RETROARCH_NOT_CONFIGURED" | "CORE_NOT_INSTALLED"
): string =>
  code === "CORE_NOT_INSTALLED"
    ? "core_not_installed_toast"
    : "retroarch_not_configured_toast";

export const showExecutableOpenDialog = (defaultPath?: string | null) => {
  const isMac = window.electron.platform === "darwin";

  let filters: { name: string; extensions: string[] }[] | undefined;
  if (window.electron.platform === "win32") {
    filters = [{ name: "Executable", extensions: ["exe"] }];
  } else if (isMac) {
    filters = [{ name: "Application", extensions: ["app"] }];
  }

  return window.electron.showOpenDialog({
    properties: isMac ? ["openFile", "openDirectory"] : ["openFile"],
    defaultPath: defaultPath ?? undefined,
    filters,
  });
};

export interface ClassicsBadgeInfo {
  label: string | null;
  icon: string | undefined;
}

export const CLASSICS_PS_PLATFORM_LABELS: Partial<
  Record<EmulatorSystem, string>
> = {
  ps1: "PS",
  ps2: "PS2",
  ps3: "PS3",
};

export const resolveClassicsBadge = (
  shop: GameShop,
  platform: string | null | undefined,
  psLabels: Partial<Record<EmulatorSystem, string>>,
  icons: {
    emulatorIcons: Partial<Record<EmulatorBinary, string>>;
    retroarchIcon: string;
  }
): ClassicsBadgeInfo => {
  if (shop !== "launchbox") return { label: null, icon: undefined };

  const system = platformToSystem(platform);
  if (system) {
    return {
      label: psLabels[system] ?? null,
      icon: icons.emulatorIcons[SYSTEM_TO_BINARY[system]],
    };
  }

  const retroArchPlatform = platformToRetroArchPlatform(platform);
  if (retroArchPlatform) {
    return {
      label: RETROARCH_PLATFORM_LABELS[retroArchPlatform],
      icon: icons.retroarchIcon,
    };
  }

  return { label: null, icon: undefined };
};

interface ClassicsLaunchErrorContext {
  t: (key: string) => string;
  showErrorToast: (message: string) => void;
  showSuccessToast: (message: string) => void;
  navigate: (path: string) => void;
  onEmulatorAlreadyRunning: () => void;
}

export const handleClassicsLaunchError = (
  error: unknown,
  context: ClassicsLaunchErrorContext
): boolean => {
  const { t, showErrorToast, showSuccessToast, navigate } = context;
  const code = getClassicsLaunchErrorCode(error);
  const system = getClassicsLaunchErrorSystem(error);
  const emulationPath = system
    ? `/settings?tab=emulation&system=${system}`
    : "/settings?tab=emulation";

  if (code === "EMULATOR_NOT_CONFIGURED") {
    showErrorToast(t("emulator_not_configured_toast"));
    navigate(emulationPath);
  } else if (code === "BIOS_NOT_CONFIGURED") {
    showErrorToast(t("bios_not_configured_toast"));
    navigate(emulationPath);
  } else if (
    code === "RETROARCH_NOT_CONFIGURED" ||
    code === "CORE_NOT_INSTALLED"
  ) {
    showErrorToast(t(retroarchLaunchErrorToastKey(code)));
    navigate(RETROARCH_EMULATION_SETTINGS_PATH);
  } else if (code === "PLATFORM_UNKNOWN") {
    showErrorToast(t("platform_unknown_toast"));
  } else if (code === "NO_DISC") {
    showErrorToast(t("no_disc_toast"));
  } else if (code === "PKG_INSTALLING") {
    showSuccessToast(t("pkg_installing_toast"));
  } else if (code === "PKG_UNREADABLE") {
    showErrorToast(t("pkg_unreadable_toast"));
  } else if (code === "EMULATOR_ALREADY_RUNNING") {
    context.onEmulatorAlreadyRunning();
  } else {
    showErrorToast(t("launch_failed_toast"));
  }

  return code !== "EMULATOR_ALREADY_RUNNING" && code !== "PKG_INSTALLING";
};

export const formatDownloadProgress = (
  progress?: number,
  fractionDigits?: number
) => {
  if (!progress) return "0%";
  const progressPercentage = progress * 100;

  if (Number(progressPercentage.toFixed(fractionDigits ?? 2)) % 1 === 0)
    return `${Math.floor(progressPercentage)}%`;

  return `${progressPercentage.toFixed(fractionDigits ?? 2)}%`;
};

export const buildGameDetailsPath = (
  game: { shop: GameShop; objectId: string; title: string },
  params: Record<string, string> = {}
) => {
  const searchParams = new URLSearchParams({ title: game.title, ...params });
  return `/game/${game.shop}/${game.objectId}?${searchParams.toString()}`;
};

export const buildGameAchievementPath = (
  game: { shop: GameShop; objectId: string; title: string },
  user?: { userId: string }
) => {
  const searchParams = new URLSearchParams({
    title: game.title,
    shop: game.shop,
    objectId: game.objectId,
    userId: user?.userId || "",
  });

  return `/achievements/?${searchParams.toString()}`;
};

export const darkenColor = (color: string, amount: number, alpha: number = 1) =>
  new Color(color).darken(amount).alpha(alpha).toString();

export const injectCustomCss = (
  css: string,
  target: HTMLElement = document.head
) => {
  try {
    target.querySelector("#custom-css")?.remove();

    if (css.startsWith(THEME_WEB_STORE_URL)) {
      const link = document.createElement("link");
      link.id = "custom-css";
      link.rel = "stylesheet";
      link.href = css;
      target.appendChild(link);
    } else {
      const style = document.createElement("style");
      style.id = "custom-css";
      style.textContent = `
        ${css}
      `;
      target.appendChild(style);
    }
  } catch (error) {
    console.error("failed to inject custom css:", error);
  }
};

export const removeCustomCss = (target: HTMLElement = document.head) => {
  target.querySelector("#custom-css")?.remove();
};

export const formatNumber = (num: number): string => {
  const locale = i18next.resolvedLanguage || i18next.language || undefined;

  return new Intl.NumberFormat(locale, {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(num);
};

/**
 * Generates a UUID v4
 * @returns A random UUID string
 */
export const generateUUID = (): string => {
  return uuidv4();
};

export const getAchievementSoundUrl = async (): Promise<string> => {
  const defaultSound = (await import("@renderer/assets/audio/achievement.wav"))
    .default;

  try {
    const allThemes = (await levelDBService.values("themes")) as {
      id: string;
      isActive?: boolean;
      hasCustomSound?: boolean;
    }[];
    const activeTheme = allThemes.find((theme) => theme.isActive);

    if (activeTheme?.hasCustomSound) {
      const soundDataUrl = await window.electron.getThemeSoundDataUrl(
        activeTheme.id
      );
      if (soundDataUrl) {
        return soundDataUrl;
      }
    }
  } catch (error) {
    console.error("Failed to get theme sound", error);
  }

  return defaultSound;
};

export const getAchievementSoundVolume = async (): Promise<number> => {
  try {
    const prefs = (await levelDBService.get(
      "userPreferences",
      null,
      "json"
    )) as { achievementSoundVolume?: number } | null;
    return prefs?.achievementSoundVolume ?? 0.15;
  } catch (error) {
    console.error("Failed to get sound volume", error);
    return 0.15;
  }
};

export const getGameKey = (shop: GameShop, objectId: string): string => {
  return `${shop}:${objectId}`;
};

export const isGameCompleted = (
  achievementCount?: number | null,
  unlockedAchievementCount?: number | null
): boolean => {
  if (!achievementCount) return false;
  return (unlockedAchievementCount ?? 0) >= achievementCount;
};

export type SkuRegion = "US" | "EU" | "JP" | "KR" | "ASIA";

const SKU_REGION_MAP: Record<string, SkuRegion> = {
  SCUS: "US",
  SLUS: "US",
  SCUD: "US",
  SLUD: "US",
  BCUS: "US",
  BLUS: "US",
  BCUD: "US",
  NPUA: "US",
  NPUB: "US",
  SCES: "EU",
  SLES: "EU",
  SCED: "EU",
  SLED: "EU",
  BCES: "EU",
  BLES: "EU",
  BCED: "EU",
  NPEA: "EU",
  NPEB: "EU",
  SCPS: "JP",
  SLPS: "JP",
  SLPM: "JP",
  SIPS: "JP",
  PAPX: "JP",
  PCPX: "JP",
  SRPM: "JP",
  BCJS: "JP",
  BLJS: "JP",
  BLJM: "JP",
  NPJA: "JP",
  NPJB: "JP",
  NPJD: "JP",
  SCKA: "KR",
  SLKA: "KR",
  BCKS: "KR",
  BLKS: "KR",
  BCKD: "KR",
  BCAS: "ASIA",
  BLAS: "ASIA",
  NPHA: "ASIA",
  NPHB: "ASIA",
};

const SKU_REGION_FLAGS: Record<SkuRegion, string> = {
  US: flagUS,
  EU: flagEU,
  JP: flagJP,
  KR: flagKR,
  ASIA: flagAsia,
};

const SKU_REGION_ORDER: SkuRegion[] = ["US", "EU", "JP", "KR", "ASIA"];

export const getSkuRegion = (sku: string): SkuRegion | null => {
  const prefix = sku.slice(0, 4).toUpperCase();
  return SKU_REGION_MAP[prefix] ?? null;
};

export const getSkuRegionFromSaveIdentity = (
  saveIdentity: string | null | undefined
): SkuRegion | null => {
  if (!saveIdentity) return null;
  const cleaned = saveIdentity
    .trim()
    .toUpperCase()
    .replace(/^B[A-Z](?=[A-Z]{4}[-_ .]?\d{5})/, "");
  return getSkuRegion(cleaned);
};

export const getSkuRegionFlag = (region: SkuRegion): string =>
  SKU_REGION_FLAGS[region];

export const getRegionsFromSkus = (skus: string[]): SkuRegion[] => {
  const set = new Set<SkuRegion>();
  for (const sku of skus) {
    const region = getSkuRegion(sku);
    if (region) set.add(region);
  }
  return SKU_REGION_ORDER.filter((r) => set.has(r));
};

const CLASSICS_LAUNCH_ERROR_CODES = [
  "EMULATOR_NOT_CONFIGURED",
  "BIOS_NOT_CONFIGURED",
  "PLATFORM_UNKNOWN",
  "NO_DISC",
  "EMULATOR_ALREADY_RUNNING",
  "PKG_INSTALLING",
  "PKG_UNREADABLE",
  "RETROARCH_NOT_CONFIGURED",
  "CORE_NOT_INSTALLED",
] as const;

export const getClassicsLaunchErrorCode = (
  error: unknown
): (typeof CLASSICS_LAUNCH_ERROR_CODES)[number] | undefined => {
  const direct = (error as { code?: string })?.code;
  if (direct && CLASSICS_LAUNCH_ERROR_CODES.includes(direct as never)) {
    return direct as (typeof CLASSICS_LAUNCH_ERROR_CODES)[number];
  }

  let message = "";
  if (error instanceof Error) message = error.message;
  else if (typeof error === "string") message = error;
  return CLASSICS_LAUNCH_ERROR_CODES.find((code) => message.includes(code));
};

export const getClassicsLaunchErrorSystem = (
  error: unknown
): "ps1" | "ps2" | "ps3" | undefined => {
  const direct = (error as { system?: string })?.system;
  if (direct === "ps1" || direct === "ps2" || direct === "ps3") return direct;

  let message = "";
  if (error instanceof Error) message = error.message;
  else if (typeof error === "string") message = error;
  return (["ps1", "ps2", "ps3"] as const).find((system) =>
    message.includes(system)
  );
};

const getPlayTimeDifference = (a: LibraryGame, b: LibraryGame): number => {
  const aHasPlayed = a.lastTimePlayed !== null;
  const bHasPlayed = b.lastTimePlayed !== null;

  if (aHasPlayed && bHasPlayed) {
    const aLastPlayed = new Date(a.lastTimePlayed as Date).getTime();
    const bLastPlayed = new Date(b.lastTimePlayed as Date).getTime();
    return bLastPlayed - aLastPlayed;
  }

  if (aHasPlayed !== bHasPlayed) {
    return aHasPlayed ? -1 : 1;
  }

  return 0;
};

const getMostPlayedDifference = (a: LibraryGame, b: LibraryGame): number =>
  b.playTimeInMilliseconds - a.playTimeInMilliseconds;

export const isGameInstalled = (game: LibraryGame): boolean =>
  Boolean(game.executablePath) ||
  game.installedSizeInBytes != null ||
  (game.shop === "launchbox" && (game.discs?.length ?? 0) > 0);

export const isGameReadyToPlay = (game: LibraryGame): boolean =>
  game.shop === "launchbox"
    ? Boolean(game.selectedDiscPath)
    : isGameInstalled(game);

const getInstalledFirstDifference = (
  a: LibraryGame,
  b: LibraryGame
): number => {
  const aIsInstalled = isGameInstalled(a);
  const bIsInstalled = isGameInstalled(b);

  if (aIsInstalled !== bIsInstalled) {
    return aIsInstalled ? -1 : 1;
  }

  return 0;
};

const getAchievementRateDifference = (
  a: LibraryGame,
  b: LibraryGame
): number => {
  const aTotal = a.achievementCount ?? 0;
  const bTotal = b.achievementCount ?? 0;

  if (aTotal === 0 || bTotal === 0) {
    if (aTotal === bTotal) return 0;
    return aTotal === 0 ? 1 : -1;
  }

  const aUnlocked = a.unlockedAchievementCount ?? 0;
  const bUnlocked = b.unlockedAchievementCount ?? 0;

  const rateDifference = bUnlocked * aTotal - aUnlocked * bTotal;
  if (rateDifference !== 0) return rateDifference;

  return bUnlocked - aUnlocked;
};

const compareLibraryGamesByTitle = (
  a: LibraryGame,
  b: LibraryGame,
  ascending = true
): number =>
  ascending
    ? (a.title ?? "").localeCompare(b.title ?? "", undefined, {
        sensitivity: "base",
      })
    : (b.title ?? "").localeCompare(a.title ?? "", undefined, {
        sensitivity: "base",
      });

export const sortLibraryGames = (
  games: LibraryGame[],
  sortBy: SortOption
): LibraryGame[] => {
  return [...games].sort((a, b) => {
    switch (sortBy) {
      case "recently_played": {
        const difference = getPlayTimeDifference(a, b);
        if (difference !== 0) return difference;
        break;
      }

      case "most_played": {
        const difference = getMostPlayedDifference(a, b);
        if (difference !== 0) return difference;
        break;
      }

      case "achievements": {
        const difference = getAchievementRateDifference(a, b);
        if (difference !== 0) return difference;
        break;
      }

      case "installed_first": {
        const difference = getInstalledFirstDifference(a, b);
        if (difference !== 0) return difference;
        break;
      }

      case "title_desc": {
        return compareLibraryGamesByTitle(a, b, false);
      }

      case "title_asc":
      default:
        break;
    }

    return compareLibraryGamesByTitle(a, b);
  });
};

export const getGameCollectionIds = (game: {
  collectionIds?: string[] | null;
}): string[] => {
  if (Array.isArray(game.collectionIds)) {
    return game.collectionIds;
  }

  const legacyCollectionId = (game as { collectionId?: string | null })
    .collectionId;

  return legacyCollectionId ? [legacyCollectionId] : [];
};

export const filterLibraryGamesByCategory = (
  games: LibraryGame[],
  category: LibraryCategory
): LibraryGame[] => {
  if (category === "pc") {
    return games.filter((game) => game.shop !== "launchbox");
  }

  if (category === "classics") {
    return games.filter((game) => game.shop === "launchbox");
  }

  return games;
};

export const resolveImageSource = (
  imageUrl: string | null | undefined
): string => {
  if (!imageUrl) return "";

  const trimmedImageUrl = imageUrl.trim();
  if (!trimmedImageUrl) return "";

  if (
    trimmedImageUrl.startsWith("http://") ||
    trimmedImageUrl.startsWith("https://") ||
    trimmedImageUrl.startsWith("data:") ||
    trimmedImageUrl.startsWith("blob:")
  ) {
    return trimmedImageUrl;
  }

  if (trimmedImageUrl.startsWith("local:")) {
    const normalizedLocalPath = trimmedImageUrl
      .slice("local:".length)
      .replaceAll("\\", "/");
    return `local:${normalizedLocalPath}`;
  }

  const normalizedPath = trimmedImageUrl.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(normalizedPath) || normalizedPath.startsWith("/")) {
    return `local:${normalizedPath}`;
  }

  return normalizedPath;
};

export type ProfileSortOption =
  | "playtime"
  | "achievementCount"
  | "playedRecently";

export type ProfilePlatformFilter = "all" | "pc" | "classics";

export const readStoredProfileSort = (): ProfileSortOption => {
  const saved = localStorage.getItem("profile-sort-by");
  return saved === "playtime" ||
    saved === "achievementCount" ||
    saved === "playedRecently"
    ? saved
    : "playedRecently";
};

export const readStoredProfilePlatform = (): ProfilePlatformFilter => {
  const saved = localStorage.getItem("profile-platform");
  return saved === "pc" || saved === "classics" || saved === "all"
    ? saved
    : "all";
};

export type SouvenirGrouping = "game" | "none";

export const readStoredSouvenirSort = (): SouvenirSort => {
  const saved = localStorage.getItem("profile-souvenir-sort-by");
  return saved === "recent" || saved === "oldest" || saved === "rare"
    ? saved
    : "recent";
};

export const readStoredSouvenirGrouping = (): SouvenirGrouping => {
  const saved = localStorage.getItem("profile-souvenir-grouping");
  return saved === "game" || saved === "none" ? saved : "none";
};

export const getShopsForProfilePlatform = (
  platform: ProfilePlatformFilter
): string[] => {
  if (platform === "pc") return ["steam"];
  if (platform === "classics") return ["launchbox"];
  return ["steam", "launchbox"];
};
