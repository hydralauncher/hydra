export const languageNames = {
  ar: "العربية",
  be: "беларуская мова",
  bg: "Български",
  ca: "Català",
  cs: "Čeština",
  da: "Dansk",
  de: "Deutsch",
  el: "Ελληνικά",
  en: "English",
  es: "Español",
  et: "Eesti",
  fa: "فارسی",
  fi: "Suomi",
  fr: "Français",
  hu: "Magyar",
  id: "Bahasa Indonesia",
  it: "Italiano",
  ja: "日本語",
  kk: "қазақ тілі",
  ko: "한국어",
  lv: "Latviešu",
  nb: "Norsk Bokmål",
  nl: "Nederlands",
  pl: "Polski",
  "pt-BR": "Português (Brasil)",
  "pt-PT": "Português (Portugal)",
  ro: "Română",
  ru: "Русский",
  sl: "Slovenščina",
  sv: "Svenska",
  tr: "Türkçe",
  uk: "Українська",
  uz: "Uzbek",
  vi: "Tiếng Việt",
  zh: "简体中文",
} as const;

export type Language = keyof typeof languageNames;

export const languageKeys = Object.keys(languageNames) as Language[];

export function isLanguage(language: string): language is Language {
  return language in languageNames;
}

export function resolveLanguage(language?: string | null): Language {
  if (!language) return "en";

  if (isLanguage(language)) return language;

  const baseLanguage = language.split("-")[0];

  return (
    languageKeys.find((key) => key === baseLanguage) ??
    languageKeys.find((key) => key.startsWith(`${baseLanguage}-`)) ??
    "en"
  );
}
