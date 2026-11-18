//! The library's account sync in the app (services/library-sync and its
//! callers):
//! - `uploadGamesBatch` at startup and after sign-in
//!   (upload-games-batch.ts), wrapped in `trackRemoteLibrarySync`
//!   (remote-library-sync-state.ts), which the sidebar and the library page
//!   show as loading while the library is still empty or waits for the new
//!   account (app.tsx, library-slice.ts `selectIsLibraryLoading`)
//! - `mergeWithRemoteGames`: one plain merge per account at a time; callers
//!   that arrive mid-run wait for one follow-up run
//! - `mergeWithRemoteGamesUnlessFresh` behind `refreshLibraryAssets` (the
//!   library page, 60s)
//! - `syncDownloadSourcesFromApi` (services/user/sync-download-sources.ts)
//! - the main process's half of sign-in (HydraApi.handleExternalAuth):
//!   getUserData, then the Steam startup sync, the upload and the sources.
//!
//! Work runs on worker threads; results come back to the UI thread.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use hydra_core::api::{HydraApi, Options};
use hydra_core::library_sync::{self as sync, MergeContext, MergeStop};
use hydra_db::{Db, keys};
use serde_json::{Value, json};

use crate::shell;

/// refresh-library-assets.ts REMOTE_LIBRARY_FRESH_MS
const REMOTE_LIBRARY_FRESH: Duration = Duration::from_secs(60);

type Waiter = Box<dyn FnOnce(bool)>;

struct PlainMerge {
    waiters: Vec<Waiter>,
    /// Callers that arrived mid-run: they wait for one follow-up run.
    next: Option<Vec<Waiter>>,
}

#[derive(Default)]
struct State {
    /// trackRemoteLibrarySync's counter
    active_syncs: usize,
    /// plainMerges, by auth generation
    merges: HashMap<u64, PlainMerge>,
    /// plainMergeCompletedAt
    completed_at: HashMap<u64, Instant>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

/// `HydraApi.hasActiveSubscription()`: the cached user's subscription.
pub fn has_active_subscription() -> bool {
    subscription_active(shell::user_details().as_ref())
}

fn subscription_active(user: Option<&Value>) -> bool {
    user.and_then(|u| u.get("subscription"))
        .and_then(|s| s.get("expiresAt"))
        .and_then(sync::date_ms)
        .is_some_and(|expires| expires > chrono::Utc::now().timestamp_millis())
}

fn handles() -> Option<(Arc<Db>, Arc<HydraApi>)> {
    Some((shell::db()?, shell::api()?))
}

/// Startup (main.ts after setupApi): the upload + merge, the download
/// sources, and the Steam startup sync when signed in.
pub fn init() {
    upload_games_batch();
    sync_download_sources_from_api(has_active_subscription());
    if shell::api().is_some_and(|api| api.is_logged_in()) {
        crate::steam_sync::start_on_startup();
    }
}

/// handleExternalAuth after the session is stored: getUserData (the
/// subscription), the Steam startup sync, then uploadGamesBatch and
/// syncDownloadSourcesFromApi. `on-signin` (the renderer's toast and user
/// reload) is the caller's.
pub fn on_signed_in() {
    let Some((_, api)) = handles() else { return };
    let generation = api.auth_generation();
    std::thread::spawn(move || {
        let me = api.get("/profile/me", &[], Options::default());
        let _ = slint::invoke_from_event_loop(move || {
            if !shell::api().is_some_and(|api| api.is_generation_current(generation)) {
                return;
            }
            let subscribed = match &me {
                Ok(user) => subscription_active(Some(user)),
                Err(error) => {
                    eprintln!("Failed to get logged user: {error}");
                    has_active_subscription()
                }
            };
            crate::steam_sync::start_on_startup();
            upload_games_batch();
            sync_download_sources_from_api(subscribed);
        });
    });
}

/// trackRemoteLibrarySync begin: the first one turns the state on.
fn track_begin() {
    let first = with(|s| {
        s.active_syncs += 1;
        s.active_syncs == 1
    });
    if first {
        shell::set_library_syncing_remote(true);
    }
}

/// trackRemoteLibrarySync end: the last one reloads the library, then
/// clears the state (app.tsx's on-remote-library-sync-state handler).
fn track_end() {
    let last = with(|s| {
        s.active_syncs = s.active_syncs.saturating_sub(1);
        s.active_syncs == 0
    });
    if last {
        shell::load_library_then(|| {
            shell::set_library_syncing_remote(false);
            shell::set_library_awaiting_account(false);
        });
    }
}

/// `getRemoteLibrarySyncState`
#[allow(dead_code)]
pub fn is_remote_library_syncing() -> bool {
    with(|s| s.active_syncs > 0)
}

/// on-library-batch-complete: the library, hidden games and collections
/// read again.
pub fn library_batch_complete() {
    shell::load_library();
    crate::library_page::on_visibility_changed();
}

/// uploadGamesBatch: games without a remote id go up, then the account
/// library merges in.
pub fn upload_games_batch() {
    let Some((db, api)) = handles() else { return };
    track_begin();
    let generation = api.auth_generation();
    std::thread::spawn(move || {
        // TODO(epic): clearStaleEpicImports(context) before the upload.
        let current = || api.is_generation_current(generation);
        match sync::upload_local_games(&db, &api, &current) {
            Ok(0) => {}
            Ok(sent) if sync::dry_run() => {
                eprintln!("[library-sync] dry run: {sent} games printed, none sent")
            }
            Ok(sent) => eprintln!("[library-sync] uploaded {sent} games"),
            Err(error) => eprintln!("[library-sync] upload: {error}"),
        }
        let still_current = current();
        let _ = slint::invoke_from_event_loop(move || {
            if !still_current {
                track_end();
                return;
            }
            merge_for(generation, |_| {
                // TODO(achievements): AchievementWatcherManager.preSearchAchievements()
                library_batch_complete();
                track_end();
            });
        });
    });
}

/// mergeWithRemoteGames(): a plain merge for the signed-in account.
#[allow(dead_code)]
pub fn merge(done: impl FnOnce(bool) + 'static) {
    let Some((_, api)) = handles() else {
        done(false);
        return;
    };
    merge_for(api.auth_generation(), done);
}

fn merge_for(generation: u64, done: impl FnOnce(bool) + 'static) {
    let running = with(|s| match s.merges.get_mut(&generation) {
        Some(merge) => {
            merge.next.get_or_insert_with(Vec::new).push(Box::new(done));
            None
        }
        None => Some(done),
    });
    if let Some(done) = running {
        start_plain_merge(generation, vec![Box::new(done)]);
    }
}

fn start_plain_merge(generation: u64, waiters: Vec<Waiter>) {
    let Some((db, api)) = handles() else {
        for waiter in waiters {
            waiter(false);
        }
        return;
    };
    with(|s| {
        s.merges.insert(
            generation,
            PlainMerge {
                waiters,
                next: None,
            },
        )
    });
    let can_reconcile = api.is_logged_in() && has_active_subscription();
    std::thread::spawn(move || {
        let ok = merge_blocking(&db, &api, generation, can_reconcile, None);
        let _ = slint::invoke_from_event_loop(move || finish_plain_merge(generation, ok));
    });
}

fn finish_plain_merge(generation: u64, ok: bool) {
    let Some(merge) = with(|s| {
        if ok {
            s.completed_at.insert(generation, Instant::now());
        }
        s.merges.remove(&generation)
    }) else {
        return;
    };
    for waiter in merge.waiters {
        waiter(ok);
    }
    if let Some(next) = merge.next {
        start_plain_merge(generation, next);
    }
}

/// `mergeWithRemoteGamesOnce` on this thread: true when the whole merge ran
/// for the same account. `progress` is the Steam sync's.
pub fn merge_blocking(
    db: &Db,
    api: &HydraApi,
    generation: u64,
    can_reconcile_custom_artwork: bool,
    progress: Option<&(dyn Fn(usize, usize) + Sync)>,
) -> bool {
    let started = Instant::now();
    let current = || api.is_generation_current(generation);
    let ctx = MergeContext {
        can_reconcile_custom_artwork,
        auth: sync::auth_context(db),
        current: &current,
        progress,
        epic_connection_id: None,
    };
    match sync::merge_with_remote_games(db, api, &ctx) {
        Ok(report) => {
            eprintln!(
                "[library-sync] merged {} remote games ({} new, {} updated, {} Steam imports hidden, {} Epic removed) in {:?}",
                report.remote_games,
                report.created,
                report.updated,
                report.hidden_steam_imports,
                report.epic_removed,
                started.elapsed()
            );
            true
        }
        // Keep the local library when the remote sync fails.
        Err(MergeStop::Api(hydra_core::api::ApiError::NotLoggedIn)) => false,
        Err(error) => {
            eprintln!("[library-sync] merge stopped: {error}");
            false
        }
    }
}

/// `mergeWithRemoteGamesUnlessFresh(maxAge)`: reuse a full merge for this
/// account that finished within `max_age`.
fn merge_unless_fresh(max_age: Duration, done: impl FnOnce(bool) + 'static) {
    let Some((_, api)) = handles() else {
        done(false);
        return;
    };
    let generation = api.auth_generation();
    let fresh = with(|s| {
        !s.merges.contains_key(&generation)
            && s.completed_at
                .get(&generation)
                .is_some_and(|at| at.elapsed() < max_age)
    });
    if fresh {
        done(true);
    } else {
        merge_for(generation, done);
    }
}

/// refreshLibraryAssets (the library page's mount effect): then the
/// library, hidden games and collections load again.
pub fn refresh_library_assets() {
    merge_unless_fresh(REMOTE_LIBRARY_FRESH, |_| library_batch_complete());
}

/// syncDownloadSourcesFromApi: the account's download sources that aren't
/// stored yet (subscribers only).
pub fn sync_download_sources_from_api(subscribed: bool) {
    let Some((db, api)) = handles() else { return };
    if !api.is_logged_in() || !subscribed {
        return;
    }
    std::thread::spawn(move || {
        let profile_sources = match api.get("/profile/download-sources", &[], Options::default()) {
            Ok(Value::Array(sources)) => sources,
            Ok(_) => Vec::new(),
            Err(error) => {
                eprintln!("Failed to sync download sources from API: {error}");
                return;
            }
        };
        let existing: Vec<Value> = db.values(keys::DOWNLOAD_SOURCES).unwrap_or_default();
        let urls: Vec<&str> = existing
            .iter()
            .filter_map(|s| s.get("url").and_then(Value::as_str))
            .collect();
        for source in &profile_sources {
            let url = source
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if urls.contains(&url) {
                continue;
            }
            let Some(mut stored) = source.as_object().cloned() else {
                continue;
            };
            stored.insert("isRemote".into(), json!(true));
            stored.insert(
                "createdAt".into(),
                json!(hydra_core::library_actions::now_iso()),
            );
            let id = match source.get("id") {
                Some(Value::String(id)) => id.clone(),
                Some(other) => other.to_string(),
                None => "undefined".into(),
            };
            match db.put_in(keys::DOWNLOAD_SOURCES, &id, &Value::Object(stored)) {
                Ok(()) => eprintln!("Synced download source from profile: {url}"),
                Err(error) => eprintln!("Failed to sync download source {url}: {error}"),
            }
        }
    });
}
