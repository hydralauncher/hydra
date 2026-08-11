export interface NewsSourceConfig {
  name: string;
  feedUrl: string;
}

// Adding a new source only requires appending an entry here (or to one of
// the locale groups below) — no frontend changes needed, matching the
// "no cadastro manual" requirement.
const ENGLISH_SOURCES: NewsSourceConfig[] = [
  { name: "IGN", feedUrl: "https://feeds.ign.com/ign/games-all" },
  { name: "PC Gamer", feedUrl: "https://www.pcgamer.com/rss/" },
  { name: "Eurogamer", feedUrl: "https://www.eurogamer.net/feed" },
  { name: "Rock Paper Shotgun", feedUrl: "https://www.rockpapershotgun.com/feed" },
];

// Keyed by the language prefix as stored in userPreferences (e.g. "pt-BR",
// "es", "fr"). Falls back to ENGLISH_SOURCES when there's no entry for the
// user's language, or when the region-specific feeds come up too thin.
const SOURCES_BY_LANGUAGE: Record<string, NewsSourceConfig[]> = {
  pt: [
    { name: "Adrenaline", feedUrl: "https://www.adrenaline.com.br/feed/" },
    { name: "IGN Brasil", feedUrl: "https://br.ign.com/feed.xml" },
  ],
  es: [{ name: "Vandal", feedUrl: "https://vandal.elespanol.com/rss" }],
  fr: [
    { name: "Jeuxvideo.com", feedUrl: "https://www.jeuxvideo.com/rss/rss.xml" },
  ],
};

// `language` is the app's configured language (e.g. "pt-BR", "en", "es-ES").
// English is always included as a supplement so the section never ends up
// mostly empty when the localized feeds have little going on.
export const getNewsSourcesForLanguage = (
  language: string | null | undefined
): NewsSourceConfig[] => {
  const prefix = (language ?? "en").toLowerCase().split("-")[0];
  const localized = SOURCES_BY_LANGUAGE[prefix];

  if (!localized || prefix === "en") return ENGLISH_SOURCES;
  return [...localized, ...ENGLISH_SOURCES];
};

// Names of the sources that are actually in the user's language, so callers
// can rank them ahead of the English supplement instead of interleaving
// purely by recency (English outlets publish far more often, which would
// otherwise bury the localized articles).
export const getLocalizedSourceNames = (
  language: string | null | undefined
): Set<string> => {
  const prefix = (language ?? "en").toLowerCase().split("-")[0];
  const localized = SOURCES_BY_LANGUAGE[prefix];
  if (!localized || prefix === "en") return new Set();
  return new Set(localized.map((source) => source.name));
};

export const NEWS_SOURCES = ENGLISH_SOURCES;
