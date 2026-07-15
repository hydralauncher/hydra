import { db } from "../level";
import { levelKeys } from "./keys";

export const cloudSaveAutomaticSyncSettingsSublevel = db.sublevel<
  string,
  boolean
>(levelKeys.cloudSaveAutomaticSyncSettings, { valueEncoding: "json" });
