import type { GameShop } from "@types";

import Color from "color";
import { v4 as uuidv4 } from "uuid";
import { THEME_WEB_STORE_URL } from "./constants";

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
  return new Intl.NumberFormat("en-US", {
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
    const activeTheme = await window.electron.getActiveCustomTheme();

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
    const prefs = await window.electron.getUserPreferences();
    return prefs?.achievementSoundVolume ?? 0.15;
  } catch (error) {
    console.error("Failed to get sound volume", error);
    return 0.15;
  }
};

export const parseThemeVariantBlocks = (
  code: string
): { name: string; content: string }[] => {
  const blocks: { name: string; content: string }[] = [];
  const codeStr = code || "";
  let i = 0;
  const seen = new Set<string>();
  while (i < codeStr.length) {
    if (codeStr[i] === ":") {
      let p = i - 1;
      while (p >= 0 && codeStr[p] !== "\n") {
        if (!/\s/.test(codeStr[p])) break;
        p--;
      }
      const isLineStart = p < 0 || codeStr[p] === "\n";
      if (!isLineStart) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < codeStr.length && /\s/.test(codeStr[j])) j++;
      const start = j;
      while (j < codeStr.length && /[a-zA-Z0-9_-]/.test(codeStr[j])) j++;
      const name = codeStr.slice(start, j).toLowerCase();
      while (j < codeStr.length && /\s/.test(codeStr[j])) j++;
      if (codeStr[j] !== "{") {
        i++;
        continue;
      }
      let k = j + 1;
      let depth = 1;
      while (k < codeStr.length && depth > 0) {
        const ch = codeStr[k];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        k++;
      }
      const content = codeStr.slice(j + 1, k - 1);
      const isVendor =
        name.startsWith("-") ||
        name.includes("webkit") ||
        name.includes("moz") ||
        name.includes("ms");
      const hasVars = parseCssVarsFromBlock(content).length > 0;
      if (!isVendor && hasVars && !seen.has(name)) {
        blocks.push({ name, content });
        seen.add(name);
      }
      i = k;
    } else {
      i++;
    }
  }
  return blocks;
};

export const parseCssVarsFromBlock = (
  content: string
): { key: string; value: string }[] => {
  const vars: { key: string; value: string }[] = [];
  const pieces = (content || "").split(";");
  for (const piece of pieces) {
    const idx = piece.indexOf(":");
    if (idx === -1) continue;
    const left = piece.slice(0, idx).trim();
    const right = piece.slice(idx + 1).trim();
    if (left.startsWith("--") && right) {
      vars.push({ key: left, value: right });
    }
  }
  return vars;
};
