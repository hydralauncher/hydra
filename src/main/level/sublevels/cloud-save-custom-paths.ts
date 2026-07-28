import { db } from "../level";
import { levelKeys } from "./keys";

export const cloudSaveCustomPathsSublevel = db.sublevel<string, string[]>(
  levelKeys.cloudSaveCustomPaths,
  { valueEncoding: "json" }
);
