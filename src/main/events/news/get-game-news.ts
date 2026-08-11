import { newsSublevel } from "@main/level";
import { orderBy } from "lodash-es";
import { registerEvent } from "../register-event";
import { fetchAndCacheNews, getLocalizedSourceNames } from "@main/services";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let lastFetch: { language: string; at: number } | null = null;

const getGameNews = async (
  _event: Electron.IpcMainInvokeEvent,
  language?: string
) => {
  const targetLanguage = language ?? "en";
  const isStale =
    !lastFetch ||
    lastFetch.language !== targetLanguage ||
    Date.now() - lastFetch.at > CACHE_TTL;

  if (isStale) {
    await fetchAndCacheNews(targetLanguage).catch(() => {});
    lastFetch = { language: targetLanguage, at: Date.now() };
  }

  const articles = await newsSublevel.values().all();
  const sorted = orderBy(articles, "publishedAt", "desc");

  const localizedNames = getLocalizedSourceNames(targetLanguage);
  if (localizedNames.size === 0) return sorted;

  const localized = sorted.filter((article) =>
    localizedNames.has(article.source)
  );
  const rest = sorted.filter(
    (article) => !localizedNames.has(article.source)
  );

  return [...localized, ...rest];
};

registerEvent("getGameNews", getGameNews);
