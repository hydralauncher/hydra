import path from "node:path";
import { promises as fs } from "node:fs";

import { cloudSaveEmulatorCardsSublevel, db, levelKeys } from "@main/level";
import type {
  EmulationSavePlatform,
  GameShop,
  SetEmulatorCloudSaveCardInput,
  User,
} from "@types";

const getCurrentUserId = async () => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });
  if (!user?.id) throw new Error("Emulator cloud saves require a user");
  return user.id;
};

const storageKey = async (
  shop: GameShop,
  objectId: string,
  platform: EmulationSavePlatform
) => JSON.stringify([await getCurrentUserId(), shop, objectId, platform]);

export const canonicalizeMemoryCardPath = async (cardFilePath: string) => {
  if (!path.isAbsolute(cardFilePath)) {
    throw new Error("cloud_save_emulator_card_path_invalid");
  }
  return fs.realpath(cardFilePath);
};

export const getEmulatorCloudSaveCardPreferences = async (
  shop: GameShop,
  objectId: string,
  platform: EmulationSavePlatform
) =>
  (await cloudSaveEmulatorCardsSublevel.get(
    await storageKey(shop, objectId, platform)
  )) ?? {};

export const setEmulatorCloudSaveCardPreferences = async ({
  shop,
  objectId,
  platform,
  saveIdentities,
  cardFilePath,
}: SetEmulatorCloudSaveCardInput) => {
  const identities = [...new Set(saveIdentities.filter(Boolean))].sort();
  if (identities.length === 0) {
    throw new Error("cloud_save_emulator_save_identity_required");
  }
  const canonicalPath = await canonicalizeMemoryCardPath(cardFilePath);
  const key = await storageKey(shop, objectId, platform);
  const current = (await cloudSaveEmulatorCardsSublevel.get(key)) ?? {};
  const next = { ...current };
  for (const saveIdentity of identities) next[saveIdentity] = canonicalPath;
  await cloudSaveEmulatorCardsSublevel.put(key, next);
  return canonicalPath;
};

export const removeEmulatorCloudSaveCardPreferences = async (
  shop: GameShop,
  objectId: string,
  platform: EmulationSavePlatform,
  saveIdentities: string[]
) => {
  const key = await storageKey(shop, objectId, platform);
  const current = (await cloudSaveEmulatorCardsSublevel.get(key)) ?? {};
  const next = { ...current };
  for (const saveIdentity of saveIdentities) delete next[saveIdentity];
  if (Object.keys(next).length === 0) {
    await cloudSaveEmulatorCardsSublevel.del(key).catch(() => undefined);
  } else {
    await cloudSaveEmulatorCardsSublevel.put(key, next);
  }
};
