import { db } from "../level";
import { levelKeys } from "./keys";

export const catalogueNamesCacheSublevel = db.sublevel<
  string,
  { names: string[]; updatedAt: number }
>(levelKeys.catalogueNamesCache, {
  valueEncoding: "json",
});
