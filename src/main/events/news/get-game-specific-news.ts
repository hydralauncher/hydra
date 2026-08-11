import { registerEvent } from "../register-event";
import { fetchGameNews } from "@main/services";
import type { NewsArticle } from "@types";

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const cache = new Map<string, { articles: NewsArticle[]; at: number }>();

const getGameSpecificNews = async (
  _event: Electron.IpcMainInvokeEvent,
  gameTitle: string,
  language?: string
) => {
  if (!gameTitle) return [];

  const cacheKey = `${gameTitle}::${language ?? "en"}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return cached.articles;
  }

  const articles = await fetchGameNews(gameTitle, language).catch(() => []);
  cache.set(cacheKey, { articles, at: Date.now() });
  return articles;
};

registerEvent("getGameSpecificNews", getGameSpecificNews);
