import type { GameShop } from "@types";

export const shouldShowLegacyCloudSaveTab = (
  shop: GameShop,
  isSignedIn: boolean,
  hasActiveSubscription: boolean
) => shop !== "steam" && isSignedIn && hasActiveSubscription;

export const shouldShowCloudSaveV2Tab = (
  shop: GameShop,
  isSignedIn: boolean,
  hasActiveSubscription: boolean
) => shop === "steam" && isSignedIn && hasActiveSubscription;
