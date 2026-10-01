import type { GameShop } from "@types";

export const supportsCloudSaveV2 = (shop: GameShop): boolean =>
  shop === "steam" || shop === "epic";
