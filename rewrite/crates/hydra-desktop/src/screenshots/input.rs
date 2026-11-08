//! services/screenshot-input.ts (ScreenshotInputService): the screenshot
//! hotkey and controller combo through native/hydra-native's
//! screenshot_input (Windows Raw Input + XInput, X11 XInput2 / evdev).
//!
//! The backends only run while the SCREENSHOTS flag is on, screenshots are
//! enabled and a tracked game is running. They live in this process (Raw
//! Input sinks on a message-only window, not system-wide hooks), so they end
//! with it. A backend that stops on its own is restarted after 5s, at most 3
//! times (the count resets after a minute of stable running).
//!
//! The Wayland GlobalShortcuts portal (Electron's globalShortcut fallback
//! when no native keyboard backend works on Wayland) is not ported: the
//! status then reports `hotkey_unavailable_wayland`, which is what Electron
//! shows when the portal registration fails.

use std::collections::HashMap;
use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use hydra_capture::screenshot_input::{
    self as native, ScreenshotInputConfig, ScreenshotInputEvent, ScreenshotInputNativeStatus,
};
use hydra_core::screenshots::preferences::{self, Hotkey};
use serde_json::{Map, Value};

use super::capture::TriggerSource;

/// SCREENSHOT_TRIGGER_COOLDOWN_MS
const TRIGGER_COOLDOWN: Duration = Duration::from_millis(500);
/// SCREENSHOT_INPUT_RESTART_DELAY_MS
const RESTART_DELAY: Duration = Duration::from_secs(5);
/// SCREENSHOT_INPUT_MAX_RESTARTS
const MAX_RESTARTS: u32 = 3;
/// SCREENSHOT_INPUT_STABLE_RUN_MS
const STABLE_RUN: Duration = Duration::from_secs(60);

/// ScreenshotInputStatus
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InputStatus {
    pub active: bool,
    /// windows-raw-input | xinput | x11-xinput2 | evdev | global-shortcuts-portal | unavailable
    pub keyboard_backend: &'static str,
    pub gamepad_backend: &'static str,
    /// gamepad_unavailable | hotkey_unavailable | hotkey_unavailable_wayland |
    /// hotkey_portal_unsupported_key | hotkey_xwayland_only
    pub hint: Option<&'static str>,
}

impl InputStatus {
    fn inactive() -> InputStatus {
        InputStatus {
            active: false,
            keyboard_backend: "unavailable",
            gamepad_backend: "unavailable",
            hint: None,
        }
    }
}

/// ScreenshotInputSettings
#[derive(Clone, Debug, PartialEq)]
struct Settings {
    enabled: bool,
    hotkey: Hotkey,
    gamepad_enabled: bool,
    gamepad_combo: Vec<String>,
}

/// getScreenshotInputSettings
fn settings_from(prefs: &Map<String, Value>) -> Settings {
    let resolved = preferences::resolve(prefs);
    Settings {
        enabled: resolved.enabled,
        hotkey: resolved.hotkey,
        gamepad_enabled: resolved.gamepad_enabled,
        gamepad_combo: resolved.gamepad_combo,
    }
}

/// toScreenshotInputNativeConfig
fn native_config(settings: &Settings) -> ScreenshotInputConfig {
    ScreenshotInputConfig {
        key: settings.hotkey.key.clone(),
        ctrl: settings.hotkey.ctrl,
        alt: settings.hotkey.alt,
        shift: settings.hotkey.shift,
        gamepad_enabled: settings.gamepad_enabled,
        gamepad_buttons: settings.gamepad_combo.clone(),
    }
}

/// toBackend
fn backend(value: &str) -> &'static str {
    match value {
        "windows-raw-input" => "windows-raw-input",
        "xinput" => "xinput",
        "x11-xinput2" => "x11-xinput2",
        "evdev" => "evdev",
        "global-shortcuts-portal" => "global-shortcuts-portal",
        _ => "unavailable",
    }
}

/// getScreenshotInputHint
fn hint(status: &ScreenshotInputNativeStatus, gamepad_enabled: bool) -> Option<&'static str> {
    let keyboard = backend(&status.keyboard_backend);
    if keyboard == "unavailable" {
        return Some(if status.wayland_session {
            "hotkey_unavailable_wayland"
        } else {
            "hotkey_unavailable"
        });
    }
    if keyboard == "x11-xinput2" && status.wayland_session {
        return Some("hotkey_xwayland_only");
    }
    if gamepad_enabled
        && (status.gamepad_error.is_some() || backend(&status.gamepad_backend) == "unavailable")
    {
        return Some("gamepad_unavailable");
    }
    None
}

/// toScreenshotInputStatus
fn to_status(
    status: &ScreenshotInputNativeStatus,
    settings: &Settings,
    active: bool,
) -> InputStatus {
    InputStatus {
        active,
        keyboard_backend: backend(&status.keyboard_backend),
        gamepad_backend: backend(&status.gamepad_backend),
        hint: hint(status, settings.gamepad_enabled),
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Channel {
    Input,
    Deeplink,
}

struct State {
    status: InputStatus,
    settings: Settings,
    initialized: bool,
    shutting_down: bool,
    listening: bool,
    generation: u64,
    games_running: bool,
    feature_enabled: bool,
    last_trigger: HashMap<Channel, Instant>,
    restart_attempts: u32,
    listening_since: Option<Instant>,
    /// cancels a pending restart when it changes
    restart_token: u64,
    native_status: Option<ScreenshotInputNativeStatus>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);
/// The native callback only forwards (generation, event) here, so stopping a
/// backend (which joins its thread) never waits on STATE.
static EVENTS: OnceLock<Mutex<Sender<(u64, ScreenshotInputEvent)>>> = OnceLock::new();

fn with_state<T>(f: impl FnOnce(&mut State) -> T) -> T {
    let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let state = guard.get_or_insert_with(|| State {
        status: InputStatus::inactive(),
        settings: settings_from(&Map::new()),
        initialized: false,
        shutting_down: false,
        listening: false,
        generation: 0,
        games_running: false,
        feature_enabled: false,
        last_trigger: HashMap::new(),
        restart_attempts: 0,
        listening_since: None,
        restart_token: 0,
        native_status: None,
    });
    f(state)
}

fn events() -> Sender<(u64, ScreenshotInputEvent)> {
    EVENTS
        .get_or_init(|| {
            let (sender, receiver) = mpsc::channel::<(u64, ScreenshotInputEvent)>();
            std::thread::Builder::new()
                .name("screenshot-input-events".into())
                .spawn(move || {
                    for (generation, event) in receiver {
                        handle_native_event(generation, event);
                    }
                })
                .expect("screenshot input events");
            Mutex::new(sender)
        })
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

fn set_status(state: &mut State, status: InputStatus) {
    if state.status == status {
        return;
    }
    state.status = status.clone();
    super::emit_input_status(status);
}

fn has_tracked_games_running() -> bool {
    super::service().is_some_and(|s| s.has_tracked_games_running())
}

/// ScreenshotInputService.trigger: drops triggers while screenshots are off,
/// with no tracked game, or within 500ms of the previous one (per channel).
pub fn trigger(source: TriggerSource) -> bool {
    let allowed = with_state(|state| {
        if !state.feature_enabled || !state.settings.enabled {
            eprintln!(
                "Screenshot trigger ignored: input disabled ({})",
                source.as_str()
            );
            return false;
        }
        if !has_tracked_games_running() {
            eprintln!(
                "Screenshot trigger ignored: no tracked game running ({})",
                source.as_str()
            );
            return false;
        }
        let channel = if source == TriggerSource::Deeplink {
            Channel::Deeplink
        } else {
            Channel::Input
        };
        let now = Instant::now();
        if let Some(last) = state.last_trigger.get(&channel) {
            if now.duration_since(*last) < TRIGGER_COOLDOWN {
                return false;
            }
        }
        state.last_trigger.insert(channel, now);
        true
    });
    if allowed {
        super::capture::handle_trigger(source);
    }
    allowed
}

/// syncUserPreferences
pub fn sync_user_preferences(prefs: &Map<String, Value>) {
    let settings = settings_from(prefs);
    with_state(|state| {
        let previous = std::mem::replace(&mut state.settings, settings);
        if !state.initialized {
            state.initialized = true;
            state.games_running = has_tracked_games_running();
        }
        reconcile(state, &previous);
    });
}

/// refreshStatus: the probe result when not listening.
pub fn refresh_status() -> InputStatus {
    let refresh_flag = with_state(|state| {
        if state.listening || state.shutting_down {
            return false;
        }
        if !state.feature_enabled {
            set_status(state, InputStatus::inactive());
            return true;
        }
        let probe = native::probe_screenshot_input(native_config(&state.settings));
        let status = with_portal_hotkey_hint(
            to_status(&probe, &state.settings, false),
            &probe,
            &state.settings,
        );
        set_status(state, status);
        false
    });
    if refresh_flag {
        std::thread::spawn(refresh_feature_flag);
    }
    with_state(|state| state.status.clone())
}

/// shouldUsePortalShortcut
fn should_use_portal(status: &ScreenshotInputNativeStatus) -> bool {
    cfg!(target_os = "linux")
        && status.wayland_session
        && backend(&status.keyboard_backend) == "unavailable"
}

/// withPortalHotkeyHint
fn with_portal_hotkey_hint(
    status: InputStatus,
    native: &ScreenshotInputNativeStatus,
    settings: &Settings,
) -> InputStatus {
    if should_use_portal(native) && preferences::to_accelerator(&settings.hotkey).is_none() {
        InputStatus {
            hint: Some("hotkey_portal_unsupported_key"),
            ..status
        }
    } else {
        status
    }
}

/// shutdown (before-quit)
pub fn shutdown() {
    with_state(|state| {
        state.shutting_down = true;
        state.restart_token += 1;
        stop_listening(state);
    });
}

/// handleTrackedGamesRunningChange
pub fn on_tracked_games_running_change() {
    let refresh = with_state(|state| {
        let running = has_tracked_games_running();
        if running == state.games_running {
            return false;
        }
        state.games_running = running;
        let settings = state.settings.clone();
        reconcile(state, &settings);
        running
    });
    if refresh {
        refresh_feature_flag();
    }
}

/// refreshFeatureFlag (blocking: the request runs on this thread)
pub fn refresh_feature_flag() {
    let Some(service) = super::service() else {
        return;
    };
    let enabled = super::feature::refresh(&service);
    apply_feature_flag(enabled);
}

/// applyFeatureFlag
pub fn apply_feature_flag(enabled: bool) {
    with_state(|state| {
        if state.shutting_down || enabled == state.feature_enabled {
            return;
        }
        state.feature_enabled = enabled;
        let settings = state.settings.clone();
        reconcile(state, &settings);
        if !state.listening {
            let probe = native::probe_screenshot_input(native_config(&state.settings));
            let status = if state.feature_enabled {
                with_portal_hotkey_hint(
                    to_status(&probe, &state.settings, false),
                    &probe,
                    &state.settings,
                )
            } else {
                InputStatus::inactive()
            };
            set_status(state, status);
        }
    });
}

fn should_listen(state: &State) -> bool {
    state.initialized
        && !state.shutting_down
        && state.feature_enabled
        && state.settings.enabled
        && state.games_running
}

/// reconcile
fn reconcile(state: &mut State, previous: &Settings) {
    if !should_listen(state) {
        state.restart_token += 1;
        state.restart_attempts = 0;
        stop_listening(state);
        return;
    }
    if !state.listening {
        start_listening(state);
        return;
    }
    if previous.gamepad_enabled != state.settings.gamepad_enabled {
        stop_listening(state);
        start_listening(state);
        return;
    }
    let hotkey_changed = previous.hotkey != state.settings.hotkey;
    if hotkey_changed {
        if let Some(native_status) = state.native_status.as_ref().map(clone_native) {
            apply_listening_status(state, &native_status);
        }
    }
    if hotkey_changed
        || !preferences::same_gamepad_combo(&previous.gamepad_combo, &state.settings.gamepad_combo)
    {
        native::update_screenshot_input_binding(native_config(&state.settings));
    }
}

fn start_listening(state: &mut State) {
    state.generation += 1;
    let generation = state.generation;
    let sender = events();
    let result = native::start_screenshot_input_with(
        &native_config(&state.settings),
        Box::new(move |event| {
            let _ = sender.send((generation, event));
        }),
    );
    match result {
        Ok(native_status) => {
            state.listening = true;
            state.listening_since = Some(Instant::now());
            state.native_status = Some(clone_native(&native_status));
            let status = apply_listening_status(state, &native_status);
            eprintln!(
                "Screenshot input started: keyboard {} gamepad {} hint {:?} (keyboard error {:?}, gamepad error {:?})",
                status.keyboard_backend,
                status.gamepad_backend,
                status.hint,
                native_status.keyboard_error,
                native_status.gamepad_error
            );
        }
        Err(error) => {
            eprintln!("Failed to start screenshot input: {error}");
            state.listening = false;
            set_status(
                state,
                InputStatus {
                    hint: Some("hotkey_unavailable"),
                    ..InputStatus::inactive()
                },
            );
        }
    }
}

fn clone_native(status: &ScreenshotInputNativeStatus) -> ScreenshotInputNativeStatus {
    ScreenshotInputNativeStatus {
        keyboard_backend: status.keyboard_backend.clone(),
        gamepad_backend: status.gamepad_backend.clone(),
        keyboard_error: status.keyboard_error.clone(),
        gamepad_error: status.gamepad_error.clone(),
        wayland_session: status.wayland_session,
    }
}

/// applyListeningStatus (without the portal shortcut, see the module docs)
fn apply_listening_status(
    state: &mut State,
    native_status: &ScreenshotInputNativeStatus,
) -> InputStatus {
    let status = with_portal_hotkey_hint(
        to_status(native_status, &state.settings, true),
        native_status,
        &state.settings,
    );
    set_status(state, status.clone());
    status
}

fn stop_listening(state: &mut State) {
    if !state.listening {
        return;
    }
    state.listening = false;
    state.native_status = None;
    native::stop_screenshot_input();
    eprintln!("Screenshot input stopped");
    let status = InputStatus {
        active: false,
        ..state.status.clone()
    };
    set_status(state, status);
}

/// handleNativeEvent
fn handle_native_event(generation: u64, event: ScreenshotInputEvent) {
    let source = with_state(|state| {
        if !state.listening || generation != state.generation {
            return None;
        }
        if event.kind == "stopped" {
            handle_backend_stopped(state, &event);
            return None;
        }
        match event.source.as_str() {
            "keyboard" => Some(TriggerSource::Keyboard),
            "gamepad" => Some(TriggerSource::Gamepad),
            _ => None,
        }
    });
    if let Some(source) = source {
        trigger(source);
    }
}

/// handleBackendStopped: restart after 5s, at most 3 times.
fn handle_backend_stopped(state: &mut State, event: &ScreenshotInputEvent) {
    if state
        .listening_since
        .is_some_and(|since| since.elapsed() >= STABLE_RUN)
    {
        state.restart_attempts = 0;
    }
    eprintln!(
        "Screenshot input backend stopped unexpectedly ({} {}), restarts so far {}",
        event.source, event.backend, state.restart_attempts
    );
    stop_listening(state);
    let probe = native::probe_screenshot_input(native_config(&state.settings));
    let status = with_portal_hotkey_hint(
        to_status(&probe, &state.settings, false),
        &probe,
        &state.settings,
    );
    set_status(state, status);
    if state.restart_attempts >= MAX_RESTARTS {
        return;
    }
    state.restart_attempts += 1;
    state.restart_token += 1;
    let token = state.restart_token;
    std::thread::spawn(move || {
        std::thread::sleep(RESTART_DELAY);
        with_state(|state| {
            if state.restart_token != token {
                return;
            }
            let settings = state.settings.clone();
            reconcile(state, &settings);
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn native(keyboard: &str, gamepad: &str, wayland: bool) -> ScreenshotInputNativeStatus {
        ScreenshotInputNativeStatus {
            keyboard_backend: keyboard.into(),
            gamepad_backend: gamepad.into(),
            keyboard_error: None,
            gamepad_error: None,
            wayland_session: wayland,
        }
    }

    #[test]
    fn hints_match_electron() {
        assert_eq!(
            hint(&native("unavailable", "xinput", false), true),
            Some("hotkey_unavailable")
        );
        assert_eq!(
            hint(&native("unavailable", "evdev", true), true),
            Some("hotkey_unavailable_wayland")
        );
        assert_eq!(
            hint(&native("x11-xinput2", "evdev", true), true),
            Some("hotkey_xwayland_only")
        );
        assert_eq!(
            hint(&native("windows-raw-input", "unavailable", false), true),
            Some("gamepad_unavailable")
        );
        assert_eq!(
            hint(&native("windows-raw-input", "unavailable", false), false),
            None
        );
        assert_eq!(
            hint(&native("windows-raw-input", "xinput", false), true),
            None
        );
        assert_eq!(backend("something"), "unavailable");
    }
}
