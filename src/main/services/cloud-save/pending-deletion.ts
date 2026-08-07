import { cloudSavePendingDeletionsSublevel, db, levelKeys } from "@main/level";
import type { GameShop, User } from "@types";

import {
  cloudSavePendingDeletionStorageKey,
  resolveCloudSavePendingDeletionPhase,
  type StoredCloudSavePendingDeletion,
} from "./pending-deletion-state";

const getCurrentUserId = async () => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });
  if (!user?.id) throw new Error("Cloud save deletion requires a user");
  return user.id;
};

const getStorageKey = async (objectId: string, shop: GameShop) =>
  cloudSavePendingDeletionStorageKey(await getCurrentUserId(), shop, objectId);

export const getCloudSavePendingDeletionPhase = async (
  objectId: string,
  shop: GameShop
) =>
  resolveCloudSavePendingDeletionPhase(
    await cloudSavePendingDeletionsSublevel.get(
      await getStorageKey(objectId, shop)
    )
  );

export const isCloudSaveDeletionPending = async (
  objectId: string,
  shop: GameShop
) => (await getCloudSavePendingDeletionPhase(objectId, shop)) !== null;

export const assertCloudSaveDeletionNotPending = async (
  objectId: string,
  shop: GameShop
) => {
  if (await isCloudSaveDeletionPending(objectId, shop)) {
    throw new Error("cloud_save_delete_pending");
  }
};

export const beginCloudSavePendingDeletion = async (
  objectId: string,
  shop: GameShop
) => {
  const key = await getStorageKey(objectId, shop);
  const current = resolveCloudSavePendingDeletionPhase(
    await cloudSavePendingDeletionsSublevel.get(key)
  );
  if (current) return current;

  const state: StoredCloudSavePendingDeletion = {
    schemaVersion: 1,
    phase: "prepared",
  };
  await cloudSavePendingDeletionsSublevel.put(key, state);
  return state.phase;
};

export const markCloudSaveRemoteDeletionStarted = async (
  objectId: string,
  shop: GameShop
) => {
  const state: StoredCloudSavePendingDeletion = {
    schemaVersion: 1,
    phase: "remote-started",
  };
  await cloudSavePendingDeletionsSublevel.put(
    await getStorageKey(objectId, shop),
    state
  );
};

export const clearCloudSavePendingDeletion = async (
  objectId: string,
  shop: GameShop
) => cloudSavePendingDeletionsSublevel.del(await getStorageKey(objectId, shop));
