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
pub fn get_window_bounds(window_handle: &str) -> Option<WindowBounds> {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
    use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClientRect, IsIconic, IsWindow};

    let handle = window_handle
        .trim()
        .parse::<i64>()
        .ok()
        .filter(|value| *value > 0)?;
    let window = handle as isize as HWND;

    unsafe {
        if IsWindow(window) == 0 || IsIconic(window) != 0 {
            return None;
        }

        let mut frame = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let result = DwmGetWindowAttribute(
            window,
            DWMWA_EXTENDED_FRAME_BOUNDS as _,
            &mut frame as *mut RECT as *mut c_void,
            std::mem::size_of::<RECT>() as u32,
        );
        if result != 0 {
            return None;
        }

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
