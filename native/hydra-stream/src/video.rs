//! Video pipeline: H.264 frame sources, the GameStream/NVSP RTP
//! packetizer, and the UDP sender task.
//!
//! The packetizer reproduces Sunshine's wire format exactly (verified
//! against Sunshine `stream.cpp` and moonlight-common-c
//! `VideoDepacketizer.c`):
//!
//! ```text
//! RTP header        12 bytes  0x90, 96, seq(BE), timestamp-90k(BE), ssrc=0
//! reserved           4 bytes  zero (RTP extension padding)
//! NV_VIDEO_PACKET   16 bytes  little-endian, see below
//! chunk             up to packetSize - 16 bytes of frame data
//! ```
//!
//! Frame data is the 8-byte Sunshine short frame header (0x01, latency,
//! frame type, lastPayloadLen) followed by the annex-B H.264 access unit.
//! RTP sequence numbers are continuous across frames and the NV
//! `streamPacketIndex` is the low 24 bits of that stream-wide counter
//! shifted left by 8. With FEC
//! disabled the frame is a single FEC block: `fecInfo` carries the shard
//! index and data-shard count, `multiFecFlags` is 0x10, `multiFecBlocks`
//! is 0. The FEC percentage itself is a per-frame property: the client
//! reads it from every block's first packet's `fecInfo`
//! (`(fecInfo & 0xFF0) >> 4`, RtpVideoQueue.c), so the adaptive
//! controller may raise it frame to frame under congestion without any
//! negotiation.

use std::fs::File;
use std::io;
use std::io::Write;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const VIDEO_PAYLOAD_TYPE: u8 = 96;
pub const RTP_EXTENSION_FLAG: u8 = 0x10;

pub const FLAG_CONTAINS_PIC_DATA: u8 = 0x1;
pub const FLAG_EOF: u8 = 0x2;
pub const FLAG_SOF: u8 = 0x4;

pub const MULTI_FEC_FLAGS: u8 = 0x10;

pub const DEFAULT_PACKET_SIZE: u32 = 1392;

const NV_VIDEO_PACKET_SIZE: u32 = 16;
const SHORT_FRAME_HEADER_SIZE: usize = 8;

/// UDP send-backpressure policy for the RTP sender loops. The sockets are
/// nonblocking, so a burst (WiFi, slow client) fills the kernel send
/// buffer and sends start failing with WouldBlock: the datagram is
/// dropped and the loop keeps running, mirroring Sunshine — sender
/// backpressure must never abort the stream. Failures are counted; the
/// first failure and every 100th are logged.
#[derive(Default)]
pub struct SendGuard {
    label: &'static str,
    pub sent: u64,
    pub wouldblock: u64,
    pub errors: u64,
    logged: u64,
}

impl SendGuard {
    pub fn new(label: &'static str) -> Self {
        SendGuard {
            label,
            ..Self::default()
        }
    }

    /// Records one send attempt. A failed send is a drop, never fatal.
    pub fn record(&mut self, result: &io::Result<usize>) {
        match result {
            Ok(_) => self.sent += 1,
            Err(error) => {
                if error.kind() == io::ErrorKind::WouldBlock {
                    self.wouldblock += 1;
                } else {
                    self.errors += 1;
                }
                self.logged += 1;
                if self.logged == 1 || self.logged % 100 == 0 {
                    eprintln!("{}: send error, dropping datagram: {error} ({})", self.label, self.summary());
                }
            }
        }
    }

    pub fn summary(&self) -> String {
        format!(
            "sent={} wouldblock-drops={} send-errors={}",
            self.sent, self.wouldblock, self.errors
        )
    }
}

/// Sender rate-limit ceiling in bits per second. Sunshine paces every
/// frame at 80% of 1Gbps (`ratecontrol_packets_in_1ms`, stream.cpp:1660);
/// the ceiling only caps the long-run drain rate while the per-batch
/// pacing schedule is what keeps microbursts off the AP queue, so 90%
/// keeps the same sub-2ms frame spreads with headroom: even a 200Mbps IDR
/// (~260 datagrams) drains in ~3.3ms against the ~21ms freshness budget.
pub const RATE_LIMIT_CEILING_BPS: u64 = 900_000_000;

/// Sunshine drains the packet schedule in 1ms quanta (stream.cpp:1660
/// names the counter `ratecontrol_packets_in_1ms`); the due-time math is
/// integer nanoseconds per quantum, exactly like Sunshine's
/// `1ms * sent / packets_in_1ms` (stream.cpp:1774-1776 and 1819-1821).
const RATE_QUANTUM: Duration = Duration::from_millis(1);

/// Per-batch caps mirrored from stream.cpp:1662-1670: batches above 64KB
/// bypass SO_SNDBUF on Windows (they land in interrupt-bound "Other I/O"),
/// and generic segmentation offload caps at 64 packets.
const MAX_BATCH_PACKETS: usize = 64;
const MAX_BATCH_BYTES: usize = 64 * 1024;

/// Packets per 1ms quantum for a datagram size, mirroring Sunshine's
/// integer math (stream.cpp:1660) with `RATE_LIMIT_CEILING_BPS` in place
/// of 80% of 1Gbps. At the Moonlight default shard size (1392 + 16 = 1408
/// bytes) this is 79 packets/ms (~12.7µs/packet); Sunshine's 80%-of-1Gbps
/// computes 71 at the same size.
fn packets_per_quantum(shard_bytes: u32) -> u64 {
    (RATE_LIMIT_CEILING_BPS / 1000 / shard_bytes.max(1) as u64 / 8).max(1)
}

/// Datagrams per unslept batch (stream.cpp:1662-1670).
fn send_batch_size(shard_bytes: u32) -> usize {
    (MAX_BATCH_BYTES / shard_bytes.max(1) as usize).clamp(1, MAX_BATCH_PACKETS)
}

/// Sunshine-style sender rate limiter (stream.cpp:1658-1821).
///
/// Every frame is drained against a fixed-ceiling packet schedule instead
/// of being blasted at the link: datagrams go out in batches of
/// `batch_size()` with no sleep inside a batch, and the sender waits only
/// when the schedule says the next batch is not due yet. The schedule is
/// credit carried across frames: each frame opens at
/// `max(next_frame_start, now)` — leftover credit from a previous frame
/// that finished early delays the next frame's first batch, while a frame
/// that ran long never accrues debt (stream.cpp:1672-1673). The first
/// packet of a frame therefore goes out immediately whenever credit
/// allows, which at supported bitrates (drain ≤ ~3.3ms) is always.
pub struct SendRateLimiter {
    quantum_ns: u64,
    packets_per_quantum: u64,
    batch: usize,
    /// scheduled end of the previous frame: the credit carried across
    /// frames (stream.cpp:1818-1821)
    next_frame_start: Instant,
    frame_start: Instant,
    frame_packets_sent: u64,
}

impl SendRateLimiter {
    pub fn new(shard_bytes: u32, now: Instant) -> Self {
        SendRateLimiter {
            quantum_ns: RATE_QUANTUM.as_nanos() as u64,
            packets_per_quantum: packets_per_quantum(shard_bytes),
            batch: send_batch_size(shard_bytes),
            next_frame_start: now,
            frame_start: now,
            frame_packets_sent: 0,
        }
    }

    pub fn batch_size(&self) -> usize {
        self.batch
    }

    pub fn packets_per_quantum(&self) -> u64 {
        self.packets_per_quantum
    }

    /// Scheduled send time of the `sent`-th packet of the current frame:
    /// `1ms * sent / packets_per_quantum` in integer nanoseconds, the
    /// exact shape of Sunshine's due-time math (stream.cpp:1774-1776).
    fn schedule(&self, sent: u64) -> Duration {
        Duration::from_nanos(self.quantum_ns * sent / self.packets_per_quantum)
    }

    /// Opens a frame at `max(next_frame_start, now)`: the previous frame's
    /// leftover credit delays this frame's first batch, never the other
    /// way around (stream.cpp:1672-1673).
    pub fn begin_frame(&mut self, now: Instant) {
        self.frame_start = if self.next_frame_start > now {
            self.next_frame_start
        } else {
            now
        };
        self.frame_packets_sent = 0;
    }

    /// Waits until the next batch is due, if the schedule demands it. The
    /// wait is at most a few quanta and Windows' `Sleep` granularity is
    /// ~15.6ms, so this spins (see `sleep_until`) rather than sleeping.
    pub fn wait_for_batch(&self) {
        let due = self.frame_start + self.schedule(self.frame_packets_sent);
        if due > Instant::now() {
            sleep_until(due);
        }
    }

    pub fn note_sent(&mut self, count: usize) {
        self.frame_packets_sent += count as u64;
    }

    /// Closes the frame: its scheduled end becomes the next frame's
    /// opening credit (stream.cpp:1818-1821).
    pub fn finish_frame(&mut self) {
        self.next_frame_start = self.frame_start + self.schedule(self.frame_packets_sent);
    }

    /// How long sending `packets` datagrams would take if the frame were
    /// started now, including any wait for leftover credit. The freshness
    /// gate adds this to the frame's age so the pre-send decision accounts
    /// for the pacing drain (a frame that WILL complete within the budget
    /// is never pre-dropped by a post-pacing stale measurement).
    pub fn planned_send_duration(&self, packets: usize, now: Instant) -> Duration {
        let start = if self.next_frame_start > now {
            self.next_frame_start
        } else {
            now
        };
        (start + self.schedule(packets as u64)).saturating_duration_since(now)
    }
}

/// Spin-wait until `deadline`. Batch waits are at most a few 1ms quanta —
/// far below Windows' ~15.6ms Sleep granularity — so a pure spin is both
/// the most accurate (overshoot is microseconds, well under the 0.5ms
/// target) and the cheapest option at these durations.
fn sleep_until(deadline: Instant) {
    let mut iterations = 0u32;
    while Instant::now() < deadline {
        std::hint::spin_loop();
        iterations += 1;
        if iterations % 256 == 0 {
            std::thread::yield_now();
        }
    }
}

/// Where one encoder submission's `capture`→bitstream span went, echoed
/// back with the bitstream so the sender loop can report each stage as its
/// own p50/p95 instead of the single aggregate `acquire→encode`
/// (`FrameLatency::acquire_to_encode`, which is built from the frame's
/// `capture` stamp and the instant the loop got the frame back).
///
/// `scale + submit + encode + reap` partitions that aggregate exactly
/// (`reap` is the residual the sender loop fills in — only it sees the
/// instant `encode_next` returned). Three more sit beside it:
/// `acquire_wait` measures BEFORE the span's start (the span opens when
/// `AcquireNextFrame` returned), `bridge_sync` is a subset of `scale`, and
/// `copy` is a subset of `encode`.
///
/// `encode` is measured from the submission returning to the bitstream
/// being observed at the next poll, so it carries the encoder's own
/// latency PLUS the loop's inter-iteration work and is quantized to the
/// poll cadence (one poll per sender-loop iteration). It is therefore an
/// upper bound on the encoder, not its GPU time: nothing short of polling
/// the completion event harder could separate the two, and that would
/// change the timing this build measures.
#[derive(Clone, Copy, Default)]
pub struct FrameStages {
    /// Blocking `AcquireNextFrame` wait that produced this frame: the time
    /// until a new desktop image was available. Not part of
    /// `acquire→encode`, whose start is stamped when the acquire returned.
    pub acquire_wait: Duration,
    /// Frame held → submission: the scale, plus (cross-adapter path) the
    /// ring's producer/consume round trip reported separately in
    /// `bridge_sync`.
    pub scale: Duration,
    /// The submission call itself (map input + `NvEncEncodePicture`).
    pub submit: Duration,
    /// Submission returned → bitstream observed at the next poll. See the
    /// struct note: an upper bound on the encoder, not its GPU time.
    pub encode: Duration,
    /// Observed → `encode_next` returned the frame. Zero for idle-desktop
    /// duplicates, whose capture stamp is taken at reap.
    pub reap: Duration,
    /// The cross-adapter ring sync inside `scale` (0 without a bridge).
    pub bridge_sync: Duration,
    /// This frame's share of the encoder poll that locked and copied its
    /// bitstream (`LockBitstream` + copy + `UnmapInputResource`), inside
    /// `encode`.
    pub copy: Duration,
}

pub struct EncodedFrame {
    pub data: Vec<u8>,
    pub idr: bool,
    pub capture: Instant,
    /// The first frame encoded after a reference-frame invalidation
    /// request (client 0x0301): the packetizer marks it frameType 5
    /// (Sunshine stream.cpp:1577-1579). IDR frames win the type.
    pub after_ref_invalidation: bool,
    /// See [`FrameStages`]. All zero for a source without a capture side
    /// (the synthetic pipeline) and for an idle-desktop duplicate, whose
    /// `capture` is stamped at reap and therefore has no span to split.
    pub stages: FrameStages,
    /// Idle-desktop duplicate: the desktop delivered no new frame and this
    /// is a re-encode of the previous texture. Counted per window so the
    /// `sent N/s` rate can be read as new frames beside repeats — padding
    /// the wire with repeats is what a sent rate above the desktop's own
    /// present rate looks like.
    pub duplicate: bool,
}

/// Freshness verdict for a captured frame under the frame-age drop
/// policy ("ship realtime freshness, never history").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameAgeDecision {
    /// Within the budget: encode/send normally.
    Fresh,
    /// Beyond the budget: drop it and skip ahead to the newest capture.
    Stale,
}

/// Pure frame-age decision. `age` is how long ago the desktop frame was
/// acquired, `budget` the freshness budget (1.25x the frame interval by
/// default, env-overridable), `forced_idr` whether the frame is an
/// explicitly forced IDR (client-requested, stream-start, or
/// display-recreation refresh — this codebase's encoders never produce
/// a spontaneous IDR: the GOP is infinite).
///
/// Forced IDRs are exempt: they are the client's loss-recovery mechanism
/// and dropping one would starve the decoder — an IDR is always
/// decodable, so one late IDR beats a missing one. Idle-desktop
/// duplicates re-enter with the re-encode instant as their capture time
/// (no real deadline), so they never accumulate age here.
pub fn frame_age_decision(age: Duration, budget: Duration, forced_idr: bool) -> FrameAgeDecision {
    if forced_idr || age <= budget {
        FrameAgeDecision::Fresh
    } else {
        FrameAgeDecision::Stale
    }
}

/// A captured frame's age projected forward to the moment the encoder
/// hands its bitstream over: the age since the acquire plus the pipeline's
/// own acquire→bitstream latency for every frame already inside the
/// encoder (`queued`) and for this one. This is the pre-encode form of the
/// number the post-encode relief valve measures, and it is what the
/// pipeline's pre-encode gate compares against the freshness budget.
///
/// The distinction is the whole defect: a frame that cannot be shipped
/// inside the budget must never be *submitted*, because the encoder
/// immediately uses it as the reference for the frame that follows — and
/// dropping it once its bitstream exists shows the client a P-frame
/// referencing a frame it never received. That is the 2026-09-14 report
/// ("lots of p-frame artifacts"): a 1080p60 session at the 6,220kbps
/// 0.05bpp floor dropped 163 frames this way, every one of them already a
/// reference, and the picture stayed broken until the next keyframe.
///
/// A pipeline that has not measured a latency yet passes the frame
/// interval (the encoder's own cadence is the floor of its latency), so a
/// session's first frames are judged by their age alone. Pure.
pub fn projected_encode_age(age: Duration, queued: usize, encode_latency: Duration) -> Duration {
    age.saturating_add(encode_latency.saturating_mul((queued as u32).saturating_add(1)))
}

/// Hard cap on a P-frame suppression episode, in frame decisions
/// (sender-loop iterations): see `PSuppression`. The loop forces the
/// episode's IDR on the episode's first decision, so an episode that gets
/// its IDR lives one or two decisions; four leaves room for a capture
/// stall or a slow pipelined reap while keeping a starving episode's cost
/// at ~3 frame intervals (~50ms of a 60fps stream) — an order of
/// magnitude under the 1000ms recovery-quiet period, so no interaction
/// can make this cap the exit a livelock spins on.
const MAX_EPISODE_UPDATES: u64 = 4;

/// P-frame suppression while the IDR an applied client request asked for
/// is still unconfirmed.
///
/// An applied client IDR request (the starvation gate let it through)
/// means the client lost its reference and is begging for a keyframe.
/// Until that keyframe exists, the P-frames in flight reference something
/// the client may never have decoded — undecodable, so dropping them
/// before encode and packetize (no FEC/shard work either) costs nothing.
/// An episode therefore opens on an applied request and holds P-frames
/// back while the loop drives the forced IDR it asked for (on the 200ms
/// floor the control-side gate now holds); IDR frames always pass.
///
/// The episode ends as soon as the IDR it was waiting for has been
/// encoded (`note_idr_encoded`). An IDR that exists is decodable, and
/// P-frames that reference it are strictly better than more IDRs — so
/// begging that continues after one was sent may only re-arm IDR requests
/// through idr_pending (the control side's own throttled cadence); it
/// must never keep P-frames off the wire. That is the livelock the
/// 2026-09-14 session hit: an RFI-incapable client begging every ~50ms
/// (which the old gate APPLIED on its 50ms escalated rung) kept the old
/// "suppressed while `applied_age < quiet`" rule permanently true, so
/// the stream ran IDR-only at the gate's cadence for minutes — 6846
/// forced IDRs over 332s, 28.6fps delivered against 60 requested,
/// p-suppressed=16144.
///
/// `quiet` (HYDRA_STREAM_IDR_QUIET_MS) is no longer an exit of its own:
/// it marks the end of a begging wave. Within one wave at most one
/// episode opens — the wave's first request is the only one that can be
/// genuinely unanswered, because once an IDR has been encoded at or after
/// the wave started, every later request in that wave is answered by it
/// (that keyframe was lost, not missing; the IDR cadence and the FEC
/// ladder are the recovery path for it). A wave that goes quiet ends, so
/// a later loss gets its own unconfirmed window.
///
/// Hard cap: an episode lasts at most MAX_EPISODE_UPDATES frame
/// decisions, whether or not its IDR ever leaves the encoder — the
/// suppression premise may not outlive the thing it is waiting for. A
/// capped episode does not reopen until its wave ends (begging stops for
/// `quiet`), otherwise the cap would reset every decision and change
/// nothing.
///
/// Anti-worst-case guard: a begging wave sustained for ~10s warns every
/// 5s. Suppression itself is bounded long before that; the warning is the
/// operator-facing signal that a client has been starving for minutes and
/// that the IDR cadence + FEC ladder are the recovery path.
///
/// IDR-only recovery mode: the sender loop never enters an episode when
/// the pipeline reports reference-frame invalidation support, because the
/// premise above does not hold there (the client resumes at the next
/// frameType-5 recovery frame).
pub struct PSuppression {
    quiet: Duration,
    active: bool,
    /// Start of the continuous begging wave — the current run of applied
    /// requests with no `quiet` gap. Anchors both the "already answered"
    /// rule and the sustained-starvation warning.
    starving_since: Option<Instant>,
    /// Frame decisions since the episode opened (the hard cap).
    episode_updates: u64,
    /// The cap ended an episode in this wave: no further episode until the
    /// wave ends.
    capped: bool,
    /// Forced IDRs encoded since the episode started (drives the ladder).
    idrs_encoded: u64,
    /// Newest IDR to leave the encoder, from any cause — the test for
    /// whether a client request has already been answered.
    last_idr_encoded_at: Option<Instant>,
    last_warning_at: Option<Instant>,
    /// Warnings logged across waves (unit tests read this).
    pub warnings: u64,
}

impl PSuppression {
    pub fn new(quiet: Duration) -> Self {
        PSuppression {
            quiet,
            active: false,
            starving_since: None,
            episode_updates: 0,
            capped: false,
            idrs_encoded: 0,
            last_idr_encoded_at: None,
            last_warning_at: None,
            warnings: 0,
        }
    }

    pub fn active(&self) -> bool {
        self.active
    }

    /// Re-evaluate the episode against the age of the last applied client
    /// IDR request. Logs ON/OFF transitions, a capped episode, and the
    /// sustained-starvation warning. Returns whether suppression is active.
    pub fn update(&mut self, now: Instant, applied_age: Duration) -> bool {
        if applied_age >= self.quiet {
            // Begging stopped: the last forced IDR survived a full quiet
            // period with no follow-up request, so it decoded — the quiet
            // rule's original confirmation. The wave anchor and its cap
            // reset with it, so a later loss still gets its own window.
            self.starving_since = None;
            self.capped = false;
            self.last_warning_at = None;
            if self.active {
                self.active = false;
                self.episode_updates = 0;
                eprintln!("video: P-frame suppression OFF (IDR confirmed)");
            }
            return false;
        }
        let starving_since = *self.starving_since.get_or_insert(now);
        let sustained = now.duration_since(starving_since);
        if sustained >= Duration::from_secs(10)
            && self
                .last_warning_at
                .is_none_or(|at| now.duration_since(at) >= Duration::from_secs(5))
        {
            self.last_warning_at = Some(now);
            self.warnings += 1;
            eprintln!(
                "video: WARNING: client starvation sustained for {}s (P-frame \
                 suppression is capped at {MAX_EPISODE_UPDATES} frame decisions \
                 per episode); IDR cadence + FEC ladder are the recovery path",
                sustained.as_secs()
            );
        }
        if !self.active {
            // An episode opens only for a request nothing has answered yet:
            // the wave has not spent its cap, and no IDR left the encoder at
            // or after the wave started (one that did answered this request).
            let answered = self
                .last_idr_encoded_at
                .is_some_and(|at| at >= starving_since);
            if self.capped || answered {
                return false;
            }
            self.active = true;
            self.episode_updates = 0;
            self.idrs_encoded = 0;
            eprintln!("video: P-frame suppression ON (client starving)");
        }
        if self.idrs_encoded > 0 {
            // The episode's IDR exists: the window it was protecting is
            // over, and P-frames referencing it are decodable. Continued
            // begging is answered by idr_pending, not by suppression.
            self.active = false;
            self.episode_updates = 0;
            eprintln!("video: P-frame suppression OFF (episode IDR sent)");
        } else if self.episode_updates >= MAX_EPISODE_UPDATES {
            // Backstop: the episode never got its IDR (encoder not
            // delivering, capture stalled). Suppression may not outlive the
            // thing it waits for, so it ends here — and this wave opens no
            // further episode until begging stops.
            self.active = false;
            self.episode_updates = 0;
            self.capped = true;
            eprintln!(
                "video: WARNING: P-frame suppression capped after \
                 {MAX_EPISODE_UPDATES} frame decisions with no IDR encoded \
                 (client still starving); P-frames resume"
            );
        } else {
            self.episode_updates += 1;
        }
        self.active
    }

    /// A forced IDR left the encoder (client-requested, stream start,
    /// recreation, periodic hygiene, or suppression-driven). Recorded even
    /// with no episode active: it is what tells a later request in the same
    /// wave that its keyframe is already on the wire.
    pub fn note_idr_encoded(&mut self, now: Instant) {
        self.last_idr_encoded_at = Some(now);
        if self.active {
            self.idrs_encoded += 1;
        }
    }

    /// Whether the episode owes the encoder another forced IDR right
    /// now: the 200ms floor the control-side gate now holds for every
    /// applied request (the control side arms idr_pending on the same
    /// cadence; this self-drive only fills the gaps it leaves). The
    /// episode's first IDR is due immediately, and nothing here may run
    /// faster than the floor — a keyframe retry sooner than the client
    /// can have decoded the last one is pure added load (see
    /// `stream::IDR_THROTTLE_NORMAL`).
    pub fn idr_due(&self, now: Instant) -> bool {
        if !self.active {
            return false;
        }
        if self.idrs_encoded == 0 {
            return true;
        }
        self.last_idr_encoded_at
            .is_some_and(|at| now.duration_since(at) >= crate::stream::IDR_THROTTLE_NORMAL)
    }
}

/// Periodic keyframe cadence: the maximum time between IDRs on the wire.
/// The encoders never emit a spontaneous IDR (the GOP is infinite), so a
/// stream that never requested one would carry the stream-start SPS/PPS
/// forever; this caps the gap with a hygiene IDR at most every `interval`
/// (HYDRA_STREAM_KEYFRAME_INTERVAL_MS; `None` = disabled, the infinite-GOP
/// behavior; the default is mode-dependent — 2000ms without reference-frame
/// invalidation, 5000ms with it, see `config::keyframe_interval_ms`).
///
/// This cadence is a hygiene bound, never the recovery path: a client that
/// lost its reference asks for a keyframe itself (REQUEST_IDR → the
/// starvation gate in `stream::IdrRequestGate`, whose first apply is
/// immediate, then at most one per 200ms, and 2/s once the client's
/// begging has proven that keyframes are not what it is missing), so how
/// quickly recovery happens is decided by the client's request, not by this
/// interval — which is why the IDR-only default had to come down from
/// 500ms: at that cadence the session logged `video: periodic keyframe
/// (interval 500ms)` twice a second, each a 96-103KB keyframe (2-3x the
/// per-frame budget at 15-25Mbps) — the heaviest frames to decode, on top
/// of everything else the decoder was behind on.
///
/// A hygiene IDR is not a starvation signal:
/// the caller only arms idr_pending with it — it never enters P-frame
/// suppression (idr_last_applied_ms), never feeds the adaptive
/// controller's IDR-flood counter (idr_applied), and never counts as an
/// applied client request.
pub struct PeriodicKeyframe {
    interval: Option<Duration>,
    /// Last time the cadence was satisfied: an IDR was encoded (any
    /// cause — client request, suppression ladder, stream start,
    /// recreation, or a periodic one) or a periodic refresh was armed.
    /// The single field is what rate-limits both the trigger and its log
    /// to at most once per interval: an armed IDR that never lands
    /// (capture stall, no peer) cannot re-fire before the interval
    /// elapses either.
    last: Option<Instant>,
}

impl PeriodicKeyframe {
    pub fn new(interval: Option<Duration>, now: Instant) -> Self {
        PeriodicKeyframe {
            interval,
            // anchored at construction so the first periodic IDR is due
            // one interval after stream start, not immediately (frame 1
            // is a forced IDR anyway and re-anchors on encode)
            last: Some(now),
        }
    }

    /// Whether a hygiene IDR is owed: the interval elapsed with no IDR
    /// encoded since. Records the arm, so the next call cannot fire (or
    /// log) again before the interval even if the armed IDR never reaches
    /// the encoder.
    pub fn due(&mut self, now: Instant) -> bool {
        let Some(interval) = self.interval else {
            return false;
        };
        if self.last.is_some_and(|at| now.duration_since(at) < interval) {
            return false;
        }
        self.last = Some(now);
        true
    }

    /// An IDR left the encoder, from any cause: the cadence keys on the
    /// newest IDR regardless of origin, so a P-frame suppression episode
    /// already IDR-ing faster (50/200ms ladder) keeps this trigger silent
    /// — no double-log, and the flag arming is idempotent anyway.
    pub fn note_idr_encoded(&mut self, now: Instant) {
        self.last = Some(now);
    }
}

/// Cumulative counters of the capture side's frame supply, read by the
/// sender loop as totals and reported per window as deltas. They answer
/// the question the `sent N/s` rate alone cannot: whether the wire is
/// carrying new desktop frames or repeats. Every DXGI frame the capture
/// side saw is counted in exactly one of `new_frames`, `pacer_surplus` or
/// `stale_drained` — and since a slot now takes the newest image the
/// duplicator has instead of polling for one early, that sum is the
/// content rate the slots consumed, not the desktop's present rate: DXGI
/// coalesces every update between two acquisitions into the image the
/// next slot takes (see `live_present_rate_probe` for the rate itself).
#[derive(Clone, Copy, Default)]
pub struct FrameSupply {
    /// `acquire ok`: desktop frames acquired that were NEW (a fresh
    /// present, admitted by the pacer) — what the session's 5s line has
    /// always reported as the acquire count.
    pub new_frames: u64,
    /// Acquire calls that timed out. Per call, not per frame: the loop
    /// re-issues the acquire when it still owes an emission.
    pub acquire_timeouts: u64,
    /// Presents the negotiated-fps pacer refused as surplus. Zero by
    /// construction with the held-present path — an early present is held
    /// for its slot, not refused — so `(new + surplus + drained)` is no
    /// longer a lower bound on the desktop's present rate: the present
    /// rate is what `live_present_rate_probe` measures directly.
    pub pacer_surplus: u64,
    /// Times the idle-duplicate path stood down on a due slot: no desktop
    /// frame to re-encode yet (or its texture is still inside the
    /// encoder). A repeat is the last resort, so these are the slots a
    /// repeat could not cover either.
    pub idle_skips: u64,
    /// Frames drained while skipping ahead to the newest texture (the
    /// first half of the pre-encode age gate): real presents that were
    /// already too old to ship.
    pub stale_drained: u64,
}

impl FrameSupply {
    /// Window delta against a previous reading (saturating: a recreation
    /// could in principle reset a counter, and a negative rate is worse
    /// than a wrong one).
    pub fn delta(&self, previous: &FrameSupply) -> FrameSupply {
        FrameSupply {
            new_frames: self.new_frames.saturating_sub(previous.new_frames),
            acquire_timeouts: self.acquire_timeouts.saturating_sub(previous.acquire_timeouts),
            pacer_surplus: self.pacer_surplus.saturating_sub(previous.pacer_surplus),
            idle_skips: self.idle_skips.saturating_sub(previous.idle_skips),
            stale_drained: self.stale_drained.saturating_sub(previous.stale_drained),
        }
    }
}

/// A source of encoded H.264 frames. Implemented by the NVENC pipeline in
/// production and by a synthetic pattern generator in tests.
pub trait VideoPipeline: Send {
    /// Encodes the next frame. `force_idr` requests an instantaneous
    /// decoder refresh. `Ok(None)` means no frame became available yet.
    fn encode_next(&mut self, force_idr: bool) -> Result<Option<EncodedFrame>, String>;

    /// Diagnostic counters (acquire/encode histogram), printed when the
    /// sender loop stops. Empty for pipelines without instrumentation.
    fn counters(&self) -> String {
        String::new()
    }

    /// Frames inside the encoder right now (audit: the low-latency path
    /// must never hold more than ~2). Zero for sources without a queue.
    fn pending_depth(&self) -> usize {
        0
    }

    /// Adaptive bitrate reconfiguration. The default reports "not
    /// supported" so the sender loop falls back to recreating the
    /// pipeline with the new bitrate.
    fn set_bitrate(&mut self, kbps: u32) -> Result<(), String> {
        let _ = kbps;
        Err("pipeline cannot reconfigure bitrate".to_string())
    }

    /// Encode-size reconfiguration, called at most ONCE per session, before
    /// the first frame leaves the host: the sender loop resolves the size
    /// with `adaptive::AdaptiveController::initial_encode_size` and asks the
    /// pipeline for it there. After this returns Ok the session encodes at
    /// the new size — new SPS/PPS and an IDR must reach the client, because
    /// its decoder re-inits only on those — and the size is then fixed for
    /// the session: a mid-stream SPS/PPS change makes an Apple client
    /// (VideoToolbox) tear down and rebuild its decoder, which the host
    /// sees only as an IDR-begging avalanche (see `run_video_loop`). The
    /// default reports "not supported" so a source without a geometry keeps
    /// streaming at the size it has instead of failing the session.
    fn set_encode_size(&mut self, _width: u32, _height: u32) -> Result<(), String> {
        Err("pipeline cannot resize".to_string())
    }

    /// The size this pipeline encodes at right now. The sender loop
    /// feeds it to the adaptive controller every tick — a client that
    /// negotiated `0x0` ("encoder resolves to desktop") carries no
    /// geometry in its launch parameters, and the bits-per-pixel floor
    /// must describe the pixels really on the wire. None for sources
    /// without a capture geometry.
    fn encode_size(&self) -> Option<(u32, u32)> {
        None
    }

    /// The captured desktop size the pipeline scales from (the ceiling
    /// for the adaptive controller's encode size: never encode larger
    /// than the desktop). None for sources without a capture geometry.
    fn source_size(&self) -> Option<(u32, u32)> {
        None
    }

    /// Reference-frame invalidation for a client 0x0301 request. The
    /// default "not supported" makes the sender loop fall back to a
    /// full IDR (Sunshine software encoders answer the same way).
    fn invalidate_ref_frames(&mut self, _first_frame: i64, _last_frame: i64) -> bool {
        false
    }

    /// Whether the encoder behind this pipeline can really invalidate
    /// reference frames. When it can, the client resumes decoding at the
    /// next frameType-5 recovery frame, so the IDR-only recovery policies
    /// (P-frame suppression, the 2000ms hygiene keyframe) are off and only
    /// a long safety keyframe remains. Default false: sources without the
    /// capability keep the IDR-only behavior.
    fn supports_ref_invalidation(&self) -> bool {
        false
    }

    /// Frames actually encoded so far (including idle duplicates);
    /// lets the sender loop report the encode/loop-iteration ratio in
    /// the periodic latency line. Zero for sources without counters.
    fn encoded(&self) -> u64 {
        0
    }

    /// Cumulative frame-supply counters ([`FrameSupply`]): new desktop
    /// frames, acquire timeouts, presents refused as surplus, slots an
    /// idle duplicate stood down on, stale drains. The sender loop reports
    /// the window deltas beside `sent N/s` so a rate carried by repeats
    /// rather than new frames is visible as such. All zero for sources
    /// without a capture side.
    fn supply(&self) -> FrameSupply {
        FrameSupply::default()
    }

    /// The encoder backend and the cross-adapter bridge this session
    /// actually runs, for the one line the sender loop prints at session
    /// start (e.g. `encoder=nvenc, no cross-adapter` or `encoder=amf-cross,
    /// cross-adapter via shared-fence`). "unknown" for sources that cannot
    /// say. Distinct from the pipeline's own short `backend_label` (which
    /// only names the encoder) because the sync the bridge came up with is
    /// what makes a latency number comparable across machines.
    fn session_label(&self) -> String {
        "unknown".to_string()
    }

    /// The duplicated display's refresh rate in Hz, when the capture side
    /// knows it (the mode DXGI reports for the duplicated output). None
    /// when it is unknown — a 30Hz desktop would explain a 30fps stream
    /// without a single pipeline fault, so the number is worth printing.
    fn display_hz(&self) -> Option<u32> {
        None
    }

    /// Whether the last `encode_next` call found its pacing budget
    /// already spent — the frame interval has elapsed since the last
    /// emission and the encoder has not delivered the next frame, so
    /// `encode_next` polled the encoder and the desktop duplicator
    /// without waiting at all. The sender loop's empty-iteration backoff
    /// keys on this (`empty_poll_backoff`): a pipeline that reports a
    /// spent budget while producing no frame is what the 2026-09-14
    /// freeze measured at 2500-7500 polls/s. Default false: sources
    /// without a pacing budget never ask for the backoff.
    fn pacing_budget_spent(&self) -> bool {
        false
    }

    /// The session's freshness budget, installed by the sender loop before
    /// the first frame: the same number the loop's own log quotes, so the
    /// pipeline's pre-encode age gate and the loop's post-encode relief
    /// valve can never disagree about what "too old" means. The pipeline
    /// compares a captured frame's *projected* age against it — see
    /// [`projected_encode_age`] — and skips the submission outright when
    /// the frame is past it, so a frame the client will never be sent is
    /// never used as a reference either. Default: ignore it (the source
    /// has its own policy; the loop's relief valve still catches the
    /// frame after the fact).
    fn set_frame_age_budget(&mut self, _budget: Duration) {}

    /// Captured frames this pipeline skipped at its pre-encode freshness
    /// gate. This is the intended graceful degradation below the
    /// bits-per-pixel floor — the submission is never made, so the
    /// effective frame rate falls to what the encoder can keep up with
    /// while every frame it does encode is one the client is actually
    /// sent — and it is reported beside the loop's post-encode drop count
    /// (which is expected to stay zero: a post-encode drop breaks the
    /// client's reference chain and forces an IDR). Zero for sources
    /// without a gate.
    fn pre_encode_stale_skips(&self) -> u64 {
        0
    }
}

/// Per-frame host-side latency sample: acquire → encode → first shard
/// sent → last shard sent, plus the gap to the previously emitted frame.
struct FrameLatency {
    acquire_to_encode: Duration,
    encode_to_first_send: Duration,
    first_to_last_send: Duration,
    /// Gap from the previous emitted frame's last datagram send to this
    /// frame's — the frame-completion cadence the client's own
    /// arrival-timing counter reads. `None` for the session's first sent
    /// frame (nothing to measure against).
    ///
    /// A 5-second average cannot tell a smooth 60/s from 60 frames
    /// delivered in clumps with starving gaps between them, and the
    /// 2026-09-14 iPad session logged `sent 60/s of 60` on every window
    /// while the client's counter swung 30, 45, 15, 1, 30 and then froze
    /// at 39. Nothing in the emission path holds frames apart — the pacer
    /// gates submissions at the acquire boundary, while a frame leaves as
    /// soon as the loop observes its completed bitstream
    /// (capture.rs `NvencPipeline::encode_next` returns the reaped frame
    /// before touching capture) — so this distribution, and its max in
    /// particular, is the measurement that separates the two.
    send_gap: Option<Duration>,
    /// Where `acquire_to_encode` went, as the pipeline measured it (see
    /// [`FrameStages`]). The pipeline's `reap` stage is filled in here,
    /// where the instant `encode_next` returned is known, so the four
    /// stages sum to `acquire_to_encode` exactly.
    stages: FrameStages,
    /// Idle-desktop duplicate (re-encoded previous texture): its `capture`
    /// stamp is taken at reap, so it carries no honest stage split and is
    /// counted instead of sampled.
    duplicate: bool,
}

fn percentile(sorted: &[Duration], pct: f64) -> Duration {
    if sorted.is_empty() {
        return Duration::ZERO;
    }
    let index = ((sorted.len().saturating_sub(1)) as f64 * pct).round() as usize;
    sorted[index.min(sorted.len() - 1)]
}

fn ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}

/// p50/p95 of a sorted sample set, as the window line renders them.
fn pair(sorted: &[Duration]) -> String {
    format!(
        "{:.1}/{:.1}ms",
        ms(percentile(sorted, 0.50)),
        ms(percentile(sorted, 0.95))
    )
}

/// Logs p50/p95/p99 for every stage plus end-to-end (plus the adaptive
/// bitrate currently in effect, both frame-age counters — submissions the
/// pre-encode gate skipped (`stale-skipped`: the intended degradation,
/// expected to rise below the bits-per-pixel floor) and frames the
/// post-encode relief valve had to drop (`dropped-after-encode`: expected
/// to stay zero, since such a drop breaks the client's reference chain and
/// forces an IDR) — the
/// encode/loop-iteration ratio that exposes cadence misfires, the
/// loop-period percentiles that expose stalls between iterations, and the
/// frame-to-frame send-gap percentiles that expose a burst), then clears
/// the window.
///
/// `span` is the wall time the window covers (since the last report), so
/// the one clause that matters for the sent-frame invariant can be read
/// at a glance: `sent N/s of <negotiated fps>`. This is the measurement
/// that found the bug in the first place — a 60fps client receiving
/// 95-103 frames/s, computed only by cross-checking the 1s "built N
/// packets" line against the forced-IDR frameIndex — so the number the
/// client is actually billed for now rides every 5s line. It counts the
/// frames in this window (`window.len()`), not the pipeline's encodes:
/// frames the pipeline padded as duplicates count, and frames the sender
/// dropped before the wire (stale, suppressed) do not, which is exactly
/// the frame_index cadence the client sees.
///
/// The send-gap clause is the same idea at frame granularity: `sent N/s`
/// is an average over the whole window, which 60 frames delivered as
/// thirty tight pairs with a starving gap between each pair also
/// satisfies. Each sample carries the gap measured at its own send (so a
/// window boundary does not lose the pair), the p50 is the cadence and
/// the max is the starvation.
///
/// The last two clauses are the frame-supply question and the
/// acquire→encode split (both added for the missed-frame-rate
/// investigation):
///
/// * `n=, new=, dup=` splits the window's SENT frames into those that
///   carried a new desktop frame and idle-desktop repeats; the stage split
///   beside `acquire→encode` is computed over the new ones only (a
///   repeat's capture stamp is taken at reap, so it has no span to split),
///   and the four stages partition that aggregate exactly: `scale` (frame
///   held → submission, including the cross-adapter ring trip reported
///   separately as `bridge-sync`), `submit` (the submission call itself),
///   `encode` (submission → bitstream observed, an upper bound on the
///   encoder: the poll cadence and the loop's own inter-iteration work sit
///   inside it), and `reap` (observed → this loop got the frame). `copy`
///   is the bitstream lock + copy + unmap share inside `encode`, and
///   `acq-wait` is the blocking acquire that produced the frame, which
///   precedes the aggregate's start and is therefore NOT part of it.
/// * `supply` are the capture side's counters as window deltas — new
///   desktop frames, presents the pacer refused as surplus, stale drains,
///   acquire timeouts, present-grace skips — and `desktop≈N/s` is the
///   present rate they account for, a lower bound on the compositor's real
///   rate because DXGI coalesces updates between acquires.
fn report_latencies(
    window: &mut Vec<FrameLatency>,
    when: &str,
    span: Duration,
    target_fps: u32,
    bitrate_kbps: u32,
    stale_skipped: u64,
    supply: &FrameSupply,
    stale_dropped: u64,
    p_suppressed: u64,
    encoded_delta: u64,
    iteration_delta: u64,
    loop_periods: &mut Vec<Duration>,
) {
    if window.is_empty() && loop_periods.is_empty() {
        return;
    }
    let mut stage: Vec<Vec<Duration>> = vec![
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
    ];
    // Stage split of the same acquire→encode span, over the frames that
    // carried a real desktop capture only: an idle duplicate's capture
    // stamp is taken at reap (it has no honest span), so pooling the two
    // populations would describe neither. `new + dup == n` always.
    let mut split: Vec<Vec<Duration>> = vec![Vec::new(); 7];
    let mut new_frames = 0usize;
    let mut duplicates = 0usize;
    for sample in window.iter() {
        stage[0].push(sample.acquire_to_encode);
        stage[1].push(sample.encode_to_first_send);
        stage[2].push(sample.first_to_last_send);
        stage[3].push(
            sample.acquire_to_encode + sample.encode_to_first_send + sample.first_to_last_send,
        );
        if let Some(gap) = sample.send_gap {
            stage[4].push(gap);
        }
        if sample.duplicate {
            duplicates += 1;
        } else {
            new_frames += 1;
            split[0].push(sample.stages.acquire_wait);
            split[1].push(sample.stages.scale);
            split[2].push(sample.stages.submit);
            split[3].push(sample.stages.encode);
            split[4].push(sample.stages.reap);
            split[5].push(sample.stages.copy);
            if sample.stages.bridge_sync > Duration::ZERO {
                split[6].push(sample.stages.bridge_sync);
            }
        }
    }
    for values in stage.iter_mut().chain(split.iter_mut()) {
        values.sort();
    }
    let mut loop_periods_sorted = std::mem::take(loop_periods);
    loop_periods_sorted.sort();
    let loop_period = if loop_periods_sorted.is_empty() {
        String::new()
    } else {
        format!(
            " | loop-period p50={:.1}ms p95={:.1}ms",
            ms(percentile(&loop_periods_sorted, 0.50)),
            ms(percentile(&loop_periods_sorted, 0.95)),
        )
    };
    // Sent frame rate: only over a window long enough to mean anything
    // (a report flushed by the 300-sample bound, or a stop right after a
    // flush, can cover a few milliseconds).
    let sent_clause = if window.is_empty() || span < Duration::from_secs(1) {
        String::new()
    } else {
        format!(
            " | sent {:.0}/s of {target_fps}",
            window.len() as f64 / span.as_secs_f64()
        )
    };
    // The box that explains what the capture side was doing instead: the
    // supply counters as window deltas, beside a sent rate that can be
    // carried by repeats. `desktop≈N/s` is the content rate those counters
    // account for — new + refused surplus + stale drains. It is NOT the
    // compositor's present rate: a slot takes the newest image the
    // duplicator has, so DXGI coalesces every update between two slots into
    // it (`live_present_rate_probe` measures the rate itself). Printed
    // whenever the window spans real time, even with no frames sent (a
    // starved window is exactly when it matters).
    let supply_clause = if span < Duration::from_secs(1) {
        String::new()
    } else {
        format!(
            " | supply new={} surplus={} drained={} acq-timeouts={} idle-skips={} | desktop≈{:.0}/s (proxy: new+surplus+drained)",
            supply.new_frames,
            supply.pacer_surplus,
            supply.stale_drained,
            supply.acquire_timeouts,
            supply.idle_skips,
            (supply.new_frames + supply.pacer_surplus + supply.stale_drained) as f64
                / span.as_secs_f64(),
        )
    };
    // The acquire→encode split, on the frames that had a capture to split:
    // the four stages partition the aggregate (the pipeline measured the
    // first three, `reap` is the residual the loop fills in), and the two
    // beside them are subsets — `bridge-sync`, printed only when the
    // cross-adapter ring was in use, sits inside `scale`, and `copy` (the
    // bitstream lock + copy + unmap share of the encoder poll) sits inside
    // `encode`. `acq-wait` is the blocking acquire that produced the frame;
    // it precedes the aggregate's start and is not part of it.
    let split_clause = if new_frames == 0 {
        String::new()
    } else {
        let bridge = if split[6].is_empty() {
            String::new()
        } else {
            format!(" bridge-sync {}", pair(&split[6]))
        };
        format!(
            " | stages p50/p95 over {new_frames} new: acq-wait {} scale {} submit {} encode {} reap {} copy {}{bridge}",
            pair(&split[0]),
            pair(&split[1]),
            pair(&split[2]),
            pair(&split[3]),
            pair(&split[4]),
            pair(&split[5]),
        )
    };
    eprintln!(
        "video: latency {when} (n={}, new={new_frames}, dup={duplicates}): acquire→encode p50={:.1}ms p95={:.1}ms{split_clause} | \
         encode→first-send p50={:.1}ms p95={:.1}ms | first→last-send p50={:.1}ms p95={:.1}ms | \
         e2e p50={:.1}ms p95={:.1}ms p99={:.1}ms{sent_clause} | \
         send-gap p50={:.1}ms p95={:.1}ms max={:.1}ms | bitrate {bitrate_kbps}kbps | \
         stale-skipped={stale_skipped} | dropped-after-encode={stale_dropped} | \
         p-suppressed={p_suppressed} | \
         encoded {encoded_delta}/{iteration_delta} loop iterations{loop_period}{supply_clause}",
        window.len(),
        ms(percentile(&stage[0], 0.50)),
        ms(percentile(&stage[0], 0.95)),
        ms(percentile(&stage[1], 0.50)),
        ms(percentile(&stage[1], 0.95)),
        ms(percentile(&stage[2], 0.50)),
        ms(percentile(&stage[2], 0.95)),
        ms(percentile(&stage[3], 0.50)),
        ms(percentile(&stage[3], 0.95)),
        ms(percentile(&stage[3], 0.99)),
        // p50/p95/max of the frame-to-frame send gap (`max` is the
        // percentile-1.0 endpoint of the sorted window: the figure that
        // separates a smooth 60/s from a burst whose average is 60/s)
        ms(percentile(&stage[4], 0.50)),
        ms(percentile(&stage[4], 0.95)),
        ms(percentile(&stage[4], 1.0)),
    );
    window.clear();
}

/// Splits encoded frames into NVSP datagrams, optionally protected by
/// Reed-Solomon FEC blocks byte-compatible with Sunshine/nanors. Pure:
/// no sockets, no GPU.
///
/// FEC wire format (verified against moonlight-common-c RtpVideoQueue.c):
/// the client reads the FEC percentage from every packet's fecInfo field
/// (`(fecInfo & 0xFF0) >> 4`) — no SDP negotiation exists. Per frame, the
/// data shards are split into up to 4 blocks (larger frames disable FEC);
/// each block emits its data shards then its parity shards with
/// contiguous RTP sequence numbers. RS runs over the FULL zero-padded
/// datagrams (RTP+NV headers included, shard size packetSize + 16); the
/// parity shard's display headers (RTP flags/seq/timestamp, fecInfo) are
/// patched after encoding exactly like Sunshine — per-byte independence
/// of RS keeps recovery intact at every other position.
///
/// The client's `x-nv-vqos[0].fec.minRequiredFecPackets` raises a block's
/// parity count above the percentage-derived one (Sunshine
/// stream.cpp:852-859) and the block then reports the adjusted percentage,
/// because the client sizes a block from the fecInfo percentage of its
/// first packet (RtpVideoQueue.c).
pub struct VideoPacketizer {
    /// `x-nv-video[0].packetSize` from the client's ANNOUNCE (Moonlight
    /// default 1392). The NV header is 16 bytes inside the datagram.
    packet_size: u32,
    /// `x-nv-vqos[0].fec.minRequiredFecPackets` from the client's ANNOUNCE:
    /// the minimum recovery packets every FEC block must carry (0 = none).
    min_required_parity: usize,
    /// One-shot: the minimum-raise diagnostic is emitted on the first block
    /// the minimum actually changes, not per frame (this runs at 60fps).
    min_parity_raised_logged: bool,
    /// Continuous packet sequence number across the whole stream. Only the
    /// low 16 bits go on the RTP header; the NV `streamPacketIndex` field
    /// must stay wide because the client masks it to 24 bits
    /// (VideoDepacketizer.c: `streamPacketIndex >>= 8; &= 0xFFFFFF`) and
    /// compares consecutive packets in that space
    /// (`isBefore24(streamPacketIndex, U24(lastPacketInStream + 1))`):
    /// a counter that wraps at 65536 reads as a corrupt frame forever.
    next_sequence: u32,
}

/// RTP header + extension padding before the NV header; the client's FEC
/// receive size is packetSize + MAX_RTP_HEADER_SIZE (16).
const MAX_RTP_HEADER_SIZE: u32 = 16;

impl VideoPacketizer {
    pub fn new(packet_size: u32, min_required_parity: u32) -> Self {
        VideoPacketizer {
            packet_size: packet_size.max(NV_VIDEO_PACKET_SIZE + SHORT_FRAME_HEADER_SIZE as u32),
            min_required_parity: min_required_parity as usize,
            min_parity_raised_logged: false,
            next_sequence: 0,
        }
    }

    pub fn sequence(&self) -> u32 {
        self.next_sequence
    }

    pub fn shard_size(&self) -> u32 {
        self.packet_size + MAX_RTP_HEADER_SIZE
    }

    /// fecInfo layout per RtpVideoQueue.c: percentage at bits 4-11,
    /// shard index within block at bits 12-21, data shard count at
    /// bits 22-31. Fields masked to their wire widths so oversized
    /// no-FEC frames (up to 4096 shards) can never overflow the u32.
    fn fec_info(shard_index: u32, data_shards: u32, percentage: u32) -> u32 {
        ((shard_index & 0x3FF) << 12)
            | ((data_shards & 0x3FF) << 22)
            | ((percentage & 0xFF) << 4)
    }

    /// One FEC block's parity decision (Sunshine stream.cpp:852-859): the
    /// percentage-derived count `(data_shards * percentage + 99) / 100`,
    /// raised to the client's `minRequiredFecPackets` when it falls short
    /// — and then the block reports `(100 * parity_shards) / data_shards`
    /// instead of the layout's percentage. Returns the parity count to
    /// emit and the percentage to put on every shard of the block: the
    /// client derives both the block size and the parity count from that
    /// percentage (RtpVideoQueue.c `bufferParityPackets`), so the adjusted
    /// value must ride the wire, and the count returned is exactly the one
    /// `crate::fec::encode` produces from it.
    ///
    /// The adjusted percentage stays a fixed-point view of the minimum:
    /// when it cannot reproduce the minimum (Sunshine's integer division
    /// loses the remainder) the block simply carries what the client too
    /// computes from that percentage, never more than what it expects.
    fn block_fec(data_shards: usize, percentage: u32, min_required: usize) -> (usize, u32) {
        let parity = (data_shards * percentage as usize + 99) / 100;
        if percentage != 0 && parity < min_required {
            let adjusted = (100 * min_required) / data_shards;
            ((data_shards * adjusted as usize + 99) / 100, adjusted as u32)
        } else {
            (parity, percentage)
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn write_shard_header(
        &self,
        shard: &mut [u8],
        sequence: u32,
        frame_index: u32,
        timestamp_90k: u32,
        flags: u8,
        multi_fec_blocks: u8,
        fec_info: u32,
    ) {
        shard[0] = 0x80 | RTP_EXTENSION_FLAG;
        shard[1] = VIDEO_PAYLOAD_TYPE;
        // RTP sequence: 16-bit, wraps on its own
        shard[2..4].copy_from_slice(&((sequence & 0xFFFF) as u16).to_be_bytes());
        shard[4..8].copy_from_slice(&timestamp_90k.to_be_bytes());
        // ssrc (8..12) and extension padding (12..16) stay zero
        let nv = &mut shard[16..32];
        // NV streamPacketIndex: the low 24 bits of the stream-wide packet
        // counter shifted left by 8 (Sunshine stream.cpp:1686).
        nv[0..4].copy_from_slice(&((sequence & 0x00FF_FFFF) << 8).to_le_bytes());
        nv[4..8].copy_from_slice(&frame_index.to_le_bytes());
        nv[8] = flags;
        nv[9] = 0; // extraFlags
        nv[10] = MULTI_FEC_FLAGS;
        nv[11] = multi_fec_blocks;
        nv[12..16].copy_from_slice(&fec_info.to_le_bytes());
    }

    /// Packetizes one encoded frame. `frame_index` is the client's frame
    /// counter; `timestamp_90k` the 90 kHz presentation timestamp;
    /// `fec_percentage` the frame's own FEC percentage (0 = legacy
    /// no-FEC layout) — the client reads it per block from fecInfo
    /// (RtpVideoQueue.c), so it may differ frame to frame.
    pub fn packetize(
        &mut self,
        frame_index: u32,
        encoded: &[u8],
        idr: bool,
        timestamp_90k: u32,
        fec_percentage: u32,
        after_ref_invalidation: bool,
    ) -> Vec<Vec<u8>> {
        // Sunshine: payload per datagram is packetSize - sizeof(NV_VIDEO_PACKET)
        let payload_block = self.packet_size - NV_VIDEO_PACKET_SIZE;
        let last_payload_len = ((encoded.len() + SHORT_FRAME_HEADER_SIZE) as u32) % payload_block;
        let last_payload_len = if last_payload_len == 0 {
            payload_block
        } else {
            last_payload_len
        };

        // Sunshine video_short_frame_header_t
        let mut frame_data = Vec::with_capacity(encoded.len() + SHORT_FRAME_HEADER_SIZE);
        frame_data.push(0x01); // short header type
        frame_data.extend_from_slice(&0u16.to_le_bytes()); // frame processing latency (1/10 ms)
        // frameType: 2 = IDR, 5 = first frame after a reference-frame
        // invalidation, 1 = normal (Sunshine stream.cpp:1577-1579)
        frame_data.push(if idr {
            2
        } else if after_ref_invalidation {
            5
        } else {
            1
        });
        frame_data.extend_from_slice(&(last_payload_len as u16).to_le_bytes());
        frame_data.extend_from_slice(&[0; 2]); // reserved
        frame_data.extend_from_slice(encoded);

        let chunks: Vec<&[u8]> = frame_data.chunks(payload_block as usize).collect();
        let shard_size = self.shard_size() as usize;
        let mut layout = crate::fec::frame_layout(chunks.len(), shard_size, fec_percentage);
        let mut ranges = crate::fec::block_ranges(chunks.len(), &layout);
        // The client's parity minimum is applied block by block AFTER the
        // layout, so a frame the layout calls fine can still be
        // unrepresentable on the wire once raised: more than SHARDS_MAX
        // (255) shards in a block, or a percentage wider than fecInfo's
        // 8-bit field. Such a frame is laid out with FEC off, exactly like
        // a frame that is too large to split (fec::frame_layout) — never
        // an invalid block, never a dropped one.
        let layable = layout.percentage == 0
            || ranges.iter().all(|(_, count)| {
                let (parity, percentage) =
                    Self::block_fec(*count, layout.percentage, self.min_required_parity);
                count + parity <= crate::fec::SHARDS_MAX && percentage <= u8::MAX as u32
            });
        if !layable {
            eprintln!(
                "video: frame of {} shards cannot carry the client's minimum of {} parity shards, disabling FEC",
                chunks.len(),
                self.min_required_parity
            );
            layout = crate::fec::frame_layout(chunks.len(), shard_size, 0);
            ranges = crate::fec::block_ranges(chunks.len(), &layout);
        }

        let mut out: Vec<Vec<u8>> = Vec::new();
        let mut base = self.next_sequence;
        for (block_index, (start, count)) in ranges.iter().enumerate() {
            let data_shards = *count;
            if data_shards == 0 {
                continue;
            }
            let (parity_shards, percentage) =
                Self::block_fec(data_shards, layout.percentage, self.min_required_parity);
            if percentage != layout.percentage && !self.min_parity_raised_logged {
                self.min_parity_raised_logged = true;
                eprintln!(
                    "video: raising FEC to the client's {}-parity minimum on a {}-shard block: {}% -> {}%",
                    self.min_required_parity, data_shards, layout.percentage, percentage
                );
            }
            let multi_fec_blocks = if percentage > 0 {
                ((block_index as u8) << 4) | (((layout.blocks as u8) - 1) << 6)
            } else {
                0
            };

            // data shards: full zero-padded datagrams with final headers
            let mut data: Vec<Vec<u8>> = Vec::with_capacity(data_shards);
            for (local, chunk) in chunks[*start..*start + data_shards].iter().enumerate() {
                let mut shard = vec![0u8; shard_size];
                let flags = FLAG_CONTAINS_PIC_DATA
                    | if local == 0 { FLAG_SOF } else { 0 }
                    | if local == data_shards - 1 { FLAG_EOF } else { 0 };
                self.write_shard_header(
                    &mut shard,
                    base.wrapping_add(local as u32),
                    frame_index,
                    timestamp_90k,
                    flags,
                    multi_fec_blocks,
                    Self::fec_info(local as u32, data_shards as u32, percentage),
                );
                shard[32..32 + chunk.len()].copy_from_slice(chunk);
                data.push(shard);
            }
            out.extend(data.iter().cloned());

            if parity_shards > 0 {
                let mut parity =
                    crate::fec::encode(&data, percentage).expect("eligible FEC block");
                for (j, shard) in parity.iter_mut().enumerate() {
                    // Display fields patched after RS exactly like
                    // Sunshine (stream.cpp:1736-1746): the client reads
                    // frameIndex/multiFecBlocks from parity packets too,
                    // and RS-garbage values there would purge the FEC
                    // block (RtpVideoQueue.c). Recovery at these
                    // positions is overwritten or ignored by the client.
                    let sequence = base
                        .wrapping_add(data_shards as u32)
                        .wrapping_add(j as u32);
                    shard[0] = 0x80 | RTP_EXTENSION_FLAG;
                    shard[2..4]
                        .copy_from_slice(&((sequence & 0xFFFF) as u16).to_be_bytes());
                    shard[4..8].copy_from_slice(&timestamp_90k.to_be_bytes());
                    shard[20..24].copy_from_slice(&frame_index.to_le_bytes());
                    shard[27] = multi_fec_blocks;
                    shard[28..32].copy_from_slice(
                        &Self::fec_info(
                            data_shards as u32 + j as u32,
                            data_shards as u32,
                            percentage,
                        )
                        .to_le_bytes(),
                    );
                }
                out.extend(parity);
            }

            base = base.wrapping_add((data_shards + parity_shards) as u32);
        }
        self.next_sequence = base;
        out
    }
}

/// True when an annex-B H.264 stream carries a NAL unit whose header byte
/// has the low-5-bit type `nal_type` (7 = SPS, 8 = PPS, 5 = IDR slice).
/// Same start-code scan as `capture::sps_info`.
pub fn annexb_has_nal_type(data: &[u8], nal_type: u8) -> bool {
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
        if header_at < data.len() && data[header_at] & 0x1F == nal_type {
            return true;
        }
        index += start_len;
    }
    false
}

/// Shared streaming state between the RTSP/control/video tasks.
pub struct StreamShared {
    pub stop: AtomicBool,
    pub idr_pending: AtomicBool,
    /// Adaptive-bitrate signals, fed from the control thread and read
    /// once per second by the video loop: applied (gate-passed) IDR
    /// requests and LOSS_STATS events carrying losses.
    pub idr_applied: std::sync::atomic::AtomicU64,
    /// Millis since `origin` of the last APPLIED client IDR request.
    /// 0 (the sentinel) means none this session: the video loop then
    /// treats the recovery-quiet age as infinite and never suppresses,
    /// so a normal stream with no begging flows P-frames from the first
    /// frame on. The control thread stamps it in `request_idr` when the
    /// starvation gate lets a request through; the video loop's P-frame
    /// suppression reads it as a begging wave — a run of applied requests
    /// never quiet for HYDRA_STREAM_IDR_QUIET_MS (see `PSuppression`).
    pub idr_last_applied_ms: std::sync::atomic::AtomicU64,
    /// Clock origin for `idr_last_applied_ms`: one monotonic clock
    /// shared by the control and video threads.
    pub origin: Instant,
    pub loss_events: std::sync::atomic::AtomicU64,
    /// Raw ENet wire deltas from the control thread's 5s stats windows:
    /// duplicate reliables received (client retransmits), reliables
    /// dropped outside the receive window, and reliables received. The
    /// control thread fetch_adds each window's deltas; the video loop
    /// swaps them to zero once per second and feeds the accumulated
    /// deltas to the controller, which windows them into its own 5-tick
    /// evaluation and applies `adaptive::enet_window_congested` there —
    /// the verdict lives in exactly one place, on window-aligned totals.
    pub enet_dup: std::sync::atomic::AtomicU64,
    pub enet_window_drops: std::sync::atomic::AtomicU64,
    pub enet_received: std::sync::atomic::AtomicU64,
    /// Client video endpoint, learned from the ping datagrams Moonlight
    /// sends to the video port before expecting data.
    pub video_peer: std::sync::Mutex<Option<std::net::SocketAddr>>,
    /// Client audio endpoint, learned the same way on the audio port.
    pub audio_peer: std::sync::Mutex<Option<std::net::SocketAddr>>,
    /// Client 0x0301 reference-frame invalidation {first, last} pair,
    /// queued by the control thread and taken by the video loop before
    /// each encode (the encoder answers; a range it cannot honor falls
    /// back to a full IDR there).
    pub invalidate_ref_frames: std::sync::Mutex<Option<(i64, i64)>>,
}

impl StreamShared {
    pub fn new() -> Arc<StreamShared> {
        Arc::new(StreamShared {
            stop: AtomicBool::new(false),
            idr_pending: AtomicBool::new(false),
            idr_applied: std::sync::atomic::AtomicU64::new(0),
            idr_last_applied_ms: std::sync::atomic::AtomicU64::new(0),
            origin: Instant::now(),
            loss_events: std::sync::atomic::AtomicU64::new(0),
            enet_dup: std::sync::atomic::AtomicU64::new(0),
            enet_window_drops: std::sync::atomic::AtomicU64::new(0),
            enet_received: std::sync::atomic::AtomicU64::new(0),
            video_peer: std::sync::Mutex::new(None),
            audio_peer: std::sync::Mutex::new(None),
            invalidate_ref_frames: std::sync::Mutex::new(None),
        })
    }

    /// Stamp the last APPLIED client IDR request (millis since `origin`).
    /// Called by the control thread only when the starvation gate lets the
    /// request through; the video loop's P-frame suppression keys on it.
    pub fn note_idr_request_applied(&self) {
        self.idr_last_applied_ms
            .store(self.origin.elapsed().as_millis() as u64, Ordering::Relaxed);
    }
}

/// Backoff for a sender-loop iteration that produced no frame while the
/// pipeline's pacing budget was already spent: the pipeline just polled
/// its encoder's completion event and the DXGI duplicator with no wait
/// (the acquire deadline had already passed), so returning to the top of
/// the loop re-polls both immediately. The measured 4K60 session
/// (2026-09-14) logged 378237 empty polls against 3294 frames sent —
/// 2500-7500 polls/s at ~22fps, with peaks of 7500/s — of acquire/reap
/// churn on the GPU, compounding the encoder slowdown that caused it.
/// One millisecond is enough to break that: it caps the churn at ~1000
/// polls/s while adding at most 1ms to a frame that is already a full
/// frame interval late. The healthy path never pays it: an iteration
/// that produced a frame skips this entirely (the caller is the no-frame
/// arm), and an iteration whose budget is intact blocks in the acquire
/// itself. Not a blocking wait on the completion event: the pipeline's
/// event is per-slot inside the encoder and is only polled there.
const EMPTY_POLL_BACKOFF: Duration = Duration::from_millis(1);

/// Pure policy for the empty-iteration backoff: `pacing_budget_spent`
/// (from [`VideoPipeline::pacing_budget_spent`]) alone decides, so a
/// pipeline that never reports a spent budget — every test source, and
/// any source without a capture cadence — behaves exactly as before.
fn empty_poll_backoff(pacing_budget_spent: bool) -> Duration {
    if pacing_budget_spent {
        EMPTY_POLL_BACKOFF
    } else {
        Duration::ZERO
    }
}

/// Names of the NAL types an annex-B access unit carries, for the dump's
/// one-shot first-frame sanity line (SPS/PPS/IDR expected on frame 1).
fn nal_type_summary(data: &[u8]) -> String {
    let mut present: Vec<&str> = Vec::new();
    for (nal_type, name) in [
        (7u8, "SPS"),
        (8, "PPS"),
        (6, "SEI"),
        (5, "IDR"),
        (1, "non-IDR-slice"),
    ] {
        if annexb_has_nal_type(data, nal_type) {
            present.push(name);
        }
    }
    if present.is_empty() {
        "none".to_string()
    } else {
        present.join(",")
    }
}

/// Diagnostic dump of the annex-B access units the sender loop actually
/// puts on the wire, enabled by `HYDRA_STREAM_VIDEO_DUMP`
/// (`config::VIDEO_DUMP_ENV`).
///
/// The bytes are taken from `EncodedFrame::data` at the one point in the
/// loop where a frame is committed to the client — after the freshness
/// gate and the peer check, immediately before the paced drain — so the
/// file holds exactly what the packetizer was handed and the socket
/// sends, in send order. That distinction is the whole point: the stream
/// has no B-frames, so send order is decode order and `cat`-ing the file
/// into ffmpeg is a faithful replay of the elementary stream the client
/// must decode; a frame the freshness gate or the peer check dropped
/// never reaches the wire and so must never appear here, or a decoder
/// error would be this dump's artifact rather than the client's.
///
/// Cost while enabled: one `write_all` per sent frame, straight to the OS
/// page cache at the file offset. A plain `File` (no `BufWriter`, hence
/// no buffer to flush and no per-frame allocation or copy) keeps that at
/// exactly one write syscall per frame, no flush per frame; the handle is
/// closed when the session ends.
struct VideoDump {
    file: Option<File>,
    window_frames: u64,
    window_bytes: u64,
    frames: u64,
    bytes: u64,
    /// one-shot: the first sent access unit has been announced
    announced: bool,
}

impl VideoDump {
    /// Opens the target once per session (truncating) when the env var is
    /// set, and logs the single line that announces the dump. A path that
    /// cannot be opened disables the dump instead of failing the session.
    fn open() -> Self {
        let mut dump = VideoDump {
            file: None,
            window_frames: 0,
            window_bytes: 0,
            frames: 0,
            bytes: 0,
            announced: false,
        };
        let Some(path) = crate::config::video_dump_path() else {
            return dump;
        };
        match File::create(path) {
            Ok(file) => {
                dump.file = Some(file);
                eprintln!(
                    "video: {}={path} (annex-B access units, one per sent frame)",
                    crate::config::VIDEO_DUMP_ENV
                );
            }
            Err(error) => eprintln!(
                "video: {}={path} could not be opened ({error}); dump disabled",
                crate::config::VIDEO_DUMP_ENV
            ),
        }
        dump
    }

    /// Appends one access unit that is about to leave for the client. A
    /// disk error disables the dump rather than logging at 60Hz.
    fn write(&mut self, data: &[u8]) {
        let Some(file) = self.file.as_mut() else {
            return;
        };
        if let Err(error) = file.write_all(data) {
            eprintln!(
                "video: dump write failed ({error}) after {} frames/{} bytes; dump disabled",
                self.frames, self.bytes
            );
            self.file = None;
            return;
        }
        self.window_frames += 1;
        self.window_bytes += data.len() as u64;
        self.frames += 1;
        self.bytes += data.len() as u64;
        if !self.announced {
            self.announced = true;
            eprintln!(
                "video: dump first access unit ({} bytes): NALs {}",
                data.len(),
                nal_type_summary(data)
            );
        }
    }

    /// Per-window progress, on its own line beside the 5s latency report,
    /// so a dump file can be correlated with the stream's state.
    fn report_window(&mut self) {
        if self.file.is_none() {
            return;
        }
        eprintln!(
            "video: dump +{} frames/+{} bytes this window (session {} frames, {} bytes)",
            self.window_frames, self.window_bytes, self.frames, self.bytes
        );
        self.window_frames = 0;
        self.window_bytes = 0;
    }
}

/// Blocking sender loop. Runs in `spawn_blocking`: captures and encodes
/// frames, drops everything when the client falls behind (no queues), and
/// drains each frame through the sender rate limiter in small batches —
/// never as one burst (the WiFi freeze root cause: a burst floods the
/// AP/client queue ahead of the client's tiny ENet ACKs).
pub fn run_video_loop(
    socket: UdpSocket,
    shared: Arc<StreamShared>,
    mut pipeline: Box<dyn VideoPipeline>,
    packet_size: u32,
    // base video FEC percentage (0 disables FEC): the adaptive controller
    // starts here and raises the percentage it feeds the packetizer per
    // frame under ENet congestion, clamped to adaptive::FEC_PERCENT_MAX.
    fec_percentage: u32,
    // `x-nv-vqos[0].fec.minRequiredFecPackets` from the client's ANNOUNCE:
    // the minimum recovery packets every FEC block must carry (0 = none).
    // A block whose percentage-derived parity falls short is raised to it
    // (Sunshine stream.cpp:852-859).
    min_required_fec_packets: u32,
    // frame interval (1/fps); the sender rate limiter derives nothing from
    // it — it only seeds the default freshness budget (3x the interval,
    // clamped) below, which is then also installed into the pipeline as the
    // pre-encode gate's bound.
    frame_pacing: Duration,
    // negotiated video geometry from /launch `mode` — the size the encoder
    // is configured with (a zero width/height means "encode at the native
    // desktop resolution": the encoder resolves it, and the loop learns the
    // result from `VideoPipeline::encode_size`/`source_size` right away —
    // before the first frame — so the bits-per-pixel floor and the size
    // resolution describe the pixels really on the wire).
    // The adaptive controller's floor is a function of these and `fps`:
    // below pixels*fps*0.072 bpp the one-frame VBV cannot drain fast
    // enough to hold the target cadence with margin (see adaptive.rs and
    // config::MIN_BITS_PER_PIXEL_MILLI_DEFAULT).
    width: u32,
    height: u32,
    fps: u32,
    // negotiated client bitrate: the adaptive controller's ceiling
    // (further capped by HYDRA_STREAM_MAX_BITRATE_KBPS).
    negotiated_bitrate_kbps: u32,
    // `x-nv-vqos[0].qosTrafficType` from the client's ANNOUNCE:
    // Some(nonzero) authorizes qWAVE/DSCP QoS marking of the video
    // socket, Some(0) disables it, None means the attribute was absent
    // (no marking, Sunshine stream.cpp:2147 semantics).
    video_qos_type: Option<i32>,
) -> Result<(), String> {
    socket
        .set_nonblocking(true)
        .map_err(|error| format!("video socket: {error}"))?;

    // Keep the display awake for the whole stream: a sleep cycle mid
    // capture stops the frames (best case) or reinit-loops the
    // duplication as the display powers on and off (worst case).
    // Sunshine display_base.cpp:245-248 scopes the same state to the
    // capture thread; here it scopes to the sender loop.
    use windows::Win32::System::Power::{ES_CONTINUOUS, ES_DISPLAY_REQUIRED, SetThreadExecutionState};
    unsafe {
        SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED);
    }
    struct DisplayRequiredGuard;
    impl Drop for DisplayRequiredGuard {
        fn drop(&mut self) {
            unsafe {
                SetThreadExecutionState(ES_CONTINUOUS);
            }
        }
    }
    let _display_required = DisplayRequiredGuard;

    let mut packetizer = VideoPacketizer::new(packet_size, min_required_fec_packets);
    let mut limiter = SendRateLimiter::new(packetizer.shard_size(), Instant::now());
    let epoch = Instant::now();
    let mut frame_index: u32 = 1; // client initializes currentFrameNumber=1 and rejects frame 0 (RtpVideoQueue.c)
    // Frame-age drop policy: a frame may never be shipped once it is
    // older than this budget (default 3x the frame interval clamped to
    // [1.25x, 100ms], ~50ms at 60fps; HYDRA_STREAM_MAX_FRAME_AGE_MS
    // overrides). The lower bound used to be 1.25x the interval (~21ms),
    // which fits an idle GPU (encode ~3ms) but not a GPU-saturated game:
    // the encode then waits GPU scheduling quanta and every frame is
    // older than the budget before it finishes, so the gate dropped the
    // whole stream. The budget must cover that systematic latency; the
    // client accepts orderly-but-late frame numbers fine and only skips
    // ahead on gaps. The client rejects frames older than its own queue
    // anyway (RtpVideoQueue.c drops frameIndex behind its current number)
    // and treats frame-number gaps as lost frames, skipping ahead
    // (VideoDepacketizer.c "Network dropped N frames") — so the budget
    // stays a tight relief valve, just one sized for contention.
    let max_frame_age = crate::config::max_frame_age_ms()
        .map(Duration::from_millis)
        .unwrap_or_else(|| (frame_pacing * 3).clamp(frame_pacing * 5 / 4, Duration::from_millis(100)));
    eprintln!(
        "video: freshness budget {:.1}ms ({})",
        ms(max_frame_age),
        crate::config::max_frame_age_ms()
            .map(|_| "HYDRA_STREAM_MAX_FRAME_AGE_MS".to_string())
            .unwrap_or_else(|| "3x frame interval, clamped [1.25x, 100ms]".to_string())
    );
    // One budget, judged on both sides of the encoder: the pipeline's
    // pre-encode gate measures a captured frame's *projected* age against
    // exactly this number, so a frame that cannot be shipped fresh is never
    // submitted — and therefore never becomes the reference for the frame
    // behind it, which is the defect this bounds (see
    // `VideoPipeline::set_frame_age_budget`).
    pipeline.set_frame_age_budget(max_frame_age);
    eprintln!(
        "video: sender rate limit {:.0}Mbps: {} packets/ms quantum, {}-packet batches (~{:.1}us/packet)",
        RATE_LIMIT_CEILING_BPS as f64 / 1e6,
        limiter.packets_per_quantum(),
        limiter.batch_size(),
        1000.0 / limiter.packets_per_quantum() as f64
    );
    let mut buffer = [0u8; 2048];
    let mut packets_sent: u64 = 0;
    let mut total_packets: u64 = 0;
    let mut empty_polls: u64 = 0;
    let mut sends = SendGuard::new("video");
    let mut last_report = Instant::now();
    let mut reporting = true;
    let mut first_send = true;
    let mut first_frame = true;
    let mut latencies: Vec<FrameLatency> = Vec::new();
    // Last datagram send of the previous EMITTED frame — the anchor for the
    // send-gap distribution in every 5s latency line. It lives outside the
    // `latencies` window on purpose: a frame dropped before the wire (stale,
    // suppressed) never reaches the push below, so the next emitted frame's
    // gap spans the drop, which is exactly the gap the client saw. One
    // Instant, no growth.
    let mut previous_frame_sent_at: Option<Instant> = None;
    let mut last_latency_report = Instant::now();
    let mut max_pipeline_depth = 0usize;
    let mut loop_iterations: u64 = 0;
    let mut last_encoded_reported: u64 = 0;
    let mut last_iterations_reported: u64 = 0;
    let mut adaptive = crate::adaptive::AdaptiveController::new(
        negotiated_bitrate_kbps,
        fec_percentage,
        width,
        height,
        fps,
    );
    let mut last_adaptive_check = Instant::now();
    let mut last_wouldblock = 0u64;
    let mut stale_dropped: u64 = 0;
    // Pre-encode skips are counted inside the pipeline (it is the only
    // place that can see the frame before the submission); the loop keeps
    // the last total it reported so the 5s line can print a window delta.
    let mut last_stale_skipped_reported: u64 = 0;
    // Same for the capture side's frame-supply counters, which are read as
    // cumulative totals and reported as deltas beside `sent N/s`.
    let mut last_supply_reported = FrameSupply::default();
    // Sent frames that were idle-desktop repeats rather than new desktop
    // frames, for the session-end summary (u32 to match frame_index).
    let mut sent_duplicates: u32 = 0;
    // The session's encode size is resolved HERE — before the first frame is
    // emitted — and never changes again for the rest of the session: a
    // mid-stream size change re-emits SPS/PPS, and an Apple client
    // (VideoToolbox, the iPad the measured sessions ran on) tears down and
    // rebuilds its decoder on those. The two live sessions that logged a
    // mid-session `encode size` change ended in IDR-begging avalanches of
    // 978 and 876 requests against 109 for a session that never changed
    // size, with our send side healthy in all three (60fps, 10-18ms, 0
    // stale drops). The rule is `adaptive::select_encode_size` against the
    // session's maximum size (the captured desktop's columns at the
    // negotiated aspect) and the bitrate the session starts at, so a 4K
    // client on a 10Mbps link *starts* at 1080p instead of stepping into
    // it. The pipeline's one recreation for this lands on its first
    // `encode_next` call, i.e. still before any frame leaves the host;
    // nothing below this point can ask for a different size.
    if let Some(current) = pipeline.encode_size() {
        adaptive.set_geometry(current, pipeline.source_size());
        let mut resolved = current;
        if let Some(size) = adaptive.initial_encode_size() {
            if size != current {
                match pipeline.set_encode_size(size.0, size.1) {
                    Ok(()) => resolved = size,
                    Err(error) => eprintln!(
                        "video: encode size resolution to {}x{} refused ({error}); continuing at {}x{}",
                        size.0, size.1, current.0, current.1
                    ),
                }
            }
        }
        let bpp = crate::adaptive::bits_per_pixel_milli(
            resolved.0,
            resolved.1,
            fps,
            adaptive.current_kbps(),
        ) as f64
            / 1000.0;
        eprintln!(
            "video: encode size resolved before the first frame: {}x{} (bpp {bpp:.3} at {}kbps; fixed for the session)",
            resolved.0,
            resolved.1,
            adaptive.current_kbps()
        );
        // Session identity, once: with two GPUs (and a cross-adapter bridge
        // that may or may not have come up) every later number is
        // uninterpretable without it. The adapter names themselves are on
        // the `capture adapter:` line printed when the pipeline was built.
        let desktop = pipeline.source_size().unwrap_or(resolved);
        eprintln!(
            "video: session: {}, encode {}x{} @ {fps}fps (client negotiated {width}x{height}), desktop {}x{}, display {}",
            pipeline.session_label(),
            resolved.0,
            resolved.1,
            desktop.0,
            desktop.1,
            match pipeline.display_hz() {
                Some(hz) => format!("{hz}Hz"),
                None => "refresh unknown".to_string(),
            },
        );
    }
    // loop-period probe: time between sender-loop iterations, the
    // health metric for inter-iteration stalls (a healthy loop iterates
    // at the negotiated frame cadence plus one re-poll per pipelined
    // frame: the pipeline only touches the duplicator on a slot, so
    // neither the desktop's present rate nor a present arriving mid-slot
    // sets the loop period; the iterations spent waiting for a slot carry
    // the `empty_poll_backoff` sleep, so the period floors at ~1ms
    // instead of spinning)
    let mut last_loop_iteration = Instant::now();
    let mut loop_periods: Vec<Duration> = Vec::new();
    // Forced-IDR lifecycle numbering: the GOP is infinite, so every IDR is
    // a deliberate refresh (client request, stream start, or display
    // recreation) and a starving client recovers only through one.
    let mut forced_idr_count: u64 = 0;
    // Recovery mode, read once: an RFI-capable encoder lets the client
    // resume at the next frameType-5 recovery frame, so the IDR-only
    // policies below (P-frame suppression, short keyframe cadence) are
    // neither needed nor helpful there. Read before the loop because the
    // encoder backend is fixed for the session.
    let rfi_live = pipeline.supports_ref_invalidation();
    // P-frame suppression while an applied client IDR request is still
    // unanswered (see PSuppression): the request opens an episode, the loop
    // forces the IDR it asked for, and the episode closes as soon as that
    // IDR is encoded — or at the hard cap, or when begging stops. Only the
    // IDR-only recovery mode needs it.
    let mut suppression = PSuppression::new(Duration::from_millis(crate::config::idr_quiet_ms()));
    eprintln!(
        "video: IDR recovery-quiet {}ms ({})",
        crate::config::idr_quiet_ms(),
        crate::config::IDR_QUIET_ENV
    );
    // Periodic keyframe cadence (hygiene IDRs): caps the time between
    // IDRs — the encoders never emit a spontaneous IDR (infinite GOP).
    // The default cadence is mode-dependent: 2000ms without RFI (a bound
    // on corruption lifetime only — the client's own REQUEST_IDR drives
    // recovery through the starvation gate, see `PeriodicKeyframe`),
    // 5000ms with it (a safety net; Sunshine streams an infinite GOP with
    // none at all).
    let keyframe_interval = crate::config::keyframe_interval_ms(rfi_live);
    let mut periodic = PeriodicKeyframe::new(keyframe_interval.map(Duration::from_millis), Instant::now());
    match keyframe_interval {
        Some(ms) if rfi_live => eprintln!(
            "video: recovery mode = rfi (P-suppression off, {ms}ms safety keyframes, {})",
            crate::config::KEYFRAME_INTERVAL_ENV
        ),
        Some(ms) => eprintln!(
            "video: recovery mode = idr (P-suppression + {ms}ms keyframes, {})",
            crate::config::KEYFRAME_INTERVAL_ENV
        ),
        None => eprintln!(
            "video: recovery mode = {} (periodic keyframe disabled, {}=0)",
            if rfi_live { "rfi" } else { "idr" },
            crate::config::KEYFRAME_INTERVAL_ENV
        ),
    }
    let mut p_suppressed: u64 = 0;
    // pacing anchor for the suppression skip path: one skipped iteration
    // stands for one would-be P-frame, so skips pace to the frame cadence
    let mut last_suppressed_skip = Instant::now();
    // qWAVE flow for the current client endpoint (dropped/re-marked when
    // the endpoint moves, and removed when the loop exits)
    let mut _video_qos_flow: Option<crate::qos::QosFlow> = None;
    // Diagnostic annex-B dump of what leaves for the client
    // (HYDRA_STREAM_VIDEO_DUMP): opened once here, inert when unset.
    let mut dump = VideoDump::open();

    loop {
        loop_iterations += 1;
        let iteration_now = Instant::now();
        loop_periods.push(iteration_now.duration_since(last_loop_iteration));
        last_loop_iteration = iteration_now;
        if shared.stop.load(Ordering::Relaxed) {
            let supply_total = pipeline.supply();
            report_latencies(
                &mut latencies,
                "at stop",
                iteration_now.duration_since(last_latency_report),
                fps,
                adaptive.current_kbps(),
                pipeline.pre_encode_stale_skips(),
                &supply_total.delta(&last_supply_reported),
                stale_dropped,
                p_suppressed,
                pipeline.encoded(),
                loop_iterations,
                &mut loop_periods,
            );
            dump.report_window();
            // The session summary carries the CUMULATIVE frame supply (the
            // same totals `counters()` prints, beside the sent-frame split
            // this line adds): whether the session's wire was carrying new
            // desktop frames or repeats is a session-level fact.
            eprintln!(
                "video: loop stopped (session ended, {} frames sent ({} of a new desktop frame, {} idle-desktop repeats), {} empty polls, {} packets; {}; {}; max pipeline queue={}; stale pre-encode skips={}; dropped-after-encode={}; supply new={} surplus={} drained={} acq-timeouts={} idle-skips={})",
                frame_index,
                frame_index.saturating_sub(sent_duplicates),
                sent_duplicates,
                empty_polls,
                total_packets,
                sends.summary(),
                pipeline.counters(),
                max_pipeline_depth,
                pipeline.pre_encode_stale_skips(),
                stale_dropped,
                supply_total.new_frames,
                supply_total.pacer_surplus,
                supply_total.stale_drained,
                supply_total.acquire_timeouts,
                supply_total.idle_skips
            );
            return Ok(());
        }

        // Learn the client's video endpoint from its ping datagrams and
        // drain the receive buffer so ICMP unreachable cannot pile up.
        // The endpoint may change between sessions (client rebinds its
        // socket on relaunch), so a differing source always updates it.
        // QoS marking rides the same event: a new endpoint drops the old
        // qWAVE flow and re-marks for the new peer.
        let mut learned_peer: Option<std::net::SocketAddr> = None;
        loop {
            match socket.recv_from(&mut buffer) {
                Ok((_, source)) => {
                    let mut peer = shared.video_peer.lock().expect("video peer lock");
                    if peer.as_ref() != Some(&source) {
                        if peer.is_none() {
                            eprintln!("video client at {source}");
                        } else {
                            eprintln!("video: client endpoint moved {peer:?} -> {source}");
                        }
                        *peer = Some(source);
                        learned_peer = Some(source);
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(_) => break,
            }
        }
        if let Some(source) = learned_peer {
            // drop any flow bound to the previous endpoint
            _video_qos_flow = None;
            _video_qos_flow = match video_qos_type {
                Some(0) => {
                    eprintln!("video: client sent qosTrafficType=0, socket stays unmarked");
                    None
                }
                Some(_) => crate::qos::apply_socket_qos(
                    &socket,
                    source,
                    crate::qos::QosTraffic::Video,
                    "x-nv-vqos[0].qosTrafficType",
                ),
                None => None,
            };
        }

        // Client 0x0301 reference-frame invalidation: the encoder
        // invalidates the range and the first frame submitted after it
        // carries the after-invalidation mark (frameType 5). A range the
        // encoder cannot honor (unsupported, degenerate, or >= the DPB)
        // falls back to a full IDR here — Sunshine's
        // invalidate_ref_frames answers false and the session forces
        // one exactly the same way (video.cpp:590-598).
        if let Some((first, last)) = shared
            .invalidate_ref_frames
            .lock()
            .expect("invalidate lock")
            .take()
        {
            if pipeline.invalidate_ref_frames(first, last) {
                eprintln!("video: invalidated reference frames {first}..{last}");
            } else {
                eprintln!("video: ref invalidation {first}..{last} fell back to a full IDR");
                shared.idr_pending.store(true, Ordering::Relaxed);
            }
        }

        // Periodic keyframe cadence: a hygiene IDR at most every keyframe
        // interval, anchored on the newest IDR from ANY cause (client
        // request, suppression ladder, stream start, recreation, or this
        // trigger), so an episode already IDR-ing faster stays silent.
        // Not a starvation signal: it only arms idr_pending — it never
        // stamps idr_last_applied_ms (suppression entry), never touches
        // idr_applied (the adaptive controller's IDR-flood counter), and
        // the flag is idempotent. The idle-desktop duplicate path honors
        // it through the same force_idr plumbing as a client request.
        if periodic.due(iteration_now) {
            shared.idr_pending.store(true, Ordering::Relaxed);
            if let Some(interval_ms) = keyframe_interval {
                eprintln!("video: periodic keyframe (interval {interval_ms}ms)");
            }
        }

        // P-frame suppression while an applied client IDR request is still
        // unanswered: the request opens an episode and the forced IDR it
        // asked for is driven right here, so the withheld window is the
        // handful of decisions until that IDR leaves the encoder — a
        // P-frame before then references a keyframe the client may never
        // have decoded, so it must not be encoded, packetized, or sent
        // (see PSuppression for the exits: IDR encoded, hard cap, begging
        // stopped). Only forced IDRs flow meanwhile (client requests via
        // idr_pending, plus suppression-driven retries on the 200ms floor
        // below); a withheld frame never reaches the age gate, the
        // packetizer, or the adaptive controller's signals. idr_pending is
        // loaded (not swapped): the flag must survive polls that produce
        // no frame, otherwise an IDR requested during capture starvation
        // would be swallowed before any encode.
        let applied_ms = shared.idr_last_applied_ms.load(Ordering::Relaxed);
        let now_ms = shared.origin.elapsed().as_millis() as u64;
        // applied_ms == 0 is the "no client request this session"
        // sentinel (see StreamShared): such a stream — the normal no-
        // begging case — must never suppress, so its age is infinite
        // rather than "now minus epoch".
        let applied_age = if applied_ms == 0 {
            Duration::MAX
        } else {
            Duration::from_millis(now_ms.saturating_sub(applied_ms))
        };
        // With RFI live there is no episode at all: the premise of
        // suppression — a P-frame after an unconfirmed IDR is undecodable —
        // is false when the client resumes at the next frameType-5 frame.
        // The mechanism stays for encoders without the capability (AMF, or
        // a driver without ref invalidation).
        let suppress = !rfi_live && suppression.update(iteration_now, applied_age);
        let pending_idr = shared.idr_pending.load(Ordering::Relaxed);
        let force_idr = if suppress {
            if !pending_idr && !suppression.idr_due(iteration_now) {
                // No IDR owed this iteration: don't even feed the encoder
                // a P-frame. Pace to the frame cadence so each skipped
                // iteration stands for one would-be P-frame (and so the
                // loop keeps its ~60Hz housekeeping cadence). An episode
                // owes its IDR on its first decision, so this rung is the
                // conservative fallback, never a steady state.
                p_suppressed += 1;
                let since_skip = iteration_now.duration_since(last_suppressed_skip);
                if since_skip < frame_pacing {
                    std::thread::sleep(frame_pacing - since_skip);
                }
                last_suppressed_skip = Instant::now();
                continue;
            }
            // An IDR is owed: a pending client request, or the
            // suppression self-drive's 200ms floor. The floor-driven retry
            // encodes without consuming idr_pending — a fresh client
            // request racing it must survive for its own encode.
            true
        } else {
            pending_idr
        };
        let frame = match pipeline.encode_next(force_idr) {
            Ok(frame) => frame,
            Err(error) => {
                eprintln!("video pipeline error: {error}; {}", pipeline.counters());
                return Err(error);
            }
        };
        let Some(frame) = frame else {
            empty_polls += 1;
            // Nothing to send: if the pipeline's pacing budget for this
            // frame is already spent (the encoder is late, so this
            // iteration polled the encoder and the duplicator with no
            // wait at all) back off briefly instead of re-polling both
            // immediately — the churn measured at 2500-7500 polls/s while
            // the encoder ran behind (see `empty_poll_backoff`). A
            // pipeline with an intact budget returns Duration::ZERO here
            // and the loop behaves exactly as before.
            let backoff = empty_poll_backoff(pipeline.pacing_budget_spent());
            if !backoff.is_zero() {
                std::thread::sleep(backoff);
            }
            continue;
        };
        if suppress && !frame.idr {
            // An in-flight P-frame reaped from the encoder (submitted
            // before the request landed) is undecodable too: drop it
            // before packetize/send, exactly like a skip. Its own
            // reference is inside the encoder, which the client has no way
            // to reach, so the next frame must be a full IDR — the
            // suppression episode is already driving one, and this makes it
            // unconditional.
            p_suppressed += 1;
            shared.idr_pending.store(true, Ordering::Relaxed);
            eprintln!(
                "video: dropped frame {frame_index} after encode: next frame forced to IDR \
                 (reference chain would otherwise break) (P-frame suppressed while the client \
                 is starving)"
            );
            continue;
        }
        if frame.idr {
            suppression.note_idr_encoded(iteration_now);
            periodic.note_idr_encoded(iteration_now);
        }
        let encode_done = Instant::now();
        max_pipeline_depth = max_pipeline_depth.max(pipeline.pending_depth());
        let timestamp_90k = frame
            .capture
            .saturating_duration_since(epoch)
            .as_micros() as u64
            * 9
            / 100;
        let datagrams = packetizer.packetize(
            frame_index,
            &frame.data,
            frame.idr,
            timestamp_90k as u32,
            adaptive.current_fec_percentage(),
            frame.after_ref_invalidation,
        );
        let datagrams_len = datagrams.len();
        let prepare_done = Instant::now();
        // IDR lifecycle tracing, part 1: the IDR exists and is packetized.
        // SPS presence is asserted from the bitstream itself — a client
        // that never sees SPS after its decoder flush cannot start, and
        // with an infinite GOP the SPS rides only with IDRs. Under a
        // starving client this fires at most once per throttle window.
        let idr_number = if frame.idr {
            forced_idr_count += 1;
            let sps = if annexb_has_nal_type(&frame.data, 7) {
                "present"
            } else {
                "ABSENT"
            };
            eprintln!(
                "video: forced IDR #{} encoded ({} bytes, SPS={sps}, frameIndex={frame_index}, shards={datagrams_len}, fec={fec}%)",
                forced_idr_count,
                frame.data.len(),
                fec = adaptive.current_fec_percentage(),
            );
            Some(forced_idr_count)
        } else {
            None
        };
        // Frame-age drop policy, post-encode relief valve — the residual
        // path, now that the pipeline's pre-encode gate keeps out every
        // frame whose projected age crossed the budget before the
        // submission. What can still reach here is the case only the
        // encoder can reveal: a frame submitted inside the budget that came
        // back out of a pipelined encoder (or off a stalled GPU) past it.
        // With paced sending the projection adds the limiter's
        // planned_send_duration so the budget covers the drain too — a
        // frame that WILL complete sending within the budget is never
        // pre-dropped by a post-pacing stale measurement, and a frame that
        // cannot complete within it drops here, before any pacing wait is
        // wasted on it. The drop must not consume a frame number.
        // Explicitly forced IDRs are exempt — they are the recovery
        // mechanism and are always decodable, late or not. The pending
        // IDR flag intentionally survives this drop: a stale frame never
        // swallows a forced IDR, it is retried on the next encode.
        //
        // This drop is no longer silent and no longer damages the picture.
        // The encoder had already produced the frame and already used it as
        // the reference for the frame that follows, so shipping the next
        // P-frame would show the client a picture referencing a frame it
        // never received — exactly the 2026-09-14 report, where 163 frames
        // were dropped here in one session pinned at the bits-per-pixel
        // floor and the artifacts persisted until the next keyframe. The
        // next frame is therefore forced to a full IDR (idr_pending, which
        // the pipeline answers through the same `force_idr` plumbing as a
        // client request): this client is RFI-incapable and resumes only on
        // an IDR, and an IDR references nothing, so the chain is cut cleanly
        // instead of being left broken. Expected count: zero.
        let send_estimate = limiter.planned_send_duration(datagrams_len, prepare_done);
        let projected_age =
            prepare_done.saturating_duration_since(frame.capture) + send_estimate;
        if matches!(
            frame_age_decision(projected_age, max_frame_age, frame.idr),
            FrameAgeDecision::Stale
        ) {
            stale_dropped += 1;
            shared.idr_pending.store(true, Ordering::Relaxed);
            if stale_dropped == 1 || stale_dropped % 100 == 0 {
                eprintln!(
                    "video: dropped frame {frame_index} after encode: next frame forced to IDR \
                     (reference chain would otherwise break) (age {}ms + send-estimate {}ms > \
                     {}ms budget; total {stale_dropped})",
                    prepare_done.saturating_duration_since(frame.capture).as_millis(),
                    send_estimate.as_millis(),
                    max_frame_age.as_millis()
                );
            }
            continue;
        };
        if first_frame {
            first_frame = false;
            eprintln!(
                "video: first frame from pipeline ({} bytes, idr={})",
                frame.data.len(),
                frame.idr
            );
        }

        let peer = *shared.video_peer.lock().expect("video peer lock");
        let Some(peer) = peer else {
            if let Some(number) = idr_number {
                eprintln!(
                    "video: IDR #{number} dropped (reason: video client endpoint unknown)"
                );
            }
            // The frame was encoded but never sent — nobody to send it to —
            // so the encoder's reference for the next frame is a frame the
            // client will never have. Force a full IDR on it: without this
            // the first frame the client actually receives once it learns
            // its endpoint would be a P-frame whose whole chain is missing.
            // Arming the flag unconditionally covers the case where the
            // dropped frame was itself an IDR: what has to be forced is an
            // IDR *after* the last frame that left, because an infinite GOP
            // sends SPS/PPS only with an IDR.
            shared.idr_pending.store(true, Ordering::Relaxed);
            eprintln!(
                "video: dropped frame {frame_index} after encode: next frame forced to IDR \
                 (reference chain would otherwise break) (video client endpoint unknown)"
            );
            frame_index = frame_index.wrapping_add(1);
            continue;
        };
        // the pending IDR is only consumed once a frame actually leaves for
        // the client: an infinite GOP emits SPS/PPS solely with IDRs, so a
        // forced IDR dropped for a missing endpoint must stay pending —
        // otherwise the SPS never reaches a client that learns its video
        // endpoint late (same survival rule as the stale gate above).
        // Only the flag-loaded path consumes it: a suppression-driven
        // retry encoded while idr_pending was clear must not swallow a
        // request that raced it.
        if pending_idr {
            shared.idr_pending.store(false, Ordering::Relaxed);
        }

        // Diagnostic: this frame has cleared every gate that stands
        // between the encoder and the wire (suppression, freshness, peer)
        // and the drain below sends it, so `frame.data` here is exactly
        // the bytes handed to the packetizer and the elementary stream
        // the client must decode — dumped in send order.
        dump.write(&frame.data);

        // Sunshine-style paced drain (stream.cpp:1658-1821): batches of
        // batch_size() datagrams back-to-back with no sleep inside a
        // batch, waiting on the schedule only between batches; leftover
        // credit carries across frames (a small frame after a big one
        // starts immediately) and a stalled encoder never triggers a
        // catch-up burst (begin_frame clamps to now).
        let send_start = Instant::now();
        let mut first_send_at: Option<Instant> = None;
        let batch_size = limiter.batch_size();
        limiter.begin_frame(send_start);
        for batch in datagrams.chunks(batch_size) {
            limiter.wait_for_batch();
            for datagram in batch {
                sends.record(&socket.send_to(datagram, peer));
                if first_send_at.is_none() {
                    first_send_at = Some(Instant::now());
                }
            }
            limiter.note_sent(batch.len());
        }
        limiter.finish_frame();
        let last_send_at = Instant::now();
        if let Some(first_send_at) = first_send_at {
            // IDR lifecycle tracing, part 2: the IDR actually left for the
            // client. Encode-without-send narrows a freeze to the link;
            // send-without-decode narrows it to the client.
            if let Some(number) = idr_number {
                eprintln!("video: IDR #{number} first shard sent (frameIndex {frame_index})");
            }
            let acquire_to_encode = encode_done.saturating_duration_since(frame.capture);
            if frame.duplicate {
                sent_duplicates += 1;
            }
            latencies.push(FrameLatency {
                acquire_to_encode,
                encode_to_first_send: first_send_at.saturating_duration_since(encode_done),
                first_to_last_send: last_send_at.saturating_duration_since(first_send_at),
                send_gap: previous_frame_sent_at
                    .map(|previous| last_send_at.saturating_duration_since(previous)),
                // the four stages partition `acquire_to_encode`; the
                // pipeline measured the first three and `reap` is the
                // residual down to this instant (the loop is the only place
                // that knows when `encode_next` returned)
                stages: FrameStages {
                    reap: acquire_to_encode.saturating_sub(
                        frame.stages.scale + frame.stages.submit + frame.stages.encode,
                    ),
                    ..frame.stages
                },
                duplicate: frame.duplicate,
            });
            previous_frame_sent_at = Some(last_send_at);
            if latencies.len() >= 300
                || last_send_at.duration_since(last_latency_report) >= Duration::from_secs(5)
            {
                let supply = pipeline.supply();
                report_latencies(
                    &mut latencies,
                    "5s",
                    last_send_at.duration_since(last_latency_report),
                    fps,
                    adaptive.current_kbps(),
                    pipeline
                        .pre_encode_stale_skips()
                        .saturating_sub(last_stale_skipped_reported),
                    &supply.delta(&last_supply_reported),
                    stale_dropped,
                    p_suppressed,
                    pipeline.encoded().saturating_sub(last_encoded_reported),
                    loop_iterations.saturating_sub(last_iterations_reported),
                    &mut loop_periods,
                );
                last_encoded_reported = pipeline.encoded();
                last_stale_skipped_reported = pipeline.pre_encode_stale_skips();
                last_supply_reported = supply;
                last_iterations_reported = loop_iterations;
                last_latency_report = last_send_at;
                dump.report_window();
            }
        }
        if first_send && sends.sent > 0 {
            first_send = false;
            eprintln!("video: first RTP packets sent to {peer}");
        }
        packets_sent += datagrams_len as u64;
        total_packets += datagrams_len as u64;
        if reporting {
            let now = Instant::now();
            let elapsed = now.duration_since(last_report);
            if elapsed >= Duration::from_secs(1) {
                eprintln!(
                    "video: built {packets_sent} packets in {}ms (frame {frame_index}; {})",
                    elapsed.as_millis(),
                    sends.summary()
                );
                packets_sent = 0;
                last_report = now;
                if now.duration_since(epoch) >= Duration::from_secs(10) {
                    reporting = false;
                    eprintln!("video: first-10s packet reporting done, stream continuing");
                }
            }
        }
        // 1s-cadence adaptation: fold the signals fed by the control thread
        // (applied IDRs, LOSS_STATS events, raw ENet wire deltas) and local
        // send pressure into the controller, then act on its decisions —
        // the bitrate ladder and the FEC ladder. The encode size is not
        // among them: it was resolved once, before the first frame, and may
        // not change again for the rest of the session (see the resolution
        // above the loop).
        let now = Instant::now();
        if now.duration_since(last_adaptive_check) >= Duration::from_secs(1) {
            last_adaptive_check = now;
            // The geometry the pipeline really encodes: a client that
            // negotiated 0x0 carries none in its launch parameters (the
            // encoder resolved to the desktop), and the size resolution
            // above re-created the pipeline at the resolved size — so the
            // bits-per-pixel floor follows the pixels actually on the wire.
            if let Some(size) = pipeline.encode_size() {
                adaptive.set_geometry(size, pipeline.source_size());
            }
            let idr = shared.idr_applied.swap(0, Ordering::Relaxed) as u32;
            let loss = shared.loss_events.swap(0, Ordering::Relaxed) > 0;
            let wouldblock = sends.wouldblock - last_wouldblock;
            last_wouldblock = sends.wouldblock;
            let enet_dups = shared.enet_dup.swap(0, Ordering::Relaxed);
            let enet_window_drops = shared.enet_window_drops.swap(0, Ordering::Relaxed);
            let enet_received = shared.enet_received.swap(0, Ordering::Relaxed);
            adaptive.feed(now, idr, loss, wouldblock, enet_dups, enet_window_drops, enet_received);
            let previous = adaptive.current_kbps();
            if let Some((target, reason)) = adaptive.evaluate(now) {
                eprintln!(
                    "video: adaptive bitrate: {previous} -> {target} kbps (reason: {reason})"
                );
                if let Err(error) = pipeline.set_bitrate(target) {
                    eprintln!("video: adaptive reconfigure failed ({error}); continuing");
                }
            }
            if let Some((from, to, cause)) = adaptive.take_fec_transition() {
                eprintln!("video: FEC {from}% -> {to}% ({cause})");
            }
        }
        frame_index = frame_index.wrapping_add(1);
    }
}

/// Synthetic frame source for tests: emits annex-B-looking frames made of
/// a deterministic counter pattern at the configured size.
pub struct SyntheticPipeline {
    pub frame_size: usize,
    pub max_frames: u32,
    emitted: u32,
    first: Instant,
    pub fps: u32,
    /// Test seam for the frame-age policy: the first `stale_frames`
    /// emissions carry a capture timestamp `stale_age` in the past,
    /// simulating a capture pipeline that fell behind under load.
    pub stale_frames: u32,
    pub stale_age: Duration,
    /// The freshness budget the sender loop installs (see
    /// [`VideoPipeline::set_frame_age_budget`]): emissions older than it
    /// are never produced, mirroring the production pipeline's pre-encode
    /// gate. `None` until the loop installs one.
    age_budget: Option<Duration>,
    /// Emissions skipped at that gate (what the production pipeline
    /// reports through `pre_encode_stale_skips`).
    stale_skips: u32,
}

impl SyntheticPipeline {
    pub fn new(frame_size: usize, max_frames: u32, fps: u32) -> Self {
        SyntheticPipeline {
            frame_size,
            max_frames,
            emitted: 0,
            first: Instant::now(),
            fps: fps.max(1),
            stale_frames: 0,
            stale_age: Duration::ZERO,
            age_budget: None,
            stale_skips: 0,
        }
    }
}

impl VideoPipeline for SyntheticPipeline {
    fn encode_next(&mut self, force_idr: bool) -> Result<Option<EncodedFrame>, String> {
        loop {
            if self.emitted >= self.max_frames {
                return Ok(None);
            }
            // pace to fps so the sender loop behaves like a real capture
            let due = self.first + std::time::Duration::from_secs_f64(self.emitted as f64 / self.fps as f64);
            let now = Instant::now();
            if due > now {
                std::thread::sleep(due - now);
            }

            let capture = Instant::now()
                - if self.emitted < self.stale_frames {
                    self.stale_age
                } else {
                    Duration::ZERO
                };
            let idr = force_idr || self.emitted == 0;
            // Mirror the production pipeline's pre-encode gate (capture.rs):
            // a frame the sender could not ship is never produced at all, so
            // nothing downstream — least of all the encoder's reference
            // chain — can contain it. This source has no encoder latency to
            // project forward, so the frame's age IS the projection.
            let stale = self.age_budget.is_some_and(|budget| {
                matches!(
                    frame_age_decision(
                        Instant::now().saturating_duration_since(capture),
                        budget,
                        false
                    ),
                    FrameAgeDecision::Stale
                )
            });
            if !idr && stale {
                self.emitted += 1;
                self.stale_skips += 1;
                continue;
            }

            let mut data = Vec::with_capacity(self.frame_size);
            data.extend_from_slice(&[0, 0, 0, 1]);
            let mut counter = self.emitted as u32;
            while data.len() < self.frame_size {
                data.extend_from_slice(&counter.to_be_bytes());
                counter = counter.wrapping_add(1);
            }
            data.truncate(self.frame_size);

            self.emitted += 1;
            return Ok(Some(EncodedFrame {
                data,
                idr,
                capture,
                after_ref_invalidation: false,
                // a synthetic source has no capture side to stage-split
                stages: FrameStages::default(),
                duplicate: false,
            }));
        }
    }

    /// Frames actually produced: the emissions skipped at the pre-encode
    /// gate never became frames.
    fn encoded(&self) -> u64 {
        (self.emitted - self.stale_skips) as u64
    }

    fn set_frame_age_budget(&mut self, budget: Duration) {
        self.age_budget = Some(budget);
    }

    fn pre_encode_stale_skips(&self) -> u64 {
        self.stale_skips as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The empty-iteration backoff is exactly the spent-budget predicate:
    /// a pipeline that reports an intact budget (or has no pacing budget
    /// at all) keeps today's immediate re-poll, so nothing on the healthy
    /// path changes. The other half of the rule — that only an iteration
    /// which produced NO frame can reach this — is structural: the sender
    /// loop's only caller sits in the `let Some(frame) = frame else` arm.
    #[test]
    fn empty_poll_backoff_applies_only_on_a_spent_pacing_budget() {
        assert_eq!(empty_poll_backoff(false), Duration::ZERO);
        // a bounded nudge, not a stall: it is paid only on an iteration
        // that found the encoder already a full frame interval behind
        assert_eq!(empty_poll_backoff(true), Duration::from_millis(1));
    }

    #[test]
    fn annexb_nal_scanner_detects_sps_pps_idr() {
        // SPS + PPS + IDR, like a forced-IDR bitstream with in-band SPS
        let idr = [
            &[0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f][..], // SPS (type 7)
            &[0, 0, 0, 1, 0x68, 0xee, 0x3c, 0x80][..], // PPS (type 8)
            &[0, 0, 0, 1, 0x65, 0x88, 0x84, 0x00][..], // IDR slice (type 5)
        ]
        .concat();
        assert!(annexb_has_nal_type(&idr, 7), "SPS present");
        assert!(annexb_has_nal_type(&idr, 8), "PPS present");
        assert!(annexb_has_nal_type(&idr, 5), "IDR slice present");
        assert!(!annexb_has_nal_type(&idr, 1), "no non-IDR slice");

        // 3-byte start codes scan the same way
        let short = [0, 0, 1, 0x67, 0x42, 0x00];
        assert!(annexb_has_nal_type(&short, 7));

        // a P-frame carries neither SPS (repeatSPSPPS is IDR-only) nor IDR
        let p = [0, 0, 0, 1, 0x41, 0x9a, 0x22, 0x00];
        assert!(!annexb_has_nal_type(&p, 7));
        assert!(!annexb_has_nal_type(&p, 5));

        assert!(!annexb_has_nal_type(&[], 7));
        assert!(!annexb_has_nal_type(&[0, 0, 0, 1], 7), "no room for a header");
    }

    #[test]
    fn send_guard_counts_wouldblock_as_drop_and_never_gives_up() {
        let mut guard = SendGuard::new("test");
        guard.record(&Ok(1392));
        guard.record(&Err(io::Error::from(io::ErrorKind::WouldBlock)));
        guard.record(&Err(io::Error::new(io::ErrorKind::Other, "boom")));
        assert_eq!(guard.sent, 1);
        assert_eq!(guard.wouldblock, 1);
        assert_eq!(guard.errors, 1);

        // a long burst of backpressure keeps dropping without any
        // give-up path — the stream must survive a full send buffer
        for _ in 0..150 {
            guard.record(&Err(io::Error::from(io::ErrorKind::WouldBlock)));
        }
        assert_eq!(guard.wouldblock, 151);
        assert!(guard.summary().contains("sent=1"));
        assert!(guard.summary().contains("wouldblock-drops=151"));
    }

    fn parse_nv(packet: &[u8]) -> (u16, u32, u8, u8, u8, u8, u32) {
        assert_eq!(packet[0], 0x80 | RTP_EXTENSION_FLAG);
        assert_eq!(packet[1], VIDEO_PAYLOAD_TYPE);
        let sequence = u16::from_be_bytes(packet[2..4].try_into().unwrap());
        let _timestamp = u32::from_be_bytes(packet[4..8].try_into().unwrap());
        assert_eq!(&packet[8..12], &[0; 4]); // ssrc
        assert_eq!(&packet[12..16], &[0; 4]); // reserved
        let nv = &packet[16..32];
        let stream_index = u32::from_le_bytes(nv[0..4].try_into().unwrap());
        let frame_index = u32::from_le_bytes(nv[4..8].try_into().unwrap());
        // the RTP field carries only the low 16 bits of the stream-wide
        // packet counter the NV streamPacketIndex field widens to 24
        assert_eq!((stream_index >> 8) & 0xffff, sequence as u32);
        assert_eq!(stream_index & 0xff, 0);
        (
            sequence,
            frame_index,
            nv[8],  // flags
            nv[9],  // extraFlags
            nv[10], // multiFecFlags
            nv[11], // multiFecBlocks
            u32::from_le_bytes(nv[12..16].try_into().unwrap()), // fecInfo
        )
    }

    #[test]
    fn single_packet_frame_has_sof_and_eof() {
        let mut packetizer = VideoPacketizer::new(1392, 0);
        let datagrams = packetizer.packetize(7, &[0xAA; 100], true, 12345, 0, false);
        assert_eq!(datagrams.len(), 1);

        let packet = &datagrams[0];
        // shards are zero-padded to the full shard size (packetSize + 16)
        // for FEC; the payload ends with zeros
        assert_eq!(packet.len(), 1392 + 16);
        let (sequence, frame_index, flags, extra, multi_flags, multi_blocks, fec_info) =
            parse_nv(packet);
        assert_eq!(sequence, 0);
        assert_eq!(frame_index, 7);
        assert_eq!(flags, FLAG_CONTAINS_PIC_DATA | FLAG_SOF | FLAG_EOF);
        assert_eq!(extra, 0);
        assert_eq!(multi_flags, MULTI_FEC_FLAGS);
        assert_eq!(multi_blocks, 0);
        assert_eq!(fec_info, 1 << 22); // shard 0, 1 data shard, fec 0%

        // short frame header: type 0x01, latency 0, frame type 2 (IDR),
        // lastPayloadLen == payload size (single packet frame)
        let payload = &packet[32..];
        assert_eq!(payload[0], 0x01);
        assert_eq!(&payload[1..3], &[0, 0]);
        assert_eq!(payload[3], 2);
        let last_payload_len = u16::from_le_bytes(payload[4..6].try_into().unwrap()) as usize;
        assert_eq!(last_payload_len, 100 + 8);
        assert_eq!(&payload[6..8], &[0, 0]);
        assert_eq!(&payload[8..108], &[0xAA; 100]);
        assert!(payload[108..].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn frame_after_ref_invalidation_is_frame_type_5() {
        // Sunshine stream.cpp:1577-1579: the first frame after a
        // reference-frame invalidation rides frameType 5 (the client
        // drops references older than the invalidated range); a normal
        // frame is 1, an IDR is 2 and wins over the mark.
        let mut packetizer = VideoPacketizer::new(1392, 0);
        let marked = packetizer.packetize(8, &[0xBB; 50], false, 1, 0, true);
        assert_eq!(marked.len(), 1);
        assert_eq!(marked[0][32 + 3], 5);

        let normal = packetizer.packetize(9, &[0xBB; 50], false, 1, 0, false);
        assert_eq!(normal[0][32 + 3], 1);

        // an IDR carrying the mark still reports frameType 2
        let idr = packetizer.packetize(10, &[0xBB; 50], true, 1, 0, true);
        assert_eq!(idr[0][32 + 3], 2);
    }

    #[test]
    fn fragmentation_respects_packet_size_and_continues_sequences() {
        let mut packetizer = VideoPacketizer::new(64, 0);
        // payload block = 64 - 16 = 48 bytes of frame data per packet
        let frame = vec![0xBB; 100]; // + 8 byte header = 108 -> 3 packets (48, 48, 12)
        let datagrams = packetizer.packetize(0, &frame, false, 999, 0, false);
        assert_eq!(datagrams.len(), 3);
        // full shards (packetSize + 16), zero-padded after the payload
        assert_eq!(datagrams[0].len(), 64 + 16);
        assert_eq!(datagrams[1].len(), 64 + 16);
        assert_eq!(datagrams[2].len(), 64 + 16);

        let (_, _, flags0, _, _, _, fec0) = parse_nv(&datagrams[0]);
        let (_, _, flags1, _, _, _, fec1) = parse_nv(&datagrams[1]);
        let (_, _, flags2, _, _, _, fec2) = parse_nv(&datagrams[2]);
        assert_eq!(flags0, FLAG_CONTAINS_PIC_DATA | FLAG_SOF);
        assert_eq!(flags1, FLAG_CONTAINS_PIC_DATA);
        assert_eq!(flags2, FLAG_CONTAINS_PIC_DATA | FLAG_EOF);

        // fecInfo: shard index at bits 12+, data shard count at bits 22+
        assert_eq!(fec0, 3 << 22);
        assert_eq!(fec1, (1 << 12) | (3 << 22));
        assert_eq!(fec2, (2 << 12) | (3 << 22));

        // the short frame header starts the FIRST chunk; its
        // lastPayloadLen field is the final chunk size (108 % 48 == 12)
        let payload0 = &datagrams[0][32..];
        assert_eq!(u16::from_le_bytes(payload0[4..6].try_into().unwrap()), 12);
        // P-frame type
        assert_eq!(payload0[3], 1);
        // the last chunk carries exactly the remainder, zero-padded
        assert_eq!(&datagrams[2][32..32 + 12], &[0xBB; 12]);
        assert!(datagrams[2][32 + 12..].iter().all(|byte| *byte == 0));

        // sequences are continuous across packets and frames
        assert_eq!(packetizer.sequence(), 3);
        let next = packetizer.packetize(1, &[0; 10], false, 1000, 0, false);
        assert_eq!(parse_nv(&next[0]).0, 3);
        assert_eq!(packetizer.sequence(), 4);
    }

    /// The client masks the NV `streamPacketIndex` to 24 bits
    /// (VideoDepacketizer.c: `>>= 8; &= 0xFFFFFF`) and drops every packet
    /// that does not follow its last one in that space, so a counter
    /// wrapping at 65536 reads as a corrupt frame forever. Drive one
    /// packet per frame past the wrap: the NV index must keep counting,
    /// the RTP sequence must wrap.
    #[test]
    fn stream_packet_index_stays_contiguous_across_the_16_bit_wrap() {
        let mut packetizer = VideoPacketizer::new(64, 0);
        for packet_index in 0..=65_536u32 {
            let datagrams =
                packetizer.packetize(packet_index, &[0x77; 8], false, packet_index, 0, false);
            assert_eq!(datagrams.len(), 1);
            let packet = &datagrams[0];
            let stream_index = u32::from_le_bytes(packet[16..20].try_into().unwrap()) >> 8;
            let rtp = u16::from_be_bytes(packet[2..4].try_into().unwrap());
            assert_eq!(stream_index, packet_index, "NV index of packet {packet_index}");
            assert_eq!(
                rtp as u32,
                packet_index & 0xffff,
                "RTP sequence of packet {packet_index}"
            );
        }
        assert_eq!(packetizer.sequence(), 65_537);
    }

    #[test]
    fn exact_multiple_fills_last_packet() {
        let mut packetizer = VideoPacketizer::new(64, 0);
        // 2 * 48 - 8 = 88 bytes of encoded data => exactly 2 full packets
        let datagrams = packetizer.packetize(0, &vec![0xCC; 88], false, 0, 0, false);
        assert_eq!(datagrams.len(), 2);
        assert_eq!(datagrams[1].len(), 64 + 16);
        let payload0 = &datagrams[0][32..];
        assert_eq!(
            u16::from_le_bytes(payload0[4..6].try_into().unwrap()),
            48 // lastPayloadLen falls back to the full block
        );
    }

    #[test]
    fn synthetic_pipeline_paces_and_marks_first_frame_idr() {
        let mut pipeline = SyntheticPipeline::new(1000, 2, 1000);
        let first = pipeline.encode_next(false).unwrap().unwrap();
        assert!(first.idr);
        assert_eq!(first.data.len(), 1000);
        assert_eq!(&first.data[..4], &[0, 0, 0, 1]);
        let second = pipeline.encode_next(true).unwrap().unwrap();
        assert!(second.idr);
        assert!(pipeline.encode_next(false).unwrap().is_none());
    }

    #[test]
    fn p_suppression_enters_on_request_and_exits_after_quiet_period() {
        const MS: Duration = Duration::from_millis(1);
        let t0 = Instant::now();
        let mut s = PSuppression::new(1000 * MS);
        assert!(!s.active());

        // an applied client request enters suppression immediately
        assert!(s.update(t0, Duration::ZERO));
        assert!(s.active());
        // any age inside the quiet period keeps it on (client still begging)
        assert!(s.update(t0 + 500 * MS, 500 * MS));
        assert!(s.update(t0 + 999 * MS, 999 * MS));
        // the quiet period elapsed: the first P-frame decision confirms
        // recovery and resumes normal operation
        assert!(!s.update(t0 + 1000 * MS, 1000 * MS));
        assert!(!s.active());

        // a fresh request starts a new episode
        assert!(s.update(t0 + 1100 * MS, Duration::ZERO));
        assert!(s.active());
    }

    #[test]
    fn p_suppression_never_activates_without_an_applied_request() {
        // a forced IDR encoded with no outstanding client request episode
        // (stream start, display recreation) is confirmed by the quiet
        // rule trivially: a normal stream with no begging must flow
        // P-frames unaffected
        const MS: Duration = Duration::from_millis(1);
        let t0 = Instant::now();
        let mut s = PSuppression::new(1000 * MS);
        let ancient = Duration::from_millis(1_000_000); // no request ever
        assert!(!s.update(t0, ancient));
        s.note_idr_encoded(t0); // stream-start IDR
        assert!(!s.update(t0 + 30_000 * MS, ancient));
        assert!(!s.idr_due(t0 + 30_000 * MS));
    }

    /// The self-drive retry cadence is the same 200ms floor the control
    /// gate holds. The old ladder's 50ms first-retry and 50ms escalated
    /// rungs were the keyframe flood the 2026-09-14 session measured
    /// (951 forced IDRs, ~95KB each, ~44% of a 25Mbps stream), so the
    /// episode's first IDR is due immediately and every retry after it
    /// waits out the floor — nothing here may fire sooner than the client
    /// can have decoded the last keyframe.
    #[test]
    fn p_suppression_idr_due_holds_the_200ms_floor() {
        const MS: Duration = Duration::from_millis(1);
        let t0 = Instant::now();
        let mut s = PSuppression::new(1000 * MS);
        // not active: never due
        assert!(!s.idr_due(t0));

        assert!(s.update(t0, Duration::ZERO));
        // the episode owes its first IDR immediately
        assert!(s.idr_due(t0));
        s.note_idr_encoded(t0);
        // every retry after the first waits out the floor: no 50ms rung
        assert!(!s.idr_due(t0 + 50 * MS));
        assert!(!s.idr_due(t0 + 199 * MS));
        assert!(s.idr_due(t0 + 200 * MS));
        s.note_idr_encoded(t0 + 200 * MS);
        assert!(!s.idr_due(t0 + 399 * MS));
        assert!(s.idr_due(t0 + 400 * MS));
    }

    /// The starvation warning stays the operator-facing signal for a
    /// client that begs for minutes: it keeps its 10s-then-every-5s
    /// cadence while the wave lasts, and it fires even though suppression
    /// itself is now capped. The old version of this test asserted the
    /// opposite of the fix — that begging alone keeps suppression on
    /// indefinitely — which is the 2026-09-14 livelock (see
    /// p_suppression_cannot_be_held_on_by_continuous_begging).
    #[test]
    fn p_suppression_warns_while_begging_continues_but_caps_the_episode() {
        const MS: Duration = Duration::from_millis(1);
        let t0 = Instant::now();
        let mut s = PSuppression::new(60_000 * MS); // begging continues
        assert!(s.update(t0, Duration::ZERO));
        assert_eq!(s.warnings, 0);
        // before 10s: silent
        assert!(s.update(t0 + 5_000 * MS, Duration::ZERO));
        assert_eq!(s.warnings, 0);
        // the 10s guard: first warning
        assert!(s.update(t0 + 10_000 * MS, Duration::ZERO));
        assert_eq!(s.warnings, 1);
        // then every 5s, not sooner
        assert!(s.update(t0 + 12_000 * MS, Duration::ZERO));
        assert_eq!(s.warnings, 1);
        // the hard cap: no IDR was ever encoded, so nothing else can close
        // the episode — it ends here and does not reopen while the wave
        // continues, warning or not
        assert!(!s.update(t0 + 14_999 * MS, Duration::ZERO));
        assert!(!s.active());
        assert_eq!(s.warnings, 1);
        assert!(!s.update(t0 + 15_000 * MS, Duration::ZERO));
        assert_eq!(s.warnings, 2);
        assert!(!s.update(t0 + 20_000 * MS, Duration::ZERO));
        assert_eq!(s.warnings, 3);
        // begging stops: recovery confirms, the wave and its cap reset
        assert!(!s.update(t0 + 20_000 * MS, 60_001 * MS));
        // a new wave resets the warning cadence and opens its own episode
        assert!(s.update(t0 + 21_000 * MS, Duration::ZERO));
        assert!(s.update(t0 + 31_000 * MS, Duration::ZERO));
        assert_eq!(s.warnings, 4, "fresh wave warns again at its own +10s");
    }

    /// Regression for the logged livelock (2026-09-14: 6846 forced IDRs
    /// over 332s, 28.6fps delivered against 60 requested,
    /// p-suppressed=16144): the client begged every ~50ms, the starvation
    /// gate kept APPLYING those requests, and the old episode rule — stay
    /// suppressed while `applied_age < quiet` — was permanently true with
    /// them, so the sender ran IDR-only at the gate's cadence forever.
    /// Suppression must end once an IDR has been sent: continuous begging
    /// can no longer hold P-frames off the wire (a false here is what the
    /// sender loop reads as "encode and ship the P-frame"), while the
    /// starvation warning still tells the operator the client is starving.
    #[test]
    fn p_suppression_cannot_be_held_on_by_continuous_begging() {
        const MS: Duration = Duration::from_millis(1);
        let t0 = Instant::now();
        let mut s = PSuppression::new(1000 * MS);
        // 20s of the logged shape: one frame decision per 16ms iteration
        // (60fps), an applied request every 50ms (the old gate's escalated
        // rung, ~20/s — a worst case the 200ms-floor gate can no longer
        // produce, which is exactly what makes it worth guarding here),
        // and each episode's forced IDR encoded in the very iteration
        // that asked for it.
        let mut decisions = 0u64;
        let mut suppressed = 0u64;
        for step in 0..1_250u64 {
            let now = t0 + Duration::from_millis(16 * step);
            let applied_age = Duration::from_millis((16 * step) % 50);
            decisions += 1;
            if s.update(now, applied_age) {
                suppressed += 1;
                s.note_idr_encoded(now); // the loop's forced IDR
            }
        }
        assert!(
            suppressed <= 2,
            "continuous begging sustained suppression for {suppressed} of {decisions} decisions"
        );
        assert!(
            !s.active(),
            "suppression must be off once the wave's IDR was sent"
        );
        assert!(
            s.warnings >= 2,
            "a 20s begging wave must still reach the operator as a starvation warning"
        );
    }

    /// The hard cap is the backstop for the shape the "IDR was sent" exit
    /// cannot cover: the episode asks the encoder for an IDR and none ever
    /// arrives (stalled capture, dead encoder) while the client keeps
    /// begging. Suppression must end anyway — it may not outlive the thing
    /// it is waiting for — and the wave it ended in may not open another
    /// episode, or the cap would just reset every decision.
    #[test]
    fn p_suppression_hard_cap_ends_an_episode_without_an_idr() {
        const MS: Duration = Duration::from_millis(1);
        let t0 = Instant::now();
        let mut s = PSuppression::new(1000 * MS);
        let mut suppressed = 0u64;
        for step in 0..50u64 {
            if s.update(t0 + 16 * MS * step as u32, Duration::ZERO) {
                suppressed += 1;
            }
        }
        assert_eq!(
            suppressed, MAX_EPISODE_UPDATES,
            "the episode must end at the cap, not at the end of the wave"
        );
        assert!(!s.active(), "the cap ends the episode unconditionally");
        assert!(
            !s.update(t0 + 51 * 16 * MS, Duration::ZERO),
            "a capped wave must not reopen an episode"
        );
        // begging stops (the quiet period elapses): the cap releases and a
        // fresh wave gets its own episode
        assert!(!s.update(t0 + 20_000 * MS, 1001 * MS));
        assert!(s.update(t0 + 20_016 * MS, Duration::ZERO));
    }

    #[test]
    fn frame_age_decision_table() {
        let budget = Duration::from_millis(21); // 1.25x the 60fps interval

        // comfortably within the budget ships
        assert_eq!(
            frame_age_decision(Duration::from_millis(5), budget, false),
            FrameAgeDecision::Fresh
        );
        // exactly at the budget ships (the budget is inclusive)
        assert_eq!(
            frame_age_decision(budget, budget, false),
            FrameAgeDecision::Fresh
        );
        // one nanosecond past the budget drops
        assert_eq!(
            frame_age_decision(budget + Duration::from_nanos(1), budget, false),
            FrameAgeDecision::Stale
        );
        // the measured overload from the field report: acquire→encode
        // p95 of 37ms at 60fps must never be shipped
        assert_eq!(
            frame_age_decision(Duration::from_millis(37), budget, false),
            FrameAgeDecision::Stale
        );
        // an explicitly forced IDR is exempt at any age: it is the
        // client's recovery mechanism and is always decodable
        assert_eq!(
            frame_age_decision(Duration::from_secs(5), budget, true),
            FrameAgeDecision::Fresh
        );
        assert_eq!(
            frame_age_decision(Duration::ZERO, budget, true),
            FrameAgeDecision::Fresh
        );
        // zero age against a zero budget ships
        assert_eq!(
            frame_age_decision(Duration::ZERO, Duration::ZERO, false),
            FrameAgeDecision::Fresh
        );
    }

    /// The pre-encode form of the same decision — the whole point of moving
    /// it ahead of the encode: the frames the sender must not ship are the
    /// frames the encoder must never see, because the encoder would use
    /// them as references. A frame projected past the budget is a
    /// submission the pipeline skips (nothing is encoded, so nothing can
    /// reference it); a frame inside it is submitted; an IDR is exempt at
    /// any age, exactly as in the post-encode relief valve.
    #[test]
    fn pre_encode_gate_never_submits_a_frame_it_cannot_ship() {
        let ms = Duration::from_millis;
        let secs = Duration::from_secs;
        let budget = ms(50);
        // the encoder latency measured at the 1080p60 floor (acquire→encode
        // p95 20.5ms in the session that motivated the gate)
        let latency = ms(21);

        // fresh capture, idle encoder: 2 + 21 = 23ms — submitted
        assert_eq!(
            frame_age_decision(projected_encode_age(ms(2), 0, latency), budget, false),
            FrameAgeDecision::Fresh
        );
        // one frame already inside the encoder: its latency is projected
        // forward too (44ms) — still inside the budget, still submitted
        assert_eq!(
            frame_age_decision(projected_encode_age(ms(2), 1, latency), budget, false),
            FrameAgeDecision::Fresh
        );
        // two queued: 65ms. This frame would only be handed over after the
        // budget, so it is never submitted — this is precisely the frame
        // the old gate encoded, used as a reference, and then dropped.
        assert_eq!(
            frame_age_decision(projected_encode_age(ms(2), 2, latency), budget, false),
            FrameAgeDecision::Stale
        );
        // an already-stale capture is skipped at any encoder speed
        assert_eq!(
            frame_age_decision(projected_encode_age(ms(60), 0, Duration::ZERO), budget, false),
            FrameAgeDecision::Stale
        );
        // the budget is inclusive, one nanosecond past it is not
        assert_eq!(
            frame_age_decision(projected_encode_age(ms(29), 0, latency), budget, false),
            FrameAgeDecision::Fresh
        );
        assert_eq!(
            frame_age_decision(
                projected_encode_age(ms(29), 0, latency) + Duration::from_nanos(1),
                budget,
                false
            ),
            FrameAgeDecision::Stale
        );
        // an IDR is exempt at any age: it is the client's recovery
        // mechanism and references nothing
        assert_eq!(
            frame_age_decision(projected_encode_age(secs(5), 2, latency), budget, true),
            FrameAgeDecision::Fresh
        );
        // the projection is a pure sum and saturates (never wraps)
        assert_eq!(projected_encode_age(ms(1), 0, Duration::ZERO), ms(1));
        assert_eq!(
            projected_encode_age(Duration::MAX, 3, latency),
            Duration::MAX
        );
    }

    /// A drop of an already-encoded frame must never leave the client's
    /// reference chain broken: the pipeline that drops it has to make the
    /// next frame a full IDR (frameType 2 — the only thing this
    /// RFI-incapable client resumes on), because the dropped frame is
    /// already the reference for the frame behind it. The pipeline below
    /// hands back a frame whose age only the encode could reveal (submitted
    /// inside the budget, delivered 200ms past it — it implements no
    /// pre-encode gate at all, which is the residual path the sender loop's
    /// relief valve exists for), and then offers a perfectly fresh P-frame:
    /// exactly the frame that must not reach the wire unreferenced. Run
    /// with --nocapture to see the drop line.
    #[test]
    fn a_post_encode_drop_forces_the_next_frame_to_idr() {
        struct LatePipeline {
            state: u32,
        }
        impl VideoPipeline for LatePipeline {
            fn encode_next(&mut self, force_idr: bool) -> Result<Option<EncodedFrame>, String> {
                self.state += 1;
                let (age, idr) = match self.state {
                    1 => (Duration::ZERO, true),
                    // the frame only the encoder could reveal as stale
                    2 => (Duration::from_millis(200), false),
                    // a fresh P-frame — unless the loop forces an IDR
                    3 => (Duration::ZERO, force_idr),
                    _ => return Ok(None),
                };
                std::thread::sleep(Duration::from_millis(16));
                Ok(Some(EncodedFrame {
                    data: vec![0xAA; 4000],
                    idr,
                    capture: Instant::now() - age,
                    after_ref_invalidation: false,
                    stages: FrameStages::default(),
                    duplicate: false,
                }))
            }
        }

        let server = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let server_addr = server.local_addr().unwrap();
        let client = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        client.connect(server_addr).unwrap();
        client
            .set_read_timeout(Some(Duration::from_millis(200)))
            .unwrap();
        // establish the client endpoint BEFORE the sender starts, like
        // Moonlight's ping does, so the opening IDR is not dropped for an
        // unknown peer
        client.send(b"PING").unwrap();

        let shared = StreamShared::new();
        let stop = shared.clone();
        let video = std::thread::spawn(move || {
            run_video_loop(
                server,
                shared,
                Box::new(LatePipeline { state: 0 }),
                1392,
                0,
                0,
                Duration::from_millis(16),
                1920,
                1080,
                60,
                10_000,
                None,
            )
        });

        let mut seen: Vec<(u32, u8)> = Vec::new();
        let mut buffer = [0u8; 2048];
        let deadline = Instant::now() + Duration::from_millis(500);
        while Instant::now() < deadline {
            let _ = client.send(&[0x70; 4]);
            for _ in 0..64 {
                match client.recv(&mut buffer) {
                    Ok(_) => {
                        let nv = &buffer[16..32];
                        if nv[8] & FLAG_SOF == 0 {
                            continue;
                        }
                        let frame_index = u32::from_le_bytes(nv[4..8].try_into().unwrap());
                        let frame_type = buffer[32 + 3];
                        if !seen.iter().any(|(index, _)| *index == frame_index) {
                            seen.push((frame_index, frame_type));
                        }
                    }
                    Err(_) => break,
                }
            }
        }
        stop.stop.store(true, Ordering::Relaxed);
        video.join().expect("video loop").expect("video loop result");

        assert!(seen.len() >= 2, "expected the two frames: {seen:?}");
        assert_eq!(seen[0], (1, 2), "the stream opens on an IDR: {seen:?}");
        // the dropped frame consumed no frame number (a gap reads as a lost
        // frame to the client) and the frame that follows it is a full IDR
        assert_eq!(
            seen[1].0, 2,
            "a post-encode drop must not consume a frame number: {seen:?}"
        );
        assert_eq!(
            seen[1].1, 2,
            "the frame after a post-encode drop must be a full IDR (frameType 2), \
             not a P-frame referencing the frame the client never got: {seen:?}"
        );
    }

    #[test]
    fn periodic_keyframe_due_arms_only_after_the_interval() {
        const MS: Duration = Duration::from_millis(1);
        let t0 = Instant::now();
        let mut k = PeriodicKeyframe::new(Some(500 * MS), t0);
        // anchored at construction: not due inside the first interval
        assert!(!k.due(t0 + 499 * MS));
        assert!(k.due(t0 + 500 * MS));
        // the arm is recorded: a second fire inside the interval is a
        // no-op even though no IDR encoded yet (armed-but-never-landed
        // must not re-log every iteration)
        assert!(!k.due(t0 + 501 * MS));
        assert!(!k.due(t0 + 999 * MS));
        assert!(k.due(t0 + 1000 * MS));
    }

    #[test]
    fn periodic_keyframe_any_idr_resets_the_cadence() {
        const MS: Duration = Duration::from_millis(1);
        let t0 = Instant::now();
        let mut k = PeriodicKeyframe::new(Some(500 * MS), t0);
        // an IDR from any other cause (client request, suppression
        // ladder, stream start) re-anchors the cadence: the periodic
        // trigger stays silent until the interval elapses again
        k.note_idr_encoded(t0 + 100 * MS);
        assert!(!k.due(t0 + 599 * MS));
        assert!(k.due(t0 + 600 * MS));
    }

    #[test]
    fn periodic_keyframe_disabled_never_fires() {
        let t0 = Instant::now();
        let mut k = PeriodicKeyframe::new(None, t0);
        assert!(!k.due(t0 + Duration::from_secs(3600)));
        k.note_idr_encoded(t0);
        assert!(!k.due(t0 + Duration::from_secs(7200)));
    }

    /// End-to-end: with the default 2000ms keyframe interval, the sender
    /// loop emits a hygiene IDR every interval during completely normal
    /// streaming (no client requests): frame 1 IDR at start, then an IDR
    /// at ~2000ms with P-frames flowing before and after it. The periodic
    /// IDR must not look like a client request: idr_last_applied_ms stays
    /// at its no-request sentinel (suppression never engages).
    #[test]
    fn periodic_keyframe_emitted_during_normal_streaming() {
        let server = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let server_addr = server.local_addr().unwrap();
        let client = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        client.connect(server_addr).unwrap();
        client
            .set_read_timeout(Some(Duration::from_millis(200)))
            .unwrap();

        let shared = StreamShared::new();
        let stop = shared.clone();
        let watch = shared.clone();
        let video = std::thread::spawn(move || {
            run_video_loop(
                server,
                shared,
                Box::new(SyntheticPipeline::new(4_000, 200, 60)),
                1392,
                10,
                0,
                Duration::from_millis(16),
                1920,
                1080,
                60,
                60_000,
                None,
            )
        });

        let start = Instant::now();
        let deadline = start + Duration::from_millis(2500);
        let mut seen: Vec<(Instant, u32, u8)> = Vec::new();
        let mut buffer = [0u8; 2048];
        while Instant::now() < deadline {
            let _ = client.send(&[0x70; 4]);
            for _ in 0..64 {
                match client.recv(&mut buffer) {
                    Ok(_) => {
                        let nv = &buffer[16..32];
                        let frame_index = u32::from_le_bytes(nv[4..8].try_into().unwrap());
                        if nv[8] & FLAG_SOF == 0 {
                            continue;
                        }
                        let frame_type = buffer[32 + 3];
                        if !seen.iter().any(|(_, index, _)| *index == frame_index) {
                            seen.push((Instant::now(), frame_index, frame_type));
                        }
                    }
                    Err(_) => break,
                }
            }
        }
        stop.stop.store(true, Ordering::Relaxed);
        video.join().expect("video loop").expect("video loop result");

        let in_window = |from: Duration, to: Duration| {
            seen.iter()
                .filter(|(at, _, _)| {
                    let at = at.duration_since(start);
                    at >= from && at < to
                })
                .collect::<Vec<_>>()
        };

        // P-frames flow before the first periodic IDR, with no IDR of
        // any kind once the stream-start IDR has passed
        let early = in_window(Duration::from_millis(50), Duration::from_millis(1900));
        assert!(
            early.iter().any(|(_, _, t)| *t == 1),
            "no P-frames before the first periodic IDR: {early:?}"
        );
        assert!(
            early.iter().all(|(_, _, t)| *t == 1),
            "unexpected IDR before the interval elapsed: {early:?}"
        );
        // the hygiene IDR lands at ~2000ms (the window absorbs frame-pacing
        // jitter around the exact cadence)
        let hygiene = in_window(Duration::from_millis(1900), Duration::from_millis(2400));
        assert!(
            hygiene.iter().any(|(_, _, t)| *t == 2),
            "no periodic IDR one interval in: {hygiene:?}"
        );
        // P-frames resume after the hygiene IDR
        let late = in_window(Duration::from_millis(2100), Duration::from_millis(2500));
        assert!(
            late.iter().any(|(_, _, t)| *t == 1),
            "no P-frames after the periodic IDR: {late:?}"
        );

        // the hygiene IDR is not an applied client request: the
        // no-request sentinel stays put and suppression never engages
        assert_eq!(
            watch.idr_last_applied_ms.load(Ordering::Relaxed),
            0,
            "periodic keyframe must not count as an applied client request"
        );
    }

    /// The periodic trigger must also fire when the pipeline never
    /// produces a frame — the idle-desktop shape where every acquire
    /// times out and capture.rs returns Ok(None) after its pause. After
    /// one interval with no IDR encoded, idr_pending must be armed (the
    /// duplicate path re-encodes the last texture as an IDR through the
    /// same force_idr plumbing), still without stamping
    /// idr_last_applied_ms.
    #[test]
    fn periodic_keyframe_arms_idr_pending_when_pipeline_idle() {
        struct IdlePipeline;
        impl VideoPipeline for IdlePipeline {
            fn encode_next(&mut self, _force_idr: bool) -> Result<Option<EncodedFrame>, String> {
                // idle-desktop acquire timeout: paced, no frame
                std::thread::sleep(Duration::from_millis(8));
                Ok(None)
            }
        }

        let server = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let shared = StreamShared::new();
        let stop = shared.clone();
        let watch = shared.clone();
        let video = std::thread::spawn(move || {
            run_video_loop(
                server,
                shared,
                Box::new(IdlePipeline),
                1392,
                10,
                0,
                Duration::from_millis(16),
                1920,
                1080,
                60,
                60_000,
                None,
            )
        });

        // default interval is 2000ms; give the loop a comfortable margin
        std::thread::sleep(Duration::from_millis(2300));
        assert!(
            watch.idr_pending.load(Ordering::Relaxed),
            "periodic keyframe must arm idr_pending while the desktop is idle"
        );
        assert_eq!(
            watch.idr_last_applied_ms.load(Ordering::Relaxed),
            0,
            "periodic keyframe must not count as an applied client request"
        );
        stop.stop.store(true, Ordering::Relaxed);
        video.join().expect("video loop").expect("video loop result");
    }

    #[test]
    fn rate_limiter_schedule_and_batch_math() {
        // 1408-byte shard (Moonlight default packetSize 1392 + 16): 900Mbps
        // floors to 79 packets/ms (~12.7µs/packet). Sunshine's 80%-of-1Gbps
        // formula at the same shard size computes 71 (stream.cpp:1660).
        assert_eq!(packets_per_quantum(1408), 79);
        let sunshine = 1_000_000_000u64 * 80 / 100 / 1000 / 1408 / 8;
        assert_eq!(sunshine, 71);
        assert!(packets_per_quantum(40) >= 1);
        // batches: 64KB / shard bytes, capped at 64 packets (and at 1)
        assert_eq!(send_batch_size(1408), 46);
        assert_eq!(send_batch_size(16), 64); // tiny packets -> packet cap
        assert_eq!(send_batch_size(64 * 1024), 1);

        let limiter = SendRateLimiter::new(1408, Instant::now());
        assert_eq!(limiter.batch_size(), 46);
        assert_eq!(limiter.packets_per_quantum(), 79);
        // ppq packets drain exactly one quantum; multiples stay exact
        assert_eq!(limiter.schedule(0), Duration::ZERO);
        assert_eq!(limiter.schedule(79), Duration::from_millis(1));
        assert_eq!(limiter.schedule(158), Duration::from_millis(2));
        // a 60-packet frame's schedule fits in ~0.76ms (Sunshine's
        // description: a 60-packet frame ships in ~0.6ms at 80%)
        assert!(limiter.schedule(60) < Duration::from_millis(2));
        // a 150-packet IDR in ~1.9ms — negligible latency, no microburst
        assert!(limiter.schedule(150) < Duration::from_millis(3));
    }

    #[test]
    fn rate_limiter_carries_credit_across_frames() {
        let mut now = Instant::now();
        let mut limiter = SendRateLimiter::new(1408, now);

        // frame 1: 200 packets land instantly (note_sent only) — its
        // schedule end becomes the credit carried into frame 2
        limiter.begin_frame(now);
        limiter.note_sent(200);
        limiter.finish_frame();
        let credit = limiter.schedule(200);
        assert_eq!(credit, Duration::from_nanos(1_000_000 * 200 / 79));

        // frame 2 arriving mid-credit must wait out the remainder before
        // its first batch, then its own drain
        now += Duration::from_millis(1);
        limiter.begin_frame(now);
        let wait = limiter.planned_send_duration(1, now);
        assert_eq!(wait, credit - Duration::from_millis(1) + limiter.schedule(1));

        // frame 3 arriving after the credit expired starts immediately:
        // the limiter never accrues debt (begin_frame clamps to now)
        let later = now + Duration::from_millis(10);
        limiter.begin_frame(later);
        assert_eq!(
            limiter.planned_send_duration(10, later),
            limiter.schedule(10)
        );
    }

    /// P-frame suppression end-to-end, in the shape of the logged livelock
    /// (2026-09-14): the client presents an APPLIED IDR request
    /// (idr_pending + idr_last_applied_ms, exactly what State::request_idr
    /// publishes on a gate apply) every 50ms — the old gate's escalated
    /// rung, faster than the new 200ms floor can ever apply — and never
    /// lets up. The loop must still serve the IDRs those requests
    /// ask for and hand straight back to P-frames: the old
    /// "suppressed while `applied_age < quiet`" rule stayed on for the
    /// whole run with the client begging this fast (that session delivered
    /// 28.6fps against 60 requested and spent minutes IDR-only). Run with
    /// --nocapture to see the frame timeline and the ON/OFF lines.
    #[test]
    fn continuous_begging_cannot_hold_the_loop_in_idr_only_mode() {
        let server = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let server_addr = server.local_addr().unwrap();
        let client = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        client.connect(server_addr).unwrap();
        client
            .set_read_timeout(Some(Duration::from_millis(200)))
            .unwrap();

        let shared = StreamShared::new();
        let stop = shared.clone();
        let beg = shared.clone();
        let video = std::thread::spawn(move || {
            run_video_loop(
                server,
                shared,
                Box::new(SyntheticPipeline::new(4_000, 600, 60)),
                1392,
                10,
                0,
                Duration::from_millis(16),
                1920,
                1080,
                60,
                60_000,
                None,
            )
        });

        // frame types by arrival time; the SOF shard carries the
        // Sunshine short frame header (type 2 = IDR, 1 = P) at payload+3
        let start = Instant::now();
        let beg_at = start + Duration::from_millis(500);
        let deadline = start + Duration::from_millis(2400);
        // the client's begging runs on its own thread so the cadence is
        // real: one APPLIED request every 50ms, never stopping
        let beggar = std::thread::spawn(move || {
            while Instant::now() < beg_at {
                std::thread::sleep(Duration::from_millis(5));
            }
            while Instant::now() < deadline {
                // exactly what State::request_idr does on an apply
                beg.idr_pending.store(true, Ordering::Relaxed);
                beg.note_idr_request_applied();
                std::thread::sleep(Duration::from_millis(50));
            }
        });
        let mut seen: Vec<(Instant, u32, u8)> = Vec::new();
        let mut buffer = [0u8; 2048];
        while Instant::now() < deadline {
            let _ = client.send(&[0x70; 4]);
            for _ in 0..64 {
                match client.recv(&mut buffer) {
                    Ok(_) => {
                        let nv = &buffer[16..32];
                        let frame_index = u32::from_le_bytes(nv[4..8].try_into().unwrap());
                        if nv[8] & FLAG_SOF == 0 {
                            continue;
                        }
                        let frame_type = buffer[32 + 3];
                        if !seen.iter().any(|(_, index, _)| *index == frame_index) {
                            seen.push((Instant::now(), frame_index, frame_type));
                        }
                    }
                    Err(_) => break,
                }
            }
        }
        stop.stop.store(true, Ordering::Relaxed);
        video.join().expect("video loop").expect("video loop result");
        beggar.join().expect("beggar");

        eprintln!(
            "begging timeline: {}",
            seen
                .iter()
                .map(|(at, index, t)| format!(
                    "[{}ms f{} t{}]",
                    at.duration_since(start).as_millis(),
                    index,
                    t
                ))
                .collect::<Vec<_>>()
                .join(" ")
        );

        let in_window = |from: Duration, to: Duration| {
            seen.iter()
                .filter(|(at, _, _)| {
                    let at = at.duration_since(start);
                    at >= from && at < to
                })
                .collect::<Vec<_>>()
        };
        let ms = |d: Duration| d.as_millis() as u64;

        // normal operation before the beg: P-frames flow
        let pre = in_window(Duration::from_millis(100), Duration::from_millis(500));
        assert!(
            pre.iter().any(|(_, _, t)| *t == 1),
            "no P-frames before the request: {pre:?}"
        );
        // the applied request still gets the IDR it asked for
        let answered = in_window(Duration::from_millis(500), Duration::from_millis(700));
        assert!(
            answered.iter().any(|(_, _, t)| *t == 2),
            "an applied client request must still force an IDR: {answered:?}"
        );
        // and P-frames keep flowing while the client begs on: suppression
        // ends with the IDR it was waiting for, so the run is never
        // IDR-only even though every request keeps idr_pending armed
        let during = in_window(Duration::from_millis(700), Duration::from_millis(2400));
        let p_frames = during.iter().filter(|(_, _, t)| *t == 1).count();
        assert!(
            p_frames >= 5,
            "only {p_frames} P-frames while the client begged every 50ms: {during:?}"
        );
        eprintln!(
            "begging test: pre={} answered={} during={} ({p_frames} P-frames; beg from {}ms, every 50ms)",
            pre.len(),
            answered.len(),
            during.len(),
            ms(beg_at.duration_since(start))
        );
    }

    /// The mirror image for an RFI-capable pipeline: the same APPLIED
    /// client request must NOT stop P-frames, because the client resumes
    /// decoding at the next recovery frame (frameType 5) instead of
    /// discarding everything until a full IDR — so the IDR-only policy
    /// (P-frame suppression) stays off. Run with --nocapture to see the
    /// recovery-mode line and the frame timeline.
    #[test]
    fn suppression_stays_off_when_the_pipeline_supports_ref_invalidation() {
        struct RfiPipeline(SyntheticPipeline);
        impl VideoPipeline for RfiPipeline {
            fn encode_next(&mut self, force_idr: bool) -> Result<Option<EncodedFrame>, String> {
                self.0.encode_next(force_idr)
            }
            fn supports_ref_invalidation(&self) -> bool {
                true
            }
        }

        let server = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let server_addr = server.local_addr().unwrap();
        let client = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        client.connect(server_addr).unwrap();
        client
            .set_read_timeout(Some(Duration::from_millis(200)))
            .unwrap();

        let shared = StreamShared::new();
        let stop = shared.clone();
        let beg = shared.clone();
        let video = std::thread::spawn(move || {
            run_video_loop(
                server,
                shared,
                Box::new(RfiPipeline(SyntheticPipeline::new(4_000, 600, 60))),
                1392,
                10,
                0,
                Duration::from_millis(16),
                1920,
                1080,
                60,
                60_000,
                None,
            )
        });

        let start = Instant::now();
        let beg_at = start + Duration::from_millis(500);
        let deadline = start + Duration::from_millis(1600);
        let mut begged = false;
        let mut seen: Vec<(Instant, u32, u8)> = Vec::new();
        let mut buffer = [0u8; 2048];
        while Instant::now() < deadline {
            if !begged && Instant::now() >= beg_at {
                beg.idr_pending.store(true, Ordering::Relaxed);
                beg.note_idr_request_applied();
                begged = true;
            }
            let _ = client.send(&[0x70; 4]);
            for _ in 0..64 {
                match client.recv(&mut buffer) {
                    Ok(_) => {
                        let nv = &buffer[16..32];
                        let frame_index = u32::from_le_bytes(nv[4..8].try_into().unwrap());
                        if nv[8] & FLAG_SOF == 0 {
                            continue;
                        }
                        let frame_type = buffer[32 + 3];
                        if !seen.iter().any(|(_, index, _)| *index == frame_index) {
                            seen.push((Instant::now(), frame_index, frame_type));
                        }
                    }
                    Err(_) => break,
                }
            }
        }
        stop.stop.store(true, Ordering::Relaxed);
        video.join().expect("video loop").expect("video loop result");

        eprintln!(
            "rfi recovery timeline: {}",
            seen.iter()
                .map(|(at, index, t)| format!(
                    "[{}ms f{} t{}]",
                    at.duration_since(start).as_millis(),
                    index,
                    t
                ))
                .collect::<Vec<_>>()
                .join(" ")
        );

        // the same window as the begging test: P-frames must keep flowing
        // here too — with RFI live the client resumes at the next recovery
        // frame, so the IDR-only policy never engages at all
        let during = seen
            .iter()
            .filter(|(at, _, _)| {
                let at = at.duration_since(start);
                at >= Duration::from_millis(650) && at < Duration::from_millis(1400)
            })
            .collect::<Vec<_>>();
        assert!(
            during.iter().any(|(_, _, t)| *t == 1),
            "P-frames stopped after an applied request with RFI live: {during:?}"
        );
    }

    #[test]
    fn rate_limited_loop_ships_synthetic_stream_without_stale_spiral() {
        // End-to-end through the real sender loop at 60Mbps-class frame
        // sizes (~125KB -> ~101 datagrams/frame at packetSize 1392 + 10%
        // FEC): the pacing-aware freshness projection must not misfire and
        // the paced batches must all reach the client. Run with
        // --nocapture to see the 5s latency histograms — the pacing
        // numbers live in the first->last-send stage.
        let server = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let server_addr = server.local_addr().unwrap();
        let client = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        client.connect(server_addr).unwrap();
        client
            .set_read_timeout(Some(Duration::from_millis(200)))
            .unwrap();

        let shared = StreamShared::new();
        let stop = shared.clone();
        let video = std::thread::spawn(move || {
            run_video_loop(
                server,
                shared,
                Box::new(SyntheticPipeline::new(125_000, 300, 60)),
                1392,
                10,
                0,
                Duration::from_millis(16),
                1920,
                1080,
                60,
                60_000,
                None,
            )
        });

        let deadline = Instant::now() + Duration::from_secs(6);
        let mut received = 0u64;
        let mut buffer = [0u8; 2048];
        while Instant::now() < deadline {
            let _ = client.send(&[0x70; 4]);
            for _ in 0..256 {
                match client.recv(&mut buffer) {
                    Ok(_) => received += 1,
                    Err(_) => break,
                }
            }
        }
        stop.stop.store(true, Ordering::Relaxed);
        video.join().expect("video loop").expect("video loop result");

        // expected datagrams: 300 frames x the exact packetize output for
        // a 125000-byte frame at 1392/10% — a stale-gate spiral would show
        // up as a large shortfall
        let mut packetizer = VideoPacketizer::new(1392, 0);
        let per_frame = packetizer.packetize(1, &vec![0u8; 125_000], false, 0, 10, false).len();
        let expected = 300 * per_frame as u64;
        assert!(
            received >= expected * 9 / 10,
            "received {received} of ~{expected} datagrams (per frame {per_frame})"
        );
    }
}

#[cfg(test)]
mod fec_tests {
    use super::*;

    fn nv(shard: &[u8]) -> &[u8] {
        &shard[16..32]
    }

    fn fec_info(shard: &[u8]) -> u32 {
        u32::from_le_bytes(nv(shard)[12..16].try_into().unwrap())
    }

    fn parse(shard: &[u8]) -> (u16, u32, u8, u8, u32) {
        (
            u16::from_be_bytes(shard[2..4].try_into().unwrap()), // RTP seq
            u32::from_le_bytes(nv(shard)[4..8].try_into().unwrap()), // frame index
            nv(shard)[8],                                          // flags
            nv(shard)[11],                                         // multiFecBlocks
            fec_info(shard),
        )
    }

    #[test]
    fn fec_header_fields_match_client_parser_masks() {
        let mut packetizer = VideoPacketizer::new(1392, 0);
        let shards = packetizer.packetize(7, &[0xAB; 3000], true, 999, 20, false);
        // 3 data shards (3008 bytes / 1376), 20% -> 1 parity shard
        assert_eq!(shards.len(), 4);
        let (_, _, _, _, info0) = parse(&shards[0]);
        // client reads: percentage = (fecInfo & 0xFF0) >> 4
        assert_eq!((info0 & 0xFF0) >> 4, 20);
        // data shard count = (fecInfo & 0xFFC00000) >> 22
        assert_eq!((info0 & 0xFFC00000) >> 22, 3);
        let lowest = u16::from_be_bytes(shards[0][2..4].try_into().unwrap());
        for (index, shard) in shards.iter().enumerate() {
            let (seq, frame, flags, _, info) = parse(shard);
            // client derives the shard index from seq - fecIndex == lowest
            assert_eq!(seq.wrapping_sub(lowest) as u32, (info >> 12) & 0x3FF);
            assert_eq!(seq as u32, lowest as u32 + index as u32);
            assert_eq!(info & 0xF, 0); // low nibble unused
            if index < 3 {
                assert_eq!(frame, 7);
                if index == 0 {
                    assert_eq!(flags, FLAG_CONTAINS_PIC_DATA | FLAG_SOF);
                } else if index == 2 {
                    assert_eq!(flags, FLAG_CONTAINS_PIC_DATA | FLAG_EOF);
                } else {
                    assert_eq!(flags, FLAG_CONTAINS_PIC_DATA);
                }
            }
        }
        // parity shard carries its own index (data count + parity position)
        let (.., parity_info) = parse(&shards[3]);
        assert_eq!((parity_info >> 12) & 0x3FF, 3);
        // single block: multiFecBlocks = (0 << 4) | ((1-1) << 6)
        assert_eq!(nv(&shards[0])[11], 0);
    }

    /// The client's `x-nv-vqos[0].fec.minRequiredFecPackets` (a live
    /// Moonlight client sends 2) raises a block's parity above the
    /// percentage-derived count. Every frame's final block is a small
    /// remainder, so at the 20% base a 5-data-shard block carries 1 parity
    /// shard where the client needs 2 — one lost packet unrecoverable.
    /// Sunshine stream.cpp:852-859 also replaces the block's percentage
    /// with `(100 * parity_shards) / data_shards`, and the client sizes
    /// the block from the fecInfo percentage of its first packet
    /// (RtpVideoQueue.c `bufferParityPackets`), so the adjusted value must
    /// ride every shard of the block, data and parity alike.
    #[test]
    fn min_required_fec_packets_raises_a_small_blocks_parity() {
        // 5 data shards: the 8-byte short header + 6792 payload bytes at
        // the 1392/1360-byte payload block
        let frame = vec![0x5Au8; 5 * 1360 - 8];

        // the percentage already meets the minimum: nothing changes
        let mut packetizer = VideoPacketizer::new(1392, 2);
        let shards = packetizer.packetize(1, &frame, false, 0, 50, false);
        assert_eq!(shards.len(), 5 + 3, "50% of 5 data shards is already 3 parity");
        for (index, shard) in shards.iter().enumerate() {
            assert_eq!((fec_info(shard) & 0xFF0) >> 4, 50, "shard {index}");
        }

        // the percentage falls short: raised, and the wire percentage
        // becomes (100 * 2) / 5 = 40 on every shard of the block
        let mut packetizer = VideoPacketizer::new(1392, 2);
        let shards = packetizer.packetize(2, &frame, false, 0, 20, false);
        assert_eq!(shards.len(), 5 + 2, "20% of 5 data shards raises to 2 parity");
        for (index, shard) in shards.iter().enumerate() {
            assert_eq!((fec_info(shard) & 0xFF0) >> 4, 40, "shard {index}");
            assert_eq!((fec_info(shard) & 0xFFC00000) >> 22, 5, "shard {index}");
        }

        // no minimum (the attribute was absent): the percentage stands
        let mut packetizer = VideoPacketizer::new(1392, 0);
        let shards = packetizer.packetize(3, &frame, false, 0, 20, false);
        assert_eq!(shards.len(), 5 + 1);
        for (index, shard) in shards.iter().enumerate() {
            assert_eq!((fec_info(shard) & 0xFF0) >> 4, 20, "shard {index}");
        }
    }

    #[test]
    fn large_frames_split_into_multiple_fec_blocks() {
        // tiny packets: payload block 48 bytes, shard 80; 400 shards needs
        // 2 blocks at 20% (max 212 data shards per block)
        let mut packetizer = VideoPacketizer::new(64, 0);
        let frame: Vec<u8> = (0..400 * 48).map(|i| (i % 251) as u8).collect();
        let shards = packetizer.packetize(1, &frame, false, 0, 20, false);
        let first_mfb = nv(&shards[0])[11];
        let last_block = (first_mfb >> 6) & 0x3;
        assert_eq!(last_block, 1, "two blocks expected");
        assert_eq!((first_mfb >> 4) & 0x3, 0);
        let mut saw_second_block = false;
        for shard in &shards {
            let (_, _, _, mfb, info) = parse(shard);
            assert_eq!((info & 0xFF0) >> 4, 20);
            if (mfb >> 4) & 0x3 == 1 {
                saw_second_block = true;
            }
        }
        assert!(saw_second_block);
    }

    /// Simulated moonlight client: parse the emitted shards, drop up to
    /// `ps` shards per block, RS-decode like RtpVideoQueue, and verify
    /// the recovered data shards are byte-identical to what was emitted.
    #[test]
    fn fec_protected_frame_recovers_under_loss() {
        let mut seed = 0x12345678u64;
        let mut rand = move |limit: usize| {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            ((seed >> 33) as usize) % limit
        };

        for fec in [10u32, 20, 50] {
            let mut packetizer = VideoPacketizer::new(1392, 0);
            let frame: Vec<u8> = (0..100_000).map(|i| (i * 7 % 251) as u8).collect();
            let shards = packetizer.packetize(42, &frame, true, 12345, fec, false);

            // group shards into blocks by (frameIndex, block number)
            let mut blocks: Vec<(u8, Vec<Vec<u8>>)> = Vec::new();
            for shard in &shards {
                let (_, frame_index, _, mfb, info) = parse(shard);
                let block = (mfb >> 4) & 0x3;
                let ds = ((info & 0xFFC00000) >> 22) as usize;
                let shard_index = ((info >> 12) & 0x3FF) as usize;
                // Sunshine patches frameIndex/multiFecBlocks on parity
                // shards post-RS (stream.cpp:1736-1746) because the
                // client reads them from parity packets too — assert the
                // display fields equal the data-shard values on EVERY
                // shard.
                assert_eq!(frame_index, 42, "shard {shard_index}");
                let percentage = (info & 0xFF0) >> 4;
                assert_eq!(percentage, fec);
                let ps = (ds * fec as usize + 99) / 100;
                match blocks.iter_mut().find(|(b, _)| *b == block) {
                    Some((_, group)) => group.push(shard.clone()),
                    None => blocks.push((block, vec![shard.clone()])),
                }
                let _ = ps;
            }

            for (block, group) in &blocks {
                let info0 = fec_info(&group[0]);
                let ds = ((info0 & 0xFFC00000) >> 22) as usize;
                let ps = (ds * fec as usize + 99) / 100;
                assert_eq!(group.len(), ds + ps, "block {block}");

                // order shards by their index and verify contiguity
                let mut ordered = group.clone();
                ordered.sort_by_key(|s| (fec_info(s) >> 12) & 0x3FF);
                let lowest = u16::from_be_bytes(ordered[0][2..4].try_into().unwrap());
                for (index, shard) in ordered.iter().enumerate() {
                    assert_eq!(
                        u16::from_be_bytes(shard[2..4].try_into().unwrap()) as u32,
                        lowest as u32 + index as u32
                    );
                }

                // drop up to ps shards (deterministic pseudo-random mix)
                let losses = if ps == 0 { 0 } else { 1 + rand(ps.min(ds + ps)) };
                let mut erased = std::collections::BTreeSet::new();
                while erased.len() < losses.min(ps) {
                    erased.insert(rand(ds + ps));
                }
                let mut surviving: Vec<Option<Vec<u8>>> = ordered
                    .iter()
                    .enumerate()
                    .map(|(i, s)| if erased.contains(&i) { None } else { Some(s.clone()) })
                    .collect();
                let recovered = crate::fec::decode(ds, std::mem::take(&mut surviving))
                    .unwrap_or_else(|| panic!("decode failed for block {block}"));
                // Compare only the bytes the client actually consumes from
                // a recovered shard (RtpVideoQueue cleanup_packets): the
                // Compare only the bytes the client actually consumes from
                // a recovered shard (RtpVideoQueue cleanup_packets): RTP
                // header/seq/timestamp/ssrc, frameIndex and multiFecBlocks
                // are overwritten from queue state and fecInfo is ignored
                // — those positions of the parity shards carry post-RS
                // patched display values (Sunshine stream.cpp:1736-1746).
                for (original, recovered) in ordered.iter().zip(recovered.iter()) {
                    let client_visible = |shard: &Vec<u8>| {
                        shard
                            .iter()
                            .enumerate()
                            .filter(|(position, _)| {
                                *position != 0
                                    && !(2..12).contains(position)
                                    && !(20..24).contains(position)
                                    && *position != 27
                                    && !(28..32).contains(position)
                            })
                            .map(|(_, byte)| *byte)
                            .collect::<Vec<u8>>()
                    };
                    assert_eq!(
                        client_visible(original),
                        client_visible(recovered),
                        "block {block} shard mismatch"
                    );
                }
            }
        }
    }

    /// Simulated moonlight client parse of an IDR-sized frame over a
    /// lossy link (RtpVideoQueue.c semantics): the client's FEC block
    /// window is derived from whichever shard arrives FIRST
    /// (`bufferLowestSequenceNumber = seq - fecIndex`), so a mid-block
    /// arrival must still place every shard of the block inside the
    /// window, and the parity shards' post-RS patched display fields
    /// (frameIndex at bytes 20..24, multiFecBlocks at byte 27, fecInfo at
    /// 28..32) must match the data shards or the client purges the block.
    #[test]
    fn idr_sized_single_fec_block_parses_from_any_arrival_order() {
        for fec in [10u32, 20] {
            let mut packetizer = VideoPacketizer::new(1392, 0);
            // 8Mbps-class IDR at 720p: ~20-60KB -> 15-44 data shards
            for size in [20_000usize, 45_000, 60_000] {
                let frame: Vec<u8> = (0..size).map(|i| (i * 13 % 251) as u8).collect();
                let shards = packetizer.packetize(9, &frame, true, 4242, fec, false);
                let ds = (size + 8 + 1375) / 1376; // short header + payload block
                let ps = (ds * fec as usize + 99) / 100;
                assert_eq!(shards.len(), ds + ps, "single block for IDR sizes");
                assert_eq!(nv(&shards[0])[11], 0, "single block: multiFecBlocks = 0");

                // the client reads frameIndex/multiFecBlocks/fecInfo from
                // EVERY shard, parity included — assert the patched bytes
                for shard in &shards {
                    assert_eq!(u32::from_le_bytes(shard[20..24].try_into().unwrap()), 9);
                    assert_eq!(shard[27], 0);
                    assert_eq!((fec_info(shard) & 0xFF0) >> 4, fec);
                }

                // arrival order with the first-received shard MID-BLOCK,
                // as under loss: the window must still contain the block
                let mid = ds / 2;
                let first_seq =
                    u16::from_be_bytes(shards[mid][2..4].try_into().unwrap());
                let first_fec_index = (fec_info(&shards[mid]) >> 12) & 0x3FF;
                let lowest = first_seq.wrapping_sub(first_fec_index as u16);
                let highest = lowest.wrapping_add((ds + ps) as u16 - 1);
                for (index, shard) in shards.iter().enumerate() {
                    let seq = u16::from_be_bytes(shard[2..4].try_into().unwrap());
                    let shard_index = (fec_info(shard) >> 12) & 0x3FF;
                    assert_eq!(shard_index as usize, index);
                    assert_eq!(
                        seq.wrapping_sub(lowest) as usize, index,
                        "shard {index} sits at its index from the derived lowest"
                    );
                    // RtpVideoQueue rejects outside [lowest, highest]
                    assert!(!is_before16(seq, lowest), "shard {index} not below the window");
                    assert!(!is_before16(highest, seq), "shard {index} not above the window");
                }
            }
        }
    }

    /// moonlight-common-c's isBefore16: true when `b` is strictly behind
    /// `a` in 16-bit wrap-around sequence space.
    fn is_before16(a: u16, b: u16) -> bool {
        (a.wrapping_sub(b) & 0x8000) != 0 && a != b
    }

    #[test]
    fn legacy_no_fec_layout_unchanged() {
        let mut packetizer = VideoPacketizer::new(1392, 0);
        let shards = packetizer.packetize(3, &[0xCC; 5000], false, 7, 0, false);
        for (index, shard) in shards.iter().enumerate() {
            let info = fec_info(shard);
            assert_eq!((info & 0xFF0) >> 4, 0); // client sees no FEC
            assert_eq!(nv(shard)[11], 0); // single block
            assert_eq!(((info >> 12) & 0x3FF) as usize, index);
        }
    }

    #[test]
    fn fec_percentage_is_a_per_frame_wire_property() {
        // congestion-adaptive FEC changes the percentage frame to frame;
        // the client derives each block's parity count from the fecInfo
        // of the block's FIRST packet (RtpVideoQueue.c), so consecutive
        // frames from one packetizer must each carry their own
        // percentage and matching parity count
        let mut packetizer = VideoPacketizer::new(1392, 0);
        let frame_a = packetizer.packetize(1, &[0xA5; 30_000], false, 0, 10, false);
        let frame_b = packetizer.packetize(2, &[0x5A; 30_000], false, 0, 30, false);
        assert_ne!(
            frame_a.len(),
            frame_b.len(),
            "the two FEC levels must produce different datagram counts"
        );
        let ds = (30_000 + 8 + 1375) / 1376; // short header + payload block
        for (shards, pct) in [(&frame_a, 10u32), (&frame_b, 30)] {
            let ps = (ds * pct as usize + 99) / 100;
            assert_eq!(shards.len(), ds + ps, "datagram count at {pct}%");
            for (index, shard) in shards.iter().enumerate() {
                let info = fec_info(shard);
                // every shard (parity included) carries the frame's own
                // percentage at the client mask 0xFF0>>4
                assert_eq!((info & 0xFF0) >> 4, pct, "shard {index}");
                assert_eq!((info & 0xFFC00000) >> 22, ds as u32, "shard {index}");
            }
        }
    }
}
