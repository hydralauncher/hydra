import type { GameShop } from "@types";
import { supportsCloudSaveV2 } from "../../../../../../shared/cloud-save-shops.js";

export const shouldShowLegacyCloudSaveTab = (
  shop: GameShop,
  isSignedIn: boolean,
  hasActiveSubscription: boolean
) => !supportsCloudSaveV2(shop) && isSignedIn && hasActiveSubscription;

export const shouldShowCloudSaveV2Tab = (
  shop: GameShop,
  isSignedIn: boolean,
  hasActiveSubscription: boolean
) => supportsCloudSaveV2(shop) && isSignedIn && hasActiveSubscription;
