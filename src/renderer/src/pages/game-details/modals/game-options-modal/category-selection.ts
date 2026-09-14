import type { CloudSaveAccessAction } from "@shared";

import type { GameSettingsCategoryId } from "./types";

export interface GameSettingsCategoryAvailability {
  cloudSaveAccessAction: CloudSaveAccessAction;
  showCloudSaveV2Settings: boolean;
  showLegacyCloudSaveSettings: boolean;
  showDownloadSettings: boolean;
}

export interface GameSettingsCategoryInitializationState {
  visible: boolean;
  initialCategory: GameSettingsCategoryId | undefined;
}

export const shouldInitializeGameSettingsCategory = (
  previousState: GameSettingsCategoryInitializationState,
  currentState: GameSettingsCategoryInitializationState
): boolean =>
  currentState.visible &&
  (!previousState.visible ||
    previousState.initialCategory !== currentState.initialCategory);

export const getAvailableGameSettingsCategory = (
  category: GameSettingsCategoryId,
  availability: GameSettingsCategoryAvailability
): GameSettingsCategoryId => {
  if (
    category === "hydra_cloud" &&
    (!availability.showCloudSaveV2Settings ||
      availability.cloudSaveAccessAction !== "open")
  ) {
    return "general";
  }

  if (
    category === "hydra_cloud_legacy" &&
    (!availability.showLegacyCloudSaveSettings ||
      availability.cloudSaveAccessAction !== "open")
  ) {
    return "general";
  }

  if (category === "downloads" && !availability.showDownloadSettings) {
    return "general";
  }

  return category;
};
