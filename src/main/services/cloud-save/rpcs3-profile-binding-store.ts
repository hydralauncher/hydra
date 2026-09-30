import {
  cloudSaveRpcs3ProfileBindingsSublevel,
  db,
  levelKeys,
} from "@main/level";
import type { GameShop, User } from "@types";

import {
  isCurrentRpcs3ProfileBinding,
  type Rpcs3ProfileBinding,
} from "./rpcs3-profile-binding-policy";

const getStorageKey = async (shop: GameShop, objectId: string) => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });
  if (!user?.id) throw new Error("cloud_save_user_unavailable");
  return JSON.stringify([user.id, shop, objectId]);
};

export const getRpcs3ProfileBinding = async (
  shop: GameShop,
  objectId: string,
  configRoot: string,
  homeRoot: string,
  localProfileId: string
): Promise<Rpcs3ProfileBinding | null> => {
  const stored = await cloudSaveRpcs3ProfileBindingsSublevel.get(
    await getStorageKey(shop, objectId)
  );
  return isCurrentRpcs3ProfileBinding(
    stored,
    configRoot,
    homeRoot,
    localProfileId
  )
    ? stored
    : null;
};

export const setRpcs3ProfileBinding = async (
  shop: GameShop,
  objectId: string,
  binding: Rpcs3ProfileBinding
) => {
  if (
    !isCurrentRpcs3ProfileBinding(
      binding,
      binding.configRoot,
      binding.homeRoot,
      binding.localProfileId
    )
  ) {
    throw new Error("cloud_save_rpcs3_profile_binding_invalid");
  }
  await cloudSaveRpcs3ProfileBindingsSublevel.put(
    await getStorageKey(shop, objectId),
    binding
  );
};
