import { db, levelKeys } from "@main/level";
import { logger } from "../logger";
import { fetchAndCacheNews } from "./fetch-news";

export * from "./fetch-news";
export * from "./fetch-game-news";
export * from "./news-sources";

const REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour

const getUserLanguage = async (): Promise<string> =>
  db
    .get<string, string>(levelKeys.language, { valueEncoding: "utf8" })
    .catch(() => "en");

export const startNewsRefreshLoop = () => {
  const refresh = async () => {
    const language = await getUserLanguage();
    await fetchAndCacheNews(language).catch((err) =>
      logger.error("Failed to refresh game news", err)
    );
  };

  refresh();
  setInterval(refresh, REFRESH_INTERVAL);
};
