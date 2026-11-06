import i18n from "i18next";

import { loadLocale } from "./load-locale";

let latestLanguageRequest = 0;

export async function applyLanguage(language: string) {
  const requestId = ++latestLanguageRequest;
  const locale = await loadLocale(language);
  const languageTag = language || locale.key;

  if (requestId !== latestLanguageRequest) {
    return languageTag;
  }

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
