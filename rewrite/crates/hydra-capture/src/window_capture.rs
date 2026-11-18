//! Getting a game frame.
//!
//! - `desktop_duplication_frame`: the whole monitor through DXGI desktop
//!   duplication when the foreground game window covers it (fullscreen and
//!   borderless), shared with the Electron app (desktop_duplication.rs).
//! - `capture_window`: one window. Electron does this in Chromium
//!   (`desktopCapturer` + `getUserMedia`, which uses Windows Graphics Capture
//!   on Windows and XComposite on X11); here it is native: Windows Graphics
//!   Capture on Windows, XComposite + GetImage on X11.

use crate::frame::{self, Rect};
use crate::Frame;

/// MAX_FRAME_ATTEMPTS (screenshot-frame-worker.ts)
const MAX_FRAME_ATTEMPTS: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureError {
    /// BlankScreenshotFrameError: every attempt returned a blank frame.
    Blank,
    Failed(String),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CaptureError::Blank => f.write_str("Screenshot capture returned only blank frames"),
            CaptureError::Failed(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for CaptureError {}

/// prepareWindowsDesktopCapture: create the D3D device ahead of the first capture.
pub fn prepare() -> Result<(), String> {
    #[cfg(windows)]
    wgc::prepare();
    crate::desktop_duplication::prepare_capture_device()
}

/// releaseWindowsDesktopCapture (and the window capture's D3D device)
pub fn release() {
    crate::desktop_duplication::release_capture_device();
    #[cfg(windows)]
    wgc::release();
}

/// grabDesktopDuplicationFrame: None when the window doesn't cover its
/// monitor, the output is HDR or rotated, or the frame is blank.
pub fn desktop_duplication_frame(window_handle: &str) -> Option<Frame> {
    let frame = match crate::desktop_duplication::capture_window_monitor(window_handle) {
        Ok(frame) => frame?,
        Err(error) => {
            eprintln!("screenshots: desktop duplication failed: {error}");
            return None;
        }
    };
    if frame::is_blank_frame(&frame) {
        eprintln!("screenshots: desktop duplication returned a blank frame ({window_handle})");
        return None;
    }
    Some(frame)
}

/// The window's frame and client rectangles on screen (Windows).
pub fn window_rects(window_handle: &str) -> Option<(Rect, Rect)> {
    let bounds = crate::window_bounds::get_window_bounds(window_handle)?;
    let rect = |r: crate::window_bounds::ScreenRect| Rect {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
    };
    Some((rect(bounds.frame), rect(bounds.client)))
}

/// cropToWindowClientArea: drop the title bar and borders of a windowed game.
#[cfg_attr(not(windows), allow(dead_code))]
fn crop_to_client(frame: Frame, window_handle: &str) -> Frame {
    let Some((outer, client)) = window_rects(window_handle) else {
        return frame;
    };
    match frame::client_area_crop(outer, client, (frame.width, frame.height)) {
        Some(crop) => frame::crop(frame, crop),
        None => frame,
    }
}

/// Captures one window (an HWND on Windows, an X11 window id on Linux).
/// Blank frames are retried up to three times, like the capture worker.
pub fn capture_window(window: &str, crop_client_area: bool) -> Result<Frame, CaptureError> {
    #[cfg(windows)]
    {
        let frame = wgc::capture(window)?;
        Ok(if crop_client_area {
            crop_to_client(frame, window)
        } else {
            frame
        })
    }
    #[cfg(target_os = "linux")]
    {
        x11::capture(window, crop_client_area)
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (window, crop_client_area, crop_to_client);
        Err(CaptureError::Failed(
            "Window capture is not available on this platform".into(),
        ))
    }
}

/// The largest mapped top-level X11 window (_NET_CLIENT_LIST) whose
/// _NET_WM_PID is one of `pids`: a game's XWayland window on Wayland.
#[cfg(target_os = "linux")]
pub fn find_x11_window(pids: &std::collections::HashSet<u32>) -> Option<String> {
    x11::find_window(pids)
}

#[cfg(windows)]
mod wgc {
    //! Windows Graphics Capture of one window (what Chromium's
    //! WgcCaptureSession does for `desktopCapturer` window sources).
    use std::time::{Duration, Instant};

    use windows::core::{factory, Interface};
    use windows::Graphics::Capture::{
        Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem,
    };
    use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
    use windows::Graphics::DirectX::DirectXPixelFormat;
    use windows::Win32::Foundation::{HMODULE, HWND};
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_BOX,
        D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE,
        D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    };
    use windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC;
    use windows::Win32::Graphics::Dxgi::IDXGIDevice;
    use windows::Win32::System::WinRT::Direct3D11::{
        CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
    };
    use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    use super::{CaptureError, MAX_FRAME_ATTEMPTS};
    use crate::{frame, Frame};

    /// SCREENSHOT_FIRST_FRAME_TIMEOUT_MS
    const FIRST_FRAME_TIMEOUT: Duration = Duration::from_millis(3_000);
    /// SCREENSHOT_NEXT_FRAME_TIMEOUT_MS
    const NEXT_FRAME_TIMEOUT: Duration = Duration::from_millis(150);
    const POLL_INTERVAL: Duration = Duration::from_millis(4);

    fn failed(context: &str, error: windows::core::Error) -> CaptureError {
        CaptureError::Failed(format!("{context}: {error}"))
    }

    fn parse_handle(window: &str) -> Option<HWND> {
        window
            .trim()
            .parse::<i64>()
            .ok()
            .filter(|value| *value > 0)
            .map(|value| HWND(value as isize as *mut std::ffi::c_void))
    }

    struct Device {
        device: ID3D11Device,
        context: ID3D11DeviceContext,
        winrt: IDirect3DDevice,
    }

    // Used only while DEVICE is locked (one capture at a time).
    unsafe impl Send for Device {}

    /// Kept between captures while games run (released with the desktop
    /// duplication device), like the capture worker keeps its stream.
    static DEVICE: std::sync::Mutex<Option<Device>> = std::sync::Mutex::new(None);

    pub fn release() {
        DEVICE.lock().unwrap_or_else(|e| e.into_inner()).take();
    }

    /// Creates the device ahead of the first capture (a game started).
    pub fn prepare() {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let mut slot = DEVICE.lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_none() {
            match create_device() {
                Ok(device) => *slot = Some(device),
                Err(error) => eprintln!("screenshots: failed to prepare window capture: {error}"),
            }
        }
    }

    fn create_device() -> windows::core::Result<Device> {
        let mut device = None;
        let mut context = None;
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )?;
        }
        let device: ID3D11Device = device.ok_or_else(windows::core::Error::empty)?;
        let context = context.ok_or_else(windows::core::Error::empty)?;
        let dxgi: IDXGIDevice = device.cast()?;
        let winrt: IDirect3DDevice =
            unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;
        Ok(Device {
            device,
            context,
            winrt,
        })
    }

    fn next_frame(
        pool: &Direct3D11CaptureFramePool,
        timeout: Duration,
    ) -> Option<Direct3D11CaptureFrame> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Ok(frame) = pool.TryGetNextFrame() {
                return Some(frame);
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    }

    fn read_frame(
        device: &Device,
        capture: &Direct3D11CaptureFrame,
    ) -> windows::core::Result<Frame> {
        let content = capture.ContentSize()?;
        let access: IDirect3DDxgiInterfaceAccess = capture.Surface()?.cast()?;
        let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { texture.GetDesc(&mut desc) };
        let width = (content.Width.max(1) as u32).min(desc.Width);
        let height = (content.Height.max(1) as u32).min(desc.Height);

        let staging_desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: desc.Format,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };
        let mut staging = None;
        unsafe {
            device
                .device
                .CreateTexture2D(&staging_desc, None, Some(&mut staging))?;
        }
        let staging = staging.ok_or_else(windows::core::Error::empty)?;
        let region = D3D11_BOX {
            left: 0,
            top: 0,
            front: 0,
            right: width,
            bottom: height,
            back: 1,
        };
        let row_length = width as usize * 4;
        let mut pixels = Vec::with_capacity(row_length * height as usize);
        unsafe {
            device
                .context
                .CopySubresourceRegion(&staging, 0, 0, 0, 0, &texture, 0, Some(&region));
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            device
                .context
                .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
            for row in 0..height as usize {
                let start = (mapped.pData as *const u8).add(row * mapped.RowPitch as usize);
                pixels.extend_from_slice(std::slice::from_raw_parts(start, row_length));
            }
            device.context.Unmap(&staging, 0);
        }
        Ok(Frame {
            width,
            height,
            pixels,
        })
    }

    pub fn capture(window: &str) -> Result<Frame, CaptureError> {
        let handle = parse_handle(window)
            .ok_or_else(|| CaptureError::Failed(format!("Invalid window handle {window}")))?;
        // WinRT on this worker thread (a second call just reports S_FALSE)
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let mut slot = DEVICE.lock().unwrap_or_else(|e| e.into_inner());
        let device = match slot.take() {
            Some(device) if unsafe { device.device.GetDeviceRemovedReason() }.is_ok() => device,
            _ => create_device().map_err(|e| failed("D3D11 device", e))?,
        };
        let result = capture_with(&device, handle);
        *slot = Some(device);
        result
    }

    fn capture_with(device: &Device, handle: HWND) -> Result<Frame, CaptureError> {
        let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(|e| failed("capture interop", e))?;
        let item: GraphicsCaptureItem =
            unsafe { interop.CreateForWindow(handle) }.map_err(|e| failed("capture item", e))?;
        let size = item.Size().map_err(|e| failed("capture size", e))?;
        if size.Width <= 0 || size.Height <= 0 {
            return Err(CaptureError::Failed("The game window has no size".into()));
        }
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &device.winrt,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )
        .map_err(|e| failed("frame pool", e))?;
        let session = pool
            .CreateCaptureSession(&item)
            .map_err(|e| failed("capture session", e))?;
        // Chromium hides the cursor and, where Windows allows it, the yellow border.
        let _ = session.SetIsCursorCaptureEnabled(false);
        let _ = session.SetIsBorderRequired(false);
        session
            .StartCapture()
            .map_err(|e| failed("start capture", e))?;

        let result = (|| {
            let mut capture = next_frame(&pool, FIRST_FRAME_TIMEOUT)
                .ok_or_else(|| CaptureError::Failed("Screenshot stream timed out".into()))?;
            for attempt in 1..=MAX_FRAME_ATTEMPTS {
                let frame = read_frame(device, &capture).map_err(|e| failed("read frame", e))?;
                let _ = capture.Close();
                if !frame::is_blank_frame(&frame) {
                    return Ok(frame);
                }
                eprintln!("screenshots: window capture returned a blank frame (attempt {attempt})");
                if attempt == MAX_FRAME_ATTEMPTS {
                    break;
                }
                match next_frame(&pool, NEXT_FRAME_TIMEOUT) {
                    Some(next) => capture = next,
                    // static content: no new frame will come
                    None => break,
                }
            }
            Err(CaptureError::Blank)
        })();
        let _ = session.Close();
        let _ = pool.Close();
        result
    }
}

#[cfg(target_os = "linux")]
mod x11 {
    //! X11 window capture: XComposite names the top-level window's pixmap
    //! (Chromium's X11 window capturer does the same), then GetImage reads
    //! the client window's part of it.
    use x11rb::connection::Connection;
    use x11rb::protocol::composite::{ConnectionExt as _, Redirect};
    use x11rb::protocol::xproto::{ConnectionExt as _, ImageFormat};
    use x11rb::rust_connection::RustConnection;

    use super::{CaptureError, MAX_FRAME_ATTEMPTS};
    use crate::{frame, Frame};

    /// X11_CAPTURE_RETRY_DELAY_MS
    const RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(100);

    fn failed(error: impl std::fmt::Display) -> CaptureError {
        CaptureError::Failed(error.to_string())
    }

    fn grab(
        connection: &RustConnection,
        root: u32,
        window: u32,
        crop_client: bool,
    ) -> Result<Frame, CaptureError> {
        // the top-level (frame) window: the child of the root on the way up
        let mut top = window;
        loop {
            let tree = connection
                .query_tree(top)
                .map_err(failed)?
                .reply()
                .map_err(failed)?;
            if tree.parent == root || tree.parent == 0 {
                break;
            }
            top = tree.parent;
        }
        let top_geometry = connection
            .get_geometry(top)
            .map_err(failed)?
            .reply()
            .map_err(failed)?;
        let (x, y, width, height) = if crop_client {
            let client = connection
                .get_geometry(window)
                .map_err(failed)?
                .reply()
                .map_err(failed)?;
            let offset = connection
                .translate_coordinates(window, top, 0, 0)
                .map_err(failed)?
                .reply()
                .map_err(failed)?;
            (offset.dst_x, offset.dst_y, client.width, client.height)
        } else {
            (0, 0, top_geometry.width, top_geometry.height)
        };
        if width == 0 || height == 0 {
            return Err(CaptureError::Failed("The game window has no size".into()));
        }
        let border = top_geometry.border_width as i16;

        let composite = connection
            .composite_query_version(0, 2)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .is_some();
        let pixmap = if composite {
            connection
                .composite_redirect_window(top, Redirect::AUTOMATIC)
                .map_err(failed)?;
            let pixmap = connection.generate_id().map_err(failed)?;
            connection
                .composite_name_window_pixmap(top, pixmap)
                .map_err(failed)?;
            Some(pixmap)
        } else {
            None
        };
        let image = match pixmap {
            Some(pixmap) => connection
                .get_image(
                    ImageFormat::Z_PIXMAP,
                    pixmap,
                    x + border,
                    y + border,
                    width,
                    height,
                    !0,
                )
                .map_err(failed)?
                .reply(),
            None => connection
                .get_image(ImageFormat::Z_PIXMAP, window, 0, 0, width, height, !0)
                .map_err(failed)?
                .reply(),
        };
        if let Some(pixmap) = pixmap {
            let _ = connection.free_pixmap(pixmap);
            let _ = connection.composite_unredirect_window(top, Redirect::AUTOMATIC);
            let _ = connection.flush();
        }
        let image = image.map_err(failed)?;
        let bits_per_pixel = connection
            .setup()
            .pixmap_formats
            .iter()
            .find(|format| format.depth == image.depth)
            .map(|format| format.bits_per_pixel)
            .unwrap_or(0);
        if bits_per_pixel != 32 {
            return Err(CaptureError::Failed(format!(
                "Unsupported X11 pixel format: depth {} at {bits_per_pixel} bpp",
                image.depth
            )));
        }
        let mut pixels = image.data;
        for pixel in pixels.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
        Ok(Frame {
            width: u32::from(width),
            height: u32::from(height),
            pixels,
        })
    }

    fn atom(connection: &RustConnection, name: &[u8]) -> Option<u32> {
        Some(connection.intern_atom(false, name).ok()?.reply().ok()?.atom)
    }

    pub fn find_window(pids: &std::collections::HashSet<u32>) -> Option<String> {
        use x11rb::protocol::xproto::{AtomEnum, MapState};
        if pids.is_empty() {
            return None;
        }
        let (connection, screen) = RustConnection::connect(None).ok()?;
        let root = connection.setup().roots.get(screen)?.root;
        let client_list = atom(&connection, b"_NET_CLIENT_LIST")?;
        let pid_atom = atom(&connection, b"_NET_WM_PID")?;
        let windows: Vec<u32> = connection
            .get_property(false, root, client_list, AtomEnum::WINDOW, 0, u32::MAX / 4)
            .ok()?
            .reply()
            .ok()?
            .value32()?
            .collect();
        windows
            .into_iter()
            .filter(|window| {
                connection
                    .get_property(false, *window, pid_atom, AtomEnum::CARDINAL, 0, 1)
                    .ok()
                    .and_then(|cookie| cookie.reply().ok())
                    .and_then(|reply| reply.value32().and_then(|mut values| values.next()))
                    .is_some_and(|pid| pids.contains(&pid))
            })
            .filter_map(|window| {
                let attributes = connection
                    .get_window_attributes(window)
                    .ok()?
                    .reply()
                    .ok()?;
                if attributes.map_state != MapState::VIEWABLE {
                    return None;
                }
                let geometry = connection.get_geometry(window).ok()?.reply().ok()?;
                Some((
                    u32::from(geometry.width) * u32::from(geometry.height),
                    window,
                ))
            })
            .max_by_key(|(area, _)| *area)
            .map(|(_, window)| window.to_string())
    }

    pub fn capture(window: &str, crop_client: bool) -> Result<Frame, CaptureError> {
        let window = window
            .trim()
            .parse::<u32>()
            .ok()
            .filter(|id| *id > 0)
            .ok_or_else(|| CaptureError::Failed(format!("Invalid X11 window {window}")))?;
        let (connection, screen) = RustConnection::connect(None).map_err(failed)?;
        let root = connection
            .setup()
            .roots
            .get(screen)
            .map(|screen| screen.root)
            .ok_or_else(|| CaptureError::Failed("No X11 screen".into()))?;
        for attempt in 1..=MAX_FRAME_ATTEMPTS {
            let frame = grab(&connection, root, window, crop_client)?;
            if !frame::is_blank_frame(&frame) {
                return Ok(frame);
            }
            eprintln!(
                "screenshots: X11 game-window capture returned a blank frame (attempt {attempt})"
            );
            if attempt < MAX_FRAME_ATTEMPTS {
                std::thread::sleep(RETRY_DELAY);
            }
        }
        Err(CaptureError::Blank)
    }
}
