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

export const parseCssVars = (content: string) => {
  const vars: { key: string; value: string }[] = [];
  const isNameChar = (c: string) => {
    const x = c.charCodeAt(0);
    return (
      (x >= 48 && x <= 57) ||
      (x >= 65 && x <= 90) ||
      (x >= 97 && x <= 122) ||
      c === "_" ||
      c === "-"
    );
  };
  const len = content.length;
  let i = 0;
  while (i < len) {
    const startIdx = content.indexOf("--", i);
    if (startIdx === -1) break;
    let j = startIdx + 2;
    while (j < len && isNameChar(content[j])) j++;
    const name = content.slice(startIdx, j).trim();
    while (j < len && /\s/.test(content[j])) j++;
    if (j >= len || content[j] !== ":") {
      i = j + 1;
      continue;
    }
    j++;
    while (j < len && /\s/.test(content[j])) j++;
    const valueStart = j;
    let paren = 0;
    let inSingle = false;
    let inDouble = false;
    while (j < len) {
      const ch = content[j];
      if (!inSingle && !inDouble) {
        if (ch === "(") paren++;
        else if (ch === ")") paren = Math.max(0, paren - 1);
        else if (ch === '"') inDouble = true;
        else if (ch === "'") inSingle = true;
        else if (ch === ";" && paren === 0) break;
      } else if (inDouble) {
        if (ch === '"') inDouble = false;
      } else if (inSingle) {
        if (ch === "'") inSingle = false;
      }
      j++;
    }
    const value = content.slice(valueStart, j).trim();
    if (name) vars.push({ key: name, value });
    if (j < len && content[j] === ";") j++;
    i = j;
  }
  return vars;
};

export const parseThemeBlocks = (
  code: string,
  withVarsOnly: boolean = false
) => {
  const blocks: { name: string; content: string }[] = [];
  const disallowed = new Set([
    "hover",
    "active",
    "focus",
    "disabled",
    "before",
    "after",
    "visited",
    "checked",
    "placeholder",
    "focus-visible",
    "focus-within",
    "selection",
    "target",
  ]);
  const isValidChar = (c: string) => {
    const x = c.charCodeAt(0);
    return (
      (x >= 48 && x <= 57) ||
      (x >= 65 && x <= 90) ||
      (x >= 97 && x <= 122) ||
      c === "_" ||
      c === "-"
    );
  };
  const len = code.length;
  let i = 0;
  while (i < len) {
    if (code[i] !== ":") {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < len && /\s/.test(code[j])) j++;
    const start = j;
    while (j < len && isValidChar(code[j])) j++;
    const name = code.slice(start, j).toLowerCase();
    if (!name) {
      i++;
      continue;
    }
    while (j < len && /\s/.test(code[j])) j++;
    if (j >= len || code[j] !== "{") {
      i++;
      continue;
    }
    j++;
    const contentStart = j;
    while (j < len && code[j] !== "}") j++;
    const content = code.slice(contentStart, j);
    if (!disallowed.has(name)) {
      if (withVarsOnly) {
        const hasVars = parseCssVars(content).length > 0;
        if (hasVars) blocks.push({ name, content });
      } else {
        blocks.push({ name, content });
      }
    }
    i = j + 1;
  }
  return blocks;
};
