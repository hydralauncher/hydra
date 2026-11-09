import type { i18n as I18n, ResourceLanguage } from "i18next";

export interface Locale {
  key: string;
  resources: ResourceLanguage;
}

export type LocaleLoader = (language: string) => Promise<Locale>;

export const createLanguageApplier = (i18n: I18n, loadLocale: LocaleLoader) => {
  let latestLanguageRequest = 0;

  return async (language: string) => {
    const requestId = ++latestLanguageRequest;
    const locale = await loadLocale(language);
    const languageTag = locale.key;

    if (requestId !== latestLanguageRequest) {
      return languageTag;
    }

    for (const [namespace, resources] of Object.entries(locale.resources)) {
      if (resources && typeof resources === "object") {
        i18n.addResourceBundle(languageTag, namespace, resources, true, true);
      }
    }

    if (
      i18n.language !== languageTag ||
      i18n.resolvedLanguage !== languageTag
    ) {
      await i18n.changeLanguage(languageTag);
    }

    return languageTag;
  };
};
