import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { newsSublevel } from "@main/level";
import { logger } from "../logger";
import { getNewsSourcesForLanguage } from "./news-sources";
import type { NewsArticle } from "@types";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

const MAX_ARTICLES = 60;
const MAX_OG_IMAGE_LOOKUPS = 8;
const REQUEST_TIMEOUT = 10_000;

const stripHtml = (value: string): string =>
  value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1).trim()}…` : value;

const asArray = <T>(value: T | T[] | undefined): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const extractImageFromHtml = (html: string | undefined): string | null => {
  if (!html) return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] ?? null;
};

interface RawRssItem {
  title?: string | { "#text"?: string };
  link?: string | { "@_href"?: string };
  guid?: string | { "#text"?: string };
  pubDate?: string;
  description?: string;
  "content:encoded"?: string;
  enclosure?: { "@_url"?: string; "@_type"?: string };
  "media:content"?:
    | { "@_url"?: string; "@_medium"?: string }
    | { "@_url"?: string; "@_medium"?: string }[];
  "media:thumbnail"?: { "@_url"?: string };
}

const textOf = (
  value: string | { "#text"?: string } | undefined
): string | null => {
  if (!value) return null;
  return typeof value === "string" ? value : (value["#text"] ?? null);
};

const linkOf = (value: RawRssItem["link"]): string | null => {
  if (!value) return null;
  return typeof value === "string" ? value : (value["@_href"] ?? null);
};

const imageOf = (item: RawRssItem): string | null => {
  if (item.enclosure?.["@_url"]) return item.enclosure["@_url"];

  const mediaContent = asArray(item["media:content"]).find(
    (m) => m["@_url"] && (!m["@_medium"] || m["@_medium"] === "image")
  );
  if (mediaContent?.["@_url"]) return mediaContent["@_url"];

  if (item["media:thumbnail"]?.["@_url"])
    return item["media:thumbnail"]["@_url"];

  return (
    extractImageFromHtml(item["content:encoded"]) ??
    extractImageFromHtml(item.description) ??
    null
  );
};

const parseFeed = (sourceName: string, xml: string): NewsArticle[] => {
  const parsed = xmlParser.parse(xml);
  const items: RawRssItem[] = asArray(
    parsed?.rss?.channel?.item ?? parsed?.feed?.entry
  );

  return items
    .map((item): NewsArticle | null => {
      const url = linkOf(item.link) ?? textOf(item.guid);
      const title = textOf(item.title);
      if (!url || !title) return null;

      const rawDescription = item.description ?? item["content:encoded"] ?? "";
      const description = rawDescription
        ? truncate(stripHtml(rawDescription), 160)
        : null;

      const publishedAt = item.pubDate
        ? new Date(item.pubDate).toISOString()
        : new Date().toISOString();

      return {
        id: url,
        title: stripHtml(title),
        description,
        source: sourceName,
        url,
        imageUrl: imageOf(item),
        publishedAt,
      };
    })
    .filter((article): article is NewsArticle => article !== null);
};

const fetchOgImage = async (url: string): Promise<string | null> => {
  try {
    const { data } = await axios.get<string>(url, {
      timeout: REQUEST_TIMEOUT,
      responseType: "text",
      headers: { Accept: "text/html" },
    });
    const match =
      data.match(
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
      ) ??
      data.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
      );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
};

const dedupeArticles = (articles: NewsArticle[]): NewsArticle[] => {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const deduped: NewsArticle[] = [];

  for (const article of articles) {
    const normalizedTitle = article.title.toLowerCase().trim();
    if (seenUrls.has(article.url) || seenTitles.has(normalizedTitle)) continue;
    seenUrls.add(article.url);
    seenTitles.add(normalizedTitle);
    deduped.push(article);
  }

  return deduped;
};

export const fetchAndCacheNews = async (
  language?: string | null
): Promise<void> => {
  const sources = getNewsSourcesForLanguage(language);

  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const { data } = await axios.get<string>(source.feedUrl, {
        timeout: REQUEST_TIMEOUT,
        responseType: "text",
        headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      });
      return parseFeed(source.name, data);
    })
  );

  const articles: NewsArticle[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      articles.push(...result.value);
    } else {
      logger.error(
        `Failed to fetch news from ${sources[index].name}`,
        result.reason
      );
    }
  });

  const deduped = dedupeArticles(articles)
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    )
    .slice(0, MAX_ARTICLES);

  const missingImage = deduped.filter((a) => !a.imageUrl);
  await Promise.all(
    missingImage.slice(0, MAX_OG_IMAGE_LOOKUPS).map(async (article) => {
      article.imageUrl = await fetchOgImage(article.url);
    })
  );

  await Promise.all(
    deduped.map((article) => newsSublevel.put(article.id, article))
  );
};
