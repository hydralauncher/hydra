//! Raw Input backend for Sony controllers, and the watcher thread itself.
//!
//! Sony pads do not appear through XInput, but they do publish standard HID
//! input reports, so a Raw Input sink can read the PS/Home bit without ever
//! opening the device exclusively. That property matters: opening a HID device
//! with `CreateFile` and `ReadFile` would take it away from the game the user is
//! playing, whereas `RIDEV_INPUTSINK` only *observes* the input stream and lets
//! it continue to every other consumer.
//!
//! The sink is registered for the standard game-controller usages plus the
//! vendor-defined page. Registering the whole HID page (`0x01`/`0x00`) is
//! rejected with `ERROR_INVALID_PARAMETER`, so concrete usages are required.
//!
//! The window is a hidden top-level window rather than a message-only window:
//! message-only windows are not a reliable target for `RIDEV_INPUTSINK`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{Mutex, OnceLock};

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Input::{
    GetRawInputData, GetRawInputDeviceInfoW, RegisterRawInputDevices, HRAWINPUT, RAWINPUT,
    RAWINPUTDEVICE, RIDEV_DEVNOTIFY, RIDEV_INPUTSINK, RIDI_DEVICENAME, RID_INPUT, RIM_TYPEHID,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, MsgWaitForMultipleObjects,
    PeekMessageW, PostMessageW, RegisterClassW, TranslateMessage, UnregisterClassW, MSG, PM_REMOVE,
    QS_ALLINPUT, WM_APP, WM_INPUT, WM_INPUT_DEVICE_CHANGE, WNDCLASSW, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_POPUP,
};

use super::sony;
use super::{
    is_stop_requested, mark_device_disconnected, push_event, upsert_device, POLL_INTERVAL_MS,
};

const BACKEND: &str = "raw-input";

/// Posted to the watcher window to break it out of its message wait.
const WM_GUIDE_WAKE: u32 = WM_APP + 0x51;

/// Largest HID input report we will copy. Reports above this are ignored rather
/// than truncated.
const MAX_REPORT_BYTES: usize = 1024;

/// `GIDC_ARRIVAL`
const GIDC_ARRIVAL: usize = 1;

static WINDOW: AtomicIsize = AtomicIsize::new(0);

/// A buffer aligned for `RAWINPUT`, so the header can be read from it directly.
#[repr(align(8))]
struct AlignedReportBuffer([u8; MAX_REPORT_BYTES]);

#[derive(Clone, Copy, PartialEq, Eq)]
struct Identity {
    vid: u16,
    pid: u16,
    family: sony::Family,
}

struct DeviceState {
    name: String,
    identity: Identity,
    pressed: bool,
    primed: bool,
    emitted_press: bool,
}

fn devices() -> &'static Mutex<HashMap<isize, DeviceState>> {
    static DEVICES: OnceLock<Mutex<HashMap<isize, DeviceState>>> = OnceLock::new();
    DEVICES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The device interface path is a stable, unique hardware id, so it is used as
/// the identity Hydra reasons about. It is not the same thing as the `hDevice`
/// handle, which is only valid while the device is connected.
fn device_key(name: &str) -> String {
    name.to_ascii_lowercase()
}

fn read_device_name(handle: isize) -> Option<String> {
    let mut size = 0u32;
    let probe = unsafe {
        GetRawInputDeviceInfoW(
            handle as *mut _,
            RIDI_DEVICENAME,
            std::ptr::null_mut(),
            &mut size,
        )
    };

    if probe == u32::MAX || size == 0 {
        return None;
    }

    let mut buffer = vec![0u16; size as usize];
    let written = unsafe {
        GetRawInputDeviceInfoW(
            handle as *mut _,
            RIDI_DEVICENAME,
            buffer.as_mut_ptr() as *mut _,
            &mut size,
        )
    };

    if written == u32::MAX || written == 0 {
        return None;
    }

    let length = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..length]))
}

/// Extract `VID_xxxx` / `PID_xxxx` from a device interface path.
///
/// The path looks like
/// `\\?\HID#VID_054C&PID_0CE6#7&1234abcd&0&0000#{4d1e55b2-...}`.
fn parse_vid_pid(name: &str) -> Option<(u16, u16)> {
    let upper = name.to_ascii_uppercase();

    let vid = parse_hex_after(&upper, "VID_")?;
    let pid = parse_hex_after(&upper, "PID_")?;

    Some((vid, pid))
}

fn parse_hex_after(haystack: &str, needle: &str) -> Option<u16> {
    let start = haystack.find(needle)? + needle.len();
    let digits = haystack.get(start..start + 4)?;

    u16::from_str_radix(digits, 16).ok()
}

/// Classify a device, or `None` when it is not one we can decode.
fn identify(name: &str) -> Option<(String, Identity)> {
    let (vid, pid) = parse_vid_pid(name)?;
    let (family, _) = sony::identify(vid, pid)?;

    Some((device_key(name), Identity { vid, pid, family }))
}

fn announce_arrival(handle: isize) {
    let Some(name) = read_device_name(handle) else {
        return;
    };

    let Some((key, identity)) = identify(&name) else {
        return;
    };

    let Some((_, product)) = sony::identify(identity.vid, identity.pid) else {
        return;
    };

    if let Ok(mut map) = devices().lock() {
        // The map is keyed by the transient `hDevice` handle, but a device can be
        // re-announced on reconnect; the stable identity is the interface path.
        if map.values().any(|state| device_key(&state.name) == key) {
            return;
        }

        map.insert(
            handle,
            DeviceState {
                name: name.clone(),
                identity,
                pressed: false,
                primed: false,
                emitted_press: false,
            },
        );
    }

    upsert_device(&key, product, BACKEND, identity.vid, identity.pid, true);
    push_event(
        "connected",
        BACKEND,
        &key,
        product,
        identity.vid,
        identity.pid,
    );
}

fn announce_removal(handle: isize) {
    let removed = devices()
        .lock()
        .ok()
        .and_then(|mut map| map.remove(&handle));

    let Some(state) = removed else {
        return;
    };

    let key = device_key(&state.name);
    let product = sony::identify(state.identity.vid, state.identity.pid)
        .map(|(_, name)| name)
        .unwrap_or("Sony controller");

    if state.emitted_press {
        push_event(
            "guide-released",
            BACKEND,
            &key,
            product,
            state.identity.vid,
            state.identity.pid,
        );
    }

    push_event(
        "disconnected",
        BACKEND,
        &key,
        product,
        state.identity.vid,
        state.identity.pid,
    );
    mark_device_disconnected(&key);

    let _ = state;
}

/// Decode one HID input report for an already-classified device.
fn handle_report(handle: isize, report: &[u8]) {
    let mut map = match devices().lock() {
        Ok(map) => map,
        Err(_) => return,
    };

    let Some(state) = map.get_mut(&handle) else {
        return;
    };

    let Some(layout) = sony::locate(
        report.first().copied().unwrap_or(0),
        state.identity.family,
        report.len(),
    ) else {
        // Not a state report we understand; leave the device untouched rather than
        // guessing at an offset.
        return;
    };

    let Some(pressed) = sony::ps_pressed(report, layout) else {
        return;
    };

    let key = device_key(&state.name);
    let (vid, pid) = (state.identity.vid, state.identity.pid);
    let product = sony::identify(vid, pid)
        .map(|(_, name)| name)
        .unwrap_or("Sony controller");

    if !state.primed {
        // The first report only establishes a baseline. A pad that is plugged in
        // while PS is already held therefore does not fire an action.
        state.primed = true;
        state.pressed = pressed;
        return;
    }

    if pressed == state.pressed {
        return;
    }

    state.pressed = pressed;

    if pressed {
        if state.emitted_press {
            return;
        }
        state.emitted_press = true;
        drop(map);
        push_event("guide-pressed", BACKEND, &key, product, vid, pid);
        return;
    }

    if state.emitted_press {
        state.emitted_press = false;
        drop(map);
        push_event("guide-released", BACKEND, &key, product, vid, pid);
    }
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_INPUT => {
            handle_raw_input(lparam as HRAWINPUT);
            0
        }
        WM_INPUT_DEVICE_CHANGE => {
            let handle = lparam as isize;

            if wparam == GIDC_ARRIVAL {
                announce_arrival(handle);
            } else {
                announce_removal(handle);
            }

            0
        }
        _ => unsafe { DefWindowProcW(window, message, wparam, lparam) },
    }
}

fn handle_raw_input(raw_handle: HRAWINPUT) {
    let mut size = 0u32;
    let header_size = std::mem::size_of::<windows_sys::Win32::UI::Input::RAWINPUTHEADER>() as u32;

    let probe = unsafe {
        GetRawInputData(
            raw_handle,
            RID_INPUT,
            std::ptr::null_mut(),
            &mut size,
            header_size,
        )
    };

    if probe == u32::MAX || size == 0 || size as usize > MAX_REPORT_BYTES {
        return;
    }

    let mut buffer = AlignedReportBuffer([0u8; MAX_REPORT_BYTES]);
    let mut size = size;

    let written = unsafe {
        GetRawInputData(
            raw_handle,
            RID_INPUT,
            buffer.0.as_mut_ptr() as *mut _,
            &mut size,
            header_size,
        )
    };

    if written == u32::MAX || written == 0 {
        return;
    }

    let raw = unsafe { &*(buffer.0.as_ptr() as *const RAWINPUT) };

    if raw.header.dwType != RIM_TYPEHID {
        return;
    }

    let hid = unsafe { &raw.data.hid };
    let count = (hid.dwSizeHid as usize).min(MAX_REPORT_BYTES);

    if count == 0 {
        return;
    }

    let report = unsafe { std::slice::from_raw_parts(hid.bRawData.as_ptr(), count) };
    handle_report(raw.header.hDevice as isize, report);
}

fn register_sink(window: HWND) -> bool {
    // `0x01`/`0x00` (the whole HID page) is rejected with
    // ERROR_INVALID_PARAMETER, so concrete usages are registered instead:
    // Joystick, Game Pad, Multi-axis Controller and the vendor-defined page.
    let devices = [
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x04,
            dwFlags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY,
            hwndTarget: window,
        },
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x05,
            dwFlags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY,
            hwndTarget: window,
        },
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x08,
            dwFlags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY,
            hwndTarget: window,
        },
        RAWINPUTDEVICE {
            usUsagePage: 0xFF00,
            usUsage: 0x01,
            dwFlags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY,
            hwndTarget: window,
        },
    ];

    let registered = unsafe {
        RegisterRawInputDevices(
            devices.as_ptr(),
            devices.len() as u32,
            std::mem::size_of::<RAWINPUTDEVICE>() as u32,
        )
    };

    registered != 0
}

/// Nudge the watcher thread so a stop request is acted on immediately.
pub(crate) fn wake() {
    let window = WINDOW.load(Ordering::Acquire);

    if window != 0 {
        unsafe {
            PostMessageW(window as HWND, WM_GUIDE_WAKE, 0, 0);
        }
    }
}

/// Entry point of the single watcher thread.
///
/// `ready` receives `true` once the Raw Input sink can actually deliver input,
/// or `false` when initialisation failed. The starter blocks on it so that
/// "started" is never reported for a watcher that cannot observe anything.
pub(crate) fn watcher_thread(ready: std::sync::mpsc::Sender<bool>) {
    let mut xinput_backend = super::xinput::Backend::new();
    // When ordinal 100 is missing there is nothing to poll, so the four syscalls
    // per tick are skipped entirely rather than thrown away.
    let poll_xinput = super::xinput::is_available();

    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let class_name: Vec<u16> = "HydraGlobalGuideSink\0".encode_utf16().collect();
        let title: Vec<u16> = "Hydra global guide sink\0".encode_utf16().collect();

        let window_class = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(window_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: std::ptr::null_mut(),
            hCursor: std::ptr::null_mut(),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name.as_ptr(),
        };

        RegisterClassW(&window_class);

        // Invisible, out of the taskbar and unable to take focus, but still a real
        // top-level window so Raw Input can target it.
        let window = CreateWindowExW(
            WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            class_name.as_ptr(),
            title.as_ptr(),
            WS_POPUP,
            0,
            0,
            0,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance,
            std::ptr::null_mut(),
        );

        if window.is_null() {
            let _ = ready.send(false);
            super::mark_watcher_stopped();
            return;
        }

        WINDOW.store(window as isize, Ordering::Release);

        if !register_sink(window) {
            // Without the sink the window would exist but never deliver a single
            // report, which is exactly the silent failure this guards against.
            WINDOW.store(0, Ordering::Release);
            DestroyWindow(window);
            UnregisterClassW(class_name.as_ptr(), instance);
            let _ = ready.send(false);
            super::mark_watcher_stopped();
            return;
        }

        let _ = ready.send(true);

        let mut message: MSG = std::mem::zeroed();

        while !is_stop_requested() {
            while PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }

            if is_stop_requested() {
                break;
            }

            // Poll XInput on the same cadence as the message wait, then block until
            // either a message arrives or the interval elapses.
            if poll_xinput {
                xinput_backend.poll();
            }

            MsgWaitForMultipleObjects(0, std::ptr::null(), 0, POLL_INTERVAL_MS, QS_ALLINPUT);
        }

        WINDOW.store(0, Ordering::Release);
        DestroyWindow(window);
        UnregisterClassW(class_name.as_ptr(), instance);
    }

    if let Ok(mut map) = devices().lock() {
        map.clear();
    }

    // If the loop ever ends on its own, `is_guide_watcher_running` must stop
    // claiming that input is being observed.
    super::mark_watcher_stopped();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_vid_and_pid_from_a_device_interface_path() {
        let path =
            r"\\?\HID#VID_054C&PID_0CE6#7&1a2b3c4d&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}";
        assert_eq!(parse_vid_pid(path), Some((0x054C, 0x0CE6)));
    }

    #[test]
    fn lower_case_paths_are_accepted() {
        assert_eq!(
            parse_vid_pid(r"hid#vid_054c&pid_09cc#x"),
            Some((0x054C, 0x09CC))
        );
    }

    #[test]
    fn rejects_paths_without_ids() {
        assert_eq!(parse_vid_pid(r"\\?\ROOT#SYSTEM#0000"), None);
        assert_eq!(parse_vid_pid("VID_054C"), None);
        assert_eq!(parse_vid_pid("VID_ZZZZ&PID_0CE6"), None);
    }

    #[test]
    fn identifies_only_sony_devices() {
        let sony = r"\\?\HID#VID_054C&PID_0CE6#a";
        let xbox = r"\\?\HID#VID_045E&PID_0B13#a";

        assert!(identify(sony).is_some());
        assert!(
            identify(xbox).is_none(),
            "Xbox pads are not a Raw Input source"
        );
    }

    #[test]
    fn device_key_is_case_insensitive() {
        assert_eq!(device_key(r"HID#VID_054C"), device_key(r"hid#vid_054c"));
    }
}
