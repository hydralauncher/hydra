//! DXGI desktop duplication capture and the production video pipeline
//! (capture -> NVENC -> annex-B H.264 or HEVC frames).

use std::ffi::c_void;
use std::ptr;
use std::time::{Duration, Instant};

use windows::core::Interface;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HMODULE, LUID, RECT};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D::D3D_FEATURE_LEVEL_11_0;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11RenderTargetView,
    ID3D11Texture2D, ID3D11VideoContext, ID3D11VideoDevice, ID3D11VideoProcessor,
    ID3D11VideoProcessorEnumerator, ID3D11VideoProcessorInputView,
    ID3D11VideoProcessorOutputView, D3D11_BIND_RENDER_TARGET, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
    D3D11_VIDEO_PROCESSOR_CONTENT_DESC, D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC,
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_STREAM,
    D3D11_VIDEO_USAGE_OPTIMAL_QUALITY, D3D11_VPIV_DIMENSION_TEXTURE2D,
    D3D11_VPOV_DIMENSION_TEXTURE2D,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_R16G16B16A16_FLOAT, DXGI_RATIONAL,
    DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter, IDXGIDevice, IDXGIDevice1, IDXGIFactory1, IDXGIOutput,
    IDXGIOutput1, IDXGIOutput5, IDXGIOutputDuplication, DXGI_ERROR_ACCESS_LOST,
    DXGI_ERROR_WAIT_TIMEOUT,
};
use windows::Win32::Security::{
    AdjustTokenPrivileges, LookupPrivilegeValueW, SE_INC_BASE_PRIORITY_NAME, SE_PRIVILEGE_ENABLED,
    TOKEN_ADJUST_PRIVILEGES, TOKEN_PRIVILEGES, TOKEN_QUERY,
};
use windows::Win32::System::LibraryLoader::{GetModuleHandleA, GetProcAddress};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows::core::s;

use crate::amf::AmfEncoder;
use crate::nvenc::{EncoderConfigParams, NvencEncoder};
use crate::shared::{BeginProduceError, CrossAdapterBridge};
use crate::video::{
    frame_age_decision, projected_encode_age, EncodedFrame, FrameAgeDecision, FrameStages,
    FrameSupply, VideoPipeline,
};

/// Hardware encoder backend (NVENC or AMF) bound to the capture's D3D11
/// textures. submit/poll instead of one blocking call because both
/// backends pipeline: submission returns immediately and bitstreams are
/// reaped later, so capture/scale of frame N+1 overlaps the GPU-side
/// encode of frame N (a serial submit-wait chain pays one GPU scheduling
/// quantum per dependency under a saturated GPU — the 7Hz stream).
///
/// `SubmitHandle` is an opaque per-submission ticket the caller
/// associates with its own frame state (capture timestamp, ring slot);
/// poll() echoes it back with the bitstream.
pub type SubmitHandle = usize;

/// Whether a submission was accepted.
pub enum SubmitState {
    /// Accepted; poll() will eventually echo the handle.
    Submitted,
    /// Every pipeline slot is still in flight; the frame was NOT
    /// accepted. The caller drops it — the freshness policy prefers
    /// skipping ahead over stalling capture.
    Busy,
}

pub trait TextureEncoder: Send {
    /// Submits one texture for encoding.
    fn submit(
        &mut self,
        texture: *mut c_void,
        force_idr: bool,
        handle: SubmitHandle,
    ) -> Result<SubmitState, String>;
    /// Drains completed bitstreams (oldest first, nonblocking). Callers
    /// that only ship the newest frame still free every returned slot.
    /// Each tuple is (bitstream, encoder-side idr flag, caller handle,
    /// after-ref-invalidation mark — the packetizer turns it into
    /// frameType 5).
    fn poll(&mut self) -> Result<Vec<(Vec<u8>, bool, SubmitHandle, bool)>, String>;
    /// Reference-frame invalidation for a client 0x0301 request: true
    /// when the encoder invalidated the range, false when the caller
    /// must fall back to a full IDR. Encoders without the driver
    /// support inherit this default (Sunshine's software encoders do
    /// the same: log and force an IDR).
    fn invalidate_ref_frames(&mut self, _first_frame: i64, _last_frame: i64) -> bool {
        false
    }
    /// Whether this encoder can invalidate reference frames at all (NVENC
    /// with the driver capability AND a DPB deeper than one frame).
    /// Encoders without it inherit the default; the sender loop then keeps
    /// the IDR-only recovery policies (P-frame suppression + 500ms
    /// keyframes) instead of the RFI fast path.
    fn supports_ref_invalidation(&self) -> bool {
        false
    }
    /// Adaptive bitrate reconfiguration mid-session (NVENC
    /// NvEncReconfigureEncoder / AMF post-init SetProperty). Encoders
    /// that cannot reconfigure return Err and the pipeline recreates.
    fn set_bitrate(&mut self, kbps: u32) -> Result<(), String>;
    /// Frames inside the encoder right now (audit: must never exceed ~2
    /// on the low-latency path).
    fn pending_depth(&self) -> usize;
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum EncoderBackend {
    Nvenc,
    Amf,
    /// AMF encoder running on a second GPU, fed through cross-adapter
    /// shared textures; capture and scaling stay on the display adapter.
    AmfCross,
}

impl EncoderBackend {
    pub fn label(self) -> &'static str {
        match self {
            EncoderBackend::Nvenc => "nvenc",
            EncoderBackend::Amf => "amf",
            EncoderBackend::AmfCross => "amf-cross",
        }
    }
}

/// Encoder path selection from HYDRA_STREAM_ENCODER (auto | nvenc | amf |
/// amf-cross).
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum EncoderSelection {
    /// Try amf-cross when a second encoder-capable adapter exists; on any
    /// failure fall back to the display adapter (nvenc first, then amf) —
    /// the pre-cross-adapter behavior.
    Auto,
    /// Force NVENC on the display adapter.
    Nvenc,
    /// Force AMF on the display adapter.
    Amf,
    /// Force the cross-adapter path; an initialization failure is fatal
    /// for the session (no silent fallback).
    AmfCross,
}

/// Parses the env value. Unknown/empty values fall back to auto with a
/// log line; pure so the policy is unit-testable.
pub fn parse_encoder_selection(raw: Option<&str>) -> EncoderSelection {
    match raw.map(str::trim) {
        None | Some("") => EncoderSelection::Auto,
        Some(value) => match value.to_ascii_lowercase().as_str() {
            "auto" => EncoderSelection::Auto,
            "nvenc" => EncoderSelection::Nvenc,
            "amf" => EncoderSelection::Amf,
            "amf-cross" => EncoderSelection::AmfCross,
            other => {
                eprintln!("video: unknown HYDRA_STREAM_ENCODER '{other}', using auto");
                EncoderSelection::Auto
            }
        },
    }
}

fn encoder_selection() -> EncoderSelection {
    static SELECTION: std::sync::OnceLock<EncoderSelection> = std::sync::OnceLock::new();
    *SELECTION.get_or_init(|| {
        let raw = std::env::var("HYDRA_STREAM_ENCODER").unwrap_or_default();
        parse_encoder_selection(Some(raw.as_str()))
    })
}

/// Whether the selection wants the cross-adapter path attempted before
/// the display-adapter encoder. Pure.
fn attempts_cross(selection: EncoderSelection) -> bool {
    matches!(
        selection,
        EncoderSelection::Auto | EncoderSelection::AmfCross
    )
}

/// Whether a failed cross-adapter attempt aborts capture creation instead
/// of falling through to the display-adapter encoder. Pure.
fn cross_failure_fatal(selection: EncoderSelection) -> bool {
    selection == EncoderSelection::AmfCross
}

/// Backend policy: NVENC where it initializes, AMF as the fallback for
/// adapters without NVENC (e.g. AMD GPUs). Pure so the choice is
/// unit-testable; the hardware probes themselves are not.
pub fn preferred_backend(nvenc_works: bool) -> EncoderBackend {
    if nvenc_works {
        EncoderBackend::Nvenc
    } else {
        EncoderBackend::Amf
    }
}

/// Probed encoder capability: whether the encoder the session will use can
/// invalidate reference frames (RFI), how deep a decoded-picture buffer
/// it accepted, and whether it can encode HEVC at all. DESCRIBE runs
/// before the session's encoder exists, so the
/// capability is advertised from this probe (Sunshine probes its encoders
/// at startup too: `video::probe_encoders` →
/// `last_encoder_probe_supported_ref_frames_invalidation`, emitted in
/// `rtsp.cpp`); the probe really creates a throwaway encoder session, so we
/// never advertise a capability the encoder lacks and never configure a
/// ref count the driver rejects.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RecoveryCapability {
    /// Invalidation is usable: the driver advertises
    /// NV_ENC_CAPS_SUPPORT_REF_PIC_INVALIDATION AND the DPB is deeper than
    /// one frame (invalidating inside a 1-frame DPB is no cheaper than a
    /// full IDR, so RFI is reported false there — Sunshine clears
    /// `encoder_params.rfi` in exactly that case).
    pub rfi: bool,
    /// The ref count the probe's session was created with: the depth the
    /// driver accepted, and the ceiling every session may configure.
    pub ref_frames: u32,
    /// A real HEVC Main session opened on the probe's adapter. HEVC is
    /// advertised (serverinfo's `MaxLumaPixelsHEVC`/`ServerCodecModeSupport`
    /// and the VPS marker in the RTSP DESCRIBE body) only when this is set,
    /// and only then can a client's `x-nv-vqos[0].bitStreamFormat=1` be
    /// honored — advertising a codec the session cannot encode would leave
    /// the client decoding HEVC from an H.264 bitstream. The AMF fallback
    /// is H.264-only (`AMFVideoEncoderVCE_AVC`), so it reports false.
    pub hevc: bool,
    /// A real HEVC **Main10** session opened on the probe's adapter (and the
    /// driver advertises `NV_ENC_CAPS_SUPPORT_10BIT_ENCODE` for HEVC). This
    /// is the HDR gate: it adds `SCM_HEVC_MAIN10` to the serverinfo
    /// advertisement, which is what makes a Moonlight client offer HDR at
    /// all — and it is only claimed when a 10-bit session really opens.
    pub hevc_main10: bool,
}

/// No session could be created (or the selected backend has no RFI): the
/// IDR-only recovery mode with a single reference frame and no HEVC.
pub const NO_RECOVERY: RecoveryCapability = RecoveryCapability {
    rfi: false,
    ref_frames: 1,
    hevc: false,
    hevc_main10: false,
};

/// Probe session shape: tiny, so the throwaway session costs nothing
/// measurable on the GPU.
const PROBE_WIDTH: u32 = 640;
const PROBE_HEIGHT: u32 = 480;
const PROBE_FPS: u32 = 60;
const PROBE_BITRATE_KBPS: u32 = 5_000;

/// Runs the recovery-capability probe once per process and caches it (the
/// backend selection is cached the same way). Never panics: a machine with
/// no NVIDIA GPU, without an encoder at all, or running the AMF backend
/// simply reports [`NO_RECOVERY`].
pub fn probe_recovery_capability() -> RecoveryCapability {
    static CAPABILITY: std::sync::OnceLock<RecoveryCapability> = std::sync::OnceLock::new();
    *CAPABILITY.get_or_init(run_recovery_probe)
}

/// The probed capability, probing on first use if the startup call in
/// `main` has not happened yet (DESCRIBE must never depend on boot order).
pub fn recovery_capability() -> RecoveryCapability {
    probe_recovery_capability()
}

/// Creates one D3D11 device on an adapter (no duplication): the throwaway
/// device the probe opens its encoder session on.
unsafe fn probe_device(adapter: &IDXGIAdapter) -> Result<ID3D11Device, String> {
    let mut device: Option<ID3D11Device> = None;
    D3D11CreateDevice(
        adapter,
        D3D_DRIVER_TYPE_UNKNOWN,
        HMODULE(ptr::null_mut()),
        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        Some(&[D3D_FEATURE_LEVEL_11_0]),
        D3D11_SDK_VERSION,
        Some(&mut device),
        None,
        None,
    )
    .map_err(|error| format!("D3D11CreateDevice: {error}"))?;
    device.ok_or("D3D11CreateDevice returned no device".to_string())
}

/// The probe itself (see [`probe_recovery_capability`]). Tries the adapters
/// in the production order and creates a real NVENC session with the
/// default ref count first: the capability and depth we advertise must match
/// what the session will really be configured with. A driver that rejects
/// the default depth still accepts 1 — reported as `rfi: false,
/// ref_frames: 1`, the depth that makes the IDR fallback honest. Once the
/// H.264 session is up, an HEVC Main session is opened on the same device:
/// that is the whole HEVC advertisement gate.
fn run_recovery_probe() -> RecoveryCapability {
    if matches!(
        encoder_selection(),
        EncoderSelection::Amf | EncoderSelection::AmfCross
    ) {
        eprintln!(
            "video: recovery probe: amf encoder, no ref invalidation (IDR recovery), \
             no HEVC (AMF is H.264-only)"
        );
        return NO_RECOVERY;
    }
    let adapters = match DxgiCapture::candidate_adapters() {
        Ok(adapters) => adapters,
        Err(error) => {
            eprintln!("video: recovery probe: {error}");
            return NO_RECOVERY;
        }
    };
    let mut last_error = String::new();
    for adapter in adapters.iter() {
        let name = adapter_name(adapter);
        let device = match unsafe { probe_device(adapter) } {
            Ok(device) => device,
            Err(error) => {
                last_error = format!("{name}: {error}");
                continue;
            }
        };
        for ref_frames in [crate::nvenc::REF_FRAMES_DEFAULT, 1] {
            let params = EncoderConfigParams {
                codec: crate::video::VideoCodec::H264,
                hdr: false,
                width: PROBE_WIDTH,
                height: PROBE_HEIGHT,
                fps: PROBE_FPS,
                bitrate_kbps: PROBE_BITRATE_KBPS,
                slices_per_frame: 1,
                max_ref_frames: ref_frames,
            };
            match NvencEncoder::new(device.as_raw(), &params) {
                Ok(encoder) => {
                    let rfi = encoder.supports_ref_invalidation();
                    let (hevc, hevc_main10) = probe_hevc(device.as_raw(), ref_frames);
                    eprintln!(
                        "video: recovery probe: {name} {ref_frames} ref frames, \
                         ref-pic-invalidation={rfi}, hevc={hevc}, hevc-main10={hevc_main10}"
                    );
                    return RecoveryCapability {
            rfi,
            ref_frames,
            hevc,
            hevc_main10,
        };
                }
                Err(error) => {
                    eprintln!("video: recovery probe: {name} {ref_frames} ref frames: {error}");
                    last_error = format!("{name}: {error}");
                }
            }
        }
    }
    eprintln!("video: recovery probe: no encoder session ({last_error}), IDR recovery");
    NO_RECOVERY
}

/// Opens one throwaway HEVC Main session on the probe's device, with the
/// same shape as the H.264 half. A driver without HEVC encoding (or a GPU
/// older than Maxwell 2nd gen) fails here and the host then advertises
/// H.264 only, so no client is ever offered a codec the session cannot
/// produce. Reports `(hevc, hevc_main10)`.
///
/// The second answer gates the `SCM_HEVC_MAIN10` advertisement and therefore
/// HDR. It needs both the driver's `NV_ENC_CAPS_SUPPORT_10BIT_ENCODE` for
/// HEVC (read from the session that just opened — NVENC answers caps per
/// codec) *and* a 10-bit session that really opens, since that is exactly
/// what an HDR session asks of the driver. A driver without HEVC pays for
/// one session, not two.
fn probe_hevc(device: *mut c_void, ref_frames: u32) -> (bool, bool) {
    let params = |hdr| EncoderConfigParams {
        codec: crate::video::VideoCodec::Hevc,
        hdr,
        width: PROBE_WIDTH,
        height: PROBE_HEIGHT,
        fps: PROBE_FPS,
        bitrate_kbps: PROBE_BITRATE_KBPS,
        slices_per_frame: 1,
        max_ref_frames: ref_frames,
    };
    let encoder = match NvencEncoder::new(device, &params(false)) {
        Ok(encoder) => encoder,
        Err(error) => {
            eprintln!("video: recovery probe: no HEVC session ({error})");
            return (false, false);
        }
    };
    let caps = encoder.supports_10bit_encode();
    drop(encoder);
    if !caps {
        return (true, false);
    }
    let main10 = match NvencEncoder::new(device, &params(true)) {
        Ok(_) => true,
        Err(error) => {
            eprintln!("video: recovery probe: no HEVC Main10 session ({error})");
            false
        }
    };
    (true, main10)
}

/// Resolves the DPB depth for a session from the client's
/// `x-nv-video[0].maxNumReferenceFrames` and the startup probe. `0`
/// ("host picks", which only an RFI-aware client sends) and an absent
/// attribute both mean [`crate::nvenc::REF_FRAMES_DEFAULT`] — Sunshine's
/// H.264 `default_count`; a positive count is the client's request. The
/// probe's accepted depth is the ceiling (anything deeper was rejected by
/// the driver, and a probe that left `ref_frames` at 1 caps the session at
/// one reference), clamped to the H.264-level sanity ceiling. Pure.
pub fn resolve_ref_frames(client_frames: Option<u32>, capability: RecoveryCapability) -> u32 {
    let requested = match client_frames {
        Some(count) if count > 0 => count,
        _ => crate::nvenc::REF_FRAMES_DEFAULT,
    };
    requested
        .min(capability.ref_frames)
        .clamp(1, crate::nvenc::REF_FRAMES_MAX)
}

/// Resolution-preserving recreation policy. A display mode change that
/// keeps the resolution (a refresh-rate flip, an HDR toggle) only kills
/// the DXGI duplication object — the D3D11 device, the scaler's staging
/// texture and owned targets, and the encoder session (whose registered
/// inputs ARE the scaler's persistent targets, unchanged) all stay valid,
/// so the pipeline can re-duplicate on the same device and resume without
/// the expensive encoder teardown/re-init (what Sunshine's
/// capture_e::reinit does by resetting only the display while the encoder
/// sessions live on). A resolution change invalidates the scaler's
/// content description and staging texture, and a missing/broken encoder
/// defeats the point — both take the full recreation.
fn can_fast_recreate(
    old_width: u32,
    old_height: u32,
    new_width: u32,
    new_height: u32,
    encoder_healthy: bool,
) -> bool {
    encoder_healthy && old_width == new_width && old_height == new_height
}

/// Probes encoder backends for one adapter's D3D device: NVENC first,
/// then AMF on the same device. Only the working backend is constructed.
/// AMF is H.264-only, so an HEVC session never falls back to it: silently
/// encoding H.264 for a client that negotiated HEVC would be a black
/// screen with no diagnostic, and the probe that let the client ask for
/// HEVC in the first place only succeeds on NVENC.
fn create_encoder(
    device: *mut c_void,
    config: &EncoderConfigParams,
) -> Result<(Box<dyn TextureEncoder>, EncoderBackend), String> {
    match NvencEncoder::new(device, config) {
        Ok(encoder) => Ok((Box::new(encoder), EncoderBackend::Nvenc)),
        Err(nvenc_error) => {
            if config.codec != crate::video::VideoCodec::H264 {
                return Err(format!(
                    "nvenc unavailable for {} ({nvenc_error}); the amf fallback cannot encode it",
                    config.codec.name()
                ));
            }
            eprintln!("nvenc unavailable on this adapter ({nvenc_error}); trying amf");
            match AmfEncoder::new(device, config) {
                Ok(encoder) => Ok((Box::new(encoder), EncoderBackend::Amf)),
                Err(amf_error) => Err(format!(
                    "no working encoder (nvenc: {nvenc_error}; amf: {amf_error})"
                )),
            }
        }
    }
}

/// Letterbox fit of a sw x sh source into a tw x th target: uniform scale
/// plus centering, so the whole desktop stays visible (black bars when the
/// aspects differ — e.g. an ultrawide desktop on a 16:9 client). Returns
/// the destination rectangle (x, y, w, h) inside the target.
pub(crate) fn fit_rect(sw: u32, sh: u32, tw: u32, th: u32) -> (u32, u32, u32, u32) {
    if sw == 0 || sh == 0 || tw == 0 || th == 0 {
        return (0, 0, tw, th);
    }
    let scale = (tw as f64 / sw as f64).min(th as f64 / sh as f64);
    let w = ((sw as f64 * scale).round() as u32).clamp(1, tw);
    let h = ((sh as f64 * scale).round() as u32).clamp(1, th);
    ((tw - w) / 2, (th - h) / 2, w, h)
}

/// Delay between display recreation attempts after a failure.
const RECREATE_BACKOFF: Duration = Duration::from_millis(500);
/// Consecutive recreation failures after which the video loop gives up
/// (~30s at the backoff cadence) and lets the session tear down.
const MAX_RECREATE_FAILURES: u32 = 60;

/// Pause after an idle acquire-timeout when the loop will retry without
/// emitting anything (Sunshine display_base.cpp:315-324 sleeps 10ms the
/// same way). NEVER call this before a duplicate emission: the idle 60fps
/// cadence is the pacer's slot schedule, which the duplicate admission
/// stamps from the clock BEFORE the pause — a pause on the emission path
/// would compound into the next slot and drift the cadence.
fn idle_acquire_pause() {
    std::thread::sleep(Duration::from_millis(10));
}

/// Pure pacing predicate: is a frame due at `now`? `next_slot` is the
/// pacer's next admission slot, one frame interval after the last
/// admitted frame's slot — the frame interval has elapsed, in the
/// schedule's own terms, exactly when `now` reaches it.
///
/// The comparison is exact (no early admission): an emission made before
/// its slot would be the whole bug back, since the wire rate would then
/// follow whatever the desktop presents. The misfire this guards against
/// is a wall-clock threshold re-anchored from the emission, where every
/// later deadline inherited the same offset (the ~30fps stream at a 60Hz
/// desktop): here nothing moves the schedule but the slot itself, so it
/// keeps its own phase.
fn frame_due(now: Instant, next_slot: Instant) -> bool {
    now >= next_slot
}

/// Emission pacing for the capture boundary: how many frames reach the
/// scaler and the encoder is the negotiated frame rate, whatever rate the
/// compositor presents at. A 165Hz panel, DLSS Frame Generation, or a
/// game running above the client's `maxFPS` all hand the duplicator
/// frames the client never budgeted for, and `AcquireNextFrame` returns
/// one the moment it exists — so an unguarded acquire loop runs at the
/// present rate (measured from a live session's own logs: a 60fps client
/// received 95-103 frames/s, and its decoder overran into 978 IDR
/// requests / 672 forced IDRs in 100 seconds, each answer a 96-103KB
/// keyframe — more decode work, ~60% of the intended bits per frame, a
/// frozen picture).
///
/// The pacer is a slot schedule, not "the time since the last emission":
/// every admitted frame advances `next_slot` by one frame interval from
/// the slot it was admitted for, so an emitted frame that lands late (or
/// early, inside the schedule) never drags the following slots with it —
/// a cadence re-anchored to the emission instant is what compounds into
/// the ~30fps phase lock this schedule replaced. It is clamped to
/// the admission instant instead, so a stall (idle desktop, a paused
/// game, an encoder that fell behind) cannot bank slots and release them
/// as a burst: the worst a stall costs is one frame that is due
/// immediately.
///
/// The duplicator is not touched before a slot is due: the image a slot
/// takes is the newest the desktop has at that instant, so a present that
/// arrives early is folded into it (the duplication coalesces) and costs
/// neither a scale nor a 4K encode on its own.
pub(crate) struct FramePacer {
    interval: Duration,
    /// Next instant a frame may be admitted. Advanced one `interval` per
    /// admission (from the slot, not from the admission instant);
    /// clamped to the admission instant (`max(.., now)`) so a stall
    /// cannot bank slots and release them as a burst.
    next_slot: Instant,
}

impl FramePacer {
    pub(crate) fn new(interval: Duration, now: Instant) -> Self {
        // the first frame is due immediately: the pipeline's own startup
        // wait for the first desktop frame is the 100ms acquire below
        FramePacer {
            interval,
            next_slot: now,
        }
    }

    /// Whether a frame may be admitted at `now` (see [`frame_due`]). Both
    /// the captured-frame path and the idle-duplicate keepalive use this
    /// one rule, so every path that can put a frame on the wire — real
    /// frame, duplicate, or forced IDR — is inside the negotiated rate.
    pub(crate) fn due(&self, now: Instant) -> bool {
        frame_due(now, self.next_slot)
    }

    /// How long the caller may block before another frame can be
    /// admitted: this is the acquire timeout that paces the loop. A
    /// present that arrives during the wait still wakes the acquire
    /// early, and `due` decides whether it is admitted.
    pub(crate) fn wait(&self, now: Instant) -> Duration {
        self.next_slot.saturating_duration_since(now)
    }

    /// A frame was admitted at `now`: advance the slot by one interval
    /// from the slot it was admitted for. The clamp is what keeps a stall
    /// from becoming a burst.
    pub(crate) fn note_emitted(&mut self, now: Instant) {
        self.next_slot = (self.next_slot + self.interval).max(now);
    }
}

/// Recreation scheduling for a lost desktop duplication (display mode
/// change, TDR, another duplicator grabbing the output): the first attempt
/// is immediate, failures back off by `RECREATE_BACKOFF`, and the schedule
/// gives up after `MAX_RECREATE_FAILURES` consecutive failures.
#[derive(Default)]
struct RecreateSchedule {
    failures: u32,
    next: Option<Instant>,
}

impl RecreateSchedule {
    fn new() -> Self {
        RecreateSchedule::default()
    }

    fn due(&self, now: Instant) -> bool {
        self.next.is_none_or(|next| now >= next)
    }

    fn note_failure(&mut self, now: Instant) {
        self.failures += 1;
        self.next = Some(now + RECREATE_BACKOFF);
    }

    fn reset(&mut self) {
        *self = Self::new();
    }

    fn given_up(&self) -> bool {
        self.failures >= MAX_RECREATE_FAILURES
    }
}

/// Frame acquired from the desktop. The texture stays valid until `drop`
/// (which releases the duplication frame).
pub struct DxgiFrame {
    pub texture: ID3D11Texture2D,
    pub acquired: Instant,
    duplication: IDXGIOutputDuplication,
}

impl Drop for DxgiFrame {
    fn drop(&mut self) {
        unsafe {
            let _ = self.duplication.ReleaseFrame();
        }
    }
}

pub struct DxgiCapture {
    device: ID3D11Device,
    _context: ID3D11DeviceContext,
    duplication: IDXGIOutputDuplication,
    pub width: u32,
    pub height: u32,
    /// Refresh rate of the duplicated output's current mode, rounded to
    /// whole Hz (0 when the driver reports none). Read once from the
    /// duplication's `ModeDesc` — telemetry only: a 30Hz desktop would
    /// explain a 30fps stream without a single pipeline fault, so the
    /// number has to be on the session line to rule that out.
    pub refresh_hz: u32,
}

impl DxgiCapture {
    /// Enumerates display adapters, NVIDIA first (the NVENC session must
    /// run on the same device as the captured texture). Creating the
    /// D3D11 device per adapter later also wakes a powered-down dGPU so
    /// output enumeration succeeds.
    pub fn candidate_adapters() -> Result<Vec<IDXGIAdapter>, String> {
        unsafe {
            let factory: IDXGIFactory1 =
                CreateDXGIFactory1().map_err(|error| format!("CreateDXGIFactory1: {error}"))?;
            let mut adapters: Vec<IDXGIAdapter> = Vec::new();
            for index in 0..16 {
                match factory.EnumAdapters(index) {
                    Ok(adapter) => adapters.push(adapter),
                    Err(_) => break,
                }
            }
            if adapters.is_empty() {
                return Err("no DXGI adapters".to_string());
            }
            let mut ordered: Vec<IDXGIAdapter> = Vec::with_capacity(adapters.len());
            for adapter in adapters {
                let name = adapter_name(&adapter);
                if name.to_ascii_lowercase().contains("nvidia") {
                    ordered.insert(0, adapter);
                } else {
                    ordered.push(adapter);
                }
            }
            Ok(ordered)
        }
    }

    pub fn device_ptr(&self) -> *mut c_void {
        self.device.as_raw()
    }

    /// The LUID of the adapter the capture device was created on, used to
    /// skip the display adapter when probing offload candidates.
    pub fn adapter_luid(&self) -> (u32, i32) {
        unsafe {
            let dxgi_device: IDXGIDevice = self
                .device
                .cast()
                .expect("capture device must expose IDXGIDevice");
            let adapter = dxgi_device.GetAdapter().expect("GetAdapter");
            let desc = adapter.GetDesc().expect("GetDesc");
            (
                desc.AdapterLuid.LowPart,
                desc.AdapterLuid.HighPart,
            )
        }
    }

    /// Reference to the D3D11 device (for building per-pipeline GPU
    /// helpers like the resolution scaler).
    pub fn device(&self) -> ID3D11Device {
        self.device.clone()
    }

    /// Acquires the next desktop frame, waiting up to `timeout_ms`.
    /// `Ok(None)` on wait timeout; `Err` on access loss (caller should
    /// recreate the capture).
    pub fn acquire(&self, timeout_ms: u32) -> Result<Option<DxgiFrame>, String> {
        unsafe {
            let mut frame_info = std::mem::zeroed();
            let mut resource = None;
            match self.duplication.AcquireNextFrame(timeout_ms, &mut frame_info, &mut resource) {
                Ok(()) => {}
                Err(error) if error.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(None),
                Err(error) if error.code() == DXGI_ERROR_ACCESS_LOST => {
                    return Err("desktop duplication access lost".to_string());
                }
                Err(error) => return Err(format!("AcquireNextFrame: {error}")),
            }
            let resource = resource.ok_or("AcquireNextFrame returned no resource")?;
            let texture: ID3D11Texture2D = resource
                .cast()
                .map_err(|error| format!("texture cast: {error}"))?;
            Ok(Some(DxgiFrame {
                texture,
                acquired: Instant::now(),
                duplication: self.duplication.clone(),
            }))
        }
    }
}

/// Whole-Hz rounding of a DXGI refresh rate (60000/1001 -> 60). Zero when
/// the driver reports nothing usable.
fn refresh_hz(rate: &DXGI_RATIONAL) -> u32 {
    if rate.Denominator == 0 || rate.Numerator == 0 {
        return 0;
    }
    ((rate.Numerator as u64 + rate.Denominator as u64 / 2) / rate.Denominator as u64) as u32
}

fn adapter_name(adapter: &IDXGIAdapter) -> String {
    unsafe {
        adapter
            .GetDesc()
            .map(|desc| String::from_utf16_lossy(&desc.Description))
            .unwrap_or_default()
    }
}

// D3DKMT proc types resolved from gdi32.dll, mirroring Sunshine
// display_base.cpp:635-696. Layouts from the WDK d3dkmthk.h/d3dkmdt.h:
// D3DKMT_OPENADAPTERFROMLUID { LUID; D3DKMT_HANDLE }, D3DKMT_HANDLE is a
// UINT, KMTQAITYPE_WDDM_2_7_CAPS is 70, and HwSchEnabled is bit 1 of the
// WDDM_2_7 caps word.
#[repr(C)]
struct D3dkmtOpenAdapterFromLuid {
    adapter_luid: i64,
    h_adapter: u32,
}
#[repr(C)]
struct D3dkmtQueryAdapterInfo {
    h_adapter: u32,
    info_type: u32,
    data: *mut c_void,
    data_size: u32,
}
#[repr(C)]
struct D3dkmtCloseAdapter {
    h_adapter: u32,
}
type FnD3dkmtOpenAdapterFromLuid =
    unsafe extern "system" fn(*mut D3dkmtOpenAdapterFromLuid) -> i32;
type FnD3dkmtQueryAdapterInfo = unsafe extern "system" fn(*mut D3dkmtQueryAdapterInfo) -> i32;
type FnD3dkmtCloseAdapter = unsafe extern "system" fn(*const D3dkmtCloseAdapter) -> i32;
type FnD3dkmtSetProcessSchedulingPriorityClass = unsafe extern "system" fn(HANDLE, u32) -> i32;

const KMTQAITYPE_WDDM_2_7_CAPS: u32 = 70;
const D3DKMT_WDDM_2_7_CAPS_HWSCH_ENABLED: u32 = 1 << 1;
const D3DKMT_SCHEDULINGPRIORITYCLASS_HIGH: u32 = 4;
const D3DKMT_SCHEDULINGPRIORITYCLASS_REALTIME: u32 = 5;
const NVIDIA_VENDOR_ID: u32 = 0x10DE;

/// Enables SE_INC_BASE_PRIORITY_NAME so SetGPUThreadPriority can succeed
/// without the process running elevated (Sunshine display_base.cpp
/// :616-633). Best effort: every failure only costs priority.
fn enable_increase_base_priority_privilege() {
    unsafe {
        let mut token = HANDLE::default();
        let Ok(_) = OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
            &mut token,
        ) else {
            return;
        };
        let mut luid = LUID::default();
        if LookupPrivilegeValueW(None, SE_INC_BASE_PRIORITY_NAME, &mut luid).is_ok() {
            let mut privileges = TOKEN_PRIVILEGES {
                PrivilegeCount: 1,
                ..Default::default()
            };
            privileges.Privileges[0].Luid = luid;
            privileges.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
            if AdjustTokenPrivileges(token, false, Some(&privileges), 0, None, None).is_err() {
                eprintln!("capture: could not enable SE_INC_BASE_PRIORITY_NAME (GPU thread priority may fail)");
            }
        }
        let _ = CloseHandle(token);
    }
}

/// Process-wide GPU scheduling priority via D3DKMT, resolved from
/// gdi32.dll like Sunshine does (display_base.cpp:676-696): REALTIME,
/// demoted to HIGH for NVIDIA with HAGS — the NVIDIA driver has an
/// unfixed bug where realtime scheduling plus hardware-accelerated GPU
/// scheduling can freeze encoding or crash the driver outright.
fn raise_process_gpu_priority(adapter_luid: i64, vendor_id: u32) {
    unsafe {
        let Ok(gdi32) = GetModuleHandleA(s!("gdi32.dll")) else {
            return;
        };
        let (Some(open), Some(query), Some(close), Some(set_priority)) = (
            GetProcAddress(gdi32, s!("D3DKMTOpenAdapterFromLuid")),
            GetProcAddress(gdi32, s!("D3DKMTQueryAdapterInfo")),
            GetProcAddress(gdi32, s!("D3DKMTCloseAdapter")),
            GetProcAddress(gdi32, s!("D3DKMTSetProcessSchedulingPriorityClass")),
        ) else {
            eprintln!("capture: gdi32.dll is missing the D3DKMT exports; GPU scheduling priority skipped");
            return;
        };
        let open: FnD3dkmtOpenAdapterFromLuid = std::mem::transmute(open);
        let query: FnD3dkmtQueryAdapterInfo = std::mem::transmute(query);
        let close: FnD3dkmtCloseAdapter = std::mem::transmute(close);
        let set_priority: FnD3dkmtSetProcessSchedulingPriorityClass =
            std::mem::transmute(set_priority);

        let mut open_params = D3dkmtOpenAdapterFromLuid {
            adapter_luid,
            h_adapter: 0,
        };
        if open(&mut open_params) != 0 {
            eprintln!("capture: D3DKMTOpenAdapterFromLuid failed; GPU scheduling priority skipped");
            return;
        }
        let mut caps: u32 = 0;
        let mut info = D3dkmtQueryAdapterInfo {
            h_adapter: open_params.h_adapter,
            info_type: KMTQAITYPE_WDDM_2_7_CAPS,
            data: &mut caps as *mut u32 as *mut c_void,
            data_size: 4,
        };
        let hags_enabled =
            query(&mut info) == 0 && caps & D3DKMT_WDDM_2_7_CAPS_HWSCH_ENABLED != 0;
        let close_params = D3dkmtCloseAdapter {
            h_adapter: open_params.h_adapter,
        };
        close(&close_params);

        let mut priority = D3DKMT_SCHEDULINGPRIORITYCLASS_REALTIME;
        if vendor_id == NVIDIA_VENDOR_ID && hags_enabled {
            priority = D3DKMT_SCHEDULINGPRIORITYCLASS_HIGH;
        }
        eprintln!(
            "capture: adapter HAGS {} -> process GPU priority {}",
            if hags_enabled { "enabled" } else { "disabled" },
            if priority == D3DKMT_SCHEDULINGPRIORITYCLASS_REALTIME {
                "realtime"
            } else {
                "high"
            }
        );
        if set_priority(GetCurrentProcess(), priority) != 0 {
            eprintln!("capture: D3DKMTSetProcessSchedulingPriorityClass failed (run as administrator for best performance)");
        }
    }
}

/// Per-device latency knobs from Sunshine display_base.cpp:698-724:
/// GPU thread priority 7 and a single frame of queue latency. Best
/// effort — capture works without them, just with more scheduling
/// jitter behind a saturated GPU.
fn tune_capture_device(device: &ID3D11Device) {
    unsafe {
        match device.cast::<IDXGIDevice>() {
            Ok(dxgi_device) => {
                if let Err(error) = dxgi_device.SetGPUThreadPriority(7) {
                    eprintln!("capture: SetGPUThreadPriority failed ({error}); run as administrator for best performance");
                }
                match device.cast::<IDXGIDevice1>() {
                    Ok(dxgi1) => {
                        if let Err(error) = dxgi1.SetMaximumFrameLatency(1) {
                            eprintln!("capture: SetMaximumFrameLatency failed ({error})");
                        }
                    }
                    Err(error) => {
                        eprintln!("capture: no IDXGIDevice1 on the capture device ({error}); frame latency untouched")
                    }
                }
            }
            Err(error) => {
                eprintln!("capture: no IDXGIDevice on the capture device ({error}); GPU priority skipped")
            }
        }
    }
}

/// Sunshine display_base.cpp:616-724, run once per capture device:
/// the process scheduling class, then the per-device knobs. Failures
/// are logged and never stop capture.
fn tune_gpu_scheduling(adapter: &IDXGIAdapter, device: &ID3D11Device) {
    let desc = unsafe { adapter.GetDesc() }.map_err(|error| error.to_string()).ok();
    enable_increase_base_priority_privilege();
    if let Some(desc) = desc {
        let luid = (i64::from(desc.AdapterLuid.HighPart) << 32)
            | i64::from(desc.AdapterLuid.LowPart);
        raise_process_gpu_priority(luid, desc.VendorId);
    } else {
        eprintln!("capture: adapter desc unavailable; GPU scheduling priority skipped");
    }
    tune_capture_device(device);
}

unsafe fn try_adapter(adapter: &IDXGIAdapter) -> Result<DxgiCapture, String> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;
    D3D11CreateDevice(
        adapter,
        D3D_DRIVER_TYPE_UNKNOWN,
        HMODULE(ptr::null_mut()),
        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        Some(&[D3D_FEATURE_LEVEL_11_0]),
        D3D11_SDK_VERSION,
        Some(&mut device),
        None,
        Some(&mut context),
    )
    .map_err(|error| format!("D3D11CreateDevice: {error}"))?;
    let device = device.ok_or("D3D11CreateDevice returned no device")?;
    let context = context.ok_or("D3D11CreateDevice returned no context")?;

    // Bump capture scheduling priority before the first frame (Sunshine
    // display_base.cpp:616-724). Best effort; capture proceeds without.
    tune_gpu_scheduling(adapter, &device);

    // Creating the device wakes a sleepy dGPU; enumerate outputs now.
    for output_index in 0..8 {
        let Ok(output) = adapter.EnumOutputs(output_index) else {
            break;
        };
        let duplication = match duplicate_output(&output, &device) {
            Ok(duplication) => duplication,
            Err(error) => {
                eprintln!("{error}");
                continue;
            }
        };
        let desc = duplication.GetDesc();
        let width = desc.ModeDesc.Width;
        let height = desc.ModeDesc.Height;
        if width == 0 || height == 0 {
            return Err("duplicated output has zero size".to_string());
        }
        eprintln!("desktop duplication: {width}x{height}");
        return Ok(DxgiCapture {
            device,
            _context: context,
            duplication,
            width,
            height,
            refresh_hz: refresh_hz(&desc.ModeDesc.RefreshRate),
        });
    }
    Err("no duplicatable output".to_string())
}

/// Formats offered to `IDXGIOutput5::DuplicateOutput1`, in preference order.
///
/// The legacy `IDXGIOutput1::DuplicateOutput` can only ever return the 8-bit
/// BGRA surface — including on an HDR output, where that surface is an
/// over-bright, clipped *rendition* of the desktop rather than the desktop
/// itself (measured: mean luma ~1.7x the SDR picture the monitor shows).
/// Naming `R16G16B16A16_FLOAT` — the FP16 scRGB desktop HDR encoding needs —
/// is what makes DXGI hand it over, which is why the HDR list is only
/// requested while the HDR capture path is enabled: the SDR path keeps
/// exactly the format and behaviour it has today.
const SDR_DUPLICATION_FORMATS: [DXGI_FORMAT; 1] = [DXGI_FORMAT_B8G8R8A8_UNORM];
const HDR_DUPLICATION_FORMATS: [DXGI_FORMAT; 2] = [
    DXGI_FORMAT_R16G16B16A16_FLOAT,
    DXGI_FORMAT_B8G8R8A8_UNORM,
];

/// Creates the desktop duplication, preferring the HDR-capable
/// `IDXGIOutput5::DuplicateOutput1` overload (the only one that can return
/// anything but BGRA) and falling back to `IDXGIOutput1::DuplicateOutput` on
/// an output or driver that predates it.
unsafe fn duplicate_output(
    output: &IDXGIOutput,
    device: &ID3D11Device,
) -> Result<IDXGIOutputDuplication, String> {
    let hdr = crate::config::hdr_enabled();
    let formats: &[DXGI_FORMAT] = if hdr {
        &HDR_DUPLICATION_FORMATS
    } else {
        &SDR_DUPLICATION_FORMATS
    };
    if let Ok(output5) = output.cast::<IDXGIOutput5>() {
        match output5.DuplicateOutput1(device, 0, formats) {
            Ok(duplication) => {
                eprintln!(
                    "desktop duplication: requested formats {:?} (HDR {}), actual format logged \
                     with the first frame",
                    formats.iter().map(|format| format.0).collect::<Vec<_>>(),
                    if hdr { "enabled" } else { "off" }
                );
                return Ok(duplication);
            }
            Err(error) => {
                eprintln!("DuplicateOutput1: {error}; falling back to DuplicateOutput");
            }
        }
    }
    let output1 = output
        .cast::<IDXGIOutput1>()
        .map_err(|error| format!("IDXGIOutput1: {error}"))?;
    output1
        .DuplicateOutput(device)
        .map_err(|error| format!("DuplicateOutput: {error}"))
}

/// Keeps the display from being switched off while a stream is running, by
/// holding `ES_DISPLAY_REQUIRED` (re-asserted every 500 ms) for its lifetime.
///
/// Measured on the RTX 5070, and the reason this type is scoped narrowly:
///
/// * with the output in DPMS standby the duplication is created fine but
///   delivers **zero** frames, while the desktop stays composed enough for GDI
///   to still read it (`probe_display_standby_capture`);
/// * calling `ES_DISPLAY_REQUIRED` again while the display is off does **not**
///   bring capture back — 0 frames across ten seconds of two-second retries —
///   so "switch the display off mid-stream" is not something this can fix. An
///   earlier version of this comment claimed a 530-frame recovery; that
///   measurement was an artefact of the probe's cursor wiggler, whose
///   `SetCursorPos` is user input and wakes a display on its own;
/// * what the flag *does* do, and why it is still held, is stop the Windows
///   power plan's display idle timer from turning the display off in the first
///   place — Sunshine's use of the same call (`display_base.cpp:245`).
///
/// The `create_capture` retry that accompanies it covers the case where the
/// output is not enumerated yet on the first pass. Neither helps when the
/// display is off at the OS level: the desktop stops being composed, nothing
/// presents, and there is nothing to duplicate — that needs a display that
/// stays on (a virtual one) rather than a flag.
///
/// `SetThreadExecutionState` is per-thread and a thread's state dies with it,
/// so this owns a thread that holds the state, re-asserts it, and parks until
/// dropped. The sender loop sets the same state for its own lifetime
/// (`video.rs`), but it only starts *after* the capture exists.
pub struct DisplayKeeper {
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl DisplayKeeper {
    /// Starts holding the display on. Returns once the state is set, not once
    /// the display has physically come back: the caller retries its own
    /// enumeration when that first attempt fails.
    pub fn start() -> Self {
        use windows::Win32::System::Power::{
            SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED,
        };
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let thread_stop = stop.clone();
        let thread = std::thread::spawn(move || {
            // Re-asserted every 500 ms rather than set once, which is what
            // keeps the *display idle timer* (the Windows power plan's "turn
            // off the display after N minutes") from firing mid-stream —
            // `ES_DISPLAY_REQUIRED`'s documented job, and Sunshine's use of it
            // (`display_base.cpp:245`).
            //
            // Measured, and worth knowing before trusting it for more: this
            // does **not** bring capture back once the display is actually
            // off. With the output in DPMS standby the duplication returns 0
            // frames, and calling this again every 2 s for 10 s returns 0
            // frames too (`probe_display_standby_capture`, keep-alive
            // buckets). Switching the display off underneath a stream
            // therefore cannot be papered over here: the desktop stops being
            // composed and there is nothing to duplicate. See the note on
            // `DisplayKeeper` — that case needs a display that stays on (a
            // virtual one) rather than a flag.
            while !thread_stop.load(std::sync::atomic::Ordering::Relaxed) {
                unsafe {
                    SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED);
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            // Dropping the thread would clear this anyway; clearing it here
            // documents the pairing and covers an explicit stop.
            unsafe {
                SetThreadExecutionState(ES_CONTINUOUS);
            }
        });
        Self {
            stop,
            thread: Some(thread),
        }
    }
}

impl Drop for DisplayKeeper {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}


/// The display's HDR10 metadata in the form the Moonlight HDR control
/// message carries it (`SS_HDR_METADATA`, moonlight-common-c
/// `Limelight.h:976-997`): Rec.2020 primaries and the D65 white point scaled
/// by 50,000, luminance in nits with the minimum in 1/10,000 nit.
///
/// Sunshine's Windows backend (`display_base.cpp:775-826`) hardcodes the
/// primaries — DXGI reports the panel's *measured* primaries, which are not
/// what the stream was graded against — and reads the luminances from
/// `DXGI_OUTPUT_DESC1`, which is what this does. Content light levels are
/// left at 0 for the same reason Sunshine does: the interface does not
/// report them. `hdr` is Sunshine's `is_hdr()`
/// (`ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020`), i.e. the
/// only desktop state an HDR stream can be captured from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DisplayHdr {
    /// Rec.2020 primaries, RGB order, each component `value * 50000`.
    pub primaries: [(u16, u16); 3],
    /// D65 white point, `value * 50000`.
    pub white_point: (u16, u16),
    /// `DXGI_OUTPUT_DESC1::MaxLuminance`, nits.
    pub max_luminance: u16,
    /// `MinLuminance` in 1/10,000 nit.
    pub min_luminance: u16,
    /// `MaxFullFrameLuminance`, nits (the third content-light field the
    /// client reads; Sunshine forwards it the same way).
    pub max_full_frame_luminance: u16,
    /// The chosen output is running the HDR10 colour space.
    pub hdr: bool,
}

/// Whether HEVC may be advertised and negotiated: only when this desktop can
/// actually be captured as HDR.
///
/// H.264 is the safe codec everywhere; HEVC is here for HDR10 (Main10), and
/// HDR is the one thing H.264 cannot carry. So a host with an SDR desktop
/// offers H.264 alone, and a client left on "Auto" — including one whose HEVC
/// decode is far worse than its H.264, measured on an Android TV as six
/// reconnects and 139 forced IDRs in nine minutes against one clean H.264
/// session — is never pushed onto HEVC just to stream SDR. With the desktop in
/// HDR mode the HEVC advertisement comes back, and the client's own HDR/10-bit
/// request is what selects it (`stream::session_hdr`).
///
/// `HYDRA_STREAM_CODECS=h264` ([`crate::config::hevc_advertised`]) still pins a
/// host to H.264 outright, and `HYDRA_STREAM_HDR=1` forces the HDR path (and
/// therefore HEVC) for the hardware probes.
pub fn hevc_offered() -> bool {
    crate::config::hevc_advertised()
        && (desktop_is_hdr() || crate::config::hdr_override() == Some(true))
}

/// Whether the duplicated desktop is in an HDR colour space right now, cached
/// for a second.
///
/// `serverinfo` is polled by the client several times a second, and the answer
/// decides whether `SCM_HEVC_MAIN10` may be advertised. It has to be the
/// *desktop's* state and not just the driver's capability: advertising the bit
/// makes a Moonlight client negotiate a 10-bit format — and aim its bitrate at
/// 10-bit levels, which the sessions here show as 100 Mbps against 32 Mbps for
/// the same client at 8-bit — while this host can only produce HDR10 from an
/// HDR desktop. With Windows HDR off the client would commit to 10-bit and then
/// silently receive 8-bit SDR, which is what "HDR off is broken too" looked
/// like. The cache keeps the DXGI enumeration off the serverinfo poll path
/// while still following a mid-session HDR toggle within a second.
pub fn desktop_is_hdr() -> bool {
    static CACHE: std::sync::Mutex<Option<(Instant, bool)>> = std::sync::Mutex::new(None);
    if let Ok(cache) = CACHE.lock() {
        if let Some((at, value)) = *cache {
            if at.elapsed() < Duration::from_secs(1) {
                return value;
            }
        }
    }
    let value = display_hdr_metadata().is_some_and(|metadata| metadata.hdr);
    if let Ok(mut cache) = CACHE.lock() {
        *cache = Some((Instant::now(), value));
    }
    value
}

/// Reads [`DisplayHdr`] for the first HDR output, falling back to the first
/// output at all (with `hdr == false`) so the caller always has luminances to
/// report. `None` means no output could be described.
pub fn display_hdr_metadata() -> Option<DisplayHdr> {
    let scale = |value: f32| (value * 50_000.0).round().clamp(0.0, 65_535.0) as u16;
    let nits = |value: f32| value.round().clamp(0.0, 65_535.0) as u16;
    let mut fallback = None;
    unsafe {
        let adapters = DxgiCapture::candidate_adapters().ok()?;
        for adapter in &adapters {
            for index in 0..4u32 {
                let Ok(output) = adapter.EnumOutputs(index) else {
                    break;
                };
                let Ok(output6) =
                    output.cast::<windows::Win32::Graphics::Dxgi::IDXGIOutput6>()
                else {
                    continue;
                };
                let Ok(desc) = output6.GetDesc1() else {
                    continue;
                };
                let metadata = DisplayHdr {
                    primaries: [
                        (scale(0.708), scale(0.292)),
                        (scale(0.170), scale(0.797)),
                        (scale(0.131), scale(0.046)),
                    ],
                    white_point: (scale(0.3127), scale(0.3290)),
                    max_luminance: nits(desc.MaxLuminance),
                    min_luminance: nits(desc.MinLuminance * 10_000.0),
                    max_full_frame_luminance: nits(desc.MaxFullFrameLuminance),
                    hdr: desc.ColorSpace
                        == windows::Win32::Graphics::Dxgi::Common::DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020,
                };
                if metadata.hdr {
                    return Some(metadata);
                }
                fallback.get_or_insert(metadata);
            }
        }
    }
    fallback
}

/// Re-creates the desktop duplication on an existing capture device —
/// the resolution-preserving fast path of the display-mode recreation.
/// `try_adapter` probes every adapter with a NEW device, which would tear
/// the encoder session down with it (the session is bound to the device's
/// textures); here the device — and with it the scaler, the encoder's
/// registered input textures, and the cross-adapter bridge — is reused
/// untouched. The caller must have released the previous duplication
/// first: an output only allows a single active duplicator.
unsafe fn recreate_duplication(device: &ID3D11Device) -> Result<DxgiCapture, String> {
    let dxgi_device: IDXGIDevice = device
        .cast()
        .map_err(|error| format!("IDXGIDevice: {error}"))?;
    let adapter = dxgi_device
        .GetAdapter()
        .map_err(|error| format!("GetAdapter: {error}"))?;
    let context = device
        .GetImmediateContext()
        .map_err(|error| format!("GetImmediateContext: {error}"))?;
    for output_index in 0..8 {
        let Ok(output) = adapter.EnumOutputs(output_index) else {
            break;
        };
        let duplication = match duplicate_output(&output, device) {
            Ok(duplication) => duplication,
            Err(error) => {
                eprintln!("{error}");
                continue;
            }
        };
        let desc = duplication.GetDesc();
        let width = desc.ModeDesc.Width;
        let height = desc.ModeDesc.Height;
        if width == 0 || height == 0 {
            return Err("duplicated output has zero size".to_string());
        }
        return Ok(DxgiCapture {
            device: device.clone(),
            _context: context,
            duplication,
            width,
            height,
            refresh_hz: refresh_hz(&desc.ModeDesc.RefreshRate),
        });
    }
    Err("no duplicatable output".to_string())
}
/// render target (the session's encode size, resolved before the first frame:
/// the negotiated client mode, or the macroblock-aligned rung the starting
/// bitrate pays for) with the D3D11 video processor,
/// so the encoder always produces the size the scaler was built with. The whole
/// source image is drawn centered; the bars stay black. Lives and dies
/// with the capture's D3D device, so display-mode recreation rebuilds it.
/// The cross-adapter path renders into shared-texture ring slots through
/// `scale_into` instead of the fixed `owned_target`.
struct ScalerTarget {
    rtv: ID3D11RenderTargetView,
    output_view: ID3D11VideoProcessorOutputView,
}

struct TextureScaler {
    device: ID3D11Device,
    video_context: ID3D11VideoContext,
    video_device: ID3D11VideoDevice,
    processor: ID3D11VideoProcessor,
    enumerator: ID3D11VideoProcessorEnumerator,
    context: ID3D11DeviceContext,
    /// Render targets for same-device encoding, one per pipeline slot:
    /// frame N+1 scales into the other texture while frame N's encode is
    /// still reading its own.
    owned_targets: Vec<ID3D11Texture2D>,
    /// Output views/RTVs per render-target texture (the cross-adapter ring
    /// renders into several shared textures, so the views are cached per
    /// texture pointer instead of fixed).
    targets: std::collections::HashMap<usize, ScalerTarget>,
    /// Desktop-duplication textures are rejected as video-processor input
    /// views (E_INVALIDARG, verified on RTX 5070), so frames are copied
    /// into this owned texture first.
    staging: ID3D11Texture2D,
    input_views: std::collections::HashMap<usize, ID3D11VideoProcessorInputView>,
    output_frame: u32,
    dest_rect: RECT,
    target_rect: RECT,
}

unsafe impl Send for TextureScaler {}

/// The frame-scaling stage of the pipeline: the D3D11 video processor for SDR
/// sessions, or the HDR shader converter (`hdr::HdrConverter`) when the
/// session encodes HDR10 — the video processor cannot ingest the FP16 scRGB
/// surface HDR capture produces. Both offer the three operations the pipeline
/// uses, and each produces exactly the input format its session's encoder
/// registered: 8-bit BGRA for SDR, P010 for HDR.
enum Scaler {
    Sdr(TextureScaler),
    Hdr(crate::hdr::HdrConverter),
}

impl Scaler {
    /// The encoder-side size this scaler renders at.
    fn target_size(&self) -> (u32, u32) {
        match self {
            Scaler::Sdr(scaler) => scaler.target_size(),
            Scaler::Hdr(converter) => converter.target_size(),
        }
    }

    /// Scales (SDR) or converts (HDR) `source` into this scaler's own target
    /// for `slot`.
    fn scale(&mut self, source: &ID3D11Texture2D, slot: usize) -> Result<ID3D11Texture2D, String> {
        match self {
            Scaler::Sdr(scaler) => scaler.scale(source, slot),
            Scaler::Hdr(converter) => converter.convert(source, slot),
        }
    }

    /// Same, into a caller-provided target (a cross-adapter ring slot). The
    /// HDR converter has no cross-adapter path — the bridge's shared textures
    /// are 8-bit BGRA — and `create_capture` keeps HDR sessions off it, so
    /// this arm only exists to keep the two scalers interchangeable.
    fn scale_into(
        &mut self,
        source: &ID3D11Texture2D,
        target: &ID3D11Texture2D,
    ) -> Result<(), String> {
        match self {
            Scaler::Sdr(scaler) => scaler.scale_into(source, target),
            Scaler::Hdr(_) => Err("HDR sessions have no cross-adapter scaling path".to_string()),
        }
    }
}

impl TextureScaler {
    fn new(
        device: &ID3D11Device,
        src_w: u32,
        src_h: u32,
        dst_w: u32,
        dst_h: u32,
        fps: u32,
    ) -> Result<Self, String> {
        unsafe {
            let context = device
                .GetImmediateContext()
                .map_err(|error| format!("GetImmediateContext: {error}"))?;
            let video_device: ID3D11VideoDevice = device
                .cast()
                .map_err(|error| format!("ID3D11VideoDevice: {error}"))?;
            let video_context: ID3D11VideoContext = context
                .cast()
                .map_err(|error| format!("ID3D11VideoContext: {error}"))?;

            let rate = DXGI_RATIONAL {
                Numerator: fps.max(1),
                Denominator: 1,
            };
            let mut content = D3D11_VIDEO_PROCESSOR_CONTENT_DESC::default();
            content.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
            content.InputFrameRate = rate;
            content.OutputFrameRate = rate;
            content.InputWidth = src_w;
            content.InputHeight = src_h;
            content.OutputWidth = dst_w;
            content.OutputHeight = dst_h;
            content.Usage = D3D11_VIDEO_USAGE_OPTIMAL_QUALITY;
            let enumerator = video_device
                .CreateVideoProcessorEnumerator(&content)
                .map_err(|error| format!("CreateVideoProcessorEnumerator: {error}"))?;
            let processor = video_device
                .CreateVideoProcessor(&enumerator, 0)
                .map_err(|error| format!("CreateVideoProcessor: {error}"))?;

            let mut tex_desc = D3D11_TEXTURE2D_DESC::default();
            tex_desc.Width = dst_w;
            tex_desc.Height = dst_h;
            tex_desc.MipLevels = 1;
            tex_desc.ArraySize = 1;
            tex_desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
            tex_desc.SampleDesc = DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            };
            tex_desc.BindFlags = D3D11_BIND_RENDER_TARGET.0 as u32;
            let mut target = None;
            device
                .CreateTexture2D(&tex_desc, None, Some(&mut target))
                .map_err(|error| format!("CreateTexture2D: {error}"))?;
            let target = target.ok_or("CreateTexture2D returned no texture")?;
            // Two owned targets: the encoder reads a texture
            // asynchronously, so frame N+1 must scale into a different
            // texture than frame N's still-in-flight encode.
            let mut target2 = None;
            device
                .CreateTexture2D(&tex_desc, None, Some(&mut target2))
                .map_err(|error| format!("CreateTexture2D: {error}"))?;
            let target2 = target2.ok_or("CreateTexture2D returned no texture")?;

            // staging texture: duplication frames are copied here because
            // desktop-duplication textures are rejected as video-processor
            // input views (verified E_INVALIDARG on RTX 5070)
            tex_desc.Width = src_w;
            tex_desc.Height = src_h;
            let mut staging = None;
            device
                .CreateTexture2D(&tex_desc, None, Some(&mut staging))
                .map_err(|error| format!("CreateTexture2D (staging): {error}"))?;
            let staging = staging.ok_or("CreateTexture2D returned no staging texture")?;

            let mut targets = std::collections::HashMap::new();
            targets.insert(
                target.as_raw() as usize,
                Self::create_target(device, &video_device, &enumerator, &target)?,
            );
            targets.insert(
                target2.as_raw() as usize,
                Self::create_target(device, &video_device, &enumerator, &target2)?,
            );

            let (dx, dy, w, h) = fit_rect(src_w, src_h, dst_w, dst_h);
            Ok(TextureScaler {
                device: device.clone(),
                video_context,
                video_device,
                processor,
                enumerator,
                context,
                owned_targets: vec![target, target2],
                targets,
                staging,
                input_views: std::collections::HashMap::new(),
                output_frame: 0,
                dest_rect: RECT {
                    left: dx as i32,
                    top: dy as i32,
                    right: (dx + w) as i32,
                    bottom: (dy + h) as i32,
                },
                target_rect: RECT {
                    left: 0,
                    top: 0,
                    right: dst_w as i32,
                    bottom: dst_h as i32,
                },
            })
        }
    }

    /// RTV + video-processor output view for one render-target texture.
    /// Explicit descriptors are mandatory: passing NULL pDesc fails with
    /// E_INVALIDARG on current drivers (verified on RTX 5070).
    unsafe fn create_target(
        device: &ID3D11Device,
        video_device: &ID3D11VideoDevice,
        enumerator: &ID3D11VideoProcessorEnumerator,
        target: &ID3D11Texture2D,
    ) -> Result<ScalerTarget, String> {
        let mut rtv = None;
        device
            .CreateRenderTargetView(target, None, Some(&mut rtv))
            .map_err(|error| format!("CreateRenderTargetView: {error}"))?;
        let rtv = rtv.ok_or("CreateRenderTargetView returned no view")?;
        let mut output_view = None;
        let mut output_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC::default();
        output_desc.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
        video_device
            .CreateVideoProcessorOutputView(
                target,
                enumerator,
                &output_desc,
                Some(&mut output_view),
            )
            .map_err(|error| format!("CreateVideoProcessorOutputView: {error}"))?;
        let output_view = output_view.ok_or("no video processor output view")?;
        Ok(ScalerTarget { rtv, output_view })
    }

    /// The size this scaler renders at: the destination rectangle it was
    /// built with (`create_capture` resolves a zero client mode to the
    /// desktop size, so this is the geometry the encoder session really
    /// encodes — and what the video loop resolves the session's size from
    /// before the first frame).
    fn target_size(&self) -> (u32, u32) {
        (
            self.target_rect.right as u32,
            self.target_rect.bottom as u32,
        )
    }

    /// Copies `source` into the staging texture (duplication surfaces are
    /// not valid video-processor inputs), scales it into the owned target
    /// for the given pipeline slot and returns it. The encoder registers
    /// both targets once; the caller must not reuse a slot's target until
    /// that slot's previous encode has been reaped.
    fn scale(
        &mut self,
        source: &ID3D11Texture2D,
        slot: usize,
    ) -> Result<ID3D11Texture2D, String> {
        let target = self
            .owned_targets
            .get(slot)
            .expect("owned target for slot")
            .clone();
        self.scale_into(source, &target)?;
        Ok(target)
    }

    /// Same scaling path into a caller-provided render target (a
    /// cross-adapter shared-texture ring slot).
    fn scale_into(
        &mut self,
        source: &ID3D11Texture2D,
        target: &ID3D11Texture2D,
    ) -> Result<(), String> {
        unsafe {
            self.context.CopyResource(&self.staging, source);
            let target_key = target.as_raw() as usize;
            let (rtv, output_view) = match self.targets.get(&target_key) {
                Some(target) => (target.rtv.clone(), target.output_view.clone()),
                None => {
                    let created = Self::create_target(
                        &self.device,
                        &self.video_device,
                        &self.enumerator,
                        target,
                    )?;
                    self.targets.insert(target_key, created);
                    let created = &self.targets[&target_key];
                    (created.rtv.clone(), created.output_view.clone())
                }
            };
            self.context
                .ClearRenderTargetView(&rtv, &[0.0, 0.0, 0.0, 1.0]);
            let staging_key = self.staging.as_raw() as usize;
            let view = match self.input_views.get(&staging_key) {
                Some(view) => view.clone(),
                None => {
                    let mut view = None;
                    let mut input_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC::default();
                    input_desc.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
                    input_desc.FourCC = 0;
                    self.video_device
                        .CreateVideoProcessorInputView(
                            &self.staging,
                            &self.enumerator,
                            &input_desc,
                            Some(&mut view),
                        )
                        .map_err(|error| format!("CreateVideoProcessorInputView: {error}"))?;
                    let view = view.ok_or("no video processor input view")?;
                    self.input_views.insert(staging_key, view.clone());
                    view
                }
            };
            let enable = windows::Win32::Foundation::BOOL::from(true);
            self.video_context.VideoProcessorSetOutputTargetRect(
                &self.processor,
                enable,
                Some(&self.target_rect),
            );
            self.video_context.VideoProcessorSetStreamDestRect(
                &self.processor,
                0,
                enable,
                Some(&self.dest_rect),
            );
            let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
                Enable: true.into(),
                ..Default::default()
            };
            stream.pInputSurface = std::mem::ManuallyDrop::new(Some(view));
            self.video_context
                .VideoProcessorBlt(
                    &self.processor,
                    &output_view,
                    self.output_frame,
                    &[stream],
                )
                .map_err(|error| format!("VideoProcessorBlt: {error}"))?;
            self.output_frame += 1;
            // Asynchronous NVENC never implicitly flushes the D3D11 queue
            // (synchronous LockBitstream did): without this kick the Blt
            // can sit unflushed and the encode never runs — the
            // completion event then never fires.
            self.context.Flush();
            Ok(())
        }
    }
}

/// Finds the first H.264 SPS NAL in an annex-B stream and returns
/// (profile_idc, constraint flags, level_idc).
///
/// H.264 only, by construction: it matches NAL type 7 through the 1-byte
/// header mask. An HEVC access unit cannot match (an HEVC header's low five
/// bits are even, so 0x67 never occurs), so the first-frame log simply
/// omits the profile for an HEVC session rather than misreporting one —
/// parsing HEVC's profile_tier_level is what the HDR slice will need.
fn sps_info(data: &[u8]) -> Option<(u8, u8, u8)> {
    let mut index = 0;
    while index + 5 < data.len() {
        let start_len = if data[index] == 0
            && data[index + 1] == 0
            && data[index + 2] == 0
            && data[index + 3] == 1
        {
            4
        } else if data[index] == 0 && data[index + 1] == 0 && data[index + 2] == 1 {
            3
        } else {
            index += 1;
            continue;
        };
        let header_at = index + start_len;
        if header_at < data.len() && data[header_at] & 0x1F == 7 && header_at + 4 <= data.len() {
            return Some((
                data[header_at + 1],
                data[header_at + 2],
                data[header_at + 3],
            ));
        }
        index += start_len;
    }
    None
}

/// Production pipeline: DXGI desktop duplication + NVENC (H.264 or HEVC,
/// whichever the session negotiated).
///
/// When the desktop is idle, duplication waits time out without a new
/// frame; the previous texture is then re-encoded (paced to the frame
/// rate) so the client keeps receiving frames, mirroring Sunshine's
/// duplicate-frame behavior.
///
/// Display mode changes (games going fullscreen, resolution switches, TDR)
/// kill the DXGI duplication object — AcquireNextFrame then fails with
/// DXGI_ERROR_ACCESS_LOST or DXGI_ERROR_INVALID_CALL. When the new mode
/// preserves the resolution (a refresh-rate flip, an HDR toggle — the
/// common mid-stream case), only the duplication is re-created on the same
/// device: the encoder session, scaler targets, and cross-adapter bridge
/// survive, because the encoder's registered inputs are the scaler's
/// persistent owned textures, not the duplication surface. That keeps the
/// recreation gap in the millisecond range instead of starving the client
/// through a full encoder destroy/re-init. A resolution change — or an
/// encoder error — rebuilds everything, forcing an IDR so the client can
/// decode again. Recreation retries with a 500ms backoff and only gives up
/// after ~30s of consecutive failures.
///
/// Frame-age drop policy: a captured frame whose *projected* age is past
/// the freshness budget never enters the encoder. The projection is the
/// frame's age plus the encoder's own measured latency for its queue and
/// for the frame itself (`video::projected_encode_age`), i.e. the age the
/// frame would have when its bitstream is handed over; the budget is the
/// sender loop's own (installed through `VideoPipeline::set_frame_age_budget`,
/// so both sides judge against one number; the constructor's
/// `HYDRA_STREAM_MAX_FRAME_AGE_MS` value is only the fallback). The
/// pipeline first skips ahead to the newest desktop texture and then, when
/// even that frame is projected past the budget, skips the submission
/// outright: a frame the client will never be sent must never become a
/// reference for the frame behind it. Forced IDRs are exempt — they are
/// the client's loss-recovery mechanism and are always decodable.
pub struct NvencPipeline {
    /// Holds the display on for this pipeline's lifetime. Without it a session
    /// that starts with the panel off gets no frames at all (see
    /// [`DisplayKeeper`]); it is started before the capture exists and lives
    /// across the display-mode recreations. Held for its `Drop`, never read.
    _display: DisplayKeeper,
    capture: Option<DxgiCapture>,
    /// The desktop duplication died (display mode change, TDR) and the
    /// recreation tick has not resumed yet: encode_next stays out of the
    /// dead duplication's acquire even though the capture object is still
    /// held (it carries the device and the previous mode for the
    /// same-resolution fast-path comparison).
    recreate_pending: bool,
    encoder: Option<Box<dyn TextureEncoder>>,
    scaler: Option<Scaler>,
    /// Cross-adapter shared-texture ring; the encoder reads the ring's
    /// consumer-side textures on a second GPU. None = the encoder reads
    /// capture-device textures directly.
    bridge: Option<CrossAdapterBridge>,
    /// Ring slot currently held by the encoder (released when its
    /// bitstream is delivered).
    bridge_slot: Option<usize>,
    /// Last submitted ring slot, for idle-desktop duplicate re-encodes.
    bridge_last: Option<usize>,
    /// The cross-adapter path already failed mid-session: auto skips it
    /// on the next recreation and stays on the display adapter.
    cross_broken: bool,
    backend: EncoderBackend,
    config: EncoderConfigParams,
    /// Encode geometry of the live session: `encode_size` is the size the
    /// scaler/encoder were created at (the desktop size when the client
    /// negotiated 0x0), `source_size` the captured desktop they scale from.
    /// Both are what the video loop reads through
    /// `VideoPipeline::encode_size`/`source_size` to resolve the session's
    /// size and the bits-per-pixel floor, and a failed `set_encode_size`
    /// reverts to them.
    ///
    /// `set_encode_size` is called once per session, before the first frame
    /// is emitted (the video loop's resolution); it also writes the resolved
    /// size back into `config`, which is what every later recreation — a
    /// display-mode change, an encoder error — re-creates from. That is what
    /// makes the size stable for the rest of the session: no recreation path
    /// can re-derive a different one.
    encode_size: (u32, u32),
    source_size: (u32, u32),
    /// A resize whose recreation has not landed yet: the encode size to
    /// revert to when the new size cannot be created (a degraded size must
    /// never end the session), and the size that turned out uncreatable, so
    /// a repeated request fails immediately instead of tearing the pipeline
    /// down again. `resize_reverted` marks the retry at the old size, so the
    /// recreation log names a rejected resize instead of claiming a
    /// display-mode change.
    resize_from: Option<(u32, u32)>,
    resize_rejected: Option<(u32, u32)>,
    resize_reverted: bool,
    last_texture: Option<ID3D11Texture2D>,
    /// Negotiated-fps schedule: which frames may enter the scaler and the
    /// encoder at all (see [`FramePacer`]). Replaces the old
    /// "acquire-wait since the last emit" anchor, which could not limit
    /// anything because the duplicator returns a queued frame at once.
    pacing: FramePacer,
    /// Whether the last `encode_next` call computed its acquire wait as
    /// zero, i.e. the pacing budget was already spent (frames have been
    /// emitted and the frame interval elapsed with nothing out of the
    /// encoder), or is waiting for a slot it may not take yet: the sender
    /// loop reads it through `VideoPipeline::pacing_budget_spent` for the
    /// empty-iteration backoff — that backoff is what carries the wait to
    /// the slot, since the duplicator must not be touched before it. False
    /// on every path that returned before the schedule was consulted, and
    /// on a re-anchored emit.
    pacing_spent: bool,

    /// Freshness budget the pre-encode gate below judges against: the
    /// sender loop installs its own through `set_frame_age_budget` before
    /// the first frame, and that value is the authoritative one (it is the
    /// number the loop's `video: freshness budget` line quotes and the
    /// bound its post-encode relief valve measures). The constructor's
    /// value — `HYDRA_STREAM_MAX_FRAME_AGE_MS`, else 1.25x the frame
    /// interval — is only the fallback for a caller that never installs
    /// one.
    max_frame_age: Duration,
    /// Measured acquire→bitstream latency of the frames the encoder has
    /// delivered, as an exponential moving average seeded at the frame
    /// interval: the encoder's own share of the delay the freshness budget
    /// has to cover, and what the pre-encode gate projects a submission
    /// forward with (`video::projected_encode_age`). It decays on every
    /// skipped submission, so a stall that ends cannot hold the gate shut:
    /// with nothing submitted there is nothing left to measure.
    encode_latency: Duration,
    started: Instant,
    schedule: RecreateSchedule,
    force_next_idr: bool,
    recreate_count: u64,
    acquire_ok: u64,
    acquire_timeout: u64,
    acquire_error: u64,
    last_acquire_error: String,
    encoded: u64,
    encoded_bytes: u64,
    idle_skips: u64,
    /// Desktop frames drained while skipping ahead to the newest texture
    /// (the first half of the pre-encode age gate).
    stale_skips: u64,
    /// Submissions the pre-encode age gate refused outright: the frame's
    /// projected age was already past the budget, so it never reached the
    /// encoder. This is the intended degradation, and the counter the
    /// sender loop reports as `stale-skipped`; the post-encode drop count
    /// is expected to stay zero beside it.
    stale_submission_skips: u64,
    cross_busy_drops: u64,
    scaler_busy_drops: u64,
    /// Presents the negotiated-fps pacer refused as surplus. It stands at
    /// zero by construction now: a slot takes the newest image the
    /// duplicator has instead of trying to take one early and refusing it,
    /// so nothing is refused (an early present is folded into the image
    /// the slot does take). Kept reported because the sender loop's supply
    /// line reads it; the desktop's true present rate is what
    /// `live_present_rate_probe` measures directly.
    pacer_surplus: u64,
    /// Frames dropped at an encoder/ring busy gate while a forced IDR was
    /// pending: the IDR request itself survives (idr_pending stays armed)
    /// but the refresh is delayed — counted and logged so a freeze run
    /// names the gate that swallowed the IDRs.
    idr_busy_delays: u64,
    /// Per-submission bookkeeping, keyed by the handle given to
    /// [`TextureEncoder::submit`] and echoed back with the bitstream.
    encoder_meta: std::collections::HashMap<usize, PendingMeta>,
    next_handle: usize,
    /// Which scaler-owned targets are inside the encoder right now (the
    /// other one is safe to render the next frame into).
    scaler_slot_busy: [bool; 2],
    /// Scaler slot holding `last_texture` (the idle-duplicate source).
    last_scaler_slot: Option<usize>,
}

/// Bookkeeping attached to each encoder submission and echoed back with
/// its bitstream.
struct PendingMeta {
    capture: Instant,
    idr: bool,
    source: PendingSource,
    /// Idle-desktop duplicates carry no real deadline: their capture time
    /// is stamped at delivery, not submission, so they never age out while
    /// queued in the encoder.
    re_stamp_at_reap: bool,
    /// Telemetry (see [`FrameStages`]): the blocking acquire that produced
    /// the frame, the scale span (frame held → submission), the submission
    /// call itself, the instant it returned (the anchor for the encode
    /// wait measured at reap), and the cross-adapter sync inside the scale.
    /// All zero for an idle duplicate, which carries no stage split.
    acquire_wait: Duration,
    scale: Duration,
    submit: Duration,
    submitted_at: Instant,
    bridge_sync: Duration,
}

enum PendingSource {
    /// scaler-owned target texture (index into the scaler's targets)
    Scaler(usize),
    /// cross-adapter ring slot, handed back at reap
    Bridge(usize),
}

/// Creates a capture + encoder (+ scaler when the negotiated client mode
/// differs from the desktop, or always for the cross-adapter path where
/// the encoder input must be a shared texture): picks the first adapter
/// where desktop duplication comes up, then resolves the encoder per
/// HYDRA_STREAM_ENCODER (auto tries amf-cross on a second adapter first
/// and falls back to the display adapter). `skip_cross` suppresses the
/// cross-adapter attempt after it already failed mid-session. Shared by
/// the initial pipeline build and display-mode recreation. A zero
/// width/height in `target` means "encode at the native desktop
/// resolution".
fn create_capture(
    target: &EncoderConfigParams,
    skip_cross: bool,
    allow_retry: bool,
) -> Result<
    (
        DxgiCapture,
        Box<dyn TextureEncoder>,
        EncoderBackend,
        Option<Scaler>,
        Option<CrossAdapterBridge>,
    ),
    String,
> {
    let selection = encoder_selection();
    let adapters = DxgiCapture::candidate_adapters()?;
    let mut errors = Vec::new();
    for adapter in adapters.iter() {
        let name = adapter_name(adapter);
        let capture = match unsafe { try_adapter(adapter) } {
            Ok(capture) => capture,
            Err(error) => {
                eprintln!("adapter {name} unusable: {error}");
                errors.push(format!("{name}: {error}"));
                continue;
            }
        };
        let mut config = *target;
        if config.width == 0 || config.height == 0 {
            config.width = capture.width;
            config.height = capture.height;
        }

        // Cross-adapter encode (auto and amf-cross): the scaler renders
        // into shared textures and the AMF session runs on a second GPU,
        // leaving the display adapter to the game. Not for HDR sessions:
        // the bridge's shared textures are 8-bit BGRA, so the P010 the HDR
        // encoder needs has nowhere to go.
        if !skip_cross && attempts_cross(selection) && !crate::nvenc::is_hdr_session(&config) {
            match try_cross_encoder(&capture, &config, &adapters) {
                Ok((encoder, bridge, offload_name)) => {
                    // the cross-adapter path always runs through the
                    // scaler: the encoder input must be the shared texture
                    let scaler = match TextureScaler::new(
                        &capture.device(),
                        capture.width,
                        capture.height,
                        config.width,
                        config.height,
                        config.fps,
                    ) {
                        Ok(scaler) => Scaler::Sdr(scaler),
                        Err(error) => {
                            eprintln!("adapter {name} unusable: scaling init failed: {error}");
                            errors.push(format!("{name}: scaler: {error}"));
                            continue;
                        }
                    };
                    eprintln!(
                        "capture adapter: {name} ({}x{} -> {}x{} @ {}fps, {}kbps, encoder=amf-cross on {offload_name} via {})",
                        capture.width,
                        capture.height,
                        config.width,
                        config.height,
                        config.fps,
                        config.bitrate_kbps,
                        bridge.sync_label()
                    );
                    return Ok((
                        capture,
                        encoder,
                        EncoderBackend::AmfCross,
                        Some(scaler),
                        Some(bridge),
                    ));
                }
                Err(error) => {
                    if cross_failure_fatal(selection) {
                        return Err(format!("HYDRA_STREAM_ENCODER=amf-cross unavailable: {error}"));
                    }
                    eprintln!(
                        "cross-adapter encode unavailable: {error}; falling back to the display-adapter encoder"
                    );
                }
            }
        }

        let encoder = match selection {
            EncoderSelection::Amf => AmfEncoder::new(capture.device_ptr(), &config).map(|encoder| {
                (
                    Box::new(encoder) as Box<dyn TextureEncoder>,
                    EncoderBackend::Amf,
                )
            }),
            EncoderSelection::Nvenc => {
                NvencEncoder::new(capture.device_ptr(), &config).map(|encoder| {
                    (
                        Box::new(encoder) as Box<dyn TextureEncoder>,
                        EncoderBackend::Nvenc,
                    )
                })
            }
            _ => create_encoder(capture.device_ptr(), &config),
        };
        let (encoder, backend) = match encoder {
            Ok(encoder) => encoder,
            Err(error) => {
                eprintln!("adapter {name} unusable: {error}");
                errors.push(format!("{name}: {error}"));
                continue;
            }
        };
        // Always run frames through the scaler, even when the negotiated
        // mode matches the desktop resolution: the scaler renders into
        // owned targets, which decouples the asynchronous encode from the
        // desktop-duplication texture pool — a released duplication surface
        // is rewritten by DXGI on the next present, so submitting it to the
        // pipelined encoder and dropping the frame lets the desktop
        // overwrite a texture NVENC is still reading (torn frames). The
        // owned-target copy also gives idle-desktop duplicates a stable
        // re-encode source.
        //
        // An HDR10 session takes the shader converter instead: it consumes
        // the FP16 scRGB duplication surface and emits the P010 the encoder
        // session was configured for. The two are chosen together with the
        // encoder's buffer format (`nvenc::is_hdr_session`), so a scaler can
        // never disagree with the format its encoder registered.
        let scaler = if crate::nvenc::is_hdr_session(&config) {
            eprintln!(
                "capture adapter: {name} HDR10 conversion: scRGB FP16 {}x{} -> BT.2020/PQ P010 \
                 {}x{}",
                capture.width, capture.height, config.width, config.height
            );
            crate::hdr::HdrConverter::new(
                &capture.device(),
                capture.width,
                capture.height,
                config.width,
                config.height,
            )
            .map(Scaler::Hdr)
        } else {
            TextureScaler::new(
                &capture.device(),
                capture.width,
                capture.height,
                config.width,
                config.height,
                config.fps,
            )
            .map(Scaler::Sdr)
        };
        let scaler = match scaler {
            Ok(scaler) => Some(scaler),
            Err(error) => {
                eprintln!("adapter {name} unusable: scaling init failed: {error}");
                errors.push(format!("{name}: scaler: {error}"));
                continue;
            }
        };
        eprintln!(
            "capture adapter: {name} ({}x{} -> {}x{} @ {}fps, {}kbps, encoder={})",
            capture.width,
            capture.height,
            config.width,
            config.height,
            config.fps,
            config.bitrate_kbps,
            backend.label()
        );
        return Ok((capture, encoder, backend, scaler, None));
    }
    // A stream that starts while the panel is off can find nothing to
    // duplicate on the first pass: `DisplayKeeper` has just asked Windows for
    // the display, and the output needs a moment before it is really back.
    // Sunshine waits and retries the same way (`display_base.cpp:550-554`);
    // the single retry keeps a genuinely absent output failing promptly.
    if allow_retry {
        eprintln!(
            "capture: no usable capture adapter ({}); waiting for the display and retrying once",
            errors.join("; ")
        );
        std::thread::sleep(Duration::from_millis(1500));
        return create_capture(target, skip_cross, false);
    }
    Err(format!("no usable capture adapter ({})", errors.join("; ")))
}

/// Tries to stand up the cross-adapter path: for every adapter other than
/// the capture (display) adapter, build the shared-texture bridge from the
/// capture device and probe an AMF encoder on the offload device. Returns
/// the encoder (already constructed on the offload device), the bridge,
/// and the offload adapter name.
fn try_cross_encoder(
    capture: &DxgiCapture,
    config: &EncoderConfigParams,
    adapters: &[IDXGIAdapter],
) -> Result<(Box<dyn TextureEncoder>, CrossAdapterBridge, String), String> {
    let capture_luid = capture.adapter_luid();
    let mut errors = Vec::new();
    for adapter in adapters {
        let desc = unsafe {
            adapter
                .GetDesc()
                .map_err(|error| format!("GetDesc: {error}"))?
        };
        let luid = (desc.AdapterLuid.LowPart, desc.AdapterLuid.HighPart);
        if luid == capture_luid {
            continue;
        }
        let name = String::from_utf16_lossy(&desc.Description)
            .trim_end_matches('\0')
            .to_string();
        let bridge = match CrossAdapterBridge::new(
            &capture.device(),
            adapter,
            config.width,
            config.height,
        ) {
            Ok(bridge) => bridge,
            Err(error) => {
                errors.push(format!("{name}: shared textures: {error}"));
                continue;
            }
        };
        match AmfEncoder::new(bridge.consumer_device_ptr(), config) {
            Ok(encoder) => return Ok((Box::new(encoder), bridge, name)),
            Err(error) => errors.push(format!("{name}: amf: {error}")),
        }
    }
    if errors.is_empty() {
        Err("no second adapter besides the display adapter".to_string())
    } else {
        Err(errors.join("; "))
    }
}

impl NvencPipeline {
    pub fn new(config: EncoderConfigParams) -> Result<Self, String> {
        // Ask Windows for the display *before* the duplication exists: with the
        // panel off the duplication either cannot be created or delivers
        // nothing at all, and the sender loop's own wake (video.rs) only runs
        // once the pipeline is already up.
        let display = DisplayKeeper::start();
        let (capture, encoder, backend, scaler, bridge) =
            create_capture(&config, false, true)?;
        let frame_interval = Duration::from_secs_f64(1.0 / config.fps.max(1) as f64);
        // the geometry the session really runs at: a zero width/height in
        // the config means "encode at the desktop size", which only the
        // scaler knows (it is built from the resolved size)
        let source_size = (capture.width, capture.height);
        let encode_size = scaler
            .as_ref()
            .map(Scaler::target_size)
            .unwrap_or(source_size);
        // fallback freshness budget for the frame-age drop policy: the
        // sender loop installs its own (3x the frame interval, clamped to
        // [1.25x, 100ms]) before the first frame, so this value only covers
        // a caller that never installs one.
        // HYDRA_STREAM_MAX_FRAME_AGE_MS overrides both.
        let max_frame_age = crate::config::max_frame_age_ms()
            .map(Duration::from_millis)
            .unwrap_or(frame_interval * 5 / 4);
        Ok(NvencPipeline {
            _display: display,
            capture: Some(capture),
            recreate_pending: false,
            encoder: Some(encoder),
            scaler,
            bridge,
            bridge_slot: None,
            bridge_last: None,
            cross_broken: false,
            backend,
            config,
            encode_size,
            source_size,
            resize_from: None,
            resize_rejected: None,
            resize_reverted: false,
            last_texture: None,
            pacing: FramePacer::new(frame_interval, Instant::now()),
            pacing_spent: false,
            max_frame_age,
            // seeded at the frame interval: a session's first frames have no
            // measurement yet, and one frame interval is the floor of what
            // an encoder can be expected to take
            encode_latency: frame_interval,
            started: Instant::now(),
            schedule: RecreateSchedule::new(),
            force_next_idr: false,
            recreate_count: 0,
            acquire_ok: 0,
            acquire_timeout: 0,
            acquire_error: 0,
            last_acquire_error: String::new(),
            encoded: 0,
            encoded_bytes: 0,
            idle_skips: 0,
            stale_skips: 0,
            stale_submission_skips: 0,
            cross_busy_drops: 0,
            scaler_busy_drops: 0,
            pacer_surplus: 0,
            idr_busy_delays: 0,
            encoder_meta: std::collections::HashMap::new(),
            next_handle: 0,
            scaler_slot_busy: [false; 2],
            last_scaler_slot: None,
        })
    }

    /// Drops everything bound to the display device's textures: encoder,
    /// scaler, cross-adapter bridge, and their per-submission bookkeeping.
    /// The capture object and the recreation schedule are the caller's
    /// concern — the fast path keeps them, the full recreation replaces
    /// them.
    fn drop_encoder_state(&mut self) {
        self.encoder = None;
        self.scaler = None;
        self.bridge = None;
        self.bridge_slot = None;
        self.bridge_last = None;
        self.last_texture = None;
        self.encoder_meta.clear();
        self.scaler_slot_busy = [false; 2];
        self.last_scaler_slot = None;
    }

    /// The encoder itself reported an error: the session cannot be kept,
    /// so the whole pipeline comes down for the full recreation (unlike a
    /// capture-only loss, where `begin_capture_recreate` preserves the
    /// encoder state for the fast path). The old objects must be released
    /// before re-enumerating: an output only allows a single active
    /// duplicator, and the encoder session is bound to the old device's
    /// textures.
    fn begin_recreate(&mut self) {
        self.capture = None;
        self.recreate_pending = false;
        self.drop_encoder_state();
        self.schedule = RecreateSchedule::new();
    }

    /// The desktop duplication died (display mode change, TDR, another
    /// duplicator grabbing the output) while the encoder state may still
    /// be valid: unlike `begin_recreate`, the encoder/scaler/bridge are
    /// kept and the recreation tick first tries re-duplicating on the same
    /// device (the resolution-preserving fast path). The dead capture
    /// object stays in place — it carries the device and the previous
    /// mode for the comparison — while `recreate_pending` keeps
    /// encode_next out of its acquire. The schedule starts fresh: the
    /// first recreation attempt is immediate, failures back off.
    fn begin_capture_recreate(&mut self) {
        self.recreate_pending = true;
        self.schedule = RecreateSchedule::new();
    }

    /// Re-enumerates adapters/outputs and brings capture + encoder back up
    /// on the new display mode. Returns `Ok(None)` while the pipeline is
    /// mid-recreation or waiting for the backoff, `Err` only after the
    /// give-up cap, so transient display changes never end the session.
    fn recreation_tick(&mut self) -> Result<Option<EncodedFrame>, String> {
        let now = Instant::now();
        if !self.schedule.due(now) {
            // sleep until the next backoff deadline instead of spinning
            // the sender thread at 100% CPU for the whole backoff window
            if let Some(next) = self.schedule.next {
                if next > now {
                    std::thread::sleep(next - now);
                }
            }
            return Ok(None);
        }

        // Fast path: the duplication alone died. The old capture is taken
        // first — dropping its dead duplication (an output only allows a
        // single active duplicator) — and re-created on the SAME device.
        // When the mode change preserved the resolution, the encoder
        // session, scaler, and cross-adapter bridge are still valid (the
        // encoder's registered inputs are the scaler's persistent owned
        // targets, not the duplication surface), so the pipeline resumes
        // without the full teardown/re-init.
        let mut resolution_change: Option<((u32, u32), (u32, u32))> = None;
        if let Some(old) = self.capture.take() {
            let started = Instant::now();
            match unsafe { recreate_duplication(&old.device()) } {
                Ok(fresh) => {
                    if can_fast_recreate(
                        old.width,
                        old.height,
                        fresh.width,
                        fresh.height,
                        self.encoder.is_some(),
                    ) {
                        self.recreate_count += 1;
                        self.capture = Some(fresh);
                        self.recreate_pending = false;
                        self.force_next_idr = true;
                        self.schedule.reset();
                        eprintln!(
                            "video: display mode changed (same resolution, fast recreation) ({}ms)",
                            started.elapsed().as_millis()
                        );
                        return Ok(None);
                    }
                    resolution_change = Some(((old.width, old.height), (fresh.width, fresh.height)));
                    drop(fresh);
                }
                Err(error) => {
                    eprintln!("video: duplication-only recreation failed ({error}); full recreation");
                }
            }
            // the fast path could not resume: everything bound to the
            // display device's textures goes down with the full recreation
            self.drop_encoder_state();
        }

        let started = Instant::now();
        match create_capture(&self.config, self.cross_broken, true) {
            Ok((capture, encoder, backend, scaler, bridge)) => {
                self.recreate_count += 1;
                let source_size = (capture.width, capture.height);
                let encode_size = scaler
                    .as_ref()
                    .map(Scaler::target_size)
                    .unwrap_or(self.encode_size);
                let reverted = std::mem::take(&mut self.resize_reverted);
                match self.resize_from.take() {
                    // the startup resolution's resize landed: the scaler's
                    // targets and the encoder session are new (new SPS/PPS),
                    // and the forced IDR below is what the client's decoder
                    // re-inits on. This is the only path that ever logs it —
                    // nothing resizes the session again (see the field doc)
                    Some((previous_w, previous_h)) => eprintln!(
                        "video: encode size changed, re-creating scaler and encoder ({}x{} -> {}x{}) ({}ms)",
                        previous_w,
                        previous_h,
                        encode_size.0,
                        encode_size.1,
                        started.elapsed().as_millis()
                    ),
                    None if reverted => eprintln!(
                        "video: encode size revert landed, re-creating scaler and encoder ({}x{}) ({}ms)",
                        encode_size.0,
                        encode_size.1,
                        started.elapsed().as_millis()
                    ),
                    None => match resolution_change {
                        Some((from, to)) => eprintln!(
                            "video: display mode changed (resolution changed, full recreation) ({}x{} -> {}x{}) ({}ms)",
                            from.0,
                            from.1,
                            to.0,
                            to.1,
                            started.elapsed().as_millis()
                        ),
                        None => eprintln!(
                            "video: display mode changed, re-creating duplication ({}x{}) ({}ms)",
                            capture.width,
                            capture.height,
                            started.elapsed().as_millis()
                        ),
                    },
                }
                self.capture = Some(capture);
                self.encoder = Some(encoder);
                self.scaler = scaler;
                self.bridge = bridge;
                self.backend = backend;
                self.encode_size = encode_size;
                self.source_size = source_size;
                self.recreate_pending = false;
                self.force_next_idr = true;
                self.schedule.reset();
                Ok(None)
            }
            Err(error) => {
                // a resize that cannot be created is not a display problem:
                // go straight back to the size the session was already
                // running at, remembering the new size so a repeated request
                // fails without tearing the pipeline down again. The give-up
                // cap below is for display modes that never come back; a
                // size the operator's link asked for must never cost the
                // session.
                if let Some(previous) = self.resize_from.take() {
                    let rejected = (self.config.width, self.config.height);
                    self.resize_rejected = Some(rejected);
                    self.config.width = previous.0;
                    self.config.height = previous.1;
                    self.resize_reverted = true;
                    self.schedule.reset(); // the revert is an immediate attempt
                    eprintln!(
                        "video: encode size {}x{} unusable ({error}), reverting to {}x{}",
                        rejected.0, rejected.1, previous.0, previous.1
                    );
                    return Ok(None);
                }
                self.schedule.note_failure(now);
                eprintln!(
                    "video: display recreation attempt {}/{} failed: {error}",
                    self.schedule.failures, MAX_RECREATE_FAILURES
                );
                if self.schedule.given_up() {
                    return Err(format!(
                        "display recreation gave up after {} attempts: {error}",
                        self.schedule.failures
                    ));
                }
                Ok(None)
            }
        }
    }

    /// The encoder backend the current session resolved to (for
    /// diagnostics and the live smoke).
    pub fn backend_label(&self) -> &'static str {
        self.backend.label()
    }

    /// Marks the cross-adapter path broken (so auto falls back to the
    /// display adapter on the next recreation instead of looping on the
    /// same failure) and tears the pipeline down for recreation.
    fn note_encoder_failure(&mut self) {
        if self.backend == EncoderBackend::AmfCross
            && encoder_selection() == EncoderSelection::Auto
        {
            self.cross_broken = true;
        }
        self.begin_recreate();
    }

    /// Reaps completed bitstreams (nonblocking) and returns the newest as
    /// the pipeline's next frame — under a saturated GPU several frames
    /// complete between polls, and shipping the freshest beats shipping
    /// history. Frees every reaped ring slot; cross-adapter slots are
    /// handed back to the producer ring here, where the bitstream that
    /// consumed them has actually been delivered.
    fn reap(&mut self) -> Result<Option<EncodedFrame>, String> {
        // a caller-side submit failure may have torn the pipeline down
        // (note_encoder_failure -> begin_recreate) right before reaping
        let Some(encoder) = self.encoder.as_mut() else {
            return Ok(None);
        };
        let poll_started = Instant::now();
        let drained = match encoder.poll() {
            Ok(drained) => drained,
            Err(error) => {
                eprintln!("video: encode error ({error}), re-creating capture and encoder");
                self.note_encoder_failure();
                return Ok(None);
            }
        };
        // Telemetry: the poll call is where the completed frames are locked
        // and copied out (`LockBitstream` + copy + `UnmapInputResource`).
        // Split evenly across what it drained — the drain is one batch and
        // the queue walks it in submission order — so each frame carries its
        // share of the bitstream copy-out.
        let copy_share = if drained.is_empty() {
            Duration::ZERO
        } else {
            poll_started.elapsed() / drained.len() as u32
        };
        let mut newest: Option<EncodedFrame> = None;
        for (data, encoder_idr, handle, after_invalidation) in drained {
            let meta = self
                .encoder_meta
                .remove(&handle)
                .expect("handle belongs to a registered submission");
            match meta.source {
                PendingSource::Scaler(slot) => self.scaler_slot_busy[slot] = false,
                PendingSource::Bridge(slot) => {
                    if let Some(bridge) = self.bridge.as_mut() {
                        if let Err(error) = bridge.finish_consume(slot) {
                            eprintln!(
                                "video: cross-adapter release failed ({error}), re-creating capture and encoder"
                            );
                            self.begin_recreate();
                            return Ok(None);
                        }
                    }
                }
            }
            self.encoded += 1;
            self.encoded_bytes += data.len() as u64;
            if !meta.re_stamp_at_reap {
                // measured acquire→bitstream latency of a real captured
                // frame — idle-desktop duplicates are excluded, since their
                // capture time is stamped when the bitstream is reaped (they
                // carry no deadline), which would report a latency that is
                // not the encoder's
                let measured = Instant::now().saturating_duration_since(meta.capture);
                self.encode_latency = (self.encode_latency * 3 + measured) / 4;
            }
            let frame_idr = encoder_idr || meta.idr;
            if self.encoded == 1 {
                // log the SPS profile/level so an exotic negotiated mode can
                // be ruled out when a client rejects the stream
                let sps = sps_info(&data)
                    .map(|(profile, constraints, level)| {
                        format!(
                            ", sps profile={profile} constraints={constraints:#04x} level={:.1}",
                            level as f32 / 10.0
                        )
                    })
                    .unwrap_or_default();
                eprintln!(
                    "video: first frame encoded ({} bytes, idr={}{sps})",
                    data.len(),
                    frame_idr
                );
            }
            if let Some(superseded) = newest.take() {
                if superseded.idr {
                    // an older drained IDR loses to a newer reaped frame:
                    // the sender ships newest-only, so this IDR never
                    // reaches packetize — log it as the drop it is
                    eprintln!(
                        "video: IDR-flagged frame dropped (reason: superseded by a newer reaped frame, {} bytes)",
                        superseded.data.len()
                    );
                }
            }
            newest = Some(EncodedFrame {
                data,
                idr: frame_idr,
                capture: if meta.re_stamp_at_reap {
                    Instant::now()
                } else {
                    meta.capture
                },
                after_ref_invalidation: after_invalidation,
                // An idle duplicate's capture is stamped HERE, so it has no
                // span to split: it carries zeroes and the sender loop
                // counts it as `dup` instead of sampling it.
                stages: if meta.re_stamp_at_reap {
                    FrameStages::default()
                } else {
                    FrameStages {
                        acquire_wait: meta.acquire_wait,
                        scale: meta.scale,
                        submit: meta.submit,
                        // submission → bitstream observed. This is the
                        // poll-quantized end of it, at reap; the first
                        // poll after the submission already happened
                        // inside the same `encode_next` call.
                        encode: Instant::now().saturating_duration_since(meta.submitted_at),
                        // filled in by the sender loop, which is the only
                        // place that sees `encode_next` return
                        reap: Duration::ZERO,
                        bridge_sync: meta.bridge_sync,
                        copy: copy_share,
                    }
                },
                duplicate: meta.re_stamp_at_reap,
            });
        }
        Ok(newest)
    }

    /// Submits a texture to the encoder and records its bookkeeping.
    /// Returns false when every pipeline slot is still in flight (the
    /// caller drops the frame rather than stall capture).
    ///
    /// `acquire_wait` and `bridge_sync` are telemetry the caller measured
    /// (the blocking acquire that produced the frame, and the
    /// cross-adapter ring sync it paid); the remaining stage spans are
    /// taken here, where the submission is actually made.
    fn submit_texture(
        &mut self,
        texture: &ID3D11Texture2D,
        capture: Instant,
        idr: bool,
        source: PendingSource,
        re_stamp_at_reap: bool,
        force_idr: bool,
        acquire_wait: Duration,
        bridge_sync: Duration,
    ) -> Result<bool, String> {
        let force = force_idr || self.force_next_idr;
        self.force_next_idr = false;
        let handle = self.next_handle;
        self.next_handle += 1;
        // everything between holding the frame and handing it over: the
        // scale, the ring's producer side, and this call's own overhead
        let scale = Instant::now().saturating_duration_since(capture);
        let encoder = self.encoder.as_mut().expect("encoder set");
        let submit_started = Instant::now();
        let outcome = encoder.submit(texture.as_raw(), force, handle);
        let submit = submit_started.elapsed();
        let submitted_at = Instant::now();
        match outcome {
            Ok(SubmitState::Submitted) => {
                self.encoder_meta.insert(
                    handle,
                    PendingMeta {
                        capture,
                        idr,
                        source,
                        re_stamp_at_reap,
                        acquire_wait,
                        scale,
                        submit,
                        submitted_at,
                        bridge_sync,
                    },
                );
                Ok(true)
            }
            Ok(SubmitState::Busy) => {
                if force {
                    self.note_idr_busy_delay("encoder-full");
                }
                Ok(false)
            }
            Err(error) => {
                eprintln!("video: encode error ({error}), re-creating capture and encoder");
                self.note_encoder_failure();
                Ok(false)
            }
        }
    }

    /// Throttled log for a frame dropped at a busy gate while a forced IDR
    /// was pending: the IDR request itself survives (idr_pending stays
    /// armed and is retried), but naming the gate is what makes a freeze
    /// run decisive. Bounded (first + every 50th) because under a freeze
    /// the gate drops every frame.
    fn note_idr_busy_delay(&mut self, gate: &str) {
        self.idr_busy_delays += 1;
        if self.idr_busy_delays == 1 || self.idr_busy_delays % 50 == 0 {
            eprintln!(
                "video: forced IDR delayed at {gate} gate (total {})",
                self.idr_busy_delays
            );
        }
    }

}

/// Hands a cross-adapter ring slot back to the producer when the frame
/// holding it was dropped before entering the encoder: no bitstream will
/// ever consume it, so `reap` can never release it and the ring would
/// slowly drain. Only valid right after `begin_consume` succeeded for the
/// slot and no submission referencing it was accepted.
fn bridge_finish_consume(
    bridge: &mut Option<CrossAdapterBridge>,
    slot: usize,
) -> Result<(), String> {
    match bridge.as_mut() {
        Some(bridge) => bridge.finish_consume(slot),
        None => Ok(()),
    }
}

impl VideoPipeline for NvencPipeline {
    fn codec(&self) -> crate::video::VideoCodec {
        self.config.codec
    }

    fn encode_next(&mut self, force_idr: bool) -> Result<Option<EncodedFrame>, String> {
        // pessimistic default: every early return below leaves the sender
        // loop without a backoff (nothing was polled on a spent budget)
        self.pacing_spent = false;
        if self.capture.is_none() || self.recreate_pending {
            return self.recreation_tick();
        }
        // Deliver a completed bitstream first, before touching capture:
        // submissions from previous iterations land here, and under a
        // saturated GPU this is where every sent frame originates.
        if let Some(frame) = self.reap()? {
            return Ok(Some(frame));
        }
        // Negotiated-fps gate: a slot takes whatever the duplicator has at
        // the slot instant, and nothing at all is asked of it before then.
        // An image is not carried across the interval: `AcquireNextFrame`
        // refuses to hand out the next image while one is outstanding
        // (DXGI_ERROR_INVALID_CALL, which `live_present_rate_probe` probes
        // for directly), so a present taken early could not be replaced by
        // a newer one at the slot — it would pin the image the slot sends
        // a full interval before that slot. The duplication carries a
        // single current desktop image whose updates coalesce (MSDN
        // "Desktop Duplication API"; `AcquireNextFrame` reports "a new
        // desktop image is not available" when nothing was presented, and
        // Sunshine reads `frame_info.LastPresentTime`,
        // display_base.cpp:1364-1370, to tell whether the image it got is
        // new), so the image a slot takes is the newest the desktop has, at
        // most one interval old — and a present that lands between two
        // slots is folded into the next one instead of costing a scale and
        // a 4K encode on its own.
        //
        // The wait for the slot is spent without touching the duplicator
        // (the sender loop's spent-budget backoff re-enters this call until
        // the deadline): acquiring early cannot be undone — DXGI hands out
        // only new frames, so a released one is gone for good, which is
        // what used to lose the slot the refused image was going to fill.
        let now = Instant::now();
        if !self.pacing.wait(now).is_zero() {
            self.pacing_spent = true;
            return Ok(None);
        }
        // telemetry: the instant the acquire attempt that produced the
        // emitted frame began, so its own duration can be reported
        let acquire_started = Instant::now();
        let acquired = match self
            .capture
            .as_ref()
            .expect("capture set")
            .acquire(0)
        {
            Ok(acquired) => acquired,
            Err(error) => {
                self.acquire_error += 1;
                self.last_acquire_error = error.clone();
                eprintln!("video: capture error ({error}), re-creating duplication");
                self.begin_capture_recreate();
                return Ok(None);
            }
        };
        let Some(mut frame) = acquired else {
            self.acquire_timeout += 1;
            if self.acquire_ok == 0 && self.acquire_timeout == 1 {
                eprintln!("video: duplicated output idle, waiting for first desktop frame");
            }
            // Idle-duplicate keepalive, admitted on the slot itself: with
            // nothing newer from the desktop and the slot due, the previous
            // frame is re-encoded rather than the slot left empty, so the
            // wire rate is the negotiated rate whatever the content does
            // (Sunshine display_base.cpp paces duplicates the same way).
            // Reaching this path means the duplicator had no new desktop
            // image for this slot at all. A repeat that is not due is
            // dropped here and retried, so an idle desktop still receives
            // ~fps frames and never more.
            if !self.pacing.due(now) {
                return Ok(None);
            }
            //
            // cross-adapter duplicates re-encode the last ring slot: its
            // content is unchanged, so only the consumer-side sync round
            // trip is needed before the encoder sees it again
            if self.bridge.is_some() {
                let Some(slot) = self.bridge_last else {
                    // no frame ever submitted: the duplicated desktop has
                    // been completely idle since the stream started
                    self.idle_skips += 1;
                    idle_acquire_pause();
                    return Ok(None);
                };
                // the encoder may still be reading the slot from its
                // previous submission: wait for that bitstream instead of
                // overwriting a texture under the encode
                if self
                    .encoder_meta
                    .values()
                    .any(|meta| matches!(meta.source, PendingSource::Bridge(s) if s == slot))
                {
                    // as above: the slot stays due, the ring slot frees with
                    // the bitstream, so retry on the 1ms backoff rather than
                    // pausing the emission path
                    self.idle_skips += 1;
                    self.pacing_spent = true;
                    return Ok(None);
                }
                self.pacing.note_emitted(now);
                let Some(bridge) = self.bridge.as_mut() else {
                    return Ok(None);
                };
                if let Err(error) = bridge.begin_consume(slot) {
                    eprintln!(
                        "video: cross-adapter acquire failed ({error}), re-creating capture and encoder"
                    );
                    self.begin_recreate();
                    return Ok(None);
                }
                self.bridge_slot = Some(slot);
                let texture = bridge.consumer_texture(slot);
                // Idle-desktop duplicates carry no real deadline: their
                // capture time is stamped at delivery, not submission, so
                // the frame-age policy never drops them for queueing here.
                if !self.submit_texture(
                    &texture,
                    now,
                    force_idr,
                    PendingSource::Bridge(slot),
                    true,
                    force_idr,
                    // an idle duplicate carries no stage split (its capture
                    // is stamped at reap): zero telemetry
                    Duration::ZERO,
                    Duration::ZERO,
                )? {
                    // encoder full: no bitstream will ever release the
                    // consumer side, so hand the ring slot straight back
                    if let Err(error) = bridge_finish_consume(&mut self.bridge, slot) {
                        eprintln!(
                            "video: cross-adapter release failed ({error}), re-creating capture and encoder"
                        );
                        self.begin_recreate();
                        return Ok(None);
                    }
                }
                return self.reap();
            }
            let Some(texture) = self.last_texture.clone() else {
                // no frame ever acquired: the duplicated desktop has been
                // completely idle since the stream started
                self.idle_skips += 1;
                idle_acquire_pause();
                return Ok(None);
            };
            let Some(slot) = self.last_scaler_slot else {
                self.idle_skips += 1;
                idle_acquire_pause();
                return Ok(None);
            };
            if self.scaler_slot_busy[slot] {
                // The previous encode of this texture is still in flight, so
                // this one cannot re-encode it yet. Not a pause: the slot is
                // still due and the target frees with the bitstream, so the
                // sender loop's spent-budget backoff retries at 1ms and the
                // repeat lands as soon as the encoder is done with it (a
                // 10ms pause here drifts the cadence off the pacer's slot
                // schedule, which the pause's own contract forbids on the
                // emission path).
                self.idle_skips += 1;
                self.pacing_spent = true;
                return Ok(None);
            }
            self.pacing.note_emitted(now);
            self.scaler_slot_busy[slot] = true;
            // a client-requested IDR is honored even on the duplicate
            // path: re-encoding the last texture as an IDR is the
            // decoder refresh a begging client needs (previously the
            // request was swallowed by the first duplicate, which the
            // sender then treated as the applied refresh)
            if !self.submit_texture(
                &texture,
                now,
                force_idr,
                PendingSource::Scaler(slot),
                true,
                force_idr,
                // an idle duplicate carries no stage split
                Duration::ZERO,
                Duration::ZERO,
            )? {
                // encoder full: no bitstream will ever free the target
                self.scaler_slot_busy[slot] = false;
            }
            return self.reap();
        };
        // the slot is spent here, before the scaler/encoder gates: a frame
        // one of those refuses costs cadence, never rate
        self.pacing.note_emitted(now);
        self.acquire_ok += 1;
        if self.acquire_ok == 1 {
            eprintln!(
                "video: first desktop frame acquired ({}x{}, {}ms after pipeline start)",
                self.capture.as_ref().expect("capture set").width,
                self.capture.as_ref().expect("capture set").height,
                self.started.elapsed().as_millis()
            );
        }

        // Frame-age drop policy, pre-encode gate. Two halves:
        //
        // 1. A frame already past the budget is not encoded as history:
        //    skip ahead to the newest desktop texture — drain the
        //    duplicator (DXGI requires the previous frame released before
        //    the next acquire, which the DxgiFrame drop does) until no
        //    newer frame is pending.
        // 2. Whatever frame is held after that (the newest the desktop has)
        //    is judged by its PROJECTED age: its age now plus the encoder's
        //    own measured latency for the frames already inside it and for
        //    this one (`projected_encode_age`), which is the age it will
        //    have when its bitstream is handed over — the same number the
        //    sender loop's post-encode relief valve measures. When that is
        //    past the budget the submission is skipped outright: nothing is
        //    encoded this iteration, no frame number is consumed, and the
        //    encoder's reference chain — the thing a P-frame the client
        //    receives points back into — only ever contains frames that
        //    were shipped.
        //
        // The measured defect (2026-09-14): a 1080p60 session pinned at its
        // 6,220kbps 0.05bpp floor ran the encoder at a full frame interval
        // per frame, 163 bitstreams came out past the budget, and the old
        // gate dropped them *after* the encode — so every one of them was
        // already the reference for the frame behind it, and the client
        // showed P-frames referencing frames it never received ("lots of
        // p-frame artifacts") until the next keyframe. Skipping the
        // submission instead trades frame rate for correctness: the
        // effective rate falls to what the encoder can keep up with (the
        // bits-per-pixel floor's intended degradation), the shipped
        // freshness is the same, and no full-resolution encode is wasted on
        // a frame nobody will see.
        //
        // A forced IDR is exempt from both halves: it is the client's
        // loss-recovery mechanism, every IDR is decodable on its own, and
        // one late IDR beats a missing one.
        let idr = force_idr || self.force_next_idr;
        if !idr && now.duration_since(frame.acquired) > self.max_frame_age {
            let mut dropped = 1u64; // the frame we already hold
            let mut current = frame;
            loop {
                match self.capture.as_ref().expect("capture set").acquire(0) {
                    Ok(Some(newer)) => {
                        dropped += 1;
                        current = newer;
                    }
                    Ok(None) => break,
                    Err(error) => {
                        self.acquire_error += 1;
                        self.last_acquire_error = error.clone();
                        eprintln!("video: capture error ({error}), re-creating duplication");
                        self.begin_capture_recreate();
                        return Ok(None);
                    }
                }
            }
            frame = current;
            self.stale_skips += dropped;
            if self.stale_skips == dropped || self.stale_skips / 100 != (self.stale_skips - dropped) / 100
            {
                eprintln!(
                    "video: frame-age policy: skipped {dropped} stale frame(s), \
                     encoding the newest desktop texture (total {})",
                    self.stale_skips
                );
            }
        }
        if !idr {
            let submit_now = Instant::now();
            let projected = projected_encode_age(
                submit_now.saturating_duration_since(frame.acquired),
                self.pending_depth(),
                self.encode_latency,
            );
            if matches!(
                frame_age_decision(projected, self.max_frame_age, false),
                FrameAgeDecision::Stale
            ) {
                self.stale_submission_skips += 1;
                // Nothing was submitted, so nothing will be measured: let
                // the latency estimate fall, or a stall that inflated it
                // would hold the gate shut for good.
                self.encode_latency = self.encode_latency * 3 / 4;
                if self.stale_submission_skips == 1 || self.stale_submission_skips % 100 == 0 {
                    eprintln!(
                        "video: frame-age policy: skipped a frame submission \
                         (projected age {}ms > {}ms budget; total {})",
                        projected.as_millis(),
                        self.max_frame_age.as_millis(),
                        self.stale_submission_skips
                    );
                }
                return Ok(None);
            }
        }

        // telemetry: how long the acquire that produced this texture took.
        // It is a non-blocking poll at the slot (the wait for the slot
        // itself is the sender loop's spent-budget backoff), so this is
        // the duplicator's own handover cost; after a stale drain it is
        // the newest frame's poll, the same question asked of the texture
        // actually being encoded.
        let acquire_wait = frame.acquired.saturating_duration_since(acquire_started);
        // render the frame into the texture the encoder reads: the
        // scaler's owned targets (every same-adapter path), or the
        // cross-adapter ring, where the encoder input must be the shared
        // ring texture
        match self.bridge.as_mut() {
            Some(bridge) => {
                let Some(scaler) = self.scaler.as_mut() else {
                    eprintln!(
                        "video: cross-adapter path without scaler, re-creating capture and encoder"
                    );
                    self.begin_recreate();
                    return Ok(None);
                };
                // telemetry: the cross-adapter ring's round trip — the
                // producer side before the scale, its flush after it, and
                // the consumer side the encoder reads through. This is the
                // cost the same-adapter path does not pay, so it is
                // measured on its own rather than hidden in the scale span.
                let sync_started = Instant::now();
                let slot = match bridge.begin_produce() {
                    Ok(slot) => slot,
                    // every ring slot is still inside the encoder: this
                    // frame would leave the freshness budget anyway, so
                    // drop it instead of blocking the sender thread
                    Err(BeginProduceError::Busy) => {
                        self.cross_busy_drops += 1;
                        if force_idr {
                            self.note_idr_busy_delay("cross-ring-busy");
                        }
                        if self.cross_busy_drops == 1 || self.cross_busy_drops % 100 == 0 {
                            eprintln!(
                                "video: cross-adapter ring busy, dropping frame (total {})",
                                self.cross_busy_drops
                            );
                        }
                        return Ok(None);
                    }
                    Err(BeginProduceError::Failed(error)) => {
                        eprintln!(
                            "video: cross-adapter sync failed ({error}), re-creating capture and encoder"
                        );
                        self.begin_recreate();
                        return Ok(None);
                    }
                };
                let mut bridge_sync = sync_started.elapsed();
                let target = bridge.producer_texture(slot);
                if let Err(error) = scaler.scale_into(&frame.texture, &target) {
                    eprintln!("video: scaling failed ({error}), re-creating capture and encoder");
                    self.begin_recreate();
                    return Ok(None);
                }
                let flush_started = Instant::now();
                if let Err(error) = bridge.finish_produce(slot) {
                    eprintln!(
                        "video: cross-adapter release failed ({error}), re-creating capture and encoder"
                    );
                    self.begin_recreate();
                    return Ok(None);
                }
                bridge_sync += flush_started.elapsed();
                let consume_started = Instant::now();
                if let Err(error) = bridge.begin_consume(slot) {
                    eprintln!(
                        "video: cross-adapter acquire failed ({error}), re-creating capture and encoder"
                    );
                    self.begin_recreate();
                    return Ok(None);
                }
                bridge_sync += consume_started.elapsed();
                self.bridge_slot = Some(slot);
                self.bridge_last = Some(slot);
                let texture = bridge.consumer_texture(slot);
                if !self.submit_texture(
                    &texture,
                    frame.acquired,
                    force_idr,
                    PendingSource::Bridge(slot),
                    false,
                    force_idr,
                    acquire_wait,
                    bridge_sync,
                )? {
                    // encoder full: hand the ring slot straight back
                    if let Err(error) = bridge_finish_consume(&mut self.bridge, slot) {
                        eprintln!(
                            "video: cross-adapter release failed ({error}), re-creating capture and encoder"
                        );
                        self.begin_recreate();
                        return Ok(None);
                    }
                }
                return self.reap();
            }
            None => {
                // scaler targets are the owned-texture ring the encoder
                // reads; frames never enter it straight from the
                // duplication pool (see create_capture)
                let Some(scaler) = self.scaler.as_mut() else {
                    eprintln!("video: pipeline without scaler, re-creating capture and encoder");
                    self.begin_recreate();
                    return Ok(None);
                };
                let slot = match (0..self.scaler_slot_busy.len())
                    .find(|slot| !self.scaler_slot_busy[*slot])
                {
                    Some(slot) => slot,
                    // both targets are still inside the encoder:
                    // this frame would wait a full pipeline depth
                    // anyway, so drop it instead of blocking the
                    // sender thread
                    None => {
                        self.scaler_busy_drops += 1;
                        if force_idr {
                            self.note_idr_busy_delay("scaler-busy");
                        }
                        if self.scaler_busy_drops == 1 || self.scaler_busy_drops % 100 == 0 {
                            eprintln!(
                                "video: scaler targets busy, dropping frame (total {})",
                                self.scaler_busy_drops
                            );
                        }
                        return Ok(None);
                    }
                };
                let scaled = match scaler.scale(&frame.texture, slot) {
                    Ok(texture) => texture,
                    Err(error) => {
                        eprintln!(
                            "video: scaling failed ({error}), re-creating capture and encoder"
                        );
                        self.begin_recreate();
                        return Ok(None);
                    }
                };
                self.scaler_slot_busy[slot] = true;
                self.last_scaler_slot = Some(slot);
                self.last_texture = Some(scaled.clone());
                if !self.submit_texture(
                    &scaled,
                    frame.acquired,
                    force_idr,
                    PendingSource::Scaler(slot),
                    false,
                    force_idr,
                    acquire_wait,
                    // same-adapter path: no ring to sync
                    Duration::ZERO,
                )? {
                    // encoder full: free the target again
                    self.scaler_slot_busy[slot] = false;
                }
                return self.reap();
            }
        }
    }

    fn counters(&self) -> String {
        format!(
            "acquire ok={} timeout={} error={} (last: {}), pacer surplus={}, encoded={} ({} bytes), idle pacing skips={}, stale pre-encode skips={} (drained {}), idr busy delays={}, display recreations={}, bitrate={}kbps, encoder={}, display {}{}",
            self.acquire_ok,
            self.acquire_timeout,
            self.acquire_error,
            if self.last_acquire_error.is_empty() {
                "none"
            } else {
                self.last_acquire_error.as_str()
            },
            self.pacer_surplus,
            self.encoded,
            self.encoded_bytes,
            self.idle_skips,
            self.stale_submission_skips,
            self.stale_skips,
            self.idr_busy_delays,
            self.recreate_count,
            self.config.bitrate_kbps,
            self.backend.label(),
            match self.display_hz() {
                Some(hz) => format!("{hz}Hz"),
                None => "refresh unknown".to_string(),
            },
            match &self.bridge {
                Some(bridge) => format!(
                    " (cross-adapter via {}, ring busy drops={})",
                    bridge.sync_label(),
                    self.cross_busy_drops
                ),
                None => String::new(),
            }
        )
    }

    fn pending_depth(&self) -> usize {
        self.encoder
            .as_ref()
            .map(|encoder| encoder.pending_depth())
            .unwrap_or(0)
    }

    /// See [`VideoPipeline::pacing_budget_spent`]: the flag recorded by
    /// the last `encode_next` (true on the iteration that waited for a
    /// slot it may not take yet, and on one that found the frame interval
    /// already elapsed).
    fn pacing_budget_spent(&self) -> bool {
        self.pacing_spent
    }

    /// See [`VideoPipeline::set_frame_age_budget`]: the sender loop's own
    /// freshness budget becomes this pipeline's, so the pre-encode gate in
    /// `encode_next` and the loop's `video: freshness budget` line judge a
    /// captured frame against the same bound.
    fn set_frame_age_budget(&mut self, budget: Duration) {
        self.max_frame_age = budget;
    }

    /// See [`VideoPipeline::pre_encode_stale_skips`]: submissions the
    /// pre-encode age gate refused. The frames it drained while skipping
    /// ahead to the newest texture are the same decision one step earlier
    /// and are reported with the rest of the pipeline's counters
    /// (`stale pre-encode skips=N (drained M)`).
    fn pre_encode_stale_skips(&self) -> u64 {
        self.stale_submission_skips
    }

    fn invalidate_ref_frames(&mut self, first_frame: i64, last_frame: i64) -> bool {
        match self.encoder.as_mut() {
            Some(encoder) => encoder.invalidate_ref_frames(first_frame, last_frame),
            None => false,
        }
    }

    fn supports_ref_invalidation(&self) -> bool {
        self.encoder
            .as_ref()
            .is_some_and(|encoder| encoder.supports_ref_invalidation())
    }

    fn encoded(&self) -> u64 {
        self.encoded
    }

    /// See [`VideoPipeline::supply`]: the capture side's frame-supply
    /// counters. Every DXGI frame this pipeline saw is in exactly one of
    /// `new_frames`, `pacer_surplus` or `stale_drained`, so the sender loop
    /// can read their sum as the content rate the slots consumed (the
    /// desktop's own present rate is what `live_present_rate_probe`
    /// measures — a slot takes the newest image in one acquisition, so
    /// DXGI coalesces the presents between two slots into it).
    fn supply(&self) -> FrameSupply {
        FrameSupply {
            new_frames: self.acquire_ok,
            acquire_timeouts: self.acquire_timeout,
            pacer_surplus: self.pacer_surplus,
            idle_skips: self.idle_skips,
            stale_drained: self.stale_skips,
        }
    }

    /// See [`VideoPipeline::session_label`]: with two GPUs in the machine
    /// and a cross-adapter bridge that is enabled by default, "which
    /// encoder, over which sync" is the first thing a latency number needs
    /// beside it.
    fn session_label(&self) -> String {
        let backend = self.backend.label();
        match &self.bridge {
            Some(bridge) => format!(
                "encoder={backend}, cross-adapter via {}",
                bridge.sync_label()
            ),
            None => format!("encoder={backend}, no cross-adapter"),
        }
    }

    /// See [`VideoPipeline::display_hz`]: the mode the duplicated output
    /// reports. None when the capture object is gone (mid-recreation) or
    /// the driver reported no rate.
    fn display_hz(&self) -> Option<u32> {
        self.capture
            .as_ref()
            .map(|capture| capture.refresh_hz)
            .filter(|hz| *hz > 0)
    }

    fn set_bitrate(&mut self, kbps: u32) -> Result<(), String> {
        // Update the config FIRST so a recreate (immediate or later)
        // picks up the new bitrate.
        self.config.bitrate_kbps = kbps;
        match self.encoder.as_mut() {
            Some(encoder) => {
                if let Err(error) = encoder.set_bitrate(kbps) {
                    // Encoder can't take a live reconfigure (e.g. AMF in a
                    // bad state): fall back to recreation, which re-creates
                    // the session straight at the new bitrate.
                    eprintln!(
                        "video: encoder reconfigure failed ({error}); recreating at {kbps}kbps"
                    );
                    self.begin_recreate();
                }
                Ok(())
            }
            None => Ok(()), // mid-recreation: config already updated
        }
    }

    /// The session's encode size, resolved once before the first frame
    /// (`adaptive::AdaptiveController::initial_encode_size` picks it and the
    /// video loop hands it here): store the new size and drive the FULL
    /// recreation path (the resolution-preserving fast path is only for
    /// display-mode changes that keep the size). The scaler rebuilds its
    /// targets at the new size, both encoder inputs are re-registered, and
    /// the encoder session is re-created at the new size — so the session
    /// looks exactly as if it had started there: new SPS/PPS on the wire
    /// and a forced IDR (`force_next_idr`, set by the recreation) for the
    /// client's decoder to re-init on. The measured full path is 45-97ms
    /// against <1ms for the fast path, and it is paid ONCE per session,
    /// before any frame is emitted — a mid-session size change would force
    /// the client to tear its decoder down and rebuild it (see the video
    /// loop's resolution block). A size this adapter cannot create reverts
    /// to the current one inside the recreation (see `recreation_tick`)
    /// and is remembered, so a repeat fails here without touching the
    /// pipeline: a degraded size must never end — or repeatedly interrupt —
    /// a session.
    fn set_encode_size(&mut self, width: u32, height: u32) -> Result<(), String> {
        if width < crate::adaptive::MIN_ENCODE_DIMENSION
            || height < crate::adaptive::MIN_ENCODE_DIMENSION
        {
            return Err(format!("invalid encode size {width}x{height}"));
        }
        if (width, height) == self.encode_size {
            return Ok(()); // already encoding at this size: nothing to do
        }
        if self.resize_rejected == Some((width, height)) {
            return Err(format!(
                "encode size {width}x{height} cannot be created on this adapter"
            ));
        }
        if self.resize_from.is_some() && (self.config.width, self.config.height) == (width, height) {
            return Ok(()); // this same resize is already in flight
        }
        self.resize_from = Some(self.encode_size);
        self.config.width = width;
        self.config.height = height;
        self.begin_recreate();
        Ok(())
    }

    /// The encode size the live session was created at (the desktop size
    /// when the client negotiated 0x0, resolved by `create_capture`). None
    /// only while the geometry is unknown.
    fn encode_size(&self) -> Option<(u32, u32)> {
        (self.encode_size.0 > 0 && self.encode_size.1 > 0).then_some(self.encode_size)
    }

    /// The captured desktop size the scaler reads from: what the adaptive
    /// controller caps the encode size at. None while unknown.
    fn source_size(&self) -> Option<(u32, u32)> {
        (self.source_size.0 > 0 && self.source_size.1 > 0).then_some(self.source_size)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn frame_due_is_exact_at_the_slot_and_never_early() {
        let t = Instant::now();
        let interval = Duration::from_millis(16);
        let slot = t + interval; // one frame interval after the last slot
        // due exactly at the interval
        assert!(frame_due(slot, slot));
        // not due just before it: nothing is asked of the duplicator before
        // the slot, so an emission can never run ahead of the schedule
        assert!(!frame_due(slot - Duration::from_millis(1), slot));
        assert!(!frame_due(slot - interval, slot));
        // and a slot already passed is due
        assert!(frame_due(slot + Duration::from_millis(1), slot));
    }

    #[test]
    fn frame_pacer_holds_the_negotiated_rate_on_a_faster_desktop() {
        // 165Hz desktop, 60fps negotiated: the acquire hands back a frame
        // every present, which is what shipped 95-103 frames/s (and 165/s
        // on this panel's own numbers). The gate admits one per slot.
        let interval = Duration::from_secs_f64(1.0 / 60.0);
        let present = Duration::from_secs_f64(1.0 / 165.0);
        let start = Instant::now();
        let mut pacer = FramePacer::new(interval, start);
        let mut admitted = 0u32;
        let mut now = start;
        for _ in 0..5 * 165 {
            now += present;
            if pacer.due(now) {
                pacer.note_emitted(now);
                admitted += 1;
            }
        }
        // five seconds of presents: one frame per interval, plus the frame
        // that is due immediately at t=0 (the schedule is clamped to the
        // admission instant, so a stall can bank at most that one)
        assert!(admitted <= 5 * 60 + 1, "{admitted} frames admitted in 5s");
        // and the rate is held, not collapsed onto the present lattice:
        // a gate that re-anchored per admission would take every third
        // present (55/s at 165Hz)
        assert!(admitted >= 5 * 60 - 1, "{admitted} frames admitted in 5s");
    }

    #[test]
    fn frame_pacer_passes_a_slower_desktop_through_unchanged() {
        // 30Hz desktop against a 60fps negotiation: every present is a
        // frame the client budgeted for, so the schedule admits every one
        // (the keepalive duplicates fill the other slots in the pipeline,
        // not here). A gate keyed on the present rate rather than the
        // negotiated one would halve this.
        let interval = Duration::from_secs_f64(1.0 / 60.0);
        let present = Duration::from_secs_f64(1.0 / 30.0);
        let start = Instant::now();
        let mut pacer = FramePacer::new(interval, start);
        let mut admitted = 0u32;
        let mut now = start;
        for _ in 0..5 * 30 {
            now += present;
            if pacer.due(now) {
                pacer.note_emitted(now);
                admitted += 1;
            }
        }
        assert_eq!(admitted, 5 * 30);
    }

    #[test]
    fn frame_pacer_jitter_around_the_slot_costs_one_frame_not_a_phase_lock() {
        // A present can land just before the slot the schedule put it in
        // (the duplicator hands the image over a moment after the vsync,
        // and the lag moves). It is surplus for that slot — nothing is
        // asked of the duplicator before the slot — and the next present,
        // a full interval later, is admitted. What must NOT happen is the
        // old misfire: every later slot inheriting that offset, halving
        // the rate. Here 60Hz presents with a 3ms lag drift are admitted
        // at the negotiated rate after the single drop the drift costs.
        let interval = Duration::from_millis(16);
        let start = Instant::now();
        let mut pacer = FramePacer::new(interval, start);
        let mut admitted = 0u32;
        let mut gaps: Vec<Duration> = Vec::new();
        let mut last = start;
        for i in 0..300u32 {
            // present i arrives one interval later, 3ms early every other
            // frame — a lag that shrinks relative to the slot
            let early = Duration::from_millis(if i % 2 == 0 { 0 } else { 3 });
            let now = start + interval * (i + 1) - early;
            if pacer.due(now) {
                pacer.note_emitted(now);
                admitted += 1;
                gaps.push(now - last);
                last = now;
            }
        }
        // one dropped frame at most, and no 2x gaps: the whole point is
        // that the drop does not become the cadence
        assert!(admitted >= 299, "{admitted} admits of 300 presents");
        assert!(!gaps.iter().any(|gap| *gap > interval * 2));
    }

    #[test]
    fn frame_pacer_keepalive_holds_the_cadence_on_an_idle_desktop() {
        // No presents at all: the duplicate keepalive is what holds the
        // client's cadence, and it is admitted on the slot itself, never
        // before it — an idle desktop still gets ~fps frames, never more.
        let interval = Duration::from_secs_f64(1.0 / 60.0);
        let start = Instant::now();
        let mut pacer = FramePacer::new(interval, start);
        assert!(pacer.due(start));
        pacer.note_emitted(start);
        // an acquire that times out before the slot admits nothing
        assert!(!pacer.due(start + Duration::from_millis(10)));
        // the idle path's own cadence: the acquire timeout is the wait to
        // the slot, and the duplicate is due when it lands (the
        // tick-quantized timeout makes that at or after the slot)
        let mut duplicates = 0u32;
        let mut now = start;
        for _ in 0..5 * 60 {
            now += pacer.wait(now);
            if pacer.due(now) {
                pacer.note_emitted(now);
                duplicates += 1;
            }
        }
        assert_eq!(duplicates, 5 * 60);
    }

    #[test]
    fn frame_pacer_holds_the_target_rate_below_the_content_rate() {
        // The rule the shortfall turned on, against the real FramePacer: a
        // desktop presenting 47/s to a 60 fps target must still get 60
        // emissions/s — the slots the content does not fill are repeats,
        // never dropped slots. Letting the content drive the cadence (the
        // old behavior) is what showed up as `sent 52.4/s of 60` with
        // `surplus` collapsing to 6.4/s in the short windows of the 526s
        // session.
        let start = Instant::now();
        let interval = Duration::from_secs_f64(1.0 / 60.0);
        let present_interval = Duration::from_secs_f64(1.0 / 47.0);
        let mut pacer = FramePacer::new(interval, start);
        let mut present_at = start + present_interval;
        let mut now = start;
        let mut fresh = 0u32;
        let mut repeats = 0u32;
        for _ in 0..300 {
            // every slot emits: the newest desktop image when one arrived
            // since the last slot, the previous frame re-encoded otherwise
            let slot = now + pacer.wait(now);
            pacer.note_emitted(slot);
            if present_at <= slot {
                fresh += 1;
                present_at += present_interval;
            } else {
                repeats += 1;
            }
            now = slot;
        }
        assert_eq!(fresh + repeats, 300, "5s of 60 fps slots");
        assert_eq!(fresh, 234, "the desktop's own 47/s: {fresh}");
        assert_eq!(repeats, 66, "the rest is repeats: {repeats}");
    }

    #[test]
    fn frame_pacer_stall_earns_one_frame_not_a_burst() {
        // A stall (paused game, display asleep, no client endpoint yet)
        // leaves the schedule in the past; the clamp bounds the catch-up
        // to the one frame that is due when the presents resume — not to
        // the ~300 slots the stall could have banked.
        let interval = Duration::from_millis(16);
        let start = Instant::now();
        let mut pacer = FramePacer::new(interval, start);
        let stalled = start + Duration::from_secs(5);
        assert!(pacer.due(stalled));
        pacer.note_emitted(stalled);
        // the clamp banks exactly one frame: it is due immediately, and
        // after it the slot is a full interval away again
        assert!(pacer.due(stalled));
        pacer.note_emitted(stalled);
        assert!(!pacer.due(stalled + interval / 2));
        assert!(pacer.due(stalled + interval));
    }

    #[test]
    fn recreate_schedule_attempts_immediately_then_backs_off() {
        let mut schedule = RecreateSchedule::new();
        let now = Instant::now();
        assert!(schedule.due(now));

        schedule.note_failure(now);
        assert_eq!(schedule.failures, 1);
        assert!(!schedule.due(now));
        assert!(schedule.due(now + RECREATE_BACKOFF));
        assert!(!schedule.due(now + RECREATE_BACKOFF - Duration::from_millis(1)));

        schedule.note_failure(now + RECREATE_BACKOFF);
        assert_eq!(schedule.failures, 2);

        schedule.reset();
        assert_eq!(schedule.failures, 0);
        assert!(schedule.due(Instant::now()));
    }

    #[test]
    fn recreate_schedule_gives_up_only_after_consecutive_cap() {
        let mut schedule = RecreateSchedule::new();
        let now = Instant::now();
        for _ in 0..MAX_RECREATE_FAILURES - 1 {
            schedule.note_failure(now);
            assert!(!schedule.given_up());
        }
        schedule.note_failure(now);
        assert!(schedule.given_up());
    }

    #[test]
    fn fit_rect_same_aspect_fills_target() {
        assert_eq!(fit_rect(1920, 1080, 1280, 720), (0, 0, 1280, 720));
        assert_eq!(fit_rect(1280, 720, 1280, 720), (0, 0, 1280, 720));
    }

    #[test]
    fn fit_rect_ultrawide_letterboxes_into_16x9() {
        // 3440x1440 into 1280x720: scale limited by height -> 1280x536,
        // centered with bars top/bottom
        let (x, y, w, h) = fit_rect(3440, 1440, 1280, 720);
        assert_eq!(w, 1280);
        assert_eq!(h, 536);
        assert_eq!(x, 0);
        assert_eq!(y, (720 - 536) / 2);
    }

    #[test]
    fn fit_rect_pillarboxes_portrait_into_landscape() {
        let (x, y, w, h) = fit_rect(720, 1280, 1280, 720);
        assert_eq!(h, 720);
        assert_eq!(w, 405);
        assert_eq!(y, 0);
        assert_eq!(x, (1280 - 405) / 2);
    }

    #[test]
    fn fit_rect_degenerate_inputs_are_safe() {
        assert_eq!(fit_rect(0, 0, 1280, 720), (0, 0, 1280, 720));
        assert_eq!(fit_rect(1920, 1080, 0, 0), (0, 0, 0, 0));
    }

    #[test]
    fn backend_policy_prefers_nvenc_and_falls_back_to_amf() {
        assert_eq!(preferred_backend(true), EncoderBackend::Nvenc);
        assert_eq!(preferred_backend(false), EncoderBackend::Amf);
        assert_eq!(EncoderBackend::Nvenc.label(), "nvenc");
        assert_eq!(EncoderBackend::Amf.label(), "amf");
        assert_eq!(EncoderBackend::AmfCross.label(), "amf-cross");
    }

    #[test]
    fn fast_recreate_policy_requires_same_resolution_and_healthy_encoder() {
        // refresh-rate flips / HDR toggles keep the mode: the encoder
        // session, scaler targets, and bridge all stay valid (the field
        // report: 3440x1440 -> 3440x1440 across a mode change)
        assert!(can_fast_recreate(3440, 1440, 3440, 1440, true));
        assert!(can_fast_recreate(1920, 1080, 1920, 1080, true));
        // a real resolution change invalidates the scaler's content desc
        // and staging texture: full recreation
        assert!(!can_fast_recreate(3440, 1440, 2560, 1440, true));
        assert!(!can_fast_recreate(3440, 1440, 3440, 1080, true));
        assert!(!can_fast_recreate(3440, 1440, 1920, 1080, true));
        // a missing/broken encoder defeats the fast path's purpose
        assert!(!can_fast_recreate(3440, 1440, 3440, 1440, false));
    }

    #[test]
    fn encoder_selection_parses_env_values() {
        // default (unset) and empty values mean auto
        assert_eq!(parse_encoder_selection(None), EncoderSelection::Auto);
        assert_eq!(parse_encoder_selection(Some("")), EncoderSelection::Auto);
        assert_eq!(parse_encoder_selection(Some("  ")), EncoderSelection::Auto);
        assert_eq!(parse_encoder_selection(Some("auto")), EncoderSelection::Auto);
        // case-insensitive, whitespace-tolerant
        assert_eq!(parse_encoder_selection(Some("NVENC")), EncoderSelection::Nvenc);
        assert_eq!(parse_encoder_selection(Some(" nvenc ")), EncoderSelection::Nvenc);
        assert_eq!(parse_encoder_selection(Some("Amf")), EncoderSelection::Amf);
        assert_eq!(parse_encoder_selection(Some("AMF-CROSS")), EncoderSelection::AmfCross);
        assert_eq!(parse_encoder_selection(Some("amf-cross")), EncoderSelection::AmfCross);
        // unknown values degrade to auto
        assert_eq!(parse_encoder_selection(Some("quicksync")), EncoderSelection::Auto);
    }

    #[test]
    fn encoder_selection_cross_attempt_and_failure_policy() {
        // only auto and amf-cross try the cross-adapter path
        assert!(attempts_cross(EncoderSelection::Auto));
        assert!(attempts_cross(EncoderSelection::AmfCross));
        assert!(!attempts_cross(EncoderSelection::Nvenc));
        assert!(!attempts_cross(EncoderSelection::Amf));
        // only the forced amf-cross aborts when cross-adapter init fails;
        // auto falls through to the display-adapter encoder
        assert!(cross_failure_fatal(EncoderSelection::AmfCross));
        assert!(!cross_failure_fatal(EncoderSelection::Auto));
        assert!(!cross_failure_fatal(EncoderSelection::Nvenc));
        assert!(!cross_failure_fatal(EncoderSelection::Amf));
    }

    #[test]
    fn ref_frame_resolution_follows_client_default_and_probe_ceiling() {
        const RFI: RecoveryCapability = RecoveryCapability {
            rfi: true,
            ref_frames: 5,
            hevc: false,
            hevc_main10: false,
        };
        // absent attribute (a client that predates it) and 0 ("host picks",
        // which only an RFI-aware client sends) both mean the default
        assert_eq!(resolve_ref_frames(None, RFI), 5);
        assert_eq!(resolve_ref_frames(Some(0), RFI), 5);
        assert_eq!(resolve_ref_frames(None, RFI), crate::nvenc::REF_FRAMES_DEFAULT);
        // a positive client request is honored inside the probed depth
        assert_eq!(resolve_ref_frames(Some(3), RFI), 3);
        assert_eq!(resolve_ref_frames(Some(1), RFI), 1);
        assert_eq!(resolve_ref_frames(Some(5), RFI), 5);

        // the probe's accepted depth is the ceiling: a 1-frame session caps
        // every request (a deeper DPB would not initialize)
        assert_eq!(resolve_ref_frames(None, NO_RECOVERY), 1);
        assert_eq!(resolve_ref_frames(Some(5), NO_RECOVERY), 1);
        // ...and a driver that accepted 5 refs but no invalidation still
        // caps at 5
        const NO_RFI: RecoveryCapability = RecoveryCapability {
            rfi: false,
            ref_frames: 5,
            hevc: false,
            hevc_main10: false,
        };
        assert_eq!(resolve_ref_frames(Some(8), NO_RFI), 5);
        assert_eq!(resolve_ref_frames(Some(0), NO_RFI), 5);

        // the H.264-level sanity ceiling applies even when the driver
        // accepted more
        const DEEP: RecoveryCapability = RecoveryCapability {
            rfi: true,
            ref_frames: 30,
            hevc: false,
            hevc_main10: false,
        };
        assert_eq!(resolve_ref_frames(Some(30), DEEP), crate::nvenc::REF_FRAMES_MAX);
        // never zero, whatever the probe reported
        assert_eq!(
            resolve_ref_frames(
                Some(0),
                RecoveryCapability {
                    rfi: true,
                    ref_frames: 0,
                    hevc: false,
                    hevc_main10: false,
                }
            ),
            1
        );
    }

    /// Hardware probe for the scaler's output format (run with --ignored on
    /// the real machine): which formats accept a video processor output
    /// view, and which complete a BGRA -> target Blt. Ground truth for the
    /// CreateVideoProcessorOutputView E_INVALIDARG regression.
    #[test]
    #[ignore]
    fn probe_video_processor_output_formats() {
        use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0};
        use windows::Win32::Graphics::Direct3D11::D3D11CreateDevice;
        use windows::Win32::Graphics::Direct3D11::{
            ID3D11Texture2D, ID3D11VideoDevice, D3D11_BIND_RENDER_TARGET,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
            D3D11_USAGE_DEFAULT, D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC,
            D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_STREAM,
            D3D11_VPIV_DIMENSION_TEXTURE2D, D3D11_VPOV_DIMENSION_TEXTURE2D,
        };
        use windows::Win32::Graphics::Dxgi::Common::{
            DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_NV12, DXGI_SAMPLE_DESC,
        };
        use windows::Win32::Graphics::Dxgi::IDXGIResource;

        unsafe {
            let mut device = None;
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
            let context = context.expect("context");
            let video_device: ID3D11VideoDevice = device.cast().expect("ID3D11VideoDevice");
            let video_context: ID3D11VideoContext = context.cast().expect("ID3D11VideoContext");

            let rate = DXGI_RATIONAL {
                Numerator: 60,
                Denominator: 1,
            };
            let mut content = D3D11_VIDEO_PROCESSOR_CONTENT_DESC::default();
            content.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
            content.InputFrameRate = rate;
            content.OutputFrameRate = rate;
            content.InputWidth = 3440;
            content.InputHeight = 1440;
            content.OutputWidth = 1920;
            content.OutputHeight = 1080;
            content.Usage = D3D11_VIDEO_USAGE_OPTIMAL_QUALITY;
            let enumerator = video_device
                .CreateVideoProcessorEnumerator(&content)
                .expect("CreateVideoProcessorEnumerator");
            let processor = video_device
                .CreateVideoProcessor(&enumerator, 0)
                .expect("CreateVideoProcessor");

            let make_target =
                |format: DXGI_FORMAT, width: u32, height: u32| -> windows::core::Result<ID3D11Texture2D> {
                    let mut desc = D3D11_TEXTURE2D_DESC::default();
                    desc.Width = width;
                    desc.Height = height;
                    desc.MipLevels = 1;
                    desc.ArraySize = 1;
                    desc.Format = format;
                    desc.SampleDesc = DXGI_SAMPLE_DESC {
                        Count: 1,
                        Quality: 0,
                    };
                    desc.Usage = D3D11_USAGE_DEFAULT;
                    desc.BindFlags = D3D11_BIND_RENDER_TARGET.0 as u32;
                    let mut texture = None;
                    device
                        .CreateTexture2D(&desc, None, Some(&mut texture))
                        .map(|_| texture.expect("texture"))
                };

            // BGRA source frame at the content-desc input size
            let source = make_target(DXGI_FORMAT_B8G8R8A8_UNORM, 3440, 1440).expect("source texture");

            // input view: try NULL desc first, then explicit TEXTURE2D desc
            let mut input_view = None;
            let null_desc = video_device
                .CreateVideoProcessorInputView(&source, &enumerator, ptr::null(), None)
                .err();
            eprintln!("input view NULL-desc probe: {null_desc:?}");
            let mut explicit_input_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC::default();
            explicit_input_desc.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
            explicit_input_desc.FourCC = 0;
            match video_device.CreateVideoProcessorInputView(
                &source,
                &enumerator,
                &explicit_input_desc,
                Some(&mut input_view),
            ) {
                Ok(()) => eprintln!("input view explicit desc OK"),
                Err(error) => {
                    eprintln!("input view explicit desc failed: {error}");
                    return;
                }
            }
            let input_view = input_view.expect("input view");

            for (name, format) in [("B8G8R8A8", DXGI_FORMAT_B8G8R8A8_UNORM), ("NV12", DXGI_FORMAT_NV12)]
            {
                eprintln!("--- probing {name}");
                let target = match make_target(format, 1920, 1080) {
                    Ok(target) => target,
                    Err(error) => {
                        eprintln!("{name}: CreateTexture2D failed: {error}");
                        continue;
                    }
                };
                let mut output_view = None;
                match video_device.CreateVideoProcessorOutputView(
                    &target,
                    &enumerator,
                    ptr::null(),
                    Some(&mut output_view),
                ) {
                    Ok(()) => eprintln!("{name}: output view (null desc) OK"),
                    Err(error) => {
                        eprintln!("{name}: CreateVideoProcessorOutputView (null desc) failed: {error}");
                    }
                }
                let mut output_view_explicit = None;
                let mut explicit_output_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC::default();
                explicit_output_desc.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
                match video_device.CreateVideoProcessorOutputView(
                    &target,
                    &enumerator,
                    &explicit_output_desc,
                    Some(&mut output_view_explicit),
                ) {
                    Ok(()) => eprintln!("{name}: output view (explicit desc) OK"),
                    Err(error) => {
                        eprintln!(
                            "{name}: CreateVideoProcessorOutputView (explicit desc) failed: {error}"
                        );
                        continue;
                    }
                }
                let output_view = output_view_explicit.expect("output view");
                let target_rect = RECT {
                    left: 0,
                    top: 0,
                    right: 1920,
                    bottom: 1080,
                };
                video_context.VideoProcessorSetOutputTargetRect(
                    &processor,
                    true,
                    Some(&target_rect),
                );
                let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
                    Enable: true.into(),
                    ..Default::default()
                };
                stream.pInputSurface = std::mem::ManuallyDrop::new(Some(input_view.clone()));
                match video_context.VideoProcessorBlt(
                    &processor,
                    &output_view,
                    0,
                    &[stream],
                ) {
                    Ok(()) => eprintln!("{name}: VideoProcessorBlt OK"),
                    Err(error) => eprintln!("{name}: VideoProcessorBlt failed: {error}"),
                }
                let _ = target.cast::<IDXGIResource>();
            }

            // production scenario: a REAL desktop-duplication frame as input
            eprintln!("--- probing desktop duplication texture");
            if let Ok(adapters) = DxgiCapture::candidate_adapters() {
                for adapter in adapters {
                    if let Ok(capture) = try_adapter(&adapter) {
                        if let Ok(Some(frame)) = capture.acquire(1000) {
                            let mut dup_view = None;
                            let mut dup_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC::default();
                            dup_desc.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
                            match video_device.CreateVideoProcessorInputView(
                                &frame.texture,
                                &enumerator,
                                &dup_desc,
                                Some(&mut dup_view),
                            ) {
                                Ok(()) => eprintln!("duplication texture: input view OK"),
                                Err(error) => eprintln!(
                                    "duplication texture: CreateVideoProcessorInputView failed: {error}"
                                ),
                            }
                            // copy into our own texture and retry
                            let copied = make_target(
                                DXGI_FORMAT_B8G8R8A8_UNORM,
                                capture.width,
                                capture.height,
                            )
                            .expect("copy target");
                            let ctx = capture.device().GetImmediateContext().unwrap();
                            ctx.CopyResource(&copied, &frame.texture);
                            let mut copy_view = None;
                            match video_device.CreateVideoProcessorInputView(
                                &copied,
                                &enumerator,
                                &dup_desc,
                                Some(&mut copy_view),
                            ) {
                                Ok(()) => eprintln!("copied texture: input view OK"),
                                Err(error) => eprintln!(
                                    "copied texture: CreateVideoProcessorInputView failed: {error}"
                                ),
                            }
                        }
                        break;
                    }
                }
            }
        }
    }

    /// LIVE timing probe — run explicitly on the streaming host (it
    /// captures the real desktop; ignored by default):
    ///
    ///   cargo test --release -- --ignored live_recreation_timing --nocapture --exact
    ///
    /// Sizes the two display-mode recreation paths component by component:
    /// (a) the fast path — releasing the dead duplication and
    /// re-duplicating on the SAME device (exactly what a same-resolution
    /// mode change pays now; DuplicateOutput's cost is identical with or
    /// without an intervening mode change); (b) the full path — the
    /// scaler rebuild and the NVENC session create+destroy that a
    /// resolution change still pays. The numbers land on stderr.
    #[test]
    #[ignore]
    fn live_recreation_timing() {
        let adapters = DxgiCapture::candidate_adapters().expect("adapters");
        let capture = unsafe { try_adapter(&adapters[0]) }.expect("capture");
        let device = capture.device();
        let (width, height) = (capture.width, capture.height);
        eprintln!("live recreation timing: desktop {width}x{height}");

        // (a) fast path: drop the live duplicator, re-duplicate on the
        // same device. The first sample includes first-call driver work;
        // the steady-state samples are what a mid-stream recreation pays.
        drop(capture);
        let mut fast_ms = Vec::new();
        for _ in 0..7 {
            let started = Instant::now();
            let fresh = unsafe { recreate_duplication(&device) }.expect("re-duplicate");
            fast_ms.push(started.elapsed().as_millis());
            drop(fresh);
        }
        fast_ms.sort_unstable();
        eprintln!(
            "live recreation timing: duplication-only recreate (fast path): median={}ms samples={fast_ms:?}",
            fast_ms[fast_ms.len() / 2]
        );

        // (b) full path components, at the production-shaped 1280x720
        // client mode: the scaler rebuild and the encoder session
        // create+destroy that the old always-full recreation paid.
        let mut scaler_ms = Vec::new();
        for _ in 0..5 {
            let started = Instant::now();
            let scaler = TextureScaler::new(&device, width, height, 1280, 720, 60)
                .expect("scaler");
            scaler_ms.push(started.elapsed().as_millis());
            drop(scaler);
        }
        scaler_ms.sort_unstable();
        eprintln!(
            "live recreation timing: scaler rebuild ({}x{} -> 1280x720): median={}ms samples={scaler_ms:?}",
            width,
            height,
            scaler_ms[scaler_ms.len() / 2]
        );

        let config = crate::nvenc::EncoderConfigParams {
            codec: crate::video::VideoCodec::H264,
            hdr: false,
            width: 1280,
            height: 720,
            fps: 60,
            bitrate_kbps: 15_000,
            slices_per_frame: 1,
            max_ref_frames: crate::nvenc::REF_FRAMES_DEFAULT,
        };
        let mut create_ms = Vec::new();
        let mut destroy_ms = Vec::new();
        for _ in 0..5 {
            let started = Instant::now();
            let encoder =
                crate::nvenc::NvencEncoder::new(device.as_raw(), &config).expect("nvenc session");
            create_ms.push(started.elapsed().as_millis());
            let started = Instant::now();
            drop(encoder);
            destroy_ms.push(started.elapsed().as_millis());
        }
        create_ms.sort_unstable();
        destroy_ms.sort_unstable();
        eprintln!(
            "live recreation timing: nvenc session create: median={}ms samples={create_ms:?}",
            create_ms[create_ms.len() / 2]
        );
        eprintln!(
            "live recreation timing: nvenc session destroy: median={}ms samples={destroy_ms:?}",
            destroy_ms[destroy_ms.len() / 2]
        );

        // the old always-full path end to end: adapter probing with a NEW
        // device per adapter + duplication + encoder + scaler, exactly
        // what recreation_tick used to pay on every display mode change.
        // Both cross-attempt policies: production starts with the
        // cross-adapter probe enabled (cross_broken=false) and only sets
        // it after a cross failure.
        for skip_cross in [false, true] {
            let mut full_ms = Vec::new();
            for _ in 0..5 {
                let started = Instant::now();
                let (capture, encoder, _backend, scaler, _bridge) =
                    create_capture(&config, skip_cross, true).expect("full create_capture");
                full_ms.push(started.elapsed().as_millis());
                drop(encoder);
                drop(scaler);
                drop(capture);
            }
            full_ms.sort_unstable();
            eprintln!(
                "live recreation timing: full create_capture (old path, skip_cross={skip_cross}): median={}ms samples={full_ms:?}",
                full_ms[full_ms.len() / 2]
            );
        }
    }

    /// LIVE smoke — run explicitly on the streaming host (it captures the
    /// real desktop and needs a GPU setup; ignored by default):
    ///
    ///   cargo test --release -- --ignored live_cross_adapter_smoke --nocapture --exact
    ///
    /// Builds the production pipeline through the normal
    /// HYDRA_STREAM_ENCODER selection and runs the real UDP sender loop
    /// against a synthetic loopback client for ~15s while wiggling the
    /// cursor so desktop duplication produces frames. Verifies the
    /// selection produced the expected backend (forced amf-cross fails
    /// loudly here with the exact driver error) and that NVSP video
    /// packets actually flowed; the capture-adapter line, packet-flow
    /// lines, and 5s latency histograms land on stderr.
    #[test]
    #[ignore]
    fn live_cross_adapter_smoke() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        // a capture->encode path slower than a frame interval is expected
        // on the cross-adapter path; widen the freshness budget unless the
        // caller set one explicitly so frames flow for the measurement
        if std::env::var(crate::config::MAX_FRAME_AGE_ENV).is_err() {
            std::env::set_var(crate::config::MAX_FRAME_AGE_ENV, "100");
        }
        let selection = encoder_selection();
        // env overrides so the same harness can be pointed at the target
        // the measurement is about (HYDRA_LIVE_WIDTH/HEIGHT/FPS/KBPS/
        // SECONDS; 1280x720@60 for 15s by default)
        let live_u32 = |name: &str, default: u32| -> u32 {
            std::env::var(name)
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default)
        };
        let (width, height) = (
            live_u32("HYDRA_LIVE_WIDTH", 1280),
            live_u32("HYDRA_LIVE_HEIGHT", 720),
        );
        let fps = live_u32("HYDRA_LIVE_FPS", 60);
        let bitrate_kbps = live_u32("HYDRA_LIVE_KBPS", 15_000);
        let seconds = live_u32("HYDRA_LIVE_SECONDS", 15);
        let config = EncoderConfigParams {
            // HYDRA_LIVE_CODEC=hevc (with HYDRA_STREAM_HDR=1) drives the HDR10
            // path through this harness: the same loop then captures the FP16
            // scRGB desktop, converts it to P010 and encodes Main10.
            codec: match std::env::var("HYDRA_LIVE_CODEC").ok().as_deref() {
                Some("hevc") | Some("h265") => crate::video::VideoCodec::Hevc,
                _ => crate::video::VideoCodec::H264,
            },
            hdr: crate::config::hdr_enabled(),
            width,
            height,
            fps,
            bitrate_kbps,
            slices_per_frame: 1,
            max_ref_frames: crate::nvenc::REF_FRAMES_DEFAULT,
        };
        let pipeline = NvencPipeline::new(config).expect("pipeline");
        let backend = pipeline.backend_label().to_string();
        eprintln!("live smoke: HYDRA_STREAM_ENCODER={selection:?} -> encoder={backend}");
        match (selection, backend.as_str()) {
            (EncoderSelection::AmfCross, "amf-cross")
            | (EncoderSelection::Nvenc, "nvenc")
            | (EncoderSelection::Amf, "amf")
            | (EncoderSelection::Auto, _) => {}
            _ => panic!("selection {selection:?} produced encoder={backend}"),
        }

        // synthetic client: pings from the same socket the server learns
        // as the video peer, and counts the video datagrams it receives
        let server = std::net::UdpSocket::bind("127.0.0.1:0").expect("server socket");
        let server_addr = server.local_addr().unwrap();
        let client = std::net::UdpSocket::bind("127.0.0.1:0").expect("client socket");
        client.connect(server_addr).unwrap();
        client
            .set_read_timeout(Some(Duration::from_millis(200)))
            .unwrap();

        let shared = crate::video::StreamShared::new();
        let stop = shared.clone();
        let wiggle_stop = Arc::new(AtomicBool::new(false));
        {
            let wiggle_stop = wiggle_stop.clone();
            std::thread::spawn(move || {
                use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;
                let mut left = true;
                while !wiggle_stop.load(Ordering::Relaxed) {
                    left = !left;
                    let x = if left { 300 } else { 340 };
                    unsafe {
                        let _ = SetCursorPos(x, 300);
                    }
                    std::thread::sleep(Duration::from_millis(16));
                }
            });
        }

        let video = std::thread::spawn(move || {
            crate::video::run_video_loop(
                server,
                shared,
                Box::new(pipeline),
                1392,
                10,
                0,
                Duration::from_secs_f64(1.0 / fps as f64),
                width,
                height,
                fps,
                bitrate_kbps,
                None,
            )
        });

        let deadline = Instant::now() + Duration::from_secs(seconds as u64);
        let mut received = 0u64;
        let mut buffer = [0u8; 2048];
        while Instant::now() < deadline {
            let _ = client.send(&[0x70; 4]);
            // drain what is available, but keep checking the deadline: on
            // an active stream recv never reaches the read timeout, and a
            // greedy drain loop would starve the deadline check
            for _ in 0..64 {
                match client.recv(&mut buffer) {
                    Ok(_) => received += 1,
                    Err(_) => break,
                }
            }
        }
        stop.stop.store(true, Ordering::Relaxed);
        wiggle_stop.store(true, Ordering::Relaxed);
        video.join().expect("video loop").expect("video loop result");
        eprintln!("live smoke: client received {received} video datagrams (encoder={backend})");
        assert!(received > 0, "no video datagrams reached the client");
    }

    /// LIVE diagnostic — the compositor's own present rate, measured with
    /// no scaling, no encoding, and no pacing in the way (ignored by
    /// default, needs the real desktop):
    ///
    ///   cargo test --release -- --ignored live_present_rate_probe --nocapture --exact
    ///
    /// `AcquireNextFrame(0)` in a tight loop for a few seconds, with the
    /// cursor wiggled at 60Hz exactly like `live_cross_adapter_smoke`, and
    /// reports what DXGI says the desktop delivered: the sum of
    /// `AccumulatedFrames` (every image the compositor presented since the
    /// previous acquire, which an acquire-per-frame loop cannot shadow)
    /// beside the acquire rate this loop could sustain. That separates
    /// "the desktop really handed us 55-66/s" from "the desktop presented
    /// ~100/s and the pipeline only looked ~55 times a second".
    #[test]
    #[ignore]
    fn live_present_rate_probe() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        use windows::Win32::Graphics::Dxgi::DXGI_OUTDUPL_FRAME_INFO;

        let adapters = DxgiCapture::candidate_adapters().expect("adapters");
        let capture = unsafe { try_adapter(&adapters[0]) }.expect("capture");
        eprintln!(
            "present-rate probe: desktop {}x{} @ {}Hz",
            capture.width, capture.height, capture.refresh_hz
        );
        // the live smoke's cursor wiggle, so the number is comparable to a
        // live run's `desktop≈N/s` proxy
        let wiggle_stop = Arc::new(AtomicBool::new(false));
        {
            let wiggle_stop = wiggle_stop.clone();
            std::thread::spawn(move || {
                use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;
                let mut left = true;
                while !wiggle_stop.load(Ordering::Relaxed) {
                    left = !left;
                    let x = if left { 300 } else { 340 };
                    unsafe {
                        let _ = SetCursorPos(x, 300);
                    }
                    std::thread::sleep(Duration::from_millis(16));
                }
            });
        }

        let span = Duration::from_secs(5);
        let started = Instant::now();
        let mut acquires = 0u64;
        let mut presents = 0u64;
        let mut present_frames = 0u64;
        let mut timeouts = 0u64;
        let mut last_present_time = i64::MIN;
        // whether a frame may stay outstanding while the next one is asked
        // for decides if a held present could ever be replaced by a newer
        // one at the slot; DXGI's own answer is reported rather than
        // assumed
        let mut hold_probe: Option<String> = None;
        while started.elapsed() < span {
            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource = None;
            let status = unsafe {
                capture
                    .duplication
                    .AcquireNextFrame(0, &mut info, &mut resource)
            };
            match status {
                Ok(()) => {
                    acquires += 1;
                    // a pointer-only update is handed over as a frame with
                    // no present behind it (LastPresentTime 0), so the two
                    // are counted apart: `presents` is the compositor's own
                    // count of images it put up, `present_frames` the
                    // acquires that carried one
                    presents += u64::from(info.AccumulatedFrames);
                    if info.LastPresentTime != 0 {
                        present_frames += 1;
                        last_present_time = info.LastPresentTime;
                    }
                    if hold_probe.is_none() {
                        // still holding this frame: can the duplicator hand
                        // out the next one while a frame is outstanding?
                        let mut next_info = DXGI_OUTDUPL_FRAME_INFO::default();
                        let mut next_resource = None;
                        let held = unsafe {
                            capture.duplication.AcquireNextFrame(
                                5,
                                &mut next_info,
                                &mut next_resource,
                            )
                        };
                        hold_probe = Some(match &held {
                            Ok(()) => "acquire while holding a frame: OK".to_string(),
                            Err(error) => format!("acquire while holding a frame: {error}"),
                        });
                        if held.is_ok() {
                            let _ = unsafe { capture.duplication.ReleaseFrame() };
                        }
                    }
                    let _ = unsafe { capture.duplication.ReleaseFrame() };
                }
                Err(error) if error.code() == DXGI_ERROR_WAIT_TIMEOUT => timeouts += 1,
                Err(error) => panic!("AcquireNextFrame: {error}"),
            }
        }
        let seconds = started.elapsed().as_secs_f64();
        // Phase B: the same loop with each frame held for one frame
        // interval before it is released. Read its PRESENT rate against
        // phase A's (they are the same loop, so the only difference is the
        // hold): the frame handover rate is ours and drops to ~1/16ms by
        // construction. Measured on this machine the two ran at the same
        // rate in one run (100.4 against 100.3/s) but 84.6 against 20.8/s
        // in another, so the desktop's present rate is not stable enough
        // here to attribute a collapse to the hold — which is moot anyway:
        // `AcquireNextFrame` refuses to hand out a frame while one is
        // outstanding, and the pipeline does not hold one.
        let held_started = Instant::now();
        let mut held_presents = 0u64;
        let mut held_frames = 0u64;
        while held_started.elapsed() < span {
            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource = None;
            match unsafe {
                capture
                    .duplication
                    .AcquireNextFrame(0, &mut info, &mut resource)
            } {
                Ok(()) => {
                    held_frames += 1;
                    held_presents += u64::from(info.AccumulatedFrames);
                    std::thread::sleep(Duration::from_millis(16));
                    let _ = unsafe { capture.duplication.ReleaseFrame() };
                }
                Err(error) if error.code() == DXGI_ERROR_WAIT_TIMEOUT => {
                    std::thread::sleep(Duration::from_millis(1));
                }
                Err(error) => panic!("AcquireNextFrame: {error}"),
            }
        }
        let held_seconds = held_started.elapsed().as_secs_f64();
        wiggle_stop.store(true, Ordering::Relaxed);
        eprintln!(
            "present-rate probe (frame held ~16ms): {:.1} presents/s, {:.1} frame handovers/s over {:.1}s",
            held_presents as f64 / held_seconds,
            held_frames as f64 / held_seconds,
            held_seconds
        );
        eprintln!(
            "present-rate probe: {:.1} presents/s (AccumulatedFrames sum), {:.1} present frames/s \
             (LastPresentTime set), {:.1} frame handovers/s, {:.1} million polls/s, over {:.1}s; \
             last LastPresentTime={last_present_time}",
            presents as f64 / seconds,
            present_frames as f64 / seconds,
            acquires as f64 / seconds,
            (acquires + timeouts) as f64 / seconds / 1e6,
            seconds
        );
        eprintln!("present-rate probe: {}", hold_probe.unwrap_or_default());
        assert!(presents > 0, "no desktop presents observed");
    }

    /// Hardware probe (run with --ignored): what does an HDR output actually
    /// hand the duplication, and does that surface carry data?
    ///
    /// HDR streaming needs the FP16 scRGB desktop. If the driver only ever
    /// returns 8-bit BGRA (an over-bright SDR rendition), HDR capture has no
    /// source and the feature is blocked at the capture boundary. Reports the
    /// colour space of every output, then per acquired frame the surface
    /// format and its content. A synthetic FP16 round-trip runs first so an
    /// all-zero reading can be told apart from a broken readback path, and the
    /// duplication is then torn down and rebuilt to test whether the *first*
    /// duplicator gets a different format from the second.
    #[test]
    #[ignore]
    fn probe_hdr_duplication_surface() {
        use windows::core::Interface;
        use windows::Win32::Graphics::Direct3D11::{
            ID3D11Resource, ID3D11Texture2D, D3D11_CPU_ACCESS_READ, D3D11_MAPPED_SUBRESOURCE,
            D3D11_MAP_READ, D3D11_TEXTURE2D_DESC, D3D11_USAGE, D3D11_USAGE_DEFAULT,
            D3D11_USAGE_STAGING,
        };
        use windows::Win32::Graphics::Dxgi::Common::{
            DXGI_FORMAT_R16G16B16A16_FLOAT, DXGI_SAMPLE_DESC,
        };

        let half_to_f32 = |bits: u16| -> f32 {
            let sign = if bits & 0x8000 != 0 { -1.0f32 } else { 1.0 };
            let exponent = ((bits >> 10) & 0x1f) as i32;
            let mantissa = (bits & 0x3ff) as f32;
            match exponent {
                0 => sign * mantissa * 2f32.powi(-24),
                31 => f32::NAN,
                _ => sign * (1.0 + mantissa / 1024.0) * 2f32.powi(exponent - 15),
            }
        };

        unsafe {
            let adapters = DxgiCapture::candidate_adapters().expect("adapters");
            // 12 = RGB_FULL_G2084_NONE_P2020 (HDR10), 13 = RGB_FULL_G10_NONE_P709 (scRGB), 0 = SDR
            for adapter in &adapters {
                for index in 0..4u32 {
                    let Ok(output) = adapter.EnumOutputs(index) else {
                        break;
                    };
                    let Ok(output6) =
                        output.cast::<windows::Win32::Graphics::Dxgi::IDXGIOutput6>()
                    else {
                        continue;
                    };
                    let Ok(desc) = output6.GetDesc1() else {
                        continue;
                    };
                    eprintln!(
                        "output {index}: colour_space={} max_luminance={:.1} \
                         max_full_frame={:.1} min_luminance={:.4}",
                        desc.ColorSpace.0,
                        desc.MaxLuminance,
                        desc.MaxFullFrameLuminance,
                        desc.MinLuminance
                    );
                }
            }

            for round in 1..=2 {
                let mut capture = None;
                for adapter in &adapters {
                    if let Ok(candidate) = try_adapter(adapter) {
                        capture = Some(candidate);
                        break;
                    }
                }
                let Some(capture) = capture else {
                    eprintln!("round {round}: no capture");
                    continue;
                };
                let device = capture.device();
                let context = device.GetImmediateContext().expect("context");

                // duplication surfaces cannot be copied straight into a
                // CPU-readable staging texture: land them in an owned DEFAULT
                // texture of the same format first.
                let describe = |texture: &ID3D11Texture2D| -> String {
                    let mut source = D3D11_TEXTURE2D_DESC::default();
                    texture.GetDesc(&mut source);

                    let make = |usage: D3D11_USAGE, cpu: u32| -> ID3D11Texture2D {
                        let mut desc = D3D11_TEXTURE2D_DESC::default();
                        desc.Width = source.Width;
                        desc.Height = source.Height;
                        desc.MipLevels = 1;
                        desc.ArraySize = 1;
                        desc.Format = source.Format;
                        desc.SampleDesc = DXGI_SAMPLE_DESC {
                            Count: 1,
                            Quality: 0,
                        };
                        desc.Usage = usage;
                        desc.CPUAccessFlags = cpu;
                        let mut texture = None;
                        device
                            .CreateTexture2D(&desc, None, Some(&mut texture))
                            .expect("CreateTexture2D");
                        texture.expect("texture")
                    };

                    let owned = make(D3D11_USAGE_DEFAULT, 0);
                    context.CopyResource(
                        &owned.cast::<ID3D11Resource>().expect("owned"),
                        &texture.cast::<ID3D11Resource>().expect("source"),
                    );
                    let staging = make(D3D11_USAGE_STAGING, D3D11_CPU_ACCESS_READ.0 as u32);
                    context.CopyResource(
                        &staging.cast::<ID3D11Resource>().expect("staging"),
                        &owned.cast::<ID3D11Resource>().expect("owned"),
                    );

                    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                    context
                        .Map(
                            &staging.cast::<ID3D11Resource>().expect("staging"),
                            0,
                            D3D11_MAP_READ,
                            0,
                            Some(&mut mapped),
                        )
                        .expect("map");
                    let base = mapped.pData as *const u8;
                    let pitch = mapped.RowPitch as usize;
                    let (mut low, mut high, mut total, mut count) =
                        (f32::MAX, f32::MIN, 0f64, 0u64);
                    let mut y = 0usize;
                    while y < source.Height as usize {
                        let mut x = 0usize;
                        while x < source.Width as usize {
                            let value = if source.Format == DXGI_FORMAT_R16G16B16A16_FLOAT {
                                let pixel = std::slice::from_raw_parts(
                                    base.add(y * pitch + x * 8) as *const u16,
                                    3,
                                );
                                half_to_f32(pixel[1])
                            } else {
                                let pixel =
                                    std::slice::from_raw_parts(base.add(y * pitch + x * 4), 3);
                                pixel[1] as f32 / 255.0
                            };
                            low = low.min(value);
                            high = high.max(value);
                            total += value as f64;
                            count += 1;
                            x += 37;
                        }
                        y += 13;
                    }
                    context.Unmap(&staging, 0);
                    format!(
                        "format={} {}x{} min={low:.4} mean={:.4} max={high:.4}",
                        source.Format.0,
                        source.Width,
                        source.Height,
                        total / count.max(1) as f64
                    )
                };

                if round == 1 {
                    let mut desc = D3D11_TEXTURE2D_DESC::default();
                    desc.Width = 4;
                    desc.Height = 1;
                    desc.MipLevels = 1;
                    desc.ArraySize = 1;
                    desc.Format = DXGI_FORMAT_R16G16B16A16_FLOAT;
                    desc.SampleDesc = DXGI_SAMPLE_DESC {
                        Count: 1,
                        Quality: 0,
                    };
                    desc.Usage = D3D11_USAGE_DEFAULT;
                    let mut synthetic = None;
                    device
                        .CreateTexture2D(&desc, None, Some(&mut synthetic))
                        .expect("CreateTexture2D");
                    let synthetic = synthetic.expect("synthetic");
                    let mut pixels: Vec<u16> = Vec::new();
                    for value in [0x3C00u16, 0x3800, 0x4100, 0x3400] {
                        pixels.extend_from_slice(&[value, value, value, 0x3C00]);
                    }
                    context.UpdateSubresource(
                        &synthetic.cast::<ID3D11Resource>().expect("synthetic"),
                        0,
                        None,
                        pixels.as_ptr() as *const _,
                        4 * 8,
                        0,
                    );
                    eprintln!(
                        "readback sanity (synthetic fp16 green=1.0): {}",
                        describe(&synthetic)
                    );
                }

                let mut held = None;
                for attempt in 1..=8 {
                    // DXGI refuses AcquireNextFrame while a frame is held
                    held = None;
                    match capture.acquire(700) {
                        Ok(Some(frame)) => {
                            eprintln!("round {round} frame {attempt}: {}", describe(&frame.texture));
                            held = Some(frame);
                        }
                        Ok(None) => eprintln!("round {round} frame {attempt}: timeout"),
                        Err(error) => eprintln!("round {round} frame {attempt}: {error}"),
                    }
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
                drop(held);
            }
        }
    }

    /// Hardware probe (run with --ignored): what desktop duplication does
    /// while the display is in standby, measured in the shape of the user's
    /// report ("turn the display off, then start the stream").
    ///
    /// The display is switched off through the same DPMS path Windows' power
    /// plan uses (`WM_SYSCOMMAND` / `SC_MONITORPOWER`) and switched back on by
    /// a guard that also runs on unwind. Each phase reports how many acquires
    /// returned a frame, timed out or errored, and the mean luma of the frames
    /// it did get — plus the same statistic sampled through GDI, so "the
    /// stream is black" can be attributed to the surface DXGI hands over or to
    /// the desktop behind it. The phase that matters is the *fresh* duplication
    /// created while the display is already off: that is exactly what starting
    /// a stream with the monitor off does.
    #[test]
    #[ignore]
    #[allow(unused_unsafe)] // the probe's nested blocks sit in its own unsafe scope
    fn probe_display_standby_capture() {
        use windows::Win32::Foundation::{LPARAM, WPARAM};
        use windows::Win32::Graphics::Direct3D11::{
            D3D11_CPU_ACCESS_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_USAGE_STAGING,
        };
        use windows::Win32::System::Power::{
            SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED,
        };
        use windows::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC};
        use windows::Win32::UI::WindowsAndMessaging::{
            GetSystemMetrics, SendMessageW, HWND_BROADCAST, SM_CXSCREEN, SM_CYSCREEN, WM_SYSCOMMAND,
        };

        /// `SC_MONITORPOWER` (winuser.h): lparam 2 = off, -1 = on.
        const SC_MONITORPOWER_CODE: usize = 0xf170;

        /// Switches the display back on even if the probe panics.
        struct DisplayBackOn;
        impl Drop for DisplayBackOn {
            fn drop(&mut self) {
                unsafe {
                    SendMessageW(
                        HWND_BROADCAST,
                        WM_SYSCOMMAND,
                        WPARAM(SC_MONITORPOWER_CODE),
                        LPARAM(-1),
                    );
                }
            }
        }

        let set_display = |power: isize| unsafe {
            SendMessageW(
                HWND_BROADCAST,
                WM_SYSCOMMAND,
                WPARAM(SC_MONITORPOWER_CODE),
                LPARAM(power),
            );
        };

        // A static desktop delivers no frames at all, display on or off (the
        // first run of this probe measured 1 frame in 2s with the display on),
        // so the probe needs a change source: cursor movement is what makes the
        // duplication deliver, the same trick `tests/live_smoke.rs` uses.
        let wiggle_stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop = wiggle_stop.clone();
        let wiggler = std::thread::spawn(move || {
            use std::sync::atomic::Ordering;
            use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};
            let mut left = true;
            while !stop.load(Ordering::Relaxed) {
                unsafe {
                    let mut point = windows::Win32::Foundation::POINT { x: 0, y: 0 };
                    let _ = GetCursorPos(&mut point);
                    let _ = SetCursorPos(point.x + if left { 1 } else { -1 }, point.y);
                }
                left = !left;
                std::thread::sleep(Duration::from_millis(30));
            }
        });

        // GDI sampling of the primary screen: 48x27 points, cheap enough to run
        // inside a phase and independent of DXGI.
        let gdi_luma = || unsafe {
            let screen_w = GetSystemMetrics(SM_CXSCREEN).max(1);
            let screen_h = GetSystemMetrics(SM_CYSCREEN).max(1);
            let dc = GetDC(None);
            let (mut sum, mut min, mut max, mut count) = (0.0f64, f64::MAX, 0.0f64, 0u32);
            for gy in 0..27 {
                for gx in 0..48 {
                    let pixel = GetPixel(dc, gx * screen_w / 48, gy * screen_h / 27).0;
                    let (b, g, r) = (
                        (pixel & 0xff) as f64,
                        ((pixel >> 8) & 0xff) as f64,
                        ((pixel >> 16) & 0xff) as f64,
                    );
                    let luma = 0.114 * b + 0.587 * g + 0.299 * r;
                    sum += luma;
                    min = min.min(luma);
                    max = max.max(luma);
                    count += 1;
                }
            }
            ReleaseDC(None, dc);
            (sum / count as f64, min, max)
        };

        unsafe {
            let adapters = DxgiCapture::candidate_adapters().expect("adapters");
            let capture = try_adapter(&adapters[0]).expect("capture");
            eprintln!(
                "display standby probe: {}x{}, desktop duplication over BGRA",
                capture.width, capture.height
            );

            fn frame_luma(device: &ID3D11Device, frame: &DxgiFrame) -> String {
                unsafe {
                    let mut desc = D3D11_TEXTURE2D_DESC::default();
                    frame.texture.GetDesc(&mut desc);
                    let mut staging = desc;
                    staging.Usage = D3D11_USAGE_STAGING;
                    staging.BindFlags = 0;
                    staging.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
                    staging.MiscFlags = 0;
                    let mut copy = None;
                    if device
                        .CreateTexture2D(&staging, None, Some(&mut copy))
                        .is_err()
                    {
                        return "staging texture failed".to_string();
                    }
                    let copy = copy.expect("staging");
                    let context = device.GetImmediateContext().expect("context");
                    context.CopyResource(&copy, &frame.texture);
                    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                    if context
                        .Map(&copy, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                        .is_err()
                    {
                        return "map failed".to_string();
                    }
                    let pitch = mapped.RowPitch as usize;
                    let rows = (desc.Height as usize).min(64);
                    let cols = (desc.Width as usize).min(256);
                    let (mut sum, mut min, mut max, mut count) = (0.0f64, f64::MAX, 0.0f64, 0u64);
                    if desc.Format == DXGI_FORMAT_B8G8R8A8_UNORM {
                        for row in 0..rows {
                            let row_ptr = (mapped.pData as *const u8).add(row * pitch);
                            for col in 0..cols {
                                let pixel = row_ptr.add(col * 4);
                                let (b, g, r) = (
                                    *pixel as f64,
                                    *pixel.add(1) as f64,
                                    *pixel.add(2) as f64,
                                );
                                let luma = 0.114 * b + 0.587 * g + 0.299 * r;
                                sum += luma;
                                min = min.min(luma);
                                max = max.max(luma);
                                count += 1;
                            }
                        }
                    }
                    context.Unmap(&copy, 0);
                    if count == 0 {
                        return format!("frame format={} (no luma read)", desc.Format.0);
                    }
                    format!(
                        "frame {}x{} format={} mean={:.1} min={:.0} max={:.0}",
                        desc.Width,
                        desc.Height,
                        desc.Format.0,
                        sum / count as f64,
                        min,
                        max
                    )
                }
            }

            let phase = |label: &str, seconds: u32, capture: &DxgiCapture| {
                let (mut frames, mut timeouts, mut errors) = (0u32, 0u32, 0u32);
                let mut samples: Vec<String> = Vec::new();
                let mut error_text = String::new();
                let deadline = Instant::now() + Duration::from_secs(seconds as u64);
                while Instant::now() < deadline {
                    match capture.acquire(250) {
                        Ok(Some(frame)) => {
                            frames += 1;
                            if samples.len() < 2 {
                                samples.push(frame_luma(&capture.device(), &frame));
                            }
                        }
                        Ok(None) => timeouts += 1,
                        Err(error) => {
                            errors += 1;
                            if error_text.is_empty() {
                                error_text = error;
                            }
                        }
                    }
                }
                let (mean, min, max) = gdi_luma();
                eprintln!(
                    "{label}: frames={frames} timeouts={timeouts} errors={errors} | GDI luma \
                     mean={mean:.1} min={min:.0} max={max:.0}"
                );
                if !error_text.is_empty() {
                    eprintln!("  first acquire error: {error_text}");
                }
                for sample in &samples {
                    eprintln!("  {sample}");
                }
            };

            phase("display ON (baseline)", 2, &capture);

            set_display(2);
            let _restore = DisplayBackOn;
            std::thread::sleep(Duration::from_millis(2000));
            phase("display STANDBY (panel off, desktop still composed)", 4, &capture);

            // Does asking Windows to keep the display on bring the frames back
            // with the panel still dark? This is the mechanism a fix would use
            // (Sunshine's ES_DISPLAY_REQUIRED + retry, display_base.cpp:550).
            unsafe {
                SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED);
            }
            std::thread::sleep(Duration::from_millis(2000));
            phase("display STANDBY + ES_DISPLAY_REQUIRED", 4, &capture);

            // Does *keeping* the flag set — what a running stream does, and
            // what the keeper now re-asserts every 500 ms — hold capture up,
            // or does the display win after a while? Re-assert every 2 s and
            // count frames per bucket: if the later buckets collapse, a
            // repeated call is not enough and the answer is a virtual display.
            for bucket in 1..=5 {
                unsafe {
                    SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED);
                }
                let (mut frames, mut timeouts, mut errors) = (0u32, 0u32, 0u32);
                let deadline = Instant::now() + Duration::from_secs(2);
                while Instant::now() < deadline {
                    match capture.acquire(250) {
                        Ok(Some(frame)) => {
                            frames += 1;
                            drop(frame);
                        }
                        Ok(None) => timeouts += 1,
                        Err(_) => errors += 1,
                    }
                }
                eprintln!(
                    "standby keep-alive bucket {bucket} (2s): frames={frames} timeouts={timeouts} \
                     errors={errors}"
                );
            }
            unsafe {
                SetThreadExecutionState(ES_CONTINUOUS);
            }
            std::thread::sleep(Duration::from_millis(2000));
            phase("display STANDBY after releasing it", 3, &capture);

            // The user's case: the stream starts *after* the display went off.
            // DXGI allows one duplication per output, so the old duplicator has
            // to go first — as it does when the sidecar starts fresh.
            drop(capture);
            match try_adapter(&adapters[0]) {
                Ok(fresh) => phase("display STANDBY, fresh duplication", 3, &fresh),
                Err(error) => {
                    eprintln!("display STANDBY, fresh duplication: FAILED: {error}");
                    // Sunshine's move for an output that cannot be duplicated:
                    // ask Windows to power the display back on and retry
                    // (display_base.cpp:550-554). The panel may stay dark; the
                    // question is whether the *desktop* comes back.
                    let mut woken = None;
                    for attempt in 1..=4 {
                        unsafe {
                            SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED);
                        }
                        std::thread::sleep(Duration::from_millis(1500));
                        match try_adapter(&adapters[0]) {
                            Ok(fresh) => {
                                eprintln!(
                                    "display STANDBY after wake attempt {attempt}: duplication \
                                     created"
                                );
                                woken = Some(fresh);
                                break;
                            }
                            Err(error) => {
                                eprintln!("display STANDBY after wake attempt {attempt}: {error}")
                            }
                        }
                    }
                    if let Some(fresh) = woken {
                        phase("display STANDBY + ES_DISPLAY_REQUIRED", 3, &fresh);
                    } else {
                        eprintln!("display STANDBY: never became duplicatable");
                    }
                    unsafe {
                        SetThreadExecutionState(ES_CONTINUOUS);
                    }
                }
            }

            set_display(-1);
            std::thread::sleep(Duration::from_millis(2000));
            match try_adapter(&adapters[0]) {
                Ok(after) => phase("display back ON", 3, &after),
                Err(error) => eprintln!("display back ON: {error}"),
            }

            wiggle_stop.store(true, std::sync::atomic::Ordering::Relaxed);
            let _ = wiggler.join();
        }
    }
}
