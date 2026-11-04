import i18n from "i18next";

import { loadLocale } from "./load-locale";

export async function applyLanguage(language: string) {
  const locale = await loadLocale(language);
  const languageTag = language || locale.key;

  for (const [namespace, resources] of Object.entries(locale.resources)) {
    if (resources && typeof resources === "object") {
      i18n.addResourceBundle(languageTag, namespace, resources, true, true);
    }
  }

  if (i18n.language !== languageTag) {
    await i18n.changeLanguage(languageTag);
  }

  return languageTag;
}
