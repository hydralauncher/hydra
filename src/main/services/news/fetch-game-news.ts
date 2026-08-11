import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import type { NewsArticle } from "@types";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

const REQUEST_TIMEOUT = 10_000;
const MAX_ARTICLES = 12;

const GOOGLE_NEWS_LOCALES: Record<
  string,
  { hl: string; gl: string; ceid: string }
> = {
  pt: { hl: "pt-BR", gl: "BR", ceid: "BR:pt-419" },
  en: { hl: "en-US", gl: "US", ceid: "US:en" },
  es: { hl: "es", gl: "ES", ceid: "ES:es" },
  fr: { hl: "fr", gl: "FR", ceid: "FR:fr" },
  de: { hl: "de", gl: "DE", ceid: "DE:de" },
  it: { hl: "it", gl: "IT", ceid: "IT:it" },
};

const getLocaleParams = (language: string | null | undefined) => {
  const prefix = (language ?? "en").toLowerCase().split("-")[0];
  return GOOGLE_NEWS_LOCALES[prefix] ?? GOOGLE_NEWS_LOCALES.en;
};

const asArray = <T>(value: T | T[] | undefined): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

interface GoogleNewsItem {
  title?: string;
  link?: string;
  guid?: string | { "#text"?: string };
  pubDate?: string;
  source?: { "#text"?: string } | string;
}

// News specific to whatever game the user has selected, sourced from Google
// News' public search RSS (no API key needed). We only store the metadata
// we show — title/source/url/date — never the article body.
export const fetchGameNews = async (
  gameTitle: string,
  language?: string | null
): Promise<NewsArticle[]> => {
  const { hl, gl, ceid } = getLocaleParams(language);
  const query = encodeURIComponent(`"${gameTitle}" game`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

  const { data } = await axios.get<string>(url, {
    timeout: REQUEST_TIMEOUT,
    responseType: "text",
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  const parsed = xmlParser.parse(data);
  const items: GoogleNewsItem[] = asArray(parsed?.rss?.channel?.item);

  return items
    .slice(0, MAX_ARTICLES)
    .map((item): NewsArticle | null => {
      if (!item.link || !item.title) return null;

      const sourceName =
        (typeof item.source === "string"
          ? item.source
          : item.source?.["#text"]) ?? "Google News";

      const id =
        (typeof item.guid === "string" ? item.guid : item.guid?.["#text"]) ??
        item.link;

      return {
        id,
        title: item.title,
        description: null,
        source: sourceName,
        url: item.link,
        imageUrl: null,
        publishedAt: item.pubDate
          ? new Date(item.pubDate).toISOString()
          : new Date().toISOString(),
      };
    })
    .filter((article): article is NewsArticle => article !== null);
};
