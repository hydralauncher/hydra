//! Adaptive bitrate controller: steps the encoder bitrate down under
//! loss (client IDR begging, LOSS_STATS, full send buffers, ENet client
//! retransmits) and back up when the link is clean — the mechanism
//! Sunshine/Apollo use to recover from WiFi congestion instead of dying
//! in an IDR-retry spiral.
//!
//! Policy (design rationale; no upstream reference implements exactly
//! this shape — Sunshine's Apollo-era controller is closed-loop on loss
//! percentage, which our clients often don't report):
//! - a client IDR flood is a *symptom* (the client is missing frames),
//!   never evidence on its own that our video rate is too high: cutting
//!   the bitrate does not restore a lost reference, it only makes every
//!   frame worse — an IDR-retry spiral can drive the encoder to the floor
//!   with the client's own overlay reporting 0% network loss. A flood
//!   therefore only licenses a step when the SAME window also carries
//!   corroboration: the ENet congestion verdict, or a client LOSS_STATS
//!   report. Given that, a flood on the FIRST window of a congestion
//!   episode (>3 applied requests in the rolling 2s window) => -30%
//!   immediately ("idr-flood-fast"): the client is already starving and
//!   terminates within ~2-3s of a burst, while the ENet congestion stats
//!   need 2 consecutive 5s windows (~10s) before their first step — by
//!   the time they fire the client is gone. The fast shot is one per
//!   episode: later flood windows (>2 requests per 2s window) => -25%
//!   ("idr-flood"), and the shot re-arms only when the bitrate recovers
//!   to the ceiling.
//! - LOSS_STATS with losses in the window => -20%
//! - send-buffer wouldblock trend (>=50 drops in the window) => -15%
//! - ENet congestion: the control channel's return path produced *material*
//!   client retransmit evidence in a 5s window => the link is NOT clean even
//!   when every local signal is; blocks up-steps, and sustained over >=2
//!   consecutive windows => -25% ("enet-congestion"); a congested window
//!   with a nearly dead control channel (<50 reliables received) counts as
//!   severe, and 2+ severe windows in a row => -30% ("enet-severe").
//!   Evidence is BOTH counters the return path produces, added: a re-send
//!   the receive window refused (one count per refused arrival) and a re-send
//!   of a sequence already seen at the delivery cursor are different arrivals
//!   of the same retransmit pressure, so the verdict sums them — one
//!   *sequence* re-sent across a cursor advance is counted once per arrival,
//!   which is intended. Material means >=5 events
//!   AND more than 20% of that window's received reliables, or >=30
//!   events outright — see `enet_window_congested` for the calibration:
//!   the measured iPad session was walked 64000 -> 16000kbps in 50s on
//!   duplicate arrivals alone (2-11 against recv=49/53/56/58, 4-19% of a
//!   wireless control channel's background noise, with the client
//!   reporting 0% network loss), while the windows that really were
//!   drowning our receive window carried 27-95 refused re-sends on top of
//!   20-83 duplicate arrivals (47-178 combined events)
//! - fully clean for ~10s (including zero congested ENet windows) => +5%
//!   toward the ceiling
//! - floor max(6Mbps, negotiated/4, pixels_per_frame * fps * 0.072 bpp) —
//!   never the absolute 6Mbps for a session that asked for more: 6Mbps is
//!   ~0.02 bits/pixel at 4K60, so a 4K stream driven there is destroyed,
//!   and its frame loss feeds the very IDR begging that triggered the
//!   step. The bits-per-pixel term is the harder floor: an H.264 stream
//!   cannot hold its target frame rate below ~0.072 bits/pixel/frame (at
//!   the 0.05 rate the one-frame VBV's drain alone spends a whole frame
//!   interval — a 1080p60 session pinned there dropped 163
//!   already-encoded frames), and
//!   the measured failure (2026-09-14, 4K60, client asked 64000kbps) is
//!   exactly that floor being crossed — the ladder walked
//!   60000 -> 45000 -> ... -> 16000 (every step "enet-congestion") while
//!   the per-frame encode time grew in lock-step (10.5ms at 60Mbps,
//!   31-37ms at 16Mbps = 32fps, then a 4fps collapse and a client
//!   disconnect). The mechanism is the one-frame VBV (nvenc.rs
//!   RC_VBV_BUFFER_SIZE = bitrate/fps): CBR only lets a frame finish once
//!   the VBV has drained its bits, so per-frame time ~= frame_bits /
//!   bitrate, and a 4K frame's complexity floor is far above the
//!   16000/60 = 33KB the 16Mbps step allows — no quantization setting
//!   recovers the cadence. When the link cannot hold that floor at the
//!   geometry being encoded, the bitrate ladder is out of levers — it may
//!   not step below the floor — and the lever the host does have is the
//!   size the session *starts* at (the resolution half below); ceiling
//!   min(negotiated, HYDRA_STREAM_MAX_BITRATE_KBPS)
//! - hysteresis: at most one step per second, recovery steps no faster
//!   than every 3s — no oscillation around a congested point.
//!
//! Resolution (same 2026-09-14 measurement, the other half of the answer):
//! the bitrate ladder cannot rescue a session whose *geometry* is too rich
//! for the link. At 4K60 the floor is ~35.8Mbps, so a link that cannot
//! hold it leaves the bitrate pinned at the floor with nothing left to
//! step to — and a client that negotiated `0x0` ("encoder resolves to
//! desktop") carries no geometry term at all until the video loop reports
//! the size the pipeline really encodes (`VideoPipeline::encode_size`),
//! which is how the measured session walked *below* its own 4K floor to
//! 16Mbps and collapsed to 32fps. The policy is resolution first, frame
//! rate kept: `select_encode_size` picks the largest size from a fixed
//! downscale ladder {1, 3/4, 2/3, 1/2, 2/5, 1/4} of the session's maximum
//! size that the session's bitrate can pay for at
//! HYDRA_STREAM_MIN_BITS_PER_PIXEL — its 1/1 rung being the maximum
//! itself, i.e. the client's negotiated size width-capped to the desktop
//! and on the even pixel grid (see `base_size`; the alignment is for the
//! derived rungs, which are macroblock-aligned in both dimensions,
//! aspect-preserving within one macroblock, never below 16x16) — and the
//! video loop resolves it ONCE, before the first frame leaves the
//! pipeline
//! ([`AdaptiveController::initial_encode_size`]). A 4K session at 10Mbps
//! therefore *starts* at 1080p instead of stepping into it.
//!
//! That size is resolved once and never changes again for the rest of the
//! session: a mid-stream SPS/PPS change forces the client to tear down and
//! rebuild its decoder, and an Apple client (VideoToolbox — the iPad the
//! 2026-09-14 sessions ran on) pays for it in a way the host cannot see.
//! The two live sessions that logged a mid-session `encode size` change
//! ended in IDR-begging avalanches of 978 and 876 requests, against 109
//! for a session that never changed size, with our send side healthy in
//! all three (60fps, 10-18ms, 0 stale drops). There is deliberately no
//! size step left to take: below the bits-per-pixel floor the frame rate
//! degrades instead (the FramePacer sends 55/s or 49/s of 60), which the
//! client rides out without a decoder re-init. Frame rate, aspect ratio,
//! FEC and the packetizer are untouched — only the pixels the session
//! starts with are chosen.
//!
//! Congestion-adaptive FEC: alongside the bitrate steps the controller
//! raises the video FEC percentage on the same ENet trend — the wire
//! format carries the percentage per frame in fecInfo (the client reads
//! it per block, RtpVideoQueue.c, so no negotiation exists). Confirmed
//! congestion (2nd consecutive congested window) => 20%; a severe (nearly
//! dead control channel) trend => 30%. The ladder is raise-only while
//! congestion persists and relaxes one notch (10 points) per clean ENet
//! window, so a brief clean flicker inside a congested stretch does not
//! shed protection. Everything is clamped to FEC_PERCENT_MAX (50%):
//! at the 6Mbps floor 30% FEC means a ~7.8Mbps wire rate.

use std::time::{Duration, Instant};

/// Absolute floor for the ladder: the smallest target a session may be
/// stepped to, whatever the client negotiated.
pub const FLOOR_KBPS: u32 = 6_000;

/// The fraction of the negotiated bitrate the ladder's floor may never sit
/// below: a quarter of what the client asked for is still a watchable
/// picture (see `session_floor`).
const NEGOTIATED_FLOOR_DIVISOR: u32 = 4;

/// The ladder's floor for one session:
/// max(FLOOR_KBPS, negotiated/4, `bpp_floor_kbps`), clamped to the
/// ceiling. A quarter of what the client asked for is still a watchable
/// picture; 6Mbps is not, at 4K (see the module doc and the bpp term);
/// and the geometry's bits-per-pixel floor is the rate below which the
/// target frame rate cannot be delivered at all. Clamping to the ceiling
/// keeps the invariant a down-step needs — the floor can never sit above
/// the bitrate the controller already targets (that would turn a
/// down-step into an up-step; a session whose ceiling is below the
/// geometry's floor simply cannot step down).
fn session_floor(negotiated_kbps: u32, ceiling_kbps: u32, bpp_floor_kbps: u32) -> u32 {
    (negotiated_kbps / NEGOTIATED_FLOOR_DIVISOR)
        .max(FLOOR_KBPS)
        .max(bpp_floor_kbps)
        .min(ceiling_kbps)
}

/// Bits-per-pixel floor for one negotiated geometry, in kbps:
/// `width * height * fps * bits_per_pixel_milli / 1e6`. This is the
/// session's rate below which the one-frame VBV cannot be drained fast
/// enough to keep the target cadence *with margin* (see the module doc and
/// `config::MIN_BITS_PER_PIXEL_MILLI_DEFAULT`): at the shipped 0.072 bpp it
/// is ~35.8Mbps at 4K60, ~15.9Mbps at 1440p60 and ~9.0Mbps at 1080p60 —
/// so a 4K client that negotiated 64Mbps bottoms out near 36Mbps, not at
/// the 6Mbps absolute floor, and not at 16Mbps where the measured session
/// collapsed to 32fps. A zero geometry (a client that negotiated no mode,
/// before the video loop has reported the desktop size the encoder
/// resolved to) or a zero override drops the term out of `session_floor`.
fn bpp_floor_kbps(width: u32, height: u32, fps: u32, bits_per_pixel_milli: u32) -> u32 {
    let bits_per_second = width as u64 * height as u64 * fps as u64 * bits_per_pixel_milli as u64;
    (bits_per_second / 1_000_000).min(u32::MAX as u64) as u32
}

/// Downscale ladder for the encode size, as fractions of the session's
/// maximum size, largest first (see `select_encode_size`). Six fixed rungs
/// rather than a continuous scale: every rung is a deliberate quality step
/// and the fixed set keeps the choice comparable across sessions (the same
/// link capacity always lands on the same picture the session starts at).
const SIZE_LADDER: [(u32, u32); 6] = [(1, 1), (3, 4), (2, 3), (1, 2), (2, 5), (1, 4)];

/// Alignment step of every DERIVED encode size — the ladder rungs below the
/// session's own 1/1 size, which is the client's negotiated geometry and is
/// deliberately left off this grid (see `base_size`): one H.264 macroblock.
/// Hardware decoders — Apple's VideoToolbox prominently, the iPad the
/// measured 2026-09-14 sessions ran on — commonly require macroblock-aligned
/// frames, while NVENC accepts (and emits) any even size, so an unaligned
/// size is a stream our encoder is happy with and the client cannot
/// decode. The measured ladder put 2580x1452 / 2292x1290 / 1720x968 /
/// 1376x774 on the wire from a 3840x2160 negotiation (w%16 = 4/4/8/0,
/// h%16 = 12/10/8/6; only the 1/1 base was on the grid); the client froze on
/// the last frame it had decoded when the session stepped onto the first of
/// them, reporting 0% network loss at ~10ms — the transport delivered
/// everything, the decoder stalled.
const MACROBLOCK: u32 = 16;

/// Smallest dimension the ladder may ever select: one macroblock on both
/// axes (H.264 hardware decoders reject smaller in practice, and a
/// degenerate maximum size must never select a 0-pixel encode). Also the
/// floor `set_encode_size` accepts.
pub const MIN_ENCODE_DIMENSION: u32 = MACROBLOCK;

/// One dimension rounded DOWN to a whole number of macroblocks — never a
/// wider column than the value stands for — and never below
/// [`MIN_ENCODE_DIMENSION`]. Pure.
fn macroblock_down(value: u32) -> u32 {
    (value / MACROBLOCK * MACROBLOCK).max(MIN_ENCODE_DIMENSION)
}

/// One dimension rounded to the NEAREST whole number of macroblocks (ties
/// up), never above `limit` (a rounded-up height may not exceed the frame
/// the size was derived from) and never below [`MIN_ENCODE_DIMENSION`]. A
/// height derived from a width at an aspect ratio is a truncated quotient
/// already, so rounding it down a second time compounds that error instead
/// of cancelling it — and once rounding is forced onto the macroblock
/// grid, nearest keeps the frame's aspect within half a macroblock, at
/// most ~1% at these rungs (2576x1456 against 16:9 is 0.48% off,
/// 2288x1280 is 0.55%). Pure.
fn macroblock_round(value: u32, limit: u32) -> u32 {
    let rounded = value.saturating_add(MACROBLOCK / 2) / MACROBLOCK * MACROBLOCK;
    if rounded > limit {
        rounded.saturating_sub(MACROBLOCK)
    } else {
        rounded
    }
    .max(MIN_ENCODE_DIMENSION)
}

/// The height `width` carries at `(from_w, from_h)`'s aspect ratio:
/// `width * from_h / from_w`, in u64 so an 8K width times a 4K height
/// cannot wrap the multiplication. Zero for a zero `from_w` (no aspect to
/// carry). Pure.
fn aspect_height(width: u32, from_w: u32, from_h: u32) -> u32 {
    if from_w == 0 {
        return 0;
    }
    ((width as u64 * from_h as u64) / from_w as u64).min(u32::MAX as u64) as u32
}

/// One dimension rounded DOWN to an even number of pixels — never a wider
/// column than the value stands for — and never below
/// [`MIN_ENCODE_DIMENSION`]. Even parity is the one rounding the client's
/// own number must survive (see [`base_size`]), and it is a hard requirement
/// of the format as well: H.264 carries chroma in 2x2 units, so an odd
/// dimension has no whole chroma sample on its last row or column. Pure.
fn even_down(value: u32) -> u32 {
    (value & !1).max(MIN_ENCODE_DIMENSION)
}

/// One dimension rounded to the NEAREST even number of pixels, ties UP (the
/// two even neighbours of an odd value are equidistant, so an odd dimension
/// always steps up one), never above `limit` (a height derived from a width
/// at an aspect may not exceed the frame the size was derived from) and
/// never below [`MIN_ENCODE_DIMENSION`]. This is the rounding the session's
/// size carried before the macroblock alignment existed — the measured
/// 2292-column rung of the ultrawide session was 1290 rows, not 1288, and
/// 3440 columns at the client's 16:9 is 1935, carried as 1936 — and it is
/// the rounding the size the CLIENT asked for wants: its height is a
/// truncated quotient already, and 4:2:0 chroma cannot carry an odd one.
/// Pure.
fn even_round(value: u32, limit: u32) -> u32 {
    let rounded = value.saturating_add(value % 2);
    if rounded > limit {
        rounded.saturating_sub(2)
    } else {
        rounded
    }
    .max(MIN_ENCODE_DIMENSION)
}

/// The session's maximum encode size — the base (1/1) rung of the ladder,
/// and the size the client actually asked for: the width capped at the
/// captured desktop's columns (never an upscale, never an invented column)
/// on the even pixel grid, the height then taken from THAT width at the
/// negotiated aspect. Deliberately NOT macroblock-aligned: Sunshine hands
/// the client's width/height to NVENC verbatim
/// (`src/nvenc/nvenc_base.cpp`: `init_params.encodeWidth = encoder_params.width`,
/// with no alignment step) and streams 1920x1080 to iPads routinely, because
/// NVENC pads the *coded* frame to macroblock alignment internally and
/// signals an H.264 crop — nothing about a 1920x1080 stream requires us to
/// move the grid, and aligning the base spends rows (1,080 -> 1,072, 0.74%
/// off the client's aspect, for 1920x1080) and changes the geometry the
/// client negotiated for no benefit. Pure.
fn base_size(cap_w: u32, cap_h: u32, aspect: (u32, u32)) -> (u32, u32) {
    let width = even_down(cap_w);
    (
        width,
        even_round(aspect_height(width, aspect.0, aspect.1), cap_h),
    )
}

/// A DERIVED session size — a ladder rung below the 1/1 base — of at most
/// `(cap_w, cap_h)` at `aspect`: the width capped DOWN to a whole number of
/// macroblocks (never a wider column than the cap or the fraction stands
/// for), the height then taken from that width at the aspect — not by
/// scaling the height on its own axis. The aspect is what the client
/// stretches the frame into its negotiated surface with, so it must follow
/// the width the size really has: two independent roundings let a size drift
/// from the aspect (each rounds in its own direction), which shows up as the
/// kind of squeeze the width cap exists to avoid. Every rung BELOW the base
/// comes through here, so all of them are macroblock-aligned; the base
/// itself is the client's own size and comes through [`base_size`]. Pure.
fn scaled_size(cap_w: u32, cap_h: u32, aspect: (u32, u32)) -> (u32, u32) {
    let width = macroblock_down(cap_w);
    (
        width,
        macroblock_round(aspect_height(width, aspect.0, aspect.1), cap_h),
    )
}

/// The derived ladder rung `num/den` of `(max_w, max_h)`: the maximum's size
/// scaled by the fraction through [`scaled_size`], at the frame's `aspect` —
/// the NEGOTIATED geometry, never the maximum's own shape. The maximum is at
/// that aspect only to within the single even row its own height rounding
/// can cost, and taking the rungs' aspect from the rounded pair instead of
/// from the negotiation would propagate that rounding into every one of
/// them. The 1/1 rung is not derived here — it is the maximum itself,
/// through [`base_size`], which is how the client's own size reaches the
/// ladder unaligned. Pure.
fn ladder_size(max_w: u32, max_h: u32, aspect: (u32, u32), num: u32, den: u32) -> (u32, u32) {
    scaled_size(max_w.saturating_mul(num) / den, max_h, aspect)
}

/// The session's size ladder for `(max_w, max_h)` at `aspect`, largest
/// first: the 1/1 rung is the session's maximum itself ([`base_size`] — the
/// client's negotiated size, width-capped, even parity, off the macroblock
/// grid), and every derived rung below it goes through [`ladder_size`], so
/// no derived size — and therefore no selection from them — can be off the
/// macroblock grid, and none of them exceeds the base. Pure.
fn size_ladder(max_w: u32, max_h: u32, aspect: (u32, u32)) -> [(u32, u32); SIZE_LADDER.len()] {
    let mut ladder = [(0, 0); SIZE_LADDER.len()];
    ladder[0] = base_size(max_w, max_h, aspect);
    for (index, (num, den)) in SIZE_LADDER.iter().enumerate().skip(1) {
        ladder[index] = ladder_size(max_w, max_h, aspect, *num, *den);
    }
    ladder
}

/// The largest size of the session's ladder the bitrate can pay for: the
/// maximum size while its bits-per-pixel floor fits — `bitrate*1e6 >=
/// max_w*max_h*fps*bpp_min_milli` in bits per second, i.e. `bitrate_kbps >=
/// bpp_floor_kbps(...)`, the same number the bits-per-pixel term of
/// `session_floor` is built from, so the size rule and the bitrate floor
/// cannot disagree about which geometries fit — else the largest ladder rung
/// whose floor fits, and the smallest rung when not even that does. A zero
/// geometry (the session's size is not known yet) returns the zero maximum
/// untouched; a zero override (the term disabled) returns the maximum. The
/// maximum the rule returns unchanged is the session's own 1/1 size — the
/// client's negotiated geometry, width-capped, even parity and deliberately
/// off the macroblock grid (see [`base_size`]) — while every size on the
/// ladder below it is macroblock-aligned in both dimensions and never below
/// 16x16. Pure.
pub fn select_encode_size(
    max_w: u32,
    max_h: u32,
    aspect: (u32, u32),
    bitrate_kbps: u32,
    fps: u32,
    bpp_min_milli: u32,
) -> (u32, u32) {
    if max_w == 0 || max_h == 0 {
        return (max_w, max_h);
    }
    let ladder = size_ladder(max_w, max_h, aspect);
    if bpp_min_milli == 0 {
        return ladder[0];
    }
    for size in ladder {
        if bitrate_kbps >= bpp_floor_kbps(size.0, size.1, fps, bpp_min_milli) {
            return size;
        }
    }
    ladder[SIZE_LADDER.len() - 1]
}

/// Bits per pixel per frame, in thousandths, that `(width, height)` gets at
/// `bitrate_kbps`: `bitrate*1e6 / (pixels*fps)`. The video loop quotes it in
/// the encode-size log line (`bpp 0.032 < 0.072 at 16000kbps`); the rule
/// itself compares through [`bpp_floor_kbps`], so this is a reporting
/// helper only. Zero for a zero geometry or fps. Pure.
pub fn bits_per_pixel_milli(width: u32, height: u32, fps: u32, bitrate_kbps: u32) -> u32 {
    let pixels = width as u64 * height as u64 * fps as u64;
    if pixels == 0 {
        return 0;
    }
    ((bitrate_kbps as u64 * 1_000_000) / pixels).min(u32::MAX as u64) as u32
}

const WINDOW: Duration = Duration::from_secs(2);
const CLEAN_RAMP_INTERVAL: Duration = Duration::from_secs(3);
const MIN_STEP_INTERVAL: Duration = Duration::from_secs(1);
const CLEAN_STREAK: Duration = Duration::from_secs(10);

const IDR_FLOOD_THRESHOLD: u32 = 2;
/// Above this many applied requests in the rolling 2s window the client
/// is unmistakably starving (>3, i.e. 4+); on the first such window of a
/// congestion episode the controller steps -30% immediately instead of
/// waiting for any trend.
const IDR_FLOOD_FAST_THRESHOLD: u32 = 3;
const WOULD_BLOCK_THRESHOLD: u64 = 50;

/// Number of 1s feed ticks that make up the controller's own ENet
/// evaluation window. The control thread reports raw wire deltas once
/// per its 5s stats window; the controller accumulates ticks and
/// evaluates the verdict on its own 5-tick boundary, so each control
/// window lands in exactly one controller window no matter how the two
/// cadences drift against each other.
const ENET_WINDOW_TICKS: usize = 5;

/// ENet congestion thresholds, evaluated by the controller per its own
/// 5-tick window on the raw wire counters the control thread feeds it
/// (client retransmit arrivals: reliables our receive window refused, plus
/// re-sends of sequences already seen at the delivery cursor). A growing
/// retransmit count means our ACK datagrams are being delayed/dropped on
/// the return path (bufferbloat: the video flood queues ahead of the tiny
/// ACKs on the client's radio) — the client's retransmit flood is
/// congestion evidence that none of the local signals (IDR requests,
/// LOSS_STATS, wouldblock) can see, because from the host's sockets
/// everything still looks clean.
///
/// Calibration (2026-09-14): a wireless control channel retransmits at a
/// low rate all the time, and every one of those events used to count. The
/// measured iPad session — client overlay reading 0% network loss at
/// ~10ms — was walked 64000 -> 45000 -> 33750 -> 25312 -> 19979 ->
/// 16000kbps in 50s by per-5s windows of (dup, recv) = (26,74), (2,49),
/// (6,53), (9,56), (11,58): 2-11 arrivals, 4-19% share, which is noise —
/// those windows were the wireless control channel's background re-sends
/// and our receive window refused nothing in them. The windows that really
/// were drowning, when the user started playing and our own receive window
/// began discarding under input load, carried 27-95 refusals on top of
/// 20-83 duplicates (47-178 combined arrivals, >=30 for all but the
/// marginal end of that range). A window therefore needs MATERIAL
/// evidence: 5 events that are also more than 20% of the reliables it
/// received, or 30 events outright.
const ENET_CONGESTION_MIN_EVENTS: u64 = 30;
/// Share-gate minimum: `events >= this AND events > 20% of the reliables
/// received` also congests. The percentage makes the verdict a property of
/// the link rather than of the control channel's absolute traffic — a busy
/// channel is judged against its own rate — and the 5 absolute events stop
/// a quiet one flickering on a stray retransmit.
const ENET_CONGESTION_MIN_SHARE_EVENTS: u64 = 5;
/// Retransmit share (percent) above which a window with
/// ENET_CONGESTION_MIN_SHARE_EVENTS events is congested: 19% was measured
/// noise, 35% was legitimate.
const ENET_CONGESTION_SHARE_PERCENT: u64 = 20;
/// Severe: a congested window that received less than this has a nearly
/// dead control channel; ENET_CONGESTION_WINDOWS of them in a row step
/// down harder (-30%).
const ENET_CONGESTION_SEVERE_RECV: u64 = 50;
/// Down-step from this many consecutive congested 5s windows (i.e. on
/// the 2nd): a single window can be one burst, two in a row is a trend —
/// relief starts ~10s into congestion instead of ~15s+.
const ENET_CONGESTION_WINDOWS: u32 = 2;

/// Bitrate down-step factor for the episode's instant-relief shot: an IDR
/// flood above `IDR_FLOOD_FAST_THRESHOLD` with corroboration, -30%.
const BACKOFF_FACTOR_IDR_FLOOD_FAST: f64 = 0.70;
/// Bitrate down-step factor for a licensed IDR flood window, -25%.
const BACKOFF_FACTOR_IDR_FLOOD: f64 = 0.75;
/// Bitrate down-step factor for a window `LOSS_STATS` marks, -20%.
const BACKOFF_FACTOR_LOSS_STATS: f64 = 0.80;
/// Bitrate down-step factor for a locally negative window with no stronger
/// signal behind it (send-buffer pressure alone), -15%.
const BACKOFF_FACTOR_SEND_BUFFER: f64 = 0.85;
/// Bitrate down-step factor under sustained ENet congestion with a nearly
/// dead control channel (severe: `ENET_CONGESTION_SEVERE_RECV`), -30%.
/// Deliberately separate from `BACKOFF_FACTOR_IDR_FLOOD_FAST`, which is the
/// same figure driven by a different signal: either calibration must stay
/// free to move without dragging the other.
const BACKOFF_FACTOR_ENET_SEVERE: f64 = 0.70;
/// Bitrate down-step factor under sustained ENet congestion, -25%.
/// Separate from `BACKOFF_FACTOR_IDR_FLOOD` for the same reason.
const BACKOFF_FACTOR_ENET_CONGESTION: f64 = 0.75;
/// Clean-link ramp step: +5% per `CLEAN_RAMP_INTERVAL` once the clean
/// streak has held for `CLEAN_STREAK`, toward the ceiling.
const CLEAN_RAMP_STEP: f64 = 1.05;

/// FEC percentage the controller applies while the ENet trend confirms
/// congestion (2nd consecutive congested window) — doubles the base 10%
/// so a 60-shard IDR carries 12 parity shards instead of 6.
pub const FEC_PERCENT_CONGESTION: u32 = 20;
/// FEC percentage under a severe trend (congested windows with a nearly
/// dead control channel): 18 parity shards on a 60-shard IDR.
pub const FEC_PERCENT_SEVERE: u32 = 30;
/// Sanity ceiling for any FEC percentage (configured base or ladder):
/// wire rate is data * (1 + pct/100), so 50% caps the overhead at 1.5x.
pub const FEC_PERCENT_MAX: u32 = 50;
/// Relaxation step: one clean ENet window eases the percentage one notch
/// (10 points) toward the base.
const FEC_PERCENT_STEP: u32 = 10;

/// Per-5s-window ENet congestion verdict (pure so the control thread's
/// log and the unit tests share it with the controller): `duplicates` and
/// `refused` are the window's raw wire deltas — the return path's two
/// retransmit counters, one count per *arrival* each — and `received` the
/// reliable commands received in it. The verdict's figure is the two added
/// together: a re-send that arrived while the delivery cursor still sat on
/// its sequence (`EnetStats::duplicate_reliable`) and a re-send the receive
/// rule refused, behind the cursor or absurdly far ahead of the watermark
/// (`EnetStats::window_discards`) are different arrivals of the same
/// retransmit pressure, so both are evidence and the sum is what the
/// thresholds measure. The sum can count one *sequence* twice when it is
/// re-sent across a cursor advance — intended, since each arrival is its
/// own event and each one is a separate sign the ACK path is drowning.
/// A window congests on material evidence only:
/// ENET_CONGESTION_MIN_SHARE_EVENTS events that
/// are also more than ENET_CONGESTION_SHARE_PERCENT of the reliables
/// received in that window, or ENET_CONGESTION_MIN_EVENTS events outright
/// (a flood with almost no control traffic left to measure a percentage
/// against).
pub fn enet_window_congested(duplicates: u64, refused: u64, received: u64) -> bool {
    let events = duplicates.saturating_add(refused);
    events >= ENET_CONGESTION_MIN_EVENTS
        || (received > 0
            && events >= ENET_CONGESTION_MIN_SHARE_EVENTS
            && events * 100 > received * ENET_CONGESTION_SHARE_PERCENT)
}

pub struct AdaptiveController {
    current_kbps: u32,
    ceiling_kbps: u32,
    /// the ladder's floor: max(FLOOR_KBPS, negotiated/4, the encoded
    /// geometry's bits-per-pixel floor) clamped to the ceiling (see
    /// `session_floor`); the geometry term follows the encode size the
    /// pipeline reports through `set_geometry`
    floor_kbps: u32,
    /// negotiated /launch `mode` geometry (0x0 = the client let the encoder
    /// resolve to the desktop); the size ceiling when the desktop is unknown
    negotiated_size: (u32, u32),
    /// captured desktop size reported by the pipeline (0 = not learned yet):
    /// the encode size may never exceed it
    source_size: (u32, u32),
    /// the encode size the pipeline reports (the size the session resolved
    /// to before its first frame; (0, 0) while the geometry is unknown)
    size: (u32, u32),
    /// negotiated bitrate, kept so a geometry change can rebuild the floor
    /// (`ceiling_kbps` is clamped to FLOOR_KBPS and cannot)
    negotiated_kbps: u32,
    /// target frame rate: the size rule's affordability is a function of it
    fps: u32,
    /// HYDRA_STREAM_MIN_BITS_PER_PIXEL in thousandths, read once (see the
    /// constructor)
    bpp_min_milli: u32,
    last_change: Option<Instant>,
    window_start: Instant,
    clean_since: Option<Instant>,
    idr_in_window: u32,
    /// the episode's instant-relief shot: true until the first
    /// idr-flood-family step of a congestion episode fires; re-armed
    /// only when the bitrate recovers to the ceiling (apply)
    idr_flood_fast_pending: bool,
    loss_in_window: bool,
    wouldblock_in_window: u64,
    /// consecutive congested 5s ENet windows; reset by any clean feed
    congested_windows: u32,
    /// consecutive congested windows with a nearly dead control channel
    /// (received < ENET_CONGESTION_SEVERE_RECV)
    starved_windows: u32,
    /// feed ticks since the last ENet window evaluation
    enet_ticks: u32,
    /// raw wire deltas (dup, window-drops, received) accumulated since
    /// the last window evaluation
    enet_acc: (u64, u64, u64),
    /// raw inputs of the most recently evaluated window, quoted in the
    /// step reason log
    enet_window: (u64, u64, u64),
    /// congestion-adaptive FEC: the configured base percentage (clamped
    /// to FEC_PERCENT_MAX) and the percentage currently applied to new
    /// frames (the raise-only ladder around the base)
    fec_base: u32,
    fec_percentage: u32,
    /// set when the most recent ENet window verdict was clean; licenses
    /// one relaxation notch in evaluate() and is consumed there
    fec_relax_pending: bool,
    /// last FEC transition (from, to, cause), drained by the video loop
    /// for the `video: FEC x% -> y%` log
    fec_transition: Option<(u32, u32, &'static str)>,
}

impl AdaptiveController {
    /// `width`/`height`/`fps` are the session's negotiated encode geometry
    /// (from /launch `mode`, the size the encoder is configured with): the
    /// bits-per-pixel floor is a function of them, so a 4K60 session can
    /// never be stepped to a bitrate at which the encoder cannot hold
    /// 60fps (see the module doc). Zero geometry (a client that negotiated
    /// none) leaves the floor at the two-term rule and the size resolution
    /// pending until the video loop reports the geometry the pipeline really
    /// encodes through [`AdaptiveController::set_geometry`].
    pub fn new(
        negotiated_kbps: u32,
        fec_base_percentage: u32,
        width: u32,
        height: u32,
        fps: u32,
    ) -> Self {
        let ceiling = negotiated_kbps
            .min(crate::config::max_bitrate_kbps())
            .max(FLOOR_KBPS);
        let fec_base = fec_base_percentage.min(FEC_PERCENT_MAX);
        // the bits-per-pixel term is read once here rather than per step
        let bpp_min_milli = crate::config::min_bits_per_pixel_milli();
        let bpp_floor = bpp_floor_kbps(width, height, fps, bpp_min_milli);
        AdaptiveController {
            current_kbps: ceiling,
            ceiling_kbps: ceiling,
            floor_kbps: session_floor(negotiated_kbps, ceiling, bpp_floor),
            negotiated_size: (width, height),
            source_size: (0, 0),
            size: (width, height),
            negotiated_kbps,
            fps,
            bpp_min_milli,
            last_change: None,
            window_start: Instant::now(),
            clean_since: Some(Instant::now()),
            idr_in_window: 0,
            idr_flood_fast_pending: true,
            loss_in_window: false,
            wouldblock_in_window: 0,
            congested_windows: 0,
            starved_windows: 0,
            enet_ticks: 0,
            enet_acc: (0, 0, 0),
            enet_window: (0, 0, 0),
            fec_base,
            fec_percentage: fec_base,
            fec_relax_pending: false,
            fec_transition: None,
        }
    }

    pub fn current_kbps(&self) -> u32 {
        self.current_kbps
    }

    pub fn ceiling_kbps(&self) -> u32 {
        self.ceiling_kbps
    }

    /// The lowest bitrate a down-step may target this session:
    /// max(FLOOR_KBPS, negotiated/4, the geometry's bits-per-pixel floor),
    /// clamped to the ceiling.
    pub fn floor_kbps(&self) -> u32 {
        self.floor_kbps
    }

    /// FEC percentage currently applied to new frames: the configured
    /// base raised on the congestion ladder (FEC_PERCENT_CONGESTION /
    /// FEC_PERCENT_SEVERE), relaxed toward the base on clean ENet windows.
    pub fn current_fec_percentage(&self) -> u32 {
        self.fec_percentage
    }

    /// Drains the last FEC transition for the video loop's
    /// `video: FEC x% -> y% (cause)` log; None when the percentage did
    /// not change since the previous drain.
    pub fn take_fec_transition(&mut self) -> Option<(u32, u32, &'static str)> {
        self.fec_transition.take()
    }

    /// The encode size in effect: the size the pipeline reports (the size
    /// the session resolved to before its first frame). `(0, 0)` while the
    /// geometry is unknown.
    pub fn encode_size(&self) -> (u32, u32) {
        self.size
    }

    /// The aspect every size this session encodes carries: the client's
    /// negotiated geometry when it has one, the captured desktop's when the
    /// client negotiated `0x0` (the encoder resolves to it, so that frame IS
    /// the desktop). `(0, 0)` while neither is known — no aspect to derive
    /// sizes from. The session's maximum is at this aspect only to within
    /// the single even row its own height rounding can cost, which is why it
    /// travels separately from `max_size`.
    fn frame_aspect(&self) -> (u32, u32) {
        let (nw, nh) = self.negotiated_size;
        if nw > 0 && nh > 0 {
            (nw, nh)
        } else {
            self.source_size
        }
    }

    /// The session's maximum encode size: the captured desktop's columns
    /// (never the client's wider mode — an upscale spends bits without
    /// adding detail, the measured 3440x1440-desktop/3840x2160-client
    /// waste) at the NEGOTIATED aspect ratio, or the desktop alone when the
    /// client negotiated `0x0` (the encoder resolves to it, so that frame's
    /// aspect IS the desktop's). `(0, 0)` while neither is known. This is
    /// the base (1/1) rung of the ladder — the size the client actually
    /// asked for — and it is on the even grid only, NOT on the macroblock
    /// one ([`base_size`]): a 1920x1080 negotiation stays 1920x1080 rather
    /// than being walked down to 1,072 for no benefit.
    ///
    /// The height must come from the negotiated aspect, never from the
    /// source: capping both axes independently (the old component-wise
    /// `min`) handed the frame the DESKTOP's aspect — the measured
    /// 3840x2160 client on a 3440x1440 (21:9) desktop was encoded 3440x1440
    /// and the client stretched 21:9 into its 16:9 surface, a visibly
    /// distorted picture that no scaler change can undo. Width-capping
    /// keeps the no-upscale intent (the scaler's fit scale stays <= 1, so
    /// the desktop is letterboxed at 1:1) without touching the aspect: the
    /// same session encodes 3440x1936 — the desktop's 3440 columns at the
    /// client's 16:9, 3440*2160/3840 = 1935 at even parity, which is 1936.
    fn max_size(&self) -> (u32, u32) {
        let (nw, nh) = self.negotiated_size;
        let (sw, sh) = self.source_size;
        let aspect = self.frame_aspect();
        match (nw > 0 && nh > 0, sw > 0 && sh > 0) {
            (false, false) => (0, 0),
            // a 0x0 client: the encoder resolved to the desktop, so that
            // frame's aspect IS the desktop's
            (false, true) => base_size(sw, sh, aspect),
            (true, false) => base_size(nw, nh, aspect),
            // the desktop's columns at the CLIENT's aspect
            (true, true) => base_size(nw.min(sw), nh, aspect),
        }
    }

    /// The encode size a session starts at, resolved ONCE by the video loop
    /// before the first frame is emitted and never changed afterwards (see
    /// the module doc): the `select_encode_size` rule against the session's
    /// maximum size — the captured desktop's columns at the negotiated
    /// aspect — and the bitrate the session starts at, which is the ceiling
    /// until the ladder's first step. None while the geometry is unknown,
    /// i.e. before [`AdaptiveController::set_geometry`] has been told what
    /// the pipeline resolved to.
    pub fn initial_encode_size(&self) -> Option<(u32, u32)> {
        let (max_w, max_h) = self.max_size();
        if max_w == 0 || max_h == 0 {
            return None;
        }
        Some(select_encode_size(
            max_w,
            max_h,
            self.frame_aspect(),
            self.current_kbps,
            self.fps,
            self.bpp_min_milli,
        ))
    }

    /// Learns the geometry the pipeline is really running at, reported by
    /// the video loop on every adaptive tick
    /// (`VideoPipeline::encode_size` / `source_size`). It has to be told for
    /// two reasons: a client that negotiated `0x0` carries no geometry in
    /// the launch parameters at all (the encoder resolved to the desktop),
    /// and the video loop resolves the session's encode size from that
    /// geometry before the first frame. The bits-per-pixel floor follows the
    /// encode size, so the floor always describes the pixels actually on the
    /// wire — the measured 4K60 session ran a 16Mbps floor (negotiated/4)
    /// against 4K frames only because its geometry was unknown (its real
    /// floor is 35.8Mbps, which is where the bitrate ladder must stop
    /// instead of walking to 16Mbps).
    pub fn set_geometry(&mut self, encode: (u32, u32), source: Option<(u32, u32)>) {
        if let Some(source) = source {
            if source.0 > 0 && source.1 > 0 {
                self.source_size = source;
            }
        }
        if encode.0 == 0 || encode.1 == 0 {
            return;
        }
        self.size = encode;
        self.floor_kbps = session_floor(
            self.negotiated_kbps,
            self.ceiling_kbps,
            bpp_floor_kbps(encode.0, encode.1, self.fps, self.bpp_min_milli),
        );
    }

    /// Feeds one observation tick (~1s cadence from the video loop).
    /// `enet_dups`/`enet_window_drops`/`enet_received` are the raw ENet
    /// wire deltas accumulated by the control thread since the last
    /// tick — the control thread reports deltas only, never a verdict.
    /// Both retransmit counters are evidence: `enet_window_drops` counts
    /// the arrivals our receive rule refused, `enet_dups` the arrivals of
    /// sequences already seen at the delivery cursor — different arrivals
    /// of the same retransmit pressure, which the verdict adds together.
    /// Every ENET_WINDOW_TICKS feeds the controller evaluates its
    /// own accumulated window with `enet_window_congested` (the single
    /// source of truth for the verdict) and counts it as congested or
    /// clean: any nonzero retransmit count means the client is
    /// retransmitting — the clean streak restarts.
    pub fn feed(
        &mut self,
        now: Instant,
        idr_requests: u32,
        had_loss: bool,
        wouldblock_drops: u64,
        enet_dups: u64,
        enet_window_drops: u64,
        enet_received: u64,
    ) {
        if now.duration_since(self.window_start) >= WINDOW {
            self.window_start = now;
            self.idr_in_window = 0;
            self.loss_in_window = false;
            self.wouldblock_in_window = 0;
        }
        self.idr_in_window += idr_requests;
        self.loss_in_window |= had_loss;
        self.wouldblock_in_window += wouldblock_drops;

        self.enet_acc.0 += enet_dups;
        self.enet_acc.1 += enet_window_drops;
        self.enet_acc.2 += enet_received;
        self.enet_ticks += 1;
        if self.enet_ticks >= ENET_WINDOW_TICKS as u32 {
            self.enet_ticks = 0;
            let (dups, drops, received) = self.enet_acc;
            self.enet_acc = (0, 0, 0);
            self.enet_window = (dups, drops, received);
            // the window's evidence is both retransmit counters added: a
            // refused arrival and a duplicate arrival are different events
            // of the same pressure, and one sequence re-sent across a
            // cursor advance counts once per arrival (see
            // `enet_window_congested`)
            if enet_window_congested(dups, drops, received) {
                self.congested_windows += 1;
                self.fec_relax_pending = false;
                if received < ENET_CONGESTION_SEVERE_RECV {
                    self.starved_windows += 1;
                } else {
                    self.starved_windows = 0;
                }
            } else {
                self.congested_windows = 0;
                self.starved_windows = 0;
                self.fec_relax_pending = true;
            }
        }
    }

    /// Decides whether to step. Returns (new_kbps, reason) when a step
    /// should be applied now.
    pub fn evaluate(&mut self, now: Instant) -> Option<(u32, String)> {
        // An IDR flood is a *symptom* — the client is missing frames — and
        // never evidence on its own that our video rate is too high:
        // cutting the bitrate does not restore the lost reference, it only
        // makes every frame worse, so a flood-driven step can walk the
        // encoder to the floor while the client reports no network loss.
        // A flood therefore only licenses a step when the same window also
        // carries corroboration: the ENet congestion verdict (the ACK path
        // drowning), or a client LOSS_STATS report.
        let idr_flood = self.idr_in_window > IDR_FLOOD_THRESHOLD;
        let flood_licensed = idr_flood && (self.congested_windows > 0 || self.loss_in_window);
        let negative = self.loss_in_window
            || self.wouldblock_in_window >= WOULD_BLOCK_THRESHOLD
            || flood_licensed;
        // a congested ENet window is also a negative signal: no up-steps
        // while the client's retransmit count climbs, even when every
        // local signal (IDR/LOSS_STATS/wouldblock) looks clean
        if negative || self.congested_windows > 0 {
            self.clean_since = None;
        } else if self.clean_since.is_none() {
            self.clean_since = Some(now);
        }

        // Congestion-adaptive FEC ladder, driven by the same ENet trend as
        // the bitrate steps below (read the counters before the enet step
        // consumes them): raise while congestion is confirmed, keep the
        // level while it persists, ease one notch per clean window. The
        // percentage reaches the packetizer as a per-frame input and rides
        // the wire in fecInfo (RtpVideoQueue.c reads it per block).
        let fec_target = if self.starved_windows >= ENET_CONGESTION_WINDOWS {
            Some((FEC_PERCENT_SEVERE, "severe"))
        } else if self.congested_windows >= ENET_CONGESTION_WINDOWS {
            Some((FEC_PERCENT_CONGESTION, "congestion"))
        } else {
            None
        };
        if let Some((target, cause)) = fec_target {
            // raise-only: a merely-congested rung must not pull the
            // percentage back down from a previously-reached severe level
            if target > self.fec_percentage {
                self.set_fec(target, cause);
            }
        } else if self.fec_relax_pending && self.fec_percentage > self.fec_base {
            // a full clean ENet window passed since congestion: one notch
            // back toward the base, the flag consumed with the notch
            self.fec_relax_pending = false;
            let next = self
                .fec_percentage
                .saturating_sub(FEC_PERCENT_STEP)
                .max(self.fec_base);
            self.set_fec(next, "clean-link");
        }

        let since_last = self.last_change.map(|last| now.duration_since(last));
        if negative {
            if since_last.is_some_and(|elapsed| elapsed < MIN_STEP_INTERVAL) {
                return None; // hysteresis: one step per second at most
            }
            // With corroboration, a flood window of the episode (>3
            // applied requests in the rolling 2s window) is the first
            // window's instant relief: the client is already starving —
            // step harder and don't wait for any trend. The shot is one
            // per episode; later flood windows step at the normal rate.
            let fast_flood = self.idr_flood_fast_pending
                && flood_licensed
                && self.idr_in_window > IDR_FLOOD_FAST_THRESHOLD;
            let reason = if fast_flood {
                "idr-flood-fast"
            } else if flood_licensed {
                "idr-flood"
            } else if self.loss_in_window {
                "loss-stats"
            } else {
                "send-buffer"
            };
            let factor = if fast_flood {
                BACKOFF_FACTOR_IDR_FLOOD_FAST
            } else if reason == "idr-flood" {
                BACKOFF_FACTOR_IDR_FLOOD
            } else if reason == "loss-stats" {
                BACKOFF_FACTOR_LOSS_STATS
            } else {
                BACKOFF_FACTOR_SEND_BUFFER
            };
            let next = ((self.current_kbps as f64 * factor) as u32).max(self.floor_kbps);
            if next >= self.current_kbps {
                return None;
            }
            if fast_flood || reason == "idr-flood" {
                // the episode's instant-relief shot is spent
                self.idr_flood_fast_pending = false;
            }
            self.apply(next, now);
            return Some((next, reason.to_string()));
        }

        // sustained ENet congestion (2nd consecutive congested 5s
        // window): the ACK path is drowning in the video flood — step
        // down even though the local signals are clean. When the window
        // is congested with a nearly dead control channel on top, the
        // client is barely receiving at all: step down harder.
        let enet_step = if self.starved_windows >= ENET_CONGESTION_WINDOWS {
            Some((BACKOFF_FACTOR_ENET_SEVERE, "enet-severe"))
        } else if self.congested_windows >= ENET_CONGESTION_WINDOWS {
            Some((BACKOFF_FACTOR_ENET_CONGESTION, "enet-congestion"))
        } else {
            None
        };
        if let Some((factor, tag)) = enet_step {
            if since_last.is_some_and(|elapsed| elapsed < MIN_STEP_INTERVAL) {
                return None;
            }
            let (dups, drops, received) = self.enet_window;
            let next = ((self.current_kbps as f64 * factor) as u32).max(self.floor_kbps);
            if next < self.current_kbps {
                self.congested_windows = 0; // the verdicts are consumed
                self.starved_windows = 0;
                let events = dups.saturating_add(drops);
                let reason = format!("{tag} (events={events} dup={dups} recv={received})");
                self.apply(next, now);
                return Some((next, reason));
            }
        }

        // recovery: clean streak, step up slowly toward the ceiling
        let clean = self.clean_since.is_some_and(|since| {
            now.duration_since(since) >= CLEAN_STREAK
                && since_last.is_none_or(|elapsed| elapsed >= CLEAN_RAMP_INTERVAL)
        });
        if clean {
            let next = ((self.current_kbps as f64 * CLEAN_RAMP_STEP) as u32)
                .min(self.ceiling_kbps)
                .max(self.current_kbps);
            if next > self.current_kbps {
                self.apply(next, now);
                return Some((next, "clean-link".to_string()));
            }
        }
        None
    }

    fn apply(&mut self, kbps: u32, now: Instant) {
        self.current_kbps = kbps;
        self.last_change = Some(now);
        // the signals that led to this step are consumed: don't let the
        // same window re-trigger another step on the next tick
        self.window_start = now;
        self.idr_in_window = 0;
        self.loss_in_window = false;
        self.wouldblock_in_window = 0;
        if self.current_kbps >= self.ceiling_kbps {
            // back at the top: the clean streak restarts from scratch and
            // the next congestion episode earns the instant-relief shot
            self.clean_since = Some(now);
            self.idr_flood_fast_pending = true;
        }
    }

    /// Applies a new FEC percentage (clamped to FEC_PERCENT_MAX) when it
    /// differs from the current one, recording the transition for the
    /// video loop's log. Callers decide direction: the congestion ladder
    /// only raises, the clean-window notch only relaxes.
    fn set_fec(&mut self, percentage: u32, cause: &'static str) {
        let percentage = percentage.min(FEC_PERCENT_MAX);
        if percentage == self.fec_percentage {
            return;
        }
        let from = self.fec_percentage;
        self.fec_percentage = percentage;
        self.fec_transition = Some((from, percentage, cause));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ladder tests use a 720p60 geometry whose bits-per-pixel floor
    /// (3_981kbps) stays below FLOOR_KBPS, so they exercise the
    /// FLOOR_KBPS and negotiated/4 terms; the bpp term has its own tests
    /// (`floor_holds_the_bits_per_pixel_minimum`).
    fn controller(negotiated: u32) -> AdaptiveController {
        AdaptiveController::new(negotiated, 10, 1280, 720, 60)
    }

    /// `select_encode_size` / `ladder_size` / `size_ladder` with the
    /// maximum's own shape as the frame's aspect — what a maximum IS when
    /// the session's desktop and negotiation agree, which is every
    /// pure-rule test below. The controller never uses these: it passes the
    /// NEGOTIATED aspect, which the maximum's own height rounding only
    /// approximates (see `ladder_size`).
    fn select(max_w: u32, max_h: u32, kbps: u32, fps: u32, bpp_min_milli: u32) -> (u32, u32) {
        select_encode_size(max_w, max_h, (max_w, max_h), kbps, fps, bpp_min_milli)
    }

    fn rung(max_w: u32, max_h: u32, num: u32, den: u32) -> (u32, u32) {
        ladder_size(max_w, max_h, (max_w, max_h), num, den)
    }

    fn ladder(max_w: u32, max_h: u32) -> [(u32, u32); SIZE_LADDER.len()] {
        size_ladder(max_w, max_h, (max_w, max_h))
    }

    /// Feeds one controller evaluation window: ENET_WINDOW_TICKS 1s
    /// ticks, the first carrying the whole 5s wire-delta write (the
    /// control thread reports once per its 5s stats window and the
    /// video tick's swap picks the whole write up in one tick), the
    /// rest zero. Returns every step decision the controller produced
    /// during the window.
    fn feed_5s_window(
        c: &mut AdaptiveController,
        now: &mut Instant,
        dups: u64,
        drops: u64,
        recv: u64,
    ) -> Vec<(u32, String)> {
        let mut decisions = Vec::new();
        for tick in 0..ENET_WINDOW_TICKS {
            *now += Duration::from_secs(1);
            let (d, w, r) = if tick == 0 { (dups, drops, recv) } else { (0, 0, 0) };
            c.feed(*now, 0, false, 0, d, w, r);
            if let Some(decision) = c.evaluate(*now) {
                decisions.push(decision);
            }
        }
        decisions
    }

    #[test]
    fn steps_down_on_idr_flood_and_clamps_at_floor() {
        let start = Instant::now();
        let mut c = controller(72_000);
        // floor/ceiling clamp: ceiling is min(negotiated, cap)
        assert_eq!(c.current_kbps(), 60_000); // env cap default
        // the floor scales with the negotiated rate: a quarter of 72_000,
        // not the absolute 6Mbps — a 4K stream is not watchable there
        assert_eq!(c.floor_kbps(), 18_000);

        // a flood only licenses a step with corroboration (here a client
        // LOSS_STATS report in the same window): the flood itself is the
        // client reporting lost frames, not evidence our rate is too high
        c.feed(start, 5, true, 0, 0, 0, 0); // >3 IDR requests: first flood window
        let (next, reason) = c.evaluate(start).expect("step down");
        assert_eq!(reason, "idr-flood-fast");
        assert_eq!(next, 42_000); // -30%

        // hysteresis: immediate re-evaluation does not step again
        assert!(c.evaluate(start).is_none());

        // subsequent flood windows step at the normal -25%
        let now = start + Duration::from_secs(2);
        c.feed(now, 5, true, 0, 0, 0, 0);
        let (next, reason) = c.evaluate(now).expect("normal flood step");
        assert_eq!(reason, "idr-flood");
        assert_eq!(next, 31_500); // 42_000 * 0.75

        // hammer the floor
        let mut now = now;
        for _ in 0..20 {
            now += Duration::from_secs(2);
            c.feed(now, 5, true, 0, 0, 0, 0);
            c.evaluate(now);
        }
        assert_eq!(c.current_kbps(), c.floor_kbps());
        assert_eq!(c.current_kbps(), 18_000);
    }

    #[test]
    fn idr_flood_fast_first_window_then_normal_steps_and_floor_clamp() {
        let start = Instant::now();
        let mut c = controller(20_000);

        // first flood window (>3 applied requests in the rolling 2s
        // window): exactly one -30% fast step, no second step and no
        // up-step in the same window. Corroborated by a LOSS_STATS report
        // — a flood alone never steps (see the corroboration test below).
        c.feed(start, 4, true, 0, 0, 0, 0);
        let (next, reason) = c.evaluate(start).expect("fast step");
        assert_eq!(reason, "idr-flood-fast");
        assert_eq!(next, 14_000); // 20_000 * 0.70
        assert!(c.evaluate(start).is_none(), "one step per window");

        // second flood window: the normal -25% — the fast shot is spent
        let now = start + Duration::from_secs(2);
        c.feed(now, 4, true, 0, 0, 0, 0);
        let (next, reason) = c.evaluate(now).expect("normal flood step");
        assert_eq!(reason, "idr-flood");
        assert_eq!(next, 10_500); // 14_000 * 0.75

        // hammer the floor: 10_500 -> 7_875 -> 5_906 -> clamp 6_000
        // (negotiated 20_000 -> 20_000/4 is below the absolute floor)
        let mut now = now;
        for _ in 0..4 {
            now += Duration::from_secs(2);
            c.feed(now, 4, true, 0, 0, 0, 0);
            c.evaluate(now);
        }
        assert_eq!(c.floor_kbps(), FLOOR_KBPS);
        assert_eq!(c.current_kbps(), FLOOR_KBPS);
        assert_eq!(FLOOR_KBPS, 6_000);
    }

    #[test]
    fn idr_flood_fast_shot_rearms_only_at_the_ceiling() {
        let start = Instant::now();
        let mut c = controller(20_000);
        c.feed(start, 4, true, 0, 0, 0, 0);
        let (down, _) = c.evaluate(start).expect("fast step");
        assert_eq!(down, 14_000);
        let now = start + Duration::from_secs(2);
        c.feed(now, 4, true, 0, 0, 0, 0);
        c.evaluate(now); // normal -25% -> 10_500, fast shot spent

        // partial recovery (clean up-steps without reaching the ceiling)
        // does NOT re-arm the fast shot: the next flood is a normal step
        let mut now = now;
        for _ in 0..11 {
            now += Duration::from_secs(3);
            c.feed(now, 0, false, 0, 0, 0, 0);
            c.evaluate(now);
        }
        let before = c.current_kbps();
        assert!(before > 10_500, "recovered somewhat: {before}");
        let now = now + Duration::from_secs(3);
        c.feed(now, 4, true, 0, 0, 0, 0);
        let (next, reason) = c.evaluate(now).expect("flood after partial recovery");
        assert_eq!(reason, "idr-flood", "no fast shot before the ceiling");
        assert!(next < before);

        // full recovery back to the ceiling re-arms the shot: the next
        // flood window steps -30% again
        let mut now = now;
        for _ in 0..20 {
            now += Duration::from_secs(3);
            c.feed(now, 0, false, 0, 0, 0, 0);
            c.evaluate(now);
        }
        assert_eq!(c.current_kbps(), 20_000, "recovered to the ceiling");
        let now = now + Duration::from_secs(3);
        c.feed(now, 4, true, 0, 0, 0, 0);
        let (next, reason) = c.evaluate(now).expect("fast step after full recovery");
        assert_eq!(reason, "idr-flood-fast");
        assert_eq!(next, 14_000);
    }

    /// An IDR flood is the client reporting lost frames, not evidence that
    /// our bitrate is too high: on its own it must never step down (the
    /// picture only gets worse and the lost reference is not restored).
    /// With the ENet congestion verdict in the same window the flood is
    /// corroborated and does step — the ACK path is drowning, so relief
    /// is real — and the episode's fast shot is what fires.
    #[test]
    fn idr_flood_steps_down_only_with_corroboration() {
        let start = Instant::now();
        let mut c = controller(40_000);
        assert_eq!(c.floor_kbps(), 10_000); // 40_000 / 4

        // six flood windows with nothing else behind them: no step, not
        // even an up-step (the controller is at its ceiling)
        let mut now = start;
        for window in 0..6 {
            now += Duration::from_secs(2);
            c.feed(now, 5, false, 0, 0, 0, 0);
            assert!(
                c.evaluate(now).is_none(),
                "flood window {window} alone must not step"
            );
        }
        assert_eq!(c.current_kbps(), 40_000);

        // the same flood inside a congested 5s ENet window (the measured
        // 32 dup / 95 discards / 623 reliables shape: 127 combined
        // arrivals): licensed. The verdict
        // stays current until the next window is evaluated (5 ticks later),
        // so the flood may step again on the next tick the hysteresis
        // allows — every such step is corroborated, and none may escape the
        // flood family or pass the floor.
        let mut decisions = Vec::new();
        for tick in 0..ENET_WINDOW_TICKS {
            now += Duration::from_secs(1);
            let (drops, recv) = if tick == 0 { (95, 623) } else { (0, 0) };
            c.feed(now, 5, false, 0, 0, drops, recv);
            if let Some(decision) = c.evaluate(now) {
                decisions.push(decision);
            }
        }
        assert!(!decisions.is_empty(), "a corroborated flood must step");
        assert_eq!(decisions[0].1, "idr-flood-fast");
        assert_eq!(decisions[0].0, 28_000); // 40_000 * 0.70
        for (target, reason) in &decisions {
            assert!(reason.starts_with("idr-flood"), "{reason}");
            assert!(*target >= c.floor_kbps(), "below the floor: {target}");
        }
        assert!(c.current_kbps() < 40_000);
    }

    /// The ladder's floor is max(FLOOR_KBPS, negotiated/4, the geometry's
    /// bits-per-pixel floor): a session that asked for 64Mbps may not be
    /// crushed to 6Mbps (that is ~0.02 bits/pixel at 4K60 — a destroyed
    /// picture), while a 20Mbps session still bottoms out at the absolute
    /// 6Mbps. These assertions pass the bpp term explicitly as 0 (the
    /// two-term rule as it stood before the geometry term existed, with
    /// the same numbers); the geometry term is covered by
    /// `floor_holds_the_bits_per_pixel_minimum`.
    #[test]
    fn floor_scales_with_the_negotiated_bitrate() {
        // the rule itself, including a ceiling below the quarter: the
        // floor may never sit above it (a "down" step would go up)
        assert_eq!(session_floor(64_000, 60_000, 0), 16_000);
        assert_eq!(session_floor(80_000, 60_000, 0), 20_000);
        assert_eq!(session_floor(20_000, 20_000, 0), FLOOR_KBPS);
        assert_eq!(session_floor(0, FLOOR_KBPS, 0), FLOOR_KBPS);
        assert_eq!(session_floor(100_000, 10_000, 0), 10_000);

        let start = Instant::now();
        // 64Mbps negotiated (capped at the 60Mbps env default): whatever
        // the ladder is fed, it stops at a quarter of the negotiated rate
        let mut c = controller(64_000);
        assert_eq!(c.floor_kbps(), 16_000);
        let mut now = start;
        for _ in 0..30 {
            now += Duration::from_secs(2);
            c.feed(now, 5, true, 0, 0, 0, 0);
            c.evaluate(now);
        }
        assert_eq!(c.current_kbps(), 16_000);

        // 20Mbps negotiated (a quarter is below the absolute floor): the
        // 6Mbps floor still governs
        let mut c = controller(20_000);
        assert_eq!(c.floor_kbps(), FLOOR_KBPS);
        let mut now = start;
        for _ in 0..30 {
            now += Duration::from_secs(2);
            c.feed(now, 5, true, 0, 0, 0, 0);
            c.evaluate(now);
        }
        assert_eq!(c.current_kbps(), FLOOR_KBPS);
    }

    /// The geometry term is the hard floor: at 4K60 the ladder stops near
    /// 36Mbps however little the client negotiated, because below it the
    /// one-frame VBV cannot drain fast enough to hold 60fps *with margin*
    /// (at the 0.05bpp rate the drain alone spends a whole frame interval —
    /// a 1080p60 session pinned at its 6,220kbps floor dropped 163
    /// already-encoded frames, and a 4K60 session stepped to 16Mbps
    /// collapsed to 32fps and then to 4fps). The ceiling clamp still wins,
    /// so a session whose ceiling sits below the geometric floor cannot be
    /// stepped at all rather than stepped upward.
    #[test]
    fn floor_holds_the_bits_per_pixel_minimum() {
        // the term itself: pixels * fps * bpp. 72 is the shipped default
        // (0.072 bpp); 50 is the rate whose VBV drain spends the whole
        // frame interval, kept here as the comparison the floor came from.
        assert_eq!(bpp_floor_kbps(3840, 2160, 60, 72), 35_831);
        assert_eq!(bpp_floor_kbps(2560, 1440, 60, 72), 15_925);
        assert_eq!(bpp_floor_kbps(1920, 1080, 60, 72), 8_957);
        assert_eq!(bpp_floor_kbps(3840, 2160, 60, 50), 24_883);
        // a zero geometry or a disabled override drops the term
        assert_eq!(bpp_floor_kbps(0, 0, 60, 72), 0);
        assert_eq!(bpp_floor_kbps(3840, 2160, 0, 72), 0);
        assert_eq!(bpp_floor_kbps(3840, 2160, 60, 0), 0);

        // each floor term wins in turn
        assert_eq!(session_floor(64_000, 60_000, 35_831), 35_831); // bpp over negotiated/4
        assert_eq!(session_floor(20_000, 20_000, 35_831), 20_000); // ...but never over the ceiling
        assert_eq!(session_floor(64_000, 60_000, 15_925), 16_000); // negotiated/4 over bpp
        assert_eq!(session_floor(20_000, 20_000, 8_957), 8_957); // bpp over FLOOR_KBPS
        assert_eq!(session_floor(20_000, 20_000, 2_764), FLOOR_KBPS); // FLOOR_KBPS over bpp
        assert_eq!(session_floor(100_000, 10_000, 35_831), 10_000); // ceiling clamp

        // a 4K60 session: the ladder walks down to the geometric floor and
        // stops there, well above what the two-term rule would have allowed
        let mut c = AdaptiveController::new(64_000, 10, 3840, 2160, 60);
        assert_eq!(c.floor_kbps(), 35_831);
        let mut now = Instant::now();
        for _ in 0..30 {
            now += Duration::from_secs(2);
            c.feed(now, 5, true, 0, 0, 0, 0);
            c.evaluate(now);
        }
        assert_eq!(
            c.current_kbps(),
            35_831,
            "4K60 must not be stepped below the bits-per-pixel floor"
        );

        // 1440p60 and 1080p60 floors scale with the geometry
        let c = AdaptiveController::new(30_000, 10, 2560, 1440, 60);
        assert_eq!(c.floor_kbps(), 15_925);
        let c = AdaptiveController::new(20_000, 10, 1920, 1080, 60);
        assert_eq!(c.floor_kbps(), 8_957);

        // a link that cannot hold the geometry's floor: the floor is
        // clamped to the ceiling, so no down-step is possible — the
        // ladder never steps upward to reach it
        let mut c = AdaptiveController::new(8_000, 10, 2560, 1440, 60);
        assert_eq!(c.floor_kbps(), 8_000);
        assert_eq!(c.current_kbps(), 8_000);
        let mut now = Instant::now();
        for _ in 0..5 {
            now += Duration::from_secs(2);
            c.feed(now, 5, true, 0, 0, 0, 0);
            assert!(
                c.evaluate(now).is_none(),
                "the floor is the ceiling: nothing to step to"
            );
        }
        assert_eq!(c.current_kbps(), 8_000);
    }

    #[test]
    fn steps_down_on_loss_stats_and_send_buffer() {
        let start = Instant::now();
        let mut c = controller(30_000);
        assert_eq!(c.current_kbps(), 30_000); // below the cap: untouched

        c.feed(start, 0, true, 0, 0, 0, 0);
        let (next, reason) = c.evaluate(start).expect("loss step");
        assert_eq!(reason, "loss-stats");
        assert_eq!(next, 24_000); // -20%

        let now = start + Duration::from_secs(2);
        c.feed(now, 0, false, 60, 0, 0, 0); // wouldblock trend
        let (next, reason) = c.evaluate(now).expect("buffer step");
        assert_eq!(reason, "send-buffer");
        assert_eq!(next, 20_400); // -15%
    }

    #[test]
    fn ramps_up_only_after_a_clean_streak_with_hysteresis() {
        let start = Instant::now();
        let mut c = controller(20_000);
        // force a down step first (a flood needs corroboration)
        c.feed(start, 5, true, 0, 0, 0, 0);
        let (down, _) = c.evaluate(start).expect("down");
        assert_eq!(down, 14_000); // first flood window: -30% fast step

        // 10 clean ticks (1s apart): the streak is still short of 10s
        // after each one, so no ramp
        let mut now = start;
        for _ in 0..10 {
            now += Duration::from_secs(1);
            c.feed(now, 0, false, 0, 0, 0, 0);
            assert!(c.evaluate(now).is_none());
        }
        // 11th clean tick: streak reaches 10s -> ramp +5%
        now += Duration::from_secs(1);
        c.feed(now, 0, false, 0, 0, 0, 0);
        let (up, reason) = c.evaluate(now).expect("ramp up");
        assert_eq!(reason, "clean-link");
        assert_eq!(up, 14_700);

        // hysteresis: recovery steps no faster than every 3s
        let soon = now + Duration::from_secs(1);
        c.feed(soon, 0, false, 0, 0, 0, 0);
        assert!(c.evaluate(soon).is_none());
    }

    #[test]
    fn never_exceeds_ceiling_and_negative_signal_resets_clean_streak() {
        let start = Instant::now();
        let mut c = controller(12_000);
        c.feed(start, 5, true, 0, 0, 0, 0);
        let (down, _) = c.evaluate(start).expect("down");
        assert_eq!(down, 8_400);

        // a loss before the ramp: another down step, and the clean streak
        // restarts from scratch
        let mut now = start;
        for _ in 0..9 {
            now += Duration::from_secs(1);
            c.feed(now, 0, false, 0, 0, 0, 0);
            c.evaluate(now);
        }
        now += Duration::from_secs(1);
        c.feed(now, 0, true, 0, 0, 0, 0); // loss right before the ramp
        let (down2, reason) = c.evaluate(now).expect("second down");
        assert_eq!(reason, "loss-stats");
        assert!(down2 < down);

        // the streak restarted: 9 clean ticks are not enough to ramp
        for _ in 0..9 {
            now += Duration::from_secs(1);
            c.feed(now, 0, false, 0, 0, 0, 0);
            assert!(c.evaluate(now).is_none());
        }

        // ceiling clamp on the way back up
        let mut c2 = controller(12_000);
        c2.feed(start, 5, true, 0, 0, 0, 0);
        c2.evaluate(start);
        let mut now2 = start;
        for _ in 0..60 {
            now2 += Duration::from_secs(3);
            c2.feed(now2, 0, false, 0, 0, 0, 0);
            c2.evaluate(now2);
        }
        assert!(c2.current_kbps() <= 12_000);
    }

    #[test]
    fn enet_congestion_steps_down_on_second_consecutive_window() {
        let start = Instant::now();
        let mut c = controller(40_000);
        // force a corroborated down step, then verify congestion blocks
        // the recovery
        c.feed(start, 5, true, 0, 0, 0, 0);
        let (down, _) = c.evaluate(start).expect("down");
        assert_eq!(down, 28_000);

        let mut now = start;
        // first congested window (the measured 32 dup / 95 discards / 623
        // reliables window where the user started playing, fed here as its
        // refusals alone — 95 events either way, well past the 30-event
        // floor): no step — one window can be a burst — and no up-step either
        let decisions = feed_5s_window(&mut c, &mut now, 0, 95, 623);
        assert!(decisions.is_empty(), "one window is not a trend: {decisions:?}");
        assert_eq!(c.current_kbps(), 28_000);

        // second consecutive congested window: -25%, reason quoting the
        // raw window inputs
        let decisions = feed_5s_window(&mut c, &mut now, 0, 95, 623);
        assert_eq!(decisions.len(), 1, "exactly one step: {decisions:?}");
        assert_eq!(decisions[0].0, 21_000); // 28_000 * 0.75
        assert_eq!(decisions[0].1, "enet-congestion (events=95 dup=0 recv=623)");

        // the streak was consumed: a third window alone must not re-step
        let decisions = feed_5s_window(&mut c, &mut now, 0, 95, 623);
        assert!(decisions.is_empty(), "consumed streak must not re-step: {decisions:?}");

        // ...and a fourth congested window steps again (relief continues)
        let decisions = feed_5s_window(&mut c, &mut now, 0, 95, 623);
        assert_eq!(decisions.len(), 1, "relief must continue: {decisions:?}");
        assert_eq!(decisions[0].0, 15_750); // 21_000 * 0.75
    }

    /// The severe rung is untouched by the recalibration: a congested
    /// window that received almost nothing (a nearly dead control channel)
    /// still steps -30%, and a congested one with a healthy denominator
    /// -25%. (The measured weak windows — 2-11 events against 49-58
    /// reliables — no longer count as congested at all, so they can no
    /// longer reach either rung; the shape that reaches the severe rung is
    /// a real flood against a starved channel.)
    #[test]
    fn enet_severe_near_zero_recv_steps_down_harder() {
        let start = Instant::now();
        let mut c = controller(40_000);
        let mut now = start;
        // control channel nearly dead (20 reliables/5s) and 6 refused
        // re-sends — 30% of what it received: a congested window at this
        // recv rate is severe
        assert!(feed_5s_window(&mut c, &mut now, 0, 6, 20).is_empty());
        let decisions = feed_5s_window(&mut c, &mut now, 0, 6, 20);
        assert_eq!(decisions.len(), 1, "severe step on the 2nd window: {decisions:?}");
        assert_eq!(decisions[0].0, 28_000); // 40_000 * 0.70
        assert_eq!(decisions[0].1, "enet-severe (events=6 dup=0 recv=20)");

        // a merely congested (not starved) link steps at the normal -25%
        assert!(feed_5s_window(&mut c, &mut now, 0, 50, 200).is_empty());
        let decisions = feed_5s_window(&mut c, &mut now, 0, 50, 200);
        assert_eq!(decisions.len(), 1);
        assert_eq!(decisions[0].0, 21_000); // 28_000 * 0.75
        assert_eq!(decisions[0].1, "enet-congestion (events=50 dup=0 recv=200)");
    }

    #[test]
    fn enet_wiring_live_trace_steps_down_repeatedly() {
        // 13 consecutive congested 5s windows (the measured 32 dup / 95
        // discards / 623 reliables shape, 127 combined arrivals)
        // while every local signal reads clean. The old verdict wiring
        // consumed each window's verdict at most once per 5s and the
        // controller never stepped; the raw-delta wiring must step down
        // repeatedly.
        let start = Instant::now();
        let mut c = controller(31_500);
        assert_eq!(c.current_kbps(), 31_500);
        let mut now = start;
        let mut steps = Vec::new();
        for _ in 0..13 {
            steps.extend(feed_5s_window(&mut c, &mut now, 0, 95, 623));
        }
        assert!(steps.len() >= 2, "relief must fire repeatedly: {steps:?}");
        for (target, reason) in &steps {
            assert_eq!(reason, "enet-congestion (events=95 dup=0 recv=623)");
            assert!(*target < 31_500);
        }
        for pair in steps.windows(2) {
            assert!(pair[1].0 < pair[0].0, "steps must decrease: {steps:?}");
        }
        // the drowned link actually got relief, down to the session floor
        assert!(c.current_kbps() <= 12_000, "drowned link: {}", c.current_kbps());
    }

    #[test]
    fn enet_window_accumulates_raw_deltas_across_ticks() {
        // the control thread's 5s write lands in a single 1s tick swap,
        // but the controller must reach the same verdict however the
        // raw deltas are spread across its window: the same totals
        // split over two ticks evaluate identically
        let start = Instant::now();
        let mut c = controller(40_000);
        let mut now = start;
        let mut decisions = Vec::new();
        for _ in 0..2 {
            // the measured drowning window, split: 95 refused re-sends and
            // 623 reliables in total, with no duplicates in these ticks
            for (drops, recv) in [(0, 0), (0, 0), (48, 312), (47, 311), (0, 0)] {
                now += Duration::from_secs(1);
                c.feed(now, 0, false, 0, 0, drops, recv);
                if let Some(decision) = c.evaluate(now) {
                    decisions.push(decision);
                }
            }
        }
        assert_eq!(decisions.len(), 1, "step on the 2nd accumulated window: {decisions:?}");
        assert_eq!(decisions[0].0, 30_000); // 40_000 * 0.75
        assert_eq!(decisions[0].1, "enet-congestion (events=95 dup=0 recv=623)");
    }

    /// The verdict's calibration, checked against the windows the measured
    /// iPad session actually produced. The rule before the calibration read
    /// ANY retransmit on a starved channel (`recv < 100`) and 3+ events over
    /// a 1% share as congestion; a window now needs 5 events AND more than
    /// 20% of the reliables it received, or 30 events outright, where an
    /// event is one retransmit *arrival*: a re-send the receive window
    /// refused or a re-send of a sequence already seen at the delivery
    /// cursor. The tuples below are the raw window counters the control
    /// thread reports — (dups, window_drops, received) — and the function
    /// sums the first two: they are different arrivals of the same
    /// retransmit pressure, so either side alone can carry a window over
    /// the thresholds.
    #[test]
    fn enet_window_congestion_thresholds() {
        // the five windows that walked 64000 -> 45000 -> 33750 -> 25312 ->
        // 19979 -> 16000kbps in 50s (client reporting 0% network loss)
        // carried dup=26/2/6/9/11 against recv=74/49/53/56/58, 4-19% shares
        // that are the wireless control channel's background rate and no
        // refused arrivals at all, so they stay clean. What the 20% share
        // still fires on is a window that really refused re-sends, e.g. 26
        // of 74 (35%)...
        assert!(!enet_window_congested(0, 0, 74));
        assert!(enet_window_congested(26, 0, 74));
        // ...while the 4/11/16/19% shares do not. Before the calibration
        // all four read as congested (recv < 100 made ANY retransmit
        // congestion), which is what cut a healthy stream.
        assert!(!enet_window_congested(2, 0, 49));
        assert!(!enet_window_congested(6, 0, 53));
        assert!(!enet_window_congested(9, 0, 56));
        assert!(!enet_window_congested(11, 0, 58));
        // the windows that really were drowning our receive window (the
        // user started playing and the rule began refusing re-sends under
        // input load) carried 27-95 refusals on top of 20-83 duplicates.
        // The 95-refusal / 623-reliable window fires on the 30-event floor
        // (127 combined arrivals), and so do the (20, 27) and (83, 18)
        // windows (47 and 101 combined) — neither of those two would fire
        // on its refusal count alone (an 11% and a 5% share).
        assert!(enet_window_congested(0, 95, 623));
        assert!(enet_window_congested(20, 27, 238));
        assert!(enet_window_congested(83, 18, 363));
        // the share gate needs BOTH the 5-event minimum and the 20% share
        assert!(!enet_window_congested(0, 4, 1000)); // below the minimum
        assert!(enet_window_congested(0, 5, 20)); // 25% of a quiet window
        assert!(!enet_window_congested(0, 5, 25)); // 5 is not > 20% of 25
        assert!(enet_window_congested(0, 6, 25));
        assert!(!enet_window_congested(0, 10, 1000)); // 1%
        // the two counters are one figure: either side can carry a window
        // over the 30-event floor, and neither is counted twice...
        assert!(enet_window_congested(20, 10, 1000)); // 30 combined, 2% share
        assert!(!enet_window_congested(20, 9, 1000)); // 29 combined
        // a silent control channel (no reliables to take a share of) can
        // only congest on the absolute floor
        assert!(enet_window_congested(30, 0, 0));
        assert!(!enet_window_congested(29, 0, 0));
        assert!(enet_window_congested(0, 30, 0));
        // a healthy busy window is not congested, and a quiet client with
        // no refused re-sends never is
        assert!(!enet_window_congested(0, 0, 500));
        assert!(!enet_window_congested(1, 0, 900));
        assert!(!enet_window_congested(0, 0, 51));
    }

    #[test]
    fn fec_ladder_raises_on_congestion_then_severe_and_relaxes_per_clean_window() {
        let start = Instant::now();
        let mut c = controller(40_000);
        assert_eq!(c.current_fec_percentage(), 10);
        let mut now = start;

        // first congested window alone (the measured 32 dup / 95 discards /
        // 623 reliables window, not the (20, 27) pair: either shape clears
        // the 30-event floor on its combined arrivals): no raise — one
        // window can be a burst
        assert!(feed_5s_window(&mut c, &mut now, 0, 95, 623).is_empty());
        assert_eq!(c.current_fec_percentage(), 10);
        assert!(c.take_fec_transition().is_none());

        // 2nd consecutive congested window: FEC 10 -> 20 alongside the
        // bitrate step
        let decisions = feed_5s_window(&mut c, &mut now, 0, 95, 623);
        assert_eq!(decisions.len(), 1);
        assert_eq!(c.current_fec_percentage(), FEC_PERCENT_CONGESTION);
        assert_eq!(
            c.take_fec_transition(),
            Some((10, 20, "congestion"))
        );

        // severe trend (congested with a nearly dead control channel:
        // 6 refused re-sends against 20 reliables): 20 -> 30
        assert!(feed_5s_window(&mut c, &mut now, 0, 6, 20).is_empty());
        feed_5s_window(&mut c, &mut now, 0, 6, 20);
        assert_eq!(c.current_fec_percentage(), FEC_PERCENT_SEVERE);
        assert_eq!(c.take_fec_transition(), Some((20, 30, "severe")));

        // one clean window relaxes exactly one notch (30 -> 20); the flag
        // is consumed with the notch, so the remaining ticks of the same
        // window must not relax further
        feed_5s_window(&mut c, &mut now, 0, 0, 500);
        assert_eq!(c.current_fec_percentage(), 20);
        assert_eq!(c.take_fec_transition(), Some((30, 20, "clean-link")));
        assert!(c.take_fec_transition().is_none());

        // a second clean window completes the relaxation to the base
        feed_5s_window(&mut c, &mut now, 0, 0, 500);
        assert_eq!(c.current_fec_percentage(), 10);
        assert_eq!(c.take_fec_transition(), Some((20, 10, "clean-link")));
    }

    #[test]
    fn fec_ladder_is_raise_only_while_congestion_persists() {
        let start = Instant::now();
        let mut c = controller(40_000);
        let mut now = start;
        // climb to severe
        feed_5s_window(&mut c, &mut now, 0, 6, 20);
        feed_5s_window(&mut c, &mut now, 0, 6, 20);
        assert_eq!(c.current_fec_percentage(), FEC_PERCENT_SEVERE);
        c.take_fec_transition();

        // sustained merely-congested (not starved) windows must NOT pull
        // the percentage down from the severe level — the ladder relaxes
        // only through clean windows
        for _ in 0..4 {
            feed_5s_window(&mut c, &mut now, 0, 50, 200);
            assert_eq!(
                c.current_fec_percentage(),
                FEC_PERCENT_SEVERE,
                "raise-only while congested"
            );
        }
        assert!(c.take_fec_transition().is_none(), "no transitions while merely congested");
    }

    #[test]
    fn fec_ladder_jumps_straight_to_severe_and_never_exceeds_the_cap() {
        // starved from the base: the 2nd consecutive starved window goes
        // straight to the severe rung
        let start = Instant::now();
        let mut c = controller(40_000);
        let mut now = start;
        assert!(feed_5s_window(&mut c, &mut now, 0, 6, 20).is_empty());
        feed_5s_window(&mut c, &mut now, 0, 6, 20);
        assert_eq!(c.current_fec_percentage(), FEC_PERCENT_SEVERE);
        assert_eq!(c.take_fec_transition(), Some((10, 30, "severe")));

        // a configured base above the cap is clamped: FEC_PERCENT_MAX is
        // the ceiling for every percentage the controller can emit
        let mut capped = AdaptiveController::new(40_000, 80, 1280, 720, 60);
        assert_eq!(capped.current_fec_percentage(), FEC_PERCENT_MAX);
        for _ in 0..4 {
            feed_5s_window(&mut capped, &mut now, 0, 6, 20);
        }
        assert!(capped.current_fec_percentage() <= FEC_PERCENT_MAX);
    }

    #[test]
    fn select_encode_size_keeps_the_maximum_while_the_bitrate_pays_for_it() {
        // exactly at the threshold: 3840x2160x60 at the shipped 72
        // milli-bpp needs 35,831kbps, the same number the bitrate ladder's
        // floor uses
        assert_eq!(select(3840, 2160, 35_831, 60, 72), (3840, 2160));
        assert_eq!(select(3840, 2160, 60_000, 60, 72), (3840, 2160));
        assert_eq!(bpp_floor_kbps(3840, 2160, 60, 72), 35_831);
        // one kbps below and the maximum no longer fits: the largest rung
        // that does — 2,880x1,616, the 3/4 rung through the macroblock grid
        // (3/4 of 3,840 columns is 2,880; its 16:9 height 1,620 rounds to
        // the nearest multiple of 16, which is 1,616, whose own floor is
        // 20,105kbps)
        assert_eq!(select(3840, 2160, 35_830, 60, 72), (2880, 1616));
        // a zero override (the term disabled) and a zero geometry never
        // select anything but the maximum
        assert_eq!(select(3840, 2160, 1_000, 60, 0), (3840, 2160));
        assert_eq!(select(3840, 2160, 1, 60, 0), (3840, 2160));
        assert_eq!(select(0, 0, 16_000, 60, 72), (0, 0));
        assert_eq!(select(0, 2160, 16_000, 60, 72), (0, 2160));
        // a zero fps has no bits-per-pixel floor either
        assert_eq!(select(3840, 2160, 1, 0, 72), (3840, 2160));
    }

    /// The measured case, as a pure rule: 4K60 at 16,000kbps. The size it
    /// picks is the 2/3 rung — 2,560x1,440 is the largest size whose floor
    /// (15,925kbps) fits — and it gets 0.072 bpp where 4K got 0.032, right
    /// at the floor the encoder needs to hold 60fps with margin. The other
    /// configs the product owner named are covered too: 4K at 10,000kbps
    /// lands on 1080p (0.079 bpp), and a bitrate below the whole ladder
    /// bottoms out at the 1/4 rung, never at a degenerate size.
    #[test]
    fn select_encode_size_matches_the_measured_failure_and_names_the_resulting_bpp() {
        assert_eq!(select(3840, 2160, 16_000, 60, 72), (2560, 1440));
        assert_eq!(bits_per_pixel_milli(2560, 1440, 60, 16_000), 72);
        // what the size it left could not hold
        assert_eq!(bits_per_pixel_milli(3840, 2160, 60, 16_000), 32);
        assert!(bits_per_pixel_milli(2560, 1440, 60, 16_000) >= 72);

        assert_eq!(select(3840, 2160, 10_000, 60, 72), (1920, 1088));
        assert_eq!(bits_per_pixel_milli(1920, 1088, 60, 10_000), 79);

        // far below the maximum: the rule walks several rungs (4K60 at
        // 4,000kbps needs the 1/4 rung, whose floor is 2,256kbps)
        assert_eq!(select(3840, 2160, 4_000, 60, 72), (960, 544));
        assert_eq!(select(3840, 2160, 1_000, 60, 72), (960, 544));
    }

    /// The macroblock rounding, measured on the reported ultrawide
    /// session: the 2/3 rung of a 3,440-column maximum is 2,293 columns
    /// truncated from 3,440*2/3 and rounds DOWN to 2,288 (143 whole
    /// macroblocks); its height follows that width at the frame's aspect
    /// and lands on the NEAREST multiple of 16 (1,287 -> 1,280), so the
    /// rung is 2,288x1,280 — 0.55% off 16:9, the most the grid costs at
    /// these rungs. (Before the alignment this rung was 2,292x1,290, and
    /// the client could not decode it.)
    #[test]
    fn select_encode_size_rounds_down_to_macroblock_pixels_and_keeps_the_aspect_ratio() {
        assert_eq!(rung(3440, 1440, 2, 3), (2288, 960));
        assert_eq!(rung(3440, 1440, 3, 4), (2576, 1072));
        assert_eq!(rung(3440, 1440, 1, 2), (1712, 720));
        assert_eq!(rung(3440, 1440, 2, 5), (1376, 576));
        assert_eq!(rung(3440, 1440, 1, 4), (848, 352));
        // every rung of a 16:9 maximum keeps the 16:9 aspect within half a
        // macroblock (the most the grid can cost: the height is the nearest
        // multiple of 16 to the aspect-true value) and every dimension is a
        // whole number of macroblocks
        for (num, den) in SIZE_LADDER {
            let (w, h) = rung(3840, 2160, num, den);
            assert_eq!(w % MACROBLOCK, 0, "{num}/{den}: {w}x{h}");
            assert_eq!(h % MACROBLOCK, 0, "{num}/{den}: {w}x{h}");
            assert!(
                h.abs_diff(w * 9 / 16) <= MACROBLOCK / 2,
                "{num}/{den}: {w}x{h} lost the aspect"
            );
        }
    }

    /// Every DERIVED rung of several geometries is macroblock-aligned in BOTH
    /// dimensions: the invariant that makes the ladder safe for hardware
    /// decoders (Apple's VideoToolbox prominently), and the one the
    /// measured unaligned rungs — 2580x1452, 2292x1290, 1720x968, 1376x774
    /// — broke. The 1/1 rung is exempt: it IS the session's maximum, i.e.
    /// the size the client asked for, and that size is not ours to move (see
    /// `base_size`) — a 1920x1080 negotiation stays 1920x1080, not 1,072.
    /// The 4K client on the 3440x1440 desktop (the reported session) and the
    /// 1440p/720p geometries are all covered, and every derived rung stays
    /// within half a macroblock of the aspect it was derived from.
    #[test]
    fn every_ladder_rung_is_macroblock_aligned_in_both_dimensions() {
        for (max_w, max_h, aspect) in [
            (3840, 2160, (3840, 2160)),
            (3440, 1936, (3840, 2160)),
            (3440, 1440, (3440, 1440)),
            (2560, 1440, (2560, 1440)),
            (1920, 1080, (1920, 1080)),
            (1280, 720, (1280, 720)),
        ] {
            for (num, den) in SIZE_LADDER.iter().skip(1) {
                let (w, h) = ladder_size(max_w, max_h, aspect, *num, *den);
                assert_eq!(
                    (w % MACROBLOCK, h % MACROBLOCK),
                    (0, 0),
                    "{max_w}x{max_h} {num}/{den}: {w}x{h} is off the macroblock grid"
                );
                // the aspect the rung carries is the frame's, within the
                // half-macroblock the nearest rounding can cost
                let expected = (w as u64 * aspect.1 as u64 / aspect.0 as u64) as u32;
                assert!(
                    h.abs_diff(expected) <= MACROBLOCK / 2,
                    "{max_w}x{max_h} {num}/{den}: {w}x{h} left the {}x{} aspect ({expected})",
                    aspect.0,
                    aspect.1
                );
                // and it never exceeds the base it was derived from
                assert!(w <= max_w && h <= max_h, "{w}x{h} > {max_w}x{max_h}");
            }
            // the 1/1 rung IS the maximum: the client's own size, width-
            // capped and even, with no macroblock grid applied to it
            assert_eq!(size_ladder(max_w, max_h, aspect)[0], (max_w, max_h));
            assert_eq!(base_size(max_w, max_h, aspect), (max_w, max_h));
        }

        // the width-capped negotiated sizes clients really ask for, stayed
        // verbatim: 1920x1080 and 1280x720 lose nothing (a 1,080-row frame is
        // what Sunshine hands NVENC, which pads the coded frame itself), the
        // 3440x1440 desktop at the client's 16:9 keeps 3440x1936, and an odd
        // desktop width is capped DOWN — a column the desktop does not have is
        // never invented
        assert_eq!(base_size(1920, 1080, (1920, 1080)), (1920, 1080));
        assert_eq!(base_size(1280, 720, (1280, 720)), (1280, 720));
        assert_eq!(base_size(2560, 1440, (2560, 1440)), (2560, 1440));
        assert_eq!(base_size(3840, 2160, (3840, 2160)), (3840, 2160));
        assert_eq!(base_size(3440, 2160, (3840, 2160)), (3440, 1936));
        assert_eq!(base_size(3441, 2160, (3840, 2160)), (3440, 1936));
    }

    /// The 16x16 floor: a rung never collapses below one macroblock on
    /// either axis — not from a degenerate maximum (an encoder resolving a
    /// tiny geometry) and not from the smallest rung — because a
    /// sub-macroblock encode is exactly what a hardware decoder rejects.
    #[test]
    fn select_encode_size_never_goes_below_sixteen_by_sixteen() {
        assert_eq!(macroblock_down(1), 16);
        assert_eq!(macroblock_down(0), 16);
        assert_eq!(macroblock_down(31), 16);
        assert_eq!(macroblock_round(1, u32::MAX), 16);
        for (num, den) in SIZE_LADDER {
            let (w, h) = rung(4, 4, num, den);
            assert!(w >= 16 && h >= 16, "{num}/{den}: {w}x{h}");
            let (w, h) = rung(2, 2, num, den);
            assert!(w >= 16 && h >= 16, "{num}/{den}: {w}x{h}");
        }
        let (w, h) = select(4, 4, 8_000, 60, 72);
        assert!(w >= 16 && h >= 16, "{w}x{h}");
        // nothing in the ladder is affordable: the smallest rung, never a
        // degenerate size
        let (w, h) = select(3840, 2160, 0, 60, 72);
        assert!(w >= 16 && h >= 16, "{w}x{h}");
    }

    /// The ladder's rungs, pinned: every rung is one of the fixed fractions
    /// of the session's maximum — the 1/1 rung being that maximum itself (the
    /// client's own size, see `base_size`), every rung below it a derived,
    /// macroblock-aligned size — strictly descending in area, which is what
    /// makes a selection from it a resolution order. The rung walkers this
    /// table used to feed (`next_size_up` / `next_size_down`) are gone with
    /// the mid-session stepping: the table is read once per session now, when
    /// the loop resolves the size before the first frame.
    #[test]
    fn size_ladder_rungs_are_the_fixed_fractions_of_the_maximum() {
        assert_eq!(
            ladder(3840, 2160),
            [
                (3840, 2160),
                (2880, 1616),
                (2560, 1440),
                (1920, 1088),
                (1536, 864),
                (960, 544)
            ]
        );
        // a 1080p maximum: the 1/1 rung is the client's own size — 1,080 rows
        // are not a whole number of macroblocks, and it used to be walked down
        // to 1,072 for no benefit — while every rung below it keeps the
        // client's 16:9 on the macroblock grid
        assert_eq!(
            ladder(1920, 1080),
            [
                (1920, 1080),
                (1440, 816),
                (1280, 720),
                (960, 544),
                (768, 432),
                (480, 272)
            ]
        );
        // 720p is on both grids already, so nothing moves at all
        assert_eq!(
            ladder(1280, 720),
            [
                (1280, 720),
                (960, 544),
                (848, 480),
                (640, 368),
                (512, 288),
                (320, 176)
            ]
        );
        // the 1/1 rung is the maximum verbatim: an odd column count is taken
        // down to even parity (a column the desktop does not have is never
        // invented) and the height follows that width at the maximum's aspect
        assert_eq!(ladder(3841, 2161)[0], (3840, 2160));
        let areas: Vec<u64> = ladder(3440, 1936)
            .iter()
            .map(|(w, h)| *w as u64 * *h as u64)
            .collect();
        for window in areas.windows(2) {
            assert!(window[0] > window[1], "rungs must descend: {areas:?}");
        }
    }

    /// The measured session, resolved before the first frame: a 4K60 client
    /// that negotiated 64,000kbps. `initial_encode_size` is the whole policy
    /// now — the size the session starts at is the largest rung that
    /// bitrate pays for — and nothing steps it afterwards. The session that
    /// used to walk down to 16Mbps at 4K (and collapse to 32fps), or to
    /// 2,880x1,616 mid-stream (and cost the client its decoder), starts at
    /// the rung instead.
    #[test]
    fn initial_encode_size_resolves_the_measured_4k_session_before_the_first_frame() {
        // the 64Mbps ceiling still pays for 4K on a 4K desktop: the session
        // starts exactly where it negotiated, no recreation at all
        let mut c = AdaptiveController::new(64_000, 10, 3840, 2160, 60);
        c.set_geometry((3840, 2160), Some((3840, 2160)));
        assert_eq!(c.initial_encode_size(), Some((3840, 2160)));

        // the same session on a link that cannot hold the geometry's
        // 35,831kbps floor starts at the rung its 16,000kbps does pay for:
        // 2,560x1,440 gets 0.072 bpp where 4K gets 0.032 — the trade the
        // ladder used to make mid-stream, made before the first frame
        let mut c = AdaptiveController::new(16_000, 10, 3840, 2160, 60);
        c.set_geometry((3840, 2160), Some((3840, 2160)));
        assert_eq!(c.initial_encode_size(), Some((2560, 1440)));
        assert!(bits_per_pixel_milli(2560, 1440, 60, 16_000) >= 72);
        assert!(bits_per_pixel_milli(3840, 2160, 60, 16_000) < 72);

        // 10Mbps: 1080p, instead of 4K at 0.032 bpp
        let mut c = AdaptiveController::new(10_000, 10, 3840, 2160, 60);
        c.set_geometry((3840, 2160), Some((3840, 2160)));
        assert_eq!(c.initial_encode_size(), Some((1920, 1088)));

        // a session that negotiated less than the 6Mbps floor starts at the
        // 6Mbps floor's rung — the ceiling is max(negotiated, FLOOR_KBPS) —
        // which is still 0.087 bpp on 1,536x864, never a degenerate size
        let mut c = AdaptiveController::new(1_000, 10, 3840, 2160, 60);
        c.set_geometry((3840, 2160), Some((3840, 2160)));
        assert_eq!(c.current_kbps(), FLOOR_KBPS);
        assert_eq!(c.initial_encode_size(), Some((1536, 864)));
    }

    /// The reported session: a 16:9 client (3840x2160) on a 3440x1440
    /// (21:9) desktop, whose maximum is the desktop's columns at the
    /// CLIENT's aspect — 3440x1936. The resolution keeps that width cap
    /// (the desktop is never upscaled, it is letterboxed at 1:1 with thin
    /// bars) and the client's aspect (the old component-wise min encoded the
    /// desktop's 21:9, which the client stretched into its 16:9 surface).
    /// 3440x1936 is the size the measured session played at; the rungs it
    /// ground down to on its own are unreachable now — they are
    /// macroblock-aligned, and this size is the one it starts at.
    #[test]
    fn initial_encode_size_keeps_the_desktops_width_cap_and_the_negotiated_aspect() {
        let mut c = AdaptiveController::new(64_000, 10, 3840, 2160, 60);
        c.set_geometry((3840, 2160), Some((3440, 1440)));
        assert_eq!(c.max_size(), (3440, 1936));
        assert_eq!(c.initial_encode_size(), Some((3440, 1936)));

        // a link that cannot pay for 3440x1936 (28,770kbps at the shipped
        // 0.072 bpp) starts several rungs down — 2,288x1,280 needs
        // 12,651kbps, 1,712x960 needs 7,100kbps — rather than stepping into
        // it mid-stream
        let mut c = AdaptiveController::new(10_000, 10, 3840, 2160, 60);
        c.set_geometry((3840, 2160), Some((3440, 1440)));
        assert_eq!(c.initial_encode_size(), Some((1712, 960)));
    }

    /// The resolution is a function of the geometry the pipeline reported
    /// and the bitrate the session starts at, so every size a session can
    /// begin at is either the client's own 1/1 size (width-capped, even
    /// parity — see `base_size`) or a macroblock-aligned rung of it, and
    /// affordable at the bits-per-pixel floor — "works on any config": a low
    /// negotiated bitrate starts a small size instead of stepping into one.
    #[test]
    fn initial_encode_size_scales_with_the_bitrate_the_session_starts_at() {
        for kbps in [600_000, 60_000, 40_000, 24_883, 16_000, 10_000, 6_000, 1_000] {
            for (negotiated, source) in [
                ((3840, 2160), (3840, 2160)),
                ((3840, 2160), (3440, 1440)),
                ((2560, 1440), (2560, 1440)),
                ((1920, 1080), (1920, 1080)),
                ((0, 0), (3440, 1440)),
            ] {
                let mut c = AdaptiveController::new(kbps, 10, negotiated.0, negotiated.1, 60);
                c.set_geometry(negotiated, Some(source));
                let (w, h) = c.initial_encode_size().expect("a geometry was reported");
                // the macroblock grid is the DERIVED rungs' business: the 1/1
                // base is the size the client asked for, and 1,080 rows of it
                // are not on the grid
                let base = c.max_size();
                if (w, h) != base {
                    assert_eq!((w % MACROBLOCK, h % MACROBLOCK), (0, 0), "{w}x{h} at {kbps}kbps");
                }
                assert!(w >= 16 && h >= 16, "{w}x{h} at {kbps}kbps");
                assert!(w <= base.0, "{w}x{h} wider than the maximum at {kbps}kbps");
                // affordable: the rule only picks a size the session's own
                // starting bitrate pays for, at the bits-per-pixel floor (or
                // the smallest rung when nothing does)
                let smallest =
                    size_ladder(base.0, base.1, c.frame_aspect())[SIZE_LADDER.len() - 1];
                assert!(
                    c.current_kbps()
                        >= bpp_floor_kbps(w, h, 60, crate::config::MIN_BITS_PER_PIXEL_MILLI_DEFAULT)
                        || (w, h) == smallest,
                    "{w}x{h} at {kbps}kbps is below the bpp floor"
                );
            }
        }
    }

    /// A client that negotiated `0x0` carries no geometry at all until the
    /// pipeline reports the desktop it resolved to — and until then there is
    /// nothing to resolve a size from. (The desktop alone IS enough for such
    /// a client: that frame is the desktop.)
    #[test]
    fn initial_encode_size_is_none_until_the_pipeline_reports_the_geometry() {
        let mut c = AdaptiveController::new(64_000, 10, 0, 0, 60);
        assert_eq!(c.initial_encode_size(), None);
        assert_eq!(c.max_size(), (0, 0));

        // the source alone resolves a 0x0 client: its frame is the desktop
        c.set_geometry((0, 0), Some((3440, 1440)));
        assert_eq!(c.initial_encode_size(), Some((3440, 1440)));

        c.set_geometry((3440, 1440), Some((3440, 1440)));
        assert_eq!(c.initial_encode_size(), Some((3440, 1440)));

        // and a negotiated-mode client needs no report at all: the launch
        // parameters already carry the geometry — and its 1,080 rows are the
        // client's own size, so nothing is aligned down (1,072 would be).
        let c = AdaptiveController::new(64_000, 10, 1920, 1080, 60);
        assert_eq!(c.initial_encode_size(), Some((1920, 1080)));
        // that resolved size IS the size the session is already encoding at,
        // which is what the video loop compares against before calling
        // `set_encode_size` — so a 1920x1080 session pays no startup
        // recreation at all (the 1,072 the alignment used to resolve to did)
        assert_eq!(c.initial_encode_size(), Some(c.encode_size()));
    }

    /// The video loop reports the geometry the pipeline really runs at: a
    /// client that negotiated `0x0` has no geometry in its launch parameters
    /// (the encoder resolves to the desktop), so the bits-per-pixel floor —
    /// and the size resolution above — only exist after that report. That
    /// missing term is what let the measured session's floor run at
    /// `negotiated/4` against 4K frames.
    #[test]
    fn geometry_refresh_learns_the_pipeline_size_and_the_bits_per_pixel_floor() {
        let mut c = AdaptiveController::new(64_000, 10, 0, 0, 60);
        assert_eq!(c.encode_size(), (0, 0));
        assert_eq!(c.floor_kbps(), 16_000); // negotiated/4: no pixels known yet

        // the pipeline reports the desktop it resolved to (a real 4K60
        // session): the 35,831kbps floor now applies
        c.set_geometry((3840, 2160), Some((3840, 2160)));
        assert_eq!(c.encode_size(), (3840, 2160));
        assert_eq!(c.floor_kbps(), 35_831);
        assert_eq!(c.initial_encode_size(), Some((3840, 2160)));

        // a 0x0 client on a 21:9 desktop is resolved at the DESKTOP's own
        // aspect (that frame IS the desktop), never upscaled
        let mut c = AdaptiveController::new(64_000, 10, 0, 0, 60);
        c.set_geometry((3440, 1440), Some((3440, 1440)));
        assert_eq!(c.max_size(), (3440, 1440));
        assert_eq!(c.initial_encode_size(), Some((3440, 1440)));

        // a client asking for MORE than the desktop gets the desktop's
        // columns at its own aspect, not the upscale
        let mut c = AdaptiveController::new(64_000, 10, 3840, 2160, 60);
        c.set_geometry((3840, 2160), Some((3440, 1440)));
        assert_eq!(c.max_size(), (3440, 1936));
    }

    /// The reported session, pinned: a 16:9 client
    /// (`x-nv-video[0].clientViewportWd=3840` / `Ht=2160`) on the 3440x1440
    /// (21:9) desktop. The old component-wise min capped the height at the
    /// desktop's too, so the encoder ran at the DESKTOP's 3440x1440 and the
    /// client stretched 21:9 into its 16:9 surface — the user's
    /// "the downscale to keep FPS loses proportion". The maximum takes the
    /// desktop's columns and the NEGOTIATED aspect: 3440*2160/3840 = 1935,
    /// which no encoder can carry (both dimensions of a 4:2:0 frame are
    /// even), so it goes up one row to 1936 — the desktop at 1:1 with
    /// 248-pixel bars, no upscale and no distortion.
    #[test]
    fn max_size_keeps_the_negotiated_aspect_when_the_desktop_is_narrower() {
        assert_eq!(aspect_height(3440, 3840, 2160), 1935);
        assert_eq!(macroblock_round(1935, 2160), 1936);
        let mut c = AdaptiveController::new(64_000, 10, 3840, 2160, 60);
        c.set_geometry((3840, 2160), Some((3440, 1440)));
        assert_eq!(c.max_size(), (3440, 1936));
        // ...and never the desktop's own shape (the 21:9 the client stretched)
        assert_ne!(c.max_size(), (3440, 1440));
        // the desktop still fits at 1:1 inside it, letterboxed
        assert!(c.max_size().0 <= 3440 && c.max_size().1 >= 1440);
    }

    /// The maximum's edge cases: a client with no negotiated mode (`0x0`)
    /// is the one case whose frame IS the desktop's shape, an unknown
    /// desktop cannot cap anything, an odd desktop width is rounded down (a
    /// column the desktop does not have must never be invented), and a
    /// maximum too small to hold a macroblock is the 16x16 floor.
    #[test]
    fn max_size_edge_cases_stay_encodable() {
        // the encoder resolves a 0x0 client to the desktop, so that frame's
        // aspect is the desktop's by definition
        let mut desktop = AdaptiveController::new(64_000, 10, 0, 0, 60);
        desktop.set_geometry((3440, 1440), Some((3440, 1440)));
        assert_eq!(desktop.max_size(), (3440, 1440));

        // no desktop reported yet: the negotiated size itself — the client's
        // own geometry, on the even grid only
        let unknown = AdaptiveController::new(64_000, 10, 3840, 2160, 60);
        assert_eq!(unknown.max_size(), (3840, 2160));

        // neither known: nothing to select from
        let nothing = AdaptiveController::new(64_000, 10, 0, 0, 60);
        assert_eq!(nothing.max_size(), (0, 0));

        // an odd desktop width is capped down to whole macroblocks, and the
        // height follows the client's 16:9 at that width (not 3440x1441)
        let mut odd = AdaptiveController::new(64_000, 10, 3840, 2160, 60);
        odd.set_geometry((3440, 1440), Some((3441, 1441)));
        assert_eq!(odd.max_size(), (3440, 1936));

        // two columns of desktop at a 16:9 negotiation: the derived height
        // is a single pixel, below anything a hardware decoder accepts — the
        // floor is one macroblock on both axes
        let mut narrow = AdaptiveController::new(64_000, 10, 3840, 2160, 60);
        narrow.set_geometry((2, 1440), Some((2, 1440)));
        assert_eq!(narrow.max_size(), (16, 16));
    }

    /// Every rung of the session's ladder carries the negotiated aspect —
    /// the frame's shape is what the client stretches into its surface, so
    /// no rung, and no bitrate's selection from them, may substitute the
    /// desktop's. Asserted within half a macroblock, which is the most the
    /// macroblock rounding can cost, and every rung is macroblock-aligned
    /// in both dimensions (what a hardware decoder requires — the alignment
    /// `select_encode_size` exists to guarantee for the derived rungs; this
    /// session's 1/1 size, 3440x1936, happens to be on the grid too, so the
    /// whole ladder here is aligned).
    #[test]
    fn every_ladder_rung_keeps_the_negotiated_aspect() {
        let sixteen_by_nine = |w: u32| (w as u64 * 2160 / 3840) as u32;
        // the reported session's maximum: the 3440-column desktop at the
        // client's 16:9
        for (w, h) in size_ladder(3440, 1936, (3840, 2160)) {
            assert_eq!(w % MACROBLOCK, 0, "{w}x{h} is off the macroblock grid");
            assert_eq!(h % MACROBLOCK, 0, "{w}x{h} is off the macroblock grid");
            assert!(
                h.abs_diff(sixteen_by_nine(w)) <= MACROBLOCK / 2,
                "{w}x{h} left the client's 16:9 ({} is its height)",
                sixteen_by_nine(w)
            );
        }
        // and no bitrate can select the desktop's 21:9 instead: the frame
        // stays the client's 16:9 from above the top of the ladder to below
        // its bottom rung
        for kbps in [1_000_000, 64_000, 24_883, 19_979, 19_978, 16_000, 10_000, 6_000, 0] {
            let (w, h) = select_encode_size(3440, 1936, (3840, 2160), kbps, 60, 72);
            assert_ne!((w, h), (3440, 1440), "the desktop's shape at {kbps}kbps");
            assert_eq!(
                (w % MACROBLOCK, h % MACROBLOCK),
                (0, 0),
                "{w}x{h} at {kbps}kbps is off the macroblock grid"
            );
            assert!(
                h.abs_diff(sixteen_by_nine(w)) <= MACROBLOCK / 2,
                "{w}x{h} at {kbps}kbps left the client's 16:9"
            );
        }
    }

    /// The reported session, which size it starts at: a 16:9 client on a
    /// 3440x1440 (21:9) desktop at the negotiated 64,000kbps. Every size the
    /// session can be resolved to — the resolution is the only place the
    /// size is decided now — carries the client's 16:9, and every size below
    /// the client's own 1/1 size (which is that size verbatim, even parity
    /// and off the macroblock grid — see `base_size`) is a whole number of
    /// macroblocks in both dimensions, so the desktop's 21:9 can never reach
    /// the wire. (This is the invariant the distorted picture broke, and the
    /// macroblock grid is the one the frozen iPad frame broke.)
    #[test]
    fn no_resolved_size_can_substitute_the_desktops_aspect() {
        let mut sizes = Vec::new();
        // a client that negotiated a mode carries the negotiation's aspect;
        // `0x0` is excluded because there the frame IS the desktop (the
        // encoder resolves to it), which is the one case the desktop's own
        // shape is correct
        for negotiated in [(3840, 2160), (2560, 1440), (1920, 1080), (1280, 720)] {
            for kbps in [60_000, 40_000, 24_883, 16_000, 10_000, 6_000] {
                let mut c = AdaptiveController::new(kbps, 10, negotiated.0, negotiated.1, 60);
                c.set_geometry(negotiated, Some((3440, 1440)));
                sizes.push((
                    c.initial_encode_size().expect("a geometry was reported"),
                    c.max_size(),
                ));
            }
        }
        assert!(!sizes.is_empty());
        let sixteen_by_nine = |w: u32| (w as u64 * 2160 / 3840) as u32;
        for ((w, h), base) in sizes {
            assert_ne!((w, h), (3440, 1440), "the desktop's 21:9 shape");
            // only the derived rungs carry the macroblock grid: the 1/1 base
            // is the client's size, and 1,080 rows are not on the grid
            if (w, h) != base {
                assert_eq!(
                    (w % MACROBLOCK, h % MACROBLOCK),
                    (0, 0),
                    "{w}x{h} is off the macroblock grid"
                );
            }
            assert!(
                h.abs_diff(sixteen_by_nine(w)) <= MACROBLOCK / 2,
                "{w}x{h} is not the client's 16:9"
            );
        }
    }
}
