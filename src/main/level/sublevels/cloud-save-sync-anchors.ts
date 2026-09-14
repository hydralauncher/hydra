import type { CloudSaveSyncAnchor } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const cloudSaveSyncAnchorsSublevel = db.sublevel<
  string,
  CloudSaveSyncAnchor
>(levelKeys.cloudSaveSyncAnchors, { valueEncoding: "json" });
