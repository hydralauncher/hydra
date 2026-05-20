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
export const INTEGRATIONS_SECTION_REGION_ID = "integrations-section-region";

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

export type IntegrationProviderId =
  | "real-debrid"
  | "premiumize"
  | "all-debrid"
  | "torbox";

export function getIntegrationProviderRegionId(providerId: IntegrationProviderId) {
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
