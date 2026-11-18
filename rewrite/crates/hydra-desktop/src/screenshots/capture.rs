//! screenshots/screenshot-capture-service.ts: one trigger, one screenshot.
//!
//! The capture runs on its own thread; a trigger that arrives while one is
//! in progress is dropped. Saving (file, preview, record, toast) is queued
//! on a second thread so the next capture doesn't wait for the disk.
//!
//! Frames, in Electron's order: desktop duplication of the monitor a
//! fullscreen/borderless game covers, then the game window itself (Windows
//! Graphics Capture with the client area cropped; X11 on Linux). The
//! Wayland screen-share portal session (linux-game-capture-session.ts) is
//! not ported: on a Wayland session the game's XWayland window is captured
//! when one can be found, else the capture fails with `share_unavailable`.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use hydra_capture::foreground::{ForegroundWindow, is_wayland_session};
use hydra_capture::window_capture::{self, CaptureError};
use hydra_capture::{EncodedScreenshot, Frame};
use hydra_core::screenshots::{
    LocalScreenshot, ScreenshotPreferences, paths, preferences::CUSTOM_GAME_TITLE_MAX_LENGTH,
    root_marker,
};

use super::foreground::{self, Lookup};
use super::{Service, feedback, service};

/// ScreenshotTriggerSource
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TriggerSource {
    Keyboard,
    Gamepad,
    Portal,
    Deeplink,
}

impl TriggerSource {
    pub fn as_str(self) -> &'static str {
        match self {
            TriggerSource::Keyboard => "keyboard",
            TriggerSource::Gamepad => "gamepad",
            TriggerSource::Portal => "portal",
            TriggerSource::Deeplink => "deeplink",
        }
    }
}

/// CAPTURE_JPEG_QUALITY (0.95) and the preview (1280px wide, 0.85)
const JPEG_QUALITY: u8 = 95;
const PREVIEW_MAX_WIDTH: u32 = 1280;
const PREVIEW_QUALITY: u8 = 85;
const MAX_FILE_NAME_SUFFIX: u32 = 50;

/// captureInProgress
static IN_PROGRESS: AtomicBool = AtomicBool::new(false);
static CAPTURES: OnceLock<Mutex<Sender<(TriggerSource, Instant)>>> = OnceLock::new();
type SaveJob = Box<dyn FnOnce() + Send>;
/// pendingSaves: saves run one after another
static SAVES: OnceLock<Mutex<Sender<SaveJob>>> = OnceLock::new();
/// gameSessionIds: one id per game run, shared by its screenshots
static SESSIONS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn worker<T: Send + 'static>(
    slot: &'static OnceLock<Mutex<Sender<T>>>,
    name: &str,
    run: impl Fn(T) + Send + 'static,
) -> Sender<T> {
    slot.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<T>();
        std::thread::Builder::new()
            .name(name.into())
            .spawn(move || {
                for item in receiver {
                    run(item);
                }
            })
            .expect("screenshot worker");
        Mutex::new(sender)
    })
    .lock()
    .unwrap_or_else(|e| e.into_inner())
    .clone()
}

/// handleScreenshotTrigger
pub fn handle_trigger(source: TriggerSource) {
    eprintln!("Screenshot trigger received ({})", source.as_str());
    if IN_PROGRESS.swap(true, Ordering::SeqCst) {
        eprintln!("Screenshot hotkey ignored: capture in progress");
        return;
    }
    let sender = worker(&CAPTURES, "screenshot-capture", |(source, started)| {
        let save = service().and_then(|service| grab_screenshot(&service, source, started));
        IN_PROGRESS.store(false, Ordering::SeqCst);
        if let Some(save) = save {
            let _ = worker(&SAVES, "screenshot-save", |job: SaveJob| job()).send(save);
        }
    });
    if sender.send((source, Instant::now())).is_err() {
        IN_PROGRESS.store(false, Ordering::SeqCst);
    }
}

/// clearScreenshotGameSession
pub fn clear_game_session(game_key: &str) {
    if let Some(map) = SESSIONS.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        map.remove(game_key);
    }
}

fn game_session_id(game_key: &str) -> String {
    SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_with(HashMap::new)
        .entry(game_key.to_string())
        .or_insert_with(|| uuid::Uuid::new_v4().to_string())
        .clone()
}

/// createCaptureTimer: logged stage times.
struct Timer {
    started: Instant,
    marks: Vec<(&'static str, u128)>,
}

impl Timer {
    fn mark(&mut self, stage: &'static str) {
        self.marks.push((stage, self.started.elapsed().as_millis()));
    }
    fn flush(&self, game_key: &str, source: TriggerSource) {
        let marks: Vec<String> = self
            .marks
            .iter()
            .map(|(s, ms)| format!("{s}={ms}"))
            .collect();
        eprintln!(
            "Screenshot capture timings in ms ({game_key}, {}): {}",
            source.as_str(),
            marks.join(" ")
        );
    }
}

/// getUnresolvedGameFailure → toast
fn report_unresolved(
    service: &Service,
    source: TriggerSource,
    candidates: &[foreground::Candidate],
    window: Option<&ForegroundWindow>,
    toast_enabled: bool,
) {
    let failure = foreground::unresolved_failure(source, candidates, window);
    if !candidates.is_empty() {
        service.record("capture", "ignored", Some("no_foreground_game"));
    }
    if let (Some((kind, title)), true) = (failure, toast_enabled) {
        show_failure(kind, title);
    }
}

fn show_failure(kind: &'static str, game_title: Option<String>) {
    feedback::show_failure_toast(kind, game_title);
    feedback::play_failure_sound();
}

/// grabScreenshot: everything up to the encoded JPEG; the returned job saves it.
fn grab_screenshot(service: &Service, source: TriggerSource, started: Instant) -> Option<SaveJob> {
    let mut timer = Timer {
        started,
        marks: Vec::new(),
    };
    let preferences = service.resolved();
    if !preferences.enabled {
        eprintln!("Screenshot hotkey ignored: screenshots disabled");
        return None;
    }
    if !super::feature::is_enabled(service) {
        eprintln!("Screenshot hotkey ignored: feature flag off");
        return None;
    }
    timer.mark("checks");
    let lookup = foreground::resolve(service, source);
    timer.mark("foreground");
    match lookup {
        Lookup::Unresolved {
            candidates,
            foreground,
        } => {
            report_unresolved(
                service,
                source,
                &candidates,
                foreground.as_ref(),
                preferences.toast_enabled,
            );
            None
        }
        Lookup::Resolved {
            target,
            game,
            foreground,
        } => {
            let title = game
                .as_ref()
                .and_then(|g| g.get("title"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or(&target.title)
                .to_string();
            grab_resolved(
                service,
                source,
                &preferences,
                timer,
                target,
                title,
                foreground,
            )
        }
    }
}

/// What the capture is of (GameScreenshotCaptureTarget).
pub struct WindowTarget<'a> {
    pub game_key: &'a str,
    pub process_id: Option<u32>,
    pub executable_paths: &'a [String],
    pub wine_prefix_path: Option<&'a str>,
    pub window_handle: Option<&'a str>,
    pub x11_window_id: Option<&'a str>,
}

/// A frame failure: (stage error, failure kind)
fn frame_failure_kind(error: &CaptureError) -> &'static str {
    match error {
        CaptureError::Blank => "blank_frame",
        CaptureError::Failed(_) => "window_capture_failed",
    }
}

/// The foreground window, if it belongs to the game (resolveGameCaptureSourceId).
fn foreground_game_window(target: &WindowTarget) -> Option<ForegroundWindow> {
    let window = hydra_capture::foreground::foreground_window()?;
    let pid = window.process_id?;
    let processes = foreground::processes();
    let belongs = if cfg!(windows) {
        hydra_core::screenshots::matching::is_windows_game_foreground_process(
            &processes,
            pid,
            target.process_id,
            target.executable_paths,
        )
    } else {
        hydra_core::screenshots::matching::is_linux_game_window_process(
            &processes,
            pid,
            target.process_id,
            target.executable_paths,
            target.wine_prefix_path,
        )
    };
    belongs.then_some(window)
}

/// acquireFrame
pub fn acquire_frame(target: &WindowTarget) -> Result<Frame, CaptureError> {
    #[cfg(windows)]
    {
        if let Some(handle) = target.window_handle {
            if let Some(frame) = window_capture::desktop_duplication_frame(handle) {
                return Ok(frame);
            }
            match window_capture::capture_window(handle, true) {
                Ok(frame) => return Ok(frame),
                Err(CaptureError::Blank) => return Err(CaptureError::Blank),
                Err(error) => {
                    eprintln!(
                        "Direct window capture failed, resolving the window source: {error} ({})",
                        target.game_key
                    );
                }
            }
        }
        // resolveWindowsGameWindowSourceWithRetry: 3 attempts, 100ms apart
        for attempt in 1..=3 {
            if let Some(handle) = foreground_game_window(target).and_then(|w| w.window_handle) {
                return window_capture::capture_window(&handle, true);
            }
            if attempt < 3 {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
        Err(CaptureError::Failed(
            "Tracked game does not own the foreground window".into(),
        ))
    }
    #[cfg(not(windows))]
    {
        let window = match target.x11_window_id {
            Some(id) => Some(id.to_string()),
            None => foreground_game_window(target).and_then(|w| w.window_id),
        };
        match window {
            Some(window) => window_capture::capture_window(&window, true),
            None => Err(CaptureError::Failed(
                "Tracked game does not own the active X11 window".into(),
            )),
        }
    }
}

fn is_disk_full(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::StorageFull
        || matches!(error.raw_os_error(), Some(112 | 39)) // ERROR_DISK_FULL, ERROR_HANDLE_DISK_FULL
        || (cfg!(unix) && matches!(error.raw_os_error(), Some(28 | 122))) // ENOSPC, EDQUOT
}

fn save_failure_kind(error: &std::io::Error, fallback: &'static str) -> &'static str {
    if is_disk_full(error) {
        "disk_full"
    } else {
        fallback
    }
}

#[allow(clippy::too_many_arguments)]
fn grab_resolved(
    service: &Service,
    source: TriggerSource,
    preferences: &ScreenshotPreferences,
    mut timer: Timer,
    target: hydra_core::screenshots::matching::GameTarget,
    game_title: String,
    foreground: Option<ForegroundWindow>,
) -> Option<SaveJob> {
    let captured_at = super::now_ms();
    let owner_id = service.owner_id();

    // recordCaptureFailure: `${stage}_${error.name}`
    let fail = |stage: &str, message: &str, error_name: &str, kind: &'static str| {
        eprintln!(
            "Failed to capture a manual screenshot ({}, {stage}): {message}",
            target.game_key
        );
        service.record("capture", "failed", Some(&format!("{stage}_{error_name}")));
        show_failure(kind, Some(game_title.clone()));
    };

    let window_target = WindowTarget {
        game_key: &target.game_key,
        process_id: target.process_id,
        executable_paths: &target.executable_paths,
        wine_prefix_path: target.wine_prefix_path.as_deref(),
        window_handle: foreground.as_ref().and_then(|f| f.window_handle.as_deref()),
        x11_window_id: foreground.as_ref().and_then(|f| f.window_id.as_deref()),
    };
    let frame = if is_wayland_session() && window_target.x11_window_id.is_none() {
        // no portal session (see the module docs): an XWayland window of the game
        match xwayland_window(&window_target) {
            Some(window) => window_capture::capture_window(&window, true),
            None => {
                eprintln!(
                    "Screenshot capture: no XWayland window for {}",
                    target.game_key
                );
                service.record("capture", "ignored", Some("share_failed"));
                show_failure("share_unavailable", Some(game_title.clone()));
                return None;
            }
        }
    } else {
        acquire_frame(&window_target)
    };
    let frame = match frame {
        Ok(frame) => frame,
        Err(error) => {
            let name = match error {
                CaptureError::Blank => "BlankScreenshotFrameError",
                CaptureError::Failed(_) => "Error",
            };
            fail(
                "frame",
                &error.to_string(),
                name,
                frame_failure_kind(&error),
            );
            return None;
        }
    };
    timer.mark("frame");

    feedback::play_capture_sound();
    timer.mark("sound");

    let (width, height) = (frame.width, frame.height);
    let images = match hydra_capture::encode_bgra_screenshot(
        &frame.pixels,
        width,
        height,
        JPEG_QUALITY,
        PREVIEW_MAX_WIDTH,
        PREVIEW_QUALITY,
    ) {
        Ok(images) => images,
        Err(error) => {
            fail("encode", &error, "Error", "save_failed");
            return None;
        }
    };
    drop(frame);
    timer.mark("encoded");

    let default_visibility = preferences.default_visibility.clone();
    let Some(service) = super::service() else {
        return None;
    };
    Some(Box::new(move || {
        save(
            &service,
            SaveRequest {
                target,
                game_title,
                captured_at,
                width,
                height,
                default_visibility,
                source,
                owner_id,
                images,
            },
            timer,
        );
    }))
}

struct SaveRequest {
    target: hydra_core::screenshots::matching::GameTarget,
    game_title: String,
    captured_at: i64,
    width: u32,
    height: u32,
    default_visibility: String,
    source: TriggerSource,
    owner_id: Option<String>,
    images: EncodedScreenshot,
}

/// writeNewScreenshotFile: never overwrite; a partial file is removed.
fn write_new_file(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    if let Err(error) = file.write_all(data).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

/// writeScreenshotToAvailablePath: suffixes 0..=50, then a UUID.
fn write_to_available_path(
    root: &Path,
    game_title: &str,
    captured_at: i64,
    data: &[u8],
) -> std::io::Result<PathBuf> {
    let mut suffixes: Vec<String> = (0..=MAX_FILE_NAME_SUFFIX).map(|n| n.to_string()).collect();
    suffixes.push(uuid::Uuid::new_v4().to_string());
    let mut last_error = None;
    for suffix in suffixes {
        let path = paths::manual_screenshot_path(root, game_title, captured_at, Some(&suffix));
        match write_new_file(&path, data) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                last_error = Some(error)
            }
            Err(error) => return Err(error),
        }
    }
    Err(last_error.unwrap_or_else(|| std::io::Error::other("no free file name")))
}

/// saveCaptureFile: the first screenshots folder that works.
fn save_capture_file(game_title: &str, captured_at: i64, data: &[u8]) -> std::io::Result<PathBuf> {
    let mut last_error = None;
    for root in super::screenshot_folder_candidates() {
        let attempt = (|| {
            let first = paths::manual_screenshot_path(&root, game_title, captured_at, None);
            if let Some(parent) = first.parent() {
                std::fs::create_dir_all(parent)?;
            }
            write_to_available_path(&root, game_title, captured_at, data)
        })();
        match attempt {
            Ok(path) => return Ok(path),
            Err(error) => {
                eprintln!("Failed to save a screenshot to {}: {error}", root.display());
                last_error = Some(error);
            }
        }
    }
    Err(last_error.unwrap_or_else(|| std::io::Error::other("no screenshots folder")))
}

/// <userData>/screenshot-previews
fn previews_directory() -> PathBuf {
    hydra_db::paths::native_user_data()
        .unwrap_or_else(std::env::temp_dir)
        .join("screenshot-previews")
}

/// writeScreenshotPreview
fn write_preview(preview: &[u8]) -> std::io::Result<PathBuf> {
    let directory = previews_directory();
    std::fs::create_dir_all(&directory)?;
    let path = directory.join(format!("{}.jpeg", uuid::Uuid::new_v4()));
    std::fs::write(&path, preview)?;
    Ok(path)
}

/// removeScreenshotPreview
pub fn remove_preview(path: Option<&str>) {
    if let Some(path) = path.filter(|p| !p.is_empty()) {
        let _ = std::fs::remove_file(path);
    }
}

/// getDefaultCustomGameTitle
fn default_custom_title(shop: &str, game_title: &str) -> Option<String> {
    if shop != "custom" {
        return None;
    }
    let trimmed = game_title.trim();
    let cut =
        hydra_core::screenshots::preferences::truncate_utf16(trimmed, CUSTOM_GAME_TITLE_MAX_LENGTH);
    (!cut.is_empty()).then(|| cut.to_string())
}

fn save(service: &Service, request: SaveRequest, mut timer: Timer) {
    let SaveRequest {
        target,
        game_title,
        captured_at,
        width,
        height,
        default_visibility,
        source,
        owner_id,
        images,
    } = request;
    let fail = |stage: &str, message: String, kind: &'static str| {
        eprintln!(
            "Failed to capture a manual screenshot ({}, {stage}): {message}",
            target.game_key
        );
        // Node file system errors are named "Error"
        service.record("capture", "failed", Some(&format!("{stage}_Error")));
        show_failure(kind, Some(game_title.clone()));
    };

    let file_path = match save_capture_file(&game_title, captured_at, &images.jpeg) {
        Ok(path) => path,
        Err(error) => {
            fail(
                "write",
                error.to_string(),
                save_failure_kind(&error, "file_write_failed"),
            );
            return;
        }
    };
    let preview_path = match write_preview(&images.preview) {
        Ok(path) => Some(path.to_string_lossy().into_owned()),
        Err(error) => {
            eprintln!("Failed to write the screenshot preview: {error}");
            None
        }
    };
    timer.mark("written");

    let root = paths::screenshots_root(&file_path);
    let screenshot = LocalScreenshot {
        client_id: uuid::Uuid::new_v4().to_string(),
        owner_id: owner_id.clone(),
        shop: target.shop.clone(),
        object_id: Some(target.object_id.clone()).filter(|id| !id.is_empty()),
        custom_game_title: default_custom_title(&target.shop, &game_title),
        game_title: game_title.clone(),
        path: file_path.to_string_lossy().into_owned(),
        captured_at,
        width,
        height,
        state: "local".into(),
        is_spoiler: false,
        visibility: default_visibility,
        game_session_id: Some(game_session_id(&target.game_key)),
        root_marker_id: root_marker::ensure_root_marker_id(&root),
        preview_path: preview_path.clone(),
        ..Default::default()
    };
    if let Err(error) = service.store.put(screenshot) {
        fail("store", error, "save_failed");
        // discardUnrecordedCapture
        let _ = std::fs::remove_file(&file_path);
        remove_preview(preview_path.as_deref());
        return;
    }
    service.record("capture", "saved", Some(source.as_str()));
    // showCapturedToast
    feedback::show_toast(
        if owner_id.is_some() {
            "captured"
        } else {
            "saved_locally"
        },
        &game_title,
    );
    timer.mark("saved");
    timer.flush(&target.game_key, source);
}

/// An X11 (XWayland) window that belongs to the game, for Wayland sessions.
fn xwayland_window(target: &WindowTarget) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let processes = foreground::processes();
        let owned: std::collections::HashSet<u32> = processes
            .iter()
            .filter(|p| {
                hydra_core::screenshots::matching::is_linux_game_window_process(
                    &processes,
                    p.pid,
                    target.process_id,
                    target.executable_paths,
                    target.wine_prefix_path,
                )
            })
            .map(|p| p.pid)
            .collect();
        hydra_capture::window_capture::find_x11_window(&owned)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = target;
        None
    }
}
