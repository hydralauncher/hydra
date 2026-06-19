import type { FocusOverrideTarget, FocusOverrides } from "../../services";
import { getItemFocusTarget } from "../../helpers";
import {
  BIG_PICTURE_HEADER_REGION_ID,
  BIG_PICTURE_SIDEBAR_ITEM_IDS,
} from "../../layout/navigation";

export const DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID =
  "download-directories-default-select";
export const LANGUAGE_SECTION_BUTTON_ID = "language-section-button";
export const BEHAVIOR_SECTION_REGION_ID = "behavior-section-region";
export const DOWNLOADS_BEHAVIOR_SECTION_REGION_ID =
  "downloads-behavior-section-region";
export const DOWNLOADS_SOURCES_SECTION_REGION_ID =
  "downloads-sources-section-region";
export const DOWNLOADS_SOURCES_ACTIONS_REGION_ID =
  "downloads-sources-actions-region";
export const DOWNLOADS_SOURCES_SYNC_BUTTON_ID = "downloads-sources-sync-button";
export const DOWNLOADS_SOURCES_DELETE_ALL_BUTTON_ID =
  "downloads-sources-delete-all-button";
export const DOWNLOADS_SOURCES_EMPTY_STATE_ID = "downloads-sources-empty-state";
export const NOTIFICATIONS_LIBRARY_SECTION_REGION_ID =
  "notifications-library-section-region";
export const NOTIFICATIONS_ACHIEVEMENTS_SECTION_REGION_ID =
  "notifications-achievements-section-region";
export const NOTIFICATIONS_ACHIEVEMENTS_ACTIONS_REGION_ID =
  "notifications-achievements-actions-region";
export const NOTIFICATIONS_ACHIEVEMENTS_POSITION_SELECT_ID =
  "notifications-achievements-position-select";
export const NOTIFICATIONS_ACHIEVEMENTS_TEST_BUTTON_ID =
  "notifications-achievements-test-button";
export const CONTENT_SECTION_REGION_ID = "content-section-region";
export const BIG_PICTURE_SECTION_REGION_ID = "big-picture-section-region";
export const BIG_PICTURE_STARTUP_SECTION_REGION_ID =
  "big-picture-startup-section-region";
export const BIG_PICTURE_AUDIO_SECTION_REGION_ID =
  "big-picture-audio-section-region";
export const BIG_PICTURE_DIAGNOSTICS_SECTION_REGION_ID =
  "big-picture-diagnostics-section-region";
export const BIG_PICTURE_DIAGNOSTICS_POSITION_SELECT_ID =
  "big-picture-diagnostics-position-select";
export const COMPATIBILITY_SECTION_REGION_ID = "compatibility-section-region";
export const INTEGRATIONS_SECTION_REGION_ID = "integrations-section-region";
export const ACCOUNT_PRIVACY_PRIVACY_SELECT_ID =
  "account-privacy-profile-visibility";
export const COMPATIBILITY_GAMEMODE_FOCUS_ID = "compatibility-gamemode";
export const COMPATIBILITY_MANGOHUD_FOCUS_ID = "compatibility-mangohud";
export const COMPATIBILITY_COMMON_REDIST_BUTTON_ID =
  "compatibility-common-redist";
export const ACCOUNT_PRIVACY_UPDATE_EMAIL_BUTTON_ID =
  "account-privacy-update-email";
export const ACCOUNT_PRIVACY_UPDATE_PASSWORD_BUTTON_ID =
  "account-privacy-update-password";
export const ACCOUNT_PRIVACY_HYDRA_CLOUD_BUTTON_ID =
  "account-privacy-hydra-cloud";
export const EMULATION_OVERVIEW_REGION_ID = "emulation-overview-region";
export const EMULATION_DETAIL_REGION_ID = "emulation-detail-region";
export const EMULATION_DETAIL_EXECUTABLE_REGION_ID =
  "emulation-detail-executable-region";
export const EMULATION_DETAIL_ROM_FOLDERS_REGION_ID =
  "emulation-detail-rom-folders-region";
export const EMULATION_DETAIL_MEMORY_CARDS_REGION_ID =
  "emulation-detail-memory-cards-region";
export const EMULATION_DETAIL_CLOUD_SAVES_REGION_ID =
  "emulation-detail-cloud-saves-region";
export const EMULATION_DETAIL_LIBRARY_REGION_ID =
  "emulation-detail-library-region";
export const EMULATION_OVERVIEW_CARD_FOCUS_IDS = {
  ps1: "emulation-overview-ps1-card",
  ps2: "emulation-overview-ps2-card",
  ps3: "emulation-overview-ps3-card",
} as const;
export const EMULATION_DETAIL_BACK_BUTTON_ID = "emulation-detail-back-button";
export const EMULATION_DETAIL_REMOVE_EMULATOR_BUTTON_ID =
  "emulation-detail-remove-emulator";
export const EMULATION_DETAIL_EXECUTABLE_BUTTON_ID =
  "emulation-detail-executable-button";
export const EMULATION_DETAIL_REDETECT_BUTTON_ID =
  "emulation-detail-redetect-button";
export const EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID =
  "emulation-detail-add-folder";
export const EMULATION_DETAIL_RESCAN_BUTTON_ID = "emulation-detail-rescan";
export const EMULATION_DETAIL_MEMORY_CARDS_PICK_BUTTON_ID =
  "emulation-detail-memory-cards-pick";
export const EMULATION_DETAIL_MEMORY_CARDS_DETECT_BUTTON_ID =
  "emulation-detail-memory-cards-detect";
export const EMULATION_DETAIL_CLOUD_REFRESH_BUTTON_ID =
  "emulation-detail-cloud-refresh";

export const BEHAVIOR_ITEM_FOCUS_IDS = {
  preferQuitInsteadOfHiding: "behavior-prefer-quit-instead-of-hiding",
  hideToTrayOnGameStart: "behavior-hide-to-tray-on-game-start",
  runAtStartup: "behavior-run-at-startup",
  startMinimized: "behavior-start-minimized",
  launchToLibraryPage: "behavior-launch-to-library-page",
  launchInBigPicture: "behavior-launch-in-big-picture",
  enableAutoInstall: "behavior-enable-auto-install",
} as const;

export const DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS = {
  seedAfterDownloadComplete: "downloads-behavior-seed-after-download-complete",
  showDownloadSpeedInMegabytes:
    "downloads-behavior-show-download-speed-in-megabytes",
  extractFilesByDefault: "downloads-behavior-extract-files-by-default",
  deleteArchiveFilesAfterExtractionByDefault:
    "downloads-behavior-delete-archive-files-after-extraction-by-default",
  createStartMenuShortcut: "downloads-behavior-create-start-menu-shortcut",
} as const;

export const NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS = {
  downloadNotificationsEnabled: "notifications-library-download-notifications",
  repackUpdatesNotificationsEnabled:
    "notifications-library-repack-updates-notifications",
  friendRequestNotificationsEnabled:
    "notifications-library-friend-request-notifications",
  friendStartGameNotificationsEnabled:
    "notifications-library-friend-start-game-notifications",
} as const;

export const NOTIFICATIONS_ACHIEVEMENTS_ITEM_FOCUS_IDS = {
  achievementNotificationsEnabled:
    "notifications-achievements-achievement-notifications",
  achievementCustomNotificationsEnabled:
    "notifications-achievements-custom-achievement-notifications",
} as const;

export const CONTENT_ITEM_FOCUS_IDS = {
  autoplayGameTrailers: "content-autoplay-game-trailers",
  disableNsfwAlert: "content-disable-nsfw-alert",
  showHiddenAchievementsDescription:
    "content-show-hidden-achievements-description",
  enableSteamAchievements: "content-enable-steam-achievements",
} as const;

export const BIG_PICTURE_ITEM_FOCUS_IDS = {
  launchInBigPicture: "big-picture-launch-in-big-picture",
  enableSounds: "big-picture-enable-sounds",
  enableVirtualKeyboard: "big-picture-enable-virtual-keyboard",
  enableDiagnostics: "big-picture-enable-diagnostics",
} as const;

export const COMPATIBILITY_PROTON_OPTION_AUTO_FOCUS_ID =
  "compatibility-proton-option-auto";

export const SETTINGS_HEADER_RETURN_TARGET: FocusOverrideTarget = {
  type: "region",
  regionId: BIG_PICTURE_HEADER_REGION_ID,
  entryDirection: "down",
};

export const SETTINGS_SIDEBAR_RETURN_TARGET = getItemFocusTarget(
  BIG_PICTURE_SIDEBAR_ITEM_IDS.settings
);

export type IntegrationProviderId =
  | "real-debrid"
  | "premiumize"
  | "all-debrid"
  | "torbox";

export function getIntegrationProviderRegionId(
  providerId: IntegrationProviderId
) {
  return `integrations-${providerId}-region`;
}

export function getIntegrationProviderCheckboxFocusId(
  providerId: IntegrationProviderId
) {
  return `integrations-${providerId}-checkbox`;
}

export function getIntegrationProviderInputFocusId(
  providerId: IntegrationProviderId
) {
  return `integrations-${providerId}-input`;
}

export function getIntegrationProviderSaveButtonFocusId(
  providerId: IntegrationProviderId
) {
  return `integrations-${providerId}-save`;
}

export function getLastDownloadsBehaviorItemFocusId(isWindows: boolean) {
  return isWindows
    ? DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.createStartMenuShortcut
    : DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.deleteArchiveFilesAfterExtractionByDefault;
}

export function getDownloadsSourceRemoveButtonFocusId(sourceId: string) {
  return `downloads-source-remove-${sourceId}`;
}

export function getCompatibilityProtonOptionFocusId(path: string) {
  return `compatibility-proton-option-${path.replaceAll(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;
}

export function getAccountPrivacyBlockedUserButtonFocusId(userId: string) {
  return `account-privacy-blocked-user-${userId}`;
}

export function getEmulationRomFolderToggleFocusId(folderId: string) {
  return `emulation-rom-folder-toggle-${folderId}`;
}

export function getEmulationRomFolderRemoveFocusId(folderId: string) {
  return `emulation-rom-folder-remove-${folderId}`;
}

function sanitizeEmulationFocusToken(value: string) {
  return value.replaceAll(/[^a-z0-9_-]/gi, "-").toLowerCase();
}

export function getEmulationMemcardGroupCollapseFocusId(cardFilePath: string) {
  return `emulation-memcard-group-${sanitizeEmulationFocusToken(cardFilePath)}`;
}

export function getEmulationMemcardBackupAllFocusId(cardFilePath: string) {
  return `emulation-memcard-backup-all-${sanitizeEmulationFocusToken(cardFilePath)}`;
}

export function getEmulationMemcardRemoveCardFocusId(cardFilePath: string) {
  return `emulation-memcard-remove-card-${sanitizeEmulationFocusToken(cardFilePath)}`;
}

export function getEmulationMemcardMenuFocusId(saveKey: string) {
  return `emulation-memcard-menu-${sanitizeEmulationFocusToken(saveKey)}`;
}

export function getEmulationCloudMenuFocusId(saveId: string) {
  return `emulation-cloud-menu-${sanitizeEmulationFocusToken(saveId)}`;
}

export function getEmulationCloudRestoreTargetFocusId(cardFilePath: string) {
  return `emulation-cloud-restore-target-${sanitizeEmulationFocusToken(cardFilePath)}`;
}

export function getEmulationCloudRestoreTargetNavigationOverrides({
  cardFilePath,
  firstCardFilePath,
  lastCardFilePath,
  pickButtonId,
}: {
  cardFilePath: string;
  firstCardFilePath?: string;
  lastCardFilePath?: string;
  pickButtonId: string;
}): FocusOverrides | undefined {
  const isFirstTarget = firstCardFilePath === cardFilePath;
  const isLastTarget = lastCardFilePath === cardFilePath;

  if (!isFirstTarget && !isLastTarget) {
    return undefined;
  }

  return {
    ...(isFirstTarget
      ? {
          up: {
            type: "block" as const,
          },
        }
      : {}),
    ...(isLastTarget
      ? {
          down: {
            type: "item" as const,
            itemId: pickButtonId,
          },
        }
      : {}),
  };
}

export function getEmulationCloudRestoreButtonNavigationOverrides(
  selectedTarget: string | null
): FocusOverrides | undefined {
  if (!selectedTarget) {
    return undefined;
  }

  return {
    up: {
      type: "item",
      itemId: getEmulationCloudRestoreTargetFocusId(selectedTarget),
    },
  };
}
