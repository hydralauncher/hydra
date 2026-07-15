import type { LocalFileHashCacheEntry } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const cloudSaveLocalHashCacheSublevel = db.sublevel<
  string,
  LocalFileHashCacheEntry[]
>(levelKeys.cloudSaveLocalHashCache, { valueEncoding: "json" });
