import { cloudSaveSyncAnchorsSublevel, db, levelKeys } from "@main/level";
import type { CloudSaveSyncAnchor, GameShop, User } from "@types";

import {
  CLOUD_SAVE_HASH_PATTERN,
  cloudSaveFileKey,
} from "./cloud-save-contract";
import { hasCloudSaveV4AnchorSchema } from "./sync-anchor-policy";

const isValidAnchor = (
  anchor: CloudSaveSyncAnchor | null,
  environmentId: string
) => {
  if (
    !anchor ||
    !hasCloudSaveV4AnchorSchema(anchor) ||
    anchor.environmentId !== environmentId ||
    !anchor.baseSnapshotId ||
    !Number.isSafeInteger(anchor.baseVersion) ||
    anchor.baseVersion < 1 ||
    !CLOUD_SAVE_HASH_PATTERN.test(anchor.baseAggregateHash) ||
    !Array.isArray(anchor.entries) ||
    !Array.isArray(anchor.unresolvedRemoteEntryIds) ||
    !Number.isFinite(Date.parse(anchor.updatedAt))
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const entry of anchor.entries) {
    const id = cloudSaveFileKey(entry);
    if (
      !CLOUD_SAVE_HASH_PATTERN.test(entry.variantId) ||
      !entry.rawPath ||
      !entry.relativePath ||
      ids.has(id) ||
      !CLOUD_SAVE_HASH_PATTERN.test(entry.hash) ||
      !Number.isSafeInteger(entry.sizeBytes) ||
      entry.sizeBytes < 0
    ) {
      return false;
    }
    ids.add(id);
  }
  return anchor.unresolvedRemoteEntryIds.every((id) => ids.has(id));
};

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
) => {
  const key = await getEnvironmentAnchorKey(shop, objectId, environmentId);
  const anchor = (await cloudSaveSyncAnchorsSublevel.get(key)) ?? null;
  if (!isValidAnchor(anchor, environmentId)) {
    if (anchor) await cloudSaveSyncAnchorsSublevel.del(key);
    return null;
  }
  return anchor;
};

export const getCloudSaveSyncAnchor = async (
  shop: GameShop,
  objectId: string,
  environmentId: string,
  _localSnapshotHash: string,
  _localSnapshotFileCount: number
) => {
  const environmentAnchor = await getCloudSaveSyncAnchorForEnvironment(
    shop,
    objectId,
    environmentId
  );
  if (environmentAnchor) return environmentAnchor;

  await cloudSaveSyncAnchorsSublevel
    .del(await getLegacyAnchorKey(shop, objectId))
    .catch(() => undefined);
  return null;
};

export const saveCloudSaveSyncAnchor = async (
  shop: GameShop,
  objectId: string,
  environmentId: string,
  anchor: CloudSaveSyncAnchor
) => {
  if (anchor.schemaVersion !== 4 || anchor.environmentId !== environmentId) {
    throw new Error("Invalid Cloud Save V4 sync anchor");
  }
  const entries = [...anchor.entries].sort((left, right) =>
    cloudSaveFileKey(left).localeCompare(cloudSaveFileKey(right))
  );
  if (
    entries.some(
      (entry, index) =>
        index > 0 &&
        cloudSaveFileKey(entries[index - 1]) === cloudSaveFileKey(entry)
    )
  ) {
    throw new Error("Duplicate file identity in Cloud Save V4 sync anchor");
  }
  const environmentAnchor: CloudSaveSyncAnchor = {
    ...anchor,
    entries,
    unresolvedRemoteEntryIds: [
      ...new Set(anchor.unresolvedRemoteEntryIds),
    ].sort(),
  };
  if (!isValidAnchor(environmentAnchor, environmentId)) {
    throw new Error("Invalid Cloud Save V4 sync anchor");
  }
  await cloudSaveSyncAnchorsSublevel.put(
    await getEnvironmentAnchorKey(shop, objectId, environmentId),
    environmentAnchor
  );
  await cloudSaveSyncAnchorsSublevel
    .del(await getLegacyAnchorKey(shop, objectId))
    .catch(() => undefined);
};
