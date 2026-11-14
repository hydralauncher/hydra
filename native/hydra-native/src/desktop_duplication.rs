use image::codecs::jpeg::JpegEncoder;
use image::imageops::thumbnail;
use image::{ExtendedColorType, ImageResult, RgbImage};

pub struct DesktopFrame {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

pub struct EncodedScreenshot {
    pub jpeg: Vec<u8>,
    pub preview: Vec<u8>,
}

fn encode_rgb_jpeg(image: &RgbImage, quality: u8) -> ImageResult<Vec<u8>> {
    let mut output = Vec::new();
    JpegEncoder::new_with_quality(&mut output, quality).encode(
        image.as_raw(),
        image.width(),
        image.height(),
        ExtendedColorType::Rgb8,
    )?;
    Ok(output)
}

pub fn encode_bgra_screenshot(
    pixels: &[u8],
    width: u32,
    height: u32,
    quality: u8,
    preview_max_width: u32,
    preview_quality: u8,
) -> Result<EncodedScreenshot, String> {
    let rgb = pixels
        .chunks_exact(4)
        .flat_map(|pixel| [pixel[2], pixel[1], pixel[0]])
        .collect();
    let image = RgbImage::from_raw(width, height, rgb)
        .ok_or_else(|| "The frame does not match its dimensions".to_string())?;

    let preview_width = width.min(preview_max_width).max(1);
    let preview_height =
        (u64::from(height) * u64::from(preview_width) / u64::from(width.max(1))).max(1) as u32;
    let preview = thumbnail(&image, preview_width, preview_height);

    Ok(EncodedScreenshot {
        jpeg: encode_rgb_jpeg(&image, quality).map_err(|error| error.to_string())?,
        preview: encode_rgb_jpeg(&preview, preview_quality).map_err(|error| error.to_string())?,
    })
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::sync::Mutex;

    use windows::core::{Error, Interface, Result};
    use windows::Win32::Foundation::{E_POINTER, HMODULE, HWND, LUID, POINT};
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
        D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_FLAG, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ,
        D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    };
    use windows::Win32::Graphics::Dxgi::Common::{
        DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020, DXGI_FORMAT_B8G8R8A8_UNORM,
        DXGI_MODE_ROTATION_IDENTITY, DXGI_MODE_ROTATION_UNSPECIFIED, DXGI_SAMPLE_DESC,
    };
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput, IDXGIOutput1, IDXGIOutput6,
        IDXGIOutputDuplication, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
    };
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, HMONITOR, MONITORINFO,
        MONITOR_DEFAULTTONULL, MONITOR_DEFAULTTOPRIMARY,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    use super::DesktopFrame;
    use crate::window_bounds::get_window_bounds;

    const FIRST_FRAME_TIMEOUT_MS: u32 = 500;
    const NEW_FRAME_TIMEOUT_MS: u32 = 150;
    const MAX_MONITOR_OVERSHOOT_PX: i32 = 8;

    struct CaptureDevice {
        adapter_id: LUID,
        device: ID3D11Device,
        context: ID3D11DeviceContext,
    }

    unsafe impl Send for CaptureDevice {}

    static CAPTURE_DEVICE: Mutex<Option<CaptureDevice>> = Mutex::new(None);

    fn find_covered_monitor(window_handle: &str) -> Option<HMONITOR> {
        let handle = window_handle
            .trim()
            .parse::<i64>()
            .ok()
            .filter(|value| *value > 0)?;
        let window = HWND(handle as isize as *mut c_void);
        let client = get_window_bounds(window_handle)?.client;

        unsafe {
            if GetForegroundWindow() != window {
                return None;
            }

            let monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONULL);
            if monitor.is_invalid() {
                return None;
            }

            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return None;
            }

            let screen = info.rcMonitor;
            let covers_monitor = [
                screen.left - client.left,
                screen.top - client.top,
                client.right - screen.right,
                client.bottom - screen.bottom,
            ]
            .iter()
            .all(|overshoot| (0..=MAX_MONITOR_OVERSHOOT_PX).contains(overshoot));
            covers_monitor.then_some(monitor)
        }
    }

    fn find_output(monitor: HMONITOR) -> Result<Option<(IDXGIAdapter1, IDXGIOutput)>> {
        unsafe {
            let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
            let mut adapter_index = 0;
            while let Ok(adapter) = factory.EnumAdapters1(adapter_index) {
                let mut output_index = 0;
                while let Ok(output) = adapter.EnumOutputs(output_index) {
                    if output.GetDesc()?.Monitor == monitor {
                        return Ok(Some((adapter, output)));
                    }
                    output_index += 1;
                }
                adapter_index += 1;
            }
        }
        Ok(None)
    }

    fn is_hdr_output(output: &IDXGIOutput) -> bool {
        output
            .cast::<IDXGIOutput6>()
            .ok()
            .and_then(|output| unsafe { output.GetDesc1() }.ok())
            .is_some_and(|desc| desc.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020)
    }

    fn create_capture_device(adapter: &IDXGIAdapter1, adapter_id: LUID) -> Result<CaptureDevice> {
        let mut device = None;
        let mut context = None;
        unsafe {
            D3D11CreateDevice(
                adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_FLAG(0),
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )?;
        }
        Ok(CaptureDevice {
            adapter_id,
            device: device.ok_or_else(|| Error::from(E_POINTER))?,
            context: context.ok_or_else(|| Error::from(E_POINTER))?,
        })
    }

    fn with_capture_device<T>(
        adapter: &IDXGIAdapter1,
        use_device: impl FnOnce(&CaptureDevice) -> Result<T>,
    ) -> Result<T> {
        let adapter_id = unsafe { adapter.GetDesc1()? }.AdapterLuid;
        let mut slot = CAPTURE_DEVICE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        let current = match slot.take() {
            Some(existing) if existing.adapter_id == adapter_id => existing,
            _ => create_capture_device(adapter, adapter_id)?,
        };
        let result = use_device(&current);
        if unsafe { current.device.GetDeviceRemovedReason() }.is_ok() {
            *slot = Some(current);
        }
        result
    }

    fn create_staging_texture(
        device: &ID3D11Device,
        width: u32,
        height: u32,
    ) -> Result<ID3D11Texture2D> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };
        let mut texture = None;
        unsafe { device.CreateTexture2D(&desc, None, Some(&mut texture))? };
        texture.ok_or_else(|| Error::from(E_POINTER))
    }

    fn copy_next_frame(
        duplication: &IDXGIOutputDuplication,
        context: &ID3D11DeviceContext,
        staging: &ID3D11Texture2D,
        timeout_ms: u32,
    ) -> Result<i64> {
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut resource = None;
        unsafe {
            duplication.AcquireNextFrame(timeout_ms, &mut info, &mut resource)?;
            let texture = resource
                .ok_or_else(|| Error::from(E_POINTER))
                .and_then(|resource| resource.cast::<ID3D11Texture2D>());
            if let Ok(texture) = &texture {
                context.CopyResource(staging, texture);
            }
            duplication.ReleaseFrame()?;
            texture?;
        }
        Ok(info.LastPresentTime)
    }

    fn read_staging_pixels(
        context: &ID3D11DeviceContext,
        staging: &ID3D11Texture2D,
        width: u32,
        height: u32,
    ) -> Result<Vec<u8>> {
        let row_length = width as usize * 4;
        let mut pixels = Vec::with_capacity(row_length * height as usize);
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        unsafe {
            context.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
            for row in 0..height as usize {
                let start = (mapped.pData as *const u8).add(row * mapped.RowPitch as usize);
                pixels.extend_from_slice(std::slice::from_raw_parts(start, row_length));
            }
            context.Unmap(staging, 0);
        }
        Ok(pixels)
    }

    fn grab_output_frame(
        output: &IDXGIOutput,
        capture: &CaptureDevice,
    ) -> Result<Option<DesktopFrame>> {
        let duplication = unsafe {
            output
                .cast::<IDXGIOutput1>()?
                .DuplicateOutput(&capture.device)?
        };
        let desc = unsafe { duplication.GetDesc() };
        let is_upright = desc.Rotation == DXGI_MODE_ROTATION_IDENTITY
            || desc.Rotation == DXGI_MODE_ROTATION_UNSPECIFIED;
        if desc.ModeDesc.Format != DXGI_FORMAT_B8G8R8A8_UNORM || !is_upright {
            return Ok(None);
        }

        let width = desc.ModeDesc.Width;
        let height = desc.ModeDesc.Height;
        let staging = create_staging_texture(&capture.device, width, height)?;

        let last_present = copy_next_frame(
            &duplication,
            &capture.context,
            &staging,
            FIRST_FRAME_TIMEOUT_MS,
        )?;
        if last_present == 0 {
            if let Err(error) = copy_next_frame(
                &duplication,
                &capture.context,
                &staging,
                NEW_FRAME_TIMEOUT_MS,
            ) {
                if error.code() != DXGI_ERROR_WAIT_TIMEOUT {
                    return Err(error);
                }
            }
        }

        Ok(Some(DesktopFrame {
            width,
            height,
            pixels: read_staging_pixels(&capture.context, &staging, width, height)?,
        }))
    }

    pub fn capture_window_monitor(window_handle: &str) -> Result<Option<DesktopFrame>> {
        let Some(monitor) = find_covered_monitor(window_handle) else {
            return Ok(None);
        };
        let Some((adapter, output)) = find_output(monitor)? else {
            return Ok(None);
        };
        if is_hdr_output(&output) {
            return Ok(None);
        }
        let frame = with_capture_device(&adapter, |capture| grab_output_frame(&output, capture))?;
        if find_covered_monitor(window_handle) != Some(monitor) {
            return Ok(None);
        }
        Ok(frame)
    }

    pub fn prepare() -> Result<()> {
        let monitor = unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) };
        if let Some((adapter, _)) = find_output(monitor)? {
            with_capture_device(&adapter, |_| Ok(()))?;
        }
        Ok(())
    }

    pub fn release() {
        CAPTURE_DEVICE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
    }
}

#[cfg(windows)]
pub fn capture_window_monitor(window_handle: &str) -> Result<Option<DesktopFrame>, String> {
    platform::capture_window_monitor(window_handle).map_err(|error| error.to_string())
}

#[cfg(windows)]
pub fn prepare_capture_device() -> Result<(), String> {
    platform::prepare().map_err(|error| error.to_string())
}

#[cfg(windows)]
pub fn release_capture_device() {
    platform::release();
}

#[cfg(not(windows))]
pub fn capture_window_monitor(_window_handle: &str) -> Result<Option<DesktopFrame>, String> {
    Ok(None)
}

#[cfg(not(windows))]
pub fn prepare_capture_device() -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn release_capture_device() {}
