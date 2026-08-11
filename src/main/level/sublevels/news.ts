import { db } from "../level";
import { levelKeys } from "./keys";
import type { NewsArticle } from "@types";

export const newsSublevel = db.sublevel<string, NewsArticle>(
  levelKeys.news,
  {
    valueEncoding: "json",
  }
);
