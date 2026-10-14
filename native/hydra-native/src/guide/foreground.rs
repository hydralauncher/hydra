//! Bringing one of Hydra's own windows to the foreground.
//!
//! Windows only grants the foreground to a process that already owns it or that
//! received the most recent input event. A controller button observed through
//! XInput produces no Windows input event for Hydra at all, so a plain
//! `SetForegroundWindow` from the main process is refused and the window stays
//! behind whatever the user was looking at.
//!
//! The documented way around that is to attach the calling thread's input queue
//! to the foreground thread's for the duration of the call: while the two queues
//! are attached they share an input state, which makes the request legitimate.
//! This is the same technique shells and launchers use for global shortcuts.
//!
//! Nothing here synthesises input — that matters, because the point of the
//! feature is to *observe* the controller without injecting events.

use napi_derive::napi;

#[cfg(windows)]
mod platform {
    use windows_sys::Win32::Foundation::{FALSE, HWND, TRUE};
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
        SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    pub fn bring_to_foreground(handle: isize) -> bool {
        if handle == 0 {
            return false;
        }

        let window = handle as HWND;

        unsafe {
            if IsIconic(window) != 0 {
                ShowWindow(window, SW_RESTORE);
            }

            let foreground = GetForegroundWindow();
            let foreground_thread = if foreground.is_null() {
                0
            } else {
                GetWindowThreadProcessId(foreground, std::ptr::null_mut())
            };
            let current_thread = GetCurrentThreadId();

            // Attaching a thread to itself fails, and there is nothing to attach to
            // when no window currently holds the foreground.
            let attached = foreground_thread != 0
                && foreground_thread != current_thread
                && AttachThreadInput(current_thread, foreground_thread, TRUE) != 0;

            let raised = BringWindowToTop(window) != 0;
            let focused = SetForegroundWindow(window) != 0;

            if attached {
                AttachThreadInput(current_thread, foreground_thread, FALSE);
            }

            raised && focused
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn bring_to_foreground(_handle: isize) -> bool {
        false
    }
}

/// Raise one of Hydra's own windows above other applications and focus it.
///
/// `window_handle` is the pointer from Electron's
/// `BrowserWindow.getNativeWindowHandle()`. Returns `false` when the platform
/// cannot do it or Windows refused the request.
#[napi]
pub fn bring_window_to_foreground(window_handle: i64) -> bool {
    platform::bring_to_foreground(window_handle as isize)
}
