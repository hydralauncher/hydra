#![cfg_attr(not(any(target_os = "linux", target_os = "windows")), allow(dead_code))]

mod binding;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(not(any(target_os = "linux", target_os = "windows")))]
mod unsupported;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(not(any(target_os = "linux", target_os = "windows")))]
use unsupported as platform;
#[cfg(target_os = "windows")]
use windows as platform;

use binding::{find_key, gamepad, Backend, HotkeyBinding, InputBinding, TriggerSource};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::Status;
use napi_derive::napi;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};

#[napi(object)]
pub struct ScreenshotInputConfig {
    pub key: String,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub gamepad_enabled: bool,
    pub gamepad_buttons: Vec<String>,
}

#[napi(object)]
pub struct ScreenshotInputEvent {
    pub kind: String,
    pub source: String,
    pub backend: String,
}

#[napi(object)]
pub struct ScreenshotInputNativeStatus {
    pub keyboard_backend: String,
    pub gamepad_backend: String,
    pub keyboard_error: Option<String>,
    pub gamepad_error: Option<String>,
    pub wayland_session: bool,
}

pub type ScreenshotInputCallback =
    ThreadsafeFunction<ScreenshotInputEvent, (), ScreenshotInputEvent, Status, false, true>;

pub struct BackendResult {
    pub backend: Backend,
    pub error: Option<&'static str>,
}

impl BackendResult {
    pub fn active(backend: Backend) -> Self {
        Self {
            backend,
            error: None,
        }
    }

    pub fn unavailable(error: &'static str) -> Self {
        Self {
            backend: Backend::Unavailable,
            error: Some(error),
        }
    }

    pub fn disabled() -> Self {
        Self {
            backend: Backend::Unavailable,
            error: None,
        }
    }
}

pub struct PlatformStatus {
    pub keyboard: BackendResult,
    pub gamepad: BackendResult,
    pub wayland_session: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventKind {
    Trigger,
    Stopped,
}

impl EventKind {
    fn as_str(self) -> &'static str {
        match self {
            EventKind::Trigger => "trigger",
            EventKind::Stopped => "stopped",
        }
    }
}

pub struct Context {
    stopped: AtomicBool,
    binding: RwLock<InputBinding>,
    emit: Box<dyn Fn(EventKind, TriggerSource, Backend) + Send + Sync>,
}

impl Context {
    pub fn new(
        binding: InputBinding,
        emit: Box<dyn Fn(EventKind, TriggerSource, Backend) + Send + Sync>,
    ) -> Self {
        Self {
            stopped: AtomicBool::new(false),
            binding: RwLock::new(binding),
            emit,
        }
    }

    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }

    pub fn binding(&self) -> InputBinding {
        self.binding
            .read()
            .map(|binding| *binding)
            .unwrap_or_default()
    }

    pub fn emit(&self, source: TriggerSource, backend: Backend) {
        if !self.is_stopped() {
            (self.emit)(EventKind::Trigger, source, backend);
        }
    }

    pub fn report_stopped(&self, source: TriggerSource, backend: Backend) {
        if !self.is_stopped() {
            (self.emit)(EventKind::Stopped, source, backend);
        }
    }

    fn set_binding(&self, binding: InputBinding) {
        if let Ok(mut current) = self.binding.write() {
            *current = binding;
        }
    }

    fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
    }
}

#[derive(Clone, Copy)]
pub struct StartOptions {
    pub keyboard: bool,
    pub gamepad: bool,
}

struct ParsedConfig {
    binding: InputBinding,
    options: StartOptions,
    keyboard_error: Option<&'static str>,
    gamepad_error: Option<&'static str>,
}

fn parse_config(config: &ScreenshotInputConfig) -> ParsedConfig {
    let hotkey = find_key(&config.key).map(|key| HotkeyBinding {
        key,
        ctrl: config.ctrl,
        alt: config.alt,
        shift: config.shift,
    });
    let gamepad_mask = gamepad::combo_mask(&config.gamepad_buttons).unwrap_or(0);
    let keyboard = hotkey.is_some();
    let gamepad = config.gamepad_enabled && gamepad_mask != 0;

    ParsedConfig {
        binding: InputBinding {
            hotkey,
            gamepad_mask,
        },
        options: StartOptions { keyboard, gamepad },
        keyboard_error: hotkey.is_none().then_some("unsupported-key"),
        gamepad_error: (config.gamepad_enabled && gamepad_mask == 0).then_some("invalid-combo"),
    }
}

fn to_native_status(status: PlatformStatus, parsed: &ParsedConfig) -> ScreenshotInputNativeStatus {
    ScreenshotInputNativeStatus {
        keyboard_backend: status.keyboard.backend.as_str().to_string(),
        gamepad_backend: status.gamepad.backend.as_str().to_string(),
        keyboard_error: parsed
            .keyboard_error
            .or(status.keyboard.error)
            .map(str::to_string),
        gamepad_error: parsed
            .gamepad_error
            .or(status.gamepad.error)
            .map(str::to_string),
        wayland_session: status.wayland_session,
    }
}

struct Runtime {
    context: Arc<Context>,
    platform: platform::Runtime,
}

impl Runtime {
    fn shutdown(self) {
        self.context.stop();
        self.platform.stop();
    }
}

static RUNTIME: OnceLock<Mutex<Option<Runtime>>> = OnceLock::new();

fn runtime() -> &'static Mutex<Option<Runtime>> {
    RUNTIME.get_or_init(|| Mutex::new(None))
}

#[napi]
pub fn start_screenshot_input(
    config: ScreenshotInputConfig,
    callback: ScreenshotInputCallback,
) -> napi::Result<ScreenshotInputNativeStatus> {
    let mut guard = runtime()
        .lock()
        .map_err(|_| napi::Error::from_reason("Screenshot input lock poisoned"))?;
    if let Some(previous) = guard.take() {
        previous.shutdown();
    }

    let parsed = parse_config(&config);
    let context = Arc::new(Context::new(
        parsed.binding,
        Box::new(move |kind, source, backend| {
            callback.call(
                ScreenshotInputEvent {
                    kind: kind.as_str().to_string(),
                    source: source.as_str().to_string(),
                    backend: backend.as_str().to_string(),
                },
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        }),
    ));
    let (platform_runtime, status) = platform::start(context.clone(), parsed.options);
    *guard = Some(Runtime {
        context,
        platform: platform_runtime,
    });

    Ok(to_native_status(status, &parsed))
}

#[napi]
pub fn update_screenshot_input_binding(config: ScreenshotInputConfig) -> bool {
    let Ok(guard) = runtime().lock() else {
        return false;
    };
    let Some(current) = guard.as_ref() else {
        return false;
    };
    current.context.set_binding(parse_config(&config).binding);
    true
}

#[napi]
pub fn stop_screenshot_input() {
    let previous = runtime().lock().ok().and_then(|mut guard| guard.take());
    if let Some(previous) = previous {
        previous.shutdown();
    }
}

#[napi]
pub fn probe_screenshot_input(config: ScreenshotInputConfig) -> ScreenshotInputNativeStatus {
    let parsed = parse_config(&config);
    to_native_status(platform::probe(parsed.options), &parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(key: &str, buttons: &[&str]) -> ScreenshotInputConfig {
        ScreenshotInputConfig {
            key: key.to_string(),
            ctrl: false,
            alt: true,
            shift: false,
            gamepad_enabled: true,
            gamepad_buttons: buttons.iter().map(|value| value.to_string()).collect(),
        }
    }

    #[test]
    fn parses_valid_config() {
        let parsed = parse_config(&config("F10", &["back", "rb"]));
        let hotkey = parsed.binding.hotkey.unwrap();
        assert_eq!(hotkey.key.name, "F10");
        assert!(hotkey.alt);
        assert_eq!(parsed.binding.gamepad_mask, gamepad::BACK | gamepad::RB);
        assert!(parsed.options.keyboard && parsed.options.gamepad);
        assert!(parsed.keyboard_error.is_none() && parsed.gamepad_error.is_none());
    }

    #[test]
    fn reports_invalid_key_and_combo() {
        let parsed = parse_config(&config("MetaLeft", &["rb"]));
        assert!(!parsed.options.keyboard && !parsed.options.gamepad);
        assert_eq!(parsed.keyboard_error, Some("unsupported-key"));
        assert_eq!(parsed.gamepad_error, Some("invalid-combo"));
    }

    #[test]
    fn disabled_gamepad_reports_no_error() {
        let mut value = config("F10", &[]);
        value.gamepad_enabled = false;
        let parsed = parse_config(&value);
        assert!(parsed.keyboard_error.is_none() && parsed.gamepad_error.is_none());
    }

    #[test]
    fn stopped_context_drops_events() {
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = count.clone();
        let context = Context::new(
            InputBinding::default(),
            Box::new(move |_, _, _| {
                counter.fetch_add(1, Ordering::SeqCst);
            }),
        );
        context.emit(TriggerSource::Keyboard, Backend::Unavailable);
        context.report_stopped(TriggerSource::Keyboard, Backend::Unavailable);
        context.stop();
        context.emit(TriggerSource::Keyboard, Backend::Unavailable);
        context.report_stopped(TriggerSource::Keyboard, Backend::Unavailable);
        assert_eq!(count.load(Ordering::SeqCst), 2);
    }
}
