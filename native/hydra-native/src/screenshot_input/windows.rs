use super::binding::{
    gamepad, is_windows_modifier_scan_code, windows_scan_code, windows_virtual_key_scan_code,
    Backend, ComboMatcher, HotkeyMatcher, Modifiers, TriggerSource, WindowsShiftTracker,
};
use super::{BackendResult, Context, PlatformStatus, StartOptions};
use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{GetLastError, ERROR_CLASS_ALREADY_EXISTS, HWND, LPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, MapVirtualKeyW, MAPVK_VK_TO_VSC_EX, VK_CONTROL, VK_LCONTROL, VK_LMENU,
    VK_LSHIFT, VK_LWIN, VK_MENU, VK_RCONTROL, VK_RMENU, VK_RSHIFT, VK_RWIN, VK_SHIFT,
};
use windows_sys::Win32::UI::Input::XboxController::{XInputGetState, XINPUT_STATE};
use windows_sys::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, PeekMessageW,
    PostThreadMessageW, RegisterClassW, UnregisterClassW, HWND_MESSAGE, MSG, PM_NOREMOVE,
    RI_KEY_BREAK, WM_INPUT, WM_QUIT, WNDCLASSW,
};

const READY_TIMEOUT: Duration = Duration::from_secs(2);
const XINPUT_POLL_INTERVAL: Duration = Duration::from_millis(16);
const XINPUT_RECONNECT_INTERVAL: Duration = Duration::from_secs(1);
const XINPUT_USER_COUNT: usize = 4;
const HID_USAGE_PAGE_GENERIC: u16 = 0x01;
const HID_USAGE_GENERIC_KEYBOARD: u16 = 0x06;
const KEYBOARD_OVERRUN_MAKE_CODE: u16 = 0xFF;
const PRINT_SCREEN_SCAN_CODE: u16 = 0xE037;
const PRINT_SCREEN_MODIFIER_GRACE: Duration = Duration::from_millis(500);

#[derive(Default)]
struct RawInputControl {
    thread_id: AtomicU32,
    cancelled: AtomicBool,
}

impl RawInputControl {
    fn publish_thread(&self, context: &Context) -> bool {
        self.thread_id
            .store(unsafe { GetCurrentThreadId() }, Ordering::SeqCst);
        !self.cancelled.load(Ordering::SeqCst) && !context.is_stopped()
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        let thread_id = self.thread_id.load(Ordering::SeqCst);
        if thread_id != 0 {
            unsafe {
                PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
            }
        }
    }
}

struct RawInputThread {
    handle: JoinHandle<()>,
    control: Arc<RawInputControl>,
}

pub struct Runtime {
    keyboard: Option<RawInputThread>,
    gamepad: Option<JoinHandle<()>>,
}

impl Runtime {
    pub fn stop(self) {
        if let Some(keyboard) = self.keyboard {
            keyboard.control.cancel();
            let _ = keyboard.handle.join();
        }
        if let Some(gamepad) = self.gamepad {
            gamepad.thread().unpark();
            let _ = gamepad.join();
        }
    }
}

pub fn probe(options: StartOptions) -> PlatformStatus {
    PlatformStatus {
        keyboard: if options.keyboard {
            BackendResult::active(Backend::WindowsRawInput)
        } else {
            BackendResult::disabled()
        },
        gamepad: if options.gamepad {
            BackendResult::active(Backend::XInput)
        } else {
            BackendResult::disabled()
        },
        wayland_session: false,
    }
}

pub fn start(context: Arc<Context>, options: StartOptions) -> (Runtime, PlatformStatus) {
    let mut status = probe(options);
    let mut runtime = Runtime {
        keyboard: None,
        gamepad: None,
    };

    if options.keyboard {
        let (ready, receiver) = mpsc::sync_channel(1);
        let control = Arc::new(RawInputControl::default());
        let thread_control = control.clone();
        let thread_context = context.clone();
        match thread::Builder::new()
            .name("hydra-screenshot-raw-input".into())
            .spawn(move || run_raw_input(&thread_context, &thread_control, ready))
        {
            Ok(handle) => match receiver.recv_timeout(READY_TIMEOUT) {
                Ok(Ok(())) => runtime.keyboard = Some(RawInputThread { handle, control }),
                Ok(Err(error)) => {
                    status.keyboard = BackendResult::unavailable(error);
                    let _ = handle.join();
                }
                Err(_) => {
                    status.keyboard = BackendResult::unavailable("raw-input-timeout");
                    control.cancel();
                    runtime.keyboard = Some(RawInputThread { handle, control });
                }
            },
            Err(_) => status.keyboard = BackendResult::unavailable("thread-failed"),
        }
    }

    if options.gamepad {
        let thread_context = context.clone();
        match thread::Builder::new()
            .name("hydra-screenshot-xinput".into())
            .spawn(move || run_xinput(&thread_context))
        {
            Ok(handle) => runtime.gamepad = Some(handle),
            Err(_) => status.gamepad = BackendResult::unavailable("thread-failed"),
        }
    }

    (runtime, status)
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn register_keyboard(window: HWND, remove: bool) -> bool {
    let device = RAWINPUTDEVICE {
        usUsagePage: HID_USAGE_PAGE_GENERIC,
        usUsage: HID_USAGE_GENERIC_KEYBOARD,
        dwFlags: if remove {
            RIDEV_REMOVE
        } else {
            RIDEV_INPUTSINK
        },
        hwndTarget: if remove { null_mut() } else { window },
    };
    unsafe { RegisterRawInputDevices(&device, 1, size_of::<RAWINPUTDEVICE>() as u32) != 0 }
}

fn run_raw_input(
    context: &Context,
    control: &RawInputControl,
    ready: mpsc::SyncSender<Result<(), &'static str>>,
) {
    let mut message: MSG = unsafe { zeroed() };
    unsafe { PeekMessageW(&mut message, null_mut(), 0, 0, PM_NOREMOVE) };
    if !control.publish_thread(context) {
        let _ = ready.send(Err("raw-input-cancelled"));
        return;
    }

    let class_name = wide("HydraScreenshotRawInput");
    let instance = unsafe { GetModuleHandleW(null()) };
    let class = WNDCLASSW {
        lpfnWndProc: Some(DefWindowProcW),
        hInstance: instance,
        lpszClassName: class_name.as_ptr(),
        ..unsafe { zeroed() }
    };
    if unsafe { RegisterClassW(&class) } == 0
        && unsafe { GetLastError() } != ERROR_CLASS_ALREADY_EXISTS
    {
        let _ = ready.send(Err("raw-input-failed"));
        return;
    }

    let window = unsafe {
        CreateWindowExW(
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
        )
    };
    if window.is_null() {
        unsafe { UnregisterClassW(class_name.as_ptr(), instance) };
        let _ = ready.send(Err("raw-input-failed"));
        return;
    }

    if !register_keyboard(window, false) {
        unsafe {
            DestroyWindow(window);
            UnregisterClassW(class_name.as_ptr(), instance);
        }
        let _ = ready.send(Err("raw-input-failed"));
        return;
    }

    let _ = ready.send(Ok(()));

    let mut keyboard = KeyboardState {
        hotkey: HotkeyMatcher::default(),
        shift: WindowsShiftTracker::new(key_down(VK_LSHIFT), key_down(VK_RSHIFT)),
        print_screen_down: false,
        modifier_releases: ModifierReleases::default(),
    };
    let failed = loop {
        match unsafe { GetMessageW(&mut message, null_mut(), 0, 0) } {
            0 => break false,
            -1 => break true,
            _ => {}
        }
        if message.message == WM_INPUT {
            handle_raw_input(context, &mut keyboard, message.lParam);
        }
        unsafe { DispatchMessageW(&message) };
    };

    register_keyboard(window, true);
    unsafe {
        DestroyWindow(window);
        UnregisterClassW(class_name.as_ptr(), instance);
    }
    if failed {
        context.report_stopped(TriggerSource::Keyboard, Backend::WindowsRawInput);
    }
}

fn key_down(virtual_key: u16) -> bool {
    unsafe { GetAsyncKeyState(i32::from(virtual_key)) as u16 & 0x8000 != 0 }
}

fn is_shift_virtual_key(virtual_key: u16) -> bool {
    matches!(virtual_key, VK_SHIFT | VK_LSHIFT | VK_RSHIFT)
}

fn is_modifier_virtual_key(virtual_key: u16) -> bool {
    is_shift_virtual_key(virtual_key)
        || matches!(
            virtual_key,
            VK_CONTROL
                | VK_LCONTROL
                | VK_RCONTROL
                | VK_MENU
                | VK_LMENU
                | VK_RMENU
                | VK_LWIN
                | VK_RWIN
        )
}

#[derive(Default)]
struct ModifierReleases {
    ctrl: Option<Instant>,
    alt: Option<Instant>,
    shift: Option<Instant>,
    meta: Option<Instant>,
}

impl ModifierReleases {
    fn on_key(&mut self, virtual_key: u16, pressed: bool, now: Instant) {
        let slot = match virtual_key {
            VK_CONTROL | VK_LCONTROL | VK_RCONTROL => &mut self.ctrl,
            VK_MENU | VK_LMENU | VK_RMENU => &mut self.alt,
            VK_SHIFT | VK_LSHIFT | VK_RSHIFT => &mut self.shift,
            VK_LWIN | VK_RWIN => &mut self.meta,
            _ => return,
        };
        *slot = if pressed { None } else { Some(now) };
    }

    fn within_grace(&self, now: Instant) -> Modifiers {
        let recent = |released: Option<Instant>| {
            released.is_some_and(|at| now.duration_since(at) <= PRINT_SCREEN_MODIFIER_GRACE)
        };
        Modifiers {
            ctrl: recent(self.ctrl),
            alt: recent(self.alt),
            shift: recent(self.shift),
            meta: recent(self.meta),
        }
    }
}

struct KeyboardState {
    hotkey: HotkeyMatcher,
    shift: WindowsShiftTracker,
    print_screen_down: bool,
    modifier_releases: ModifierReleases,
}

impl KeyboardState {
    fn current_modifiers(&self) -> Modifiers {
        Modifiers {
            ctrl: key_down(VK_CONTROL),
            alt: key_down(VK_MENU),
            shift: self.shift.is_held(key_down(VK_SHIFT)),
            meta: key_down(VK_LWIN) || key_down(VK_RWIN),
        }
    }
}

fn scan_code_from_virtual_key(virtual_key: u16, flags: u16) -> Option<u16> {
    let mapped = unsafe { MapVirtualKeyW(u32::from(virtual_key), MAPVK_VK_TO_VSC_EX) };
    windows_virtual_key_scan_code(mapped, flags)
}

fn handle_raw_input(context: &Context, state: &mut KeyboardState, lparam: LPARAM) {
    let mut input: RAWINPUT = unsafe { zeroed() };
    let mut size = size_of::<RAWINPUT>() as u32;
    let read = unsafe {
        GetRawInputData(
            lparam as HRAWINPUT,
            RID_INPUT,
            (&mut input as *mut RAWINPUT).cast::<c_void>(),
            &mut size,
            size_of::<RAWINPUTHEADER>() as u32,
        )
    };
    if read == u32::MAX || read == 0 || input.header.dwType != RIM_TYPEKEYBOARD {
        return;
    }

    let keyboard = unsafe { input.data.keyboard };
    let code = if keyboard.MakeCode == 0 || keyboard.MakeCode == KEYBOARD_OVERRUN_MAKE_CODE {
        match scan_code_from_virtual_key(keyboard.VKey, keyboard.Flags) {
            Some(code) => code,
            None => return,
        }
    } else {
        windows_scan_code(keyboard.MakeCode, keyboard.Flags)
    };
    let pressed = u32::from(keyboard.Flags) & RI_KEY_BREAK == 0;
    let mut release_without_press = false;
    if code == PRINT_SCREEN_SCAN_CODE {
        release_without_press = !pressed && !state.print_screen_down;
        state.print_screen_down = pressed;
    }
    if is_windows_modifier_scan_code(code) {
        state
            .modifier_releases
            .on_key(keyboard.VKey, pressed, Instant::now());
    }

    if state.shift.on_key(code, pressed) {
        return;
    }
    if is_modifier_virtual_key(keyboard.VKey) && !is_windows_modifier_scan_code(code) {
        if is_shift_virtual_key(keyboard.VKey) {
            state.shift.on_system_shift();
        }
        return;
    }

    let Some(binding) = context.binding().hotkey else {
        return;
    };
    if code != binding.key.platform_code() {
        return;
    }
    let mut modifiers = state.current_modifiers();
    if release_without_press && !binding.matches_modifiers(modifiers) {
        modifiers = modifiers.union(state.modifier_releases.within_grace(Instant::now()));
    }
    let fired = state
        .hotkey
        .on_key(code, pressed || release_without_press, &binding, modifiers);
    if release_without_press {
        state.hotkey.on_key(code, false, &binding, modifiers);
    }
    if fired {
        context.emit(TriggerSource::Keyboard, Backend::WindowsRawInput);
    }
}

fn run_xinput(context: &Context) {
    let mut combos: [ComboMatcher; XINPUT_USER_COUNT] = Default::default();
    let mut next_probe: [Option<Instant>; XINPUT_USER_COUNT] = [None; XINPUT_USER_COUNT];

    while !context.is_stopped() {
        let combo = context.binding().gamepad_mask;
        let now = Instant::now();
        for user in 0..XINPUT_USER_COUNT {
            if next_probe[user].is_some_and(|deadline| now < deadline) {
                continue;
            }
            let mut state: XINPUT_STATE = unsafe { zeroed() };
            if unsafe { XInputGetState(user as u32, &mut state) } != 0 {
                next_probe[user] = Some(now + XINPUT_RECONNECT_INTERVAL);
                combos[user] = ComboMatcher::default();
                continue;
            }
            next_probe[user] = None;
            let buttons = gamepad::xinput_mask(
                state.Gamepad.wButtons,
                state.Gamepad.bLeftTrigger,
                state.Gamepad.bRightTrigger,
            );
            if combos[user].update(buttons, combo) {
                context.emit(TriggerSource::Gamepad, Backend::XInput);
            }
        }
        thread::park_timeout(xinput_wait(&next_probe, Instant::now()));
    }
}

fn xinput_wait(next_probe: &[Option<Instant>; XINPUT_USER_COUNT], now: Instant) -> Duration {
    let mut earliest_probe: Option<Instant> = None;
    for deadline in next_probe {
        let Some(deadline) = *deadline else {
            return XINPUT_POLL_INTERVAL;
        };
        earliest_probe = Some(earliest_probe.map_or(deadline, |earliest| earliest.min(deadline)));
    }
    earliest_probe.map_or(XINPUT_POLL_INTERVAL, |deadline| {
        deadline
            .saturating_duration_since(now)
            .max(XINPUT_POLL_INTERVAL)
    })
}
