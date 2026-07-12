import { cloudSaveSyncAnchorsSublevel, levelKeys } from "@main/level";
import type { CloudSaveSyncAnchor, GameShop } from "@types";

const getAnchorKey = (shop: GameShop, objectId: string) =>
  levelKeys.game(shop, objectId);

export const getCloudSaveSyncAnchor = (shop: GameShop, objectId: string) =>
  cloudSaveSyncAnchorsSublevel
    .get(getAnchorKey(shop, objectId))
    .catch(() => null);

export const saveCloudSaveSyncAnchor = (
  shop: GameShop,
  objectId: string,
  anchor: CloudSaveSyncAnchor
) => cloudSaveSyncAnchorsSublevel.put(getAnchorKey(shop, objectId), anchor);

export const deleteCloudSaveSyncAnchor = (shop: GameShop, objectId: string) =>
  cloudSaveSyncAnchorsSublevel.del(getAnchorKey(shop, objectId));
