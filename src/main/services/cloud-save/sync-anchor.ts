import { cloudSaveSyncAnchorsSublevel, db, levelKeys } from "@main/level";
import type { CloudSaveSyncAnchor, GameShop, User } from "@types";

const getCurrentUserId = async () => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });

  if (!user?.id) throw new Error("Cloud save sync requires a signed-in user");

  return user.id;
};

const getAnchorKey = async (shop: GameShop, objectId: string) =>
  JSON.stringify([await getCurrentUserId(), shop, objectId]);

export const getCloudSaveSyncAnchor = async (
  shop: GameShop,
  objectId: string
) =>
  (await cloudSaveSyncAnchorsSublevel.get(
    await getAnchorKey(shop, objectId)
  )) ?? null;

export const saveCloudSaveSyncAnchor = async (
  shop: GameShop,
  objectId: string,
  anchor: CloudSaveSyncAnchor
) =>
  cloudSaveSyncAnchorsSublevel.put(await getAnchorKey(shop, objectId), anchor);

export const deleteCloudSaveSyncAnchor = async (
  shop: GameShop,
  objectId: string
) => cloudSaveSyncAnchorsSublevel.del(await getAnchorKey(shop, objectId));
