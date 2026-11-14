import type { ResourceLanguage } from "i18next";

import { logger } from "@renderer/logger";

import en from "./en/translation.json";
import { resolveLanguage } from "./languages";

const englishLocale = { key: "en", resources: en };

const localeLoaders = import.meta.glob<{
  default: ResourceLanguage;
}>(["./*/translation.json", "!./en/translation.json"]);

export async function loadLocale(language?: string | null) {
  const key = resolveLanguage(language);

  if (key === "en") {
    return englishLocale;
  }

  try {
    const loader = localeLoaders[`./${key}/translation.json`];

    if (!loader) {
      throw new Error(`Missing locale loader for ${key}`);
    }

    return {
      key,
      resources: (await loader()).default,
    };
  } catch (error) {
    logger.error("Failed to load locale", key, error);
    return englishLocale;
  }
}
