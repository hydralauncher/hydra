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

#[napi(object)]
pub struct NativeDisplayBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[napi(object)]
pub struct NativeAudioDevice {
    pub id: String,
    pub label: String,
    pub is_default: bool,
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

#[napi]
pub fn set_primary_display_by_bounds(bounds: NativeDisplayBounds) -> napi::Result<bool> {
    #[cfg(target_os = "windows")]
    {
        return display_config::set_primary_display_by_bounds(bounds).map_err(Error::from_reason);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = bounds;
        Ok(false)
    }
}

#[napi]
pub fn get_display_source_name_by_bounds(
    bounds: NativeDisplayBounds,
) -> napi::Result<Option<String>> {
    #[cfg(target_os = "windows")]
    {
        return display_config::get_display_source_name_by_bounds(bounds)
            .map_err(Error::from_reason);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = bounds;
        Ok(None)
    }
}

#[napi]
pub fn get_primary_display_source_name() -> napi::Result<Option<String>> {
    #[cfg(target_os = "windows")]
    {
        return display_config::get_primary_display_source_name().map_err(Error::from_reason);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}

#[napi]
pub fn set_primary_display_by_source_name(source_name: String) -> napi::Result<bool> {
    #[cfg(target_os = "windows")]
    {
        return display_config::set_primary_display_by_source_name(&source_name)
            .map_err(Error::from_reason);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = source_name;
        Ok(false)
    }
}

#[napi]
pub fn list_audio_render_devices() -> napi::Result<Vec<NativeAudioDevice>> {
    #[cfg(target_os = "windows")]
    {
        return core_audio::list_render_devices().map_err(Error::from_reason);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

#[napi]
pub fn get_default_audio_render_device_id() -> napi::Result<Option<String>> {
    #[cfg(target_os = "windows")]
    {
        return core_audio::get_default_render_device_id().map_err(Error::from_reason);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}

#[napi]
pub fn set_default_audio_render_device_id(id: String) -> napi::Result<bool> {
    #[cfg(target_os = "windows")]
    {
        return core_audio::set_default_render_device_id(&id).map_err(Error::from_reason);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = id;
        Ok(false)
    }
}

#[cfg(target_os = "windows")]
mod core_audio {
    use std::ffi::c_void;

    use super::NativeAudioDevice;
    use windows::core::{IUnknown, IUnknown_Vtbl, Interface, BSTR, GUID, HRESULT, PCWSTR};
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::{
        eConsole, eMultimedia, eRender, ERole, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
        DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
    };

    const POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
    const FRIENDLY_NAME_KEY: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 14,
    };

    #[repr(transparent)]
    #[derive(Clone)]
    struct IPolicyConfig(IUnknown);

    unsafe impl Interface for IPolicyConfig {
        type Vtable = IPolicyConfigVtable;
        const IID: GUID = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);
    }

    #[repr(C)]
    struct IPolicyConfigVtable {
        base__: IUnknown_Vtbl,
        get_mix_format: unsafe extern "system" fn(*mut c_void, PCWSTR, *mut *mut c_void) -> HRESULT,
        get_device_format:
            unsafe extern "system" fn(*mut c_void, PCWSTR, i32, *mut *mut c_void) -> HRESULT,
        reset_device_format: unsafe extern "system" fn(*mut c_void, PCWSTR) -> HRESULT,
        set_device_format:
            unsafe extern "system" fn(*mut c_void, PCWSTR, *mut c_void, *mut c_void) -> HRESULT,
        get_processing_period:
            unsafe extern "system" fn(*mut c_void, PCWSTR, i32, *mut i64, *mut i64) -> HRESULT,
        set_processing_period:
            unsafe extern "system" fn(*mut c_void, PCWSTR, *mut c_void) -> HRESULT,
        get_share_mode: unsafe extern "system" fn(*mut c_void, PCWSTR, *mut c_void) -> HRESULT,
        set_share_mode: unsafe extern "system" fn(*mut c_void, PCWSTR, *mut c_void) -> HRESULT,
        get_property_value:
            unsafe extern "system" fn(*mut c_void, PCWSTR, *mut c_void, *mut c_void) -> HRESULT,
        set_property_value:
            unsafe extern "system" fn(*mut c_void, PCWSTR, *mut c_void, *mut c_void) -> HRESULT,
        set_default_endpoint: unsafe extern "system" fn(*mut c_void, PCWSTR, ERole) -> HRESULT,
        set_endpoint_visibility: unsafe extern "system" fn(*mut c_void, PCWSTR, i32) -> HRESULT,
    }

    fn initialize_com() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    }

    fn device_id_to_string(device_id: windows::core::PWSTR) -> Result<String, String> {
        unsafe { device_id.to_string() }.map_err(|error| error.to_string())
    }

    fn get_device_label(device: &IMMDevice, fallback: &str) -> String {
        let label = unsafe { device.OpenPropertyStore(STGM_READ) }
            .and_then(|store| unsafe { store.GetValue(&FRIENDLY_NAME_KEY) })
            .ok()
            .and_then(|value| BSTR::try_from(&value).ok())
            .map(|value| value.to_string())
            .filter(|value| !value.trim().is_empty());

        label.unwrap_or_else(|| fallback.to_string())
    }

    pub fn list_render_devices() -> Result<Vec<NativeAudioDevice>, String> {
        initialize_com();

        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                .map_err(|error| error.to_string())?;
        let collection = unsafe { enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) }
            .map_err(|error| error.to_string())?;
        // The default endpoint can briefly be unavailable while audio hardware changes.
        // Keep listing active devices even when that best-effort lookup fails.
        let default_id = get_default_render_device_id()
            .ok()
            .flatten()
            .unwrap_or_default();
        let count = unsafe { collection.GetCount() }.map_err(|error| error.to_string())?;
        let mut devices = Vec::new();

        for index in 0..count {
            let device = unsafe { collection.Item(index) }.map_err(|error| error.to_string())?;
            let id = unsafe { device.GetId() }
                .map_err(|error| error.to_string())
                .and_then(device_id_to_string)?;
            let label = get_device_label(&device, &id);

            devices.push(NativeAudioDevice {
                label,
                is_default: id.eq_ignore_ascii_case(&default_id),
                id,
            });
        }

        Ok(devices)
    }

    pub fn get_default_render_device_id() -> Result<Option<String>, String> {
        initialize_com();

        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                .map_err(|error| error.to_string())?;
        let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) }
            .map_err(|error| error.to_string())?;
        let id = unsafe { device.GetId() }
            .map_err(|error| error.to_string())
            .and_then(device_id_to_string)?;

        Ok(Some(id))
    }

    pub fn set_default_render_device_id(id: &str) -> Result<bool, String> {
        initialize_com();

        let policy: IPolicyConfig =
            unsafe { CoCreateInstance(&POLICY_CONFIG_CLIENT, None, CLSCTX_ALL) }
                .map_err(|error| error.to_string())?;
        let wide_id: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
        let device_id = PCWSTR(wide_id.as_ptr());

        unsafe {
            ((*policy.vtable()).set_default_endpoint)(policy.as_raw(), device_id, eConsole)
                .ok()
                .map_err(|error| error.to_string())?;
            ((*policy.vtable()).set_default_endpoint)(policy.as_raw(), device_id, eMultimedia)
                .ok()
                .map_err(|error| error.to_string())?;
        }

        Ok(true)
    }
}

#[cfg(target_os = "windows")]
mod display_config {
    use std::collections::HashMap;
    use std::mem::size_of;

    use super::NativeDisplayBounds;

    const ERROR_SUCCESS: i32 = 0;
    const DISPLAYCONFIG_PATH_ACTIVE: u32 = 0x00000001;
    const DISPLAYCONFIG_PATH_MODE_IDX_INVALID: u32 = 0xffffffff;
    const QDC_ALL_PATHS: u32 = 0x00000001;
    const QDC_ONLY_ACTIVE_PATHS: u32 = 0x00000002;
    const SDC_USE_SUPPLIED_DISPLAY_CONFIG: u32 = 0x00000020;
    const SDC_APPLY: u32 = 0x00000080;
    const SDC_ALLOW_CHANGES: u32 = 0x00000400;
    // Keep Big Picture display changes session-only instead of saving them to Windows.
    const BIG_PICTURE_DISPLAY_APPLY_FLAGS: u32 =
        SDC_APPLY | SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_ALLOW_CHANGES;
    const DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME: u32 = 1;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Luid {
        low_part: u32,
        high_part: i32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct DisplayConfigRational {
        numerator: u32,
        denominator: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct DisplayConfig2DRegion {
        width: u32,
        height: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct PointL {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct RectL {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct DisplayConfigPathInfo {
        source_info: DisplayConfigPathSourceInfo,
        target_info: DisplayConfigPathTargetInfo,
        flags: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct DisplayConfigPathSourceInfo {
        adapter_id: Luid,
        id: u32,
        mode_info_idx: u32,
        status_flags: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct DisplayConfigPathTargetInfo {
        adapter_id: Luid,
        id: u32,
        mode_info_idx: u32,
        output_technology: u32,
        rotation: u32,
        scaling: u32,
        refresh_rate: DisplayConfigRational,
        scan_line_ordering: u32,
        target_available: i32,
        status_flags: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct DisplayConfigTargetMode {
        target_video_signal_info: DisplayConfigVideoSignalInfo,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct DisplayConfigVideoSignalInfo {
        pixel_rate: u64,
        h_sync_freq: DisplayConfigRational,
        v_sync_freq: DisplayConfigRational,
        active_size: DisplayConfig2DRegion,
        total_size: DisplayConfig2DRegion,
        video_standard: u32,
        scan_line_ordering: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct DisplayConfigSourceMode {
        width: u32,
        height: u32,
        pixel_format: u32,
        position: PointL,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct DisplayConfigDesktopImageInfo {
        path_source_size: PointL,
        desktop_image_region: RectL,
        desktop_image_clip: RectL,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    union DisplayConfigModeInfoData {
        target_mode: DisplayConfigTargetMode,
        source_mode: DisplayConfigSourceMode,
        desktop_image_info: DisplayConfigDesktopImageInfo,
    }

    impl Default for DisplayConfigModeInfoData {
        fn default() -> Self {
            Self {
                source_mode: DisplayConfigSourceMode::default(),
            }
        }
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct DisplayConfigModeInfo {
        info_type: u32,
        id: u32,
        adapter_id: Luid,
        data: DisplayConfigModeInfoData,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct DisplayConfigDeviceInfoHeader {
        r#type: u32,
        size: u32,
        adapter_id: Luid,
        id: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct DisplayConfigSourceDeviceName {
        header: DisplayConfigDeviceInfoHeader,
        view_gdi_device_name: [u16; 32],
    }

    impl Default for DisplayConfigSourceDeviceName {
        fn default() -> Self {
            Self {
                header: DisplayConfigDeviceInfoHeader::default(),
                view_gdi_device_name: [0; 32],
            }
        }
    }

    #[derive(Clone)]
    struct ActiveDisplay {
        source_name: String,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetDisplayConfigBufferSizes(
            flags: u32,
            num_path_array_elements: *mut u32,
            num_mode_info_array_elements: *mut u32,
        ) -> i32;

        fn QueryDisplayConfig(
            flags: u32,
            num_path_array_elements: *mut u32,
            path_info_array: *mut DisplayConfigPathInfo,
            num_mode_info_array_elements: *mut u32,
            mode_info_array: *mut DisplayConfigModeInfo,
            current_topology_id: *mut u32,
        ) -> i32;

        fn SetDisplayConfig(
            num_path_array_elements: u32,
            path_array: *const DisplayConfigPathInfo,
            num_mode_info_array_elements: u32,
            mode_info_array: *const DisplayConfigModeInfo,
            flags: u32,
        ) -> i32;

        fn DisplayConfigGetDeviceInfo(request_packet: *mut DisplayConfigDeviceInfoHeader) -> i32;
    }

    pub fn set_primary_display_by_bounds(bounds: NativeDisplayBounds) -> Result<bool, String> {
        let (active_paths, active_modes) = query_display_config(QDC_ONLY_ACTIVE_PATHS)?;
        let active_displays = build_active_displays(&active_paths, &active_modes);

        let Some(target_display) = find_target_display(&active_displays, &bounds) else {
            return Ok(false);
        };

        if target_display.x == 0 && target_display.y == 0 {
            return Ok(true);
        }

        let offset_x = -target_display.x;
        let offset_y = -target_display.y;

        let desired_positions = active_displays
            .iter()
            .map(|display| {
                let position = if display.source_name == target_display.source_name {
                    PointL { x: 0, y: 0 }
                } else {
                    PointL {
                        x: display.x + offset_x,
                        y: display.y + offset_y,
                    }
                };

                (display.source_name.clone(), position)
            })
            .collect::<HashMap<_, _>>();

        let mut right_edge = active_displays
            .iter()
            .filter_map(|display| {
                desired_positions
                    .get(&display.source_name)
                    .map(|position| position.x + display.width)
            })
            .max()
            .unwrap_or(0);

        let (paths, mut modes) = query_display_config(QDC_ALL_PATHS)?;

        for path in paths.iter() {
            if path.target_info.target_available == 0 {
                continue;
            }

            let mode_index = path.source_info.mode_info_idx;
            if mode_index == DISPLAYCONFIG_PATH_MODE_IDX_INVALID {
                continue;
            }

            let Some(mode) = modes.get_mut(mode_index as usize) else {
                continue;
            };

            let source_name = get_source_name(path.source_info.adapter_id, path.source_info.id);
            let mut source_mode = unsafe { mode.data.source_mode };

            if let Some(position) = desired_positions.get(&source_name) {
                source_mode.position = *position;
            } else if path.target_info.scan_line_ordering != 0 {
                source_mode.position = PointL {
                    x: right_edge,
                    y: 0,
                };
                right_edge += source_mode.width as i32;
            } else {
                continue;
            }

            mode.data.source_mode = source_mode;
        }

        let result = unsafe {
            SetDisplayConfig(
                paths.len() as u32,
                paths.as_ptr(),
                modes.len() as u32,
                modes.as_ptr(),
                BIG_PICTURE_DISPLAY_APPLY_FLAGS,
            )
        };

        if result == ERROR_SUCCESS {
            Ok(true)
        } else {
            Err(format!("SetDisplayConfig failed with Win32 error {result}"))
        }
    }

    pub fn get_display_source_name_by_bounds(
        bounds: NativeDisplayBounds,
    ) -> Result<Option<String>, String> {
        let (active_paths, active_modes) = query_display_config(QDC_ONLY_ACTIVE_PATHS)?;
        let active_displays = build_active_displays(&active_paths, &active_modes);

        Ok(find_target_display(&active_displays, &bounds)
            .map(|display| display.source_name.clone()))
    }

    pub fn get_primary_display_source_name() -> Result<Option<String>, String> {
        let (active_paths, active_modes) = query_display_config(QDC_ONLY_ACTIVE_PATHS)?;
        let active_displays = build_active_displays(&active_paths, &active_modes);

        Ok(active_displays
            .iter()
            .find(|display| display.x == 0 && display.y == 0)
            .map(|display| display.source_name.clone()))
    }

    pub fn set_primary_display_by_source_name(source_name: &str) -> Result<bool, String> {
        let (active_paths, active_modes) = query_display_config(QDC_ONLY_ACTIVE_PATHS)?;
        let active_displays = build_active_displays(&active_paths, &active_modes);

        let Some(target_display) = active_displays
            .iter()
            .find(|display| display.source_name.eq_ignore_ascii_case(source_name))
        else {
            return Ok(false);
        };

        set_primary_display_by_bounds(NativeDisplayBounds {
            x: target_display.x,
            y: target_display.y,
            width: target_display.width,
            height: target_display.height,
        })
    }

    fn query_display_config(
        flags: u32,
    ) -> Result<(Vec<DisplayConfigPathInfo>, Vec<DisplayConfigModeInfo>), String> {
        let mut path_count = 0;
        let mut mode_count = 0;

        let result =
            unsafe { GetDisplayConfigBufferSizes(flags, &mut path_count, &mut mode_count) };
        if result != ERROR_SUCCESS {
            return Err(format!(
                "GetDisplayConfigBufferSizes failed with Win32 error {result}"
            ));
        }

        let mut paths = vec![DisplayConfigPathInfo::default(); path_count as usize];
        let mut modes = vec![DisplayConfigModeInfo::default(); mode_count as usize];

        let result = unsafe {
            QueryDisplayConfig(
                flags,
                &mut path_count,
                paths.as_mut_ptr(),
                &mut mode_count,
                modes.as_mut_ptr(),
                std::ptr::null_mut(),
            )
        };
        if result != ERROR_SUCCESS {
            return Err(format!(
                "QueryDisplayConfig failed with Win32 error {result}"
            ));
        }

        paths.truncate(path_count as usize);
        modes.truncate(mode_count as usize);

        Ok((paths, modes))
    }

    fn build_active_displays(
        paths: &[DisplayConfigPathInfo],
        modes: &[DisplayConfigModeInfo],
    ) -> Vec<ActiveDisplay> {
        paths
            .iter()
            .filter_map(|path| {
                if (path.flags & DISPLAYCONFIG_PATH_ACTIVE) == 0 {
                    return None;
                }

                let mode_index = path.source_info.mode_info_idx;
                if mode_index == DISPLAYCONFIG_PATH_MODE_IDX_INVALID {
                    return None;
                }

                let mode = modes.get(mode_index as usize)?;
                let source_mode = unsafe { mode.data.source_mode };

                Some(ActiveDisplay {
                    source_name: get_source_name(path.source_info.adapter_id, path.source_info.id),
                    x: source_mode.position.x,
                    y: source_mode.position.y,
                    width: source_mode.width as i32,
                    height: source_mode.height as i32,
                })
            })
            .collect()
    }

    fn find_target_display<'a>(
        displays: &'a [ActiveDisplay],
        bounds: &NativeDisplayBounds,
    ) -> Option<&'a ActiveDisplay> {
        displays
            .iter()
            .max_by_key(|display| score_display(display, bounds))
    }

    fn score_display(display: &ActiveDisplay, bounds: &NativeDisplayBounds) -> i64 {
        let mut score = 0_i64;

        if display.x == bounds.x && display.y == bounds.y {
            score += 1_000_000;
        }

        if display.width == bounds.width && display.height == bounds.height {
            score += 500_000;
        }

        let display_center_x = display.x as i64 + display.width as i64 / 2;
        let display_center_y = display.y as i64 + display.height as i64 / 2;
        let bounds_center_x = bounds.x as i64 + bounds.width as i64 / 2;
        let bounds_center_y = bounds.y as i64 + bounds.height as i64 / 2;
        let dx = display_center_x - bounds_center_x;
        let dy = display_center_y - bounds_center_y;
        let distance_squared = dx * dx + dy * dy;

        score - distance_squared
    }

    fn get_source_name(adapter_id: Luid, id: u32) -> String {
        let mut source_name = DisplayConfigSourceDeviceName {
            header: DisplayConfigDeviceInfoHeader {
                r#type: DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
                size: size_of::<DisplayConfigSourceDeviceName>() as u32,
                adapter_id,
                id,
            },
            ..Default::default()
        };

        let result = unsafe { DisplayConfigGetDeviceInfo(&mut source_name.header) };
        if result != ERROR_SUCCESS {
            return format!("DISPLAY{id}");
        }

        let end = source_name
            .view_gdi_device_name
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(source_name.view_gdi_device_name.len());

        String::from_utf16_lossy(&source_name.view_gdi_device_name[..end])
    }
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
    let output_file =
        File::create(output_path).map_err(|err| Error::from_reason(err.to_string()))?;
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
    let resized = resize(image, resized_width, resized_height, FilterType::Lanczos3);

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
