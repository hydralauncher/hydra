import type { CloudSaveAutomaticSyncMode, GameShop } from "@types";
import { getCloudSaveEmulatorProvider } from "../../../shared/cloud-save-emulator-provider.js";

export type { CloudSaveAutomaticSyncMode } from "@types";

export interface CloudSaveAutomaticSyncState {
  legacyEnabled: boolean;
  v2Enabled: boolean;
}

export const resolveCloudSaveAutomaticSyncMode = ({
  legacyEnabled,
  v2Enabled,
}: CloudSaveAutomaticSyncState): CloudSaveAutomaticSyncMode => {
  if (v2Enabled) return "v2";
  if (legacyEnabled) return "legacy";
  return "disabled";
};

export const resolveStoredCloudSaveAutomaticSyncMode = (
  legacyEnabled: boolean,
  storedV2Enabled: boolean | undefined
) =>
  resolveCloudSaveAutomaticSyncMode({
    legacyEnabled,
    v2Enabled: storedV2Enabled ?? true,
  });

export const resolveStoredCloudSaveAutomaticSyncModeForShop = (
  shop: GameShop,
  legacyEnabled: boolean,
  storedV2Enabled: boolean | undefined,
  platform?: string | null
) => {
  if (shop === "steam") {
    return resolveStoredCloudSaveAutomaticSyncMode(
      legacyEnabled,
      storedV2Enabled
    );
  }
  if (getCloudSaveEmulatorProvider(shop, platform)) {
    return resolveCloudSaveAutomaticSyncMode({
      legacyEnabled: false,
      v2Enabled: storedV2Enabled ?? true,
    });
  }
  return resolveCloudSaveAutomaticSyncMode({
    legacyEnabled,
    v2Enabled: false,
  });
};

export const getCloudSaveAutomaticSyncStateForMode = (
  mode: CloudSaveAutomaticSyncMode
): CloudSaveAutomaticSyncState => ({
  legacyEnabled: mode === "legacy",
  v2Enabled: mode === "v2",
});

export const getNextCloudSaveAutomaticSyncMode = (
  currentMode: CloudSaveAutomaticSyncMode,
  targetMode: Exclude<CloudSaveAutomaticSyncMode, "disabled">,
  enabled: boolean
): CloudSaveAutomaticSyncMode => {
  if (enabled) return targetMode;
  return currentMode === targetMode ? "disabled" : currentMode;
};

export const shouldRunLegacyAutomaticCloudSave = (
  mode: CloudSaveAutomaticSyncMode
) => mode === "legacy";

export const shouldRunV2AutomaticCloudSave = (
  mode: CloudSaveAutomaticSyncMode
) => mode === "v2";
