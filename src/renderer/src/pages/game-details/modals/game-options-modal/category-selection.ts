import type { CloudSaveAccessAction } from "@shared";
import type { LibraryGame } from "@types";

import type { GameSettingsCategoryId } from "./types";

export interface GameSettingsCategoryAvailability {
  cloudSaveAccessAction: CloudSaveAccessAction;
  showCloudSaveV2Settings: boolean;
  showLegacyCloudSaveSettings: boolean;
  showEpicCloudSettings: boolean;
  showDownloadSettings: boolean;
}

const epicCloudBridgeMethods = [
  "getEpicCloudSaveState",
  "setEpicCloudSaveSettings",
  "syncEpicCloudSaves",
  "resolveEpicCloudSaveConflict",
  "onEpicCloudSaveStateChanged",
  "onEpicConnectionChanged",
] as const;

export const isEpicCloudSettingsAvailable = (
  game: LibraryGame | null,
  bridge: Partial<Record<(typeof epicCloudBridgeMethods)[number], unknown>>
): boolean =>
  game?.shop === "epic" &&
  !game.isDeleted &&
  game.hasActiveEpicImport === true &&
  !!game.epicInstallation &&
  epicCloudBridgeMethods.every(
    (method) => typeof bridge[method] === "function"
  );

export const getCloudGameSettingsCategories = (
  availability: GameSettingsCategoryAvailability,
  legacyPurpose: "active" | "archive"
): GameSettingsCategoryId[] => {
  const categories: GameSettingsCategoryId[] = [];
  const showHydra = availability.cloudSaveAccessAction !== "sign-in";
  if (showHydra && availability.showCloudSaveV2Settings) {
    categories.push("hydra_cloud");
  }
  const showLegacy = showHydra && availability.showLegacyCloudSaveSettings;
  if (showLegacy && legacyPurpose === "active") {
    categories.push("hydra_cloud_legacy");
  }
  if (availability.showEpicCloudSettings) {
    categories.push("epic_cloud");
  }
  if (showLegacy && legacyPurpose === "archive") {
    categories.push("hydra_cloud_legacy");
  }
  return categories;
};

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

  if (category === "epic_cloud" && !availability.showEpicCloudSettings) {
    return "general";
  }

  return category;
};
