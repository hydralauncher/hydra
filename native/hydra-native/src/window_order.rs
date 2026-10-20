#[cfg(windows)]
use windows_sys::Win32::Foundation::HWND;
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowThreadProcessId, IsWindow, SetWindowPos, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE,
};

#[cfg(windows)]
fn parse_window_handle(value: &str) -> Option<HWND> {
    let handle = value.trim().parse::<i64>().ok()?;
    if handle == 0 {
        return None;
    }
    Some(handle as isize as HWND)
}

#[cfg(windows)]
pub fn get_foreground_window() -> Option<(String, u32)> {
    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() {
            return None;
        }

        let mut process_id = 0u32;
        GetWindowThreadProcessId(window, &mut process_id);
        if process_id == 0 {
            return None;
        }

        Some(((window as isize as i64).to_string(), process_id))
    }
}

#[cfg(not(windows))]
pub fn get_foreground_window() -> Option<(String, u32)> {
    None
}

#[cfg(windows)]
pub fn place_window_below(window_handle: &str, insert_after_handle: &str) -> bool {
    let (Some(window), Some(insert_after)) = (
        parse_window_handle(window_handle),
        parse_window_handle(insert_after_handle),
    ) else {
        return false;
    };

    unsafe {
        if IsWindow(window) == 0 || IsWindow(insert_after) == 0 {
            return false;
        }

        SetWindowPos(
            window,
            insert_after,
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
        ) != 0
    }
}

#[cfg(not(windows))]
pub fn place_window_below(_window_handle: &str, _insert_after_handle: &str) -> bool {
    false
}
