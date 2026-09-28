import type { GameShop } from "@types";
import { getCloudSaveEmulatorProvider } from "../../../../shared/cloud-save-emulator-provider.js";

export type CloudSaveUiMode = "legacy" | "v2";
export type LegacyCloudSavePurpose = "active" | "archive";

export interface CloudSaveSettingsVisibility {
  showV2: boolean;
  showLegacy: boolean;
  legacyPurpose: LegacyCloudSavePurpose;
}

export interface CloudSaveVisibility {
  hero: CloudSaveUiMode | null;
  settings: CloudSaveSettingsVisibility;
}

export const isLegacyCloudSaveSettingsAvailable = (
  settings: CloudSaveSettingsVisibility,
  hasActiveSubscription: boolean,
  artifactCount: number
): boolean =>
  settings.showLegacy &&
  (settings.legacyPurpose === "active" ||
    (hasActiveSubscription && artifactCount > 0));

export const getCloudSaveVisibility = (
  shop: GameShop,
  platform?: string | null
): CloudSaveVisibility => {
  if (shop === "steam") {
    return {
      hero: "v2",
      settings: {
        showV2: true,
        showLegacy: true,
        legacyPurpose: "archive",
      },
    };
  }

  if (shop === "launchbox") {
    if (getCloudSaveEmulatorProvider(shop, platform)) {
      return {
        hero: "v2",
        settings: {
          showV2: true,
          showLegacy: true,
          legacyPurpose: "archive",
        },
      };
    }
    return {
      hero: "legacy",
      settings: {
        showV2: false,
        showLegacy: true,
        legacyPurpose: "active",
      },
    };
  }

  return {
    hero: null,
    settings: {
      showV2: false,
      showLegacy: true,
      legacyPurpose: "active",
    },
  };
};
