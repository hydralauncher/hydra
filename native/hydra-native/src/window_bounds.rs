pub struct ScreenRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

pub struct WindowBounds {
    pub frame: ScreenRect,
    pub client: ScreenRect,
}

#[cfg(windows)]
fn parse_window_handle(window_handle: &str) -> Option<windows_sys::Win32::Foundation::HWND> {
    let handle = window_handle
        .trim()
        .parse::<i64>()
        .ok()
        .filter(|value| *value > 0)?;
    Some(handle as isize as windows_sys::Win32::Foundation::HWND)
}

#[cfg(windows)]
fn get_extended_frame_bounds(
    window: windows_sys::Win32::Foundation::HWND,
) -> Option<windows_sys::Win32::Foundation::RECT> {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};

    let mut frame = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    let result = unsafe {
        DwmGetWindowAttribute(
            window,
            DWMWA_EXTENDED_FRAME_BOUNDS as _,
            &mut frame as *mut RECT as *mut c_void,
            std::mem::size_of::<RECT>() as u32,
        )
    };
    (result == 0).then_some(frame)
}

#[cfg(windows)]
pub fn is_window_fullscreen(window_handle: &str) -> bool {
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{IsIconic, IsWindow, IsZoomed};

    let Some(window) = parse_window_handle(window_handle) else {
        return false;
    };

    unsafe {
        if IsWindow(window) == 0 || IsIconic(window) != 0 || IsZoomed(window) != 0 {
            return false;
        }

        let Some(frame) = get_extended_frame_bounds(window) else {
            return false;
        };

        let mut monitor: MONITORINFO = std::mem::zeroed();
        monitor.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        let handle = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
        if GetMonitorInfoW(handle, &mut monitor) == 0 {
            return false;
        }

        frame.left <= monitor.rcMonitor.left
            && frame.top <= monitor.rcMonitor.top
            && frame.right >= monitor.rcMonitor.right
            && frame.bottom >= monitor.rcMonitor.bottom
    }
}

#[cfg(not(windows))]
pub fn is_window_fullscreen(_window_handle: &str) -> bool {
    false
}

#[cfg(windows)]
pub fn get_window_bounds(window_handle: &str) -> Option<WindowBounds> {
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClientRect, IsIconic, IsWindow};

    let window = parse_window_handle(window_handle)?;

    unsafe {
        if IsWindow(window) == 0 || IsIconic(window) != 0 {
            return None;
        }

        let frame = get_extended_frame_bounds(window)?;

        let mut client = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let mut origin = POINT { x: 0, y: 0 };
        if GetClientRect(window, &mut client) == 0 || ClientToScreen(window, &mut origin) == 0 {
            return None;
        }

        Some(WindowBounds {
            frame: ScreenRect {
                left: frame.left,
                top: frame.top,
                right: frame.right,
                bottom: frame.bottom,
            },
            client: ScreenRect {
                left: origin.x,
                top: origin.y,
                right: origin.x + client.right,
                bottom: origin.y + client.bottom,
            },
        })
    }
}

#[cfg(not(windows))]
pub fn get_window_bounds(_window_handle: &str) -> Option<WindowBounds> {
    None
}
