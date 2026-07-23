import { cloudSaveAutomaticSyncSettingsSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

import { assertCloudSaveSubscription } from "./cloud-save-access";

const getAutomaticSyncKey = (shop: GameShop, objectId: string) =>
  levelKeys.game(shop, objectId);

export const getCloudSaveAutomaticSyncEnabled = async (
  objectId: string,
  shop: GameShop
) =>
  (await cloudSaveAutomaticSyncSettingsSublevel.get(
    getAutomaticSyncKey(shop, objectId)
  )) ?? true;

export const setCloudSaveAutomaticSyncEnabled = async (
  objectId: string,
  shop: GameShop,
  enabled: boolean
) => {
  if (enabled) {
    assertCloudSaveSubscription();
  }

  const key = getAutomaticSyncKey(shop, objectId);

  if (enabled) {
    await cloudSaveAutomaticSyncSettingsSublevel.del(key);
  } else {
    await cloudSaveAutomaticSyncSettingsSublevel.put(key, false);
  }

  return enabled;
};
