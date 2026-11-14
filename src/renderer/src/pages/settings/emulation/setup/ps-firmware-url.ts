import type { EmulatorSystem } from "@types";

const PS_FIRMWARE_LOCALES: Record<string, string> = {
  "pt-BR": "pt-br",
  "pt-PT": "pt-pt",
  es: "es-es",
  ru: "ru-ru",
};

export const SHADPS4_QUICK_START_URL =
  "https://github.com/shadps4-emu/shadPS4/wiki/I.-Quick-start-%5BUsers%5D";

export const firmwarePageUrl = (language: string): string => {
  const segment = PS_FIRMWARE_LOCALES[language] ?? "en-us";
  return `https://www.playstation.com/${segment}/support/hardware/ps3/system-software/`;
};

export const firmwareGuideUrl = (
  system: EmulatorSystem,
  language: string
): string =>
  system === "ps4" ? SHADPS4_QUICK_START_URL : firmwarePageUrl(language);
