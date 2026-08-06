use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};
use std::{cmp::Ordering, collections::HashMap};

#[cfg(target_os = "windows")]
use std::mem::{size_of, zeroed};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use std::ptr::{null, null_mut};
#[cfg(any(target_os = "windows", target_os = "linux"))]
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering as AtomicOrdering};
#[cfg(any(target_os = "windows", target_os = "linux"))]
use std::sync::mpsc;
#[cfg(target_os = "windows")]
use std::sync::{Mutex, OnceLock};
#[cfg(any(target_os = "windows", target_os = "linux"))]
use std::thread;
#[cfg(any(target_os = "windows", target_os = "linux"))]
use std::time::{Duration, Instant};

use image::codecs::gif::{GifDecoder, GifEncoder, Repeat};
use image::codecs::png::PngDecoder;
use image::codecs::webp::WebPDecoder;
use image::imageops::{crop_imm, resize, FilterType};
use image::{AnimationDecoder, Frame, ImageFormat, ImageReader, ImageResult, RgbaImage};
use napi::bindgen_prelude::Error;
use napi_derive::napi;
use sysinfo::{ProcessesToUpdate, System};
use uuid::Uuid;

#[cfg(target_os = "windows")]
use windows_sys::core::BOOL;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RID_INPUT, RIM_TYPEKEYBOARD,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, EnumWindows, GetClientRect,
    GetForegroundWindow, GetMessageW, GetWindow, GetWindowLongW, GetWindowThreadProcessId,
    IsIconic, IsWindowVisible, RegisterClassW, SetForegroundWindow, SetWindowPos, ShowWindow,
    TranslateMessage, GWL_EXSTYLE, GW_OWNER, HWND_MESSAGE, HWND_TOPMOST, MSG, SWP_NOACTIVATE,
    SWP_SHOWWINDOW, SW_RESTORE, WM_APP, WM_INPUT, WNDCLASSW, WS_EX_TOOLWINDOW,
};

#[cfg(target_os = "windows")]
const BROKER_EVENT_MESSAGE: u32 = WM_APP + 42;

#[cfg(target_os = "windows")]
static RAW_INPUT_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static SHIFT_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static TAB_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static COMBO_LATCHED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static POLLED_COMBO_LATCHED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_KEYBOARD_EVENTS: AtomicU32 = AtomicU32::new(0);
#[cfg(target_os = "windows")]
static LAST_SHORTCUT_EVENT: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

#[cfg(target_os = "linux")]
static LINUX_INPUT_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "linux")]
static LINUX_INPUT_ENABLED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "linux")]
static LINUX_KEYBOARD_AVAILABLE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "linux")]
static LINUX_SHORTCUT_AVAILABLE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "linux")]
static LINUX_OVERLAY_KEYBOARD_EVENTS: AtomicU32 = AtomicU32::new(0);
#[cfg(target_os = "linux")]
static LINUX_GAMEPAD_BUTTONS: AtomicU32 = AtomicU32::new(0);

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Default)]
struct XInputGamepad {
    buttons: u16,
    left_trigger: u8,
    right_trigger: u8,
    thumb_lx: i16,
    thumb_ly: i16,
    thumb_rx: i16,
    thumb_ry: i16,
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Default)]
struct XInputState {
    packet_number: u32,
    gamepad: XInputGamepad,
}

#[cfg(target_os = "windows")]
#[link(name = "Xinput9_1_0")]
extern "system" {
    fn XInputGetState(user_index: u32, state: *mut XInputState) -> u32;
}

#[napi]
pub fn start_overlay_keyboard_watcher() -> bool {
    #[cfg(target_os = "windows")]
    {
        if RAW_INPUT_STARTED.swap(true, AtomicOrdering::AcqRel) {
            return true;
        }

        let (sender, receiver) = mpsc::sync_channel(1);
        thread::spawn(move || run_raw_input_thread(sender));
        let started = receiver
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap_or(false);
        if !started {
            RAW_INPUT_STARTED.store(false, AtomicOrdering::Release);
        }
        started
    }

    #[cfg(target_os = "linux")]
    {
        LINUX_INPUT_ENABLED.store(true, AtomicOrdering::Release);
        if LINUX_INPUT_STARTED.swap(true, AtomicOrdering::AcqRel) {
            return LINUX_KEYBOARD_AVAILABLE.load(AtomicOrdering::Acquire)
                || LINUX_SHORTCUT_AVAILABLE.load(AtomicOrdering::Acquire);
        }

        let (sender, receiver) = mpsc::sync_channel(1);
        thread::spawn(move || run_linux_input_thread(sender));
        let evdev_available = receiver
            .recv_timeout(Duration::from_secs(2))
            .unwrap_or(false);
        let x11_available = start_linux_x11_shortcut_watcher();
        LINUX_SHORTCUT_AVAILABLE.store(x11_available, AtomicOrdering::Release);
        x11_available || evdev_available
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    false
}

#[napi]
pub fn stop_overlay_keyboard_watcher() -> bool {
    #[cfg(target_os = "linux")]
    {
        LINUX_INPUT_ENABLED.store(false, AtomicOrdering::Release);
        LINUX_GAMEPAD_BUTTONS.store(0, AtomicOrdering::Release);
    }
    true
}

#[napi]
pub fn get_overlay_keyboard_event_count() -> u32 {
    #[cfg(target_os = "windows")]
    {
        poll_overlay_combo();
        OVERLAY_KEYBOARD_EVENTS.load(AtomicOrdering::Acquire)
    }

    #[cfg(target_os = "linux")]
    {
        LINUX_OVERLAY_KEYBOARD_EVENTS.load(AtomicOrdering::Acquire)
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    0
}

#[cfg(target_os = "linux")]
struct LinuxInputDevice {
    path: PathBuf,
    device: evdev::Device,
    keyboard: bool,
    shift: bool,
    tab: bool,
    gamepad_buttons: u32,
}

#[cfg(target_os = "linux")]
fn discover_linux_input_devices(devices: &mut Vec<LinuxInputDevice>) -> bool {
    use evdev::KeyCode;

    let mut keyboard_available = devices.iter().any(|entry| entry.keyboard);
    for (path, device) in evdev::enumerate() {
        if devices.iter().any(|entry| entry.path == path) {
            continue;
        }
        let Some(keys) = device.supported_keys() else {
            continue;
        };
        let keyboard = keys.contains(KeyCode::KEY_TAB)
            && (keys.contains(KeyCode::KEY_LEFTSHIFT) || keys.contains(KeyCode::KEY_RIGHTSHIFT));
        let gamepad = keys.contains(KeyCode::BTN_START)
            || keys.contains(KeyCode::BTN_SELECT)
            || keys.contains(KeyCode::BTN_SOUTH);
        if !keyboard && !gamepad {
            continue;
        }
        if device.set_nonblocking(true).is_err() {
            continue;
        }
        keyboard_available |= keyboard;
        devices.push(LinuxInputDevice {
            path,
            device,
            keyboard,
            shift: false,
            tab: false,
            gamepad_buttons: 0,
        });
    }
    keyboard_available
}

#[cfg(target_os = "linux")]
fn linux_gamepad_mask(key: evdev::KeyCode) -> u32 {
    use evdev::KeyCode;

    match key {
        KeyCode::BTN_DPAD_UP => 0x0001,
        KeyCode::BTN_DPAD_DOWN => 0x0002,
        KeyCode::BTN_DPAD_LEFT => 0x0004,
        KeyCode::BTN_DPAD_RIGHT => 0x0008,
        KeyCode::BTN_START => 0x0010,
        KeyCode::BTN_SELECT => 0x0020,
        KeyCode::BTN_TL => 0x0100,
        KeyCode::BTN_TR => 0x0200,
        KeyCode::BTN_SOUTH => 0x1000,
        KeyCode::BTN_EAST => 0x2000,
        _ => 0,
    }
}

#[cfg(target_os = "linux")]
fn update_linux_input_device(entry: &mut LinuxInputDevice) -> bool {
    use evdev::{AbsoluteAxisCode, EventSummary, KeyCode};

    let events = match entry.device.fetch_events() {
        Ok(events) => events.collect::<Vec<_>>(),
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return true,
        Err(_) => return false,
    };
    for event in events {
        match event.destructure() {
            EventSummary::Key(_, key, value) => {
                let pressed = value != 0;
                match key {
                    KeyCode::KEY_LEFTSHIFT | KeyCode::KEY_RIGHTSHIFT => entry.shift = pressed,
                    KeyCode::KEY_TAB => entry.tab = pressed,
                    _ => {
                        let mask = linux_gamepad_mask(key);
                        if pressed {
                            entry.gamepad_buttons |= mask;
                        } else {
                            entry.gamepad_buttons &= !mask;
                        }
                    }
                }
            }
            EventSummary::AbsoluteAxis(_, AbsoluteAxisCode::ABS_HAT0X, value) => {
                entry.gamepad_buttons &= !(0x0004 | 0x0008);
                if value < 0 {
                    entry.gamepad_buttons |= 0x0004;
                } else if value > 0 {
                    entry.gamepad_buttons |= 0x0008;
                }
            }
            EventSummary::AbsoluteAxis(_, AbsoluteAxisCode::ABS_HAT0Y, value) => {
                entry.gamepad_buttons &= !(0x0001 | 0x0002);
                if value < 0 {
                    entry.gamepad_buttons |= 0x0001;
                } else if value > 0 {
                    entry.gamepad_buttons |= 0x0002;
                }
            }
            _ => {}
        }
    }
    true
}

#[cfg(target_os = "linux")]
fn run_linux_input_thread(sender: mpsc::SyncSender<bool>) {
    let mut devices = Vec::new();
    let keyboard_available = discover_linux_input_devices(&mut devices);
    LINUX_KEYBOARD_AVAILABLE.store(keyboard_available, AtomicOrdering::Release);
    let _ = sender.send(keyboard_available);
    let mut keyboard_latched = false;
    let mut last_discovery = Instant::now();

    loop {
        devices.retain_mut(update_linux_input_device);
        let keyboard_active = devices
            .iter()
            .any(|entry| entry.keyboard && entry.shift && entry.tab);
        let enabled = LINUX_INPUT_ENABLED.load(AtomicOrdering::Acquire);
        if enabled && keyboard_active && !keyboard_latched {
            LINUX_OVERLAY_KEYBOARD_EVENTS.fetch_add(1, AtomicOrdering::AcqRel);
        }
        keyboard_latched = keyboard_active;
        let gamepad_buttons = devices
            .iter()
            .fold(0, |buttons, entry| buttons | entry.gamepad_buttons);
        LINUX_GAMEPAD_BUTTONS.store(
            if enabled { gamepad_buttons } else { 0 },
            AtomicOrdering::Release,
        );

        if last_discovery.elapsed() >= Duration::from_secs(2) {
            let keyboard_available = discover_linux_input_devices(&mut devices);
            LINUX_KEYBOARD_AVAILABLE.store(keyboard_available, AtomicOrdering::Release);
            last_discovery = Instant::now();
        }
        thread::sleep(Duration::from_millis(8));
    }
}

#[cfg(target_os = "linux")]
fn start_linux_x11_shortcut_watcher() -> bool {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{ConnectionExt as _, GrabMode, ModMask};
    use x11rb::protocol::Event;

    const TAB_KEYSYM: u32 = 0xff09;
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let Ok((connection, screen_number)) = x11rb::connect(None) else {
            let _ = sender.send(false);
            return;
        };
        let setup = connection.setup();
        let minimum = setup.min_keycode;
        let count = setup.max_keycode.saturating_sub(minimum) + 1;
        let Ok(mapping) = connection.get_keyboard_mapping(minimum, count) else {
            let _ = sender.send(false);
            return;
        };
        let Ok(mapping) = mapping.reply() else {
            let _ = sender.send(false);
            return;
        };
        let keysyms_per_keycode = usize::from(mapping.keysyms_per_keycode);
        if keysyms_per_keycode == 0 {
            let _ = sender.send(false);
            return;
        }
        let tab_keycode = mapping
            .keysyms
            .chunks(keysyms_per_keycode)
            .position(|keysyms| keysyms.contains(&TAB_KEYSYM))
            .and_then(|index| u8::try_from(usize::from(minimum) + index).ok());
        let Some(tab_keycode) = tab_keycode else {
            let _ = sender.send(false);
            return;
        };
        let root = setup.roots[screen_number].root;
        let modifiers = [
            ModMask::SHIFT,
            ModMask::SHIFT | ModMask::LOCK,
            ModMask::SHIFT | ModMask::M2,
            ModMask::SHIFT | ModMask::LOCK | ModMask::M2,
        ];
        let mut grabbed = false;
        let mut reported = false;
        let mut last_grab_attempt = Instant::now() - Duration::from_secs(2);
        loop {
            let enabled = LINUX_INPUT_ENABLED.load(AtomicOrdering::Acquire);
            if enabled && !grabbed && last_grab_attempt.elapsed() >= Duration::from_secs(2) {
                last_grab_attempt = Instant::now();
                let mut success = true;
                for modifier in modifiers {
                    let success_for_modifier = connection
                        .grab_key(
                            false,
                            root,
                            modifier,
                            tab_keycode,
                            GrabMode::ASYNC,
                            GrabMode::ASYNC,
                        )
                        .ok()
                        .is_some_and(|cookie| cookie.check().is_ok());
                    if !success_for_modifier {
                        success = false;
                        break;
                    }
                }
                if success {
                    success = connection.flush().is_ok();
                }
                if !success {
                    for modifier in modifiers {
                        let _ = connection.ungrab_key(tab_keycode, root, modifier);
                    }
                    let _ = connection.flush();
                }
                grabbed = success;
                LINUX_SHORTCUT_AVAILABLE.store(success, AtomicOrdering::Release);
                if !reported {
                    let _ = sender.send(success);
                    reported = true;
                }
            } else if !enabled && grabbed {
                for modifier in modifiers {
                    let _ = connection.ungrab_key(tab_keycode, root, modifier);
                }
                let _ = connection.flush();
                grabbed = false;
                LINUX_SHORTCUT_AVAILABLE.store(false, AtomicOrdering::Release);
            }

            match connection.poll_for_event() {
                Ok(Some(Event::KeyPress(event)))
                    if enabled && grabbed && event.detail == tab_keycode =>
                {
                    LINUX_OVERLAY_KEYBOARD_EVENTS.fetch_add(1, AtomicOrdering::AcqRel);
                }
                Ok(_) => {}
                Err(_) => {
                    LINUX_SHORTCUT_AVAILABLE.store(false, AtomicOrdering::Release);
                    if !reported {
                        let _ = sender.send(false);
                    }
                    return;
                }
            }
            thread::sleep(Duration::from_millis(8));
        }
    });
    receiver
        .recv_timeout(Duration::from_secs(2))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn record_overlay_shortcut() {
    let now = Instant::now();
    let last_event = LAST_SHORTCUT_EVENT.get_or_init(|| Mutex::new(None));
    if let Ok(mut last_event) = last_event.lock() {
        if last_event
            .as_ref()
            .is_some_and(|last| now.duration_since(*last) < Duration::from_millis(250))
        {
            return;
        }
        *last_event = Some(now);
    }
    OVERLAY_KEYBOARD_EVENTS.fetch_add(1, AtomicOrdering::AcqRel);
}

#[cfg(target_os = "windows")]
fn poll_overlay_combo() {
    let shift_down = unsafe { GetAsyncKeyState(0x10) } as u16 & 0x8000 != 0;
    let tab_down = unsafe { GetAsyncKeyState(0x09) } as u16 & 0x8000 != 0;
    let active = shift_down && tab_down;

    if active && !POLLED_COMBO_LATCHED.swap(true, AtomicOrdering::AcqRel) {
        record_overlay_shortcut();
    } else if !active {
        POLLED_COMBO_LATCHED.store(false, AtomicOrdering::Release);
    }
}

#[cfg(target_os = "windows")]
fn update_overlay_combo(virtual_key: u16, pressed: bool) {
    match virtual_key {
        0x10 | 0xA0 | 0xA1 => SHIFT_DOWN.store(pressed, AtomicOrdering::Release),
        0x09 => TAB_DOWN.store(pressed, AtomicOrdering::Release),
        _ => return,
    }

    let active = SHIFT_DOWN.load(AtomicOrdering::Acquire) && TAB_DOWN.load(AtomicOrdering::Acquire);
    if active && !COMBO_LATCHED.swap(true, AtomicOrdering::AcqRel) {
        record_overlay_shortcut();
    } else if !active {
        COMBO_LATCHED.store(false, AtomicOrdering::Release);
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn raw_input_window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == BROKER_EVENT_MESSAGE {
        record_overlay_shortcut();
        return 0;
    }

    if message == WM_INPUT {
        let mut input: RAWINPUT = unsafe { zeroed() };
        let mut size = size_of::<RAWINPUT>() as u32;
        let result = unsafe {
            GetRawInputData(
                lparam as HRAWINPUT,
                RID_INPUT,
                &mut input as *mut RAWINPUT as *mut _,
                &mut size,
                size_of::<RAWINPUTHEADER>() as u32,
            )
        };
        if result != u32::MAX && result > 0 && input.header.dwType == RIM_TYPEKEYBOARD {
            let keyboard = unsafe { input.data.keyboard };
            update_overlay_combo(keyboard.VKey, keyboard.Flags & 1 == 0);
        }
    }

    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}

#[cfg(target_os = "windows")]
fn run_raw_input_thread(sender: mpsc::SyncSender<bool>) {
    unsafe {
        let instance = GetModuleHandleW(null());
        let class_name: Vec<u16> = "HydraOverlayRawInput\0".encode_utf16().collect();
        let window_class = WNDCLASSW {
            lpfnWndProc: Some(raw_input_window_proc),
            hInstance: instance,
            lpszClassName: class_name.as_ptr(),
            ..zeroed()
        };

        if RegisterClassW(&window_class) == 0 {
            let _ = sender.send(false);
            return;
        }

        let window = CreateWindowExW(
            0,
            class_name.as_ptr(),
            class_name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            null_mut(),
            instance,
            null(),
        );
        if window.is_null() {
            let _ = sender.send(false);
            return;
        }

        let keyboard = RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x06,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: window,
        };
        if RegisterRawInputDevices(&keyboard, 1, size_of::<RAWINPUTDEVICE>() as u32) == 0 {
            let _ = sender.send(false);
            return;
        }

        let _ = sender.send(true);
        let mut message: MSG = zeroed();
        while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

#[napi]
pub fn start_overlay_input_broker() -> bool {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(windows_system_executable("schtasks.exe"))
            .args(["/Run", "/TN", "Hydra Overlay Input"])
            .creation_flags(0x0800_0000)
            .status()
            .is_ok_and(|status| status.success())
    }
    #[cfg(not(target_os = "windows"))]
    false
}

#[napi]
pub fn stop_overlay_input_broker() -> bool {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(windows_system_executable("schtasks.exe"))
            .args(["/End", "/TN", "Hydra Overlay Input"])
            .creation_flags(0x0800_0000)
            .status()
            .is_ok_and(|status| status.success())
    }
    #[cfg(not(target_os = "windows"))]
    false
}

#[cfg(target_os = "windows")]
fn windows_system_executable(name: &str) -> PathBuf {
    let mut buffer = [0_u16; 260];
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if length > 0 && length < buffer.len() {
        return PathBuf::from(String::from_utf16_lossy(&buffer[..length])).join(name);
    }
    PathBuf::from(r"C:\Windows\System32").join(name)
}

#[napi(object)]
pub struct NativeWindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[cfg(target_os = "linux")]
struct LinuxProcessWindow {
    connection: x11rb::rust_connection::RustConnection,
    root: u32,
    window: u32,
    bounds: NativeWindowBounds,
}

#[cfg(target_os = "linux")]
fn linux_process_window(pid: u32) -> Option<LinuxProcessWindow> {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, MapState};

    let (connection, _) = x11rb::connect(None).ok()?;
    let pid_atom = connection
        .intern_atom(false, b"_NET_WM_PID")
        .ok()?
        .reply()
        .ok()?
        .atom;
    let client_list_atom = connection
        .intern_atom(false, b"_NET_CLIENT_LIST_STACKING")
        .ok()?
        .reply()
        .ok()?
        .atom;
    let mut best: Option<(u32, u32, NativeWindowBounds, i64)> = None;

    for screen in &connection.setup().roots {
        let root = screen.root;
        let clients = connection
            .get_property(false, root, client_list_atom, AtomEnum::WINDOW, 0, u32::MAX)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .and_then(|reply| reply.value32().map(Iterator::collect::<Vec<_>>))
            .filter(|windows| !windows.is_empty())
            .or_else(|| {
                connection
                    .query_tree(root)
                    .ok()
                    .and_then(|cookie| cookie.reply().ok())
                    .map(|reply| reply.children)
            })
            .unwrap_or_default();

        for window in clients {
            let window_pid = connection
                .get_property(false, window, pid_atom, AtomEnum::CARDINAL, 0, 1)
                .ok()
                .and_then(|cookie| cookie.reply().ok())
                .and_then(|reply| reply.value32()?.next());
            if window_pid != Some(pid) {
                continue;
            }
            let attributes = connection
                .get_window_attributes(window)
                .ok()
                .and_then(|cookie| cookie.reply().ok());
            if attributes.as_ref().map(|value| value.map_state) != Some(MapState::VIEWABLE) {
                continue;
            }
            let Some(geometry) = connection
                .get_geometry(window)
                .ok()
                .and_then(|cookie| cookie.reply().ok())
            else {
                continue;
            };
            let Some(origin) = connection
                .translate_coordinates(window, root, 0, 0)
                .ok()
                .and_then(|cookie| cookie.reply().ok())
            else {
                continue;
            };
            let bounds = NativeWindowBounds {
                x: i32::from(origin.dst_x),
                y: i32::from(origin.dst_y),
                width: i32::from(geometry.width),
                height: i32::from(geometry.height),
            };
            let area = i64::from(bounds.width) * i64::from(bounds.height);
            if area > best.as_ref().map(|entry| entry.3).unwrap_or(0) {
                best = Some((root, window, bounds, area));
            }
        }
    }

    best.map(|(root, window, bounds, _)| LinuxProcessWindow {
        connection,
        root,
        window,
        bounds,
    })
}

#[cfg(target_os = "windows")]
struct WindowSearch {
    pid: u32,
    window: HWND,
    bounds: RECT,
    area: i64,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn find_process_window(window: HWND, parameter: LPARAM) -> BOOL {
    let search = unsafe { &mut *(parameter as *mut WindowSearch) };
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    if pid != search.pid || unsafe { IsWindowVisible(window) } == 0 {
        return 1;
    }
    if unsafe { GetWindowLongW(window, GWL_EXSTYLE) } as u32 & WS_EX_TOOLWINDOW != 0 {
        return 1;
    }
    if !unsafe { GetWindow(window, GW_OWNER) }.is_null() {
        return 1;
    }

    let mut client: RECT = unsafe { zeroed() };
    if unsafe { GetClientRect(window, &mut client) } == 0 {
        return 1;
    }
    let mut origin = POINT { x: 0, y: 0 };
    if unsafe { ClientToScreen(window, &mut origin) } == 0 {
        return 1;
    }
    let width = client.right - client.left;
    let height = client.bottom - client.top;
    let area = i64::from(width) * i64::from(height);
    if width > 0 && height > 0 && area > search.area {
        search.window = window;
        search.bounds = RECT {
            left: origin.x,
            top: origin.y,
            right: origin.x + width,
            bottom: origin.y + height,
        };
        search.area = area;
    }
    1
}

#[cfg(target_os = "windows")]
fn process_window(pid: u32) -> Option<(HWND, RECT)> {
    let mut search = WindowSearch {
        pid,
        window: null_mut(),
        bounds: unsafe { zeroed() },
        area: 0,
    };
    unsafe {
        EnumWindows(
            Some(find_process_window),
            &mut search as *mut WindowSearch as LPARAM,
        );
    }
    (!search.window.is_null()).then_some((search.window, search.bounds))
}

#[napi]
pub fn get_process_window_bounds(_pid: u32) -> Option<NativeWindowBounds> {
    #[cfg(target_os = "windows")]
    if let Some((_, bounds)) = process_window(_pid) {
        return Some(NativeWindowBounds {
            x: bounds.left,
            y: bounds.top,
            width: bounds.right - bounds.left,
            height: bounds.bottom - bounds.top,
        });
    }
    #[cfg(target_os = "linux")]
    if let Some(result) = linux_process_window(_pid) {
        return Some(result.bounds);
    }
    None
}

#[napi]
pub fn place_overlay_window(_window_handle: i64, _pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    if let Some((_, bounds)) = process_window(_pid) {
        let overlay = _window_handle as HWND;
        if overlay.is_null() {
            return false;
        }
        return unsafe {
            SetWindowPos(
                overlay,
                HWND_TOPMOST,
                bounds.left,
                bounds.top,
                bounds.right - bounds.left,
                bounds.bottom - bounds.top,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            ) != 0
        };
    }
    false
}

#[napi]
pub fn mark_gamescope_overlay(_window_handle: i64, _no_focus: bool) -> bool {
    #[cfg(target_os = "linux")]
    {
        use x11rb::connection::Connection;
        use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, PropMode};
        use x11rb::wrapper::ConnectionExt as _;

        let Ok((connection, _)) = x11rb::connect(None) else {
            return false;
        };
        let Ok(external_overlay) = connection.intern_atom(false, b"GAMESCOPE_EXTERNAL_OVERLAY")
        else {
            return false;
        };
        let Ok(external_overlay) = external_overlay.reply() else {
            return false;
        };
        let Ok(window) = u32::try_from(_window_handle) else {
            return false;
        };
        if window == 0 {
            return false;
        }
        let Ok(external_overlay_cookie) = connection.change_property32(
            PropMode::REPLACE,
            window,
            external_overlay.atom,
            AtomEnum::CARDINAL,
            &[1],
        ) else {
            return false;
        };
        if external_overlay_cookie.check().is_err() {
            return false;
        }
        let Ok(no_focus_atom) = connection.intern_atom(false, b"GAMESCOPE_NO_FOCUS") else {
            return false;
        };
        let Ok(no_focus_atom) = no_focus_atom.reply() else {
            return false;
        };
        let focus_cookie = if _no_focus {
            connection.change_property32(
                PropMode::REPLACE,
                window,
                no_focus_atom.atom,
                AtomEnum::CARDINAL,
                &[1],
            )
        } else {
            connection.delete_property(window, no_focus_atom.atom)
        };
        focus_cookie.is_ok_and(|cookie| cookie.check().is_ok()) && connection.flush().is_ok()
    }
    #[cfg(not(target_os = "linux"))]
    false
}

#[napi]
pub fn focus_process_window(_pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    if let Some((window, _)) = process_window(_pid) {
        unsafe {
            if IsIconic(window) != 0 {
                ShowWindow(window, SW_RESTORE);
            }
            return SetForegroundWindow(window) != 0;
        }
    }
    #[cfg(target_os = "linux")]
    if let Some(result) = linux_process_window(_pid) {
        use x11rb::connection::Connection;
        use x11rb::protocol::xproto::{
            ClientMessageData, ClientMessageEvent, ConnectionExt as _, EventMask,
        };
        use x11rb::CURRENT_TIME;

        let Ok(active_window) = result.connection.intern_atom(false, b"_NET_ACTIVE_WINDOW") else {
            return false;
        };
        let Ok(active_window) = active_window.reply() else {
            return false;
        };
        let event = ClientMessageEvent::new(
            32,
            result.window,
            active_window.atom,
            ClientMessageData::from([1, CURRENT_TIME, 0, 0, 0]),
        );
        return result
            .connection
            .send_event(
                false,
                result.root,
                EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
                event,
            )
            .is_ok()
            && result.connection.flush().is_ok();
    }
    false
}

#[napi]
pub fn get_foreground_process_id() -> u32 {
    #[cfg(target_os = "windows")]
    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() {
            return 0;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(window, &mut pid);
        pid
    }

    #[cfg(not(target_os = "windows"))]
    0
}

#[napi]
pub fn get_overlay_gamepad_buttons() -> u32 {
    #[cfg(target_os = "windows")]
    {
        const ERROR_SUCCESS: u32 = 0;
        const DPAD_UP: u16 = 0x0001;
        const DPAD_DOWN: u16 = 0x0002;
        const DPAD_LEFT: u16 = 0x0004;
        const DPAD_RIGHT: u16 = 0x0008;
        const STICK_THRESHOLD: i16 = 12_000;

        let mut combined_buttons = 0_u16;
        for user_index in 0..4 {
            let mut state = XInputState::default();
            let result = unsafe { XInputGetState(user_index, &mut state) };
            if result != ERROR_SUCCESS {
                continue;
            }

            let mut buttons = state.gamepad.buttons;
            if state.gamepad.thumb_ly > STICK_THRESHOLD {
                buttons |= DPAD_UP;
            } else if state.gamepad.thumb_ly < -STICK_THRESHOLD {
                buttons |= DPAD_DOWN;
            }
            if state.gamepad.thumb_lx < -STICK_THRESHOLD {
                buttons |= DPAD_LEFT;
            } else if state.gamepad.thumb_lx > STICK_THRESHOLD {
                buttons |= DPAD_RIGHT;
            }
            combined_buttons |= buttons;
        }
        u32::from(combined_buttons)
    }

    #[cfg(target_os = "linux")]
    {
        LINUX_GAMEPAD_BUTTONS.load(AtomicOrdering::Acquire)
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    0
}

#[napi(object)]
pub struct ProcessedImageData {
    pub image_path: String,
    pub mime_type: String,
}

#[napi(object)]
pub struct ProcessedFriendImageData {
    pub image_path: String,
    pub mime_type: String,
    pub is_animated: bool,
}

#[napi(object)]
pub struct NativeProcessPayload {
    pub exe: Option<String>,
    pub pid: u32,
    pub name: String,
    pub environ: Option<HashMap<String, String>>,
    pub cwd: Option<String>,
    pub parent_pid: Option<u32>,
    pub start_time: u32,
}

#[napi]
pub fn process_profile_image(
    image_path: String,
    target_extension: Option<String>,
) -> napi::Result<ProcessedImageData> {
    let input_path = PathBuf::from(image_path);

    if !input_path.exists() {
        return Err(Error::from_reason("Image file not found"));
    }

    let format = detect_image_format(&input_path)?;
    let animated = is_animated_image(&input_path, format)?;

    if !animated {
        return Ok(ProcessedImageData {
            image_path: input_path.to_string_lossy().to_string(),
            mime_type: mime_type_from_format_or_path(format, &input_path),
        });
    }

    let extension = target_extension
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "webp".to_string());

    let output_format = output_format_from_extension(&extension)?;
    let output_path = build_temp_output_path(&extension);

    let image = ImageReader::open(&input_path)
        .map_err(|err| Error::from_reason(err.to_string()))?
        .with_guessed_format()
        .map_err(|err| Error::from_reason(err.to_string()))?
        .decode()
        .map_err(|err| Error::from_reason(err.to_string()))?;

    image
        .save_with_format(&output_path, output_format)
        .map_err(|err| Error::from_reason(err.to_string()))?;

    Ok(ProcessedImageData {
        image_path: output_path.to_string_lossy().to_string(),
        mime_type: mime_type_from_format_or_path(Some(output_format), &output_path),
    })
}

#[napi]
pub async fn process_friend_image(
    image_path: String,
    output_path_base: String,
    width: u32,
    height: u32,
    preserve_animation: bool,
) -> napi::Result<ProcessedFriendImageData> {
    tokio::task::spawn_blocking(move || {
        process_friend_image_sync(
            image_path,
            output_path_base,
            width,
            height,
            preserve_animation,
        )
    })
    .await
    .map_err(|err| Error::from_reason(err.to_string()))?
}

fn process_friend_image_sync(
    image_path: String,
    output_path_base: String,
    width: u32,
    height: u32,
    preserve_animation: bool,
) -> napi::Result<ProcessedFriendImageData> {
    if width == 0 || height == 0 {
        return Err(Error::from_reason("Invalid output dimensions"));
    }

    let input_path = PathBuf::from(image_path);

    if !input_path.exists() {
        return Err(Error::from_reason("Image file not found"));
    }

    let format = detect_image_format(&input_path)?;
    let is_animated = preserve_animation && is_animated_image(&input_path, format)?;

    if is_animated {
        let output_path = with_extension(&output_path_base, "gif");
        resize_animated_image(&input_path, format, &output_path, width, height)?;

        return Ok(ProcessedFriendImageData {
            image_path: output_path.to_string_lossy().to_string(),
            mime_type: "image/gif".to_string(),
            is_animated: true,
        });
    }

    let output_path = with_extension(&output_path_base, "webp");
    resize_static_image(&input_path, &output_path, width, height)?;

    Ok(ProcessedFriendImageData {
        image_path: output_path.to_string_lossy().to_string(),
        mime_type: "image/webp".to_string(),
        is_animated: false,
    })
}

#[napi]
pub fn list_processes() -> Vec<NativeProcessPayload> {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);

    let mut processes: Vec<NativeProcessPayload> = system
        .processes()
        .values()
        .map(|process| {
            let include_linux_extras = !cfg!(target_os = "windows");

            NativeProcessPayload {
                exe: process
                    .exe()
                    .map(|value| value.to_string_lossy().to_string()),
                pid: process.pid().as_u32(),
                name: process.name().to_string_lossy().to_string(),
                cwd: if include_linux_extras {
                    process
                        .cwd()
                        .map(|value| value.to_string_lossy().to_string())
                } else {
                    None
                },
                environ: if include_linux_extras {
                    let env_map: HashMap<String, String> = process
                        .environ()
                        .iter()
                        .filter_map(|entry| {
                            let entry_value = entry.to_string_lossy();
                            entry_value.split_once('=').and_then(|(key, value)| {
                                if key.is_empty() {
                                    None
                                } else {
                                    Some((key.to_string(), value.to_string()))
                                }
                            })
                        })
                        .collect();

                    if env_map.is_empty() {
                        None
                    } else {
                        Some(env_map)
                    }
                } else {
                    None
                },
                parent_pid: process.parent().map(|value| value.as_u32()),
                start_time: process.start_time().min(u64::from(u32::MAX)) as u32,
            }
        })
        .collect();

    processes.sort_by(|left, right| {
        let by_pid = left.pid.cmp(&right.pid);
        if by_pid == Ordering::Equal {
            left.name.cmp(&right.name)
        } else {
            by_pid
        }
    });

    processes
}

fn detect_image_format(path: &Path) -> napi::Result<Option<ImageFormat>> {
    let reader = ImageReader::open(path).map_err(|err| Error::from_reason(err.to_string()))?;

    let guessed = reader
        .with_guessed_format()
        .map_err(|err| Error::from_reason(err.to_string()))?;

    Ok(guessed.format())
}

fn is_animated_image(path: &Path, format: Option<ImageFormat>) -> napi::Result<bool> {
    match format {
        Some(ImageFormat::Gif) => is_gif_animated(path),
        Some(ImageFormat::WebP) => is_webp_animated(path),
        Some(ImageFormat::Png) => is_apng(path),
        _ => Ok(false),
    }
}

fn is_gif_animated(path: &Path) -> napi::Result<bool> {
    let file = File::open(path).map_err(|err| Error::from_reason(err.to_string()))?;
    let decoder =
        GifDecoder::new(BufReader::new(file)).map_err(|err| Error::from_reason(err.to_string()))?;

    let mut frames = decoder.into_frames();
    let _ = frames.next().transpose();
    Ok(matches!(frames.next().transpose(), Ok(Some(_))))
}

fn is_webp_animated(path: &Path) -> napi::Result<bool> {
    let file = File::open(path).map_err(|err| Error::from_reason(err.to_string()))?;
    let decoder = WebPDecoder::new(BufReader::new(file))
        .map_err(|err| Error::from_reason(err.to_string()))?;

    Ok(decoder.has_animation())
}

fn is_apng(path: &Path) -> napi::Result<bool> {
    let file = File::open(path).map_err(|err| Error::from_reason(err.to_string()))?;
    let decoder =
        PngDecoder::new(BufReader::new(file)).map_err(|err| Error::from_reason(err.to_string()))?;

    decoder
        .is_apng()
        .map_err(|err| Error::from_reason(err.to_string()))
}

fn resize_animated_image(
    input_path: &Path,
    format: Option<ImageFormat>,
    output_path: &Path,
    width: u32,
    height: u32,
) -> napi::Result<()> {
    match format {
        Some(ImageFormat::Gif) => {
            let input_file =
                File::open(input_path).map_err(|err| Error::from_reason(err.to_string()))?;
            let decoder = GifDecoder::new(BufReader::new(input_file))
                .map_err(|err| Error::from_reason(err.to_string()))?;
            encode_animation_frames_to_gif(decoder.into_frames(), output_path, width, height)
        }
        Some(ImageFormat::WebP) => {
            let input_file =
                File::open(input_path).map_err(|err| Error::from_reason(err.to_string()))?;
            let decoder = WebPDecoder::new(BufReader::new(input_file))
                .map_err(|err| Error::from_reason(err.to_string()))?;
            encode_animation_frames_to_gif(decoder.into_frames(), output_path, width, height)
        }
        Some(ImageFormat::Png) => {
            let input_file =
                File::open(input_path).map_err(|err| Error::from_reason(err.to_string()))?;
            let decoder = PngDecoder::new(BufReader::new(input_file))
                .map_err(|err| Error::from_reason(err.to_string()))?
                .apng()
                .map_err(|err| Error::from_reason(err.to_string()))?;
            encode_animation_frames_to_gif(decoder.into_frames(), output_path, width, height)
        }
        _ => Err(Error::from_reason("Unsupported animated image format")),
    }
}

fn encode_animation_frames_to_gif<I>(
    frames: I,
    output_path: &Path,
    width: u32,
    height: u32,
) -> napi::Result<()>
where
    I: IntoIterator<Item = ImageResult<Frame>>,
{
    let output_file =
        File::create(output_path).map_err(|err| Error::from_reason(err.to_string()))?;
    let mut encoder = GifEncoder::new(BufWriter::new(output_file));
    encoder
        .set_repeat(Repeat::Infinite)
        .map_err(|err| Error::from_reason(err.to_string()))?;

    for frame in frames {
        let frame = frame.map_err(|err| Error::from_reason(err.to_string()))?;
        let delay = frame.delay();
        let resized = resize_cover_rgba(&frame.into_buffer(), width, height)?;

        encoder
            .encode_frame(Frame::from_parts(resized, 0, 0, delay))
            .map_err(|err| Error::from_reason(err.to_string()))?;
    }

    Ok(())
}

fn resize_static_image(
    input_path: &Path,
    output_path: &Path,
    width: u32,
    height: u32,
) -> napi::Result<()> {
    let image = ImageReader::open(input_path)
        .map_err(|err| Error::from_reason(err.to_string()))?
        .with_guessed_format()
        .map_err(|err| Error::from_reason(err.to_string()))?
        .decode()
        .map_err(|err| Error::from_reason(err.to_string()))?
        .to_rgba8();

    let resized = resize_cover_rgba(&image, width, height)?;
    resized
        .save_with_format(output_path, ImageFormat::WebP)
        .map_err(|err| Error::from_reason(err.to_string()))
}

fn resize_cover_rgba(image: &RgbaImage, width: u32, height: u32) -> napi::Result<RgbaImage> {
    let source_width = image.width();
    let source_height = image.height();

    if source_width == 0 || source_height == 0 {
        return Err(Error::from_reason("Could not read source image dimensions"));
    }

    let width_scale = width as f32 / source_width as f32;
    let height_scale = height as f32 / source_height as f32;
    let scale = width_scale.max(height_scale);

    let resized_width = ((source_width as f32 * scale).ceil() as u32).max(width);
    let resized_height = ((source_height as f32 * scale).ceil() as u32).max(height);
    let resized = resize(image, resized_width, resized_height, FilterType::Lanczos3);

    let left = (resized_width.saturating_sub(width)) / 2;
    let top = (resized_height.saturating_sub(height)) / 2;

    Ok(crop_imm(&resized, left, top, width, height).to_image())
}

fn with_extension(output_path_base: &str, extension: &str) -> PathBuf {
    let mut output_path = PathBuf::from(output_path_base);
    output_path.set_extension(extension);
    output_path
}

fn output_format_from_extension(extension: &str) -> napi::Result<ImageFormat> {
    match extension {
        "png" => Ok(ImageFormat::Png),
        "jpg" | "jpeg" => Ok(ImageFormat::Jpeg),
        "webp" => Ok(ImageFormat::WebP),
        _ => Err(Error::from_reason("Unsupported target extension")),
    }
}

fn build_temp_output_path(extension: &str) -> PathBuf {
    let mut output_path = std::env::temp_dir();
    output_path.push(format!("{}.{}", Uuid::new_v4(), extension));
    output_path
}

fn mime_type_from_format_or_path(format: Option<ImageFormat>, path: &Path) -> String {
    if let Some(value) = mime_type_from_image_format(format) {
        return value.to_string();
    }

    mime_guess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_string()
}

fn mime_type_from_image_format(format: Option<ImageFormat>) -> Option<&'static str> {
    match format {
        Some(ImageFormat::Png) => Some("image/png"),
        Some(ImageFormat::Jpeg) => Some("image/jpeg"),
        Some(ImageFormat::Gif) => Some("image/gif"),
        Some(ImageFormat::WebP) => Some("image/webp"),
        Some(ImageFormat::Bmp) => Some("image/bmp"),
        Some(ImageFormat::Ico) => Some("image/x-icon"),
        Some(ImageFormat::Tiff) => Some("image/tiff"),
        Some(ImageFormat::Avif) => Some("image/avif"),
        _ => None,
    }
}
