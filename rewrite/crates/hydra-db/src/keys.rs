//! `src/main/level/sublevels/keys.ts` (levelKeys). Keep in sync.

pub const GAMES: &str = "games";
pub const USER: &str = "user";
pub const AUTH: &str = "auth";
pub const GAME_SHOP_ASSETS: &str = "gameShopAssets";
pub const ARTWORK_SELECTION: &str = "artworkSelection";
pub const GAME_STATS_CACHE: &str = "gameStatsAssets";
pub const CATALOGUE_NAMES_CACHE: &str = "catalogueNamesCache";
pub const GAME_SHOP_CACHE: &str = "gameShopCache";
pub const DOWNLOADS: &str = "downloads";
pub const DOWNLOAD_LAYOUT_STATE: &str = "downloadLayoutState";
pub const USER_PREFERENCES: &str = "userPreferences";
pub const LANGUAGE: &str = "language";
pub const SCREEN_STATE: &str = "screenState";
pub const DOWNLOAD_SOURCES: &str = "downloadSources";
pub const DOWNLOAD_SOURCES_CHECK_BASELINE: &str = "downloadSourcesCheckBaseline";
pub const DOWNLOAD_SOURCES_SINCE_VALUE: &str = "downloadSourcesSinceValue";
pub const LOCAL_NOTIFICATIONS: &str = "localNotifications";
pub const COMMON_REDIST_PASSED: &str = "commonRedistPassed";
pub const EMULATORS: &str = "emulators";
pub const RETROARCH: &str = "retroarch";
pub const RETROACHIEVEMENTS_EMULATOR_ACCOUNT: &str = "retroachievements-emulator-account";
pub const SOCIAL_WINDOWS_SESSION: &str = "social-windows-session";
pub const SOCIAL_WINDOWS_BOUNDS: &str = "social-windows-bounds";
pub const PENDING_ACHIEVEMENT_SOUVENIRS: &str = "pending-achievement-souvenirs";
pub const PENDING_GROUPED_ACHIEVEMENT_SOUVENIRS: &str = "pending-grouped-achievement-souvenirs";
pub const LOCAL_SOUVENIR_ASSETS: &str = "local-souvenir-assets";
pub const SCREENSHOTS: &str = "screenshots";
pub const SCREENSHOTS_FEATURE_ENABLED: &str = "screenshotsFeatureEnabled";
pub const GLOBAL_TRACKERS_URL_CACHE: &str = "globalTrackersUrlCache";
pub const PS2_MEMORY_CARD_SAVES: &str = "ps2MemoryCardSaves";
pub const PS1_MEMORY_CARD_SAVES: &str = "ps1MemoryCardSaves";
pub const CLOUD_SAVE_LOCAL_HASH_CACHE: &str = "cloud-save-local-hash-cache";
pub const CLOUD_SAVE_PREFIX_GENERATIONS: &str = "cloud-save-prefix-generations";
pub const CLOUD_SAVE_SYNC_ANCHORS: &str = "cloud-save-sync-anchors";
pub const CLOUD_SAVE_AUTOMATIC_SYNC_SETTINGS: &str = "cloud-save-automatic-sync-settings";
pub const CLOUD_SAVE_CUSTOM_PATHS: &str = "cloud-save-custom-paths";
pub const CLOUD_SAVE_EMULATOR_DESTINATIONS: &str = "cloud-save-emulator-destinations";
pub const CLOUD_SAVE_RETROARCH_BINDINGS: &str = "cloud-save-retroarch-bindings";
pub const CLOUD_SAVE_PENDING_DELETIONS: &str = "cloud-save-pending-deletions";
pub const STEAM_SYNC_RUN: &str = "steamSyncRun";
pub const CHAT_NOTIFICATION_CURSOR: &str = "chatNotificationCursor";
pub const LEADERBOARD_NOTIFICATIONS_SHOWN: &str = "leaderboardNotificationsShown";
pub const RECOMPILATION_INSTALLS: &str = "recompilationInstalls";

/// Rewrite-only: the renderer's `localStorage` (sidebar width, filters, …),
/// imported once from Chromium's storage and kept here afterwards.
pub const LOCAL_STORAGE: &str = "localStorage";

/// `levelKeys.game(shop, objectId)`.
pub fn game(shop: &str, object_id: &str) -> String {
    format!("{shop}:{object_id}")
}

/// `levelKeys.gameShopCacheItem(shop, objectId, language)`.
pub fn game_shop_cache_item(shop: &str, object_id: &str, language: &str) -> String {
    format!("{shop}:{object_id}:{language}")
}
