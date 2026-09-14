//! Session streaming glue: starts and stops the video pipeline around the
//! GameSession state machine and bridges the ENet control server with
//! session lifecycle.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use std::sync::Arc;

use crate::capture::NvencPipeline;
use crate::config;
use crate::nvenc::EncoderConfigParams;
use crate::nvhttp::{GamePhase, LaunchParams, State};
use crate::video::{run_video_loop, StreamShared, VideoPipeline};

/// Hard floor between applied IDR responses while a client is starving:
/// at most ~5 IDRs/s, however fast the client begs.
///
/// 200ms is the shortest interval at which a retry can help at all. The
/// client that begs is the one whose decoder is stuck, and its round trip
/// plus decode latency is 50-150ms, so an IDR applied sooner fires before
/// the previous keyframe could have been decoded — it can only add load,
/// never speed recovery. The measurement that settled it: the 2026-09-14
/// iPad session (07:37:28-07:40:55) held a solid 60fps at 25Mbps with one
/// SPS for the whole run, the client reported 0% network loss at ~10ms,
/// and the picture froze. The client sent 1752 REQUEST_IDRs (~15/s,
/// continuously to the end) and the host answered 951 forced IDRs, each
/// ~95KB at 3440x1936 — ~11Mbps of the 25Mbps stream (~44%) spent on
/// keyframes, leaving little for the P-frames that build a picture, and
/// the client still never recovered. Roughly 40% of all frames sent were
/// keyframes.
pub(crate) const IDR_THROTTLE_NORMAL: Duration = Duration::from_millis(200);
/// Backoff cadence (~2 IDRs/s) for a client that keeps begging past
/// `IDR_BACKOFF_THRESHOLD` answered requests.
///
/// The old ladder read persistent begging as "the last keyframe was lost,
/// retry sooner" and stepped the throttle DOWN to a 50ms rung. At 50ms
/// the retry fires before the client could possibly have decoded the
/// previous keyframe (see `IDR_THROTTLE_NORMAL`), so the escalation could
/// only add load — with a client that keeps begging it became a permanent
/// keyframe flood (the measured session's 951 forced IDRs are that
/// flood). The inversion: a client still begging after eight answered
/// requests is not missing keyframes, so the gate slows down. 500ms still
/// answers every request — `idr_pending` stays armed, so a coalesced
/// request is retried, never dropped — at 2/s instead of 5/s.
pub(crate) const IDR_THROTTLE_BACKOFF: Duration = Duration::from_millis(500);
/// Quiet period that ends an episode: a run of applied requests with no
/// request for this long is over, so the last IDR survived and the next
/// request is a fresh loss — prompt cadence again, backoff counter
/// cleared. Also the window an episode's applied requests are counted
/// over.
const IDR_STARVE_WINDOW: Duration = Duration::from_secs(2);
/// Consecutive applied requests in one episode before the gate backs off.
///
/// At the 200ms floor eight applies span 1.4s of a client that has been
/// answered eight times and is still begging. Eight is long enough that a
/// client which recovers after one or two keyframes never reaches it (the
/// healthy case is untouched) and short enough that a hopeless episode is
/// slowed within ~1.5s instead of running at the floor for minutes.
const IDR_BACKOFF_THRESHOLD: u32 = 8;

/// Starvation-aware gate for client IDR requests.
///
/// Every client REQUEST_IDR is either answered (applied) or coalesced into
/// the answer already owed — a request is never simply dropped, because
/// `idr_pending` stays armed from the last applied request until a frame
/// actually encodes, so a coalesced request is retried either way.
///
/// The cadence is `IDR_THROTTLE_NORMAL` (200ms, the hard floor) and it
/// only ever slows: after `IDR_BACKOFF_THRESHOLD` applied requests in one
/// episode the gate steps to `IDR_THROTTLE_BACKOFF` (500ms) and stays
/// there while the begging lasts. An episode ends after `IDR_STARVE_WINDOW`
/// with no request at all, which restores the prompt cadence and clears
/// the backoff — the first request of a session, and the first after a
/// quiet period, is answered immediately.
///
/// The inversion of the old rung ladder is deliberate: persistent begging
/// is evidence that keyframes are not the fix (the measurement is on
/// `IDR_THROTTLE_NORMAL`), so the response slows instead of speeding up.
/// The host also no longer forces proactive refreshes of its own — an
/// unasked-for IDR while the client is already being answered at this
/// cadence is the same keyframe flood one step removed.
pub struct IdrRequestGate {
    last_applied: Option<Instant>,
    /// Newest request of any kind (applied or coalesced): the episode
    /// boundary, so a client that keeps begging keeps its episode alive
    /// even while the cadence coalesces most of its requests.
    last_request: Option<Instant>,
    /// Applied requests in the current episode (cleared when it ends).
    applied_in_episode: u32,
    /// True while the cadence is the backoff rung.
    backing_off: bool,
    /// Cumulative counters for the control server's 5s stats: requests
    /// answered (applied) vs coalesced into the owed answer.
    answered: u64,
    coalesced: u64,
}

impl IdrRequestGate {
    pub fn new() -> Self {
        IdrRequestGate {
            last_applied: None,
            last_request: None,
            applied_in_episode: 0,
            backing_off: false,
            answered: 0,
            coalesced: 0,
        }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }

    /// (answered, coalesced) totals since construction or `reset`, for
    /// the control server's 5s stats window.
    pub fn counts(&self) -> (u64, u64) {
        (self.answered, self.coalesced)
    }

    /// The cadence an applied request must wait out right now: the 200ms
    /// floor, or the 500ms backoff rung once the client has proven that
    /// keyframes are not what it is missing.
    pub fn cadence(&self) -> Duration {
        if self.backing_off {
            IDR_THROTTLE_BACKOFF
        } else {
            IDR_THROTTLE_NORMAL
        }
    }

    /// A client REQUEST_IDR arrived. Returns true when the request
    /// applies (the current cadence has passed) — the caller then arms
    /// idr_pending. A coalesced request still leaves idr_pending ARMED:
    /// it was set by the last applied request and stays set until a frame
    /// is actually encoded, so a dropped IDR is retried, never swallowed.
    pub fn note_request(&mut self, now: Instant) -> bool {
        self.prune(now);
        self.last_request = Some(now);
        if self
            .last_applied
            .is_some_and(|last| now.duration_since(last) < self.cadence())
        {
            self.coalesced += 1;
            return false;
        }
        self.last_applied = Some(now);
        self.applied_in_episode += 1;
        self.answered += 1;
        // Eight answers inside one episode and the client is still
        // begging: slow down, do not speed up.
        if self.applied_in_episode > IDR_BACKOFF_THRESHOLD {
            self.set_backing_off(true);
        }
        true
    }

    fn prune(&mut self, now: Instant) {
        if self
            .last_request
            .is_some_and(|at| now.duration_since(at) < IDR_STARVE_WINDOW)
        {
            return;
        }
        // The begging wave ended (or never started): the episode and its
        // backoff are over, so the next loss is answered at the prompt
        // cadence again.
        if self.applied_in_episode > 0 || self.backing_off {
            self.applied_in_episode = 0;
            self.set_backing_off(false);
        }
    }

    fn set_backing_off(&mut self, backing_off: bool) {
        if backing_off == self.backing_off {
            return;
        }
        self.backing_off = backing_off;
        if backing_off {
            eprintln!(
                "control: IDR backoff ON ({} applied requests in one episode and the client is still begging: cadence {}ms -> {}ms; keyframes are not the fix)",
                self.applied_in_episode,
                IDR_THROTTLE_NORMAL.as_millis(),
                IDR_THROTTLE_BACKOFF.as_millis(),
            );
        } else {
            eprintln!(
                "control: IDR backoff OFF (no request for {}s: cadence back to {}ms)",
                IDR_STARVE_WINDOW.as_secs(),
                IDR_THROTTLE_NORMAL.as_millis(),
            );
        }
    }
}

impl Default for IdrRequestGate {
    fn default() -> Self {
        Self::new()
    }
}


/// Per-streaming-run handle shared between the RTSP, control and video tasks.
pub struct StreamHandle {
    pub shared: Arc<StreamShared>,
}

impl State {
    /// Starts capture + encode + RTP send on PLAY. Failure to initialize
    /// the GPU pipeline is logged but does not kill the session (the
    /// control stream still keeps the client connected). All heavy GPU
    /// initialization happens on the video thread so the PLAY response is
    /// not delayed.
    pub fn start_streaming(&self) {
        if self.stream.lock().expect("stream lock").is_some() {
            eprintln!("stream: PLAY received but stream tasks are already running");
            return;
        }
        let shared = StreamShared::new();
        // the first frame of every stream must be an IDR: the GOP is
        // infinite and no IDR ever follows spontaneously, so a decoder
        // that missed the first frame shows black forever
        shared.idr_pending.store(true, Ordering::Relaxed);
        // a fresh stream starts at the prompt cadence: no stale backoff or
        // request history may carry into the new session's IDR gate
        self.idr_gate.lock().expect("idr gate lock").reset();
        let launch = self.launch_params();
        if let Some(launch) = &launch {
            eprintln!(
                "stream: PLAY starting stream tasks (appid={}, {}x{}@{}fps, bitrate={}kbps, packet_size={}, encrypted_rtsp={}, host_audio={})",
                launch.appid,
                launch.width,
                launch.height,
                launch.fps,
                launch.bitrate_kbps,
                launch.packet_size,
                launch.encrypted_rtsp,
                launch.host_audio
            );
            match self.media_sockets() {
                Ok((video_socket, _audio_socket)) => {
                    eprintln!("stream: video task spawned (port {})", config::ports().video);
                    let shared_for_task = shared.clone();
                    let packet_size = launch.packet_size;
                    let launch = launch.clone();
                    std::thread::spawn(move || {
                        match build_pipeline(&launch) {
                            Ok(pipeline) => {
                                let _ = run_video_loop(
                                    video_socket,
                                    shared_for_task,
                                    pipeline,
                                    packet_size,
                                    config::fec_percentage(),
                                    launch.min_required_fec_packets,
                                    std::time::Duration::from_secs_f64(
                                        1.0 / launch.fps.max(1) as f64,
                                    ),
                                    launch.width,
                                    launch.height,
                                    launch.fps.max(1),
                                    launch.bitrate_kbps,
                                    launch.video_qos_type,
                                );
                            }
                            Err(error) => eprintln!("video pipeline unavailable: {error}"),
                        }
                    });
                }
                Err(error) => eprintln!("video socket unavailable: {error}"),
            }
            match self.media_sockets() {
                Ok((_video_socket, audio_socket)) => {
                    eprintln!("stream: audio task spawned (port {})", config::ports().audio);
                    let shared_for_task = shared.clone();
                    let launch = launch.clone();
                    // The audio destination is this session's own client:
                    // the IP its RTSP handshake came from (any port of it
                    // is a legitimate rebind, nothing else re-targets the
                    // stream).
                    let session_client = self.session_client_ip();
                    // Encrypted audio: the client's ANNOUNCE asked for it, so
                    // every payload is AES-128-CBC under the session's AV key
                    // (the same rikey the control channel decrypts input
                    // with) and the /launch rikeyid the IV is built from.
                    let audio_cipher = launch
                        .audio_encryption
                        .then(|| crate::audio::AudioCipher::new(launch.rikey, launch.rikeyid));
                    std::thread::spawn(move || {
                        // A WASAPI/Opus failure must not silently kill
                        // audio for the rest of the stream: rebuild the
                        // pipeline (re-opens the default device) up to 5
                        // times before giving up loudly.
                        const MAX_AUDIO_RETRIES: u32 = 5;
                        let mut attempts = 0;
                        loop {
                            match build_audio_pipeline(&launch) {
                                Ok(pipeline) => {
                                    match crate::audio::run_audio_loop(
                                        audio_socket.try_clone().expect("audio socket clone"),
                                        shared_for_task.clone(),
                                        pipeline,
                                        launch.packet_duration_ms,
                                        launch.audio_qos_type,
                                        session_client,
                                        audio_cipher,
                                    ) {
                                        Ok(()) => return,
                                        Err(error) => {
                                            attempts += 1;
                                            if attempts > MAX_AUDIO_RETRIES {
                                                eprintln!(
                                                    "audio: giving up after {MAX_AUDIO_RETRIES} re-init attempts: {error}"
                                                );
                                                return;
                                            }
                                            eprintln!(
                                                "audio: pipeline failed ({error}), re-init attempt {attempts}/{MAX_AUDIO_RETRIES}"
                                            );
                                            std::thread::sleep(Duration::from_secs(1));
                                        }
                                    }
                                }
                                Err(error) => {
                                    attempts += 1;
                                    if attempts > MAX_AUDIO_RETRIES {
                                        eprintln!(
                                            "audio: pipeline unavailable after {MAX_AUDIO_RETRIES} attempts: {error}"
                                        );
                                        return;
                                    }
                                    eprintln!(
                                        "audio: pipeline unavailable ({error}), retry {attempts}/{MAX_AUDIO_RETRIES}"
                                    );
                                    std::thread::sleep(Duration::from_secs(1));
                                }
                            }
                        }
                    });
                }
                Err(error) => eprintln!("audio socket unavailable: {error}"),
            }
        } else {
            eprintln!("stream: PLAY received but no launch params are set");
        }
        *self.stream.lock().expect("stream lock") = Some(StreamHandle { shared });
    }

    /// Stops the video pipeline. Called on every session end.
    pub fn stop_streaming(&self) {
        if let Some(handle) = self
            .stream
            .lock()
            .expect("stream lock")
            .take()
        {
            eprintln!("stream: stop requested, signaling video/audio loops");
            handle.shared.stop.store(true, Ordering::Relaxed);
        }
    }

    pub fn stream_shared(&self) -> Option<Arc<StreamShared>> {
        self.stream
            .lock()
            .expect("stream lock")
            .as_ref()
            .map(|handle| handle.shared.clone())
    }

    /// Client REQUEST_IDR: pass through the starvation gate (the 200ms
    /// hard floor, slowing to the 500ms backoff rung after
    /// `IDR_BACKOFF_THRESHOLD` applied requests in one episode, prompt
    /// again once the begging stops; a coalesced request still leaves
    /// idr_pending ARMED until a frame actually encodes, so an IDR that
    /// died on the wire is retried, never swallowed). An applied request
    /// arms idr_pending, stamps idr_last_applied_ms (the video loop's
    /// P-frame suppression episode), and counts toward the
    /// adaptive-bitrate IDR-flood signal.
    pub fn request_idr(&self) {
        let (apply, answered, coalesced) = {
            let mut gate = self.idr_gate.lock().expect("idr gate lock");
            let apply = gate.note_request(Instant::now());
            let (answered, coalesced) = gate.counts();
            (apply, answered, coalesced)
        };
        if !apply {
            return; // an IDR is already owed: coalesce the request into it
        }
        if let Some(shared) = self.stream_shared() {
            shared.idr_pending.store(true, Ordering::Relaxed);
            shared.note_idr_request_applied();
            // adaptive-bitrate signal: applied (gate-passed) requests
            shared.idr_applied.fetch_add(1, Ordering::Relaxed);
        }
        eprintln!("control: IDR applied (answered {answered}, coalesced {coalesced})");
    }

    /// Cumulative (answered, coalesced) IDR-gate counters: the control
    /// server's 5s stats print their deltas so the IDR spend of an
    /// episode is visible next to the ENet window it happened in.
    pub fn idr_gate_counts(&self) -> (u64, u64) {
        self.idr_gate.lock().expect("idr gate lock").counts()
    }

    /// Client 0x0301 INVALIDATE_REF_FRAMES: queues the {first, last}
    /// frame pair for the video thread (Sunshine raises the same event
    /// for its capture loop; the encoder-side answer and the IDR
    /// fallback happen where the encoder lives).
    pub fn invalidate_ref_frames(&self, first_frame: i64, last_frame: i64) {
        if let Some(shared) = self.stream_shared() {
            *shared
                .invalidate_ref_frames
                .lock()
                .expect("invalidate lock") = Some((first_frame, last_frame));
        }
    }
}

fn build_audio_pipeline(launch: &LaunchParams) -> Result<Box<dyn crate::audio::AudioPipeline>, String> {
    // Diagnostic override: drive the sender loop from the synthetic 440 Hz
    // source instead of WASAPI capture, the audio counterpart of
    // HYDRA_STREAM_VIDEO_SOURCE=testpattern, so a session that receives no
    // audio can be pinned on the capture side without touching the
    // transport or the client's decoder. The synthetic source always
    // encodes the stereo layout, so a 5.1/7.1 client cannot decode it; it
    // does pace itself at the negotiated packet duration, one frame per
    // interval, so the packet rate is the real one.
    if std::env::var("HYDRA_STREAM_AUDIO_SOURCE").ok().as_deref() == Some("tone") {
        eprintln!(
            "audio: HYDRA_STREAM_AUDIO_SOURCE=tone, synthetic 440Hz source (WASAPI capture bypassed)"
        );
        return Ok(Box::new(crate::audio::SyntheticAudioPipeline::new(
            u32::MAX,
            launch.packet_duration_ms,
        )?));
    }
    // Sunshine selects the Opus stream config from the ANNOUNCE attributes
    // (`rtsp.cpp:1148-1153`): the requested channel count plus the
    // AudioQuality flag. The quality flag falls back to the host-audio rule
    // for a client that never sent one, and `x-nv-audio.surround.enable=0`
    // pins stereo — the encoder and the advertised layout must match, or a
    // 5.1/7.1 client cannot decode anything (see src/audio_encode.rs).
    let layout = crate::audio::select_layout(
        launch.requested_channels,
        launch.audio_quality,
        launch.surround_enabled,
        launch.host_audio,
    );
    eprintln!(
        "audio: pipeline starting, layout {} channels, {} streams, {} coupled, {} kbps ({}ms packets)",
        layout.channel_count,
        layout.streams,
        layout.coupled_streams,
        layout.bitrate_bps / 1000,
        launch.packet_duration_ms
    );
    Ok(Box::new(crate::audio_capture::WasapiAudioPipeline::new(
        layout,
        launch.packet_duration_ms,
    )?))
}

fn build_pipeline(launch: &LaunchParams) -> Result<Box<dyn VideoPipeline>, String> {
    // Diagnostic override: feed the sender loop the synthetic pattern
    // source, bypassing DXGI capture AND NVENC, to isolate sender-side
    // issues from capture/encoder issues on a broken machine.
    if std::env::var("HYDRA_STREAM_VIDEO_SOURCE").ok().as_deref() == Some("testpattern") {
        eprintln!(
            "video: HYDRA_STREAM_VIDEO_SOURCE=testpattern, synthetic source (DXGI capture and NVENC bypassed)"
        );
        return Ok(Box::new(crate::video::SyntheticPipeline::new(
            20_000,
            u32::MAX,
            launch.fps.max(1),
        )));
    }
    let ref_frames = crate::capture::resolve_ref_frames(
        launch
            .max_ref_frames
            .and_then(|count| u32::try_from(count).ok()),
        crate::capture::recovery_capability(),
    );
    let config = EncoderConfigParams {
        // the codec the client's ANNOUNCE negotiated (H.264 unless it asked
        // for HEVC and the startup probe found an HEVC session); it selects
        // the NVENC GUIDs and the codec config block, nothing else
        codec: launch.codec,
        // negotiated client mode from /launch; the pipeline letterbox-fits
        // the desktop into this size (0 = encode at the native desktop
        // resolution)
        width: launch.width,
        height: launch.height,
        fps: launch.fps.max(1),
        bitrate_kbps: launch.bitrate_kbps,
        slices_per_frame: launch.slices_per_frame,
        // DPB depth: the client's x-nv-video[0].maxNumReferenceFrames
        // resolved against the startup probe (0/absent = 5, the probe's
        // accepted depth is the ceiling)
        max_ref_frames: ref_frames,
    };
    Ok(Box::new(NvencPipeline::new(config)?))
}

/// Control protocol message types (16-bit little-endian, verified against
/// Sunshine stream.cpp and moonlight-common-c ControlStream.c; for clients
/// speaking to a 7.1.431 host, common-c encrypts EVERY control message in
/// a 0x0001 AES-GCM wrapper).
pub mod control_messages {
    /// Fully encrypted packet wrapper: {encryptedHeaderType u16LE=1,
    /// length u16LE, seq u32LE, gcm tag 16, ciphertext}.
    pub const ENCRYPTED: u16 = 0x0001;
    pub const START_A: u16 = 0x0305;
    pub const START_B: u16 = 0x0307;
    pub const INVALIDATE_REF_FRAMES: u16 = 0x0301;
    /// i32[0]=loss count, i32[1]=window ms, i32[3]=last good frame.
    pub const LOSS_STATS: u16 = 0x0201;
    pub const INPUT_DATA: u16 = 0x0206;
    /// Termination for Gen7+ clients (legacy GFE clients use 0x0100).
    pub const TERMINATION: u16 = 0x0109;
    pub const TERMINATION_LEGACY: u16 = 0x0100;
    pub const PERIODIC_PING: u16 = 0x0200;
    /// Sent by the client at stream start (it replaces Start A on
    /// encrypted connections) and whenever its decoder needs a refresh.
    pub const REQUEST_IDR_FRAME: u16 = 0x0302;
    /// Gamepad rumble (payload ignored by us).
    pub const RUMBLE: u16 = 0x010b;
    /// HDR mode toggle (payload ignored by us).
    pub const HDR_MODE: u16 = 0x010e;
}

/// Parses and decrypts a fully-encrypted (type 0x0001) control packet:
/// header {encryptedHeaderType u16LE = 1, length u16LE (= seq + tag +
/// ciphertext), seq u32LE}, then the GCM tag and ciphertext. The key is
/// the launch rikey and the IV is Nvidia's legacy 16-byte form
/// ([sequence low byte, 0...]); common-c never enables the V2 12-byte IV
/// with our DESCRIBE. Returns the inner message type and payload.
pub fn decrypt_control_wrapper(key: &[u8; 16], packet: &[u8]) -> Option<(u16, Vec<u8>)> {
    if packet.len() < 8 + 16 + 4 {
        return None;
    }
    let length = u16::from_le_bytes(packet[2..4].try_into().ok()?) as usize;
    let plaintext_len = length.checked_sub(4 + 16)?;
    if packet.len() < 8 + 16 + plaintext_len {
        return None;
    }
    let seq = u32::from_le_bytes(packet[4..8].try_into().ok()?);
    let mut iv = [0u8; 16];
    iv[0] = seq as u8;
    let tag: [u8; 16] = packet[8..24].try_into().ok()?;
    let plaintext =
        crate::crypto::aes128_gcm_decrypt(key, &iv, &tag, &packet[24..24 + plaintext_len]).ok()?;
    if plaintext.len() < 4 {
        return None;
    }
    let inner_type = u16::from_le_bytes(plaintext[..2].try_into().ok()?);
    Some((inner_type, plaintext[4..].to_vec()))
}

fn trace_wrapper_failure(why: &str) {
    static FAILURES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let count = FAILURES.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    if count == 1 || count % 100 == 0 {
        eprintln!("control: encrypted packet dropped ({why}, total {count})");
    }
}

/// Periodic-ping tracing: first ping and every 100th ping (with the last
/// observed interval) so the control channel cadence is visible without
/// flooding stderr. Counter resets on START_A.
static PING_COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static LAST_PING: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);

fn trace_periodic_ping() {
    let count = PING_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
    let mut last = LAST_PING.lock().expect("last ping lock");
    let now = std::time::Instant::now();
    let interval_ms = last.map(|previous| now.duration_since(previous).as_millis());
    *last = Some(now);
    match count {
        1 => eprintln!("control: first periodic ping from client"),
        n if n % 100 == 0 => eprintln!(
            "control: {n} periodic pings (last interval {}ms)",
            interval_ms
                .map(|ms| ms.to_string())
                .unwrap_or_else(|| "?".to_string())
        ),
        _ => {}
    }
}

/// Which `handle_control_payload` entry path produced a dispatch: the
/// common-c 0x0001 AES-GCM envelope, decrypted (the type and body come
/// out of the plaintext), or a bare payload straight off the wire. Only
/// the unknown-type trace reads it, because the body length cannot tell
/// the two apart: `body` is the payload AFTER the type in BOTH paths
/// (envelope header, inner header, then the type), so a 21-byte body is
/// no evidence of a cleartext message — the same 21 bytes arrive from
/// inside an envelope.
#[derive(Clone, Copy)]
enum ControlPath {
    Envelope,
    Cleartext,
}

impl ControlPath {
    fn label(self) -> &'static str {
        match self {
            ControlPath::Envelope => "aes-gcm-envelope",
            ControlPath::Cleartext => "cleartext",
        }
    }
}

/// Handles one in-order control payload from the client. `channel` is the
/// ENet channel it arrived on and rides along for diagnostics only.
pub fn handle_control_payload(
    state: &State,
    payload: &[u8],
    channel: u8,
    input_backend: &mut dyn crate::input::InputBackend,
    input_count: &mut u64,
    raw_input_count: &mut u64,
) {
    if payload.len() < 2 {
        return;
    }
    let message_type = u16::from_le_bytes(payload[..2].try_into().unwrap());
    if message_type == control_messages::ENCRYPTED {
        // Moonlight on a 7.1.431 host wraps every control message in a
        // 0x0001 AES-GCM envelope; unwrap it before dispatch.
        let Some(key) = state.launch_params().map(|launch| launch.rikey) else {
            trace_wrapper_failure("no launch params");
            return;
        };
        let Some((inner_type, inner)) = decrypt_control_wrapper(&key, payload) else {
            trace_wrapper_failure("decrypt failed");
            return;
        };
        dispatch_control(
            state,
            inner_type,
            &inner,
            ControlPath::Envelope,
            channel,
            input_backend,
            input_count,
            raw_input_count,
        );
        return;
    }
    dispatch_control(
        state,
        message_type,
        &payload[2..],
        ControlPath::Cleartext,
        channel,
        input_backend,
        input_count,
        raw_input_count,
    );
}

fn dispatch_control(
    state: &State,
    message_type: u16,
    body: &[u8],
    path: ControlPath,
    channel: u8,
    input_backend: &mut dyn crate::input::InputBackend,
    input_count: &mut u64,
    raw_input_count: &mut u64,
) {
    match message_type {
        control_messages::START_A => {
            PING_COUNT.store(0, Ordering::Relaxed);
            *LAST_PING.lock().expect("last ping lock") = None;
            eprintln!("control: START_A received, waiting for START_B");
        }
        control_messages::START_B => {
            eprintln!("control: START_B received (NVCTL START handshake complete)")
        }
        control_messages::PERIODIC_PING => trace_periodic_ping(),
        control_messages::LOSS_STATS => {
            if body.len() >= 16 {
                let stats: Vec<i32> = body
                    .chunks_exact(4)
                    .take(4)
                    .map(|chunk| i32::from_le_bytes(chunk.try_into().unwrap()))
                    .collect();
                if stats[0] > 0 {
                    // adaptive-bitrate signal: losses observed by the client
                    if let Some(shared) = state.stream_shared() {
                        shared.loss_events.fetch_add(1, Ordering::Relaxed);
                    }
                }
                trace_loss_stats(state, stats[0], stats[1], stats[3]);
            }
        }
        control_messages::REQUEST_IDR_FRAME => {
            state.request_idr();
        }
        control_messages::INVALIDATE_REF_FRAMES => {
            // {firstFrame, lastFrame} as int64[2] (Sunshine
            // stream.cpp:1199-1209). The encoder invalidates the range
            // and marks the next frame after-invalidation (frameType 5);
            // a range it cannot honor falls back to a full IDR — the
            // fallback also covers the malformed payload of a client
            // that does not really speak 0x0301.
            if body.len() >= 16 {
                let first = i64::from_le_bytes(body[0..8].try_into().unwrap());
                let last = i64::from_le_bytes(body[8..16].try_into().unwrap());
                eprintln!("control: reference frame invalidation requested ({first}..{last})");
                state.invalidate_ref_frames(first, last);
            } else {
                eprintln!("control: malformed invalidation payload ({} bytes), requesting full IDR", body.len());
                state.request_idr();
            }
        }
        control_messages::INPUT_DATA => {
            if let Some(note) = crate::input::dispatch(body, &mut *input_backend) {
                eprintln!("{note}");
                *raw_input_count += 1;
            } else {
                *input_count += 1;
            }
        }
        control_messages::TERMINATION | control_messages::TERMINATION_LEGACY => {
            let code = if body.len() >= 4 {
                u32::from_be_bytes(body[..4].try_into().unwrap())
            } else {
                0
            };
            eprintln!("control: client terminated the session (ec={code})");
            state.end_session("client-terminated");
        }
        control_messages::RUMBLE => {
            static LOGGED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
            if !LOGGED.swap(true, std::sync::atomic::Ordering::Relaxed) {
                eprintln!("control: ignoring rumble messages (not supported)");
            }
        }
        control_messages::HDR_MODE => {
            static LOGGED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
            if !LOGGED.swap(true, std::sync::atomic::Ordering::Relaxed) {
                eprintln!("control: ignoring HDR mode messages (not supported)");
            }
        }
        other => trace_unknown(other, body, path, channel),
    }
}

/// Unknown-type occurrences dumped in full (head bytes, entry path,
/// channel) before the trace drops back to the bounded summary line: the
/// first occurrences are the ones that identify the message, and the
/// 0x5502 sighting this was written for arrived ~3/s for a whole session,
/// so a flood must not turn stderr into the firehose.
const UNKNOWN_TRACE_DUMPS: u64 = 3;

/// The cleartext protocol's 4-byte {type, length} header shape: the u16 at
/// `body[0..2]` little-endian equal to the u16 at `body[2..4]` minus 4,
/// i.e. a length field that counts its own header. The unknown-type dump
/// reports it so the next session can tell a bare legacy packet from a
/// payload that only looks unknown because one header too few was
/// stripped off it.
fn looks_like_legacy_header(body: &[u8]) -> bool {
    body.len() >= 4
        && u16::from_le_bytes(body[..2].try_into().unwrap())
            == u16::from_le_bytes(body[2..4].try_into().unwrap()).wrapping_sub(4)
}

/// Traces a control message type `dispatch_control` does not handle.
///
/// The type alone did not identify the message the first version reported
/// (`unknown message type 0x5502 (21 bytes)`): the body length counts the
/// payload AFTER the type in BOTH entry paths, so it can neither confirm
/// nor exclude the AES-GCM envelope — hence the dump of what the payload
/// actually is. `head` is the raw first 32 bytes, `legacy-header` is
/// `looks_like_legacy_header`, and `path`/`channel` say how the payload
/// reached the dispatcher.
fn trace_unknown(message_type: u16, body: &[u8], path: ControlPath, channel: u8) {
    static UNKNOWN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let count = UNKNOWN.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    if count <= UNKNOWN_TRACE_DUMPS {
        let head = &body[..body.len().min(32)];
        let legacy_header = looks_like_legacy_header(body);
        eprintln!(
            "control: unknown message type {message_type:#06x} ({} bytes, total unknown {count}, path={}, channel={channel}, legacy-header={legacy_header}, head={head:02x?})",
            body.len(),
            path.label(),
        );
    } else if count % 100 == 0 {
        eprintln!(
            "control: unknown message type {message_type:#06x} ({} bytes, total unknown {count}, path={}, channel={channel})",
            body.len(),
            path.label(),
        );
    }
}

fn trace_loss_stats(state: &State, lost: i32, window_ms: i32, last_good_frame: i32) {
    static REPORTS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let count = REPORTS.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    if count % 50 != 0 {
        return;
    }
    // approximate loss percentage against the negotiated frame rate
    let expected = state
        .launch_params()
        .map(|launch| launch.fps as i64 * window_ms as i64 / 1000)
        .unwrap_or(0)
        .max(1);
    let pct = (lost as i64 * 100 / expected).clamp(0, 100);
    eprintln!(
        "control: loss stats #{count}: {lost} lost in {window_ms}ms (~{pct}%, last good frame {last_good_frame})"
    );
}

/// Termination message sent to the client when the host ends the session:
/// NVCTL_ENET_PACKET_HEADER_V1 type 0x0109 (LE) + big-endian error code.
pub fn termination_payload(error_code: u32) -> Vec<u8> {
    let mut payload = Vec::with_capacity(6);
    payload.extend_from_slice(&control_messages::TERMINATION.to_le_bytes());
    payload.extend_from_slice(&error_code.to_be_bytes());
    payload
}

/// Termination for encrypted-control clients (appversion >= 7.1.431):
/// the client discards any control packet whose first u16 is not the
/// 0x0001 AES-GCM envelope (ControlStream.c receive path), so the
/// plaintext termination would never be seen. Wraps it in the same
/// envelope as every other host-originated control message: key = rikey,
/// V1 IV = [sequence low byte, 0...] (the client's decrypt path uses
/// iv[0] = seq under V1; 'H'/'C' is the V2 12-byte form).
pub fn encrypted_termination_payload(state: &State, error_code: u32) -> Vec<u8> {
    let Some(launch) = state.launch_params() else {
        return termination_payload(error_code);
    };
    let seq = state
        .control_out_seq
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut iv = [0u8; 16];
    iv[0] = seq as u8;
    let mut plaintext = control_messages::TERMINATION.to_le_bytes().to_vec();
    plaintext.extend_from_slice(&4u16.to_le_bytes()); // inner payload length
    plaintext.extend_from_slice(&error_code.to_be_bytes());
    let Ok((tag, ciphertext)) = crate::crypto::aes128_gcm_encrypt(&launch.rikey, &iv, &plaintext)
    else {
        return termination_payload(error_code);
    };
    let mut envelope = Vec::with_capacity(8 + 16 + ciphertext.len());
    envelope.extend_from_slice(&control_messages::ENCRYPTED.to_le_bytes());
    envelope.extend_from_slice(&((4 + 16 + ciphertext.len()) as u16).to_le_bytes());
    envelope.extend_from_slice(&seq.to_le_bytes());
    envelope.extend_from_slice(&tag);
    envelope.extend_from_slice(&ciphertext);
    envelope
}

/// True while a control connection may be accepted (session pending or
/// streaming), mirroring Sunshine's pending-launch-session model.
pub fn control_acceptable(state: &State) -> bool {
    state.session_phase() != GamePhase::Idle
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Gate tests run on a fixed timeline so the cadence windows are
    /// exact.
    const MS: Duration = Duration::from_millis(1);

    fn test_state() -> State {
        // unique dir per test: the shared per-pid dir let one test's
        // remove_dir_all delete a sibling test's store mid-run
        static DIR_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "hydra-stream-control-test-{}-{}",
            std::process::id(),
            DIR_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::remove_dir_all(&dir).ok();
        let store = crate::store::Store::at(dir).unwrap();
        let (events, _rx) = tokio::sync::mpsc::unbounded_channel();
        State::with_store(store, events).unwrap()
    }

    /// The measured defect: the 2026-09-14 iPad session begged ~15
    /// REQUEST_IDRs/s (1752 over the session, continuously to the end) and
    /// the host answered 951 forced IDRs (~15/s), each ~95KB at
    /// 3440x1936 — ~44% of a 25Mbps stream spent on keyframes against a
    /// client reporting 0% loss, and the picture still froze. The old
    /// gate's escalation rung was 50ms (~20/s at a 50ms request cadence);
    /// the new floor is 200ms, so the same 50ms beggar draws at most 5
    /// IDRs in any second, and 2/s once the backoff lands.
    #[test]
    fn idr_gate_holds_a_50ms_beggar_to_five_idrs_per_second() {
        let t0 = Instant::now();
        let mut gate = IdrRequestGate::new();
        // ten seconds of a client begging every 50ms, as the measured one did
        let mut applies: Vec<Instant> = Vec::new();
        let mut now = t0;
        while now < t0 + 10_000 * MS {
            if gate.note_request(now) {
                applies.push(now);
            }
            now += 50 * MS;
        }
        // no request may ever be answered sooner than the 200ms floor
        for pair in applies.windows(2) {
            let gap = pair[1].duration_since(pair[0]);
            assert!(
                gap >= IDR_THROTTLE_NORMAL,
                "answered {}ms apart, under the {}ms floor",
                gap.as_millis(),
                IDR_THROTTLE_NORMAL.as_millis(),
            );
        }
        // the peak any 1s window may hold is 5; the old 50ms rung would
        // have shown ~20
        let peak = applies
            .iter()
            .map(|at| {
                applies
                    .iter()
                    .filter(|other| **other >= *at && other.duration_since(*at) < Duration::from_secs(1))
                    .count()
            })
            .max()
            .unwrap_or(0);
        assert!(
            peak <= 5,
            "a 1s window answered {peak} IDRs (the floor allows 5)",
        );
        assert!(
            applies.len() <= 26,
            "10s of 50ms begging drew {} IDRs (the old 50ms rung drew ~200)",
            applies.len(),
        );
        assert!(
            applies.len() >= 20,
            "the gate must still answer the begging: {} IDRs in 10s",
            applies.len(),
        );
        eprintln!(
            "idr gate: {} IDRs in 10s of 50ms begging ({:.1}/s overall), peak {peak} in any 1s window",
            applies.len(),
            applies.len() as f64 / 10.0,
        );
    }

    /// The required inversion: a client whose begging survives eight
    /// answered requests is not being fixed by keyframes, so the cadence
    /// must back off. The old ladder did the opposite — it stepped down to
    /// a 50ms rung as the begging continued.
    #[test]
    fn idr_gate_backoff_slows_persistent_begging_instead_of_speeding_it() {
        let t0 = Instant::now();
        let mut gate = IdrRequestGate::new();
        // the first two seconds: the 200ms floor holds a 50ms beggar to ~5/s
        let mut early = 0u32;
        let mut now = t0;
        while now < t0 + 2_000 * MS {
            if gate.note_request(now) {
                early += 1;
            }
            now += 50 * MS;
        }
        // the same begging continues: eight answers were not enough, so
        // the cadence is now the 500ms backoff rung
        assert_eq!(
            gate.cadence(),
            IDR_THROTTLE_BACKOFF,
            "persistent begging must back the cadence off, not tighten it",
        );
        let mut late = 0u32;
        while now < t0 + 6_000 * MS {
            if gate.note_request(now) {
                late += 1;
            }
            now += 50 * MS;
        }
        let early_rate = early as f64 / 2.0;
        let late_rate = late as f64 / 4.0;
        assert!(
            late_rate <= 2.5,
            "the backoff cadence must hold ~2/s, got {late_rate:.1}/s",
        );
        assert!(
            late_rate < early_rate,
            "begging must slow the response, not speed it: {early_rate:.1}/s -> {late_rate:.1}/s",
        );
        eprintln!(
            "idr gate backoff: {early} IDRs in the first 2s ({early_rate:.1}/s) -> {late} in the next 4s ({late_rate:.1}/s)"
        );
    }

    /// A single isolated request must still be answered at once — that is
    /// what lets a client that lost one frame recover from one request.
    /// Only persistent begging slows the response.
    #[test]
    fn idr_gate_single_request_applies_immediately() {
        let t0 = Instant::now();
        let mut gate = IdrRequestGate::new();
        assert!(
            gate.note_request(t0),
            "the first request of a session is answered at once",
        );
        assert_eq!(gate.cadence(), IDR_THROTTLE_NORMAL);
        assert_eq!(gate.counts(), (1, 0));

        // an isolated request far from any episode is a fresh loss: it is
        // answered at once too, and the floor only binds inside the run
        // it starts
        let later = t0 + 10_000 * MS;
        assert!(gate.note_request(later), "a fresh loss answers immediately");
        assert!(!gate.note_request(later + 100 * MS), "the floor holds inside the run");
        assert!(gate.note_request(later + 200 * MS));
    }

    /// Begging that stops returns the gate to the prompt cadence: the
    /// quiet window ends the episode, clears the backoff, and the next
    /// request is answered immediately.
    #[test]
    fn idr_gate_episode_resets_after_begging_stops() {
        let t0 = Instant::now();
        let mut gate = IdrRequestGate::new();
        let mut now = t0;
        while now < t0 + 4_000 * MS {
            gate.note_request(now);
            now += 50 * MS;
        }
        assert_eq!(gate.cadence(), IDR_THROTTLE_BACKOFF, "a long episode backs off");

        // the client stops begging: the next request is a fresh loss and
        // gets the prompt cadence and a clean episode
        let fresh = now + IDR_STARVE_WINDOW;
        assert!(
            gate.note_request(fresh),
            "the first request of a new episode answers immediately",
        );
        assert_eq!(gate.cadence(), IDR_THROTTLE_NORMAL, "the backoff is cleared");
        assert!(!gate.note_request(fresh + 100 * MS), "the floor holds inside the new episode");
        assert!(gate.note_request(fresh + 200 * MS));
    }

    #[test]
    fn idr_gate_reset_clears_backoff_and_history() {
        let t0 = Instant::now();
        let mut gate = IdrRequestGate::new();
        let mut now = t0;
        while now < t0 + 3_000 * MS {
            gate.note_request(now);
            now += 50 * MS;
        }
        assert_eq!(gate.cadence(), IDR_THROTTLE_BACKOFF);
        gate.reset();
        assert_eq!(gate.cadence(), IDR_THROTTLE_NORMAL);
        assert_eq!(gate.counts(), (0, 0));
        assert!(gate.note_request(now), "a reset gate answers at once again");
        assert!(!gate.note_request(now + 100 * MS), "the 200ms floor is back");
        assert!(gate.note_request(now + 200 * MS));
    }

    /// The 5s stats read (answered, coalesced) from the gate: every request
    /// must land in exactly one bucket, so a session where most requests
    /// are coalesced shows the keyframe spend it really made.
    #[test]
    fn idr_gate_counts_answered_and_coalesced() {
        let t0 = Instant::now();
        let mut gate = IdrRequestGate::new();
        let mut requests = 0u64;
        let mut now = t0;
        while now < t0 + 3_000 * MS {
            gate.note_request(now);
            requests += 1;
            now += 50 * MS;
        }
        let (answered, coalesced) = gate.counts();
        assert_eq!(answered + coalesced, requests, "no request may be dropped from the accounting");
        assert!(coalesced > answered, "a 50ms beggar is mostly coalesced: {answered} answered, {coalesced} coalesced");
        assert_eq!(answered as u32, gate.applied_in_episode, "every answer lands in the episode count");
    }

    /// The production entry point, not just the struct: three seconds of a
    /// client begging every 50ms through `State::request_idr` — the
    /// control dispatch's path — must draw at most ~5 IDRs/s. The measured
    /// defect was this exact call answering ~20/s (951 forced IDRs for
    /// 1752 requests), and every request must still land in the gate's
    /// answered+coalesced accounting: nothing is dropped.
    #[test]
    fn request_idr_holds_a_50ms_beggar_through_the_state() {
        let state = test_state();
        let shared = crate::video::StreamShared::new();
        *state.stream.lock().expect("stream lock") = Some(StreamHandle {
            shared: shared.clone(),
        });
        let start = Instant::now();
        let mut requests = 0u64;
        while start.elapsed() < Duration::from_secs(3) {
            state.request_idr();
            requests += 1;
            std::thread::sleep(Duration::from_millis(50));
        }
        let answered = shared.idr_applied.load(Ordering::Relaxed);
        let (gate_answered, coalesced) = state.idr_gate_counts();
        assert_eq!(answered, gate_answered, "the adaptive signal counts every applied request");
        assert_eq!(
            gate_answered + coalesced,
            requests,
            "every request is answered or coalesced, never dropped",
        );
        assert!(
            answered >= 1 && answered <= 13,
            "3s of 50ms begging drew {answered} IDRs (the old 50ms rung drew ~60)",
        );
        assert!(
            shared.idr_pending.load(Ordering::Relaxed),
            "the owed IDR stays armed on every applied request",
        );
        eprintln!(
            "request_idr: {answered} answered + {coalesced} coalesced = {requests} requests in {:.2}s ({:.1} IDRs/s)",
            start.elapsed().as_secs_f64(),
            answered as f64 / start.elapsed().as_secs_f64(),
        );
    }

    #[test]
    fn encrypted_wrapper_roundtrip() {
        let key = [0x42u8; 16];
        // inner: REQUEST_IDR_FRAME with an empty payload
        let inner = [0x02u8, 0x03, 0x00, 0x00];
        let seq = 7u32;
        let mut iv = [0u8; 16];
        iv[0] = seq as u8;
        let (tag, ciphertext) = crate::crypto::aes128_gcm_encrypt(&key, &iv, &inner).unwrap();

        let mut packet = Vec::new();
        packet.extend_from_slice(&0x0001u16.to_le_bytes());
        packet.extend_from_slice(&((4 + 16 + inner.len()) as u16).to_le_bytes());
        packet.extend_from_slice(&seq.to_le_bytes());
        packet.extend_from_slice(&tag);
        packet.extend_from_slice(&ciphertext);

        let (message_type, body) = decrypt_control_wrapper(&key, &packet).expect("unwrap");
        assert_eq!(message_type, control_messages::REQUEST_IDR_FRAME);
        assert!(body.is_empty());

        // a corrupted tag must be rejected
        let mut bad = packet.clone();
        bad[8] ^= 1;
        assert!(decrypt_control_wrapper(&key, &bad).is_none());
    }

    #[test]
    fn idr_request_sets_pending_idr_flag() {
        let state = test_state();
        let shared = crate::video::StreamShared::new();
        *state.stream.lock().expect("stream lock") = Some(StreamHandle {
            shared: shared.clone(),
        });
        let mut backend = crate::input_windows::WindowsInputBackend::new();
        let payload = control_messages::REQUEST_IDR_FRAME.to_le_bytes();
        let mut input_count = 0u64;
        let mut raw_count = 0u64;

        handle_control_payload(&state, &payload, 0, &mut backend, &mut input_count, &mut raw_count);
        assert!(shared
            .idr_pending
            .load(std::sync::atomic::Ordering::Relaxed));
    }

    #[test]
    fn idr_request_stamps_suppression_state() {
        // the video loop's P-frame suppression keys on the shared stamp,
        // so an applied request must publish it; the request's own
        // immediate answer means the first call stamps right away
        let state = test_state();
        let shared = crate::video::StreamShared::new();
        *state.stream.lock().expect("stream lock") = Some(StreamHandle {
            shared: shared.clone(),
        });
        assert_eq!(shared.idr_last_applied_ms.load(Ordering::Relaxed), 0);
        // the stamp is millis since the gate's origin and 0 is its
        // no-request sentinel, so give the clock a millisecond first
        std::thread::sleep(Duration::from_millis(5));

        state.request_idr();
        assert!(
            shared.idr_pending.load(Ordering::Relaxed),
            "an applied request arms the owed IDR"
        );
        assert!(
            shared.idr_last_applied_ms.load(Ordering::Relaxed) > 0,
            "an applied request must stamp idr_last_applied_ms"
        );
        // the second request inside the 200ms floor is coalesced: it must
        // not stamp (it opened no episode of its own) but the owed IDR
        // stays armed for it
        let stamped = shared.idr_last_applied_ms.load(Ordering::Relaxed);
        state.request_idr();
        assert_eq!(
            shared.idr_last_applied_ms.load(Ordering::Relaxed),
            stamped,
            "a coalesced request must not re-stamp the suppression episode"
        );
        assert!(shared.idr_pending.load(Ordering::Relaxed), "the owed IDR survives it");
    }

    #[test]
    fn encrypted_termination_reaches_the_client_parser() {
        // host-originated termination must ride the 0x0001 AES-GCM
        // envelope (plaintext 0x0109 is discarded by encrypted-control
        // clients, ControlStream.c receive path)
        let state = test_state();
        state
            .begin_launch(crate::nvhttp::LaunchParams {
                uniqueid: "tester".to_string(),
                appid: 1,
                width: 1280,
                height: 720,
                fps: 60,
                rikey: [0x42; 16],
                rikeyid: 1,
                encrypted_rtsp: true,
                av_ping_payload: "aabb".to_string(),
                control_connect_data: 1,
                activity: std::time::Instant::now(),
                packet_size: crate::video::DEFAULT_PACKET_SIZE,
                bitrate_kbps: 10_000,
                slices_per_frame: 1,
                max_ref_frames: None,
                host_audio: false,
                packet_duration_ms: crate::audio::DEFAULT_PACKET_DURATION_MS,
                min_required_fec_packets: 0,
                requested_channels: 2,
                audio_quality: None,
                surround_enabled: true,
                video_qos_type: None,
                audio_qos_type: None,
                audio_encryption: false,
                codec: crate::video::VideoCodec::H264,
            })
            .unwrap();

        let envelope = encrypted_termination_payload(&state, 0);
        assert_eq!(
            u16::from_le_bytes(envelope[..2].try_into().unwrap()),
            control_messages::ENCRYPTED
        );
        // the client's decrypt path (decrypt_control_wrapper) must
        // recover the termination message
        let (message_type, body) =
            decrypt_control_wrapper(&[0x42; 16], &envelope).expect("client-side unwrap");
        assert_eq!(message_type, control_messages::TERMINATION);
        assert_eq!(body, 0u32.to_be_bytes());
        // the host seq counter advanced
        assert_eq!(state.control_out_seq.load(std::sync::atomic::Ordering::Relaxed), 1);
    }

    #[test]
    fn encrypted_input_packet_reaches_input_dispatch() {
        // Gen7 clients carry input as INPUT_DATA (0x0206) inside the same
        // 0x0001 AES-GCM envelope as every control message, often as ENet
        // SEND_UNSEQUENCED datagrams. Decrypt and route to input::dispatch.
        let state = test_state();
        // a session must exist so the wrapper can find the rikey
        state
            .begin_launch(crate::nvhttp::LaunchParams {
                uniqueid: "tester".to_string(),
                appid: 1,
                width: 1280,
                height: 720,
                fps: 60,
                rikey: [0x42; 16],
                rikeyid: 1,
                encrypted_rtsp: true,
                av_ping_payload: "aabb".to_string(),
                control_connect_data: 1,
                activity: std::time::Instant::now(),
                packet_size: crate::video::DEFAULT_PACKET_SIZE,
                bitrate_kbps: 10_000,
                slices_per_frame: 1,
                max_ref_frames: None,
                host_audio: false,
                packet_duration_ms: crate::audio::DEFAULT_PACKET_DURATION_MS,
                min_required_fec_packets: 0,
                requested_channels: 2,
                audio_quality: None,
                surround_enabled: true,
                video_qos_type: None,
                audio_qos_type: None,
                audio_encryption: false,
                codec: crate::video::VideoCodec::H264,
            })
            .unwrap();

        // inner plaintext: NVCTL header (type 0x0206 LE, length LE) + an
        // input packet: BE size prefix, magic LE, body (keyboard down)
        let body = [0x00u8, 0x41, 0x00, 0x00, 0x00, 0x00];
        let mut input_packet = Vec::new();
        input_packet.extend_from_slice(&((body.len() + 4) as u32).to_be_bytes());
        input_packet.extend_from_slice(&crate::input::KEY_DOWN_MAGIC.to_le_bytes());
        input_packet.extend_from_slice(&body);
        let mut inner = control_messages::INPUT_DATA.to_le_bytes().to_vec();
        inner.extend_from_slice(&((4 + input_packet.len()) as u16).to_le_bytes());
        inner.extend_from_slice(&input_packet);

        // wrap in the 0x0001 AES-GCM envelope (V1 IV: seq low byte + zeros)
        let seq = 9u32;
        let mut iv = [0u8; 16];
        iv[0] = seq as u8;
        let (tag, ciphertext) = crate::crypto::aes128_gcm_encrypt(&[0x42; 16], &iv, &inner)
            .expect("envelope encrypt");
        let mut envelope = Vec::new();
        envelope.extend_from_slice(&control_messages::ENCRYPTED.to_le_bytes());
        envelope.extend_from_slice(&((4 + 16 + ciphertext.len()) as u16).to_le_bytes());
        envelope.extend_from_slice(&seq.to_le_bytes());
        envelope.extend_from_slice(&tag);
        envelope.extend_from_slice(&ciphertext);

        let mut backend = crate::input_windows::WindowsInputBackend::new();
        let mut input_count = 0u64;
        let mut raw_count = 0u64;
        handle_control_payload(&state, &envelope, 0, &mut backend, &mut input_count, &mut raw_count);
        assert_eq!(input_count, 1, "keyboard event dispatched");
        assert_eq!(raw_count, 0);
    }

    /// The unknown-type dump's shape test: `body[0..2]` little-endian
    /// equal to the u16 at `body[2..4]` minus 4, i.e. the two fields line
    /// up as a {type, length} pair whose length counts its own 4-byte
    /// header (here a type of 0x0002 against a length of 0x0006). The
    /// 0x5502 body the trace was written for does not line up, which is
    /// what `legacy-header=false` on the next session's log says.
    #[test]
    fn unknown_body_legacy_header_shape_is_detected() {
        assert!(looks_like_legacy_header(&[
            0x02, 0x00, 0x06, 0x00, 0xaa, 0xbb
        ]));
        assert!(!looks_like_legacy_header(&[0x02, 0x55, 0x15, 0x00]));
        assert!(!looks_like_legacy_header(&[0x02, 0x55, 0x15]));
    }
}

/// Enlarges the kernel UDP buffers on a media socket. The default ~8KB
/// send buffer would-blocks within milliseconds at 60fps x ~1.4KB
/// packets; a dropped startup IDR then spins the client into an
/// IDR-request flood that never decodes. Best effort: failures are logged
/// and the socket stays usable with default buffers.
pub fn enlarge_udp_buffers(socket: &std::net::UdpSocket, port: u16) {
    use std::os::windows::io::AsRawSocket;
    use windows::Win32::Networking::WinSock::{setsockopt, SOL_SOCKET, SO_RCVBUF, SO_SNDBUF, SOCKET};

    const SEND_BUFFER: i32 = 4 * 1024 * 1024;
    const RECEIVE_BUFFER: i32 = 1024 * 1024;
    unsafe {
        let handle = SOCKET(socket.as_raw_socket() as _);
        for (name, value) in [(SO_SNDBUF, SEND_BUFFER), (SO_RCVBUF, RECEIVE_BUFFER)] {
            let result = setsockopt(handle, SOL_SOCKET, name, Some(&value.to_ne_bytes()));
            if result != 0 {
                eprintln!("media port {port}: setsockopt({name}) failed: {result}");
            }
        }
    }
}
