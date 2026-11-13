//! A native per-pixel-alpha window for the achievement notification
//! (Windows): a click-through, never-activated, topmost tool window updated
//! with UpdateLayeredWindow, like Electron's transparent BrowserWindow.
//!
//! Why not a Slint window: Skia presents through a D3D12 HWND swapchain,
//! which has no alpha; the transparent part of the window would be black.
//! The card is rendered by Slint's Skia renderer instead
//! (Window::take_snapshot) and handed to this window as premultiplied BGRA.

use std::ffi::c_void;
use std::sync::OnceLock;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    AC_SRC_ALPHA, AC_SRC_OVER, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BLENDFUNCTION,
    CreateCompatibleDC, CreateDIBSection, DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, HBITMAP,
    HDC, ReleaseDC, SelectObject,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, HTTRANSPARENT, HWND_TOPMOST, RegisterClassExW,
    SW_SHOWNOACTIVATE, SWP_NOACTIVATE, SWP_NOSIZE, SetWindowPos, ShowWindow, ULW_ALPHA,
    UpdateLayeredWindow, WM_NCHITTEST, WNDCLASSEXW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
};

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_NCHITTEST {
        // setIgnoreMouseEvents(true): clicks go to whatever is below
        return HTTRANSPARENT as LRESULT;
    }
    // SAFETY: forwarding the message as received.
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn class_name() -> &'static [u16] {
    static CLASS: OnceLock<Vec<u16>> = OnceLock::new();
    CLASS.get_or_init(|| {
        let name = wide("HydraAchievementNotification");
        // SAFETY: a plain class registration with a static window procedure.
        unsafe {
            let class = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                style: 0,
                lpfnWndProc: Some(window_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: GetModuleHandleW(std::ptr::null()),
                hIcon: std::ptr::null_mut(),
                hCursor: std::ptr::null_mut(),
                hbrBackground: std::ptr::null_mut(),
                lpszMenuName: std::ptr::null(),
                lpszClassName: name.as_ptr(),
                hIconSm: std::ptr::null_mut(),
            };
            RegisterClassExW(&class);
        }
        name
    })
}

pub struct LayeredWindow {
    hwnd: HWND,
    dc: HDC,
    bitmap: HBITMAP,
    bits: *mut u8,
    width: i32,
    height: i32,
    x: i32,
    y: i32,
    shown: bool,
}

impl LayeredWindow {
    /// A hidden window of `width`x`height` physical pixels at (x, y).
    pub fn new(x: i32, y: i32, width: i32, height: i32) -> Option<Self> {
        let title = wide("Hydra");
        // SAFETY: standard Win32 window and DIB section creation; every handle
        // is checked and released in Drop.
        unsafe {
            let hwnd = CreateWindowExW(
                WS_EX_LAYERED
                    | WS_EX_TRANSPARENT
                    | WS_EX_TOPMOST
                    | WS_EX_TOOLWINDOW
                    | WS_EX_NOACTIVATE,
                class_name().as_ptr(),
                title.as_ptr(),
                WS_POPUP,
                x,
                y,
                width,
                height,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                GetModuleHandleW(std::ptr::null()),
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return None;
            }
            let screen = GetDC(std::ptr::null_mut());
            let dc = CreateCompatibleDC(screen);
            ReleaseDC(std::ptr::null_mut(), screen);
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    // top-down rows
                    biHeight: -height,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits: *mut c_void = std::ptr::null_mut();
            let bitmap = CreateDIBSection(
                dc,
                &info,
                DIB_RGB_COLORS,
                &mut bits,
                std::ptr::null_mut(),
                0,
            );
            if bitmap.is_null() || bits.is_null() {
                DeleteDC(dc);
                DestroyWindow(hwnd);
                return None;
            }
            SelectObject(dc, bitmap);
            Some(Self {
                hwnd,
                dc,
                bitmap,
                bits: bits.cast(),
                width,
                height,
                x,
                y,
                shown: false,
            })
        }
    }

    pub fn size(&self) -> (u32, u32) {
        (self.width as u32, self.height as u32)
    }

    pub fn move_to(&mut self, x: i32, y: i32) {
        self.x = x;
        self.y = y;
        // SAFETY: a live window owned by self.
        unsafe {
            SetWindowPos(
                self.hwnd,
                HWND_TOPMOST,
                x,
                y,
                0,
                0,
                SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }

    /// Two renders of the same frame, over black and over white (RGBA rows
    /// `source_width` pixels wide, at least the window's size; the top-left
    /// part is used), become premultiplied BGRA: alpha is what the white
    /// background still shows through, the color is the render over black.
    pub fn present_mattes(&mut self, over_black: &[u8], over_white: &[u8], source_width: u32) {
        let (width, height) = (self.width as usize, self.height as usize);
        let stride = source_width as usize * 4;
        if (source_width as usize) < width
            || over_black.len() < stride * height
            || over_white.len() < stride * height
        {
            return;
        }
        // SAFETY: the DIB section holds width*height 32-bit pixels.
        let target = unsafe { std::slice::from_raw_parts_mut(self.bits, width * height * 4) };
        for y in 0..height {
            for x in 0..width {
                let s = y * stride + x * 4;
                let t = (y * width + x) * 4;
                let (b, w) = (&over_black[s..s + 3], &over_white[s..s + 3]);
                // 255 - (white - black), averaged over the channels
                let through = (w[0] as i32 - b[0] as i32)
                    + (w[1] as i32 - b[1] as i32)
                    + (w[2] as i32 - b[2] as i32);
                let alpha = (255 - through / 3).clamp(0, 255);
                target[t] = (b[2] as i32).min(alpha) as u8;
                target[t + 1] = (b[1] as i32).min(alpha) as u8;
                target[t + 2] = (b[0] as i32).min(alpha) as u8;
                target[t + 3] = alpha as u8;
            }
        }
        self.update();
    }

    /// Fully transparent.
    pub fn clear(&mut self) {
        let pixels = (self.width * self.height) as usize;
        // SAFETY: as above.
        unsafe { std::ptr::write_bytes(self.bits, 0, pixels * 4) };
        self.update();
    }

    fn update(&mut self) {
        let position = POINT {
            x: self.x,
            y: self.y,
        };
        let size = SIZE {
            cx: self.width,
            cy: self.height,
        };
        let source = POINT { x: 0, y: 0 };
        let blend = BLENDFUNCTION {
            BlendOp: AC_SRC_OVER as u8,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: AC_SRC_ALPHA as u8,
        };
        // SAFETY: the window and the memory DC are alive.
        unsafe {
            UpdateLayeredWindow(
                self.hwnd,
                std::ptr::null_mut(),
                &position,
                &size,
                self.dc,
                &source,
                0,
                &blend,
                ULW_ALPHA,
            );
            if !self.shown {
                self.shown = true;
                // showInactive
                ShowWindow(self.hwnd, SW_SHOWNOACTIVATE);
                SetWindowPos(
                    self.hwnd,
                    HWND_TOPMOST,
                    self.x,
                    self.y,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }
}

impl Drop for LayeredWindow {
    fn drop(&mut self) {
        // SAFETY: handles created in new() and released once.
        unsafe {
            DestroyWindow(self.hwnd);
            DeleteDC(self.dc);
            DeleteObject(self.bitmap);
        }
    }
}
