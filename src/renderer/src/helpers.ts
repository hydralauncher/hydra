import type { EmulatorBinary, EmulatorSystem, GameShop } from "@types";

import Color from "color";
import i18next from "i18next";
import { v4 as uuidv4 } from "uuid";
import { THEME_WEB_STORE_URL } from "./constants";
import { levelDBService } from "./services/leveldb.service";

// Pixel-art flag icons from R74n PixelFlags (https://r74n.com/pixelflags).
import flagUS from "./assets/flags/us.png";
import flagEU from "./assets/flags/eu.png";
import flagJP from "./assets/flags/jp.png";
import flagKR from "./assets/flags/kr.png";
import flagAsia from "./assets/flags/asia.png";

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

export const getSteamLanguage = (language: string) => {
  if (language.startsWith("pt")) return "brazilian";
  if (language.startsWith("es")) return "spanish";
  if (language.startsWith("fr")) return "french";
  if (language.startsWith("ru") || language.startsWith("be")) return "russian";
  if (language.startsWith("it")) return "italian";
  if (language.startsWith("hu")) return "hungarian";
  if (language.startsWith("pl")) return "polish";
  if (language.startsWith("zh")) return "schinese";
  if (language.startsWith("da")) return "danish";

  return "english";
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

export const generateRandomGradient = (): string => {
  // Use a single consistent gradient with softer colors for custom games as placeholder
  const color1 = "#2c3e50"; // Dark blue-gray
  const color2 = "#34495e"; // Darker slate

  // Create SVG data URL that works in img tags
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#grad)" />
  </svg>`;

  // Return as data URL that works in img tags
  return `data:image/svg+xml;base64,${btoa(svgContent)}`;
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
  "PLATFORM_UNKNOWN",
  "NO_DISC",
  "EMULATOR_ALREADY_RUNNING",
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
