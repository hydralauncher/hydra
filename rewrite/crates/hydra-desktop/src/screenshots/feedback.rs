//! screenshots/screenshot-feedback.ts: the shutter and error sounds, and the
//! capture toast.
//!
//! Electron plays `resources/screenshot.mp3` / `screenshot-error.mp3` from a
//! hidden window (`screenshot-sound.html`) kept while games run; here they
//! are decoded when a game starts (hydra_media::sound) and dropped 30s after
//! the last game closes.
//!
//! The toast goes to the custom achievement notification window on Windows
//! (unless `achievementCustomNotificationsEnabled` is false), with the
//! "screenshot" / "screenshot-error" variant. That window belongs to the
//! achievement notifications; it plugs in with `set_toast_presenter`. Until
//! then, and on Linux, the toast is a silent OS notification, which is
//! Electron's fallback too.

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Mutex;
use std::time::Duration;

use hydra_i18n::Arg;
use hydra_media::sound::{self, Sound};
use serde_json::{Map, Value};

use super::service;

static CAPTURE_MP3: &[u8] = include_bytes!("../../../../../resources/screenshot.mp3");
static FAILURE_MP3: &[u8] = include_bytes!("../../../../../resources/screenshot-error.mp3");

/// DEFAULT_CAPTURE_SOUND_VOLUME
const DEFAULT_VOLUME: f64 = 0.15;
/// DEFAULT_TOAST_POSITION
const DEFAULT_POSITION: &str = "top-left";
/// IDLE_SOUND_WINDOW_RELEASE_MS
const IDLE_RELEASE: Duration = Duration::from_secs(30);

struct Sounds {
    capture: Sound,
    failure: Sound,
}

static SOUNDS: Mutex<Option<Sounds>> = Mutex::new(None);
static FAILED: Mutex<bool> = Mutex::new(false);
static IDLE_TOKEN: Mutex<u64> = Mutex::new(0);

/// What the toast shows (AchievementNotificationInfo's screenshot fields).
#[derive(Clone, Debug)]
pub struct ToastContent {
    pub title: String,
    pub description: String,
    /// "screenshot" | "screenshot-error"
    pub variant: &'static str,
}

/// The custom notification window (achievementNotificationPresenter).
/// All calls happen on the UI thread.
pub trait ToastPresenter {
    /// enqueueScreenshot(position, info). Return false to fall back to an
    /// OS notification.
    fn present(&self, position: &str, toast: &ToastContent) -> bool;
    /// keepWarm(position): a game started, the window may be prepared.
    fn keep_warm(&self, _position: &str) {}
    /// releaseWarm: no game runs any more.
    fn release_warm(&self) {}
}

thread_local! {
    static PRESENTER: RefCell<Option<Rc<dyn ToastPresenter>>> = const { RefCell::new(None) };
}

/// Plugs in the custom notification window. UI thread.
pub fn set_toast_presenter(presenter: Rc<dyn ToastPresenter>) {
    PRESENTER.with(|p| *p.borrow_mut() = Some(presenter));
}

pub fn init() {}

fn sound_file(name: &str, bytes: &[u8]) -> Option<PathBuf> {
    let directory = std::env::temp_dir().join("hydra-native-sounds");
    std::fs::create_dir_all(&directory).ok()?;
    let path = directory.join(name);
    let current = std::fs::metadata(&path).map(|m| m.len()).ok();
    if current != Some(bytes.len() as u64) {
        std::fs::write(&path, bytes).ok()?;
    }
    Some(path)
}

fn load_sounds() -> Option<Sounds> {
    let load = |name: &str, bytes: &[u8]| {
        let path = sound_file(name, bytes)?;
        sound::load(&path)
            .map_err(|error| eprintln!("Failed to load {name}: {error}"))
            .ok()
    };
    Some(Sounds {
        capture: load("screenshot.mp3", CAPTURE_MP3)?,
        failure: load("screenshot-error.mp3", FAILURE_MP3)?,
    })
}

/// ScreenshotFeedback.prepare + prepareToast (a game started).
pub fn prepare() {
    *IDLE_TOKEN.lock().unwrap_or_else(|e| e.into_inner()) += 1;
    ensure_sounds();
    let position = toast_position(&preferences());
    let _ = slint::invoke_from_event_loop(move || {
        if uses_custom_notifications(&preferences()) {
            if let Some(presenter) = PRESENTER.with(|p| p.borrow().clone()) {
                presenter.keep_warm(&position);
            }
        }
    });
}

fn ensure_sounds() {
    let mut sounds = SOUNDS.lock().unwrap_or_else(|e| e.into_inner());
    if sounds.is_some() || *FAILED.lock().unwrap_or_else(|e| e.into_inner()) {
        return;
    }
    match load_sounds() {
        Some(loaded) => *sounds = Some(loaded),
        None => *FAILED.lock().unwrap_or_else(|e| e.into_inner()) = true,
    }
}

/// ScreenshotFeedback.release (no game runs, or screenshots were turned off).
pub fn release() {
    *IDLE_TOKEN.lock().unwrap_or_else(|e| e.into_inner()) += 1;
    SOUNDS.lock().unwrap_or_else(|e| e.into_inner()).take();
    *FAILED.lock().unwrap_or_else(|e| e.into_inner()) = false;
    let _ = slint::invoke_from_event_loop(|| {
        if let Some(presenter) = PRESENTER.with(|p| p.borrow().clone()) {
            presenter.release_warm();
        }
    });
}

/// scheduleIdleRelease: a sound played with no game running (a deep link)
/// keeps the sounds for 30s.
fn schedule_idle_release() {
    if service().is_some_and(|s| s.has_tracked_games_running()) {
        return;
    }
    let token = {
        let mut token = IDLE_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
        *token += 1;
        *token
    };
    std::thread::spawn(move || {
        std::thread::sleep(IDLE_RELEASE);
        let current = *IDLE_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
        if current == token && !service().is_some_and(|s| s.has_tracked_games_running()) {
            release();
        }
    });
}

fn preferences() -> Map<String, Value> {
    service().map(|s| s.preferences()).unwrap_or_default()
}

fn play(pick: fn(&Sounds) -> &Sound) {
    let prefs = preferences();
    if !hydra_core::screenshots::preferences::resolve(&prefs).capture_sound_enabled {
        return;
    }
    let volume = prefs
        .get("achievementSoundVolume")
        .and_then(Value::as_f64)
        .unwrap_or(DEFAULT_VOLUME) as f32;
    ensure_sounds();
    if let Some(sounds) = SOUNDS.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        sound::play(pick(sounds), volume);
    }
    schedule_idle_release();
}

/// playCaptureSound
pub fn play_capture_sound() {
    play(|s| &s.capture);
}

/// playFailureSound
pub fn play_failure_sound() {
    play(|s| &s.failure);
}

/// usesCustomNotifications
fn uses_custom_notifications(prefs: &Map<String, Value>) -> bool {
    cfg!(windows)
        && prefs
            .get("achievementCustomNotificationsEnabled")
            .and_then(Value::as_bool)
            != Some(false)
}

fn toast_position(prefs: &Map<String, Value>) -> String {
    prefs
        .get("achievementCustomNotificationPosition")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_POSITION)
        .to_string()
}

/// presentToast. UI thread.
fn present(prefs: &Map<String, Value>, toast: ToastContent) {
    if uses_custom_notifications(prefs) {
        if let Some(presenter) = PRESENTER.with(|p| p.borrow().clone()) {
            if presenter.present(&toast_position(prefs), &toast) {
                return;
            }
        }
    }
    crate::notify::show_silent(toast.title, toast.description);
}

/// showToast: captured | saved_locally | share_pending (the last one shows
/// even with toasts turned off).
pub fn show_toast(kind: &'static str, game_title: &str) {
    let prefs = preferences();
    if kind != "share_pending"
        && !hydra_core::screenshots::preferences::resolve(&prefs).toast_enabled
    {
        return;
    }
    let game_title = game_title.to_string();
    let _ = slint::invoke_from_event_loop(move || {
        let title = crate::shell::tr(&format!("screenshots_capture.{kind}"));
        present(
            &prefs,
            ToastContent {
                title,
                description: game_title,
                variant: "screenshot",
            },
        );
    });
}

/// FAILURE_DESCRIPTION_KEYS
fn failure_key(kind: &str) -> &'static str {
    match kind {
        "game_not_recognized" => "capture_error_game_not_recognized",
        "game_not_focused" => "capture_error_game_not_focused",
        "window_capture_failed" => "capture_error_window_capture_failed",
        "blank_frame" => "capture_error_blank_frame",
        "disk_full" => "capture_error_disk_full",
        "file_write_failed" => "capture_error_file_write_failed",
        "save_failed" => "capture_error_save_failed",
        "share_unavailable" => "share_unavailable",
        _ => "capture_error_unexpected",
    }
}

/// showFailureToast
pub fn show_failure_toast(kind: &'static str, game_title: Option<String>) {
    let prefs = preferences();
    let _ = slint::invoke_from_event_loop(move || {
        let game = game_title.unwrap_or_default();
        let toast = ToastContent {
            title: crate::shell::tr("screenshots_capture.capture_failed"),
            description: crate::shell::tr_with(
                &format!("screenshots_capture.{}", failure_key(kind)),
                &[("game", Arg::from(game.as_str()))],
            ),
            variant: "screenshot-error",
        };
        present(&prefs, toast);
    });
}
