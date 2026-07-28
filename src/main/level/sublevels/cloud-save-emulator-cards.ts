import { db } from "../level";
import { levelKeys } from "./keys";

export const cloudSaveEmulatorCardsSublevel = db.sublevel<
  string,
  Record<string, string>
>(levelKeys.cloudSaveEmulatorCards, { valueEncoding: "json" });
