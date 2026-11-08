//! The achievement watcher: achievement-watcher-manager.ts (pre-search at
//! startup, the 2s watch loop, first syncs from the pages), merge-achievements.ts
//! (dedupe, notify, upload), achievement-sync-worker.ts with
//! reconcile-achievement-memory.ts (PUT /profile/games/achievements with the
//! fingerprint dedupe, retries kept in LevelDB) and
//! buildAchievementNotificationInfo (achievement-unlock-notifications.ts).
//!
//! Two threads: the watcher (pre-search, then a tick every 2s) and the sync
//! worker. Merges are serialized by one lock (Electron queues them per game).
//!
//! Dev switches, for tests that must never reach the real account:
//! - `HYDRA_DEV_ACHIEVEMENT_ROOT=<dir>`: read the crack folders from a fake
//!   Wine prefix at `<dir>` (`drive_c/users/user/AppData/Roaming/…`) instead of
//!   this machine's, and skip Steam's library cache. Implies the next switch.
//! - `HYDRA_DEV_NO_ACHIEVEMENT_SYNC=1`: never PUT unlocks; log them instead.
//!
//! Not ported: achievement souvenirs (screenshot capture on unlock, the
//! grouped souvenir worker), runBatch/trackBatchGame (library imports),
//! resetGameAchievements, the UnlockedAchievementsCache.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use hydra_db::{Db, keys};
use serde_json::{Value, json};

use crate::achievement_files::{self, AchievementFile, Cracker, Folders};
use crate::achievement_game_files::{
    self, GameFilesQuery, LocationsCache, SteamInstall, collect_game_files,
};
use crate::achievement_store::{self, Memory, StoredUnlock, definition_key, merge_unlocked_lists};
use crate::achievements::{self, Achievement};
use crate::api::{ApiError, AuthContext, HydraApi, Options};

/// INTERVALS.achievementWatcher
pub const WATCH_INTERVAL: Duration = Duration::from_secs(2);
/// preSearchAchievements waits this long before the combined notification.
const PRE_SEARCH_NOTIFICATION_DELAY: Duration = Duration::from_secs(4);

/// achievement-sync-coordinator.ts
const SYNC_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const SYNC_RETRY_DELAY_MS: i64 = 1_000;
const SYNC_MAX_RETRY_DELAY_MS: i64 = 60_000;
const SYNC_MAX_RETRY_EXPONENT: u32 = 6;
const SYNC_RETRY_JITTER_DIVISOR: i64 = 4;
const SYNC_RETRYABLE_CLIENT_STATUSES: [u16; 3] = [408, 409, 429];
const SYNC_COALESCE_WINDOW_MS: i64 = 5_000;
const SYNC_MAX_SERVER_ERRORS: i64 = 10;

/// The LevelDB sublevel of unsent unlocks (shared with Electron's layout).
pub const PENDING_SYNC: &str = "pending-achievement-sync";

/// RARE_ACHIEVEMENT_MAX_UNLOCK_PERCENTAGE
const RARE_MAX_UNLOCK_PERCENTAGE: f64 = 10.0;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

// ---- notifications ------------------------------------------------------

/// `AchievementNotificationInfo`.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct NotificationInfo {
    pub title: String,
    pub description: Option<String>,
    pub icon_url: String,
    pub hidden: bool,
    pub rare: bool,
    pub platinum: bool,
    pub points: Option<i64>,
}

/// What publishAchievementUnlockNotifications receives.
#[derive(Clone, Debug, PartialEq)]
pub struct UnlockNotice {
    pub game_title: String,
    pub game_icon: Option<String>,
    pub achievements: Vec<NotificationInfo>,
    pub unlocked_count: usize,
    pub total_count: usize,
}

/// isRareAchievement: (50 - sqrt(points)) * 2 below 10%.
pub fn is_rare(points: i64) -> bool {
    (50.0 - (points as f64).sqrt()) * 2.0 < RARE_MAX_UNLOCK_PERCENTAGE
}

/// buildAchievementNotificationInfo: the last one is platinum when it completes the game.
pub fn notification_info(definitions: &[&Value], completes_game: bool) -> Vec<NotificationInfo> {
    let last = definitions.len().saturating_sub(1);
    definitions
        .iter()
        .enumerate()
        .map(|(index, d)| {
            let points = d.get("points").and_then(Value::as_f64).map(|p| p as i64);
            NotificationInfo {
                title: text(d, "displayName"),
                description: d
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                icon_url: text(d, "icon"),
                hidden: d.get("hidden").and_then(Value::as_bool).unwrap_or(false)
                    || d.get("hidden").and_then(Value::as_i64) == Some(1),
                rare: points.is_some_and(|p| p != 0 && is_rare(p)),
                platinum: completes_game && index == last,
                points,
            }
        })
        .collect()
}

/// What the app does with the watcher's findings.
pub trait Events: Send + Sync + 'static {
    /// publishAchievementUnlockNotifications
    fn unlocked(&self, notice: UnlockNotice);
    /// notifyCombinedAchievementsUnlocked ("X achievements in Y games")
    fn combined(&self, games: usize, achievements: usize);
    /// `on-update-achievements-${objectId}-${shop}`
    fn updated(&self, shop: &str, object_id: &str, list: Vec<Achievement>);
    /// Whether a page shows this game (skips the refresh requests otherwise).
    fn wants_updates(&self, _shop: &str, _object_id: &str) -> bool {
        true
    }
}

// ---- configuration ------------------------------------------------------

/// Where the crack folders are.
#[derive(Clone, Debug)]
pub enum Layout {
    /// Windows: this machine's folders.
    Windows(Folders),
    /// Linux: each game's Wine prefix (its winePrefixPath, else
    /// `<default_root>/<objectId>`), with the user's own profile name.
    Wine {
        default_root: Option<PathBuf>,
        user: String,
    },
}

#[derive(Clone, Debug)]
pub struct Config {
    pub layout: Layout,
    /// The Steam install, for its library cache (when enableSteamAchievements).
    pub steam: SteamInstall,
    /// Never PUT unlocks (dev).
    pub sync_disabled: bool,
}

impl Config {
    /// This machine's layout, honoring the dev switches.
    pub fn detect(steam_path: Option<PathBuf>, wine_default_root: Option<PathBuf>) -> Self {
        let no_sync = std::env::var_os("HYDRA_DEV_NO_ACHIEVEMENT_SYNC").is_some();
        if let Some(root) = std::env::var_os("HYDRA_DEV_ACHIEVEMENT_ROOT") {
            eprintln!(
                "achievements: dev root {} (no uploads)",
                PathBuf::from(&root).display()
            );
            return Self {
                layout: Layout::Windows(Folders::wine(Path::new(&root), "user")),
                steam: SteamInstall::default(),
                sync_disabled: true,
            };
        }
        let layout = if cfg!(windows) {
            Folders::windows().map(Layout::Windows)
        } else {
            None
        }
        .unwrap_or_else(|| Layout::Wine {
            default_root: wine_default_root,
            user: std::env::var("HOME")
                .ok()
                .and_then(|h| h.rsplit('/').next().map(str::to_string))
                .unwrap_or_default(),
        });
        Self {
            layout,
            steam: SteamInstall::at(steam_path),
            sync_disabled: no_sync,
        }
    }
}

// ---- games --------------------------------------------------------------

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// The `Game` fields the watcher reads.
#[derive(Clone, Debug)]
struct Game {
    shop: String,
    object_id: String,
    title: String,
    icon_url: Option<String>,
    remote_id: Option<String>,
    executable: Option<String>,
    wine_prefix: Option<String>,
    unlocked_count: i64,
    reported_count: i64,
}

impl Game {
    fn from_json(value: &Value) -> Option<Self> {
        let field = |k: &str| {
            value
                .get(k)
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        let count = |k: &str| value.get(k).and_then(Value::as_f64).unwrap_or(0.0) as i64;
        Some(Self {
            shop: field("shop")?,
            object_id: field("objectId")?,
            title: text(value, "title"),
            icon_url: field("iconUrl"),
            remote_id: field("remoteId"),
            executable: field("executablePath"),
            wine_prefix: field("winePrefixPath"),
            unlocked_count: count("unlockedAchievementCount"),
            reported_count: count("reportedUnlockedAchievementCount"),
        })
    }

    fn key(&self) -> String {
        keys::game(&self.shop, &self.object_id)
    }
}

// ---- merging ------------------------------------------------------------

/// The pure half of mergeAchievementsLocally: the unlocks that are new
/// (first occurrence per name wins, names uppercased) and the merged list.
pub fn compute_merge(
    existing: &[StoredUnlock],
    incoming: &[StoredUnlock],
) -> (Vec<StoredUnlock>, Vec<StoredUnlock>) {
    // new Map(achievements.toReversed().map(a => [a.name.toUpperCase(), a]))
    let mut order: Vec<String> = Vec::new();
    let mut by_name: HashMap<String, &StoredUnlock> = HashMap::new();
    for unlock in incoming.iter().rev() {
        let key = unlock.name.to_uppercase();
        if !by_name.contains_key(&key) {
            order.push(key.clone());
        }
        by_name.insert(key, unlock);
    }
    let known: HashSet<String> = existing.iter().map(|a| a.name.to_uppercase()).collect();
    let new: Vec<StoredUnlock> = order
        .into_iter()
        .filter(|name| !known.contains(name))
        .map(|name| {
            let unlock = by_name[&name];
            StoredUnlock {
                name,
                unlock_time: unlock.unlock_time,
                hardcore_unlock_time: unlock.hardcore_unlock_time,
            }
        })
        .collect();
    let merged = existing
        .iter()
        .cloned()
        .chain(new.iter().cloned())
        .collect();
    (new, merged)
}

/// The notification for newly merged unlocks (oldest first; unknown names dropped).
fn build_notice(
    game: &Game,
    new: &[StoredUnlock],
    definitions: &[Value],
    existing_count: usize,
) -> UnlockNotice {
    let mut sorted: Vec<&StoredUnlock> = new.iter().collect();
    sorted.sort_by_key(|a| a.unlock_time);
    let found: Vec<&Value> = sorted
        .iter()
        .filter_map(|a| definitions.iter().find(|d| definition_key(d) == a.name))
        .collect();
    let completes = new.len() + existing_count == definitions.len();
    UnlockNotice {
        game_title: game.title.clone(),
        game_icon: game.icon_url.clone(),
        achievements: notification_info(&found, completes),
        unlocked_count: existing_count + new.len(),
        total_count: definitions.len(),
    }
}

/// mergeDetectedAchievements: one per lowercase name (the last one wins).
fn dedupe_detected(unlocks: Vec<StoredUnlock>) -> Vec<StoredUnlock> {
    let mut order: Vec<String> = Vec::new();
    let mut by_name: HashMap<String, StoredUnlock> = HashMap::new();
    for unlock in unlocks {
        let key = unlock.name.to_lowercase();
        if !by_name.contains_key(&key) {
            order.push(key.clone());
        }
        by_name.insert(key, unlock);
    }
    order
        .into_iter()
        .filter_map(|k| by_name.remove(&k))
        .collect()
}

fn parse_all(files: &[AchievementFile]) -> Vec<StoredUnlock> {
    files
        .iter()
        .flat_map(|f| achievement_files::parse(&f.path, f.cracker))
        .map(|u| StoredUnlock::new(u.name, u.unlock_time))
        .collect()
}

// ---- the sync worker's records -----------------------------------------

/// toAchievementSyncEntry
fn sync_entry(unlock: &StoredUnlock) -> Value {
    match unlock.hardcore_unlock_time {
        None => json!({ "name": unlock.name, "unlockTime": unlock.unlock_time }),
        Some(hardcore) => json!({ "name": unlock.name, "unlockTime": hardcore, "hardcore": true }),
    }
}

/// toAchievementSyncPayload
pub fn sync_payload(remote_id: &str, achievements: &[StoredUnlock]) -> Value {
    json!({
        "id": remote_id,
        "achievements": achievements.iter().map(sync_entry).collect::<Vec<_>>(),
    })
}

/// fingerprintOf: the remote id and the entries by uppercase name.
pub fn fingerprint(remote_id: &str, achievements: &[StoredUnlock]) -> String {
    let mut entries: Vec<Value> = achievements
        .iter()
        .map(|a| {
            let mut entry = sync_entry(a);
            entry["name"] = json!(a.name.to_uppercase());
            entry
        })
        .collect();
    entries.sort_by_key(|a| text(a, "name"));
    serde_json::to_string(&json!([remote_id, entries])).unwrap_or_default()
}

/// isRetryableAchievementSyncStatus
pub fn is_retryable(status: u16) -> bool {
    status >= 500 || SYNC_RETRYABLE_CLIENT_STATUSES.contains(&status)
}

/// getAchievementSyncRetryDelay (no Retry-After: the API client drops headers).
pub fn retry_delay(attempts: i64, jitter: impl FnOnce(i64) -> i64) -> i64 {
    let exponent = attempts.clamp(0, SYNC_MAX_RETRY_EXPONENT as i64) as u32;
    let backoff = SYNC_MAX_RETRY_DELAY_MS.min(SYNC_RETRY_DELAY_MS * 2i64.pow(exponent));
    backoff + jitter(backoff / SYNC_RETRY_JITTER_DIVISOR + 1)
}

/// randomInt(0, max): xorshift over the clock (no rand dependency).
fn random_below(max: i64) -> i64 {
    if max <= 0 {
        return 0;
    }
    let mut x = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(1, |d| d.as_nanos() as u64)
        | 1;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    (x % max as u64) as i64
}

fn pending_key(context: &AuthContext, game_key: &str) -> String {
    serde_json::to_string(&json!([context.environment, context.user_id, game_key]))
        .unwrap_or_default()
}

fn unlocks_of(record: &Value) -> Vec<StoredUnlock> {
    record
        .get("achievements")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(StoredUnlock::from_json).collect())
        .unwrap_or_default()
}

fn int(record: &Value, key: &str) -> i64 {
    record.get(key).and_then(Value::as_f64).unwrap_or(0.0) as i64
}

fn is_terminal(record: &Value) -> bool {
    record.get("terminal").and_then(Value::as_bool) == Some(true)
}

// ---- the watcher --------------------------------------------------------

/// Achievement files by object id.
type FilesById = HashMap<String, Vec<AchievementFile>>;

#[derive(Default)]
struct FileState {
    /// fileStats: the last mtime per file (None: it could not be read, -1)
    stats: HashMap<PathBuf, Option<SystemTime>>,
    /// fltFiles: the entries of each FLT folder
    flt: HashMap<PathBuf, HashSet<String>>,
}

impl FileState {
    /// hasAchievementFileChanged (the first sighting counts as a change)
    fn changed(&mut self, file: &AchievementFile) -> bool {
        if file.cracker == Cracker::Flt {
            return self.flt_changed(&file.path);
        }
        match std::fs::metadata(&file.path).and_then(|m| m.modified()) {
            Ok(modified) => {
                let previous = self.stats.insert(file.path.clone(), Some(modified));
                previous != Some(Some(modified))
            }
            Err(_) => {
                self.stats.insert(file.path.clone(), None);
                false
            }
        }
    }

    /// hasFltFolderChanged: true when entries were added since the last look.
    fn flt_changed(&mut self, path: &Path) -> bool {
        match std::fs::read_dir(path) {
            Ok(entries) => {
                let current: HashSet<String> = entries
                    .flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect();
                let previous = self.flt.insert(path.to_path_buf(), current.clone());
                previous.is_some_and(|p| current.difference(&p).next().is_some())
            }
            Err(_) => {
                self.flt.insert(path.to_path_buf(), HashSet::new());
                false
            }
        }
    }

    /// preProcessGameAchievementFiles records the mtime it parsed.
    fn record(&mut self, path: &Path) {
        let modified = std::fs::metadata(path).and_then(|m| m.modified()).ok();
        self.stats.insert(path.to_path_buf(), modified);
    }
}

#[derive(Default)]
struct State {
    files: FileState,
    locations: LocationsCache,
    processing: HashSet<String>,
    /// alreadySyncedGames
    already_synced: HashSet<String>,
}

#[derive(Default)]
struct SyncState {
    /// acknowledged fingerprints per pending key
    acknowledged: HashMap<String, String>,
    dispatched_at: HashMap<String, i64>,
    woken: bool,
}

pub struct Watcher {
    api: Arc<HydraApi>,
    db: Arc<Db>,
    memory: &'static Memory,
    config: Config,
    events: Arc<dyn Events>,
    state: Mutex<State>,
    /// achievementSyncCoordinator.runMerge: one merge at a time
    merge: Mutex<()>,
    pre_searched: AtomicBool,
    sync: Mutex<SyncState>,
    sync_wake: Condvar,
}

impl Watcher {
    pub fn new(
        api: Arc<HydraApi>,
        db: Arc<Db>,
        config: Config,
        events: Arc<dyn Events>,
    ) -> Arc<Self> {
        Self::with_memory(api, db, config, events, achievement_store::memory())
    }

    fn with_memory(
        api: Arc<HydraApi>,
        db: Arc<Db>,
        config: Config,
        events: Arc<dyn Events>,
        memory: &'static Memory,
    ) -> Arc<Self> {
        Arc::new(Self {
            api,
            db,
            memory,
            config,
            events,
            state: Mutex::new(State::default()),
            merge: Mutex::new(()),
            pre_searched: AtomicBool::new(false),
            sync: Mutex::new(SyncState::default()),
            sync_wake: Condvar::new(),
        })
    }

    /// startMainLoop's achievement loop and the sync worker. `pre_search`
    /// runs first when signed in (Electron runs it after uploadGamesBatch).
    pub fn start(self: &Arc<Self>, pre_search: bool) {
        let watcher = self.clone();
        std::thread::Builder::new()
            .name("achievement-watcher".into())
            .spawn(move || {
                if pre_search {
                    watcher.pre_search();
                }
                loop {
                    watcher.watch();
                    std::thread::sleep(WATCH_INTERVAL);
                }
            })
            .ok();
        let worker = self.clone();
        std::thread::Builder::new()
            .name("achievement-sync".into())
            .spawn(move || worker.sync_loop())
            .ok();
    }

    pub fn has_finished_pre_search(&self) -> bool {
        self.pre_searched.load(Ordering::SeqCst)
    }

    /// resetSessionState (sign-in / sign-out): forget what this account merged.
    pub fn reset_session(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.already_synced.clear();
        }
        self.memory.clear();
        self.trigger_sync();
    }

    /// forgetAchievementFiles: the next look at these files counts as a change.
    pub fn forget_files(&self, game_key: &str, paths: &[PathBuf]) {
        if let Ok(mut state) = self.state.lock() {
            state.already_synced.remove(game_key);
            for path in paths {
                state.files.stats.remove(path);
                state.files.flt.remove(path);
            }
        }
    }

    fn games(&self) -> Vec<Game> {
        self.db
            .values::<Value>(keys::GAMES)
            .unwrap_or_default()
            .iter()
            .filter(|g| g.get("isDeleted").and_then(Value::as_bool) != Some(true))
            .filter_map(Game::from_json)
            .collect()
    }

    fn game(&self, shop: &str, object_id: &str) -> Option<Game> {
        let value: Value = self.db.get_in(keys::GAMES, &keys::game(shop, object_id))?;
        if value.get("isDeleted").and_then(Value::as_bool) == Some(true) {
            return None;
        }
        Game::from_json(&value)
    }

    fn steam_achievements_enabled(&self) -> bool {
        self.db
            .get::<Value>(keys::USER_PREFERENCES)
            .and_then(|p| p.get("enableSteamAchievements").and_then(Value::as_bool))
            .unwrap_or(false)
    }

    /// Wine.getEffectivePrefixPath
    fn prefix_of(&self, game: &Game) -> Option<PathBuf> {
        match &self.config.layout {
            Layout::Windows(_) => None,
            Layout::Wine { default_root, .. } => game
                .wine_prefix
                .as_ref()
                .map(PathBuf::from)
                .or_else(|| default_root.as_ref().map(|r| r.join(&game.object_id))),
        }
    }

    fn folders_of(&self, game: &Game) -> Option<Folders> {
        match &self.config.layout {
            Layout::Windows(folders) => Some(folders.clone()),
            Layout::Wine { user, .. } => self
                .prefix_of(game)
                .map(|prefix| Folders::wine(&prefix, user)),
        }
    }

    /// resolveGameExecutablePath: inside the Wine prefix when the file is there.
    fn executable_of(&self, game: &Game) -> Option<PathBuf> {
        let executable = game.executable.as_ref()?;
        if let Some(prefix) = self.prefix_of(game) {
            let prefixed = prefix.join(executable.trim_start_matches(['/', '\\']));
            if prefixed.exists() {
                return Some(prefixed);
            }
        }
        Some(PathBuf::from(executable))
    }

    /// collectGameAchievementFiles for one game.
    fn files_of(
        &self,
        game: &Game,
        static_files: Option<&HashMap<String, Vec<AchievementFile>>>,
        nested_files: Option<&HashMap<String, Vec<AchievementFile>>>,
    ) -> Vec<AchievementFile> {
        let Some(folders) = self.folders_of(game) else {
            return Vec::new();
        };
        let steam = self
            .steam_achievements_enabled()
            .then_some(&self.config.steam);
        let executable = self.executable_of(game);
        let query = GameFilesQuery {
            shop: &game.shop,
            object_id: &game.object_id,
            executable: executable.as_deref(),
            folders: &folders,
            steam,
            static_files,
            nested_files,
        };
        let Ok(mut state) = self.state.lock() else {
            return Vec::new();
        };
        collect_game_files(&query, &mut state.locations)
    }

    /// The shared-folder scans done once per pass on Windows.
    fn shared_scans(&self) -> (Option<FilesById>, Option<FilesById>) {
        match &self.config.layout {
            Layout::Windows(folders) => (
                Some(achievement_files::find_all(folders)),
                Some(achievement_game_files::find_nested(folders)),
            ),
            Layout::Wine { .. } => (None, None),
        }
    }

    /// watchAchievements: every 2s once the pre-search is done.
    pub fn watch(&self) {
        self.trigger_sync();
        if !self.has_finished_pre_search() {
            return;
        }
        let games: Vec<Game> = self
            .games()
            .into_iter()
            .filter(|g| {
                matches!(self.config.layout, Layout::Windows(_)) || self.prefix_of(g).is_some()
            })
            .collect();
        if games.is_empty() {
            return;
        }
        let (static_files, nested_files) = self.shared_scans();
        for game in games {
            let files = self.files_of(&game, static_files.as_ref(), nested_files.as_ref());
            if let Err(error) = self.process_changed(&game, &files) {
                eprintln!("achievements: {} {}: {error}", game.shop, game.object_id);
            }
        }
    }

    /// processChangedAchievementFiles
    fn process_changed(&self, game: &Game, files: &[AchievementFile]) -> Result<usize, ApiError> {
        let key = game.key();
        let changed: Vec<AchievementFile> = {
            let Ok(mut state) = self.state.lock() else {
                return Ok(0);
            };
            if !state.processing.insert(key.clone()) {
                return Ok(0);
            }
            files
                .iter()
                .filter(|f| state.files.changed(f))
                .cloned()
                .collect()
        };
        let result = if changed.is_empty() {
            Ok(0)
        } else {
            for file in &changed {
                eprintln!("achievements: change in {}", file.path.display());
            }
            let unique = dedupe_detected(parse_all(&changed));
            if unique.is_empty() {
                Ok(0)
            } else {
                self.merge(game, unique, true)
            }
        };
        if let Ok(mut state) = self.state.lock() {
            state.processing.remove(&key);
        }
        result
    }

    /// mergeAchievements: returns how many unlocks were new.
    fn merge(
        &self,
        game: &Game,
        achievements: Vec<StoredUnlock>,
        publish: bool,
    ) -> Result<usize, ApiError> {
        if game.shop == "epic" {
            return Ok(0);
        }
        let new_count;
        let refresh;
        {
            let _merge = self.merge.lock().unwrap_or_else(|e| e.into_inner());
            if self.memory.get(&game.shop, &game.object_id).is_none() {
                achievement_store::game_achievement_data(
                    &self.api,
                    &self.db,
                    self.memory,
                    &game.shop,
                    &game.object_id,
                    false,
                )?;
            }
            let entry = self
                .memory
                .get(&game.shop, &game.object_id)
                .unwrap_or_default();
            let (new, merged) = compute_merge(&entry.unlocked, &achievements);
            if publish && !new.is_empty() {
                let notice = build_notice(game, &new, &entry.definitions, entry.unlocked.len());
                if !notice.achievements.is_empty() {
                    eprintln!(
                        "achievements: publishing notification for {} {}",
                        game.object_id, game.title
                    );
                    self.events.unlocked(notice);
                }
            }
            let should_sync = game.remote_id.is_some() && self.has_finished_pre_search();
            self.memory
                .set_unlocked(&game.shop, &game.object_id, merged.clone());
            if should_sync
                && let (Some(context), Some(remote_id)) =
                    (self.api.auth_context(), game.remote_id.as_deref())
            {
                self.enqueue(
                    &context,
                    &game.key(),
                    remote_id,
                    &game.shop,
                    &game.object_id,
                    merged,
                );
            }
            new_count = new.len();
            refresh = publish;
        }
        if refresh {
            self.send_update(&game.shop, &game.object_id);
        }
        self.trigger_sync();
        Ok(new_count)
    }

    /// getUnlockedAchievements(useCachedData = true) sent to the pages.
    fn send_update(&self, shop: &str, object_id: &str) {
        if !self.events.wants_updates(shop, object_id) {
            return;
        }
        match achievements::unlocked_achievements_with(
            &self.api,
            &self.db,
            self.memory,
            shop,
            object_id,
            true,
        ) {
            Ok(list) => self.events.updated(shop, object_id, list),
            Err(error) => eprintln!("achievements: refresh {shop} {object_id}: {error}"),
        }
    }

    /// firstSyncWithRemoteIfNeeded: merge a game's files once (no notification
    /// per achievement; a combined one after the pre-search).
    pub fn first_sync_if_needed(&self, shop: &str, object_id: &str) -> Result<(), ApiError> {
        if shop == "custom" || shop == "epic" {
            return Ok(());
        }
        let key = keys::game(shop, object_id);
        {
            let Ok(mut state) = self.state.lock() else {
                return Ok(());
            };
            if !state.already_synced.insert(key.clone()) {
                return Ok(());
            }
        }
        let forget = || {
            if let Ok(mut state) = self.state.lock() {
                state.already_synced.remove(&key);
            }
        };
        let Some(game) = self.game(shop, object_id) else {
            return Ok(());
        };
        let files = self.files_of(&game, None, None);
        let unlocks = parse_all(&files);
        let new = match self.merge(&game, unlocks, false) {
            Ok(n) => n,
            Err(error) => {
                forget();
                return Err(error);
            }
        };
        if game.remote_id.is_none() {
            forget();
        }
        if new > 0 && self.has_finished_pre_search() {
            self.events.combined(1, new);
        }
        Ok(())
    }

    /// syncGameAchievementFiles (game launch, executable change, add to library).
    pub fn sync_game_files(&self, shop: &str, object_id: &str) -> Result<(), ApiError> {
        if let Ok(mut state) = self.state.lock() {
            state.already_synced.remove(&keys::game(shop, object_id));
        }
        self.first_sync_if_needed(shop, object_id)
    }

    /// syncAndGetUnlockedAchievements: the page's list after merging local files.
    pub fn sync_and_get(&self, shop: &str, object_id: &str) -> Result<Vec<Achievement>, ApiError> {
        if let Err(error) = self.first_sync_if_needed(shop, object_id) {
            eprintln!("achievements: first sync {shop} {object_id}: {error}");
        }
        achievements::unlocked_achievements_with(
            &self.api,
            &self.db,
            self.memory,
            shop,
            object_id,
            false,
        )
    }

    /// preProcessGameAchievementFiles: merge silently, then count what is new
    /// against the remote and the already reported counts.
    fn pre_process(&self, game: &Game, files: &[AchievementFile]) -> (usize, bool) {
        let mut unlocks = Vec::new();
        for file in files {
            let parsed = achievement_files::parse(&file.path, file.cracker);
            if let Ok(mut state) = self.state.lock() {
                state.files.record(&file.path);
            }
            if !parsed.is_empty() {
                eprintln!(
                    "achievements: file for {}: {} ({} unlocked)",
                    game.title,
                    file.path.display(),
                    parsed.len()
                );
            }
            unlocks.extend(
                parsed
                    .into_iter()
                    .map(|u| StoredUnlock::new(u.name, u.unlock_time)),
            );
        }
        if unlocks.is_empty() {
            return (0, false);
        }
        if let Err(error) = self.merge(game, unlocks, false) {
            eprintln!("achievements: pre-search {}: {error}", game.object_id);
        }
        let merged = self.memory.unlocked(&game.shop, &game.object_id).len() as i64;
        let already = game.unlocked_count.max(game.reported_count);
        self.persist_reported_count(game, merged);
        (
            (merged - already).max(0) as usize,
            merged > game.unlocked_count,
        )
    }

    fn persist_reported_count(&self, game: &Game, count: i64) {
        let key = game.key();
        let Some(mut current) = self.db.get_in::<Value>(keys::GAMES, &key) else {
            return;
        };
        if current
            .get("reportedUnlockedAchievementCount")
            .and_then(Value::as_f64)
            == Some(count as f64)
        {
            return;
        }
        current["reportedUnlockedAchievementCount"] = json!(count);
        if let Err(error) = self.db.put_in(keys::GAMES, &key, &current) {
            eprintln!(
                "achievements: failed to persist reported count for {}: {error}",
                game.object_id
            );
        }
    }

    /// preSearchAchievements: merge every game's files without notifications,
    /// upload what the API is missing, then one combined notification.
    pub fn pre_search(&self) {
        let games = self.games();
        let (static_files, nested_files) = self.shared_scans();
        let mut results = Vec::new();
        for game in &games {
            let files = self.files_of(game, static_files.as_ref(), nested_files.as_ref());
            results.push(self.pre_process(game, &files));
        }
        let games_with_new = results.iter().filter(|(new, _)| *new > 0).count();
        let total_new: usize = results.iter().map(|(new, _)| new).sum();
        self.pre_searched.store(true, Ordering::SeqCst);
        // uploadPreSearchAchievements
        for (game, (_, behind)) in games.iter().zip(&results) {
            if *behind
                && game.remote_id.is_some()
                && let Err(error) = self.merge(game, Vec::new(), false)
            {
                eprintln!(
                    "achievements: failed to upload achievements found on startup {} {}: {error}",
                    game.object_id, game.title
                );
            }
        }
        eprintln!(
            "achievements: pre-search done, {total_new} new in {games_with_new} games ({} games)",
            games.len()
        );
        if total_new > 0 {
            let events = self.events.clone();
            std::thread::spawn(move || {
                std::thread::sleep(PRE_SEARCH_NOTIFICATION_DELAY);
                events.combined(games_with_new, total_new);
            });
        }
    }

    // ---- sync worker ----------------------------------------------------

    /// achievementSyncWorker.trigger
    pub fn trigger_sync(&self) {
        if let Ok(mut sync) = self.sync.lock() {
            sync.woken = true;
            self.sync_wake.notify_all();
        }
    }

    fn is_current(&self, context: &AuthContext) -> bool {
        self.api.auth_context().as_ref() == Some(context)
    }

    fn synced_fingerprint(&self, key: &str, previous: Option<&Value>) -> Option<String> {
        let sync = self.sync.lock().ok()?;
        match previous {
            None => sync.acknowledged.get(key).cloned(),
            Some(record) if is_terminal(record) && !sync.dispatched_at.contains_key(key) => None,
            Some(record) => Some(fingerprint(&text(record, "remoteId"), &unlocks_of(record))),
        }
    }

    /// achievementSyncWorker.enqueue
    fn enqueue(
        &self,
        context: &AuthContext,
        game_key: &str,
        remote_id: &str,
        shop: &str,
        object_id: &str,
        achievements: Vec<StoredUnlock>,
    ) {
        if self.config.sync_disabled {
            eprintln!(
                "achievements: dev, not uploading {} unlocks for {game_key}",
                achievements.len()
            );
            return;
        }
        if !self.is_current(context) {
            return;
        }
        let key = pending_key(context, game_key);
        let previous: Option<Value> = self.db.get_in(PENDING_SYNC, &key);
        let retry = previous.as_ref().filter(|p| !is_terminal(p));
        let achievements = merge_unlocked_lists(
            &achievements,
            &previous.as_ref().map(unlocks_of).unwrap_or_default(),
        );
        if self.synced_fingerprint(&key, previous.as_ref())
            == Some(fingerprint(remote_id, &achievements))
        {
            return;
        }
        let dispatched = self
            .sync
            .lock()
            .ok()
            .and_then(|s| s.dispatched_at.get(&key).copied())
            .unwrap_or(0);
        let record = json!({
            "context": { "environment": context.environment, "userId": context.user_id, "generation": 0 },
            "gameKey": game_key,
            "remoteId": remote_id,
            "shop": shop,
            "objectId": object_id,
            "achievements": achievements.iter().map(StoredUnlock::to_json).collect::<Vec<_>>(),
            "revision": revision(),
            "attempts": retry.map_or(0, |r| int(r, "attempts")),
            "serverErrors": retry.map_or(0, |r| int(r, "serverErrors")),
            "nextAttemptAt": retry
                .map_or(0, |r| int(r, "nextAttemptAt"))
                .max(dispatched + SYNC_COALESCE_WINDOW_MS),
        });
        if let Err(error) = self.db.put_in(PENDING_SYNC, &key, &record) {
            eprintln!("achievements: failed to queue the sync for {game_key}: {error}");
        }
    }

    /// The pending records of this account, in key order.
    fn records(&self, context: &AuthContext) -> Vec<(String, Value)> {
        self.db
            .entries::<Value>(PENDING_SYNC)
            .unwrap_or_default()
            .into_iter()
            .filter(|(_, r)| {
                r.get("context").is_some_and(|c| {
                    text(c, "environment") == context.environment
                        && text(c, "userId") == context.user_id
                })
            })
            .collect()
    }

    fn sync_loop(&self) {
        loop {
            self.sync_run();
            let wait = self.next_sync_wait();
            let Ok(mut sync) = self.sync.lock() else {
                return;
            };
            if !sync.woken {
                sync = match wait {
                    Some(wait) => match self.sync_wake.wait_timeout(sync, wait) {
                        Ok((guard, _)) => guard,
                        Err(_) => return,
                    },
                    None => match self.sync_wake.wait(sync) {
                        Ok(guard) => guard,
                        Err(_) => return,
                    },
                };
            }
            sync.woken = false;
        }
    }

    /// schedule(): until the earliest retry, at least 1s.
    fn next_sync_wait(&self) -> Option<Duration> {
        let context = self.api.auth_context()?;
        let at = self
            .records(&context)
            .iter()
            .filter(|(_, r)| !is_terminal(r))
            .map(|(_, r)| int(r, "nextAttemptAt"))
            .min()?;
        Some(Duration::from_millis(
            (at - now_ms()).max(SYNC_RETRY_DELAY_MS) as u64,
        ))
    }

    /// run(): send due records one at a time.
    fn sync_run(&self) {
        while let Some(context) = self.api.auth_context() {
            let now = now_ms();
            let Some((key, item)) = self
                .records(&context)
                .into_iter()
                .find(|(_, r)| !is_terminal(r) && int(r, "nextAttemptAt") <= now)
            else {
                return;
            };
            if !self.synchronize(&context, &key, &item) {
                return;
            }
        }
    }

    fn synchronize(&self, context: &AuthContext, key: &str, item: &Value) -> bool {
        let latest: Option<Value> = self.db.get_in(PENDING_SYNC, key);
        if !self.is_current(context)
            || latest.as_ref().map(|l| text(l, "revision")) != Some(text(item, "revision"))
        {
            return false;
        }
        if let Ok(mut sync) = self.sync.lock() {
            sync.dispatched_at.insert(key.to_string(), now_ms());
        }
        let remote_id = text(item, "remoteId");
        let achievements = unlocks_of(item);
        let result = self.api.put(
            "/profile/games/achievements",
            &sync_payload(&remote_id, &achievements),
            Options {
                needs_auth: true,
                timeout: Some(SYNC_REQUEST_TIMEOUT),
            },
        );
        match result {
            Ok(response) => {
                let response = response.is_object().then_some(response);
                let reconciled = {
                    let _merge = self.merge.lock().unwrap_or_else(|e| e.into_inner());
                    let reconciled = response.as_ref().and_then(|r| self.reconcile(r));
                    if !self.is_current(context) {
                        return false;
                    }
                    let acknowledged = match &response {
                        Some(r) => merge_unlocked_lists(&unlocks_of(r), &achievements),
                        None => achievements.clone(),
                    };
                    if let Ok(mut sync) = self.sync.lock() {
                        sync.acknowledged
                            .insert(key.to_string(), fingerprint(&remote_id, &acknowledged));
                    }
                    let latest: Option<Value> = self.db.get_in(PENDING_SYNC, key);
                    match latest {
                        Some(latest) if text(&latest, "revision") == text(item, "revision") => {
                            let _ = self.db.delete_in(PENDING_SYNC, key);
                        }
                        Some(mut latest) if !is_terminal(&latest) => {
                            latest["attempts"] = json!(0);
                            latest["serverErrors"] = json!(0);
                            let _ = self.db.put_in(PENDING_SYNC, key, &latest);
                        }
                        _ => {}
                    }
                    reconciled
                };
                eprintln!(
                    "achievements: synced {} unlocks for {}",
                    achievements.len(),
                    text(item, "gameKey")
                );
                if let Some((shop, object_id)) = reconciled {
                    self.send_update(&shop, &object_id);
                }
                true
            }
            Err(error) => {
                if !self.is_current(context) {
                    return false;
                }
                self.retain_for_retry(key, item, &error);
                true
            }
        }
    }

    /// reconcileAchievementMemory: the API's list merged into memory.
    fn reconcile(&self, response: &Value) -> Option<(String, String)> {
        let shop = text(response, "shop");
        let object_id = text(response, "objectId");
        if shop.is_empty() || object_id.is_empty() {
            return None;
        }
        let stored = self.memory.get(&shop, &object_id).unwrap_or_default();
        let unlocked = merge_unlocked_lists(&unlocks_of(response), &stored.unlocked);
        self.memory.set(
            &shop,
            &object_id,
            achievement_store::Entry { unlocked, ..stored },
        );
        Some((shop, object_id))
    }

    /// retainForRetry: back off; park after repeated 5xx or a rejection.
    fn retain_for_retry(&self, key: &str, item: &Value, error: &ApiError) {
        let _merge = self.merge.lock().unwrap_or_else(|e| e.into_inner());
        let Some(mut latest) = self.db.get_in::<Value>(PENDING_SYNC, key) else {
            return;
        };
        let attempts = int(&latest, "attempts").max(int(item, "attempts"));
        let status = match error {
            ApiError::Status { status, .. } => Some(*status),
            _ => None,
        };
        let rejected = status.is_some_and(|s| !is_retryable(s));
        let server_errors =
            int(&latest, "serverErrors") + i64::from(status.is_some_and(|s| s >= 500));
        let same = text(&latest, "revision") == text(item, "revision");
        let parked = same && server_errors >= SYNC_MAX_SERVER_ERRORS;
        let next =
            int(&latest, "nextAttemptAt").max(now_ms() + retry_delay(attempts, random_below));
        latest["terminal"] = json!(parked || (same && rejected));
        latest["serverErrors"] = json!(server_errors);
        latest["attempts"] = json!(attempts + 1);
        latest["nextAttemptAt"] = json!(next);
        let _ = self.db.put_in(PENDING_SYNC, key, &latest);
        eprintln!(
            "achievements: {} {}: {error}",
            if parked {
                "sync parked after repeated server errors"
            } else {
                "sync retained for retry"
            },
            text(item, "gameKey")
        );
    }
}

/// randomUUID: 128 random-ish bits, formatted like a v4 UUID.
fn revision() -> String {
    let a = random_below(i64::MAX) as u64;
    std::thread::sleep(Duration::from_nanos(1));
    let b = random_below(i64::MAX) as u64 ^ (now_ms() as u64).rotate_left(17);
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (a >> 32) as u32,
        (a >> 16) as u16,
        (a & 0xfff) as u16,
        ((b >> 48) as u16 & 0x3fff) | 0x8000,
        b & 0xffff_ffff_ffff
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unlocks(list: &[(&str, i64)]) -> Vec<StoredUnlock> {
        list.iter()
            .map(|(n, t)| StoredUnlock::new(*n, *t))
            .collect()
    }

    #[test]
    fn merge_dedupes_by_uppercase_name_first_wins() {
        let existing = unlocks(&[("A", 1)]);
        let incoming = unlocks(&[("b", 5), ("a", 9), ("B", 7), ("c", 3)]);
        let (new, merged) = compute_merge(&existing, &incoming);
        let names: Vec<_> = new
            .iter()
            .map(|u| (u.name.as_str(), u.unlock_time))
            .collect();
        // Map over the reversed list: the order follows the last occurrence, the value the first
        assert_eq!(names, [("C", 3), ("B", 5)]);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].name, "A");
    }

    #[test]
    fn detected_dedupe_keeps_the_last_per_lowercase_name() {
        let list = dedupe_detected(unlocks(&[("A", 1), ("b", 2), ("a", 3)]));
        let names: Vec<_> = list
            .iter()
            .map(|u| (u.name.as_str(), u.unlock_time))
            .collect();
        assert_eq!(names, [("a", 3), ("b", 2)]);
    }

    #[test]
    fn notice_sorts_and_marks_platinum() {
        let definitions = vec![
            json!({ "name": "A", "displayName": "First", "icon": "a.png", "hidden": false, "points": 10 }),
            json!({ "name": "B", "displayName": "Second", "icon": "b.png", "hidden": true, "points": 2500, "description": "d" }),
        ];
        let game = Game {
            shop: "steam".into(),
            object_id: "1".into(),
            title: "Game".into(),
            icon_url: None,
            remote_id: None,
            executable: None,
            wine_prefix: None,
            unlocked_count: 0,
            reported_count: 0,
        };
        let new = unlocks(&[("B", 20), ("A", 10), ("UNKNOWN", 5)]);
        let notice = build_notice(&game, &new, &definitions, 0);
        // the unknown name is dropped; 3 new + 0 != 2 definitions, so no platinum
        assert_eq!(notice.achievements.len(), 2);
        assert_eq!(notice.achievements[0].title, "First");
        assert!(!notice.achievements[1].platinum);
        assert!(notice.achievements[1].rare);
        assert!(notice.achievements[1].hidden);
        let notice = build_notice(&game, &unlocks(&[("B", 20)]), &definitions, 1);
        assert!(notice.achievements[0].platinum);
        assert_eq!((notice.unlocked_count, notice.total_count), (2, 2));
    }

    #[test]
    fn rarity_threshold() {
        assert!(!is_rare(2025));
        assert!(is_rare(2026));
        assert!(!is_rare(10));
    }

    #[test]
    fn fingerprint_ignores_order_and_case() {
        let a = fingerprint("r", &unlocks(&[("b", 2), ("A", 1)]));
        let b = fingerprint("r", &unlocks(&[("a", 1), ("B", 2)]));
        assert_eq!(a, b);
        assert_ne!(a, fingerprint("r", &unlocks(&[("a", 1)])));
        let hardcore = StoredUnlock {
            name: "x".into(),
            unlock_time: 1,
            hardcore_unlock_time: Some(5),
        };
        assert_eq!(
            sync_payload("id", &[hardcore]),
            json!({ "id": "id", "achievements": [{ "name": "x", "unlockTime": 5, "hardcore": true }] })
        );
    }

    #[test]
    fn retry_policy() {
        assert!(is_retryable(500));
        assert!(is_retryable(429));
        assert!(!is_retryable(400));
        assert_eq!(retry_delay(0, |_| 0), 1_000);
        assert_eq!(retry_delay(3, |_| 0), 8_000);
        assert_eq!(retry_delay(10, |_| 0), 60_000);
        // jitter is drawn below backoff/4 + 1
        assert_eq!(retry_delay(2, |max| max - 1), 4_000 + 1_000);
    }

    #[test]
    fn file_changes_by_mtime_and_flt_entries() {
        let dir = std::env::temp_dir().join("hydra-watcher-file-state");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("flt")).unwrap();
        let path = dir.join("achievements.ini");
        std::fs::write(&path, "[A]\nAchieved=1\n").unwrap();
        let file = AchievementFile {
            cracker: Cracker::Codex,
            path: path.clone(),
        };
        let mut state = FileState::default();
        // the first sighting during the watch counts as a change
        assert!(state.changed(&file));
        assert!(!state.changed(&file));
        // recorded by the pre-search: unchanged until the mtime moves
        let mut recorded = FileState::default();
        recorded.record(&path);
        assert!(!recorded.changed(&file));
        let later = SystemTime::now() + Duration::from_secs(5);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(later)
            .unwrap();
        assert!(recorded.changed(&file));
        // a missing file is not a change
        let missing = AchievementFile {
            cracker: Cracker::Codex,
            path: dir.join("missing.ini"),
        };
        assert!(!state.changed(&missing));
        // FLT: the first look records, new entries are a change
        let flt = AchievementFile {
            cracker: Cracker::Flt,
            path: dir.join("flt"),
        };
        assert!(!state.changed(&flt));
        std::fs::write(dir.join("flt").join("ACH_1"), "").unwrap();
        assert!(state.changed(&flt));
        assert!(!state.changed(&flt));
    }

    #[derive(Default)]
    struct Recorder {
        unlocked: Mutex<Vec<UnlockNotice>>,
        combined: Mutex<Vec<(usize, usize)>>,
    }

    impl Events for Recorder {
        fn unlocked(&self, notice: UnlockNotice) {
            self.unlocked.lock().unwrap().push(notice);
        }
        fn combined(&self, games: usize, achievements: usize) {
            self.combined.lock().unwrap().push((games, achievements));
        }
        fn updated(&self, _: &str, _: &str, _: Vec<Achievement>) {}
        fn wants_updates(&self, _: &str, _: &str) -> bool {
            false
        }
    }

    /// Pre-search merges silently, the watch notifies only what is new, and a
    /// signed-out run never queues an upload. All offline: the definitions are
    /// in memory already and the folders are a temp Wine-style tree.
    #[test]
    fn pre_search_then_watch_notifies_new_unlocks() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let root = std::env::temp_dir().join("hydra-watcher-e2e");
        let _ = std::fs::remove_dir_all(&root);
        let db = Arc::new(Db::open(root.join("db")).unwrap());
        db.put_in(
            keys::GAMES,
            "steam:440",
            &json!({ "shop": "steam", "objectId": "440", "title": "TF2", "remoteId": "r1", "unlockedAchievementCount": 0 }),
        )
        .unwrap();
        db.put_in(
            keys::GAMES,
            "steam:441",
            &json!({ "shop": "steam", "objectId": "441", "title": "Gone", "isDeleted": true }),
        )
        .unwrap();
        let folders = Folders::wine(&root.join("prefix"), "user");
        let save = folders.app_data.join("GSE Saves").join("440");
        std::fs::create_dir_all(&save).unwrap();
        let file = save.join("achievements.json");
        std::fs::write(&file, r#"{"A":{"earned":true,"earned_time":100}}"#).unwrap();

        let memory: &'static Memory = Box::leak(Box::default());
        memory.set(
            "steam",
            "440",
            achievement_store::Entry {
                definitions: vec![
                    json!({ "name": "A", "displayName": "Alpha", "icon": "a" }),
                    json!({ "name": "B", "displayName": "Beta", "icon": "b" }),
                ],
                language: Some("en".into()),
                ..Default::default()
            },
        );
        let api = Arc::new(HydraApi::new(db.clone(), reqwest::blocking::Client::new()));
        let events = Arc::new(Recorder::default());
        let watcher = Watcher::with_memory(
            api,
            db.clone(),
            Config {
                layout: Layout::Windows(folders),
                steam: SteamInstall::default(),
                sync_disabled: false,
            },
            events.clone(),
            memory,
        );
        watcher.pre_search();
        assert!(watcher.has_finished_pre_search());
        assert!(events.unlocked.lock().unwrap().is_empty());
        assert_eq!(memory.unlocked("steam", "440").len(), 1);
        let game: Value = db.get_in(keys::GAMES, "steam:440").unwrap();
        assert_eq!(game["reportedUnlockedAchievementCount"], json!(1));

        // nothing changed: nothing happens
        watcher.watch();
        assert!(events.unlocked.lock().unwrap().is_empty());

        std::fs::write(
            &file,
            r#"{"A":{"earned":true,"earned_time":100},"B":{"earned":true,"earned_time":200}}"#,
        )
        .unwrap();
        std::fs::File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(SystemTime::now() + Duration::from_secs(10))
            .unwrap();
        watcher.watch();
        let notices = events.unlocked.lock().unwrap().clone();
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].achievements.len(), 1);
        assert_eq!(notices[0].achievements[0].title, "Beta");
        assert!(notices[0].achievements[0].platinum);
        assert_eq!((notices[0].unlocked_count, notices[0].total_count), (2, 2));
        // signed out: nothing queued for upload
        assert!(db.entries::<Value>(PENDING_SYNC).unwrap().is_empty());
        // a page's first sync finds nothing new
        watcher.first_sync_if_needed("steam", "440").unwrap();
        assert!(events.combined.lock().unwrap().is_empty());
    }

    #[test]
    fn revisions_look_like_uuids() {
        let r = revision();
        assert_eq!(r.len(), 36);
        assert_eq!(&r[14..15], "4");
    }
}
