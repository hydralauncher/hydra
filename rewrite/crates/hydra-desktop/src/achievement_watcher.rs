//! The achievement watcher in the app (hydra_core::achievement_watcher):
//! started with the app, pre-searched when signed in, reset on sign-in and
//! sign-out. Its unlocks go to achievement_notification, its refreshed lists
//! to the game and achievements pages (`on-update-achievements-*`).

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use hydra_core::achievement_watcher::{Config, Events, UnlockNotice, Watcher};
use hydra_core::achievements::Achievement;
use hydra_core::api::{ApiError, HydraApi};
use hydra_db::{Db, keys};
use serde_json::Value;

static WATCHER: OnceLock<Arc<Watcher>> = OnceLock::new();

/// The game each page shows ("game", "achievements"), so refreshes are only
/// fetched for games on screen.
static VIEWING: Mutex<Vec<(&'static str, String)>> = Mutex::new(Vec::new());

struct AppEvents;

impl Events for AppEvents {
    fn unlocked(&self, notice: UnlockNotice) {
        let _ = slint::invoke_from_event_loop(move || {
            crate::achievement_notification::publish_unlock(notice)
        });
    }

    fn combined(&self, games: usize, achievements: usize) {
        let _ = slint::invoke_from_event_loop(move || {
            crate::achievement_notification::publish_combined(games, achievements)
        });
    }

    fn updated(&self, shop: &str, object_id: &str, list: Vec<Achievement>) {
        let (shop, object_id) = (shop.to_string(), object_id.to_string());
        let _ = slint::invoke_from_event_loop(move || {
            crate::game_page::on_achievements_updated(&shop, &object_id, list.clone());
            crate::achievements_page::on_achievements_updated(&shop, &object_id, list);
        });
    }

    fn wants_updates(&self, shop: &str, object_id: &str) -> bool {
        let key = keys::game(shop, object_id);
        VIEWING
            .lock()
            .map(|v| v.iter().any(|(_, k)| *k == key))
            .unwrap_or(true)
    }
}

/// getSteamLocation
fn steam_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::RegKey;
        use winreg::enums::HKEY_CURRENT_USER;
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("Software\\Valve\\Steam")
            .and_then(|k| k.get_value::<String, _>("SteamPath"))
            .ok()
            .map(PathBuf::from)
    }
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir().map(|h| h.join("Library/Application Support/Steam"))
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let home = dirs::home_dir()?;
        let candidates = [
            home.join(".steam/steam"),
            home.join(".local/share/Steam"),
            home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
            home.join("snap/steam/common/.local/share/Steam"),
        ];
        candidates
            .iter()
            .find(|p| p.exists())
            .or(candidates.first())
            .cloned()
    }
}

/// Wine.getDefaultPrefixPath: defaultWinePrefixPath, else `<userData>/wine-prefixes` (Linux).
fn wine_default_root(db: &Db) -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    db.get::<Value>(keys::USER_PREFERENCES)
        .and_then(|p| {
            p.get("defaultWinePrefixPath")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(PathBuf::from)
        })
        .or_else(|| hydra_db::paths::native_user_data().map(|d| d.join("wine-prefixes")))
}

pub fn init(db: Arc<Db>, api: Arc<HydraApi>) {
    let config = Config::detect(steam_path(), wine_default_root(&db));
    let signed_in = api.is_logged_in();
    let watcher = Watcher::new(api, db, config, Arc::new(AppEvents));
    watcher.start(signed_in);
    let _ = WATCHER.set(watcher);
}

/// A page now shows this game (`page`: "game" or "achievements").
pub fn viewing(page: &'static str, shop: &str, object_id: &str) {
    if let Ok(mut viewing) = VIEWING.lock() {
        viewing.retain(|(p, _)| *p != page);
        viewing.push((page, keys::game(shop, object_id)));
    }
}

/// syncAndGetUnlockedAchievements (blocking: call it on a worker thread).
pub fn sync_and_get(
    api: &HydraApi,
    db: &Db,
    shop: &str,
    object_id: &str,
) -> Result<Vec<Achievement>, ApiError> {
    match WATCHER.get() {
        Some(watcher) => watcher.sync_and_get(shop, object_id),
        None => hydra_core::achievements::unlocked_achievements(api, db, shop, object_id),
    }
}

/// firstSyncWithRemoteIfNeeded (blocking), e.g. before comparing with another user.
pub fn first_sync(shop: &str, object_id: &str) {
    if let Some(watcher) = WATCHER.get()
        && let Err(error) = watcher.first_sync_if_needed(shop, object_id)
    {
        eprintln!("achievements: first sync {shop} {object_id}: {error}");
    }
}

/// HydraApi.handleSignIn: a new account, then uploadGamesBatch's pre-search.
pub fn on_signed_in() {
    if let Some(watcher) = WATCHER.get() {
        watcher.reset_session();
        let watcher = watcher.clone();
        std::thread::spawn(move || watcher.pre_search());
    }
}

/// Sign-out: forget what the account merged.
pub fn on_signed_out() {
    if let Some(watcher) = WATCHER.get() {
        watcher.reset_session();
    }
}

/// process-watcher onOpenGame: syncGameAchievementFiles.
pub fn on_game_opened(game_id: &str) {
    let Some(watcher) = WATCHER.get().cloned() else {
        return;
    };
    let Some((shop, object_id)) = game_id.split_once(':') else {
        return;
    };
    if shop == "custom" {
        return;
    }
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    std::thread::spawn(move || {
        if let Err(error) = watcher.sync_game_files(&shop, &object_id) {
            eprintln!("achievements: sync on launch {shop} {object_id}: {error}");
        }
    });
}
