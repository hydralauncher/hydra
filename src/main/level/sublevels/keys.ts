import type { GameShop } from "@types";

export const levelKeys = {
  games: "games",
  game: (shop: GameShop, objectId: string) => `${shop}:${objectId}`,
  user: "user",
  auth: "auth",
  themes: "themes",
  gameShopAssets: "gameShopAssets",
  artworkSelection: "artworkSelection",
  gameStatsCache: "gameStatsAssets",
  gameShopCache: "gameShopCache",
  gameShopCacheItem: (shop: GameShop, objectId: string, language: string) =>
    `${shop}:${objectId}:${language}`,
  downloads: "downloads",
  downloadLayoutState: "downloadLayoutState",
  userPreferences: "userPreferences",
  language: "language",
  screenState: "screenState",
  rpcPassword: "rpcPassword",
  downloadSources: "downloadSources",
  downloadSourcesCheckBaseline: "downloadSourcesCheckBaseline", // When we last started the app
  downloadSourcesSinceValue: "downloadSourcesSinceValue", // The 'since' value API used (for modal comparison)
  localNotifications: "localNotifications",
  commonRedistPassed: "commonRedistPassed", // Whether common redistributables preflight has passed
  emulators: "emulators",
  retroarch: "retroarch",
  retroArchSouvenirConfigBackups: "retroarch-souvenir-config-backups",
  duckStationSouvenirConfigBackups: "duckstation-souvenir-config-backups",
  pendingAchievementSouvenirs: "pending-achievement-souvenirs",
  pendingGroupedAchievementSouvenirs: "pending-grouped-achievement-souvenirs",
  localSouvenirAssets: "local-souvenir-assets",
  globalTrackersUrlCache: "globalTrackersUrlCache",
  ps2MemoryCardSaves: "ps2MemoryCardSaves",
  ps2MemoryCardSave: (cardFilePath: string, folderName: string) =>
    `${cardFilePath}::${folderName}`,
  ps1MemoryCardSaves: "ps1MemoryCardSaves",
  ps1MemoryCardSave: (cardFilePath: string, identifier: string) =>
    `${cardFilePath}::${identifier}`,
  cloudSaveLocalHashCache: "cloud-save-local-hash-cache",
  cloudSavePrefixGenerations: "cloud-save-prefix-generations",
  cloudSaveSyncAnchors: "cloud-save-sync-anchors",
  cloudSaveAutomaticSyncSettings: "cloud-save-automatic-sync-settings",
  cloudSaveV2DefaultMigration: "cloud-save-v2-default-migration",
  cloudSaveCustomPaths: "cloud-save-custom-paths",
  cloudSavePendingDeletions: "cloud-save-pending-deletions",
};
