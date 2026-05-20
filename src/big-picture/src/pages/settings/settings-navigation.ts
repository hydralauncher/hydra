export const SETTINGS_TABS_REGION_ID = "settings-tabs-region";
export const SETTINGS_TAB_FOCUS_IDS = {
  general: "settings-tab-general",
  downloads: "settings-tab-downloads",
  notifications: "settings-tab-notifications",
  "content-gameplay": "settings-tab-content-gameplay",
  integrations: "settings-tab-integrations",
  compatibility: "settings-tab-compatibility",
  "account-privacy": "settings-tab-account-privacy",
} as const;

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

export function getLastDownloadsBehaviorItemFocusId(isWindows: boolean) {
  return isWindows
    ? DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.createStartMenuShortcut
    : DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS
        .deleteArchiveFilesAfterExtractionByDefault;
}

export function getDownloadsSourceRemoveButtonFocusId(sourceId: string) {
  return `downloads-source-remove-${sourceId}`;
}
