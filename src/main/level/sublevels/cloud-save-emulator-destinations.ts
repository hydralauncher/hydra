import { db } from "../level";
import { levelKeys } from "./keys";

export const cloudSaveEmulatorDestinationsSublevel = db.sublevel<
  string,
  unknown
>(levelKeys.cloudSaveEmulatorDestinations, { valueEncoding: "json" });
