import { cloudSaveSyncAnchorsSublevel, db, levelKeys } from "@main/level";
import type { CloudSaveSyncAnchor, GameShop, User } from "@types";

import { canMigrateLegacyCloudSaveAnchor } from "./sync-anchor-policy";

const getCurrentUserId = async () => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });

  if (!user?.id) throw new Error("Cloud save sync requires a signed-in user");

  return user.id;
};

const getLegacyAnchorKey = async (shop: GameShop, objectId: string) =>
  JSON.stringify([await getCurrentUserId(), shop, objectId]);

const getEnvironmentAnchorKey = async (
  shop: GameShop,
  objectId: string,
  environmentId: string
) =>
  JSON.stringify([
    await getCurrentUserId(),
    shop,
    objectId,
    "environment",
    environmentId,
  ]);

export const getCloudSaveSyncAnchorForEnvironment = async (
  shop: GameShop,
  objectId: string,
  environmentId: string
) =>
  (await cloudSaveSyncAnchorsSublevel.get(
    await getEnvironmentAnchorKey(shop, objectId, environmentId)
  )) ?? null;

export const getCloudSaveSyncAnchor = async (
  shop: GameShop,
  objectId: string,
  environmentId: string,
  localSnapshotHash: string,
  localSnapshotFileCount: number
) => {
  const environmentAnchor = await getCloudSaveSyncAnchorForEnvironment(
    shop,
    objectId,
    environmentId
  );
  if (environmentAnchor) return environmentAnchor;

  const legacyKey = await getLegacyAnchorKey(shop, objectId);
  const legacyAnchor =
    (await cloudSaveSyncAnchorsSublevel.get(legacyKey)) ?? null;
  const canSafelyMigrate = canMigrateLegacyCloudSaveAnchor(
    legacyAnchor,
    localSnapshotHash,
    localSnapshotFileCount
  );
  if (!legacyAnchor || !canSafelyMigrate) return null;

  await saveCloudSaveSyncAnchor(shop, objectId, environmentId, legacyAnchor);
  return {
    ...legacyAnchor,
    schemaVersion: 2 as const,
    environmentId,
  };
};

export const saveCloudSaveSyncAnchor = async (
  shop: GameShop,
  objectId: string,
  environmentId: string,
  anchor: CloudSaveSyncAnchor
) => {
  const environmentAnchor: CloudSaveSyncAnchor = {
    ...anchor,
    schemaVersion: 2,
    environmentId,
  };
  await cloudSaveSyncAnchorsSublevel.put(
    await getEnvironmentAnchorKey(shop, objectId, environmentId),
    environmentAnchor
  );
  await cloudSaveSyncAnchorsSublevel
    .del(await getLegacyAnchorKey(shop, objectId))
    .catch(() => undefined);
};
