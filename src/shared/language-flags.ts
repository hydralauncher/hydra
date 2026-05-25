const LANGUAGE_FLAG_MAP = {
  "pt-BR": "BR",
  "pt-PT": "PT",
  en: "US",
  de: "DE",
  es: "ES",
  nl: "NL",
  fr: "FR",
  hu: "HU",
  it: "IT",
  pl: "PL",
  ru: "RU",
  tr: "TR",
  be: "BY",
  uk: "UA",
  zh: "CN",
  id: "ID",
  ko: "KR",
  da: "DK",
  ar: "SA",
  fa: "IR",
  fi: "FI",
  ro: "RO",
  ca: "ES",
  bg: "BG",
  kk: "KZ",
  cs: "CZ",
  nb: "NO",
  et: "EE",
  uz: "UZ",
  sv: "SE",
  lv: "LV",
} as const;

const REGIONAL_INDICATOR_SYMBOL_LETTER_A = 0x1f1e6;
const ASCII_UPPERCASE_A = 65;

export function resolveLanguageKey(
  language: string | null | undefined,
  supportedLanguages: string[]
) {
  return (
    supportedLanguages.find(
      (supportedLanguage) => supportedLanguage === language
    ) ??
    supportedLanguages.find((supportedLanguage) =>
      supportedLanguage.startsWith(language?.split("-")[0] ?? "")
    ) ??
    "en"
  );
}

export function getLanguageFlagCountryCode(languageKey: string) {
  return (
    LANGUAGE_FLAG_MAP[languageKey as keyof typeof LANGUAGE_FLAG_MAP] ?? null
  );
}

export function getFlagEmojiFromCountryCode(countryCode: string | null) {
  if (!countryCode || countryCode.length !== 2) return null;

  return countryCode
    .toUpperCase()
    .split("")
    .map((character) =>
      String.fromCodePoint(
        REGIONAL_INDICATOR_SYMBOL_LETTER_A +
          character.charCodeAt(0) -
          ASCII_UPPERCASE_A
      )
    )
    .join("");
}
