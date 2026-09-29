import type { GameShop } from "@types";

export const supportsCloudSaveV2 = (shop: GameShop): boolean =>
  shop === "steam" || shop === "epic";

export const isManualCloudSaveV2Blocked = (
  shop: GameShop,
  legacyAutomaticSync: boolean,
  v2AutomaticSyncEnabled: boolean | null
): boolean =>
  shop === "epic" && legacyAutomaticSync && v2AutomaticSyncEnabled !== true;

export const refreshCloudSaveAfterModeChange = async (
  shop: GameShop,
  refresh: () => Promise<void>
): Promise<void> => {
  if (shop === "epic") {
    void refresh().catch(() => undefined);
  } else {
    await refresh();
  }
};
