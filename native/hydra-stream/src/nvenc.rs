//! NVENC encoder for H.264 and HEVC, loaded at runtime from
//! `nvEncodeAPI64.dll` (LoadLibrary/GetProcAddress — the driver ships the
//! DLL, no import lib).
//!
//! Struct layouts are modeled as zeroed byte buffers with accessors at
//! offsets verified against the real `nvEncodeAPI.h` (compiled with the
//! project toolchain to dump sizes/offsets) — the C structs are versioned
//! and padding-heavy, so offsets are the contract, not field names. The
//! codec configs are members of one union and have different layouts, so
//! each codec carries its own offset block.
//!
//! Settings mirror Sunshine's low-latency configuration
//! (`nvenc_base.cpp`): P4 preset + ULTRA_LOW_LATENCY tuning info, CBR at the
//! bitrate negotiated in the RTSP ANNOUNCE, no B-frames
//! (`frameIntervalP = 1`, `zeroReorderDelay`), infinite GOP with
//! `repeatSPSPPS` and IDR only on demand, CABAC (H.264), and `sliceMode = 3`
//! with the client-requested slice count. HEVC adds only its GUIDs and its
//! codec config block — same rate control, same VBV, same low-latency
//! tuning. Input is the DXGI desktop duplication texture registered
//! zero-copy as a DIRECTX resource.
//! Encoding runs in asynchronous mode (`enableEncodeAsync = 1`) with a
//! registered completion event, exactly like Sunshine: each frame waits
//! on its completion event (100ms cap) and then locks the bitstream with
//! `doNotWait`. The synchronous `NvEncLockBitstream` wait instead
//! round-trips through the busy D3D11 device once per call, which under
//! a GPU-saturating game serializes every frame behind several GPU
//! scheduling quanta (measured: 26-295ms per frame, stream at 7Hz).

use std::collections::HashMap;
use std::ffi::c_void;
use std::ptr;

use windows::Win32::Foundation::{CloseHandle, HANDLE, HMODULE};
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

use crate::capture::{SubmitHandle, SubmitState, TextureEncoder};
use crate::video::VideoCodec;

pub type NvEncStatus = u32;
pub const NV_ENC_SUCCESS: NvEncStatus = 0;

/// Header SDK version (13.1). The actual version used at runtime is
/// clamped to what the installed driver supports.
pub const NVENCAPI_VERSION: u32 = 13 | (1 << 24);
const fn struct_version(api_version: u32, version: u16) -> u32 {
    api_version | ((version as u32) << 16) | (0x7 << 28)
}

/// C `GUID` memory layout (little-endian data1-3, raw data4).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct NvGuid {
    pub data1: u32,
    pub data2: u16,
    pub data3: u16,
    pub data4: [u8; 8],
}

impl NvGuid {
    pub const fn new(data1: u32, data2: u16, data3: u16, data4: [u8; 8]) -> Self {
        NvGuid {
            data1,
            data2,
            data3,
            data4,
        }
    }
    pub fn to_bytes(self) -> [u8; 16] {
        let mut bytes = [0u8; 16];
        bytes[0..4].copy_from_slice(&self.data1.to_le_bytes());
        bytes[4..6].copy_from_slice(&self.data2.to_le_bytes());
        bytes[6..8].copy_from_slice(&self.data3.to_le_bytes());
        bytes[8..16].copy_from_slice(&self.data4);
        bytes
    }
}

const GUID_H264: NvGuid = NvGuid::new(
    0x6bc82762,
    0x4e63,
    0x4ca4,
    [0xaa, 0x85, 0x1e, 0x50, 0xf3, 0x21, 0xf6, 0xbf],
);
/// `NV_ENC_CODEC_HEVC_GUID`, `{790CDC88-4522-4d7b-9425-BDA9975F7603}`
/// (nvEncodeAPI.h:148, cross-checked against FFmpeg's nv-codec-headers).
const GUID_HEVC: NvGuid = NvGuid::new(
    0x790cdc88,
    0x4522,
    0x4d7b,
    [0x94, 0x25, 0xbd, 0xa9, 0x97, 0x5f, 0x76, 0x03],
);
const GUID_PRESET_P4: NvGuid = NvGuid::new(
    0x90a7b826,
    0xdf06,
    0x4862,
    [0xb9, 0xd2, 0xcd, 0x6d, 0x73, 0xa0, 0x86, 0x81],
);
const GUID_PROFILE_HIGH: NvGuid = NvGuid::new(
    0xe7cbc309,
    0x4f7a,
    0x4b89,
    [0xaf, 0x2a, 0xd5, 0x37, 0xc9, 0x2b, 0xe3, 0x10],
);
/// `NV_ENC_HEVC_PROFILE_MAIN_GUID`,
/// `{b514c39a-b55b-40fa-878f-f1253b4dfdec}` (nvEncodeAPI.h:202). Main
/// (8-bit 4:2:0) is the profile HEVC SDR clients negotiate; the 10-bit
/// Main10 profile this host will need for HDR carries a different GUID.
const GUID_PROFILE_HEVC_MAIN: NvGuid = NvGuid::new(
    0xb514c39a,
    0xb55b,
    0x40fa,
    [0x87, 0x8f, 0xf1, 0x25, 0x3b, 0x4d, 0xfd, 0xec],
);

/// The NVENC codec GUID for a session's negotiated codec.
fn encode_guid(codec: VideoCodec) -> NvGuid {
    match codec {
        VideoCodec::H264 => GUID_H264,
        VideoCodec::Hevc => GUID_HEVC,
    }
}

/// The profile GUID the config is initialized with (Sunshine's
/// `profileGUID` in `nvenc_base.cpp:346/385`: High for H.264, Main for
/// HEVC — the 4:4:4 variants are only selected for a 4:4:4 buffer).
fn profile_guid(codec: VideoCodec) -> NvGuid {
    match codec {
        VideoCodec::H264 => GUID_PROFILE_HIGH,
        VideoCodec::Hevc => GUID_PROFILE_HEVC_MAIN,
    }
}

const RC_MODE_CBR: u32 = 2;
/// `NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY` (the tuning value right after
/// LOW_LATENCY in the enum). Sunshine initializes NVENC with it
/// (`src/nvenc/nvenc_base.cpp:638`:
/// `init_params.tuningInfo = NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY;`).
/// It cannot be probed here: `NvEncGetEncodePresetConfigEx` is broken on
/// this driver (DEVICE_NOT_EXIST), which is why the config is hand-built
/// anyway. A driver that rejects the tuning only surfaces as the startup
/// recovery probe (`capture::probe_recovery_capability`, a real session)
/// reporting `rfi: false`.
const TUNING_ULTRA_LOW_LATENCY: u32 = 3;
const BUFFER_FORMAT_ARGB: u32 = 0x0100_0000;
const RESOURCE_TYPE_DIRECTX: u32 = 0;
const DEVICE_TYPE_DIRECTX: u32 = 0;
const MULTI_PASS_DISABLED: u32 = 0;
const PIC_STRUCT_FRAME: u32 = 1;
pub const PIC_FLAG_FORCEIDR: u32 = 0x2;
const ENTROPY_CABAC: u32 = 1;
const INFINITE_GOP: u32 = 0xffff_ffff;

const REPEAT_SPS_PPS_BIT: u32 = 1 << 12; // bit 12 of the first word
const ZERO_REORDER_DELAY_BIT: u32 = 1 << 9; // bit 9 of the rc bitfield word

/// Fixed-capacity byte buffer with little-endian field accessors at
/// offsets verified against the reference header.
macro_rules! fixed_buffer {
    ($name:ident, $size:expr) => {
        #[repr(C, align(8))]
        pub struct $name([u8; $size]);

        impl $name {
            pub fn zeroed() -> Self {
                Self([0; $size])
            }
            pub fn set_u32(&mut self, offset: usize, value: u32) {
                self.0[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
            }
            pub fn u32_at(&self, offset: usize) -> u32 {
                u32::from_le_bytes(self.0[offset..offset + 4].try_into().unwrap())
            }
            pub fn set_i32(&mut self, offset: usize, value: i32) {
                self.set_u32(offset, value as u32);
            }
            pub fn set_u64(&mut self, offset: usize, value: u64) {
                self.0[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
            }
            pub fn set_ptr(&mut self, offset: usize, value: *mut c_void) {
                self.set_u64(offset, value as u64);
            }
            pub fn ptr_at(&self, offset: usize) -> *mut c_void {
                self.u64_at_offset(offset) as *mut c_void
            }
            fn u64_at_offset(&self, offset: usize) -> u64 {
                u64::from_le_bytes(self.0[offset..offset + 8].try_into().unwrap())
            }
            pub fn or_u32(&mut self, offset: usize, bits: u32) {
                self.set_u32(offset, self.u32_at(offset) | bits);
            }
            pub fn as_mut_ptr(&mut self) -> *mut c_void {
                self.0.as_mut_ptr() as *mut c_void
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::zeroed()
            }
        }
    };
}

fixed_buffer!(FunctionList, 2552);
fixed_buffer!(OpenSessionParams, 1552);
fixed_buffer!(InitializeParams, 1800);
fixed_buffer!(EncoderConfig, 3584);
fixed_buffer!(ReconfigureParams, 1816);
fixed_buffer!(RegisterResourceParams, 1536);
fixed_buffer!(MapInputParams, 1544);
fixed_buffer!(PicParams, 3360);
fixed_buffer!(LockBitstreamParams, 1544);
fixed_buffer!(BitstreamBufferParams, 776);
fixed_buffer!(EventParams, 1032);
fixed_buffer!(CapsParam, 256); // NV_ENC_CAPS_PARAM

// NV_ENC_CAPS ordinals (verified with the C probe against nvEncodeAPI.h).
const CAPS_SUPPORT_CUSTOM_VBV_BUF_SIZE: i32 = 26;
const CAPS_SUPPORT_REF_PIC_INVALIDATION: i32 = 28;

/// numRefFrames configured when the client does not ask for a depth
/// ("host picks"): Sunshine's H.264 `default_count` (nvenc_base.cpp:272).
/// A DPB deeper than one frame is also what makes reference-frame
/// invalidation worth anything — with a single reference, invalidating a
/// range is no cheaper than a full IDR (Sunshine compares the same way,
/// nvenc_base.cpp:817).
pub const REF_FRAMES_DEFAULT: u32 = 5;
/// Hard ceiling for the configured DPB depth (Sunshine's H.264 DPB scale,
/// nvenc_base.cpp:114). H.264 levels for our resolutions do not allow more.
pub const REF_FRAMES_MAX: u32 = 16;

// Function-list entry offsets: 8 + (index - 1) * 8 for entry `index`
// (1-based, matching NV_ENCODE_API_FUNCTION_LIST field order).
const OFF_OPEN_ENCODE_SESSION_EX: usize = 8 + 29 * 8;
const OFF_INITIALIZE_ENCODER: usize = 8 + 11 * 8; // entry 12
const OFF_GET_ENCODE_CAPS: usize = 8 + 7 * 8;
const OFF_CREATE_BITSTREAM_BUFFER: usize = 8 + 14 * 8;
// entry 16 (the old 8 + 13*8 pointed at nvEncDestroyInputBuffer: the call
// silently failed and every bitstream buffer leaked until the session
// died — verified with the C probe against nvEncodeAPI.h)
const OFF_DESTROY_BITSTREAM_BUFFER: usize = 8 + 15 * 8;
const OFF_INVALIDATE_REF_FRAMES: usize = 8 + 28 * 8;
const OFF_REGISTER_ASYNC_EVENT: usize = 8 + 23 * 8; // entry 24
const OFF_UNREGISTER_ASYNC_EVENT: usize = 8 + 24 * 8; // entry 25
/// NvEncReconfigureEncoder (verified against nvEncodeAPI.h with the
/// offset probe: offsetof(NV_ENCODE_API_FUNCTION_LIST,
/// nvEncReconfigureEncoder) == 264).
const OFF_RECONFIGURE_ENCODER: usize = 264;
const OFF_ENCODE_PICTURE: usize = 8 + 16 * 8;
const OFF_LOCK_BITSTREAM: usize = 8 + 17 * 8;
const OFF_UNLOCK_BITSTREAM: usize = 8 + 18 * 8;
const OFF_MAP_INPUT_RESOURCE: usize = 8 + 25 * 8;
const OFF_UNMAP_INPUT_RESOURCE: usize = 8 + 26 * 8;
const OFF_DESTROY_ENCODER: usize = 8 + 27 * 8;
const OFF_REGISTER_RESOURCE: usize = 8 + 30 * 8;
const OFF_UNREGISTER_RESOURCE: usize = 8 + 31 * 8;

// NV_ENC_INITIALIZE_PARAMS field offsets (verified).
const INIT_VERSION: usize = 0;
const INIT_ENCODE_GUID: usize = 4;
const INIT_PRESET_GUID: usize = 20;
const INIT_ENCODE_WIDTH: usize = 36;
const INIT_ENCODE_HEIGHT: usize = 40;
const INIT_DAR_WIDTH: usize = 44;
const INIT_DAR_HEIGHT: usize = 48;
const INIT_FRAME_RATE_NUM: usize = 52;
const INIT_FRAME_RATE_DEN: usize = 56;
const INIT_FLAGS: usize = 60;
const INIT_PTD: usize = 64;
const INIT_ENCODE_CONFIG: usize = 88;
const INIT_TUNING_INFO: usize = 136;

// NV_ENC_CONFIG field offsets (verified).
const CFG_VERSION: usize = 0;
const CFG_PROFILE_GUID: usize = 4;
const CFG_GOP_LENGTH: usize = 20;
const CFG_FRAME_INTERVAL_P: usize = 24;
const CFG_FRAME_FIELD_MODE: usize = 32; // 1 = frame mode, 0 is invalid
const CFG_RC_PARAMS: usize = 40;
const CFG_CODEC_CONFIG: usize = 168;

// NV_ENC_RC_PARAMS offsets relative to rcParams start (verified).
const RC_RATE_CONTROL_MODE: usize = 4;
const RC_AVERAGE_BITRATE: usize = 20;
const RC_MAX_BITRATE: usize = 24;
const RC_VBV_BUFFER_SIZE: usize = 28;
const RC_BITFIELD: usize = 36;
const RC_MULTI_PASS: usize = 100;

// NV_ENC_CONFIG_H264 offsets relative to encodeCodecConfig start (verified).
const H264_WORD0: usize = 0;
const H264_IDR_PERIOD: usize = 8;
const H264_ENTROPY_CODING: usize = 44;
const H264_MAX_REF_FRAMES: usize = 60;
const H264_SLICE_MODE: usize = 64;
const H264_SLICE_MODE_DATA: usize = 68;
const H264_CHROMA_FORMAT: usize = 192; // 1 = 4:2:0, 0 is invalid
/// offsetof(NV_ENC_CONFIG_H264, h264VUIParameters) relative to
/// encodeCodecConfig start (verified with the C probe against
/// nvEncodeAPI.h). The header typedefs NV_ENC_CONFIG_HEVC_VUI_PARAMETERS
/// to the same struct, so the VUI_* offsets below serve both codecs.
const H264_VUI_PARAMETERS: usize = 72;
/// offsetof(NV_ENC_CONFIG_HEVC, hevcVUIParameters) — verified the same way;
/// ready for the HEVC path (the branch currently encodes H.264 only).
const HEVC_VUI_PARAMETERS: usize = 64;

// NV_ENC_CONFIG_H264_VUI_PARAMETERS field offsets relative to the VUI
// struct start (verified with the C probe against nvEncodeAPI.h; applies
// to the HEVC VUI too, see above).
const VUI_VIDEO_SIGNAL_TYPE_PRESENT: usize = 8;
const VUI_VIDEO_FORMAT: usize = 12;
const VUI_VIDEO_FULL_RANGE_FLAG: usize = 16;
const VUI_COLOUR_DESCRIPTION_PRESENT: usize = 20;
const VUI_COLOR_PRIMARIES: usize = 24;
const VUI_TRANSFER_CHARACTERISTICS: usize = 28;
const VUI_COLOR_MATRIX: usize = 32;
const VUI_CHROMA_SAMPLE_LOCATION_FLAG: usize = 36;
const VUI_CHROMA_SAMPLE_LOCATION_TOP: usize = 40;
const VUI_CHROMA_SAMPLE_LOCATION_BOT: usize = 44;
const VUI_BITSTREAM_RESTRICTION: usize = 48;

// NV_ENC_CONFIG_H264_VUI_PARAMETERS values for SDR BT.709 (verified with
// the C probe against nvEncodeAPI.h: every *_BT709 enumerator is 1,
// NV_ENC_VUI_VIDEO_FORMAT_UNSPECIFIED is 5). Sunshine's SDR colourspace
// (nvenc_utils.cpp: nvenc_colorspace_from_sunshine_colorspace).
const VUI_VIDEO_FORMAT_UNSPECIFIED: u32 = 5;
const VUI_COLOR_PRIMARIES_BT709: u32 = 1;
const VUI_TRANSFER_CHARACTERISTICS_BT709: u32 = 1;
const VUI_COLOR_MATRIX_BT709: u32 = 1;

// NV_ENC_CONFIG_HEVC offsets relative to encodeCodecConfig start. The two
// codec configs are members of the same NV_ENC_CODEC_CONFIG union, so both
// start at CFG_CODEC_CONFIG — but the layouts differ, which is why these
// numbers cannot be reused from the H.264 block. Verified with the same
// compiled C probe as the H.264 offsets, against nvEncodeAPI.h.
const HEVC_WORD0: usize = 16; // bitfield word: repeatSPSPPS = bit 7, chromaFormatIDC = bits 9-10
const HEVC_IDR_PERIOD: usize = 20;
const HEVC_MAX_REF_FRAMES: usize = 32; // maxNumRefFramesInDPB
const HEVC_SLICE_MODE: usize = 52;
const HEVC_SLICE_MODE_DATA: usize = 56;
/// repeatSPSPPS in the HEVC bitfield word is bit 7 (H.264's is bit 12).
const HEVC_REPEAT_SPS_PPS_BIT: u32 = 1 << 7;
/// chromaFormatIDC is a 2-bit field at bits 9-10 of the HEVC bitfield word
/// (H.264's is a whole u32 field at offset 192). 1 = 4:2:0; leaving the
/// field zero is rejected by the driver.
const HEVC_CHROMA_FORMAT_IDC_420: u32 = 1 << 9;

// NV_ENC_REGISTER_RESOURCE offsets (verified).
const REG_VERSION: usize = 0;
const REG_RESOURCE_TYPE: usize = 4;
const REG_WIDTH: usize = 8;
const REG_HEIGHT: usize = 12;
const REG_PITCH: usize = 16;
const REG_RESOURCE: usize = 24;
const REG_REGISTERED: usize = 32;
const REG_BUFFER_FORMAT: usize = 40;

// NV_ENC_MAP_INPUT_RESOURCE offsets (verified).
const MAP_VERSION: usize = 0;
const MAP_REGISTERED: usize = 16;
const MAP_MAPPED: usize = 24;

// NV_ENC_PIC_PARAMS offsets (verified).
const PIC_VERSION: usize = 0;
const PIC_INPUT_WIDTH: usize = 4;
const PIC_INPUT_HEIGHT: usize = 8;
const PIC_INPUT_PITCH: usize = 12;
const PIC_ENCODE_FLAGS: usize = 16;
const PIC_FRAME_IDX: usize = 20;
const PIC_INPUT_BUFFER: usize = 40;
const PIC_OUTPUT_BITSTREAM: usize = 48;
/// completionEvent: signaled by the driver when this frame's bitstream
/// is ready (asynchronous mode only).
const PIC_COMPLETION_EVENT: usize = 56;
const PIC_BUFFER_FMT: usize = 64;
const PIC_PICTURE_STRUCT: usize = 68;

// NV_ENC_LOCK_BITSTREAM offsets (verified).
const LOCK_VERSION: usize = 0;
/// Bitfield word after version: bit 0 is doNotWait (return without
/// blocking; the completion event already guaranteed readiness).
const LOCK_DO_NOT_WAIT: usize = 4;
const LOCK_OUTPUT_BITSTREAM: usize = 8;
const LOCK_SIZE: usize = 36;
const LOCK_BUFFER_PTR: usize = 56;

// NV_ENC_EVENT_PARAMS offsets (verified).
const EVENT_VERSION: usize = 0;
const EVENT_COMPLETION: usize = 8;

// NV_ENC_CREATE_BITSTREAM_BUFFER offsets (verified).
const BS_VERSION: usize = 0;
const BS_BUFFER: usize = 16;

// NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS offsets (verified).
const SESS_VERSION: usize = 0;
const SESS_DEVICE_TYPE: usize = 4;
const SESS_DEVICE: usize = 8;
const SESS_API_VERSION: usize = 24;

#[derive(Clone, Copy)]
pub struct EncoderConfigParams {
    /// The codec this session encodes, from the client's ANNOUNCE (see
    /// [`crate::video::VideoCodec`]). It selects the NVENC encode GUID,
    /// the profile GUID and the codec-specific config block — everything
    /// else (rate control, GOP, low latency) is identical for both.
    pub codec: VideoCodec,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub slices_per_frame: u32,
    /// DPB depth (numRefFrames) for this session: the client's
    /// `x-nv-video[0].maxNumReferenceFrames` resolved against the startup
    /// probe (see `capture::resolve_ref_frames`). Clamped to
    /// [`REF_FRAMES_MAX`] and at least 1 inside the config builder.
    pub max_ref_frames: u32,
}

struct RegisteredInput {
    registered: *mut c_void,
}

/// One asynchronous encode in flight: which slot's bitstream buffer and
/// completion event it was submitted with, the mapped input to unmap when
/// it completes, and the caller's bookkeeping handle (the caller stamps
/// capture time / idr on the delivered frame). `after_invalidation` is
/// set when a reference-frame invalidation was requested between the
/// previous submission and this one (Sunshine's
/// after_ref_frame_invalidation, surfaced as frameType 5).
struct InFlight {
    mapped: *mut c_void,
    slot: usize,
    handle: usize,
    after_invalidation: bool,
}

/// A bitstream buffer + its completion event. Asynchronous encodes are
/// pipelined two deep: production of frame N+1 (copy + scale + submit)
/// overlaps the GPU-side encode of frame N, so a saturated GPU drains
/// both frames' work in a single scheduling quantum instead of paying
/// one quantum per dependency of a serial submit-wait chain.
struct EncodeSlot {
    bitstream: *mut c_void,
    event: HANDLE,
}

const PIPELINE_DEPTH: usize = 2;

/// Loaded NVENC API table + open encoder session.
// Raw driver handles are only touched from the video thread.
unsafe impl Send for NvencEncoder {}

pub struct NvencEncoder {
    _library: HMODULE,
    api_version: u32,
    function_list: Box<FunctionList>,
    encoder: *mut c_void,
    slots: Vec<EncodeSlot>,
    /// FIFO of submitted-but-not-yet-reaped encodes (oldest first).
    in_flight: std::collections::VecDeque<InFlight>,
    /// Registration of a slot's completion event failed: submit waits
    /// for each encode inline (the historical synchronous behavior).
    sync_fallback: bool,
    /// Synchronous submissions land here, drained by poll(): (bitstream,
    /// encoder-side idr flag, caller handle, after-invalidation mark).
    completed: std::collections::VecDeque<(Vec<u8>, bool, usize, bool)>,
    inputs: HashMap<usize, RegisteredInput>,
    /// Resolved params (desktop resolution at init); reconfigure rebuilds
    /// from these so adaptive bitrate changes keep every other setting.
    config: EncoderConfigParams,
    pub width: u32,
    pub height: u32,
    frame_index: u32,
    /// Last submitted NV_ENC_PIC_PARAMS frameIdx, for reference-frame
    /// invalidation (Sunshine tracks the same as last_encoded_frame_index).
    last_encoded_frame_index: i64,
    /// Probed once per session (nvEncGetEncodeCaps): the one-frame VBV
    /// sizing is only legal when the driver supports a client-set buffer
    /// size (Sunshine nvenc_base.cpp:278).
    supports_custom_vbv: bool,
    /// NV_ENC_CAPS_SUPPORT_REF_PIC_INVALIDATION *and* a DPB deeper than
    /// one frame: invalidating a range inside a 1-frame DPB is no cheaper
    /// than a full IDR, so the capability alone is not enough.
    supports_ref_invalidation: bool,
    /// The DPB depth this session was configured with (numRefFrames); the
    /// invalidation range check compares against it (Sunshine's
    /// encoder_params.ref_frames_in_dpb).
    ref_frames_in_dpb: u32,
    /// An invalidation request arrived and the next submitted frame must
    /// carry the after-invalidation mark (the packetizer turns it into
    /// frameType 5). Sunshine's rfi_needs_confirmation.
    rfi_pending: bool,
    /// Last range handed to nvEncInvalidateRefFrames (Sunshine's
    /// last_rfi_range): a retransmitted client request inside it is
    /// already done.
    last_rfi_range: (i64, i64),
}

// Raw NVENC entry points; the function list slots hold stdcall-compatible
// (x64 single calling convention) function pointers.
type FnOpenSessionEx = unsafe extern "C" fn(*mut c_void, *mut *mut c_void) -> NvEncStatus;
type FnEncoderParams = unsafe extern "C" fn(*mut c_void, *mut c_void) -> NvEncStatus;
type FnHandleParam = unsafe extern "C" fn(*mut c_void, *mut c_void) -> NvEncStatus;
type FnHandleOnly = unsafe extern "C" fn(*mut c_void) -> NvEncStatus;
type FnTwoHandles = unsafe extern "C" fn(*mut c_void, *mut c_void) -> NvEncStatus;
// NvEncGetEncodeCaps(void* encoder, GUID encodeGUID, NV_ENC_CAPS_PARAM*,
// int* capsVal): the GUID travels by value in two integer registers.
type FnGetEncodeCaps =
    unsafe extern "C" fn(*mut c_void, NvGuid, *mut c_void, *mut i32) -> NvEncStatus;
// NvEncInvalidateRefFrames(void* encoder, uint64_t invalidRefFrameTimeStamp)
type FnInvalidateRefFrames = unsafe extern "C" fn(*mut c_void, u64) -> NvEncStatus;

// NV_ENC_RECONFIGURE_PARAMS offsets (verified with the C probe against
// nvEncodeAPI.h): version u32, reserved u32, then the full 1800-byte
// NV_ENC_INITIALIZE_PARAMS, then the resetEncoder/forceIDR bitfield word.
const RECONFIG_VERSION: usize = 0;
const RECONFIG_INIT_PARAMS: usize = 8;
const RECONFIG_BITFIELD: usize = 1808;
/// resetEncoder (bit 0) + forceIDR (bit 1): the header mandates
/// resetEncoder only together with an IDR.
const RECONFIG_RESET_AND_FORCE_IDR: u32 = 0b11;

/// Sunshine's configure_h264_hevc_metadata for SDR BT.709
/// (nvenc_base.cpp:307-321). NVENC converts our BGRA texture to YUV
/// itself; without VUI colour metadata the decoder assumes the wrong
/// range/matrix and the picture decodes uniformly too bright.
/// `vui_offset` is the codec's VUI struct offset inside
/// encodeCodecConfig (H264_VUI_PARAMETERS or HEVC_VUI_PARAMETERS) — the
/// header typedefs both VUI structs to the same layout.
fn configure_sdr_colour_metadata(config: &mut EncoderConfig, vui_offset: usize) {
    let vui = CFG_CODEC_CONFIG + vui_offset;
    // limited (MPEG) range: videoFullRangeFlag = 0, i.e. Sunshine's
    // colorRange = NV_ENC_COLOR_RANGE_MPEG expressed through the H.264 /
    // HEVC VUI (those configs carry no colour fields of their own; the
    // direct colourPrimaries/... fields exist on the AV1 config only).
    config.set_u32(vui + VUI_VIDEO_SIGNAL_TYPE_PRESENT, 1);
    config.set_u32(vui + VUI_VIDEO_FORMAT, VUI_VIDEO_FORMAT_UNSPECIFIED);
    config.set_u32(vui + VUI_VIDEO_FULL_RANGE_FLAG, 0);
    config.set_u32(vui + VUI_COLOUR_DESCRIPTION_PRESENT, 1);
    config.set_u32(vui + VUI_COLOR_PRIMARIES, VUI_COLOR_PRIMARIES_BT709);
    config.set_u32(
        vui + VUI_TRANSFER_CHARACTERISTICS,
        VUI_TRANSFER_CHARACTERISTICS_BT709,
    );
    config.set_u32(vui + VUI_COLOR_MATRIX, VUI_COLOR_MATRIX_BT709);
    // 4:2:0 output, so the chroma-sample-location fields are present
    // (Sunshine passes 0 here only for yuv444 buffers)
    config.set_u32(vui + VUI_CHROMA_SAMPLE_LOCATION_FLAG, 1);
    config.set_u32(vui + VUI_CHROMA_SAMPLE_LOCATION_TOP, 0);
    config.set_u32(vui + VUI_CHROMA_SAMPLE_LOCATION_BOT, 0);
    config.set_u32(vui + VUI_BITSTREAM_RESTRICTION, 1);
}

/// Builds the low-latency NV_ENC_INITIALIZE_PARAMS for the session's
/// codec (zeroed NV_ENC_CONFIG plus Sunshine's nvenc_base.cpp settings:
/// CBR at the negotiated bitrate, no B-frames, infinite GOP with
/// repeatSPSPPS, CABAC for H.264, sliceMode = 3). Everything the two
/// codecs share is written once; only the profile GUID, the codec config
/// block and the encode GUID are codec-specific. Shared by session
/// creation and the adaptive reconfigure; struct offsets verified against
/// nvEncodeAPI.h with the compiled C probe. Returns the embedded config
/// too: the init params point INTO it, so the caller must keep it alive
/// across the NVENC call. `custom_vbv_cap` is the probed
/// SUPPORT_CUSTOM_VBV_BUF_SIZE: the VBV buffer may only be client-sized
/// when the driver allows it.
fn build_init_params(
    api_version: u32,
    params: &EncoderConfigParams,
    custom_vbv_cap: bool,
) -> (InitializeParams, EncoderConfig) {
    let ver_initialize = struct_version(api_version, 7) | (1 << 31);
    let ver_config = struct_version(api_version, 9) | (1 << 31);
    let ver_rc_params = struct_version(api_version, 1);

    let mut config = EncoderConfig::zeroed();
    config.set_u32(CFG_VERSION, ver_config);
    config.set_guid(CFG_PROFILE_GUID, profile_guid(params.codec));
    config.set_u32(CFG_FRAME_FIELD_MODE, 1);
    config.set_u32(CFG_GOP_LENGTH, INFINITE_GOP);
    config.set_i32(CFG_FRAME_INTERVAL_P, 1); // no B-frames
    config.set_u32(CFG_RC_PARAMS + 0, ver_rc_params); // rcParams.version
    config.set_u32(CFG_RC_PARAMS + RC_RATE_CONTROL_MODE, RC_MODE_CBR);
    config.set_u32(CFG_RC_PARAMS + RC_AVERAGE_BITRATE, params.bitrate_kbps * 1000);
    config.set_u32(CFG_RC_PARAMS + RC_MAX_BITRATE, params.bitrate_kbps * 1000);
    if custom_vbv_cap {
        // One-frame VBV: bitrate * 1000 / framerate (Sunshine
        // nvenc_base.cpp:278-283). The old half-bitrate sizing let a
        // burst park up to 500ms of bits in the buffer — the encoded
        // latency the frame-age policy then dropped as stale.
        config.set_u32(
            CFG_RC_PARAMS + RC_VBV_BUFFER_SIZE,
            params.bitrate_kbps * 1000 / params.fps.max(1),
        );
    }
    config.or_u32(CFG_RC_PARAMS + RC_BITFIELD, ZERO_REORDER_DELAY_BIT);
    config.set_u32(CFG_RC_PARAMS + RC_MULTI_PASS, MULTI_PASS_DISABLED);
    let ref_frames = params.max_ref_frames.clamp(1, REF_FRAMES_MAX);
    match params.codec {
        VideoCodec::H264 => {
            config.or_u32(CFG_CODEC_CONFIG + H264_WORD0, REPEAT_SPS_PPS_BIT);
            config.set_u32(CFG_CODEC_CONFIG + H264_IDR_PERIOD, INFINITE_GOP);
            config.set_u32(CFG_CODEC_CONFIG + H264_ENTROPY_CODING, ENTROPY_CABAC);
            config.set_u32(CFG_CODEC_CONFIG + H264_MAX_REF_FRAMES, ref_frames);
            config.set_u32(CFG_CODEC_CONFIG + H264_SLICE_MODE, 3);
            config.set_u32(
                CFG_CODEC_CONFIG + H264_SLICE_MODE_DATA,
                params.slices_per_frame.max(1),
            );
            // a zeroed chromaFormatIDC is rejected by the driver; 4:2:0 for
            // standard clients (NVENC converts the BGRA input)
            config.set_u32(CFG_CODEC_CONFIG + H264_CHROMA_FORMAT, 1);
            // BT.709 primaries/transfer/matrix, limited range, so the
            // decoder applies the same conversion NVENC used (fixes the
            // uniformly too-bright picture; Sunshine
            // configure_h264_hevc_metadata)
            configure_sdr_colour_metadata(&mut config, H264_VUI_PARAMETERS);
        }
        VideoCodec::Hevc => {
            // Sunshine's configure_hevc (nvenc_base.cpp:385-397) sets
            // exactly the same three codec options as configure_h264:
            // repeatSPSPPS + infinite idrPeriod (so every parameter set the
            // client needs rides with an IDR and no IDR ever comes
            // spontaneously), sliceMode 3 with the client's slice count.
            config.or_u32(
                CFG_CODEC_CONFIG + HEVC_WORD0,
                HEVC_REPEAT_SPS_PPS_BIT | HEVC_CHROMA_FORMAT_IDC_420,
            );
            config.set_u32(CFG_CODEC_CONFIG + HEVC_IDR_PERIOD, INFINITE_GOP);
            config.set_u32(CFG_CODEC_CONFIG + HEVC_MAX_REF_FRAMES, ref_frames);
            config.set_u32(CFG_CODEC_CONFIG + HEVC_SLICE_MODE, 3);
            config.set_u32(
                CFG_CODEC_CONFIG + HEVC_SLICE_MODE_DATA,
                params.slices_per_frame.max(1),
            );
            // the same BT.709 VUI metadata as H.264, at the
            // C-probe-verified hevcVUIParameters offset
            configure_sdr_colour_metadata(&mut config, HEVC_VUI_PARAMETERS);
        }
    }

    let mut init = InitializeParams::zeroed();
    init.set_u32(INIT_VERSION, ver_initialize);
    init.set_guid(INIT_ENCODE_GUID, encode_guid(params.codec));
    init.set_guid(INIT_PRESET_GUID, GUID_PRESET_P4);
    init.set_u32(INIT_ENCODE_WIDTH, params.width);
    init.set_u32(INIT_ENCODE_HEIGHT, params.height);
    init.set_u32(INIT_DAR_WIDTH, params.width);
    init.set_u32(INIT_DAR_HEIGHT, params.height);
    init.set_u32(INIT_FRAME_RATE_NUM, params.fps.max(1));
    init.set_u32(INIT_FRAME_RATE_DEN, 1);
    init.set_u32(INIT_FLAGS, 1); // enableEncodeAsync = 1 (Sunshine: completion via registered event)
    init.set_u32(INIT_PTD, 1); // encoder picks picture types
    init.set_ptr(INIT_ENCODE_CONFIG, config.as_mut_ptr());
    init.set_u32(INIT_TUNING_INFO, TUNING_ULTRA_LOW_LATENCY);
    (init, config)
}

impl NvencEncoder {
    /// Opens an encode session on a D3D11 device pointer
    /// (`ID3D11Device` as `*mut c_void`) and configures the codec
    /// `params.codec` selects.
    pub fn new(device: *mut c_void, params: &EncoderConfigParams) -> Result<Self, String> {
        if device.is_null() {
            return Err("no D3D11 device".to_string());
        }
        let library = unsafe { LoadLibraryW(windows::core::w!("nvEncodeAPI64.dll")) }
            .map_err(|error| format!("LoadLibrary nvEncodeAPI64.dll: {error}"))?;

        let create_instance: unsafe extern "C" fn(*mut c_void) -> NvEncStatus =
            unsafe { GetProcAddress(library, windows::core::s!("NvEncodeAPICreateInstance")) }
                .map(|address| unsafe { std::mem::transmute(address) })
                .ok_or("NvEncodeAPICreateInstance not found")?;

        // Clamp the API version to what the driver supports; struct
        // version fields embed this value so they must be computed at
        // runtime too.
        let api_version = unsafe {
            let get_max: Option<unsafe extern "C" fn(*mut u32) -> NvEncStatus> =
                GetProcAddress(library, windows::core::s!("NvEncodeAPIGetMaxSupportedVersion"))
                    .map(|address| std::mem::transmute(address));
            let mut driver_version = 0u32;
            match get_max {
                Some(get_max) if get_max(&mut driver_version) == NV_ENC_SUCCESS => {
                    // driver encoding: (major << 4) | minor
                    let driver_api = (driver_version >> 4) | ((driver_version & 0xF) << 24);
                    eprintln!("nvenc: driver supports API {driver_api:#x}");
                    NVENCAPI_VERSION.min(driver_api)
                }
                _ => NVENCAPI_VERSION,
            }
        };
        let ver_function_list = struct_version(api_version, 2);
        let ver_open_session = struct_version(api_version, 1);

        let mut function_list = Box::new(FunctionList::zeroed());
        function_list.set_u32(0, ver_function_list);
        let status = unsafe { create_instance(function_list.as_mut_ptr()) };
        if status != NV_ENC_SUCCESS {
            return Err(format!("NvEncodeAPICreateInstance failed: {status:#x}"));
        }

        let mut encoder: *mut c_void = ptr::null_mut();

        // OpenEncodeSessionEx with the D3D11 device
        let mut session = OpenSessionParams::zeroed();
        session.set_u32(SESS_VERSION, ver_open_session);
        session.set_u32(SESS_DEVICE_TYPE, DEVICE_TYPE_DIRECTX);
        session.set_ptr(SESS_DEVICE, device);
        session.set_u32(SESS_API_VERSION, api_version);
        let open_session_ex: FnOpenSessionEx = unsafe {
            std::mem::transmute(function_list.ptr_at(OFF_OPEN_ENCODE_SESSION_EX))
        };
        let mut open_session = |encoder: &mut *mut c_void| -> Result<(), String> {
            let status = unsafe { open_session_ex(session.as_mut_ptr(), encoder) };
            if status != NV_ENC_SUCCESS || encoder.is_null() {
                return Err(format!("NvEncOpenEncodeSessionEx failed: {status:#x}"));
            }
            Ok(())
        };
        open_session(&mut encoder)?;

        let mut this = NvencEncoder {
            _library: library,
            api_version,
            function_list,
            encoder,
            slots: Vec::new(),
            in_flight: std::collections::VecDeque::new(),
            sync_fallback: false,
            completed: std::collections::VecDeque::new(),
            inputs: HashMap::new(),
            config: *params,
            width: params.width,
            height: params.height,
            frame_index: 0,
            last_encoded_frame_index: -1,
            supports_custom_vbv: false,
            supports_ref_invalidation: false,
            ref_frames_in_dpb: params.max_ref_frames.clamp(1, REF_FRAMES_MAX),
            rfi_pending: false,
            last_rfi_range: (0, -1),
        };

        // Probe the two session capabilities that shape config and the
        // control-channel handling (Sunshine get_encoder_cap,
        // nvenc_base.cpp:195-203). The probe is made with THIS session's
        // codec GUID: NVENC advertises per-codec caps, so the H.264
        // answers are not carried over to an HEVC session.
        this.supports_custom_vbv =
            this.encoder_cap(encode_guid(params.codec), CAPS_SUPPORT_CUSTOM_VBV_BUF_SIZE) != 0;
        this.supports_ref_invalidation = this
            .encoder_cap(encode_guid(params.codec), CAPS_SUPPORT_REF_PIC_INVALIDATION)
            != 0
            && this.ref_frames_in_dpb > 1;
        eprintln!(
            "nvenc: caps custom-vbv={} ref-pic-invalidation={} (codec {}, ref frames in DPB={})",
            this.supports_custom_vbv,
            this.supports_ref_invalidation,
            params.codec.name(),
            this.ref_frames_in_dpb
        );

        // Hand-build the low-latency init params for this session's codec
        // (shared with the adaptive reconfigure path).
        let (mut init, mut init_config) =
            build_init_params(api_version, params, this.supports_custom_vbv);
        // build_init_params stores a pointer to its own stack-local config;
        // re-point encodeConfig at the returned config so it stays valid
        // for the whole initialize call
        init.set_ptr(INIT_ENCODE_CONFIG, init_config.as_mut_ptr());
        let initialize: FnEncoderParams = unsafe {
            std::mem::transmute(this.function_list.ptr_at(OFF_INITIALIZE_ENCODER))
        };
        let status = unsafe { initialize(this.encoder, init.as_mut_ptr()) };
        if status != NV_ENC_SUCCESS {
            this.destroy();
            return Err(format!("NvEncInitializeEncoder failed: {status:#x}"));
        }

        // One bitstream buffer + completion event per pipeline slot
        // (the header requires a distinct event per output buffer;
        // Sunshine nvenc_base.cpp:494-497 registers the same way).
        // Registration failure rebuilds the session synchronously (how
        // every frame encoded before this existed).
        let mut slots = Vec::new();
        for _ in 0..PIPELINE_DEPTH {
            match unsafe { CreateEventW(None, false, false, None) } {
                Ok(event) => {
                    let mut event_params = EventParams::zeroed();
                    event_params.set_u32(EVENT_VERSION, this.ver(1));
                    event_params.set_ptr(EVENT_COMPLETION, event.0 as *mut c_void);
                    let register_event: FnHandleParam = unsafe {
                        std::mem::transmute(this.function_list.ptr_at(OFF_REGISTER_ASYNC_EVENT))
                    };
                    let status = unsafe {
                        register_event(this.encoder, event_params.as_mut_ptr())
                    };
                    if status != NV_ENC_SUCCESS {
                        eprintln!(
                            "nvenc: NvEncRegisterAsyncEvent failed ({status:#x}); falling back to synchronous encode"
                        );
                        unsafe {
                            let _ = CloseHandle(event);
                        }
                        slots.clear();
                        break;
                    }
                    let mut bitstream_buffer = BitstreamBufferParams::zeroed();
                    bitstream_buffer.set_u32(BS_VERSION, this.ver(1));
                    let create_bitstream: FnHandleParam = unsafe {
                        std::mem::transmute(
                            this.function_list.ptr_at(OFF_CREATE_BITSTREAM_BUFFER),
                        )
                    };
                    let status = unsafe {
                        create_bitstream(this.encoder, bitstream_buffer.as_mut_ptr())
                    };
                    if status != NV_ENC_SUCCESS {
                        this.destroy();
                        return Err(format!(
                            "NvEncCreateBitstreamBuffer failed: {status:#x}"
                        ));
                    }
                    slots.push(EncodeSlot {
                        bitstream: bitstream_buffer.ptr_at(BS_BUFFER),
                        event,
                    });
                }
                Err(error) => {
                    eprintln!(
                        "nvenc: CreateEvent failed ({error}); falling back to synchronous encode"
                    );
                    slots.clear();
                    break;
                }
            }
        }
        if slots.len() == PIPELINE_DEPTH {
            this.slots = slots;
        } else {
            for slot in slots {
                unsafe {
                    let _ = CloseHandle(slot.event);
                }
            }
            this.destroy();
            open_session(&mut this.encoder)?;
            let (mut sync_init, mut sync_config) =
                build_init_params(api_version, params, this.supports_custom_vbv);
            sync_init.set_u32(INIT_FLAGS, 0);
            sync_init.set_ptr(INIT_ENCODE_CONFIG, sync_config.as_mut_ptr());
            let status = unsafe { initialize(this.encoder, sync_init.as_mut_ptr()) };
            if status != NV_ENC_SUCCESS {
                this.destroy();
                return Err(format!(
                    "NvEncInitializeEncoder (sync fallback) failed: {status:#x}"
                ));
            }
            this.sync_fallback = true;
            let mut bitstream_buffer = BitstreamBufferParams::zeroed();
            bitstream_buffer.set_u32(BS_VERSION, this.ver(1));
            let create_bitstream: FnHandleParam = unsafe {
                std::mem::transmute(this.function_list.ptr_at(OFF_CREATE_BITSTREAM_BUFFER))
            };
            let status = unsafe { create_bitstream(this.encoder, bitstream_buffer.as_mut_ptr()) };
            if status != NV_ENC_SUCCESS {
                this.destroy();
                return Err(format!("NvEncCreateBitstreamBuffer failed: {status:#x}"));
            }
            this.slots.push(EncodeSlot {
                bitstream: bitstream_buffer.ptr_at(BS_BUFFER),
                // unused in the sync path, but poll() must not wait on a
                // garbage handle
                event: unsafe { CreateEventW(None, false, false, None) }
                    .unwrap_or(HANDLE::default()),
            });
        }

        Ok(this)
    }

    fn ver(&self, version: u16) -> u32 {
        struct_version(self.api_version, version)
    }

    /// nvEncGetEncodeCaps wrapper (Sunshine nvenc_base.cpp:195-203):
    /// returns the capability value, 0 on failure.
    fn encoder_cap(&self, encode_guid: NvGuid, cap: i32) -> i32 {
        let mut param = CapsParam::zeroed();
        param.set_u32(0, self.ver(1)); // NV_ENC_CAPS_PARAM.version
        param.set_i32(4, cap); // capsToQuery
        let get_caps: FnGetEncodeCaps = unsafe {
            std::mem::transmute(self.function_list.ptr_at(OFF_GET_ENCODE_CAPS))
        };
        let mut value = 0i32;
        let status =
            unsafe { get_caps(self.encoder, encode_guid, param.as_mut_ptr(), &mut value) };
        if status != NV_ENC_SUCCESS {
            eprintln!("nvenc: NvEncGetEncodeCaps({cap}) failed: {status:#x}");
            return 0;
        }
        value
    }

    /// Whether this session can honor reference-frame invalidation at all:
    /// the driver advertises the capability AND the negotiated DPB is
    /// deeper than one frame. The sender loop's recovery mode keys on this
    /// (a 1-frame DPB makes every invalidation a full IDR, so the client
    /// is effectively in IDR-only recovery even when the cap is set).
    pub fn supports_ref_invalidation(&self) -> bool {
        self.supports_ref_invalidation
    }

    /// Reference-frame invalidation for a client 0x0301 request,
    /// mirroring Sunshine nvenc_base.cpp:795-830. Returns false when the
    /// caller must fall back to a full IDR (unsupported, degenerate
    /// range, or a range at least the DPB deep). The after-invalidation
    /// packet mark is armed before the range checks exactly like
    /// Sunshine's rfi_needs_confirmation: the next submitted frame
    /// carries it (frameType 5) even when the fallback IDR wins the
    /// frame type.
    pub fn invalidate_ref_frames(&mut self, first_frame: i64, last_frame: i64) -> bool {
        if !self.supports_ref_invalidation {
            return false;
        }
        if first_frame >= self.last_rfi_range.0 && last_frame <= self.last_rfi_range.1 {
            // the retransmitted request is already applied
            return true;
        }
        self.rfi_pending = true;
        if first_frame < 0 || last_frame < first_frame {
            eprintln!(
                "nvenc: invalid ref-invalidation range {first_frame}..{last_frame}, generating IDR"
            );
            return false;
        }
        let last_frame = last_frame.min(self.last_encoded_frame_index);
        self.last_rfi_range = (first_frame, last_frame);
        if last_frame - first_frame + 1 >= self.ref_frames_in_dpb as i64 {
            // range covers the whole DPB: invalidating buys nothing over
            // a full IDR
            return false;
        }
        let invalidate: FnInvalidateRefFrames = unsafe {
            std::mem::transmute(self.function_list.ptr_at(OFF_INVALIDATE_REF_FRAMES))
        };
        for index in first_frame..=last_frame {
            let status = unsafe { invalidate(self.encoder, index as u64) };
            if status != NV_ENC_SUCCESS {
                eprintln!(
                    "nvenc: NvEncInvalidateRefFrames({index}) failed: {status:#x}, generating IDR"
                );
                return false;
            }
        }
        true
    }

    /// Registers a D3D11 texture (zero-copy input) and returns its
    /// registered resource. Textures are cached by pointer; the scaler
    /// renders into the same target every frame. Mapping is per-frame
    /// (see `encode_texture`).
    fn registered_input(&mut self, texture: *mut c_void) -> Result<*mut c_void, String> {
        let key = texture as usize;
        if let Some(input) = self.inputs.get(&key) {
            return Ok(input.registered);
        }

        let mut register = RegisterResourceParams::zeroed();
        register.set_u32(REG_VERSION, self.ver(5));
        register.set_u32(REG_RESOURCE_TYPE, RESOURCE_TYPE_DIRECTX);
        register.set_u32(REG_WIDTH, self.width);
        register.set_u32(REG_HEIGHT, self.height);
        register.set_u32(REG_PITCH, 0);
        register.set_ptr(REG_RESOURCE, texture);
        register.set_u32(REG_BUFFER_FORMAT, BUFFER_FORMAT_ARGB);
        let register_fn: FnHandleParam = unsafe {
            std::mem::transmute(self.function_list.ptr_at(OFF_REGISTER_RESOURCE))
        };
        let status = unsafe { register_fn(self.encoder, register.as_mut_ptr()) };
        if status != NV_ENC_SUCCESS {
            return Err(format!("NvEncRegisterResource failed: {status:#x}"));
        }
        let registered = register.ptr_at(REG_REGISTERED);

        self.inputs.insert(key, RegisteredInput { registered });
        Ok(registered)
    }

    fn map_input(&self, registered: *mut c_void) -> Result<*mut c_void, String> {
        let mut map = MapInputParams::zeroed();
        map.set_u32(MAP_VERSION, self.ver(4));
        map.set_ptr(MAP_REGISTERED, registered);
        let map_fn: FnHandleParam = unsafe {
            std::mem::transmute(self.function_list.ptr_at(OFF_MAP_INPUT_RESOURCE))
        };
        let status = unsafe { map_fn(self.encoder, map.as_mut_ptr()) };
        if status != NV_ENC_SUCCESS {
            return Err(format!("NvEncMapInputResource failed: {status:#x}"));
        }
        Ok(map.ptr_at(MAP_MAPPED))
    }

    fn unmap_input(&self, mapped: *mut c_void) {
        let unmap: FnTwoHandles = unsafe {
            std::mem::transmute(self.function_list.ptr_at(OFF_UNMAP_INPUT_RESOURCE))
        };
        unsafe { unmap(self.encoder, mapped) };
    }

    /// Submits one frame for encoding without waiting for it to
    /// complete. `handle` is an opaque caller token echoed back by
    /// [`Self::poll`] with the bitstream. Returns `Ok(false)` when every
    /// pipeline slot is still in flight — the caller drops the frame
    /// rather than stall the capture loop (the freshness policy prefers
    /// skipping ahead).
    pub fn submit(
        &mut self,
        texture: *mut c_void,
        force_idr: bool,
        handle: usize,
    ) -> Result<bool, String> {
        if self.sync_fallback {
            let (data, idr, after_invalidation) = self.encode_sync(texture, force_idr)?;
            self.completed.push_back((data, idr, handle, after_invalidation));
            return Ok(true);
        }
        if self.in_flight.len() >= self.slots.len() {
            return Ok(false);
        }
        let slot = (0..self.slots.len())
            .find(|index| !self.in_flight.iter().any(|pending| pending.slot == *index))
            .expect("a free slot when below capacity");
        let registered = self.registered_input(texture)?;
        // Map per frame and unmap when the bitstream is reaped, exactly
        // like Sunshine's encode_frame: the asynchronous pipeline tracks
        // the input surface through the map/unmap pair; leaving a texture
        // mapped across frames stalled every encode after the first.
        let mapped = self.map_input(registered)?;
        match self.encode_picture(
            mapped,
            self.slots[slot].bitstream,
            self.slots[slot].event,
            force_idr,
        ) {
            Ok(()) => {
                // the first frame submitted after an invalidation request
                // carries the after-invalidation mark (consumed here even
                // when the frame turns out to be an IDR: the IDR's
                // frameType 2 wins at packetize, exactly like Sunshine)
                let after_invalidation = std::mem::replace(&mut self.rfi_pending, false);
                self.in_flight.push_back(InFlight {
                    mapped,
                    slot,
                    handle,
                    after_invalidation,
                });
                Ok(true)
            }
            Err(error) => {
                self.unmap_input(mapped);
                Err(error)
            }
        }
    }

    /// Reaps completed encodes (nonblocking), oldest first. Under a
    /// saturated GPU several frames complete between polls; the caller
    /// ships the newest and frees every slot. `completed` (synchronous
    /// fallback submissions and set_bitrate drain echoes) always holds
    /// frames older than anything in `in_flight`, so it drains first.
    /// Each drained tuple is (bitstream, encoder-side idr flag, caller
    /// handle, after-invalidation mark).
    pub fn poll(&mut self) -> Result<Vec<(Vec<u8>, bool, usize, bool)>, String> {
        let mut drained: Vec<(Vec<u8>, bool, usize, bool)> = self.completed.drain(..).collect();
        if self.sync_fallback {
            return Ok(drained);
        }
        let mut index = 0;
        while index < self.in_flight.len() {
            let (slot, handle, after_invalidation) = {
                let pending = &self.in_flight[index];
                (pending.slot, pending.handle, pending.after_invalidation)
            };
            let signaled = unsafe { WaitForSingleObject(self.slots[slot].event, 0) };
            if signaled.0 != 0 {
                index += 1;
                continue;
            }
            let pending = self.in_flight.remove(index).expect("index in bounds");
            let data = self.lock_and_unlock(self.slots[slot].bitstream)?;
            self.unmap_input(pending.mapped);
            drained.push((data, false, handle, after_invalidation));
        }
        Ok(drained)
    }

    /// Waits for every in-flight encode (used when the session is about
    /// to be reconfigured). The drained bitstreams are ECHOED into
    /// `completed` with their caller handles, exactly like poll() does:
    /// the capture-side bookkeeping (scaler targets, ring slots,
    /// encoder_meta) frees that state only when a submitted handle comes
    /// back. Discarding here leaked every slot the drained frames held —
    /// with both scaler targets leaked the pipeline drops every frame,
    /// forced IDRs included, at the busy gate.
    fn drain(&mut self) -> Result<(), String> {
        while let Some(pending) = self.in_flight.pop_front() {
            let InFlight { mapped, slot, handle, after_invalidation } = pending;
            let wait = unsafe { WaitForSingleObject(self.slots[slot].event, 5000) };
            if wait.0 != 0 {
                self.unmap_input(mapped);
                return Err(format!(
                    "nvenc: drain wait timed out ({:#x})",
                    wait.0
                ));
            }
            let data = self.lock_and_unlock(self.slots[slot].bitstream)?;
            self.unmap_input(mapped);
            self.completed.push_back((data, false, handle, after_invalidation));
        }
        Ok(())
    }

    fn encode_picture(
        &mut self,
        mapped: *mut c_void,
        bitstream: *mut c_void,
        event: HANDLE,
        force_idr: bool,
    ) -> Result<(), String> {
        let mut pic = PicParams::zeroed();
        pic.set_u32(PIC_VERSION, self.ver(7) | (1 << 31));
        pic.set_u32(PIC_INPUT_WIDTH, self.width);
        pic.set_u32(PIC_INPUT_HEIGHT, self.height);
        pic.set_u32(PIC_INPUT_PITCH, self.width);
        pic.set_u32(
            PIC_ENCODE_FLAGS,
            if force_idr { PIC_FLAG_FORCEIDR } else { 0 },
        );
        pic.set_u32(PIC_FRAME_IDX, self.frame_index);
        self.last_encoded_frame_index = self.frame_index as i64;
        self.frame_index = self.frame_index.wrapping_add(1);
        pic.set_ptr(PIC_INPUT_BUFFER, mapped);
        pic.set_ptr(PIC_OUTPUT_BITSTREAM, bitstream);
        pic.set_ptr(PIC_COMPLETION_EVENT, event.0 as *mut c_void);
        pic.set_u32(PIC_BUFFER_FMT, BUFFER_FORMAT_ARGB);
        pic.set_u32(PIC_PICTURE_STRUCT, PIC_STRUCT_FRAME);
        let encode: FnHandleParam =
            unsafe { std::mem::transmute(self.function_list.ptr_at(OFF_ENCODE_PICTURE)) };
        let status = unsafe { encode(self.encoder, pic.as_mut_ptr()) };
        if status != NV_ENC_SUCCESS {
            return Err(format!("NvEncEncodePicture failed: {status:#x}"));
        }
        Ok(())
    }

    fn lock_and_unlock(&mut self, bitstream: *mut c_void) -> Result<Vec<u8>, String> {
        let mut lock = LockBitstreamParams::zeroed();
        lock.set_u32(LOCK_VERSION, self.ver(2) | (1 << 31));
        lock.set_u32(LOCK_DO_NOT_WAIT, 1);
        lock.set_ptr(LOCK_OUTPUT_BITSTREAM, bitstream);
        let lock_fn: FnHandleParam =
            unsafe { std::mem::transmute(self.function_list.ptr_at(OFF_LOCK_BITSTREAM)) };
        let status = unsafe { lock_fn(self.encoder, lock.as_mut_ptr()) };
        if status != NV_ENC_SUCCESS {
            return Err(format!("NvEncLockBitstream failed: {status:#x}"));
        }
        let size = lock.u32_at(LOCK_SIZE) as usize;
        let data_ptr = lock.ptr_at(LOCK_BUFFER_PTR);
        let data = if data_ptr.is_null() || size == 0 {
            Vec::new()
        } else {
            unsafe { std::slice::from_raw_parts(data_ptr as *const u8, size) }.to_vec()
        };
        let unlock: FnTwoHandles = unsafe {
            std::mem::transmute(self.function_list.ptr_at(OFF_UNLOCK_BITSTREAM))
        };
        unsafe { unlock(self.encoder, bitstream) };
        Ok(data)
    }

    /// Synchronous encode (fallback when async event registration
    /// failed): blocks in LockBitstream until the bitstream is ready —
    /// the historical behavior, one GPU dependency chain per frame.
    /// Returns (bitstream, encoder-side idr flag, after-invalidation
    /// mark).
    fn encode_sync(
        &mut self,
        texture: *mut c_void,
        force_idr: bool,
    ) -> Result<(Vec<u8>, bool, bool), String> {
        let after_invalidation = std::mem::replace(&mut self.rfi_pending, false);
        let registered = self.registered_input(texture)?;
        let mapped = self.map_input(registered)?;
        let result = (|| {
            let mut pic = PicParams::zeroed();
            pic.set_u32(PIC_VERSION, self.ver(7) | (1 << 31));
            pic.set_u32(PIC_INPUT_WIDTH, self.width);
            pic.set_u32(PIC_INPUT_HEIGHT, self.height);
            pic.set_u32(PIC_INPUT_PITCH, self.width);
            pic.set_u32(
                PIC_ENCODE_FLAGS,
                if force_idr { PIC_FLAG_FORCEIDR } else { 0 },
            );
            pic.set_ptr(PIC_INPUT_BUFFER, mapped);
            pic.set_ptr(PIC_OUTPUT_BITSTREAM, self.slots[0].bitstream);
            pic.set_u32(PIC_BUFFER_FMT, BUFFER_FORMAT_ARGB);
            pic.set_u32(PIC_PICTURE_STRUCT, PIC_STRUCT_FRAME);
            let encode: FnHandleParam = unsafe {
                std::mem::transmute(self.function_list.ptr_at(OFF_ENCODE_PICTURE))
            };
            let status = unsafe { encode(self.encoder, pic.as_mut_ptr()) };
            if status != NV_ENC_SUCCESS {
                return Err(format!("NvEncEncodePicture failed: {status:#x}"));
            }
            let data = {
                let mut lock = LockBitstreamParams::zeroed();
                lock.set_u32(LOCK_VERSION, self.ver(2) | (1 << 31));
                lock.set_ptr(LOCK_OUTPUT_BITSTREAM, self.slots[0].bitstream);
                let lock_fn: FnHandleParam = unsafe {
                    std::mem::transmute(self.function_list.ptr_at(OFF_LOCK_BITSTREAM))
                };
                let status = unsafe { lock_fn(self.encoder, lock.as_mut_ptr()) };
                if status != NV_ENC_SUCCESS {
                    return Err(format!("NvEncLockBitstream failed: {status:#x}"));
                }
                let size = lock.u32_at(LOCK_SIZE) as usize;
                let data_ptr = lock.ptr_at(LOCK_BUFFER_PTR);
                if data_ptr.is_null() || size == 0 {
                    Vec::new()
                } else {
                    unsafe { std::slice::from_raw_parts(data_ptr as *const u8, size) }.to_vec()
                }
            };
            let unlock: FnTwoHandles = unsafe {
                std::mem::transmute(self.function_list.ptr_at(OFF_UNLOCK_BITSTREAM))
            };
            unsafe { unlock(self.encoder, self.slots[0].bitstream) };
            Ok((data, force_idr, after_invalidation))
        })();
        self.unmap_input(mapped);
        result
    }

    /// Adaptive bitrate: NvEncReconfigureEncoder with the full init
    /// params rebuilt at the new bitrate (offsets verified against
    /// nvEncodeAPI.h: version@0, reInitEncodeParams@8 (NV_ENC_INITIALIZE_PARAMS),
    /// resetEncoder/forceIDR bitfield@1808). resetEncoder is only legal
    /// with an IDR, so both bits are set; with enablePTD the next frame
    /// is forced to IDR.
    pub fn set_bitrate(&mut self, kbps: u32) -> Result<(), String> {
        let mut config = self.config;
        config.bitrate_kbps = kbps;
        let (mut init, mut keepalive) =
            build_init_params(self.api_version, &config, self.supports_custom_vbv);
        if self.sync_fallback {
            // sync fallback session: keep it synchronous (async without a
            // registered completion event would hang every lock)
            init.set_u32(INIT_FLAGS, 0);
        }
        // the encodeConfig pointer build_init_params stored references its
        // own stack frame: re-point it at the returned config, which must
        // outlive the reconfigure call
        init.set_ptr(INIT_ENCODE_CONFIG, keepalive.as_mut_ptr());

        let mut params = ReconfigureParams::zeroed();
        params.set_u32(RECONFIG_VERSION, self.ver(1) | (1 << 31));
        params.0[RECONFIG_INIT_PARAMS..RECONFIG_INIT_PARAMS + 1800]
            .copy_from_slice(&init.0);
        params.set_u32(RECONFIG_BITFIELD, RECONFIG_RESET_AND_FORCE_IDR);

        let reconfigure: FnHandleParam = unsafe {
            std::mem::transmute(self.function_list.ptr_at(OFF_RECONFIGURE_ENCODER))
        };
        let status = unsafe { reconfigure(self.encoder, params.as_mut_ptr()) };
        if status != NV_ENC_SUCCESS {
            return Err(format!("NvEncReconfigureEncoder failed: {status:#x}"));
        }
        self.config = config;
        Ok(())
    }

    fn destroy(&mut self) {
        unsafe {
            if !self.encoder.is_null() {
                // completion events first (Sunshine nvenc_base teardown
                // unregisters the async events before destroying the
                // encoder)
                for slot in &self.slots {
                    let mut event_params = EventParams::zeroed();
                    event_params.set_u32(EVENT_VERSION, self.ver(1));
                    event_params.set_ptr(EVENT_COMPLETION, slot.event.0 as *mut c_void);
                    let unregister_event: FnHandleParam = std::mem::transmute(
                        self.function_list.ptr_at(OFF_UNREGISTER_ASYNC_EVENT),
                    );
                    unregister_event(self.encoder, event_params.as_mut_ptr());
                    let _ = CloseHandle(slot.event);
                }
                self.in_flight.clear();
                let unregister: FnTwoHandles = std::mem::transmute(
                    self.function_list.ptr_at(OFF_UNREGISTER_RESOURCE),
                );
                // inputs are mapped only for the duration of one encode;
                // at teardown only the registrations remain
                for input in self.inputs.values() {
                    unregister(self.encoder, input.registered);
                }
                // bitstream buffers before the encoder (mirrors Sunshine
                // nvenc_base teardown order)
                let destroy_bitstream: FnTwoHandles = std::mem::transmute(
                    self.function_list.ptr_at(OFF_DESTROY_BITSTREAM_BUFFER),
                );
                for slot in &self.slots {
                    if !slot.bitstream.is_null() {
                        destroy_bitstream(self.encoder, slot.bitstream);
                    }
                }
                self.slots.clear();
                let destroy_encoder: FnHandleOnly =
                    std::mem::transmute(self.function_list.ptr_at(OFF_DESTROY_ENCODER));
                destroy_encoder(self.encoder);
                self.encoder = ptr::null_mut();
            }
        }
    }
}

/// Everything a dead NVENC session needs for teardown, moved into the
/// detached thread so a hung driver call cannot take the video thread
/// down with it (Sunshine video.cpp:2416-2431). Each part is owned
/// here: the function list box, the library handle, and the raw
/// session handles are used only inside `run_encoder_teardown`.
struct TeardownParts {
    library: HMODULE,
    function_list: Box<FunctionList>,
    api_version: u32,
    encoder: *mut c_void,
    slots: Vec<EncodeSlot>,
    registered: Vec<*mut c_void>,
}
// the parts move whole into the teardown thread and are touched only
// there (same ownership rule as `unsafe impl Send for NvencEncoder`)
unsafe impl Send for TeardownParts {}

fn run_encoder_teardown(parts: TeardownParts) {
    unsafe {
        if !parts.encoder.is_null() {
            let ver = struct_version(parts.api_version, 1);
            for slot in &parts.slots {
                let mut event_params = EventParams::zeroed();
                event_params.set_u32(EVENT_VERSION, ver);
                event_params.set_ptr(EVENT_COMPLETION, slot.event.0 as *mut c_void);
                let unregister_event: FnHandleParam = std::mem::transmute(
                    parts.function_list.ptr_at(OFF_UNREGISTER_ASYNC_EVENT),
                );
                unregister_event(parts.encoder, event_params.as_mut_ptr());
                let _ = CloseHandle(slot.event);
            }
            let unregister: FnTwoHandles = std::mem::transmute(
                parts.function_list.ptr_at(OFF_UNREGISTER_RESOURCE),
            );
            // inputs are mapped only for the duration of one encode; at
            // teardown only the registrations remain
            for registered in &parts.registered {
                unregister(parts.encoder, *registered);
            }
            // bitstream buffers before the encoder (mirrors Sunshine
            // nvenc_base teardown order)
            let destroy_bitstream: FnTwoHandles = std::mem::transmute(
                parts.function_list.ptr_at(OFF_DESTROY_BITSTREAM_BUFFER),
            );
            for slot in &parts.slots {
                if !slot.bitstream.is_null() {
                    destroy_bitstream(parts.encoder, slot.bitstream);
                }
            }
            let destroy_encoder: FnHandleOnly =
                std::mem::transmute(parts.function_list.ptr_at(OFF_DESTROY_ENCODER));
            destroy_encoder(parts.encoder);
        }
        // the library outlives every driver call above
        let _ = windows::Win32::Foundation::FreeLibrary(parts.library);
    }
}

impl Drop for NvencEncoder {
    fn drop(&mut self) {
        if self.encoder.is_null() {
            // the session never opened (or was already synchronously
            // destroyed during init): only the library remains
            unsafe {
                let _ = windows::Win32::Foundation::FreeLibrary(self._library);
            }
            return;
        }
        let parts = TeardownParts {
            library: self._library,
            function_list: std::mem::replace(
                &mut self.function_list,
                Box::new(FunctionList::zeroed()),
            ),
            api_version: self.api_version,
            encoder: std::mem::replace(&mut self.encoder, ptr::null_mut()),
            slots: std::mem::take(&mut self.slots),
            registered: std::mem::take(&mut self.inputs)
                .into_values()
                .map(|input| input.registered)
                .collect(),
        };
        // in-flight encodes are dropped with self; their mapped inputs
        // are reclaimed by the session destroy, exactly like the old
        // synchronous clear()
        let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        {
            let done = done.clone();
            std::thread::spawn(move || {
                run_encoder_teardown(parts);
                done.store(true, std::sync::atomic::Ordering::SeqCst);
            });
        }
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(2));
            if !done.load(std::sync::atomic::Ordering::SeqCst) {
                eprintln!(
                    "nvenc: encoder teardown still running after 2s (possible NVENC driver hang); the video thread is unaffected"
                );
            }
        });
    }
}


impl TextureEncoder for NvencEncoder {
    fn submit(
        &mut self,
        texture: *mut c_void,
        force_idr: bool,
        handle: SubmitHandle,
    ) -> Result<SubmitState, String> {
        Ok(if self.submit(texture, force_idr, handle)? {
            SubmitState::Submitted
        } else {
            SubmitState::Busy
        })
    }

    fn poll(&mut self) -> Result<Vec<(Vec<u8>, bool, SubmitHandle, bool)>, String> {
        self.poll()
    }

    fn set_bitrate(&mut self, kbps: u32) -> Result<(), String> {
        self.drain()?;
        self.set_bitrate(kbps)
    }

    fn invalidate_ref_frames(&mut self, first_frame: i64, last_frame: i64) -> bool {
        self.invalidate_ref_frames(first_frame, last_frame)
    }

    fn supports_ref_invalidation(&self) -> bool {
        self.supports_ref_invalidation
    }

    fn pending_depth(&self) -> usize {
        self.in_flight.len() + self.completed.len()
    }
}

// GUID helpers: stored raw (16 bytes), matching the C memory layout.
macro_rules! guid_accessor {
    ($name:ident) => {
        impl $name {
            pub fn set_guid(&mut self, offset: usize, guid: NvGuid) {
                self.0[offset..offset + 16].copy_from_slice(&guid.to_bytes());
            }
        }
    };
}
guid_accessor!(EncoderConfig);
guid_accessor!(InitializeParams);

#[cfg(test)]
mod tests {
    use super::*;

    fn djb(data: &[u8]) -> u64 {
        let mut hash: u64 = 5381;
        for byte in data {
            hash = hash.wrapping_mul(33).wrapping_add(*byte as u64);
        }
        hash
    }

    #[test]
    fn dump_structs_match_c_reference() {
        let mut config = EncoderConfig::zeroed();
        config.set_u32(CFG_VERSION, struct_version(NVENCAPI_VERSION, 9) | (1 << 31));
        config.set_guid(CFG_PROFILE_GUID, GUID_PROFILE_HIGH);
        config.set_u32(CFG_GOP_LENGTH, INFINITE_GOP);
        config.set_i32(CFG_FRAME_INTERVAL_P, 1);
        config.set_u32(CFG_RC_PARAMS + 0, struct_version(NVENCAPI_VERSION, 1));
        config.set_u32(CFG_RC_PARAMS + RC_RATE_CONTROL_MODE, RC_MODE_CBR);
        config.set_u32(CFG_RC_PARAMS + RC_AVERAGE_BITRATE, 15_000_000);
        config.set_u32(CFG_RC_PARAMS + RC_MAX_BITRATE, 15_000_000);
        config.set_u32(CFG_RC_PARAMS + RC_VBV_BUFFER_SIZE, 7_500_000);
        config.or_u32(CFG_RC_PARAMS + RC_BITFIELD, ZERO_REORDER_DELAY_BIT);
        config.set_u32(CFG_RC_PARAMS + RC_MULTI_PASS, MULTI_PASS_DISABLED);
        config.or_u32(CFG_CODEC_CONFIG + H264_WORD0, REPEAT_SPS_PPS_BIT);
        config.set_u32(CFG_CODEC_CONFIG + H264_IDR_PERIOD, INFINITE_GOP);
        config.set_u32(CFG_CODEC_CONFIG + H264_ENTROPY_CODING, ENTROPY_CABAC);
        config.set_u32(CFG_CODEC_CONFIG + H264_MAX_REF_FRAMES, REF_FRAMES_DEFAULT);
        config.set_u32(CFG_CODEC_CONFIG + H264_SLICE_MODE, 3);
        config.set_u32(CFG_CODEC_CONFIG + H264_SLICE_MODE_DATA, 1);
        println!("config hash={:x} first64={:02x?}", djb(&config.0[..]), &config.0[..64]);

        let mut init = InitializeParams::zeroed();
        init.set_u32(INIT_VERSION, struct_version(NVENCAPI_VERSION, 7) | (1 << 31));
        init.set_guid(INIT_ENCODE_GUID, GUID_H264);
        init.set_guid(INIT_PRESET_GUID, GUID_PRESET_P4);
        init.set_u32(INIT_ENCODE_WIDTH, 3440);
        init.set_u32(INIT_ENCODE_HEIGHT, 1440);
        init.set_u32(INIT_DAR_WIDTH, 3440);
        init.set_u32(INIT_DAR_HEIGHT, 1440);
        init.set_u32(INIT_FRAME_RATE_NUM, 60);
        init.set_u32(INIT_FRAME_RATE_DEN, 1);
        init.set_u32(INIT_FLAGS, 0);
        init.set_u32(INIT_PTD, 1);
        init.set_ptr(INIT_ENCODE_CONFIG, config.as_mut_ptr());
        init.set_u32(INIT_TUNING_INFO, TUNING_ULTRA_LOW_LATENCY);
        println!("init hash={:x} first64={:02x?}", djb(&init.0[..]), &init.0[..64]);
    }

    /// Locks the config layout that the adaptive reconfigure reuses:
    /// avg/max bitrate land at the C-probe-verified offsets, and the
    /// NV_ENC_RECONFIGURE_PARAMS view (init params copied in at +8) sees
    /// them at 8+60/8+64.
    #[test]
    fn init_params_carry_bitrate_at_verified_offsets() {
        let params = EncoderConfigParams {
            codec: VideoCodec::H264,
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate_kbps: 42_000,
            slices_per_frame: 4,
            max_ref_frames: REF_FRAMES_DEFAULT,
        };
        let (mut init, mut keepalive) = build_init_params(NVENCAPI_VERSION, &params, false);
        let avg = CFG_RC_PARAMS + RC_AVERAGE_BITRATE; // 60, C-probe verified
        let max = CFG_RC_PARAMS + RC_MAX_BITRATE; // 64
        assert_eq!(keepalive.0[avg..avg + 4], 42_000_000u32.to_le_bytes());
        assert_eq!(keepalive.0[max..max + 4], 42_000_000u32.to_le_bytes());
        // the init params reference the config through the encodeConfig
        // pointer (offset 88); the reconfigure buffer is a byte copy of
        // the init params at +8, so that pointer must survive the copy
        // and still resolve to the bitrate-carrying config
        init.set_ptr(INIT_ENCODE_CONFIG, keepalive.as_mut_ptr());
        let mut reconfigure = ReconfigureParams::zeroed();
        reconfigure.0[RECONFIG_INIT_PARAMS..RECONFIG_INIT_PARAMS + 1800]
            .copy_from_slice(&init.0);
        let stored = u64::from_le_bytes(
            reconfigure.0[RECONFIG_INIT_PARAMS + INIT_ENCODE_CONFIG
                ..RECONFIG_INIT_PARAMS + INIT_ENCODE_CONFIG + 8]
                .try_into()
                .unwrap(),
        );
        assert_eq!(stored, keepalive.as_mut_ptr() as usize as u64);
    }

    /// The negotiated DPB depth must land at the C-probe-verified
    /// numRefFrames offset, clamped to the sane H.264 range: 0 (a client
    /// that never sent the attribute, or the probe's failing fallback)
    /// configures a single reference, and the ceiling is
    /// [`REF_FRAMES_MAX`].
    #[test]
    fn init_params_carry_the_negotiated_ref_frames() {
        let offset = CFG_CODEC_CONFIG + H264_MAX_REF_FRAMES;
        let depth = |count: u32| {
            let params = EncoderConfigParams {
                codec: VideoCodec::H264,
                width: 1280,
                height: 720,
                fps: 60,
                bitrate_kbps: 15_000,
                slices_per_frame: 1,
                max_ref_frames: count,
            };
            let (_, keepalive) = build_init_params(NVENCAPI_VERSION, &params, false);
            u32::from_le_bytes(keepalive.0[offset..offset + 4].try_into().unwrap())
        };
        assert_eq!(depth(REF_FRAMES_DEFAULT), REF_FRAMES_DEFAULT);
        assert_eq!(depth(3), 3);
        assert_eq!(depth(0), 1);
        assert_eq!(depth(99), REF_FRAMES_MAX);
    }

    /// The HEVC session config, at the offsets the compiled C probe
    /// verified against `NV_ENC_CONFIG_HEVC` (target/hevc_offsets_probe.c):
    /// the codec configs share the NV_ENC_CODEC_CONFIG union, so the HEVC
    /// bitfield word sits at 16 — not at H.264's offset 0 — with
    /// repeatSPSPPS at bit 7 (H.264's is bit 12) and chromaFormatIDC at
    /// bits 9-10 (H.264's is a whole u32 at 192). Everything outside the
    /// codec block must be identical to the H.264 build: the codec choice
    /// changes GUIDs and the codec config, nothing about rate control, GOP
    /// or low-latency tuning.
    #[test]
    fn init_params_configure_hevc_main_at_verified_offsets() {
        let params = |codec, max_ref_frames| EncoderConfigParams {
            codec,
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate_kbps: 30_000,
            slices_per_frame: 2,
            max_ref_frames,
        };
        let (h264_init, h264_config) =
            build_init_params(NVENCAPI_VERSION, &params(VideoCodec::H264, 4), true);
        let (hevc_init, hevc_config) =
            build_init_params(NVENCAPI_VERSION, &params(VideoCodec::Hevc, 4), true);
        // the encode GUID and the profile GUID are the HEVC ones
        assert_eq!(&hevc_init.0[INIT_ENCODE_GUID..INIT_ENCODE_GUID + 16], GUID_HEVC.to_bytes());
        assert_eq!(
            &hevc_config.0[CFG_PROFILE_GUID..CFG_PROFILE_GUID + 16],
            GUID_PROFILE_HEVC_MAIN.to_bytes()
        );
        assert_eq!(
            &h264_config.0[CFG_PROFILE_GUID..CFG_PROFILE_GUID + 16],
            GUID_PROFILE_HIGH.to_bytes()
        );

        // repeatSPSPPS (bit 7) + chromaFormatIDC = 1 (bits 9-10), in the
        // HEVC word at offset 16 — and NOT the H.264 word at offset 0,
        // which stays the zeroed `level` field
        let hevc_word0 = u32::from_le_bytes(
            hevc_config.0[CFG_CODEC_CONFIG + HEVC_WORD0..CFG_CODEC_CONFIG + HEVC_WORD0 + 4]
                .try_into()
                .unwrap(),
        );
        assert_eq!(hevc_word0, HEVC_REPEAT_SPS_PPS_BIT | HEVC_CHROMA_FORMAT_IDC_420);
        assert_eq!(hevc_word0 & REPEAT_SPS_PPS_BIT, 0, "not H.264's bit 12");
        let level_word = u32::from_le_bytes(
            hevc_config.0[CFG_CODEC_CONFIG..CFG_CODEC_CONFIG + 4].try_into().unwrap(),
        );
        assert_eq!(
            level_word, 0,
            "the H.264 bitfield word (level) must stay untouched"
        );

        // infinite IDR period, the negotiated DPB depth and the client's
        // slice count land at the probe-verified HEVC offsets
        let u32_at = |config: &EncoderConfig, offset: usize| {
            u32::from_le_bytes(config.0[offset..offset + 4].try_into().unwrap())
        };
        assert_eq!(
            u32_at(&hevc_config, CFG_CODEC_CONFIG + HEVC_IDR_PERIOD),
            INFINITE_GOP
        );
        assert_eq!(
            u32_at(&hevc_config, CFG_CODEC_CONFIG + HEVC_MAX_REF_FRAMES),
            4
        );
        assert_eq!(u32_at(&hevc_config, CFG_CODEC_CONFIG + HEVC_SLICE_MODE), 3);
        assert_eq!(
            u32_at(&hevc_config, CFG_CODEC_CONFIG + HEVC_SLICE_MODE_DATA),
            2
        );

        // everything the codecs share is byte-identical
        for offset in [
            CFG_GOP_LENGTH,
            CFG_FRAME_INTERVAL_P,
            CFG_RC_PARAMS + RC_RATE_CONTROL_MODE,
            CFG_RC_PARAMS + RC_AVERAGE_BITRATE,
            CFG_RC_PARAMS + RC_MAX_BITRATE,
            CFG_RC_PARAMS + RC_VBV_BUFFER_SIZE,
            CFG_RC_PARAMS + RC_BITFIELD,
            CFG_RC_PARAMS + RC_MULTI_PASS,
        ] {
            assert_eq!(
                hevc_config.0[offset..offset + 4],
                h264_config.0[offset..offset + 4],
                "shared config at offset {offset} must not depend on the codec"
            );
        }
        for offset in [INIT_TUNING_INFO, INIT_FLAGS, INIT_FRAME_RATE_NUM] {
            assert_eq!(
                hevc_init.0[offset..offset + 4],
                h264_init.0[offset..offset + 4],
                "shared init param at offset {offset} must not depend on the codec"
            );
        }

        // the HEVC encode GUID is what the caps probe is asked about, so
        // the config builder and the probe cannot disagree about the codec
        assert_eq!(encode_guid(VideoCodec::Hevc).to_bytes(), GUID_HEVC.to_bytes());
        assert_eq!(encode_guid(VideoCodec::H264).to_bytes(), GUID_H264.to_bytes());
        assert_ne!(
            encode_guid(VideoCodec::H264).to_bytes(),
            encode_guid(VideoCodec::Hevc).to_bytes()
        );
    }

    /// The encoder feeds NVENC a BGRA texture, so the driver does the
    /// RGB->YUV conversion; the VUI must describe it (Sunshine
    /// configure_h264_hevc_metadata, nvenc_base.cpp:307-321) or the
    /// client decodes with the wrong range/matrix and the picture is
    /// uniformly too bright. Asserts every VUI field byte for the H.264
    /// config built here and the same bytes at the C-probe-verified HEVC
    /// VUI offset in the HEVC config (the header typedefs both VUI
    /// structs to one layout), and that nothing outside the VUI region
    /// moved.
    #[test]
    fn init_params_carry_bt709_vui_metadata() {
        let params = |codec| EncoderConfigParams {
            codec,
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate_kbps: 42_000,
            slices_per_frame: 4,
            max_ref_frames: REF_FRAMES_DEFAULT,
        };
        let (_, h264_config) = build_init_params(NVENCAPI_VERSION, &params(VideoCodec::H264), false);
        let (_, hevc_config) = build_init_params(NVENCAPI_VERSION, &params(VideoCodec::Hevc), false);

        // expected VUI bytes, keyed by offset relative to the VUI struct
        let expected: &[(usize, u32)] = &[
            (VUI_VIDEO_SIGNAL_TYPE_PRESENT, 1),
            (VUI_VIDEO_FORMAT, VUI_VIDEO_FORMAT_UNSPECIFIED),
            (VUI_VIDEO_FULL_RANGE_FLAG, 0), // limited (MPEG) range
            (VUI_COLOUR_DESCRIPTION_PRESENT, 1),
            (VUI_COLOR_PRIMARIES, VUI_COLOR_PRIMARIES_BT709),
            (
                VUI_TRANSFER_CHARACTERISTICS,
                VUI_TRANSFER_CHARACTERISTICS_BT709,
            ),
            (VUI_COLOR_MATRIX, VUI_COLOR_MATRIX_BT709),
            (VUI_CHROMA_SAMPLE_LOCATION_FLAG, 1),
            (VUI_CHROMA_SAMPLE_LOCATION_TOP, 0),
            (VUI_CHROMA_SAMPLE_LOCATION_BOT, 0),
            (VUI_BITSTREAM_RESTRICTION, 1),
        ];

        let assert_vui = |config: &EncoderConfig, vui_offset: usize| {
            let vui = CFG_CODEC_CONFIG + vui_offset;
            for (field, value) in expected {
                assert_eq!(
                    config.u32_at(vui + field),
                    *value,
                    "VUI field at +{field}"
                );
            }
            // untouched VUI neighbours: overscan info (0..8), timing info
            // (52..64) and the reserved tail (64..112) stay zero
            assert!(config.0[vui..vui + VUI_VIDEO_SIGNAL_TYPE_PRESENT]
                .iter()
                .all(|byte| *byte == 0));
            assert!(config.0[vui + VUI_BITSTREAM_RESTRICTION + 4..vui + 112]
                .iter()
                .all(|byte| *byte == 0));
        };

        assert_vui(&h264_config, H264_VUI_PARAMETERS);

        // HEVC: the session config writes the same bytes at the
        // C-probe-verified hevcVUIParameters offset
        assert_vui(&hevc_config, HEVC_VUI_PARAMETERS);

        // nothing else in the H.264 config moved: the VUI struct ends at
        // 72 + 112 = 184, and only chromaFormatIDC (192) follows before
        // the tail — assert that gap stays zero and the known fields are
        // still where the other layout tests pin them
        let tail = CFG_CODEC_CONFIG + H264_VUI_PARAMETERS + 112;
        assert!(h264_config.0[tail..CFG_CODEC_CONFIG + H264_CHROMA_FORMAT]
            .iter()
            .all(|byte| *byte == 0));
        assert_eq!(h264_config.u32_at(CFG_CODEC_CONFIG + H264_CHROMA_FORMAT), 1);
        assert_eq!(
            h264_config.u32_at(CFG_VERSION),
            struct_version(NVENCAPI_VERSION, 9) | (1 << 31)
        );
    }

    /// LIVE NVENC probe — run explicitly on the streaming host (needs the
    /// NVIDIA driver; ignored by default):
    ///
    ///   cargo test --release -- --ignored live_nvenc_reregister_mid_session --nocapture --exact
    ///
    /// Verifies the input-resource contract the capture fast path relies
    /// on: after NvEncUnregisterResource, NvEncRegisterResource accepts a
    /// NEW texture on the SAME session mid-stream and encodes produce
    /// bitstreams. The production fast path never needs this (the
    /// registered inputs are the scaler's persistent owned targets, which
    /// a duplication recreation does not touch) — this is the ground-truth
    /// check that the underlying API allows re-registration mid-session,
    /// the same guarantee Sunshine's persistent d3d_input_texture
    /// registration depends on across display re-inits.
    #[test]
    #[ignore]
    fn live_nvenc_reregister_mid_session() {
        use std::ptr;
        use std::time::{Duration, Instant};
        use windows::core::Interface;
        use windows::Win32::Foundation::HMODULE;
        use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0};
        use windows::Win32::Graphics::Direct3D11::{
            D3D11CreateDevice, ID3D11Device, ID3D11Texture2D, D3D11_BIND_RENDER_TARGET,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
            D3D11_USAGE_DEFAULT,
        };
        use windows::Win32::Graphics::Dxgi::Common::{
            DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC,
        };

        const WIDTH: u32 = 1280;
        const HEIGHT: u32 = 720;

        unsafe {
            let mut device: Option<ID3D11Device> = None;
            let mut context = None;
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE(ptr::null_mut()),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_0]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
            .expect("D3D11CreateDevice");
            let device = device.expect("device");
            let _context = context.expect("context");

            let make_texture = |device: &ID3D11Device| -> ID3D11Texture2D {
                let mut desc = D3D11_TEXTURE2D_DESC::default();
                desc.Width = WIDTH;
                desc.Height = HEIGHT;
                desc.MipLevels = 1;
                desc.ArraySize = 1;
                desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
                desc.SampleDesc = DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                };
                desc.Usage = D3D11_USAGE_DEFAULT;
                desc.BindFlags = D3D11_BIND_RENDER_TARGET.0 as u32;
                let mut texture = None;
                device
                    .CreateTexture2D(&desc, None, Some(&mut texture))
                    .expect("CreateTexture2D");
                texture.expect("texture")
            };

            let config = EncoderConfigParams {
                codec: VideoCodec::H264,
                width: WIDTH,
                height: HEIGHT,
                fps: 60,
                bitrate_kbps: 15_000,
                slices_per_frame: 1,
                max_ref_frames: REF_FRAMES_DEFAULT,
            };
            let mut encoder =
                NvencEncoder::new(device.as_raw(), &config).expect("nvenc session");

            let drain_one = |encoder: &mut NvencEncoder, label: &str| -> Vec<u8> {
                let deadline = Instant::now() + Duration::from_secs(5);
                loop {
                    let drained = encoder.poll().expect("poll");
                    if let Some((data, _, _, _)) = drained.into_iter().next() {
                        return data;
                    }
                    assert!(Instant::now() < deadline, "{label}: bitstream never completed");
                    std::thread::sleep(Duration::from_millis(2));
                }
            };

            // encode one frame from texture A
            let texture_a = make_texture(&device);
            assert!(encoder
                .submit(texture_a.as_raw(), false, 1)
                .expect("submit A"));
            let bitstream_a = drain_one(&mut encoder, "frame A");
            assert!(!bitstream_a.is_empty(), "frame A produced no bitstream");

            // mid-session: unregister EVERY registered input (texture A),
            // then register texture B and encode — the driver must accept
            // the re-registration on the live session
            let unregister: FnTwoHandles = std::mem::transmute(
                encoder.function_list.ptr_at(OFF_UNREGISTER_RESOURCE),
            );
            for input in encoder.inputs.values() {
                let status = unregister(encoder.encoder, input.registered);
                assert_eq!(
                    status, NV_ENC_SUCCESS,
                    "NvEncUnregisterResource mid-session failed: {status:#x}"
                );
            }
            encoder.inputs.clear();

            let texture_b = make_texture(&device);
            assert!(encoder
                .submit(texture_b.as_raw(), false, 2)
                .expect("submit B"));
            let bitstream_b = drain_one(&mut encoder, "frame B");
            assert!(!bitstream_b.is_empty(), "frame B produced no bitstream");
            eprintln!(
                "live nvenc re-register: A={}B, B={}B — mid-session re-registration OK",
                bitstream_a.len(),
                bitstream_b.len()
            );
            drop(texture_a);
            drop(texture_b);
        }
    }
}

