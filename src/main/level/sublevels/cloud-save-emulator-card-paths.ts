import { db } from "../level";
import { levelKeys } from "./keys";

export const cloudSaveEmulatorCardPathsSublevel = db.sublevel<string, unknown>(
  levelKeys.cloudSaveEmulatorCardPaths,
  { valueEncoding: "json" }
);
