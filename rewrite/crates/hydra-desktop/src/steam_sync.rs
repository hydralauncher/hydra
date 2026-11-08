//! steamSyncOrchestrator (services/steam-integration/steam-sync-orchestrator.ts):
//! the sync state the Steam card shows, start/cancel, the persisted run id
//! and the startup sync (steam-startup-sync.ts).
//!
//! TODO(steam): the run itself. Electron's run creates or resumes a sync run
//! (POST /profile/integrations/steam/sync), reads the Steam Web API token
//! from a hidden store page in the `persist:steam` session, fetches the
//! owned + family library and community achievements, publishes the
//! snapshot in chunks and then merges the remote library
//! (`mergeWithRemoteGames`, not ported yet). Until then `start` reports
//! the TODO and stays idle, so the card never shows a fake sync.

use std::cell::RefCell;

use hydra_core::integrations::SteamSync;
use hydra_db::keys;

/// SteamSyncOrigin
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origin {
    Manual,
    #[allow(dead_code)]
    Startup,
}

thread_local! {
    static STATE: RefCell<SteamSync> = RefCell::new(SteamSync::default());
    static STARTUP_ATTEMPTED: RefCell<bool> = const { RefCell::new(false) };
}

pub fn state() -> SteamSync {
    STATE.with(|s| s.borrow().clone())
}

/// setState + on-steam-sync-progress
fn set_state(next: SteamSync) {
    STATE.with(|s| *s.borrow_mut() = next.clone());
    crate::settings_integrations::on_steam_sync_progress(&next);
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

/// start(origin): returns the state after starting (or the running one).
pub fn start(origin: Origin) -> SteamSync {
    let current = state();
    if current.is_syncing() {
        return current;
    }
    eprintln!("TODO(steam): Steam sync run ({origin:?}); the orchestrator isn't ported yet");
    current
}

/// cancel: only a running sync can be cancelled.
pub fn cancel() {
    if let SteamSync::Running { sync_run_id, .. } = state() {
        set_state(SteamSync::Cancelling { sync_run_id });
        // TODO(steam): abort the run; it settles back to idle.
        set_state(SteamSync::default());
    }
}

/// startSteamSyncOnStartup: once per session, when signed in and linked.
/// TODO(steam): call it at startup and after sign-in once the run is ported.
#[allow(dead_code)]
pub fn start_on_startup() {
    if STARTUP_ATTEMPTED.with(|a| a.replace(true)) || !crate::shell::signed_in() {
        return;
    }
    let Some(api) = crate::shell::api() else {
        return;
    };
    std::thread::spawn(move || {
        match api.get(
            "/profile/integrations/steam",
            &[],
            hydra_core::api::Options::default(),
        ) {
            Ok(status) if status.get("connected").and_then(|c| c.as_bool()) == Some(true) => {
                let _ = slint::invoke_from_event_loop(|| {
                    start(Origin::Startup);
                });
            }
            Ok(_) => {}
            Err(error) => eprintln!("Steam startup sync failed: {error}"),
        }
    });
}

/// resetSteamStartupSync (sign-out / account switch)
#[allow(dead_code)]
pub fn reset_startup() {
    STARTUP_ATTEMPTED.with(|a| *a.borrow_mut() = false);
    clear_reconnect_required();
}

/// Dev hook: show a sync state without running one (screenshots).
pub fn simulate(next: SteamSync) {
    set_state(next);
}
