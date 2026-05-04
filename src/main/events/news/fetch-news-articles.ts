import { registerEvent } from "../register-event";
import { rssFeedsSublevel } from "@main/level";
import { logger } from "@main/services";
import type { RssFeed, NewsArticle } from "@types";
import RssParser from "rss-parser";

const parser = new RssParser({
  timeout: 10000,
});

const fetchNewsArticles = async (_event: Electron.IpcMainInvokeEvent) => {
  const feeds: RssFeed[] = [];
  for await (const value of rssFeedsSublevel.values()) {
    feeds.push(value);
  }

  const articles: NewsArticle[] = [];

  const results = await Promise.allSettled(
    feeds.map(async (feed) => {
      const parsed = await parser.parseURL(feed.url);

      return (parsed.items || []).map((item) => {
        const fullContent = item["content:encoded"] || item.content || "";

        const thumbnailUrl =
          item.enclosure?.url || extractImageFromContent(fullContent) || null;

        return {
          id: item.guid || item.link || `${feed.id}-${item.title}`,
          feedId: feed.id,
          feedName: feed.name,
          title: item.title || "",
          link: item.link || "",
          pubDate: item.isoDate || item.pubDate || "",
          contentSnippet: (item.contentSnippet || "").slice(0, 300),
          content: fullContent,
          thumbnailUrl,
          categories: (item.categories || []) as string[],
        } satisfies NewsArticle;
      });
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      articles.push(...result.value);
    } else {
      logger.error("Failed to fetch RSS feed:", result.reason);
    }
  }

  articles.sort((a, b) => {
    const dateA = new Date(a.pubDate).getTime() || 0;
    const dateB = new Date(b.pubDate).getTime() || 0;
    return dateB - dateA;
  });

  return articles;
};

function extractImageFromContent(content?: string): string | null {
  if (!content) return null;
  const match = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

registerEvent("fetchNewsArticles", fetchNewsArticles);
