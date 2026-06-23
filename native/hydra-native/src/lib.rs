use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};
use std::{cmp::Ordering, collections::HashMap};

use image::codecs::gif::{GifDecoder, GifEncoder, Repeat};
use image::codecs::png::PngDecoder;
use image::codecs::webp::WebPDecoder;
use image::imageops::{crop_imm, resize, FilterType};
use image::{AnimationDecoder, Frame, ImageFormat, ImageReader, ImageResult, RgbaImage};
use napi::bindgen_prelude::Error;
use napi_derive::napi;
use sysinfo::{ProcessesToUpdate, System};
use uuid::Uuid;

#[napi(object)]
pub struct ProcessedImageData {
    pub image_path: String,
    pub mime_type: String,
}

#[napi(object)]
pub struct ProcessedFriendImageData {
    pub image_path: String,
    pub mime_type: String,
    pub is_animated: bool,
}

#[napi(object)]
pub struct NativeProcessPayload {
    pub exe: Option<String>,
    pub pid: u32,
    pub name: String,
    pub environ: Option<HashMap<String, String>>,
    pub cwd: Option<String>,
}

#[napi]
pub fn process_profile_image(
    image_path: String,
    target_extension: Option<String>,
) -> napi::Result<ProcessedImageData> {
    let input_path = PathBuf::from(image_path);

    if !input_path.exists() {
        return Err(Error::from_reason("Image file not found"));
    }

    let format = detect_image_format(&input_path)?;
    let animated = is_animated_image(&input_path, format)?;

    if !animated {
        return Ok(ProcessedImageData {
            image_path: input_path.to_string_lossy().to_string(),
            mime_type: mime_type_from_format_or_path(format, &input_path),
        });
    }

    let extension = target_extension
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "webp".to_string());

    let output_format = output_format_from_extension(&extension)?;
    let output_path = build_temp_output_path(&extension);

    let image = ImageReader::open(&input_path)
        .map_err(|err| Error::from_reason(err.to_string()))?
        .with_guessed_format()
        .map_err(|err| Error::from_reason(err.to_string()))?
        .decode()
        .map_err(|err| Error::from_reason(err.to_string()))?;

    image
        .save_with_format(&output_path, output_format)
        .map_err(|err| Error::from_reason(err.to_string()))?;

    Ok(ProcessedImageData {
        image_path: output_path.to_string_lossy().to_string(),
        mime_type: mime_type_from_format_or_path(Some(output_format), &output_path),
    })
}

#[napi]
pub async fn process_friend_image(
    image_path: String,
    output_path_base: String,
    width: u32,
    height: u32,
    preserve_animation: bool,
) -> napi::Result<ProcessedFriendImageData> {
    tokio::task::spawn_blocking(move || {
        process_friend_image_sync(
            image_path,
            output_path_base,
            width,
            height,
            preserve_animation,
        )
    })
    .await
    .map_err(|err| Error::from_reason(err.to_string()))?
}

fn process_friend_image_sync(
    image_path: String,
    output_path_base: String,
    width: u32,
    height: u32,
    preserve_animation: bool,
) -> napi::Result<ProcessedFriendImageData> {
    if width == 0 || height == 0 {
        return Err(Error::from_reason("Invalid output dimensions"));
    }

    let input_path = PathBuf::from(image_path);

    if !input_path.exists() {
        return Err(Error::from_reason("Image file not found"));
    }

    let format = detect_image_format(&input_path)?;
    let is_animated = preserve_animation && is_animated_image(&input_path, format)?;

    if is_animated {
        let output_path = with_extension(&output_path_base, "gif");
        resize_animated_image(&input_path, format, &output_path, width, height)?;

        return Ok(ProcessedFriendImageData {
            image_path: output_path.to_string_lossy().to_string(),
            mime_type: "image/gif".to_string(),
            is_animated: true,
        });
    }

    let output_path = with_extension(&output_path_base, "webp");
    resize_static_image(&input_path, &output_path, width, height)?;

    Ok(ProcessedFriendImageData {
        image_path: output_path.to_string_lossy().to_string(),
        mime_type: "image/webp".to_string(),
        is_animated: false,
    })
}

#[napi]
pub fn list_processes() -> Vec<NativeProcessPayload> {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);

    let mut processes: Vec<NativeProcessPayload> = system
        .processes()
        .values()
        .map(|process| {
            let include_linux_extras = !cfg!(target_os = "windows");

            NativeProcessPayload {
                exe: process
                    .exe()
                    .map(|value| value.to_string_lossy().to_string()),
                pid: process.pid().as_u32(),
                name: process.name().to_string_lossy().to_string(),
                cwd: if include_linux_extras {
                    process
                        .cwd()
                        .map(|value| value.to_string_lossy().to_string())
                } else {
                    None
                },
                environ: if include_linux_extras {
                    let env_map: HashMap<String, String> = process
                        .environ()
                        .iter()
                        .filter_map(|entry| {
                            let entry_value = entry.to_string_lossy();
                            entry_value.split_once('=').and_then(|(key, value)| {
                                if key.is_empty() {
                                    None
                                } else {
                                    Some((key.to_string(), value.to_string()))
                                }
                            })
                        })
                        .collect();

                    if env_map.is_empty() {
                        None
                    } else {
                        Some(env_map)
                    }
                } else {
                    None
                },
            }
        })
        .collect();

    processes.sort_by(|left, right| {
        let by_pid = left.pid.cmp(&right.pid);
        if by_pid == Ordering::Equal {
            left.name.cmp(&right.name)
        } else {
            by_pid
        }
    });

    processes
}

fn detect_image_format(path: &Path) -> napi::Result<Option<ImageFormat>> {
    let reader = ImageReader::open(path).map_err(|err| Error::from_reason(err.to_string()))?;

    let guessed = reader
        .with_guessed_format()
        .map_err(|err| Error::from_reason(err.to_string()))?;

    Ok(guessed.format())
}

fn is_animated_image(path: &Path, format: Option<ImageFormat>) -> napi::Result<bool> {
    match format {
        Some(ImageFormat::Gif) => is_gif_animated(path),
        Some(ImageFormat::WebP) => is_webp_animated(path),
        Some(ImageFormat::Png) => is_apng(path),
        _ => Ok(false),
    }
}

fn is_gif_animated(path: &Path) -> napi::Result<bool> {
    let file = File::open(path).map_err(|err| Error::from_reason(err.to_string()))?;
    let decoder =
        GifDecoder::new(BufReader::new(file)).map_err(|err| Error::from_reason(err.to_string()))?;

    let mut frames = decoder.into_frames();
    let _ = frames.next().transpose();
    Ok(matches!(frames.next().transpose(), Ok(Some(_))))
}

fn is_webp_animated(path: &Path) -> napi::Result<bool> {
    let file = File::open(path).map_err(|err| Error::from_reason(err.to_string()))?;
    let decoder = WebPDecoder::new(BufReader::new(file))
        .map_err(|err| Error::from_reason(err.to_string()))?;

    Ok(decoder.has_animation())
}

fn is_apng(path: &Path) -> napi::Result<bool> {
    let file = File::open(path).map_err(|err| Error::from_reason(err.to_string()))?;
    let decoder =
        PngDecoder::new(BufReader::new(file)).map_err(|err| Error::from_reason(err.to_string()))?;

    decoder
        .is_apng()
        .map_err(|err| Error::from_reason(err.to_string()))
}

fn resize_animated_image(
    input_path: &Path,
    format: Option<ImageFormat>,
    output_path: &Path,
    width: u32,
    height: u32,
) -> napi::Result<()> {
    match format {
        Some(ImageFormat::Gif) => {
            let input_file =
                File::open(input_path).map_err(|err| Error::from_reason(err.to_string()))?;
            let decoder = GifDecoder::new(BufReader::new(input_file))
                .map_err(|err| Error::from_reason(err.to_string()))?;
            encode_animation_frames_to_gif(decoder.into_frames(), output_path, width, height)
        }
        Some(ImageFormat::WebP) => {
            let input_file =
                File::open(input_path).map_err(|err| Error::from_reason(err.to_string()))?;
            let decoder = WebPDecoder::new(BufReader::new(input_file))
                .map_err(|err| Error::from_reason(err.to_string()))?;
            encode_animation_frames_to_gif(decoder.into_frames(), output_path, width, height)
        }
        Some(ImageFormat::Png) => {
            let input_file =
                File::open(input_path).map_err(|err| Error::from_reason(err.to_string()))?;
            let decoder = PngDecoder::new(BufReader::new(input_file))
                .map_err(|err| Error::from_reason(err.to_string()))?
                .apng()
                .map_err(|err| Error::from_reason(err.to_string()))?;
            encode_animation_frames_to_gif(decoder.into_frames(), output_path, width, height)
        }
        _ => Err(Error::from_reason("Unsupported animated image format")),
    }
}

fn encode_animation_frames_to_gif<I>(
    frames: I,
    output_path: &Path,
    width: u32,
    height: u32,
) -> napi::Result<()>
where
    I: IntoIterator<Item = ImageResult<Frame>>,
{
    let output_file = File::create(output_path).map_err(|err| Error::from_reason(err.to_string()))?;
    let mut encoder = GifEncoder::new(BufWriter::new(output_file));
    encoder
        .set_repeat(Repeat::Infinite)
        .map_err(|err| Error::from_reason(err.to_string()))?;

    for frame in frames {
        let frame = frame.map_err(|err| Error::from_reason(err.to_string()))?;
        let delay = frame.delay().clone();
        let resized = resize_cover_rgba(&frame.into_buffer(), width, height)?;

        encoder
            .encode_frame(Frame::from_parts(resized, 0, 0, delay))
            .map_err(|err| Error::from_reason(err.to_string()))?;
    }

    Ok(())
}

fn resize_static_image(
    input_path: &Path,
    output_path: &Path,
    width: u32,
    height: u32,
) -> napi::Result<()> {
    let image = ImageReader::open(input_path)
        .map_err(|err| Error::from_reason(err.to_string()))?
        .with_guessed_format()
        .map_err(|err| Error::from_reason(err.to_string()))?
        .decode()
        .map_err(|err| Error::from_reason(err.to_string()))?
        .to_rgba8();

    let resized = resize_cover_rgba(&image, width, height)?;
    resized
        .save_with_format(output_path, ImageFormat::WebP)
        .map_err(|err| Error::from_reason(err.to_string()))
}

fn resize_cover_rgba(image: &RgbaImage, width: u32, height: u32) -> napi::Result<RgbaImage> {
    let source_width = image.width();
    let source_height = image.height();

    if source_width == 0 || source_height == 0 {
        return Err(Error::from_reason("Could not read source image dimensions"));
    }

    let width_scale = width as f32 / source_width as f32;
    let height_scale = height as f32 / source_height as f32;
    let scale = width_scale.max(height_scale);

    let resized_width = ((source_width as f32 * scale).ceil() as u32).max(width);
    let resized_height = ((source_height as f32 * scale).ceil() as u32).max(height);
    let resized = resize(
        image,
        resized_width,
        resized_height,
        FilterType::Lanczos3,
    );

    let left = (resized_width.saturating_sub(width)) / 2;
    let top = (resized_height.saturating_sub(height)) / 2;

    Ok(crop_imm(&resized, left, top, width, height).to_image())
}

fn with_extension(output_path_base: &str, extension: &str) -> PathBuf {
    let mut output_path = PathBuf::from(output_path_base);
    output_path.set_extension(extension);
    output_path
}

fn output_format_from_extension(extension: &str) -> napi::Result<ImageFormat> {
    match extension {
        "png" => Ok(ImageFormat::Png),
        "jpg" | "jpeg" => Ok(ImageFormat::Jpeg),
        "webp" => Ok(ImageFormat::WebP),
        _ => Err(Error::from_reason("Unsupported target extension")),
    }
}

fn build_temp_output_path(extension: &str) -> PathBuf {
    let mut output_path = std::env::temp_dir();
    output_path.push(format!("{}.{}", Uuid::new_v4(), extension));
    output_path
}

fn mime_type_from_format_or_path(format: Option<ImageFormat>, path: &Path) -> String {
    if let Some(value) = mime_type_from_image_format(format) {
        return value.to_string();
    }

    mime_guess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_string()
}

fn mime_type_from_image_format(format: Option<ImageFormat>) -> Option<&'static str> {
    match format {
        Some(ImageFormat::Png) => Some("image/png"),
        Some(ImageFormat::Jpeg) => Some("image/jpeg"),
        Some(ImageFormat::Gif) => Some("image/gif"),
        Some(ImageFormat::WebP) => Some("image/webp"),
        Some(ImageFormat::Bmp) => Some("image/bmp"),
        Some(ImageFormat::Ico) => Some("image/x-icon"),
        Some(ImageFormat::Tiff) => Some("image/tiff"),
        Some(ImageFormat::Avif) => Some("image/avif"),
        _ => None,
    }
}

#[napi(object)]
pub struct NativeWindowFocusResult {
    pub platform: String,
    pub status: String,
    pub focused: bool,
    pub message: Option<String>,
}

#[cfg(windows)]
#[napi]
pub fn focus_window(native_handle: Vec<u8>) -> NativeWindowFocusResult {
    use std::mem;
    use std::ptr;

    use windows_sys::Win32::Foundation::{FALSE, HWND, TRUE};
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetFocus;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
        IsWindow, SetForegroundWindow, SetWindowPos, ShowWindow,
        HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
        SW_RESTORE, SW_SHOW,
    };

    let hwnd = if native_handle.len() >= mem::size_of::<HWND>() {
        unsafe { *(native_handle.as_ptr() as *const HWND) }
    } else {
        return NativeWindowFocusResult {
            platform: "windows".to_string(),
            status: "invalid-handle".to_string(),
            focused: false,
            message: Some("native handle too short".to_string()),
        };
    };

    unsafe {
        if IsWindow(hwnd) == FALSE {
            return NativeWindowFocusResult {
                platform: "windows".to_string(),
                status: "invalid-handle".to_string(),
                focused: false,
                message: Some("not a valid window handle".to_string()),
            };
        }

        if IsIconic(hwnd) != FALSE {
            ShowWindow(hwnd, SW_RESTORE);
        } else {
            ShowWindow(hwnd, SW_SHOW);
        }

        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        );
        SetWindowPos(
            hwnd,
            HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        );

        let foreground_window = GetForegroundWindow();
        if foreground_window == hwnd {
            return NativeWindowFocusResult {
                platform: "windows".to_string(),
                status: "focused".to_string(),
                focused: true,
                message: None,
            };
        }

        let current_thread = GetCurrentThreadId();
        let foreground_thread = GetWindowThreadProcessId(foreground_window, ptr::null_mut());

        let attached = AttachThreadInput(current_thread, foreground_thread, TRUE) != FALSE;
        if attached {
            SetForegroundWindow(hwnd);
            BringWindowToTop(hwnd);
            SetFocus(hwnd);
            AttachThreadInput(current_thread, foreground_thread, FALSE);
        } else {
            SetForegroundWindow(hwnd);
            BringWindowToTop(hwnd);
            SetFocus(hwnd);
        }

        let now_focused = GetForegroundWindow() == hwnd;

        if now_focused {
            NativeWindowFocusResult {
                platform: "windows".to_string(),
                status: "focused".to_string(),
                focused: true,
                message: None,
            }
        } else {
            NativeWindowFocusResult {
                platform: "windows".to_string(),
                status: "raised".to_string(),
                focused: false,
                message: Some("after AttachThreadInput trick, foreground window still differs".to_string()),
            }
        }
    }
}

#[cfg(target_os = "linux")]
#[napi]
pub fn focus_window(native_handle: Vec<u8>) -> NativeWindowFocusResult {
    use std::ptr;

    let xid = if native_handle.len() >= std::mem::size_of::<std::ffi::c_ulong>() {
        unsafe { *(native_handle.as_ptr() as *const std::ffi::c_ulong) }
    } else {
        return NativeWindowFocusResult {
            platform: "linux".to_string(),
            status: "invalid-handle".to_string(),
            focused: false,
            message: Some("native handle too short for XID".to_string()),
        };
    };

    if xid == 0 {
        return NativeWindowFocusResult {
            platform: "linux".to_string(),
            status: "invalid-handle".to_string(),
            focused: false,
            message: Some("XID is null".to_string()),
        };
    }

    let xlib = match x11_dl::xlib::Xlib::open() {
        Ok(lib) => lib,
        Err(_) => {
            let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok()
                || std::env::var("XDG_SESSION_TYPE")
                    .map(|v| v == "wayland")
                    .unwrap_or(false);

            return NativeWindowFocusResult {
                platform: "linux".to_string(),
                status: if is_wayland {
                    "unsupported-wayland"
                } else {
                    "failed"
                }
                .to_string(),
                focused: false,
                message: Some(
                    "XOpenDisplay failed — no X11 display available".to_string(),
                ),
            };
        }
    };

    unsafe {
        let display = (xlib.XOpenDisplay)(ptr::null());
        if display.is_null() {
            return NativeWindowFocusResult {
                platform: "linux".to_string(),
                status: "failed".to_string(),
                focused: false,
                message: Some("XOpenDisplay returned null".to_string()),
            };
        }

        (xlib.XRaiseWindow)(display, xid);
        (xlib.XSetInputFocus)(display, xid, x11_dl::xlib::RevertToPointerRoot, 0);
        (xlib.XFlush)(display);
        (xlib.XCloseDisplay)(display);
    }

    NativeWindowFocusResult {
        platform: "linux".to_string(),
        status: "raised".to_string(),
        focused: false,
        message: Some(
            "X11 API called but window manager may have ignored focus request"
                .to_string(),
        ),
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
#[napi]
pub fn focus_window(_native_handle: Vec<u8>) -> NativeWindowFocusResult {
    NativeWindowFocusResult {
        platform: std::env::consts::OS.to_string(),
        status: "unsupported-platform".to_string(),
        focused: false,
        message: Some("window focus not implemented for this platform".to_string()),
    }
}
