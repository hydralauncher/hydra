//! steamSyncOrchestrator (services/steam-integration/steam-sync-orchestrator.ts)
//! in the app: the sync state the Steam card shows, start/cancel, the
//! persisted run id, the startup sync (steam-startup-sync.ts) and the game
//! page sync (sync-steam-game-on-game-page.ts). The run itself is
//! `hydra_core::steam_sync_run::run` on a worker thread; this module gives
//! it the Hydra API, the `persist:steam` browser profile
//! ([`crate::steam_browser`]) and the local library.
//!
//! `HYDRA_STEAM_SYNC_DRY_RUN=1` prints every Hydra write (the run, the
//! snapshot chunks, the commit, the game PUTs) instead of sending it; reads
//! still go to the API and to Steam.

use std::cell::RefCell;
use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use hydra_core::api::{HydraApi, Options};
use hydra_core::integrations::SteamSync;
use hydra_core::steam_sync::{self as steam, SteamError, SteamToken};
use hydra_core::steam_sync_run::{
    self as run, CommunityPage, CommunitySession, Finished, HydraCalls, RunHooks, SteamAccess,
};
use hydra_db::{Db, keys};
use serde_json::{Value, json};

/// SteamSyncOrigin
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origin {
    Manual,
    Startup,
}

thread_local! {
    static STATE: RefCell<SteamSync> = RefCell::new(SteamSync::default());
    static STARTUP_ATTEMPTED: RefCell<bool> = const { RefCell::new(false) };
    /// The running sync's AbortController.
    static ABORT: RefCell<Option<Arc<AtomicBool>>> = const { RefCell::new(None) };
    /// syncSteamGameOnGamePage's in-flight games.
    static PAGE_SYNCS: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
}

fn dry_run() -> bool {
    std::env::var_os("HYDRA_STEAM_SYNC_DRY_RUN").is_some_and(|v| !v.is_empty() && v != "0")
}

pub fn state() -> SteamSync {
    STATE.with(|s| s.borrow().clone())
}

/// setState + on-steam-sync-progress
fn set_state(next: SteamSync) {
    STATE.with(|s| *s.borrow_mut() = next.clone());
    crate::settings_integrations::on_steam_sync_progress(&next);
}

/// A state from the worker. The achievements loop only updates a running
/// sync (`this.state.status === "running"`).
fn apply_state(next: SteamSync, only_if_running: bool) {
    if only_if_running && !matches!(state(), SteamSync::Running { .. }) {
        return;
    }
    set_state(next);
}

/// clearReconnectRequired (after a new OpenID sign-in)
pub fn clear_reconnect_required() {
    if state().requires_reconnect() {
        set_state(SteamSync::default());
    }
}

/// reconcilePersistedRun: a run that is no longer PENDING on the server
/// can't be resumed, so forget its id.
pub fn reconcile_persisted_run(latest_sync_run_status: Option<&str>) {
    if latest_sync_run_status == Some("PENDING") {
        return;
    }
    if let Some(db) = crate::shell::db() {
        let _ = db.delete(keys::STEAM_SYNC_RUN);
    }
}

/// The Hydra API as the run uses it; a dry run prints the writes.
struct Hydra {
    api: Arc<HydraApi>,
    dry_run: bool,
}

impl Hydra {
    fn print(method: &str, path: &str, body: &Value) {
        let games = body.get("games").and_then(Value::as_array);
        let summary = match games {
            Some(games) => format!(
                " ({} games, {} achievements)",
                games.len(),
                games
                    .iter()
                    .map(|g| g
                        .get("achievements")
                        .and_then(Value::as_array)
                        .map_or(0, Vec::len))
                    .sum::<usize>()
            ),
            None => String::new(),
        };
        let text = body.to_string();
        let shown: String = text.chars().take(600).collect();
        eprintln!(
            "[steam-sync] dry run: {method} {path}{summary} {shown}{}",
            if text.len() > shown.len() { "…" } else { "" }
        );
    }
}

impl HydraCalls for Hydra {
    fn get(&self, path: &str) -> Result<Value, SteamError> {
        self.api
            .get(path, &[], Options::default())
            .map_err(SteamError::from)
    }
    fn post(&self, path: &str, body: &Value) -> Result<Value, SteamError> {
        if self.dry_run {
            Self::print("POST", path, body);
            return Ok(if path.ends_with("/sync") {
                json!({ "syncRunId": "dry-run" })
            } else {
                Value::Null
            });
        }
        self.api
            .post(path, body, Options::default())
            .map_err(SteamError::from)
    }
    fn put(&self, path: &str, body: &Value) -> Result<Value, SteamError> {
        if self.dry_run {
            Self::print("PUT", path, body);
            return Ok(Value::Null);
        }
        self.api
            .put(path, body, Options::default())
            .map_err(SteamError::from)
    }
    fn delete(&self, path: &str) -> Result<Value, SteamError> {
        if self.dry_run {
            Self::print("DELETE", path, &Value::Null);
            return Ok(Value::Null);
        }
        self.api
            .delete(path, Options::default())
            .map_err(SteamError::from)
    }
}

/// Steam through the `persist:steam` profile and two HTTP clients: the
/// Web API one (`fetch`) and the Community one with the session cookies
/// (createSteamCommunityCookieFetch: IPv4, 5 redirects, Chrome's agent).
struct Steam {
    aborted: Arc<AtomicBool>,
}

fn web_api_client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .unwrap_or_default()
    })
}

fn community_client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(
                steam::STORE_MAX_REDIRECTS,
            ))
            .local_address(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
            .user_agent(crate::steam_openid::STEAM_USER_AGENT)
            .timeout(Duration::from_secs(60))
            .build()
            .unwrap_or_default()
    })
}

impl SteamAccess for Steam {
    fn web_api_token(&self) -> Result<SteamToken, SteamError> {
        let aborted = || self.aborted.load(Ordering::SeqCst);
        let page = crate::steam_browser::read_page(
            steam::STORE_EXPLORE_URL,
            steam::STORE_CONFIG_SCRIPT,
            &[],
            &aborted,
        )
        .map_err(SteamError::Other)?;
        if aborted() {
            return Err(SteamError::Aborted);
        }
        if !page.loaded {
            return Err(SteamError::Other(
                "the Steam store page did not load".into(),
            ));
        }
        let field = |key: &str| page.value.get(key).and_then(Value::as_str);
        steam::parse_store_session_config(field("userInfoRaw"), field("storeConfigRaw"), &page.url)
    }

    fn community_session(&self) -> Result<CommunitySession, SteamError> {
        let aborted = || self.aborted.load(Ordering::SeqCst);
        let community = "https://steamcommunity.com/";
        let store = "https://store.steampowered.com/";
        let page = crate::steam_browser::read_page(
            steam::COMMUNITY_REFRESH_URL,
            steam::COMMUNITY_STEAM_ID_SCRIPT,
            &[community, store],
            &aborted,
        );
        if aborted() {
            return Err(SteamError::Aborted);
        }
        let page = page.unwrap_or_else(|error| {
            eprintln!("[steam-sync] Steam Community refresh failed, using stored cookies {error}");
            Default::default()
        });
        let refreshed = page.loaded.then(|| {
            let steam_id64 = steam::parse_community_page_steam_id(&page.url, &page.value);
            if steam_id64.is_none() {
                eprintln!(
                    "[steam-sync] Steam Community session is logged out {}",
                    page.url
                );
            }
            steam_id64
        });
        if !page.loaded {
            eprintln!("[steam-sync] Steam Community refresh failed, using stored cookies");
        }
        let of = |url: &str| -> Vec<(&str, &str)> {
            page.cookies
                .iter()
                .filter(|(u, _, _)| u == url)
                .map(|(_, n, v)| (n.as_str(), v.as_str()))
                .collect()
        };
        let community_cookies = of(community);
        let store_cookies = of(store);
        let has_login_cookie = community_cookies
            .iter()
            .any(|(n, v)| *n == "steamLoginSecure" && !v.is_empty());
        let timezone = community_cookies
            .iter()
            .chain(store_cookies.iter())
            .find(|(n, _)| *n == "timezoneOffset")
            .map(|(_, v)| *v);
        let cookie_header = community_cookies
            .iter()
            .filter(|(_, v)| !v.is_empty())
            .map(|(n, v)| format!("{n}={v}"))
            .collect::<Vec<_>>()
            .join("; ");
        Ok(CommunitySession {
            login: steam::resolve_community_login(refreshed, has_login_cookie),
            cookie_header,
            time_zone_offset_seconds: steam::parse_timezone_offset_seconds(timezone),
        })
    }

    fn web_api_get(&self, url: &str) -> Result<Value, SteamError> {
        let response = web_api_client()
            .get(url)
            .send()
            .map_err(|e| SteamError::Other(e.to_string()))?;
        let status = response.status().as_u16();
        let retry_after = steam::parse_retry_after(
            response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok()),
        );
        let text = response
            .text()
            .map_err(|e| SteamError::Other(e.to_string()))?;
        let body = steam::read_json_body(&text);
        if !(200..300).contains(&status) {
            return Err(SteamError::Http {
                status,
                body,
                retry_after_seconds: retry_after,
            });
        }
        Ok(body)
    }

    fn community_get(
        &self,
        url: &str,
        session: &CommunitySession,
    ) -> Result<CommunityPage, SteamError> {
        let mut request = community_client()
            .get(url)
            .header("Accept", "text/html,application/xhtml+xml");
        if !session.cookie_header.is_empty() {
            request = request.header("Cookie", &session.cookie_header);
        }
        let response = request
            .send()
            .map_err(|e| SteamError::Other(e.to_string()))?;
        let status = response.status().as_u16();
        let final_url = response.url().to_string();
        let retry_after = steam::parse_retry_after(
            response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok()),
        );
        let body = response
            .text()
            .map_err(|e| SteamError::Other(e.to_string()))?;
        Ok(CommunityPage {
            status,
            body,
            url: final_url,
            retry_after_seconds: retry_after,
        })
    }
}

/// persistLocalAchievementCounts: mergePersistedAchievementTotals with the
/// counts Steam reported (the larger of local and Steam).
fn persist_achievement_counts(db: &Db, steam_app_id: &str, schema: u64, unlocked: u64) {
    let key = keys::game("steam", steam_app_id);
    let _ = hydra_core::library_actions::update_game_record(db, &key, |game| {
        for (field, count) in [
            ("achievementCount", schema),
            ("unlockedAchievementCount", unlocked),
        ] {
            let local = game
                .get(field)
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
                .max(0.0);
            game.insert(field.into(), json!((local as u64).max(count)));
        }
    });
}

fn persist_run_id(db: &Db, id: Option<&str>) {
    match id {
        Some(id) => {
            let _ = db.put(keys::STEAM_SYNC_RUN, &json!({ "syncRunId": id }));
        }
        None => {
            let _ = db.delete(keys::STEAM_SYNC_RUN);
        }
    }
}

/// start(origin): returns the state after starting (or the running one).
pub fn start(origin: Origin) -> SteamSync {
    let current = state();
    if current.is_syncing() {
        eprintln!("[steam-sync] Start ignored, sync already running");
        return current;
    }
    let (Some(db), Some(api)) = (crate::shell::db(), crate::shell::api()) else {
        return current;
    };
    let abort = Arc::new(AtomicBool::new(false));
    ABORT.with(|a| *a.borrow_mut() = Some(abort.clone()));
    set_state(SteamSync::Running {
        sync_run_id: String::new(),
        phase: hydra_core::integrations::SteamPhase::Starting,
        games_found: 0,
        games_processed: 0,
    });
    let generation = api.auth_generation();
    let can_reconcile = api.is_logged_in() && crate::library_sync::has_active_subscription();
    let dry = dry_run();
    if dry {
        eprintln!("[steam-sync] dry run: Hydra writes are printed, not sent");
    }
    std::thread::spawn(move || {
        let hydra = Hydra {
            api: api.clone(),
            dry_run: dry,
        };
        let access = Steam {
            aborted: abort.clone(),
        };
        let set_state = |next: SteamSync, only_if_running: bool| {
            let _ = slint::invoke_from_event_loop(move || apply_state(next, only_if_running));
        };
        let finished = |payload: Finished| {
            let _ = slint::invoke_from_event_loop(move || on_finished(payload, origin));
        };
        let aborted = || abort.load(Ordering::SeqCst);
        let persist = |id: Option<&str>| persist_run_id(&db, id);
        let counts = |app: &str, schema: u64, unlocked: u64| {
            persist_achievement_counts(&db, app, schema, unlocked)
        };
        let merge = |progress: &(dyn Fn(usize, usize) + Sync)| {
            crate::library_sync::merge_blocking(
                &db,
                &api,
                generation,
                can_reconcile,
                Some(progress),
            );
            let _ = slint::invoke_from_event_loop(crate::library_sync::library_batch_complete);
        };
        // TODO(steam): linkImportedSteamGameExecutables needs the Steam
        // install detection (libraryfolders.vdf, appmanifests, appinfo.vdf)
        // and clearMissingExecutables; nothing is linked until it is ported.
        let link = |progress: &(dyn Fn(usize, usize) + Sync)| {
            progress(0, 0);
            0
        };
        let log = |message: &str| eprintln!("[steam-sync] {message}");
        let hooks = RunHooks {
            set_state: &set_state,
            finished: &finished,
            aborted: &aborted,
            persist_run_id: &persist,
            achievement_counts: &counts,
            merge: &merge,
            link_executables: &link,
            log: &log,
        };
        run::run(&hydra, &access, &hooks);
        let _ = slint::invoke_from_event_loop(|| {
            ABORT.with(|a| *a.borrow_mut() = None);
        });
    });
    state()
}

/// emitFinished → on-steam-sync-finished
fn on_finished(payload: Finished, origin: Origin) {
    if let Finished::Ok { .. } = payload {
        // TODO(steam): watchSteamLibraries() after a successful run.
        crate::library_sync::library_batch_complete();
    }
    crate::settings_integrations::on_steam_sync_finished(&payload, origin == Origin::Manual);
}

/// cancel: only a running sync can be cancelled; it settles back to idle.
pub fn cancel() {
    if let SteamSync::Running { sync_run_id, .. } = state() {
        eprintln!(
            "[steam-sync] Cancel requested {}",
            if sync_run_id.is_empty() {
                "(no run id yet)"
            } else {
                &sync_run_id
            }
        );
        set_state(SteamSync::Cancelling { sync_run_id });
        ABORT.with(|a| {
            if let Some(abort) = a.borrow().as_ref() {
                abort.store(true, Ordering::SeqCst);
            }
        });
    }
}

/// startSteamSyncOnStartup: once per session, when signed in and linked.
pub fn start_on_startup() {
    if STARTUP_ATTEMPTED.with(|a| a.replace(true)) {
        return;
    }
    let Some(api) = crate::shell::api().filter(|api| api.is_logged_in()) else {
        STARTUP_ATTEMPTED.with(|a| *a.borrow_mut() = false);
        return;
    };
    std::thread::spawn(
        move || match api.get(run::INTEGRATION_ENDPOINT, &[], Options::default()) {
            Ok(status) if status.get("connected").and_then(|c| c.as_bool()) == Some(true) => {
                let _ = slint::invoke_from_event_loop(|| {
                    start(Origin::Startup);
                });
            }
            Ok(_) => {}
            Err(error) => eprintln!("[steam-sync] Steam startup sync failed {error}"),
        },
    );
}

/// resetSteamStartupSync (sign-out / account switch)
pub fn reset_startup() {
    STARTUP_ATTEMPTED.with(|a| *a.borrow_mut() = false);
    clear_reconnect_required();
}

thread_local! {
    /// game-details.context.tsx pageSyncKey
    static PAGE_SYNC_KEY: RefCell<String> = const { RefCell::new(String::new()) };
}

/// The game page's sync effect: once per (user, page, eligible copies), the
/// Steam copies sync their playtime and achievements.
pub fn on_game_page(
    shop: &str,
    object_id: &str,
    group: Option<&hydra_core::library::Presentation>,
) {
    let eligible: Vec<&hydra_core::library::LibraryGame> = group
        .map(|g| g.members.iter().collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .filter(|m| m.shop() == "steam" || (m.shop() == "epic" && m.flag("hasActiveEpicImport")))
        .collect();
    let mut keys: Vec<String> = eligible.iter().map(|m| m.identity_key()).collect();
    keys.sort();
    let user = crate::shell::user_details()
        .and_then(|u| u.get("id").cloned())
        .unwrap_or(Value::Null);
    let key = json!([user, shop, object_id, keys]).to_string();
    if PAGE_SYNC_KEY.with(|k| std::mem::replace(&mut *k.borrow_mut(), key.clone()) == key) {
        return;
    }
    for member in eligible {
        if member.shop() == "steam" {
            sync_game_on_game_page(member.object_id());
        }
        // TODO(epic): syncEpicGameOnGamePage
    }
}

/// syncSteamGameOnGamePage: a Steam-imported game's playtime and
/// achievements, refreshed when its page opens (after a full sync).
pub fn sync_game_on_game_page(steam_app_id: &str) {
    if !steam_app_id
        .bytes()
        .next()
        .is_some_and(|b| (b'1'..=b'9').contains(&b))
        || steam_app_id.len() > 10
        || !steam_app_id.bytes().all(|b| b.is_ascii_digit())
    {
        return;
    }
    // TODO(steam): refreshSteamGameExecutable with the install detection.
    let (Some(db), Some(api)) = (crate::shell::db(), crate::shell::api()) else {
        return;
    };
    let key = keys::game("steam", steam_app_id);
    let eligible = api.is_logged_in()
        && db.get_in::<Value>(keys::GAMES, &key).is_some_and(|g| {
            g.get("isDeleted") != Some(&Value::Bool(true))
                && g.get("hasActiveSteamImport") == Some(&Value::Bool(true))
        });
    if !eligible || !PAGE_SYNCS.with(|p| p.borrow_mut().insert(steam_app_id.to_string())) {
        return;
    }
    // waitForFullSync: a running full sync goes first.
    if state().is_syncing() {
        let app = steam_app_id.to_string();
        PAGE_SYNCS.with(|p| p.borrow_mut().remove(&app));
        slint::Timer::single_shot(Duration::from_secs(2), move || sync_game_on_game_page(&app));
        return;
    }
    let app = steam_app_id.to_string();
    let dry = dry_run();
    std::thread::spawn(move || {
        let hydra = Hydra {
            api: api.clone(),
            dry_run: dry,
        };
        let abort = Arc::new(AtomicBool::new(false));
        let access = Steam {
            aborted: abort.clone(),
        };
        let set_state = |_: SteamSync, _: bool| {};
        let finished = |_: Finished| {};
        let aborted = || false;
        let persist = |_: Option<&str>| {};
        let counts = |id: &str, schema: u64, unlocked: u64| {
            persist_achievement_counts(&db, id, schema, unlocked)
        };
        let merge = |_: &(dyn Fn(usize, usize) + Sync)| {};
        let link = |_: &(dyn Fn(usize, usize) + Sync)| 0;
        let log = |message: &str| eprintln!("[steam-sync] {message}");
        let hooks = RunHooks {
            set_state: &set_state,
            finished: &finished,
            aborted: &aborted,
            persist_run_id: &persist,
            achievement_counts: &counts,
            merge: &merge,
            link_executables: &link,
            log: &log,
        };
        let result = run::collect_game_sync_payload(&hydra, &access, &hooks, &app)
            .and_then(|payload| run::publish_game(&hydra, &app, &payload));
        let changed = match result {
            Ok(Some(remote)) => {
                let key = keys::game("steam", &app);
                let remote = remote.as_object().cloned().unwrap_or_default();
                let updated = hydra_core::library_actions::update_game_record(&db, &key, |game| {
                    *game = hydra_core::library_sync::merge_imported_profile_game(game, &remote);
                });
                eprintln!("[steam-sync] Steam game page sync finished {app}");
                matches!(updated, Ok(Some(_)))
            }
            Ok(None) => false,
            Err(error) => {
                eprintln!("[steam-sync] Steam game page sync failed {app} {error}");
                false
            }
        };
        let _ = slint::invoke_from_event_loop(move || {
            PAGE_SYNCS.with(|p| p.borrow_mut().remove(&app));
            if changed {
                crate::library_sync::library_batch_complete();
            }
        });
    });
}

/// Dev hook: read the Community session through the hidden page and print
/// the login state and cookie names (never their values).
pub fn dev_community_probe() {
    std::thread::spawn(|| {
        let access = Steam {
            aborted: Arc::new(AtomicBool::new(false)),
        };
        let page = crate::steam_browser::read_page(
            steam::COMMUNITY_REFRESH_URL,
            steam::COMMUNITY_STEAM_ID_SCRIPT,
            &[
                "https://steamcommunity.com/",
                "https://store.steampowered.com/",
            ],
            &|| false,
        );
        match page {
            Ok(page) => eprintln!(
                "[steam-sync] probe: loaded={} url={} value={} cookies={:?}",
                page.loaded,
                page.url,
                page.value,
                page.cookies
                    .iter()
                    .map(|(u, n, _)| format!("{u}{n}"))
                    .collect::<Vec<_>>()
            ),
            Err(error) => eprintln!("[steam-sync] probe failed: {error}"),
        }
        match access.community_session() {
            Ok(session) => eprintln!(
                "[steam-sync] probe: login={:?} timezone={} cookie header names={:?}",
                session.login,
                session.time_zone_offset_seconds,
                session
                    .cookie_header
                    .split("; ")
                    .filter_map(|c| c.split('=').next())
                    .collect::<Vec<_>>()
            ),
            Err(error) => eprintln!("[steam-sync] probe session failed: {error}"),
        }
    });
}

/// Dev hook: show a sync state without running one (screenshots).
pub fn simulate(next: SteamSync) {
    set_state(next);
}
