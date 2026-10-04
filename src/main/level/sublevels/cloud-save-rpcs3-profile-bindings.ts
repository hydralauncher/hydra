import { db } from "../level";
import { levelKeys } from "./keys";

export const cloudSaveRpcs3ProfileBindingsSublevel = db.sublevel<
  string,
  unknown
>(levelKeys.cloudSaveRpcs3ProfileBindings, { valueEncoding: "json" });
