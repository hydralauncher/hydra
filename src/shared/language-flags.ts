const LANGUAGE_FLAG_MAP = {
  "pt-BR": "BR",
  "pt-PT": "PT",
  "es-ES": "ES",
  "es-LAT": "MX",
  en: "US",
  de: "DE",
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

const LATIN_AMERICAN_SPANISH_CODES = new Set([
  "es-419",
  "es-MX",
  "es-AR",
  "es-CO",
  "es-CL",
  "es-PE",
  "es-VE",
  "es-EC",
  "es-BO",
  "es-PY",
  "es-UY",
  "es-CR",
  "es-SV",
  "es-GT",
  "es-HN",
  "es-NI",
  "es-PA",
  "es-CU",
  "es-DO",
  "es-PR",
]);

function resolveSpanishVariant(
  language: string,
  supportedLanguages: string[]
): string | null {
  if (language === "es-ES" || language.startsWith("es-ES-")) {
    const esESMatch = supportedLanguages.find((lang) => lang === "es-ES");
    if (esESMatch) return esESMatch;
  }

  if (LATIN_AMERICAN_SPANISH_CODES.has(language)) {
    const esLATMatch = supportedLanguages.find((lang) => lang === "es-LAT");
    if (esLATMatch) return esLATMatch;
  }

  // Fallback for any other "es-*" code we don't explicitly recognise.
  const esLATDefault = supportedLanguages.find((lang) => lang === "es-LAT");
  if (esLATDefault) return esLATDefault;

  return null;
}

export function resolveLanguageKey(
  language: string | null | undefined,
  supportedLanguages: string[]
) {
  const exactMatch = supportedLanguages.find(
    (supportedLanguage) => supportedLanguage === language
  );
  if (exactMatch) return exactMatch;

  if (!language) return "en";

  const baseLang = language.split("-")[0];

  if (baseLang === "es") {
    const spanishMatch = resolveSpanishVariant(language, supportedLanguages);
    if (spanishMatch) return spanishMatch;
  }

  const prefixMatch = supportedLanguages.find((supportedLanguage) =>
    supportedLanguage.startsWith(baseLang)
  );
  if (prefixMatch) return prefixMatch;

  return "en";
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
