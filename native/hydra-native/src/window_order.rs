#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

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
