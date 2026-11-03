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

pub struct WindowOwner {
    pub class_name: String,
    pub executable_path: Option<String>,
}

#[cfg(windows)]
fn get_process_image_path(process_id: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let mut path = [0u16; 32_768];
    let mut length = path.len() as u32;

    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if process.is_null() {
            return None;
        }
        let succeeded =
            QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, path.as_mut_ptr(), &mut length);
        CloseHandle(process);
        (succeeded != 0).then(|| String::from_utf16_lossy(&path[..length as usize]))
    }
}

#[cfg(windows)]
pub fn get_window_owner(window_handle: &str) -> Option<WindowOwner> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetWindowThreadProcessId};

    let window = parse_window_handle(window_handle)?;
    let mut class_name = [0u16; 256];
    let mut process_id = 0u32;

    unsafe {
        let length = GetClassNameW(window, class_name.as_mut_ptr(), class_name.len() as i32);
        if length <= 0 || GetWindowThreadProcessId(window, &mut process_id) == 0 {
            return None;
        }

        Some(WindowOwner {
            class_name: String::from_utf16_lossy(&class_name[..length as usize]),
            executable_path: get_process_image_path(process_id),
        })
    }
}

#[cfg(not(windows))]
pub fn get_window_owner(_window_handle: &str) -> Option<WindowOwner> {
    None
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
