import type { ResourceLanguage } from "i18next";

import { resolveLanguage } from "./languages";

const localeLoaders = import.meta.glob<{
  default: ResourceLanguage;
}>("./*/translation.json");

export async function loadLocale(language?: string | null) {
  const key = resolveLanguage(language);
  const loader = localeLoaders[`./${key}/translation.json`];

  if (!loader) {
    return {
      key: "en",
      resources: (await localeLoaders["./en/translation.json"]()).default,
    };
  }

  try {
    return {
      key,
      resources: (await loader()).default,
    };
  } catch {
    return {
      key: "en",
      resources: (await localeLoaders["./en/translation.json"]()).default,
    };
  }
}
