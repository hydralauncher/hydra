import type { LocalSouvenirAsset, PendingAchievementSouvenir } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const pendingGroupedAchievementSouvenirsSublevel = db.sublevel<
  string,
  PendingAchievementSouvenir
>(levelKeys.pendingGroupedAchievementSouvenirs, { valueEncoding: "json" });

export const localSouvenirAssetsSublevel = db.sublevel<
  string,
  LocalSouvenirAsset
>(levelKeys.localSouvenirAssets, { valueEncoding: "json" });
