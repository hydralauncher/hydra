//! AMD AMF H.264 encoder backend, loaded at runtime from `amfrt64.dll`
//! (the AMF runtime ships with the AMD driver, no import lib).
//!
//! AMF is a property-based COM-style API, more verbose than NVENC: every
//! object is a vtable pointer, configuration is `SetProperty(wide name,
//! AMFVariant)` before/after `Init`, input frames are AMFSurfaces wrapped
//! around our D3D11 texture (`CreateSurfaceFromDX11Native`), and outputs
//! are polled AMFBuffers. Vtable layouts and offsets were verified
//! against the public AMF headers (GPUOpen-LibrariesAndSDKs/AMF,
//! core/Factory.h, core/Context.h, core/PropertyStorageEx.h,
//! components/Component.h, core/Buffer.h); the property sequence mirrors
//! FFmpeg's `libavcodec/amfenc_h264.c` (the AMF wrapper Sunshine uses)
//! with low-latency settings matching our NVENC configuration: CBR at
//! the negotiated bitrate, no B-frames, SPS/PPS inserted on forced IDRs.

use std::collections::VecDeque;
use std::ffi::c_void;
use std::ptr;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{FreeLibrary, HMODULE};
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

use crate::capture::{SubmitHandle, SubmitState, TextureEncoder};
use crate::nvenc::EncoderConfigParams;

pub type AmfResult = i32;
const AMF_OK: AmfResult = 0;
const AMF_INPUT_FULL: AmfResult = 25;

/// Requested runtime version (1.4.33); AMFInit fails if the installed
/// runtime is older. Layout: AMF_MAKE_FULL_VERSION(major, minor, release,
/// build) = major<<48 | minor<<32 | release<<16 | build.
const AMF_FULL_VERSION: u64 = (1u64 << 48) | (4u64 << 32) | (33u64 << 16);
const AMF_DX11_0: i32 = 110;

const AMF_SURFACE_BGRA: i32 = 3;

// AMF_VIDEO_ENCODER_USAGE_ENUM / QUALITY_PRESET / PROFILE / RATE_CONTROL
const USAGE_ULTRA_LOW_LATENCY: i64 = 1;
const QUALITY_PRESET_SPEED: i64 = 1;
const PROFILE_HIGH: i64 = 100;
const RATE_CONTROL_CBR: i64 = 1;
const CABAC: i64 = 1;
const SCAN_TYPE_PROGRESSIVE: i64 = 0;
// AMF_VIDEO_ENCODER_PICTURE_TYPE_ENUM / OUTPUT_DATA_TYPE_ENUM
const PICTURE_TYPE_IDR: i64 = 2;
const OUTPUT_DATA_TYPE_IDR: i64 = 0;
/// IDR only on demand, like the NVENC backend's infinite GOP.
const IDR_PERIOD_INFINITE: i64 = i32::MAX as i64;

/// 16-byte GUID with the AMF field layout (Platform.h). IID_AMFBuffer
/// from core/Buffer.h.
#[repr(C)]
#[derive(Clone, Copy)]
struct AmfGuid {
    data1: u32,
    data2: u16,
    data3: u16,
    data41: u8,
    data42: u8,
    data43: u8,
    data44: u8,
    data45: u8,
    data46: u8,
    data47: u8,
    data48: u8,
}

const IID_AMF_BUFFER: AmfGuid = AmfGuid {
    data1: 0xb04b7248,
    data2: 0xb6f0,
    data3: 0x4321,
    data41: 0xb6,
    data42: 0x91,
    data43: 0xba,
    data44: 0xa4,
    data45: 0x74,
    data46: 0x0f,
    data47: 0x9f,
    data48: 0xcb,
};

/// AMFVariantStruct (core/Variant.h): 4-byte type, 4-byte pad (the union
/// is 8-byte aligned), 16-byte union. Booleans are amf_bool (int32) but
/// live in the same union slot.
#[repr(C)]
#[derive(Clone, Copy)]
struct AmfVariant {
    ty: i32,
    _pad: i32,
    value: [u8; 16],
}

impl AmfVariant {
    const EMPTY: AmfVariant = AmfVariant {
        ty: 0,
        _pad: 0,
        value: [0; 16],
    };

    fn int64(value: i64) -> Self {
        let mut variant = AmfVariant::EMPTY;
        variant.ty = 2; // AMF_VARIANT_INT64
        variant.value[..8].copy_from_slice(&value.to_le_bytes());
        variant
    }

    fn bool_(value: bool) -> Self {
        let mut variant = AmfVariant::EMPTY;
        variant.ty = 1; // AMF_VARIANT_BOOL
        variant.value[..4].copy_from_slice(&(value as i32).to_le_bytes());
        variant
    }

    fn size(width: i32, height: i32) -> Self {
        let mut variant = AmfVariant::EMPTY;
        variant.ty = 5; // AMF_VARIANT_SIZE
        variant.value[..4].copy_from_slice(&width.to_le_bytes());
        variant.value[4..8].copy_from_slice(&height.to_le_bytes());
        variant
    }

    fn rate(numerator: u32, denominator: u32) -> Self {
        let mut variant = AmfVariant::EMPTY;
        variant.ty = 7; // AMF_VARIANT_RATE
        variant.value[..4].copy_from_slice(&numerator.to_le_bytes());
        variant.value[4..8].copy_from_slice(&denominator.to_le_bytes());
        variant
    }

    fn as_int64(&self) -> i64 {
        i64::from_le_bytes(self.value[..8].try_into().expect("8 bytes"))
    }
}

type FnVoid = unsafe extern "system" fn();

// Property-storage base shared by every AMF object: Acquire/Release/
// QueryInterface + SetProperty/GetProperty, then 8 slots we never call
// (HasProperty .. RemoveObserver).
#[repr(C)]
struct AmfStorageVtbl {
    acquire: unsafe extern "system" fn(*mut c_void) -> i64,
    release: unsafe extern "system" fn(*mut c_void) -> i64,
    query_interface: unsafe extern "system" fn(*mut c_void, *const AmfGuid, *mut *mut c_void) -> i32,
    set_property: unsafe extern "system" fn(*mut c_void, *const u16, AmfVariant) -> i32,
    get_property: unsafe extern "system" fn(*mut c_void, *const u16, *mut AmfVariant) -> i32,
    _reserved: [FnVoid; 8],
}

// AMFComponent (components/Component.h): PropertyStorage base +
// PropertyStorageEx (4 slots) + Init .. QueryOutput.
#[repr(C)]
struct AmfComponentVtbl {
    storage: AmfStorageVtbl,
    _property_storage_ex: [FnVoid; 4],
    init: unsafe extern "system" fn(*mut c_void, i32, i32, i32) -> i32,
    _reinit: unsafe extern "system" fn(*mut c_void, i32, i32) -> i32,
    terminate: unsafe extern "system" fn(*mut c_void) -> i32,
    _drain: unsafe extern "system" fn(*mut c_void) -> i32,
    _flush: unsafe extern "system" fn(*mut c_void) -> i32,
    submit_input: unsafe extern "system" fn(*mut c_void, *mut c_void) -> i32,
    query_output: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
}

// AMFContext (core/Context.h): base + Terminate + DX9 block + InitDX11,
// then slots up to CreateSurfaceFromDX11Native (offset 49).
#[repr(C)]
struct AmfContextVtbl {
    storage: AmfStorageVtbl,
    terminate: unsafe extern "system" fn(*mut c_void) -> i32,
    _dx9: [FnVoid; 4],
    init_dx11: unsafe extern "system" fn(*mut c_void, *mut c_void, i32) -> i32,
    _to_surface_from_dx11: [FnVoid; 30],
    create_surface_from_dx11_native:
        unsafe extern "system" fn(*mut c_void, *mut c_void, *mut *mut c_void, *mut c_void) -> i32,
}

// AMFBuffer (core/Buffer.h): base + AMFData (10 slots) + SetSize,
// GetSize, GetNative.
#[repr(C)]
struct AmfBufferVtbl {
    storage: AmfStorageVtbl,
    _data: [FnVoid; 10],
    _set_size: FnVoid,
    get_size: unsafe extern "system" fn(*mut c_void) -> usize,
    get_native: unsafe extern "system" fn(*mut c_void) -> *mut c_void,
}

// AMFFactory (core/Factory.h) has no AMFInterface base; entry via the
// AMFInit export.
#[repr(C)]
struct AmfFactoryVtbl {
    create_context: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
    create_component:
        unsafe extern "system" fn(*mut c_void, *mut c_void, *const u16, *mut *mut c_void) -> i32,
    _rest: [FnVoid; 5],
}

unsafe fn storage_vtbl(object: *mut c_void) -> *const AmfStorageVtbl {
    *(object as *const *const AmfStorageVtbl)
}

unsafe fn set_property(object: *mut c_void, name: PCWSTR, value: AmfVariant) -> AmfResult {
    let vtbl = storage_vtbl(object);
    ((*vtbl).set_property)(object, name.as_ptr(), value)
}

unsafe fn get_property(object: *mut c_void, name: PCWSTR, value: &mut AmfVariant) -> AmfResult {
    let vtbl = storage_vtbl(object);
    ((*vtbl).get_property)(object, name.as_ptr(), value)
}

unsafe fn release(object: *mut c_void) {
    let vtbl = storage_vtbl(object);
    ((*vtbl).release)(object);
}

macro_rules! set {
    ($object:expr, $name:expr, $value:expr) => {
        let result = set_property($object, $name, $value);
        if result != AMF_OK {
            eprintln!("amf: SetProperty({}) failed: {result}", stringify!($name));
        }
    };
}

/// Frees the loaded AMF runtime library on drop — covering the
/// `AmfEncoder::new` error paths (which return early) as well as the
/// normal teardown.
struct LibraryGuard(HMODULE);

impl Drop for LibraryGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = FreeLibrary(self.0);
        }
    }
}

/// AMD AMF H.264 encoder over a D3D11 device. One instance per capture
/// device; display-mode recreation rebuilds it (the context is bound to
/// the device, the component to the resolution).
pub struct AmfEncoder {
    _library: LibraryGuard,
    _factory: *mut c_void,
    context: *mut c_void,
    encoder: *mut c_void,
    pending: VecDeque<(Vec<u8>, bool)>,
    /// Submission tickets parallel to `pending` (AMF is FIFO and always
    /// accepts, so the queues stay aligned).
    handles: VecDeque<SubmitHandle>,
}

// Raw driver handles are only touched from the video thread.
unsafe impl Send for AmfEncoder {}

impl AmfEncoder {
    pub fn new(device: *mut c_void, params: &EncoderConfigParams) -> Result<Self, String> {
        if device.is_null() {
            return Err("no D3D11 device".to_string());
        }
        let library = unsafe { LoadLibraryW(w!("amfrt64.dll")) }
            .map_err(|error| format!("LoadLibrary amfrt64.dll: {error}"))?;
        let init: extern "C" fn(u64, *mut *mut c_void) -> AmfResult = unsafe {
            GetProcAddress(library, windows::core::s!("AMFInit"))
                .map(|address| std::mem::transmute(address))
                .ok_or("AMFInit not found")?
        };

        let mut factory: *mut c_void = ptr::null_mut();
        let result = init(AMF_FULL_VERSION, &mut factory);
        if result != AMF_OK || factory.is_null() {
            return Err(format!("AMFInit failed: {result:#x}"));
        }

        let mut context: *mut c_void = ptr::null_mut();
        let result = unsafe {
            let vtbl = *(factory as *const *const AmfFactoryVtbl);
            ((*vtbl).create_context)(factory, &mut context)
        };
        if result != AMF_OK || context.is_null() {
            return Err(format!("CreateContext failed: {result:#x}"));
        }
        let result = unsafe {
            let vtbl = *(context as *const *const AmfContextVtbl);
            ((*vtbl).init_dx11)(context, device, AMF_DX11_0)
        };
        if result != AMF_OK {
            unsafe { release(context) };
            return Err(format!("InitDX11 failed: {result:#x}"));
        }

        let mut encoder: *mut c_void = ptr::null_mut();
        let result = unsafe {
            let vtbl = *(factory as *const *const AmfFactoryVtbl);
            ((*vtbl).create_component)(factory, context, w!("AMFVideoEncoderVCE_AVC").as_ptr(), &mut encoder)
        };
        if result != AMF_OK || encoder.is_null() {
            unsafe { release(context) };
            return Err(format!("CreateComponent(AMFVideoEncoderVCE_AVC) failed: {result:#x}"));
        }

        // Static parameters (FFmpeg amfenc_h264.c ordering).
        unsafe {
            set!(encoder, w!("Usage"), AmfVariant::int64(USAGE_ULTRA_LOW_LATENCY));
        set!(
            encoder,
            w!("FrameSize"),
            AmfVariant::size(params.width as i32, params.height as i32)
        );
        set!(
            encoder,
            w!("FrameRate"),
            AmfVariant::rate(params.fps.max(1), 1)
        );
        set!(encoder, w!("Profile"), AmfVariant::int64(PROFILE_HIGH));
        set!(encoder, w!("MaxNumRefFrames"), AmfVariant::int64(1));
        set!(
            encoder,
            w!("QualityPreset"),
            AmfVariant::int64(QUALITY_PRESET_SPEED)
        );
        set!(
            encoder,
            w!("RateControlMethod"),
            AmfVariant::int64(RATE_CONTROL_CBR)
        );
        set!(
            encoder,
            w!("TargetBitrate"),
            AmfVariant::int64((params.bitrate_kbps * 1000) as i64)
        );
        set!(
            encoder,
            w!("PeakBitrate"),
            AmfVariant::int64((params.bitrate_kbps * 1000) as i64)
        );
        set!(
            encoder,
            w!("VBVBufferSize"),
            AmfVariant::int64((params.bitrate_kbps * 1000 / params.fps.max(1)) as i64)
        );
        set!(encoder, w!("LowLatencyInternal"), AmfVariant::bool_(true));
        set!(encoder, w!("BPicturesPattern"), AmfVariant::int64(0));
        set!(encoder, w!("MaxConsecutiveBPictures"), AmfVariant::int64(0));
        set!(encoder, w!("EnforceHRD"), AmfVariant::bool_(true));
        set!(encoder, w!("ScanType"), AmfVariant::int64(SCAN_TYPE_PROGRESSIVE));
        set!(encoder, w!("CABACEnable"), AmfVariant::int64(CABAC));
        set!(encoder, w!("QueryTimeout"), AmfVariant::int64(1));
        }

        let result = unsafe {
            let vtbl = *(encoder as *const *const AmfComponentVtbl);
            ((*vtbl).init)(
                encoder,
                AMF_SURFACE_BGRA,
                params.width as i32,
                params.height as i32,
            )
        };
        if result != AMF_OK {
            unsafe {
                release(encoder);
                release(context);
            }
            return Err(format!("encoder Init failed: {result:#x}"));
        }

        // Dynamic parameters (after Init, per FFmpeg).
        unsafe {
            set!(
                encoder,
                w!("IDRPeriod"),
                AmfVariant::int64(IDR_PERIOD_INFINITE)
            );
            set!(encoder, w!("DeBlockingFilter"), AmfVariant::bool_(true));
            set!(
                encoder,
                w!("RateControlSkipFrameEnable"),
                AmfVariant::bool_(false)
            );
            if params.slices_per_frame > 1 {
                set!(
                    encoder,
                    w!("SlicesPerFrame"),
                    AmfVariant::int64(params.slices_per_frame as i64)
                );
            }
        }

        eprintln!(
            "amf: H.264 encoder ready ({}x{} @ {}fps, {}kbps)",
            params.width, params.height, params.fps, params.bitrate_kbps
        );
        Ok(AmfEncoder {
            _library: LibraryGuard(library),
            _factory: factory,
            context,
            encoder,
            pending: VecDeque::new(),
            handles: VecDeque::new(),
        })
    }

    /// Drains every completed output buffer into `pending`.
    fn drain_outputs(&mut self) -> Result<(), String> {
        unsafe {
            let vtbl = *(self.encoder as *const *const AmfComponentVtbl);
            loop {
                let mut data: *mut c_void = ptr::null_mut();
                let result = ((*vtbl).query_output)(self.encoder, &mut data);
                if result != AMF_OK || data.is_null() {
                    break;
                }
                let mut buffer: *mut c_void = ptr::null_mut();
                let qi = {
                    let vtbl = storage_vtbl(data);
                    ((*vtbl).query_interface)(data, &IID_AMF_BUFFER, &mut buffer)
                };
                if qi == AMF_OK && !buffer.is_null() {
                    let bvtbl = *(buffer as *const *const AmfBufferVtbl);
                    let size = ((*bvtbl).get_size)(buffer);
                    let native = ((*bvtbl).get_native)(buffer);
                    let bytes = if native.is_null() || size == 0 {
                        Vec::new()
                    } else {
                        std::slice::from_raw_parts(native as *const u8, size).to_vec()
                    };
                    // OutputDataType: 0 = IDR, 1 = I, 2 = P, 3 = B
                    let mut variant = AmfVariant::EMPTY;
                    let _ = get_property(buffer, w!("OutputDataType"), &mut variant);
                    let idr = variant.as_int64() == OUTPUT_DATA_TYPE_IDR;
                    self.pending.push_back((bytes, idr));
                    release(buffer);
                }
                release(data);
            }
        }
        Ok(())
    }
}

impl TextureEncoder for AmfEncoder {
    fn submit(
        &mut self,
        texture: *mut c_void,
        force_idr: bool,
        handle: SubmitHandle,
    ) -> Result<SubmitState, String> {
        unsafe {
            let cvtbl = *(self.context as *const *const AmfContextVtbl);
            let mut surface: *mut c_void = ptr::null_mut();
            let result = ((*cvtbl).create_surface_from_dx11_native)(
                self.context,
                texture,
                &mut surface,
                ptr::null_mut(),
            );
            if result != AMF_OK || surface.is_null() {
                return Err(format!("CreateSurfaceFromDX11Native failed: {result:#x}"));
            }
            if force_idr {
                // SPS/PPS must ride along with forced IDRs (infinite GOP)
                set!(surface, w!("ForcePictureType"), AmfVariant::int64(PICTURE_TYPE_IDR));
                set!(surface, w!("InsertSPS"), AmfVariant::int64(1));
                set!(surface, w!("InsertPPS"), AmfVariant::int64(1));
            }
            let evtbl = *(self.encoder as *const *const AmfComponentVtbl);
            let mut result = ((*evtbl).submit_input)(self.encoder, surface);
            let mut guard = 0;
            while result == AMF_INPUT_FULL && guard < 100 {
                self.drain_outputs()?;
                result = ((*evtbl).submit_input)(self.encoder, surface);
                guard += 1;
            }
            // SubmitInput does not consume the caller's reference
            release(surface);
            if result != AMF_OK {
                return Err(format!("SubmitInput failed: {result:#x}"));
            }
        }
        self.handles.push_back(handle);
        Ok(SubmitState::Submitted)
    }

    fn poll(&mut self) -> Result<Vec<(Vec<u8>, bool, SubmitHandle, bool)>, String> {
        self.drain_outputs()?;
        let mut drained = Vec::new();
        while let Some((data, idr)) = self.pending.pop_front() {
            let handle = self.handles.pop_front().unwrap_or(0);
            // AMF has no reference-frame invalidation: 0x0301 falls back
            // to a full IDR and the mark never rides a frame
            drained.push((data, idr, handle, false));
        }
        Ok(drained)
    }

    fn set_bitrate(&mut self, kbps: u32) -> Result<(), String> {
        // AMF applies bitrate changes via post-init SetProperty
        unsafe {
            set!(
                self.encoder,
                w!("TargetBitrate"),
                AmfVariant::int64((kbps * 1000) as i64)
            );
            set!(
                self.encoder,
                w!("PeakBitrate"),
                AmfVariant::int64((kbps * 1000) as i64)
            );
        }
        Ok(())
    }

    fn pending_depth(&self) -> usize {
        self.pending.len()
    }
}

impl Drop for AmfEncoder {
    fn drop(&mut self) {
        unsafe {
            if !self.encoder.is_null() {
                let vtbl = *(self.encoder as *const *const AmfComponentVtbl);
                ((*vtbl).terminate)(self.encoder);
                ((*vtbl).storage.release)(self.encoder);
            }
            if !self.context.is_null() {
                let vtbl = *(self.context as *const *const AmfContextVtbl);
                ((*vtbl).terminate)(self.context);
                ((*vtbl).storage.release)(self.context);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variant_layout_matches_amf_headers() {
        // union sits at offset 8 (type + 4-byte pad for 8-byte alignment)
        let int64 = AmfVariant::int64(0x0102_0304_0506_0708);
        assert_eq!(int64.ty, 2); // AMF_VARIANT_INT64
        let bytes =
            unsafe { std::slice::from_raw_parts(&int64 as *const _ as *const u8, 24) };
        assert_eq!(
            &bytes[8..16],
            &0x0102_0304_0506_0708i64.to_le_bytes(),
            "int64Value must start at offset 8"
        );
        assert_eq!(bytes.len(), 24);

        let boolean = AmfVariant::bool_(true);
        assert_eq!(boolean.ty, 1);
        assert_eq!(i32::from_le_bytes(boolean.value[..4].try_into().unwrap()), 1);

        let size = AmfVariant::size(1280, 720);
        assert_eq!(size.ty, 5); // AMF_VARIANT_SIZE
        assert_eq!(i32::from_le_bytes(size.value[..4].try_into().unwrap()), 1280);
        assert_eq!(i32::from_le_bytes(size.value[4..8].try_into().unwrap()), 720);

        let rate = AmfVariant::rate(60, 1);
        assert_eq!(rate.ty, 7); // AMF_VARIANT_RATE
        assert_eq!(u32::from_le_bytes(rate.value[..4].try_into().unwrap()), 60);
        assert_eq!(u32::from_le_bytes(rate.value[4..8].try_into().unwrap()), 1);
    }

    #[test]
    fn amf_buffer_iid_matches_header() {
        let guid = IID_AMF_BUFFER;
        assert_eq!(guid.data1, 0xb04b7248);
        assert_eq!(guid.data2, 0xb6f0);
        assert_eq!(guid.data3, 0x4321);
        assert_eq!(
            [
                guid.data41, guid.data42, guid.data43, guid.data44, guid.data45, guid.data46,
                guid.data47, guid.data48,
            ],
            [0xb6, 0x91, 0xba, 0xa4, 0x74, 0x0f, 0x9f, 0xcb]
        );
    }
}
