import {
  cloudSaveCustomPathsSublevel,
  cloudSaveLocalHashCacheSublevel,
  cloudSaveSyncAnchorsSublevel,
  db,
  levelKeys,
} from "@main/level";
import type { GameShop, User } from "@types";

import { isCloudSaveSyncAnchorKeyForGame } from "./sync-anchor-key";

const getCurrentUserId = async () => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });
  if (!user?.id) throw new Error("Cloud save deletion requires a user");
  return user.id;
};

export const clearCloudSaveLocalState = async (
  objectId: string,
  shop: GameShop,
  customPathStorageKey: string
) => {
  const userId = await getCurrentUserId();
  const cacheKey = levelKeys.game(shop, objectId);
  const anchorKeys: string[] = [];
  for await (const [key] of cloudSaveSyncAnchorsSublevel.iterator()) {
    if (isCloudSaveSyncAnchorKeyForGame(key, userId, shop, objectId)) {
      anchorKeys.push(key);
    }
  }

  const batch = db.batch();
  batch.del(customPathStorageKey, {
    sublevel: cloudSaveCustomPathsSublevel,
  });
  batch.del(cacheKey, {
    sublevel: cloudSaveLocalHashCacheSublevel,
  });
  for (const anchorKey of anchorKeys) {
    batch.del(anchorKey, {
      sublevel: cloudSaveSyncAnchorsSublevel,
    });
  }
  await batch.write();
};
