const SUPPORTED_STEAM_METADATA_LANGUAGES = new Set([
  "en",
  "es",
  "pt",
  "ru",
  "fr",
]);

export async function getLocalizedSteamMetadata<T>(
  endpoint: string,
  locale: string
) {
  const language = locale.split("-")[0] || "en";
  const requestLanguage = SUPPORTED_STEAM_METADATA_LANGUAGES.has(language)
    ? language
    : "en";
  const languages = requestLanguage === "en" ? ["en"] : ["en", requestLanguage];
  const entries = await Promise.all(
    languages.map(async (currentLanguage) => {
      const data = await window.electron.hydraApi.get<T>(endpoint, {
        params: { language: currentLanguage },
        needsAuth: false,
      });

      return [currentLanguage, data] as const;
    })
  );
  const metadata = Object.fromEntries(entries) as Record<string, T>;

  metadata[language] ??= metadata[requestLanguage];

  return metadata;
}

let inflightGenres: { locale: string; promise: Promise<unknown> } | null = null;

/**
 * Fetches the shared Steam/Classics genre list for the current locale,
 * deduplicating concurrent requests from different components.
 */
export function getLocalizedGenres(locale: string) {
  if (inflightGenres?.locale === locale) {
    return inflightGenres.promise as Promise<Record<string, string[]>>;
  }

  const promise = getLocalizedSteamMetadata<string[]>(
    "/catalogue/steam/genres",
    locale
  ).finally(() => {
    if (inflightGenres?.promise === promise) inflightGenres = null;
  });

  inflightGenres = { locale, promise };

  return promise;
}
