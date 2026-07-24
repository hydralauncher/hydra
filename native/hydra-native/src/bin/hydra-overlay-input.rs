#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod windows_broker {
    use std::mem::zeroed;
    use std::ptr::{null, null_mut};

    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, UnregisterHotKey, MOD_NOREPEAT, MOD_SHIFT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, FindWindowExW,
        GetMessageW, KillTimer, PostMessageW, PostQuitMessage, RegisterClassW, SetTimer,
        TranslateMessage, HWND_MESSAGE, MSG, WM_APP, WM_CLOSE, WM_DESTROY, WM_HOTKEY, WM_TIMER,
        WNDCLASSW,
    };

    const HOTKEY_ID: i32 = 1;
    const BROKER_EVENT_MESSAGE: u32 = WM_APP + 42;

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn hydra_window() -> HWND {
        let target_class = wide("HydraOverlayRawInput");
        unsafe { FindWindowExW(HWND_MESSAGE, null_mut(), target_class.as_ptr(), null()) }
    }

    unsafe fn notify_hydra() -> bool {
        let target = unsafe { hydra_window() };
        !target.is_null() && unsafe { PostMessageW(target, BROKER_EVENT_MESSAGE, 0, 0) } != 0
    }

    unsafe extern "system" fn window_proc(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message == WM_HOTKEY {
            unsafe { notify_hydra() };
            return 0;
        }
        if message == WM_CLOSE {
            unsafe { DestroyWindow(window) };
            return 0;
        }
        if message == WM_TIMER && unsafe { hydra_window() }.is_null() {
            unsafe { DestroyWindow(window) };
            return 0;
        }
        if message == WM_DESTROY {
            unsafe { KillTimer(window, 1) };
            unsafe { PostQuitMessage(0) };
            return 0;
        }
        unsafe { DefWindowProcW(window, message, wparam, lparam) }
    }

    pub fn run() -> i32 {
        unsafe {
            let instance = GetModuleHandleW(null());
            let class_name = wide("HydraOverlayInputBroker");
            let window_class = WNDCLASSW {
                lpfnWndProc: Some(window_proc),
                hInstance: instance,
                lpszClassName: class_name.as_ptr(),
                ..zeroed()
            };
            if RegisterClassW(&window_class) == 0 {
                return 1;
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
                return 2;
            }
            if RegisterHotKey(window, HOTKEY_ID, MOD_SHIFT | MOD_NOREPEAT, 0x09) == 0 {
                DestroyWindow(window);
                return 3;
            }
            SetTimer(window, 1, 5_000, None);
            if std::env::args().any(|argument| argument == "--self-test") {
                let notified = notify_hydra();
                UnregisterHotKey(window, HOTKEY_ID);
                DestroyWindow(window);
                return if notified { 0 } else { 4 };
            }
            let mut message: MSG = zeroed();
            while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            UnregisterHotKey(window, HOTKEY_ID);
            0
        }
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    std::process::exit(windows_broker::run());
}
