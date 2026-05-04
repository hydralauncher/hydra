import { db } from "../level";
import { levelKeys } from "./keys";
import type { RssFeed } from "@types";

export const rssFeedsSublevel = db.sublevel<string, RssFeed>(
  levelKeys.rssFeeds,
  {
    valueEncoding: "json",
  }
);
