import { db } from "../level";
import { levelKeys } from "./keys";

export const cloudSavePrefixGenerationsSublevel = db.sublevel<string, string>(
  levelKeys.cloudSavePrefixGenerations,
  { valueEncoding: "utf8" }
);
