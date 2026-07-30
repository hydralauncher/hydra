import { db } from "../level";
import { levelKeys } from "./keys";

export const cloudSaveCustomPathsSublevel = db.sublevel<string, unknown>(
  levelKeys.cloudSaveCustomPaths,
  { valueEncoding: "json" }
);
