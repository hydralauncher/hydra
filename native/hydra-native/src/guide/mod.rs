//! Global Guide / PS ("Home") button detection.
//!
//! This module watches for the controller system button — Guide on Xbox pads,
//! PS/Home on Sony pads — **globally**, i.e. while Hydra is in the background
//! and even when another application holds the foreground.
//!
//! # Design
//!
//! Detection is split by backend and normalised into a single edge stream:
//!
//! | backend    | how the system button is read                                    |
//! |------------|------------------------------------------------------------------|
//! | `xinput`   | `XInputGetStateEx` (ordinal 100), `wButtons & 0x0400`            |
//! | `raw-input`| a `RIDEV_INPUTSINK` Raw Input sink, decoding Sony HID reports    |
//!
//! The two backends are *not* deduplicated against each other here; they emit
//! what they see and the JavaScript layer arbitrates. See
//! `src/main/services/guide/guide-arbitration.ts`.
//!
//! # Why `XInputGetStateEx`
//!
//! The documented `XInputGetState` never reports the Guide bit. Windows exposes
//! an exported-but-undocumented variant at ordinal 100 in `xinput1_4.dll` /
//! `xinput1_3.dll` whose `XINPUT_STATE` does carry `XINPUT_GAMEPAD_GUIDE`
//! (`0x0400`). The ordinal is resolved dynamically so the addon still loads on
//! machines where it is missing.
//!
//! # Threading
//!
//! `start_guide_watcher` spawns exactly one thread. That thread owns the Raw
//! Input window (a window and its message queue are thread-affine) and also
//! polls XInput on the same cadence, so there is no separate poller thread.
//! Normalised edges go into a bounded queue that the JavaScript side drains
//! with `poll_guide_events`.
//!
//! # Platform support
//!
//! Only Windows can observe the system button without consuming it. On other
//! platforms every entry point exists but reports "unsupported", so callers do
//! not need platform branches.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use napi_derive::napi;

// Only the Windows Raw Input backend decodes Sony reports, so on other platforms
// this module has no caller. It is still compiled there, because the report
// layouts are portable hardware facts and their unit tests are worth running
// everywhere.
#[cfg_attr(not(windows), allow(dead_code))]
pub mod sony;

#[cfg(windows)]
mod raw_input;
#[cfg(windows)]
mod xinput;

mod foreground;

pub use foreground::bring_window_to_foreground;

/// Upper bound on queued edges. The JavaScript side drains this every few
/// milliseconds; the cap only exists so a stalled consumer cannot grow the
/// queue without bound.
const MAX_QUEUED_EVENTS: usize = 512;

/// How often the watcher thread wakes up. Also the worst-case latency of an
/// XInput edge, and the worst-case delay before queued `WM_INPUT` messages are
/// drained.
#[cfg(windows)]
pub(crate) const POLL_INTERVAL_MS: u32 = 16;

/// One normalised button edge or device transition.
///
/// `kind` is one of `guide-pressed`, `guide-released`, `connected`,
/// `disconnected`.
#[napi(object)]
#[derive(Clone)]
pub struct GuideEvent {
    pub kind: String,
    pub backend: String,
    pub device_id: String,
    pub device_name: String,
    pub vid: u32,
    pub pid: u32,
    /// Milliseconds on a monotonic clock owned by this addon, so callers can
    /// order and time edges without depending on wall-clock time.
    pub timestamp_ms: f64,
}

/// A controller the watcher currently knows about, for diagnostics.
#[napi(object)]
#[derive(Clone)]
pub struct GuideDevice {
    pub device_id: String,
    pub device_name: String,
    pub backend: String,
    pub vid: u32,
    pub pid: u32,
    pub connected: bool,
}

pub(crate) struct DeviceRecord {
    pub device_id: String,
    pub device_name: String,
    pub backend: &'static str,
    pub vid: u16,
    pub pid: u16,
    pub connected: bool,
}

/// Monotonic clock. The origin is set on the first call, which
/// `start_guide_watcher` performs, so timestamps are stable for the lifetime of
/// the process and immune to system clock changes.
static CLOCK_ORIGIN: OnceLock<Instant> = OnceLock::new();

pub(crate) fn now_ms() -> f64 {
    CLOCK_ORIGIN
        .get_or_init(Instant::now)
        .elapsed()
        .as_secs_f64()
        * 1000.0
}

fn events() -> &'static Mutex<VecDeque<GuideEvent>> {
    static EVENTS: OnceLock<Mutex<VecDeque<GuideEvent>>> = OnceLock::new();
    EVENTS.get_or_init(|| Mutex::new(VecDeque::new()))
}

fn devices() -> &'static Mutex<Vec<DeviceRecord>> {
    static DEVICES: OnceLock<Mutex<Vec<DeviceRecord>>> = OnceLock::new();
    DEVICES.get_or_init(|| Mutex::new(Vec::new()))
}

static RUNNING: AtomicBool = AtomicBool::new(false);
static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

pub(crate) fn is_stop_requested() -> bool {
    STOP_REQUESTED.load(Ordering::Acquire)
}

pub(crate) fn push_event(
    kind: &str,
    backend: &'static str,
    device_id: &str,
    device_name: &str,
    vid: u16,
    pid: u16,
) {
    let event = GuideEvent {
        kind: kind.to_string(),
        backend: backend.to_string(),
        device_id: device_id.to_string(),
        device_name: device_name.to_string(),
        vid: vid as u32,
        pid: pid as u32,
        timestamp_ms: now_ms(),
    };

    if let Ok(mut queue) = events().lock() {
        if queue.len() >= MAX_QUEUED_EVENTS {
            queue.pop_front();
        }
        queue.push_back(event);
    }
}

/// Remember a device so `describe_guide_devices` can report it, preserving the
/// first name we learned for it.
pub(crate) fn upsert_device(
    device_id: &str,
    device_name: &str,
    backend: &'static str,
    vid: u16,
    pid: u16,
    connected: bool,
) {
    if let Ok(mut list) = devices().lock() {
        if let Some(existing) = list.iter_mut().find(|d| d.device_id == device_id) {
            existing.connected = connected;
            existing.vid = vid;
            existing.pid = pid;
            if !device_name.is_empty() {
                existing.device_name = device_name.to_string();
            }
            return;
        }

        list.push(DeviceRecord {
            device_id: device_id.to_string(),
            device_name: device_name.to_string(),
            backend,
            vid,
            pid,
            connected,
        });
    }
}

pub(crate) fn mark_device_disconnected(device_id: &str) {
    if let Ok(mut list) = devices().lock() {
        if let Some(existing) = list.iter_mut().find(|d| d.device_id == device_id) {
            existing.connected = false;
        }
    }
}

fn clear_state() {
    if let Ok(mut queue) = events().lock() {
        queue.clear();
    }
    if let Ok(mut list) = devices().lock() {
        list.clear();
    }
}

/// Whether this build can observe the system button at all.
#[napi]
pub fn is_guide_watcher_supported() -> bool {
    cfg!(windows)
}

#[napi]
pub fn is_guide_watcher_running() -> bool {
    RUNNING.load(Ordering::Acquire)
}

/// Start watching. Returns `false` when the platform cannot support it or the
/// watcher thread could not be created. Calling this while already running is a
/// no-op that returns `true`.
#[napi]
pub fn start_guide_watcher() -> bool {
    if RUNNING.load(Ordering::Acquire) {
        return true;
    }

    // Fix the clock origin before any edge can be timestamped.
    now_ms();
    clear_state();
    STOP_REQUESTED.store(false, Ordering::Release);

    #[cfg(windows)]
    {
        match std::thread::Builder::new()
            .name("hydra-guide-watcher".to_string())
            .spawn(raw_input::watcher_thread)
        {
            Ok(handle) => {
                if let Ok(mut slot) = WATCHER_HANDLE.lock() {
                    *slot = Some(handle);
                }
                RUNNING.store(true, Ordering::Release);
                true
            }
            Err(_) => false,
        }
    }

    #[cfg(not(windows))]
    {
        false
    }
}

/// Stop watching and wait for the thread to finish, so a subsequent start
/// cannot race with a half-torn-down Raw Input window.
#[napi]
pub fn stop_guide_watcher() -> bool {
    if !RUNNING.load(Ordering::Acquire) {
        return true;
    }

    STOP_REQUESTED.store(true, Ordering::Release);

    // The watcher thread may be blocked waiting for messages, so nudge its
    // message queue rather than waiting out a full poll interval.
    #[cfg(windows)]
    raw_input::wake();

    let handle = WATCHER_HANDLE.lock().ok().and_then(|mut slot| slot.take());
    if let Some(handle) = handle {
        let _ = handle.join();
    }

    RUNNING.store(false, Ordering::Release);
    if let Ok(mut list) = devices().lock() {
        for device in list.iter_mut() {
            device.connected = false;
        }
    }

    true
}

/// Drain every edge queued since the previous call.
#[napi]
pub fn poll_guide_events() -> Vec<GuideEvent> {
    match events().lock() {
        Ok(mut queue) => queue.drain(..).collect(),
        Err(_) => Vec::new(),
    }
}

/// Controllers seen since the watcher started, for diagnostics.
#[napi]
pub fn describe_guide_devices() -> Vec<GuideDevice> {
    match devices().lock() {
        Ok(list) => list
            .iter()
            .map(|device| GuideDevice {
                device_id: device.device_id.clone(),
                device_name: device.device_name.clone(),
                backend: device.backend.to_string(),
                vid: device.vid as u32,
                pid: device.pid as u32,
                connected: device.connected,
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

static WATCHER_HANDLE: Mutex<Option<std::thread::JoinHandle<()>>> = Mutex::new(None);
