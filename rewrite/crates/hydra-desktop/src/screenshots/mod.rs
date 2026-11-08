//! The in-game screenshot service: src/main/services/screenshots/*,
//! services/screenshot-input.ts and services/screenshot.ts.
//!
//! - The hotkey / controller combo (`input`, native/hydra-native's
//!   screenshot_input through hydra-capture) listens only while a tracked
//!   game runs, and `hydralauncher://screenshot` triggers the same capture.
//! - A trigger finds the game in the foreground (`foreground`), grabs a frame
//!   (`capture`: desktop duplication, else Windows Graphics Capture / X11),
//!   plays the shutter sound, saves `<Pictures>/Hydra/<game>/<time>.jpeg` and
//!   a preview, records it in the `screenshots` sublevel and shows a toast
//!   (`feedback`).
//! - Uploads (`upload`) compress, presign, PUT, complete, retry with the
//!   Electron policy, and summarize in OS notifications (`notifier`).
//! - `capture_game_screenshot` is ScreenshotService.captureGameScreenshot for
//!   achievement souvenirs (see `souvenir`).
//!
//! Most public functions touch the disk or the network: call them from a
//! worker thread unless they say otherwise.

// The listeners and the API at the bottom are for the screens that show
// screenshots and the Settings → Screenshots tab (built by other agents);
// until those land, parts of it are unused.
#![allow(dead_code, unused_imports)]

mod capture;
mod feature;
mod feedback;
mod foreground;
mod input;
mod notifier;
mod removal;
mod souvenir;
mod upload;

use std::cell::RefCell;
use std::collections::HashSet;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use hydra_core::api::HydraApi;
use hydra_core::screenshots::{
    self as logic, Draft, LocalScreenshot, LocalScreenshotStore, ScreenshotPreferences,
    telemetry::Counters,
};
use hydra_db::{Db, keys};
use serde_json::{Map, Value};
use slint::ComponentHandle;

use crate::AppWindow;

pub use capture::TriggerSource;
pub use feedback::{ToastContent, ToastPresenter, set_toast_presenter};
pub use input::InputStatus;
pub use souvenir::{
    CaptureTarget, achievement_screenshots_directory, capture_game_screenshot,
    delete_game_screenshot, import_game_screenshot,
};
pub use upload::{UploadOptions, UploadProgress};

/// What the service shares across its threads.
pub(crate) struct Service {
    pub db: Arc<Db>,
    pub api: Arc<HydraApi>,
    pub store: LocalScreenshotStore,
    pub telemetry: Counters,
    /// gamesPlaytime keys (the process watcher's running games)
    running: Mutex<HashSet<String>>,
}

static SERVICE: OnceLock<Arc<Service>> = OnceLock::new();

pub(crate) fn service() -> Option<Arc<Service>> {
    SERVICE.get().cloned()
}

impl Service {
    /// readUserPreferences
    pub fn preferences(&self) -> Map<String, Value> {
        self.db
            .get::<Map<String, Value>>(keys::USER_PREFERENCES)
            .unwrap_or_default()
    }

    /// resolveScreenshotPreferences(readUserPreferences())
    pub fn resolved(&self) -> ScreenshotPreferences {
        logic::preferences::resolve(&self.preferences())
    }

    /// getSignedInScreenshotOwnerId: the userId claim of the session token.
    pub fn owner_id(&self) -> Option<String> {
        if !self.api.is_logged_in() {
            return None;
        }
        self.db
            .get::<Value>(keys::AUTH)
            .and_then(|auth| {
                auth.get("accessToken")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .and_then(|token| logic::user_id_from_token(&token))
    }

    /// HydraApi.hasActiveSubscription: subscription.expiresAt in the future.
    pub fn has_active_subscription(&self) -> bool {
        self.db
            .get_in::<String>(keys::LOCAL_STORAGE, "userDetails")
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|user| {
                user.get("subscription")?
                    .get("expiresAt")?
                    .as_str()
                    .and_then(hydra_core::library::parse_iso_millis)
            })
            .is_some_and(|expires| expires > now_ms())
    }

    /// hasTrackedGamesRunning
    pub fn has_tracked_games_running(&self) -> bool {
        !self
            .running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_empty()
    }

    pub fn running_games(&self) -> Vec<String> {
        let mut keys: Vec<String> = self
            .running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .cloned()
            .collect();
        keys.sort();
        keys
    }

    /// isTrackedGameKeyRunning
    pub fn is_running(&self, game_key: &str) -> bool {
        self.running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains(game_key)
    }

    pub fn game(&self, game_key: &str) -> Option<Value> {
        self.db.get_in::<Value>(keys::GAMES, game_key)
    }

    /// ScreenshotTelemetry.record
    pub fn record(&self, kind: &'static str, outcome: &str, reason: Option<&str>) {
        if self.telemetry.record(kind, outcome, reason) {
            schedule_telemetry_flush();
        }
    }
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

// ---- UI thread: the window, change listeners --------------------------------

type ScreenshotsListener = Rc<dyn Fn(&[LocalScreenshot])>;
type ProgressListener = Rc<dyn Fn(&UploadProgress)>;
type StatusListener = Rc<dyn Fn(&InputStatus)>;

thread_local! {
    static UI: RefCell<slint::Weak<AppWindow>> = RefCell::new(slint::Weak::default());
    static CHANGE_LISTENERS: RefCell<Vec<ScreenshotsListener>> = const { RefCell::new(Vec::new()) };
    static PROGRESS_LISTENERS: RefCell<Vec<ProgressListener>> = const { RefCell::new(Vec::new()) };
    static STATUS_LISTENERS: RefCell<Vec<StatusListener>> = const { RefCell::new(Vec::new()) };
    static CHANGE_TIMER: slint::Timer = slint::Timer::default();
    static PREVIOUS_RUNNING: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
}

static UI_THREAD: OnceLock<std::thread::ThreadId> = OnceLock::new();

/// Runs `f` on the UI thread and waits for its answer (at most 1s). On the
/// UI thread itself it runs right away.
pub(crate) fn ask_ui<T: Send + 'static>(
    f: impl FnOnce(&AppWindow) -> T + Send + 'static,
) -> Option<T> {
    let run = move || UI.with(|ui| ui.borrow().upgrade()).map(|ui| f(&ui));
    if UI_THREAD.get() == Some(&std::thread::current().id()) {
        return run();
    }
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    slint::invoke_from_event_loop(move || {
        let _ = sender.send(run());
    })
    .ok()?;
    receiver.recv_timeout(Duration::from_secs(1)).ok().flatten()
}

/// BrowserWindow.getFocusedWindow() !== null
pub(crate) fn is_hydra_focused() -> bool {
    ask_ui(|ui| {
        use slint::winit_030::WinitWindowAccessor;
        ui.window()
            .with_winit_window(|window| window.has_focus())
            .unwrap_or(false)
    })
    .unwrap_or(false)
}

/// isMainWindowWatched: visible, not minimized and focused.
pub(crate) fn is_main_window_watched() -> bool {
    ask_ui(|ui| {
        use slint::winit_030::WinitWindowAccessor;
        ui.window().is_visible()
            && ui
                .window()
                .with_winit_window(|window| {
                    window.is_minimized() != Some(true) && window.has_focus()
                })
                .unwrap_or(false)
    })
    .unwrap_or(false)
}

/// on-local-screenshots-change: `listener` gets the signed-in owner's list
/// (newest first) 50ms after any change. UI thread.
pub fn on_local_screenshots_change(listener: impl Fn(&[LocalScreenshot]) + 'static) {
    CHANGE_LISTENERS.with(|l| l.borrow_mut().push(Rc::new(listener)));
}

/// on-screenshot-upload-progress. UI thread.
pub fn on_upload_progress(listener: impl Fn(&UploadProgress) + 'static) {
    PROGRESS_LISTENERS.with(|l| l.borrow_mut().push(Rc::new(listener)));
}

/// on-screenshot-input-status-change (the Settings → Screenshots tab). UI thread.
pub fn on_input_status_change(listener: impl Fn(&InputStatus) + 'static) {
    STATUS_LISTENERS.with(|l| l.borrow_mut().push(Rc::new(listener)));
}

pub(crate) fn emit_progress(progress: UploadProgress) {
    let _ = slint::invoke_from_event_loop(move || {
        let listeners = PROGRESS_LISTENERS.with(|l| l.borrow().clone());
        for listener in listeners {
            listener(&progress);
        }
    });
}

pub(crate) fn emit_input_status(status: InputStatus) {
    let _ = slint::invoke_from_event_loop(move || {
        let listeners = STATUS_LISTENERS.with(|l| l.borrow().clone());
        for listener in listeners {
            listener(&status);
        }
    });
}

/// broadcastLocalScreenshots, debounced by CHANGE_NOTIFICATION_DELAY_MS.
fn schedule_change_broadcast() {
    let _ = slint::invoke_from_event_loop(|| {
        CHANGE_TIMER.with(|timer| {
            if timer.running() {
                return;
            }
            timer.start(
                slint::TimerMode::SingleShot,
                Duration::from_millis(50),
                broadcast_local_screenshots,
            );
        });
    });
}

fn broadcast_local_screenshots() {
    let Some(service) = service() else { return };
    std::thread::spawn(move || {
        let owner = service.owner_id();
        let screenshots: Vec<LocalScreenshot> = service
            .store
            .list()
            .into_iter()
            .filter(|s| s.is_visible_to(owner.as_deref()))
            .collect();
        let _ = slint::invoke_from_event_loop(move || {
            notifier::on_screenshots_changed(&screenshots);
            let listeners = CHANGE_LISTENERS.with(|l| l.borrow().clone());
            for listener in listeners {
                listener(&screenshots);
            }
        });
    });
}

// ---- telemetry ---------------------------------------------------------------

static TELEMETRY_TIMER: Mutex<bool> = Mutex::new(false);

fn schedule_telemetry_flush() {
    let mut scheduled = TELEMETRY_TIMER.lock().unwrap_or_else(|e| e.into_inner());
    if *scheduled {
        return;
    }
    *scheduled = true;
    let _ = std::thread::Builder::new()
        .name("screenshot-telemetry".into())
        .spawn(|| {
            std::thread::sleep(Duration::from_millis(logic::telemetry::FLUSH_INTERVAL_MS));
            *TELEMETRY_TIMER.lock().unwrap_or_else(|e| e.into_inner()) = false;
            flush_telemetry();
        });
}

static FLUSHING: Mutex<()> = Mutex::new(());

/// ScreenshotTelemetry.flush: POST /screenshots/telemetry in batches of 50;
/// a retryable failure puts the rest back for the next flush.
fn flush_telemetry() {
    let Some(service) = service() else { return };
    let _flushing = FLUSHING.lock().unwrap_or_else(|e| e.into_inner());
    if service.telemetry.is_empty() {
        return;
    }
    if !service.api.is_logged_in() {
        schedule_telemetry_flush();
        return;
    }
    let mut batches = service.telemetry.take_batches().into_iter();
    while let Some(batch) = batches.next() {
        let events: Vec<Value> = batch.iter().map(|e| e.to_json()).collect();
        let result = service.api.post(
            "/screenshots/telemetry",
            &serde_json::json!({ "events": events }),
            hydra_core::api::Options::default(),
        );
        if let Err(error) = result {
            eprintln!("Failed to send screenshot telemetry: {error}");
            if !logic::retry::is_rejected_request(&error) {
                service
                    .telemetry
                    .requeue(batch.into_iter().chain(batches.flatten()));
                schedule_telemetry_flush();
                return;
            }
        }
    }
}

// ---- app wiring ----------------------------------------------------------------

/// initializeScreenshots + ScreenshotInputService.syncUserPreferences at
/// startup. UI thread, after shell::init.
pub fn init(ui: &AppWindow) {
    let (Some(db), Some(api)) = (crate::shell::db(), crate::shell::api()) else {
        return;
    };
    UI.with(|u| *u.borrow_mut() = ui.as_weak());
    let _ = UI_THREAD.set(std::thread::current().id());
    let service = Arc::new(Service {
        store: LocalScreenshotStore::new(db.clone()),
        db,
        api,
        telemetry: Counters::default(),
        running: Mutex::new(HashSet::new()),
    });
    service.store.set_on_change(schedule_change_broadcast);
    if SERVICE.set(service.clone()).is_err() {
        return;
    }
    feedback::init();
    input::sync_user_preferences(&service.preferences());
    std::thread::spawn(move || {
        // HydraApi.setupApi().then(refreshFeatureFlag) and the store's start
        input::refresh_feature_flag();
        if let Err(error) = backfill_game_ids(&service) {
            eprintln!("Failed to back-fill local screenshot game ids: {error}");
        }
        upload::start();
        #[cfg(debug_assertions)]
        if let Ok(client_id) = std::env::var("HYDRA_DEV_SCREENSHOT_UPLOAD") {
            dev_upload_round_trip(&service, &client_id);
        }
        #[cfg(debug_assertions)]
        if let Ok(id) = std::env::var("HYDRA_DEV_SCREENSHOT_CHECK") {
            let owner = service.owner_id().unwrap_or_default();
            let listed = service.api.get(
                &format!("/users/{owner}/screenshots"),
                &[("take", "50".to_string()), ("sort", "recent".to_string())],
                hydra_core::api::Options::default(),
            );
            eprintln!(
                "dev check: {id} listed: {:?}",
                listed.map(|value| value.to_string().contains(&id))
            );
        }
    });
}

/// Debug builds: HYDRA_DEV_SCREENSHOT_UPLOAD=<clientId> uploads that
/// screenshot as PRIVATE, waits for the result, then deletes it on the
/// server like the profile does (DELETE /profile/screenshots/:id, then
/// forgetPublishedScreenshots). For testing the upload path end to end.
#[cfg(debug_assertions)]
fn dev_upload_round_trip(service: &Arc<Service>, client_id: &str) {
    std::thread::sleep(Duration::from_secs(3));
    let options = UploadOptions {
        is_spoiler: false,
        visibility: "PRIVATE".into(),
        comments_enabled: Some(false),
        custom_game_title: Some("Hydra Capture Test".into()),
        description: None,
    };
    match upload_local_screenshot(client_id, options) {
        Ok(screenshot) => eprintln!("dev upload: queued ({})", screenshot.state),
        Err(error) => {
            eprintln!("dev upload: refused: {error}");
            return;
        }
    }
    let started = std::time::Instant::now();
    let done = loop {
        std::thread::sleep(Duration::from_secs(1));
        let Some(current) = service.store.get(client_id) else {
            eprintln!("dev upload: the record is gone");
            return;
        };
        if matches!(current.state.as_str(), "uploaded" | "failed")
            || started.elapsed() > Duration::from_secs(180)
        {
            break current;
        }
    };
    eprintln!(
        "dev upload: {} id {:?} moderation {:?} quality {:?} error {:?} after {} ms",
        done.state,
        done.screenshot_id,
        done.moderation_status,
        done.upload_quality,
        done.last_error,
        started.elapsed().as_millis()
    );
    let Some(id) = done.screenshot_id.filter(|_| done.state == "uploaded") else {
        return;
    };
    // buildUserScreenshotsPath (the profile's screenshot list)
    let owner = service.owner_id().unwrap_or_default();
    let listed = service.api.get(
        &format!("/users/{owner}/screenshots"),
        &[("take", "20".to_string()), ("sort", "recent".to_string())],
        hydra_core::api::Options::default(),
    );
    let found = listed
        .as_ref()
        .ok()
        .is_some_and(|value| value.to_string().contains(&id));
    eprintln!("dev upload: listed on the profile: {found}");
    let deleted = service.api.delete(
        &format!("/profile/screenshots/{id}"),
        hydra_core::api::Options::default(),
    );
    eprintln!("dev upload: server delete: {:?}", deleted.map(|_| "ok"));
    let forgotten = forget_published_screenshots(&[id]);
    let after = service.store.get(client_id).map(|s| s.state);
    eprintln!("dev upload: forgotten {forgotten}, local state now {after:?}");
}

/// backfillLocalScreenshotGameIds
fn backfill_game_ids(service: &Service) -> Result<(), String> {
    let screenshots = service.store.list_including_deleted();
    if !screenshots.iter().any(|s| s.object_id.is_none()) {
        return Ok(());
    }
    let games = service
        .db
        .values::<Value>(keys::GAMES)
        .map_err(|e| e.to_string())?;
    for screenshot in &screenshots {
        if let Some(object_id) = logic::local::find_game_object_id(screenshot, &games) {
            service.store.update(&screenshot.client_id, |current| {
                if current.object_id.is_some() {
                    return false;
                }
                current.object_id = Some(object_id.clone());
                true
            });
        }
    }
    Ok(())
}

/// games.rs on-games-running: new sessions call onScreenshotGameStarted,
/// ended ones onScreenshotGameClosed, and the input service follows
/// hasTrackedGamesRunning. UI thread.
pub fn on_running_games(running: &HashSet<String>) {
    let Some(service) = service() else { return };
    let (started, closed) = PREVIOUS_RUNNING.with(|previous| {
        let mut previous = previous.borrow_mut();
        let started: Vec<String> = running.difference(&previous).cloned().collect();
        let closed: Vec<String> = previous.difference(running).cloned().collect();
        *previous = running.clone();
        (started, closed)
    });
    if started.is_empty() && closed.is_empty() {
        return;
    }
    *service.running.lock().unwrap_or_else(|e| e.into_inner()) = running.clone();
    std::thread::spawn(move || {
        for key in started {
            on_game_started(&service, &key);
        }
        for key in closed {
            on_game_closed(&service, &key);
        }
        input::on_tracked_games_running_change();
    });
}

/// onScreenshotGameStarted: warm up the sound and the capture device.
fn on_game_started(service: &Service, game_key: &str) {
    if !(service.resolved().enabled && feature::is_enabled(service)) {
        return;
    }
    if !service.is_running(game_key) {
        return;
    }
    feedback::prepare();
    if hydra_capture::foreground::is_wayland_session() {
        hydra_capture::foreground::start_wayland_focus_watch();
    } else if cfg!(windows) {
        if let Err(error) = hydra_capture::window_capture::prepare() {
            eprintln!("screenshots: failed to prepare desktop capture: {error}");
        }
    }
}

/// onScreenshotGameClosed
fn on_game_closed(service: &Service, game_key: &str) {
    capture::clear_game_session(game_key);
    foreground::forget(game_key);
    if !service.has_tracked_games_running() {
        release_running_game_resources();
    }
}

fn release_running_game_resources() {
    feedback::release();
    hydra_capture::window_capture::release();
    hydra_capture::foreground::stop_wayland_focus_watch();
}

/// updateUserPreferences side effects: ScreenshotInputService
/// .syncUserPreferences, and applyScreenshotsEnabledPreference when the
/// patch has `screenshotsEnabled`.
pub fn on_preferences_updated(patch: &Map<String, Value>, merged: &Map<String, Value>) {
    let Some(service) = service() else { return };
    input::sync_user_preferences(merged);
    if let Some(enabled) = patch.get("screenshotsEnabled") {
        let enabled = enabled.as_bool();
        std::thread::spawn(move || {
            if enabled == Some(false) {
                release_running_game_resources();
                return;
            }
            for key in service.running_games() {
                if service.game(&key).is_some() {
                    on_game_started(&service, &key);
                }
            }
        });
    }
}

/// `hydralauncher://screenshot`: ScreenshotInputService.trigger("deeplink").
pub fn trigger_deeplink() {
    std::thread::spawn(|| {
        input::trigger(TriggerSource::Deeplink);
    });
}

/// The `screenshotModerated` realtime event (handleModerationResult).
pub fn on_moderated(payload: &Value) {
    let id = payload
        .get("screenshotId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let status = payload.get("moderationStatus").and_then(Value::as_str);
    let reason = payload.get("moderationReason");
    let valid = !id.is_empty()
        && matches!(status, Some("APPROVED" | "BLOCKED"))
        && reason.is_none_or(|r| r.is_null() || r.is_string());
    if !valid {
        return;
    }
    let (id, status) = (id.to_string(), status.unwrap_or_default().to_string());
    let reason = reason.and_then(Value::as_str).map(str::to_string);
    std::thread::spawn(move || upload::handle_moderation_result(&id, &status, reason));
}

/// HydraApi.onAuthContextChanged: re-send the list for the new owner and
/// restart the upload worker.
pub fn on_auth_changed() {
    schedule_change_broadcast();
    upload::on_auth_changed();
}

/// will-quit: stop the hotkey, then give telemetry 2s to flush.
pub fn shutdown() {
    input::shutdown();
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        flush_telemetry();
        let _ = sender.send(());
    });
    let _ = receiver.recv_timeout(Duration::from_millis(2_000));
}

// ---- the API other screens use (window.electron.* in Electron) --------------

/// getScreenshotInputStatus (refreshStatus). Probes the backends when not listening.
pub fn input_status() -> InputStatus {
    input::refresh_status()
}

/// getLocalScreenshots: the signed-in owner's screenshots, missing files pruned.
pub fn local_screenshots() -> Vec<LocalScreenshot> {
    let Some(service) = service() else {
        return Vec::new();
    };
    let owner = service.owner_id();
    let list: Vec<LocalScreenshot> = service
        .store
        .list()
        .into_iter()
        .filter(|s| s.is_visible_to(owner.as_deref()))
        .collect();
    removal::prune_missing(&service, list)
}

/// getLocalScreenshotsForGame
pub fn local_screenshots_for_game(shop: &str, object_id: &str) -> Vec<LocalScreenshot> {
    let Some(service) = service() else {
        return Vec::new();
    };
    let owner = service.owner_id();
    let list: Vec<LocalScreenshot> = service
        .store
        .list_for_game(shop, object_id)
        .into_iter()
        .filter(|s| s.is_visible_to(owner.as_deref()))
        .collect();
    removal::prune_missing(&service, list)
}

/// getPublishedScreenshotIdsForGame
pub fn published_screenshot_ids_for_game(shop: &str, object_id: &str) -> Vec<String> {
    let Some(service) = service() else {
        return Vec::new();
    };
    let Some(owner) = service.owner_id() else {
        return Vec::new();
    };
    logic::local::published_screenshot_ids(
        &service.store.list_including_deleted(),
        shop,
        object_id,
        &owner,
    )
}

/// <Pictures>/Hydra (getDefaultScreenshotsFolder)
pub fn default_screenshots_folder() -> PathBuf {
    dirs::picture_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join("Pictures")))
        .unwrap_or_default()
        .join(logic::paths::SCREENSHOTS_FOLDER_NAME)
}

/// getScreenshotsFolderPath: `screenshotsFolderPath` when absolute, else <Pictures>/Hydra.
pub fn screenshots_folder() -> PathBuf {
    let preferred = service().map(|s| s.preferences()).and_then(|p| {
        p.get("screenshotsFolderPath")
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    logic::paths::resolve_directory(preferred.as_deref(), &default_screenshots_folder())
}

/// getScreenshotFolderCandidates: the folder, the default, ~/Pictures/Hydra.
pub(crate) fn screenshot_folder_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![screenshots_folder(), default_screenshots_folder()];
    if let Some(home) = dirs::home_dir() {
        candidates.push(
            home.join("Pictures")
                .join(logic::paths::SCREENSHOTS_FOLDER_NAME),
        );
    }
    let mut seen = HashSet::new();
    candidates.retain(|c| seen.insert(c.clone()));
    candidates
}

/// openScreenshotsFolder: the first candidate that can be created.
pub fn open_screenshots_folder() {
    for directory in screenshot_folder_candidates() {
        if std::fs::create_dir_all(&directory).is_err() {
            continue;
        }
        if !hydra_launch::open_path(&directory.to_string_lossy()) {
            eprintln!(
                "Failed to open the screenshots folder {}",
                directory.display()
            );
        }
        return;
    }
    eprintln!("No screenshots folder is available to open");
}

/// uploadLocalScreenshot: queue it (the worker uploads in capture order).
pub fn upload_local_screenshot(
    client_id: &str,
    options: UploadOptions,
) -> Result<LocalScreenshot, String> {
    let service = service().ok_or("screenshots are not ready")?;
    if let Some(screenshot) = service.store.get(client_id) {
        if removal::remove_if_missing(&service, client_id) {
            return Ok(LocalScreenshot {
                state: "deleted".into(),
                ..screenshot
            });
        }
    }
    notifier::mark_user_upload(client_id);
    upload::enqueue(&service, client_id, options)
}

/// updateLocalScreenshotDraft
pub fn update_local_screenshot_draft(client_id: &str, draft: Draft) -> Option<LocalScreenshot> {
    let service = service()?;
    let owner = service.owner_id();
    let screenshot = service.store.get(client_id)?;
    if !screenshot.is_visible_to(owner.as_deref()) {
        return None;
    }
    service.store.update(client_id, |current| {
        logic::local::apply_draft(current, &draft)
    })
}

/// deleteLocalScreenshot
pub fn delete_local_screenshot(client_id: &str) {
    if let Some(service) = service() {
        removal::delete_local_screenshot(&service, client_id);
    }
}

/// deleteLocalScreenshotsForGame: how many were deleted.
pub fn delete_local_screenshots_for_game(shop: &str, object_id: &str) -> usize {
    service().map_or(0, |s| removal::delete_for_game(&s, shop, object_id))
}

/// countLocalScreenshotFilesForGame
pub fn count_local_screenshot_files_for_game(shop: &str, object_id: &str) -> usize {
    service().map_or(0, |s| removal::files_for_game(&s, shop, object_id).len())
}

/// forgetPublishedScreenshots: after the profile deleted them on the server.
pub fn forget_published_screenshots(screenshot_ids: &[String]) -> usize {
    service().map_or(0, |s| removal::forget_published(&s, screenshot_ids))
}
