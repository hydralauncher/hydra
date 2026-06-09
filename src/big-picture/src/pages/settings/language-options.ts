import languageResources from "@locales";
import { getLanguageFlagCountryCode, resolveLanguageKey } from "@shared";

export interface LanguageOption {
  localeKey: string;
  nativeName: string;
  englishName: string;
  flagCountryCode: string | null;
}

const englishLanguageNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "language" })
    : null;

function getEnglishLanguageName(localeKey: string) {
  try {
    return englishLanguageNames?.of(localeKey) ?? localeKey;
  } catch {
    return localeKey;
  }
}

export function getLanguageOptions(): LanguageOption[] {
  return Object.entries(languageResources)
    .map(([language, value]) => ({
      localeKey: language,
      nativeName: value.language_name,
      englishName: getEnglishLanguageName(language),
      flagCountryCode: getLanguageFlagCountryCode(language),
    }))
    .sort((firstLanguage, secondLanguage) =>
      firstLanguage.nativeName.localeCompare(
        secondLanguage.nativeName,
        undefined,
        {
          sensitivity: "base",
        }
      )
    );
}

export function resolveCurrentLanguageOption(
  language: string | null | undefined
) {
  const languageOptions = getLanguageOptions();
  const languageKeys = languageOptions.map(
    (languageOption) => languageOption.localeKey
  );
  const selectedLanguage = resolveLanguageKey(language, languageKeys);

  return (
    languageOptions.find(
      (languageOption) => languageOption.localeKey === selectedLanguage
    ) ?? {
      localeKey: "en",
      nativeName: languageResources.en.language_name,
      englishName: getEnglishLanguageName("en"),
      flagCountryCode: getLanguageFlagCountryCode("en"),
    }
  );
}
