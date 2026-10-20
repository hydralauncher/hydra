use super::binding::{
    gamepad, windows_scan_code, Backend, ComboMatcher, HotkeyMatcher, Modifiers, TriggerSource,
};
use super::{BackendResult, Context, PlatformStatus, StartOptions};
use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{GetLastError, ERROR_CLASS_ALREADY_EXISTS, HWND, LPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, MapVirtualKeyW, MAPVK_VK_TO_VSC_EX, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN,
    VK_SHIFT,
};
use windows_sys::Win32::UI::Input::XboxController::{XInputGetState, XINPUT_STATE};
use windows_sys::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
    PostThreadMessageW, RegisterClassW, UnregisterClassW, HWND_MESSAGE, MSG, RI_KEY_BREAK,
    WM_INPUT, WM_QUIT, WNDCLASSW,
};

const READY_TIMEOUT: Duration = Duration::from_secs(2);
const XINPUT_POLL_INTERVAL: Duration = Duration::from_millis(16);
const XINPUT_RECONNECT_INTERVAL: Duration = Duration::from_secs(1);
const XINPUT_USER_COUNT: usize = 4;
const HID_USAGE_PAGE_GENERIC: u16 = 0x01;
const HID_USAGE_GENERIC_KEYBOARD: u16 = 0x06;
const KEYBOARD_OVERRUN_MAKE_CODE: u16 = 0xFF;

struct RawInputThread {
    handle: JoinHandle<()>,
    thread_id: u32,
}

pub struct Runtime {
    keyboard: Option<RawInputThread>,
    gamepad: Option<JoinHandle<()>>,
}

impl Runtime {
    pub fn stop(self) {
        if let Some(keyboard) = self.keyboard {
            unsafe {
                PostThreadMessageW(keyboard.thread_id, WM_QUIT, 0, 0);
            }
            let _ = keyboard.handle.join();
        }
        if let Some(gamepad) = self.gamepad {
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
        let thread_context = context.clone();
        match thread::Builder::new()
            .name("hydra-screenshot-raw-input".into())
            .spawn(move || run_raw_input(&thread_context, ready))
        {
            Ok(handle) => match receiver.recv_timeout(READY_TIMEOUT) {
                Ok(Ok(thread_id)) => {
                    runtime.keyboard = Some(RawInputThread { handle, thread_id });
                }
                Ok(Err(error)) => {
                    status.keyboard = BackendResult::unavailable(error);
                    let _ = handle.join();
                }
                Err(_) => status.keyboard = BackendResult::unavailable("raw-input-timeout"),
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

fn run_raw_input(context: &Context, ready: mpsc::SyncSender<Result<u32, &'static str>>) {
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

    let _ = ready.send(Ok(unsafe { GetCurrentThreadId() }));

    let mut hotkey = HotkeyMatcher::default();
    let mut message: MSG = unsafe { zeroed() };
    while unsafe { GetMessageW(&mut message, null_mut(), 0, 0) } > 0 {
        if message.message == WM_INPUT {
            handle_raw_input(context, &mut hotkey, message.lParam);
        }
        unsafe { DispatchMessageW(&message) };
    }

    register_keyboard(window, true);
    unsafe {
        DestroyWindow(window);
        UnregisterClassW(class_name.as_ptr(), instance);
    }
}

fn key_down(virtual_key: u16) -> bool {
    unsafe { GetAsyncKeyState(i32::from(virtual_key)) as u16 & 0x8000 != 0 }
}

fn current_modifiers() -> Modifiers {
    Modifiers {
        ctrl: key_down(VK_CONTROL),
        alt: key_down(VK_MENU),
        shift: key_down(VK_SHIFT),
        meta: key_down(VK_LWIN) || key_down(VK_RWIN),
    }
}

fn scan_code_from_virtual_key(virtual_key: u16) -> Option<u16> {
    let mapped = unsafe { MapVirtualKeyW(u32::from(virtual_key), MAPVK_VK_TO_VSC_EX) };
    let make = (mapped & 0x7F) as u16;
    if make == 0 {
        return None;
    }
    Some(match mapped >> 8 {
        0xE0 => 0xE000 | make,
        0xE1 => 0xE100 | make,
        _ => make,
    })
}

fn handle_raw_input(context: &Context, hotkey: &mut HotkeyMatcher, lparam: LPARAM) {
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
        match scan_code_from_virtual_key(keyboard.VKey) {
            Some(code) => code,
            None => return,
        }
    } else {
        windows_scan_code(keyboard.MakeCode, keyboard.Flags)
    };

    let Some(binding) = context.binding().hotkey else {
        return;
    };
    if code != binding.key.platform_code() {
        return;
    }
    let pressed = u32::from(keyboard.Flags) & RI_KEY_BREAK == 0;
    if hotkey.on_key(code, pressed, &binding, current_modifiers()) {
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
        thread::sleep(XINPUT_POLL_INTERVAL);
    }
}
