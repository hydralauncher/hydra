import { db } from "../level";
import { levelKeys } from "./keys";

export const cloudSavePendingDeletionsSublevel = db.sublevel<string, unknown>(
  levelKeys.cloudSavePendingDeletions,
  { valueEncoding: "json" }
);
