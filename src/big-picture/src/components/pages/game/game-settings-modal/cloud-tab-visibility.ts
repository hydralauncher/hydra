import type { GameShop } from "@types";
import {
  getCloudSaveEmulatorProvider,
  isCloudSaveV2Eligible,
} from "../../../../../../shared/cloud-save-emulator-provider.js";

export const shouldShowLegacyCloudSaveTab = (
  shop: GameShop,
  isSignedIn: boolean,
  hasActiveSubscription: boolean,
  platform?: string | null
) =>
  shop !== "steam" &&
  getCloudSaveEmulatorProvider(shop, platform) === null &&
  isSignedIn &&
  hasActiveSubscription;

export const shouldShowCloudSaveV2Tab = (
  shop: GameShop,
  isSignedIn: boolean,
  hasActiveSubscription: boolean,
  platform?: string | null
) =>
  isCloudSaveV2Eligible(shop, platform) && isSignedIn && hasActiveSubscription;
