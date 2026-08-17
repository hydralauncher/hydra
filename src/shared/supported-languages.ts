export interface SupportedLanguage {
  language: string;
  hasAudio: boolean;
}

export function parseSupportedLanguages(
  supportedLanguages: string | null | undefined
): SupportedLanguage[] {
  if (!supportedLanguages) return [];

  const languagesString = supportedLanguages.split("<br>")[0];
  const languageArray = languagesString?.split(",") || [];

  return languageArray.map((lang) => ({
    language: lang.replace("<strong>*</strong>", "").trim(),
    hasAudio: lang.includes("*"),
  }));
}
