//! services/process-watcher.ts + game-running-state.ts: every 2 seconds,
//! match library games' executables against the running processes; count
//! playtime while they run, save it locally every tick and send it to the
//! API every 3 minutes and when the game closes.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use hydra_core::api::{HydraApi, Options};
use hydra_core::library_actions;
use hydra_db::{Db, keys};
use serde_json::{Map, Value, json};

use crate::processes;

/// INTERVALS.processWatcher
pub const INTERVAL_MS: u64 = 2_000;
/// TICKS_TO_UPDATE_API: 3 minutes
const TICKS_TO_UPDATE_API: u64 = 3 * 60 * 1000 / INTERVAL_MS;

/// GamePlaytimeState
#[derive(Clone, Copy, Debug)]
struct Session {
    first_tick: Instant,
    last_tick: Instant,
    last_sync_tick: Instant,
    count_hydra_playtime: bool,
}

/// on-games-running entries
#[derive(Clone, Debug, PartialEq)]
pub struct Running {
    pub id: String,
    pub session_millis: u64,
}

static LAUNCHED_PIDS: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);

/// launchedGamePids
pub fn remember_launched_pid(key: &str, pid: u32) {
    LAUNCHED_PIDS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_with(HashMap::new)
        .insert(key.to_string(), pid);
}

fn forget_launched_pid(key: &str) {
    if let Some(map) = LAUNCHED_PIDS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_mut()
    {
        map.remove(key);
    }
}

pub struct Watcher {
    db: Arc<Db>,
    api: Option<Arc<HydraApi>>,
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    tick: Mutex<u64>,
    /// Called after each tick with the running games (on-games-running).
    listener: Box<dyn Fn(Vec<Running>) + Send + Sync>,
}

fn str_field<'a>(game: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    game.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

fn now_iso() -> String {
    library_actions::now_iso()
}

impl Watcher {
    pub fn new(
        db: Arc<Db>,
        api: Option<Arc<HydraApi>>,
        listener: Box<dyn Fn(Vec<Running>) + Send + Sync>,
    ) -> Arc<Watcher> {
        Arc::new(Watcher {
            db,
            api,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            tick: Mutex::new(1),
            listener,
        })
    }

    pub fn spawn(self: &Arc<Self>) {
        let this = self.clone();
        std::thread::Builder::new()
            .name("process-watcher".into())
            .spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(INTERVAL_MS));
                    this.watch();
                }
            })
            .expect("process watcher");
    }

    /// getGamesRunning
    pub fn running(&self) -> Vec<Running> {
        let now = Instant::now();
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .map(|(id, s)| Running {
                id: id.clone(),
                session_millis: now.duration_since(s.first_tick).as_millis() as u64,
            })
            .collect()
    }

    pub fn is_running(&self, key: &str) -> bool {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(key)
    }

    /// watchProcesses
    pub fn watch(&self) {
        let games: Vec<(String, Map<String, Value>)> = self
            .db
            .entries::<Value>(keys::GAMES)
            .unwrap_or_default()
            .into_iter()
            .filter_map(|(key, value)| match value {
                Value::Object(map) => Some((key, map)),
                _ => None,
            })
            .filter(|(key, game)| {
                game.get("isDeleted").and_then(Value::as_bool) == Some(false)
                    || self
                        .sessions
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .contains_key(key)
            })
            .collect();
        if games.is_empty() {
            return;
        }
        if let Some(api) = &self.api {
            // GameExecutables.ensureLoaded (retries every 30s after a failure)
            hydra_core::executables::ensure_loaded(api, false);
        }
        let list = processes::list();
        let map = processes::process_map(&list);
        for (key, game) in games {
            let Some(executable) = str_field(&game, "executablePath") else {
                if let Some(object_id) = str_field(&game, "objectId") {
                    self.find_game_path_by_process(&map, object_id);
                }
                continue;
            };
            let tracking: Vec<String> = game
                .get("trackingExecutablePaths")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().filter(|s| !s.is_empty()).map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let lower = executable.to_lowercase();
            let is_batch = lower.ends_with(".bat") || lower.ends_with(".cmd");
            let candidates: Vec<String> = if is_batch {
                if tracking.is_empty() {
                    vec![executable.to_string()]
                } else {
                    tracking
                }
            } else {
                std::iter::once(executable.to_string())
                    .chain(tracking)
                    .collect()
            };
            let separator = if cfg!(windows) { '\\' } else { '/' };
            let matched = candidates.iter().find(|path| {
                let name = path.rsplit(separator).next().unwrap_or(path).to_lowercase();
                map.get(&name)
                    .is_some_and(|paths| paths.iter().any(|p| crate::same_path(p, path)))
            });
            // TODO(launch): Linux native/AppImage/Wine matches, launched pid matches, Epic.
            let tracked = self
                .sessions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .contains_key(&key);
            match (matched, tracked) {
                (Some(_), true) => self.on_tick(&key, &game),
                (Some(path), false) => self.on_open(&key, &game, path),
                (None, true) => self.on_close(&key, &game),
                (None, false) => {}
            }
        }
        *self.tick.lock().unwrap_or_else(|e| e.into_inner()) += 1;
        (self.listener)(self.running());
    }

    /// findGamePathByProcess: a Steam game without an executable gets the
    /// path of a running process that matches its catalogue entry.
    fn find_game_path_by_process(
        &self,
        map: &HashMap<String, std::collections::HashSet<String>>,
        object_id: &str,
    ) {
        let Some(executables) = hydra_core::executables::for_game(object_id) else {
            return;
        };
        let key = format!("steam:{object_id}");
        for executable in executables {
            let lower = executable.exe.to_lowercase();
            let without_extension = lower.strip_suffix(".exe").unwrap_or(&lower).to_string();
            let Some(paths) = map
                .get(&executable.exe)
                .or_else(|| map.get(&without_extension))
            else {
                continue;
            };
            for path in paths {
                let lowered = path.to_lowercase();
                if !(lowered.ends_with(&executable.name) || lowered.ends_with(&without_extension)) {
                    continue;
                }
                // TODO(launch): winePrefixPath from STEAM_COMPAT_DATA_PATH on Linux.
                let updated = library_actions::update_game_record(&self.db, &key, |game| {
                    if game.get("executablePath").and_then(Value::as_str) != Some(path.as_str()) {
                        game.insert("executablePath".into(), json!(path));
                        game.insert("executablePathUpdatedAt".into(), json!(now_iso()));
                    }
                });
                if matches!(updated, Ok(Some(_))) {
                    eprintln!("Set game path {key} {path}");
                }
            }
        }
    }

    fn on_open(&self, key: &str, game: &Map<String, Value>, matched: &str) {
        let now = Instant::now();
        // TODO(launch): Steam import / Epic playtime policies (countHydraPlaytime).
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(
                key.to_string(),
                Session {
                    first_tick: now,
                    last_tick: now,
                    last_sync_tick: now,
                    count_hydra_playtime: true,
                },
            );
        eprintln!("[ProcessWatcher] {key} opened ({matched})");
        // TODO(launch): close the launcher window, hideToTrayOnGameStart, achievements, screenshots, cloud saves.
        if str_field(game, "shop") == Some("custom") {
            return;
        }
        let (db, api, key, game) = (
            self.db.clone(),
            self.api.clone(),
            key.to_string(),
            game.clone(),
        );
        std::thread::spawn(move || {
            let Some(api) = api else { return };
            if game.get("remoteId").is_some_and(|v| !v.is_null()) {
                let delta = game
                    .get("unsyncedDeltaPlayTimeInMilliseconds")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                if track_playtime(&db, &api, &game, delta, &now_iso()).is_ok() {
                    persist(&db, &key, |g| {
                        g.insert("unsyncedDeltaPlayTimeInMilliseconds".into(), json!(0));
                    });
                }
            } else {
                let mut payload = game.clone();
                payload.insert("lastTimePlayed".into(), json!(now_iso()));
                let _ = library_actions::create_game(&db, &api, &payload);
            }
        });
    }

    /// The deltas since the last tick and the last API sync.
    fn deltas(&self, key: &str, now: Instant, pending: f64) -> Option<(f64, f64, Session)> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let s = *sessions.get(key)?;
        let local = if s.count_hydra_playtime {
            now.duration_since(s.last_tick).as_millis() as f64
        } else {
            0.0
        };
        let sync = if s.count_hydra_playtime {
            now.duration_since(s.last_sync_tick).as_millis() as f64
        } else {
            0.0
        } + pending;
        Some((local, sync, s))
    }

    fn on_tick(&self, key: &str, game: &Map<String, Value>) {
        let now = Instant::now();
        let pending = game
            .get("unsyncedDeltaPlayTimeInMilliseconds")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let Some((delta, delta_to_sync, session)) = self.deltas(key, now, pending) else {
            return;
        };
        let last_played = now_iso();
        persist(&self.db, key, |g| {
            let current = g
                .get("playTimeInMilliseconds")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            g.insert("playTimeInMilliseconds".into(), json!(current + delta));
            g.insert("lastTimePlayed".into(), json!(last_played));
        });
        if let Some(s) = self
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_mut(key)
        {
            s.last_tick = now;
        }
        let tick = *self.tick.lock().unwrap_or_else(|e| e.into_inner());
        if tick % TICKS_TO_UPDATE_API != 0 || str_field(game, "shop") == Some("custom") {
            return;
        }
        let (db, api, key, game) = (
            self.db.clone(),
            self.api.clone(),
            key.to_string(),
            game.clone(),
        );
        let first_tick = session.first_tick;
        let sessions = self.sessions.clone();
        std::thread::spawn(move || {
            let Some(api) = api else { return };
            let ok = if game.get("remoteId").is_some_and(|v| !v.is_null()) {
                let last = str_field(&game, "lastTimePlayed")
                    .map(str::to_string)
                    .unwrap_or_else(now_iso);
                track_playtime(&db, &api, &game, delta_to_sync, &last).is_ok()
            } else {
                library_actions::create_game(&db, &api, &game).is_ok()
            };
            persist(&db, &key, |g| {
                g.insert(
                    "unsyncedDeltaPlayTimeInMilliseconds".into(),
                    json!(if ok { 0.0 } else { delta_to_sync }),
                );
            });
            if let Some(s) = sessions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get_mut(&key)
                && s.first_tick == first_tick
            {
                s.last_sync_tick = now;
            }
        });
    }

    fn on_close(&self, key: &str, game: &Map<String, Value>) {
        let now = Instant::now();
        let pending = game
            .get("unsyncedDeltaPlayTimeInMilliseconds")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let Some((delta, delta_to_sync, _)) = self.deltas(key, now, pending) else {
            return;
        };
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(key);
        forget_launched_pid(key);
        eprintln!("[ProcessWatcher] {key} closed (+{:.0}s)", delta / 1000.0);
        let last_played = now_iso();
        persist(&self.db, key, |g| {
            let current = g
                .get("playTimeInMilliseconds")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            g.insert("playTimeInMilliseconds".into(), json!(current + delta));
            g.insert("lastTimePlayed".into(), json!(last_played));
        });
        if str_field(game, "shop") == Some("custom") {
            return;
        }
        // TODO(launch): cloud save on close, Steam/Epic exit syncs, screenshots.
        let (db, api, key, game) = (
            self.db.clone(),
            self.api.clone(),
            key.to_string(),
            game.clone(),
        );
        std::thread::spawn(move || {
            let Some(api) = api else { return };
            if game.get("remoteId").is_some_and(|v| !v.is_null()) {
                let ok = track_playtime(&db, &api, &game, delta_to_sync, &last_played).is_ok();
                persist(&db, &key, |g| {
                    g.insert(
                        "unsyncedDeltaPlayTimeInMilliseconds".into(),
                        json!(if ok { 0.0 } else { delta_to_sync }),
                    );
                });
            } else {
                let _ = library_actions::create_game(&db, &api, &game);
            }
        });
    }
}

/// persistGamePlaytime
fn persist(db: &Db, key: &str, update: impl FnOnce(&mut Map<String, Value>)) {
    let _ = library_actions::update_game_record(db, key, update);
}

/// trackGamePlaytime: PUT /profile/games/{shop}/{objectId}
fn track_playtime(
    db: &Db,
    api: &HydraApi,
    game: &Map<String, Value>,
    delta_millis: f64,
    last_time_played: &str,
) -> Result<(), String> {
    let shop = str_field(game, "shop").unwrap_or_default();
    let object_id = str_field(game, "objectId").unwrap_or_default();
    if shop == "custom" {
        return Ok(());
    }
    let key = format!("{shop}:{object_id}");
    if delta_millis >= 1000.0 {
        persist(db, &key, |g| {
            g.insert("source".into(), json!("hydra"));
        });
    }
    let encoded: String = object_id
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect();
    api.put(
        &format!("/profile/games/{shop}/{encoded}"),
        &json!({ "playTimeDeltaInSeconds": (delta_millis / 1000.0).trunc() as i64, "lastTimePlayed": last_time_played }),
        Options::default(),
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}
