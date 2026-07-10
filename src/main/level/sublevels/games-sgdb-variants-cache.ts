import type { SgdbVariantsCache } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const gamesSgdbVariantsCacheSublevel = db.sublevel<
  string,
  SgdbVariantsCache
>(levelKeys.sgdbVariantsCache, {
  valueEncoding: "json",
});
