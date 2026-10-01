//! Audio pipeline: the NVSP audio RTP packetizer, pipeline traits, a
//! synthetic PCM source for tests and for the HYDRA_STREAM_AUDIO_SOURCE=tone
//! diagnostic, and the UDP sender task.
//!
//! Wire format (verified against Sunshine `stream.cpp` audioBroadcastThread
//! and moonlight-common-c `AudioStream.c` / `RtpAudioQueue.c`):
//!
//! ```text
//! RTP header  12 bytes  0x80 (NO extension flag), 97, seq(BE),
//!                       timestamp(BE, milliseconds)
//! Opus frame  one Opus packet per RTP packet
//! ```
//!
//! Timestamps advance by the client's negotiated `x-nv-aqos.packetDuration`
//! per packet, and the Opus frame size comes from the same value
//! (`DEFAULT_PACKET_DURATION_MS` is the ANNOUNCE parser fallback). FEC:
//! Moonlight groups audio into blocks of 4 data shards; a block completes
//! as soon as all 4 data shards arrive, so sending data packets only
//! (no Reed-Solomon parity) plays fine — losses fall back to Opus PLC.
//! Blocks stay aligned because the sequence starts at 0. Payloads are
//! plaintext Opus unless the client's ANNOUNCE asked for encrypted audio
//! (`x-nv-general.featureFlags` bit 0x20), in which case each payload is
//! AES-128-CBC with PKCS#7 padding under the session's AV key — see
//! [`AudioCipher`].

use std::fs::File;
use std::io::{self, Write};
use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const AUDIO_PAYLOAD_TYPE: u8 = 97;
pub const DEFAULT_PACKET_DURATION_MS: u32 = 5;
pub const SAMPLE_RATE: usize = 48_000;
/// Moonlight's audio FEC block size: data shards per block (RtpAudioQueue.h).
pub const AUDIO_BLOCK_SHARDS: u16 = 4;

/// One Opus multistream layout: Sunshine's `opus_stream_config_t`
/// (`src/audio.cpp:51-100`) at the Opus-mandated 48 kHz. The client builds
/// its decoder from the DESCRIBE the host advertises, so the encoder must
/// use exactly the same channel count, stream split and mapping.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AudioLayout {
    pub channel_count: u8,
    pub streams: u8,
    pub coupled_streams: u8,
    /// `mapping[channel]` = the Opus stream index carrying that channel
    /// (left/right of coupled stream `s` are `2s`/`2s+1`, mono stream `m`
    /// is `m + coupled_streams`), i.e. Sunshine's
    /// `platf::speaker::map_*` tables (`src/platform/common.h:292-316`).
    /// Unrotated: the rotation Sunshine applies when building the advertised
    /// surround-params string (`src/rtsp.cpp:975-993`) exists only for the
    /// client's GFE compatibility and must NOT reach the encoder.
    pub mapping: [u8; 8],
    pub bitrate_bps: i32,
}

/// Indices into [`AUDIO_LAYOUTS`], matching Sunshine's `stream_config_e`
/// (`src/audio.h:18-26`): the high-quality tier of a layout is its
/// normal-quality index + 1.
pub const STEREO: usize = 0;
pub const SURROUND51: usize = 2;
pub const SURROUND71: usize = 4;

/// Sunshine's `stream_configs` (`src/audio.cpp:51-100`): stereo, 5.1 and
/// 7.1, each in a normal and a high-quality tier.
pub const AUDIO_LAYOUTS: [AudioLayout; 6] = [
    AudioLayout {
        channel_count: 2,
        streams: 1,
        coupled_streams: 1,
        mapping: [0, 1, 0, 0, 0, 0, 0, 0],
        bitrate_bps: 96_000,
    },
    AudioLayout {
        channel_count: 2,
        streams: 1,
        coupled_streams: 1,
        mapping: [0, 1, 0, 0, 0, 0, 0, 0],
        bitrate_bps: 512_000,
    },
    AudioLayout {
        channel_count: 6,
        streams: 4,
        coupled_streams: 2,
        mapping: [0, 1, 2, 3, 4, 5, 0, 0],
        bitrate_bps: 256_000,
    },
    AudioLayout {
        channel_count: 6,
        streams: 6,
        coupled_streams: 0,
        mapping: [0, 1, 2, 3, 4, 5, 0, 0],
        bitrate_bps: 1_536_000,
    },
    AudioLayout {
        channel_count: 8,
        streams: 5,
        coupled_streams: 3,
        mapping: [0, 1, 2, 3, 4, 5, 6, 7],
        bitrate_bps: 450_000,
    },
    AudioLayout {
        channel_count: 8,
        streams: 8,
        coupled_streams: 0,
        mapping: [0, 1, 2, 3, 4, 5, 6, 7],
        bitrate_bps: 2_048_000,
    },
];

/// The [`AUDIO_LAYOUTS`] row for a [`map_stream`] index.
pub fn layout_for(index: usize) -> &'static AudioLayout {
    &AUDIO_LAYOUTS[index]
}

/// Sunshine's `audio::map_stream` (`src/audio.cpp:297-307`): the layout row
/// for a channel count and quality tier. Any other channel count falls back
/// to normal stereo (Sunshine ignores the quality flag there too).
pub fn map_stream(channels: u32, quality: bool) -> usize {
    let shift = usize::from(quality);
    match channels {
        2 => STEREO + shift,
        6 => SURROUND51 + shift,
        8 => SURROUND71 + shift,
        _ => STEREO,
    }
}

/// Resolves the client's surround negotiation into the encoder layout.
/// `audio_quality` is the ANNOUNCE `x-nv-audio.surround.AudioQuality` flag
/// (Sunshine `src/rtsp.cpp:1152-1153`); when the client never sent one the
/// pre-surround host-audio rule stands in for it. An explicit
/// `x-nv-audio.surround.enable=0` pins the stream to stereo.
pub fn select_layout(
    requested_channels: u32,
    audio_quality: Option<bool>,
    surround_enabled: bool,
    host_audio: bool,
) -> &'static AudioLayout {
    let channels = if surround_enabled { requested_channels } else { 2 };
    layout_for(map_stream(channels, audio_quality.unwrap_or(host_audio)))
}

pub struct EncodedAudio {
    pub payload: Vec<u8>,
}

/// Level of the PCM handed to the Opus encoder: peak and mean absolute
/// (i16 scaled, so the numbers are integers) plus the all-zero frame
/// counters.
///
/// The packet rate cannot tell encoded silence from encoded sound: the
/// silence keeper renders zeros into the render buffer so the audio engine
/// keeps mixing, and the host then emits a rock-steady 200 packets/s either
/// way. These counters are what separates the two cases in the log — a
/// capture that hands the encoder nothing but zeros is the silent-capture
/// signature, and no amount of wire-format checking can see it.
///
/// Cheap by construction: one `abs`, one add and one compare per sample,
/// integer counters, no allocation and no lock. The reporting math runs
/// once per window, never per frame.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PcmLevels {
    /// Peak |sample| over the window (i16 scaled, 0..=32767).
    pub peak: u32,
    /// Sum of |sample| over the window (i16 scaled).
    pub abs_sum: u64,
    /// Samples in the window, all channels.
    pub samples: u64,
    /// Encoder frames in the window.
    pub frames: u64,
    /// Current run of consecutive all-zero frames; cumulative, so a run
    /// longer than one reporting window is still counted.
    pub zero_run: u64,
    /// All-zero frames since the pipeline started; cumulative.
    pub zero_frames: u64,
    /// Frames since the pipeline started; cumulative.
    pub total_frames: u64,
}

impl PcmLevels {
    /// Folds one frame of interleaved PCM — the exact slice handed to the
    /// encoder — into the counters.
    pub fn observe_frame(&mut self, pcm: &[f32]) {
        let mut frame_peak = 0f32;
        let mut frame_abs = 0f32;
        for sample in pcm {
            let magnitude = sample.abs();
            frame_abs += magnitude;
            if magnitude > frame_peak {
                frame_peak = magnitude;
            }
        }
        // i16 scale, so the stored levels are integers and the printed
        // numbers mean "of 32767"
        let scaled_peak = (frame_peak * 32768.0).min(32767.0) as u32;
        self.peak = self.peak.max(scaled_peak);
        if frame_abs.is_finite() {
            self.abs_sum += (frame_abs * 32768.0) as u64;
        }
        self.samples += pcm.len() as u64;
        self.frames += 1;
        self.total_frames += 1;
        if scaled_peak == 0 {
            self.zero_run += 1;
            self.zero_frames += 1;
        } else {
            self.zero_run = 0;
        }
    }

    /// Window counters since the previous take; the all-zero counters and
    /// the frame total are cumulative and survive the reset.
    pub fn take(&mut self) -> PcmLevels {
        let taken = *self;
        self.peak = 0;
        self.abs_sum = 0;
        self.samples = 0;
        self.frames = 0;
        taken
    }

    /// Folds one take into this accumulator: window peak and sums add, the
    /// cumulative counters follow the newer snapshot.
    pub fn fold(&mut self, taken: PcmLevels) {
        self.peak = self.peak.max(taken.peak);
        self.abs_sum += taken.abs_sum;
        self.samples += taken.samples;
        self.frames += taken.frames;
        self.zero_run = taken.zero_run;
        self.zero_frames = taken.zero_frames;
        self.total_frames = taken.total_frames;
    }

    /// Mean |sample| of the window (i16 scaled); 0 when the window is empty.
    pub fn mean_abs(&self) -> u32 {
        (self.abs_sum / self.samples.max(1)) as u32
    }

    /// True when every frame the pipeline ever produced was digital silence
    /// — the silent-capture signature.
    pub fn all_zero_since_start(&self) -> bool {
        self.total_frames > 0 && self.zero_frames == self.total_frames
    }

    fn level_summary(&self) -> String {
        format!(
            "peak={:.1}dBFS mean={:.1}dBFS",
            dbfs(self.peak),
            dbfs(self.mean_abs())
        )
    }

    /// The per-second ramp report suffix: window peak/mean and the current
    /// all-zero run.
    pub fn window_summary(&self) -> String {
        format!("pcm {} zero-run={}", self.level_summary(), self.zero_run)
    }

    /// The steady-state report suffix: the worst case of the interval that
    /// just elapsed — its peak, its mean and the zero-frame ratio over the
    /// frames it covered — beside the session peak since the stream started,
    /// which no window boundary ever resets. `previous` is the session
    /// accumulator *before* this interval is folded in: its cumulative
    /// counters give the interval's zero-frame deltas, and its peak is the
    /// session peak the interval may have raised.
    pub fn interval_summary(&self, previous: PcmLevels) -> String {
        format!(
            "pcm peak={:.1}dBFS mean={:.1}dBFS zero-run={} zero-frames={}/{} session-peak={:.1}dBFS",
            dbfs(self.peak),
            dbfs(self.mean_abs()),
            self.zero_run,
            self.zero_frames.saturating_sub(previous.zero_frames),
            self.total_frames.saturating_sub(previous.total_frames),
            dbfs(previous.peak.max(self.peak))
        )
    }

    /// The session-end suffix: session peak/mean, the all-zero frames over
    /// the whole session and the run it ended on.
    pub fn session_summary(&self) -> String {
        format!(
            "pcm session {} zero-frames={}/{} zero-run={}",
            self.level_summary(),
            self.zero_frames,
            self.total_frames,
            self.zero_run
        )
    }
}

/// An i16-scaled magnitude as dBFS, floored at -120 so digital silence does
/// not print as -inf. Once per report, never per frame.
fn dbfs(magnitude: u32) -> f64 {
    const SCALE: f64 = 32768.0;
    if magnitude == 0 {
        return -120.0;
    }
    20.0 * (magnitude as f64 / SCALE).log10()
}

/// Census of the capture reads behind a reporting window: how many buffers
/// `IAudioCaptureClient::GetBuffer` handed over with each `dwFlags` value, and
/// how many audio frames they carried.
///
/// `dwFlags` is the only place the engine ever says *why* a capture is
/// silent: `AUDCLNT_BUFFERFLAGS_SILENT` means it had nothing to render for us
/// (the endpoint was quiet, or the stream the engine fed us is not the one
/// the audio is on), while unflagged zero bytes mean the silence is ours — a
/// wrong pointer, a wrong length, or a descriptor the engine quietly ignored.
/// The PCM levels cannot tell those apart; this census is read beside them in
/// the same line, once per window, and is cumulative like they are.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct BufferFlags {
    /// Buffers per flags value; values at or above 16 land in `high`. The
    /// bits are the `AUDCLNT_BUFFERFLAGS` ones (0x1 data discontinuity,
    /// 0x2 silent, 0x4 timestamp error, 0x8 data error), so the observed
    /// values stay far inside this table.
    counts: [u64; 16],
    high: u64,
    /// Audio frames (not bytes) the buffers carried.
    frames: u64,
}

impl BufferFlags {
    /// Folds one `GetBuffer` result — its `dwFlags` and its frame count.
    pub fn observe(&mut self, flags: u32, frames: u32) {
        match usize::try_from(flags) {
            Ok(value) if value < self.counts.len() => self.counts[value] += 1,
            _ => self.high += 1,
        }
        self.frames += frames as u64;
    }

    /// The window's census, reset for the next window (the caller folds it
    /// into a session accumulator, exactly like [`PcmLevels::take`]).
    pub fn take(&mut self) -> BufferFlags {
        std::mem::take(self)
    }

    /// Folds one taken window into this accumulator: counts and frames add.
    pub fn fold(&mut self, taken: BufferFlags) {
        for (count, taken) in self.counts.iter_mut().zip(taken.counts.iter()) {
            *count += taken;
        }
        self.high += taken.high;
        self.frames += taken.frames;
    }

    /// Buffers in the window.
    pub fn buffers(&self) -> u64 {
        self.counts.iter().sum::<u64>() + self.high
    }

    /// Buffers the engine flagged `AUDCLNT_BUFFERFLAGS_SILENT` (0x2), alone or
    /// with other bits.
    pub fn silent(&self) -> u64 {
        self.with_bit(0x2)
    }

    /// Buffers the engine flagged `AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY`
    /// (0x1): a gap in the stream, which is what a capture that was never
    /// really running produces.
    pub fn discontinuous(&self) -> u64 {
        self.with_bit(0x1)
    }

    fn with_bit(&self, bit: u32) -> u64 {
        self.counts
            .iter()
            .enumerate()
            .filter(|(value, _)| *value as u32 & bit != 0)
            .map(|(_, count)| *count)
            .sum()
    }

    /// The window/session report suffix: the flags histogram beside what it
    /// means for the silence, e.g. `buffers=363 frames=17424 flags{0x0:341,
    /// 0x2:22} silent=22`. An empty window prints `buffers=0 flags{-}`, so
    /// "the capture handed over nothing at all" is visible too.
    pub fn summary(&self) -> String {
        let mut histogram = String::new();
        for (value, count) in self.counts.iter().enumerate() {
            if *count > 0 {
                if !histogram.is_empty() {
                    histogram.push_str(", ");
                }
                histogram.push_str(&format!("{value:#x}:{count}"));
            }
        }
        if self.high > 0 {
            if !histogram.is_empty() {
                histogram.push_str(", ");
            }
            histogram.push_str(&format!("high:{count}", count = self.high));
        }
        format!(
            "buffers={} frames={} flags{{{}}} silent={}",
            self.buffers(),
            self.frames,
            if histogram.is_empty() { "-" } else { &histogram },
            self.silent()
        )
    }
}

/// A source of encoded Opus audio frames. Implemented by the WASAPI
/// pipeline in production and by a synthetic sine generator in tests.
pub trait AudioPipeline: Send {
    /// Encodes the next `frame_size`-sample frame. `Ok(None)` means no
    /// frame is available yet.
    fn encode_next(&mut self) -> Result<Option<EncodedAudio>, String>;

    /// Level telemetry of the PCM handed to the encoder since the previous
    /// call. Required rather than defaulted: a source that reports nothing
    /// would make the log lie about the capture.
    fn take_levels(&mut self) -> PcmLevels;

    /// Buffer-flag census of the capture reads since the previous call.
    /// Required for the same reason as [`AudioPipeline::take_levels`]: the
    /// synthesis of a reading has to be the source's own answer, not a
    /// default that reports silence as unexplained. A source that reads no
    /// WASAPI buffers (the synthetic tone) reports an empty census.
    fn take_buffer_flags(&mut self) -> BufferFlags;
}

/// Datagram filter for the audio sender: the destination must belong to the
/// session's own client. `session_client` is the IP of the client the
/// session was negotiated with (the source of its RTSP connection,
/// `State::session_client_ip`).
///
/// Any port of that IP is accepted: a client that rebinds its audio socket
/// mid-session (WiFi roam, app restart) must keep streaming, which is what
/// the ping source port does. A datagram from any other address is ignored
/// and the destination is left alone — before this rule a second device's
/// pings re-targeted the stream away from the session's client (the logged
/// session flipped between two clients 64 times in 60s, so half the audio
/// went to a device that was not even decoding it). Same shape as the ENet
/// server's peer migration rule (`enet.rs`: a differing host IP is
/// rejected, a new port on the same IP migrates).
///
/// `None` (no negotiated address — a session driven directly by tests)
/// keeps the legacy behaviour of learning from any source.
pub fn audio_source_allowed(session_client: Option<IpAddr>, source: SocketAddr) -> bool {
    match session_client {
        Some(client) => source.ip() == client,
        None => true,
    }
}

/// The audio payload cipher of a session: the AV/RI key from `/launch`
/// (`rikey` — the same 16 bytes the control channel decrypts input with)
/// together with the `rikeyid` the client folds into every packet's IV.
///
/// Wire contract, from the client's own decrypt path
/// (`moonlight-common-c/src/AudioStream.c:178-205`):
///
/// ```c
/// int dataLength = packet->header.size - sizeof(*rtp);
/// uint32_t ivSeq = BE32(avRiKeyId + rtp->sequenceNumber);
/// memcpy(iv, &ivSeq, sizeof(ivSeq));                  // first 4 bytes, rest zero
/// PltDecryptMessage(audioDecryptionCtx, ALGORITHM_AES_CBC,
///                   CIPHER_FLAG_RESET_IV | CIPHER_FLAG_FINISH,
///                   StreamConfig.remoteInputAesKey, 16, iv, 16, NULL, 0,
///                   (unsigned char*)(rtp + 1), dataLength, decryptedOpusData, &dataLength)
/// ```
///
/// i.e. each RTP payload is `EVP_aes_128_cbc` of the PKCS#7-padded Opus
/// frame, and `avRiKeyId` itself is `BE32(remoteInputAesIv[0..4])`
/// (`AudioStream.c:81-82`), the value the client sent as `rikeyid` in
/// `/launch`. Sunshine builds the same IV and cipher
/// (`stream.cpp:1885-1889`, `stream.cpp:2366-2369` with `encode_audio` at
/// `stream.cpp:352-360`).
#[derive(Clone, Copy)]
pub struct AudioCipher {
    key: [u8; 16],
    key_id: u32,
}

impl AudioCipher {
    pub fn new(key: [u8; 16], key_id: u32) -> Self {
        AudioCipher { key, key_id }
    }

    /// The IV of the packet with sequence number `sequence`: the sum wraps
    /// in 32 bits, as the client's does (its `avRiKeyId` and
    /// `sequenceNumber` are `uint32_t`, `AudioStream.c:188`).
    pub fn iv(&self, sequence: u16) -> [u8; 16] {
        let mut iv = [0u8; 16];
        iv[..4].copy_from_slice(&self.key_id.wrapping_add(sequence as u32).to_be_bytes());
        iv
    }

    /// The RTP payload for `sequence`: the PKCS#7-padded Opus frame,
    /// AES-128-CBC encrypted. Longer than the frame — up to a block of
    /// padding plus, for an already block-aligned frame, a whole extra one.
    pub fn encrypt(&self, sequence: u16, opus_payload: &[u8]) -> Vec<u8> {
        crate::crypto::aes128_cbc_encrypt(&self.key, &self.iv(sequence), opus_payload)
    }
}

/// Packs Opus payloads into NVSP audio RTP packets. Pure: no sockets.
pub struct AudioPacketizer {
    packet_duration: u32,
    next_sequence: u16,
    timestamp: u32,
    cipher: Option<AudioCipher>,
}

impl AudioPacketizer {
    pub fn new(packet_duration_ms: u32) -> Self {
        AudioPacketizer {
            packet_duration: packet_duration_ms.max(1),
            next_sequence: 0,
            timestamp: 0,
            cipher: None,
        }
    }

    /// Encrypts every payload with the session's AV key ([`AudioCipher`])
    /// when the client asked for audio encryption. The header is written
    /// from the sequence the payload is encrypted under, so sequence,
    /// timestamp and payload type are the same as in the plaintext case —
    /// only the payload bytes differ.
    pub fn with_cipher(mut self, cipher: Option<AudioCipher>) -> Self {
        self.cipher = cipher;
        self
    }

    pub fn packetize(&mut self, opus_payload: &[u8]) -> Vec<u8> {
        let mut packet = Vec::with_capacity(12 + opus_payload.len());
        packet.push(0x80);
        packet.push(AUDIO_PAYLOAD_TYPE);
        packet.extend_from_slice(&self.next_sequence.to_be_bytes());
        packet.extend_from_slice(&self.timestamp.to_be_bytes());
        packet.extend_from_slice(&0u32.to_be_bytes()); // ssrc
        match &self.cipher {
            Some(cipher) => {
                packet.extend_from_slice(&cipher.encrypt(self.next_sequence, opus_payload))
            }
            None => packet.extend_from_slice(opus_payload),
        }

        self.next_sequence = self.next_sequence.wrapping_add(1);
        self.timestamp = self.timestamp.wrapping_add(self.packet_duration);
        packet
    }

    pub fn sequence(&self) -> u16 {
        self.next_sequence
    }
}

/// Reporting cadence over a session: one line per second for the first ten
/// seconds (a cold audio engine's ramp is only readable at that resolution),
/// then one line every `AUDIO_STEADY_REPORT_SECS` for the rest of the stream.
/// The steady line covers the whole interval since the previous one, so a
/// 30-minute session leaves ~370 readable lines instead of 1800 and still
/// reports the worst case it saw.
const AUDIO_RAMP_REPORT_SECS: u64 = 10;
const AUDIO_STEADY_REPORT_SECS: u64 = 5;
/// Cadence of the ramp above: one line per second, then the steady one.
const AUDIO_RAMP_TICK_SECS: u64 = 1;

/// Reporting cadence for the interval that starts `since_epoch` into the
/// session: the per-second ramp, then the steady interval. Pure, so the
/// schedule is testable without a stream.
fn report_cadence(since_epoch: Duration) -> Duration {
    if since_epoch < Duration::from_secs(AUDIO_RAMP_REPORT_SECS) {
        Duration::from_secs(AUDIO_RAMP_TICK_SECS)
    } else {
        Duration::from_secs(AUDIO_STEADY_REPORT_SECS)
    }
}

pub const AUDIO_DUMP_MAGIC: [u8; 4] = *b"HYDA";
pub const AUDIO_DUMP_VERSION: u8 = 1;
pub const AUDIO_DUMP_HEADER_LEN: usize = 16;

/// Fixed 16-byte record header for [`AudioDump`]: what makes a dump file
/// parsable offline without knowing anything about the session.
///
/// ```text
/// offset size field
/// 0      4    magic          b"HYDA"
/// 4      1    version        AUDIO_DUMP_VERSION (1)
/// 5      1    payload type   AUDIO_PAYLOAD_TYPE (97)
/// 6      2    sequence       RTP sequence number (BE)
/// 8      4    RTP timestamp  milliseconds (BE)
/// 12     4    payload length payload bytes that follow (BE)
/// 16     N    payload        the RTP payload as sent: the Opus packet,
///                            or its AES-128-CBC ciphertext when the
///                            session's client asked for encrypted audio
/// ```
///
/// [`AudioPacketizer`] always sends ssrc 0 and no extension, so a record
/// reconstructs the exact 12-byte RTP header the client received:
/// `0x80, payload-type, sequence(BE), timestamp(BE), 0,0,0,0` followed by
/// the payload. Records are concatenated with no padding or delimiter:
/// parse one with [`parse_audio_dump_record`] and continue at the returned
/// offset.
pub fn audio_dump_header(
    sequence: u16,
    timestamp: u32,
    payload_len: u32,
) -> [u8; AUDIO_DUMP_HEADER_LEN] {
    let mut header = [0u8; AUDIO_DUMP_HEADER_LEN];
    header[0..4].copy_from_slice(&AUDIO_DUMP_MAGIC);
    header[4] = AUDIO_DUMP_VERSION;
    header[5] = AUDIO_PAYLOAD_TYPE;
    header[6..8].copy_from_slice(&sequence.to_be_bytes());
    header[8..12].copy_from_slice(&timestamp.to_be_bytes());
    header[12..16].copy_from_slice(&payload_len.to_be_bytes());
    header
}

/// One parsed [`AudioDump`] record: the fields [`audio_dump_header`]
/// encodes, with a borrow of the payload that follows it.
#[derive(Debug, PartialEq, Eq)]
pub struct AudioDumpRecord<'a> {
    pub sequence: u16,
    pub timestamp: u32,
    pub payload: &'a [u8],
}

/// Reference parser for the [`AudioDump`] format: decodes the record at the
/// front of `bytes` and returns it with the number of bytes consumed, or
/// `None` when the buffer is shorter than one record or the magic, version
/// or payload type do not match. The offline tooling and the round-trip
/// test read the dump through this one function.
pub fn parse_audio_dump_record(bytes: &[u8]) -> Option<(AudioDumpRecord<'_>, usize)> {
    if bytes.len() < AUDIO_DUMP_HEADER_LEN || bytes[0..4] != AUDIO_DUMP_MAGIC {
        return None;
    }
    if bytes[4] != AUDIO_DUMP_VERSION || bytes[5] != AUDIO_PAYLOAD_TYPE {
        return None;
    }
    let sequence = u16::from_be_bytes(bytes[6..8].try_into().ok()?);
    let timestamp = u32::from_be_bytes(bytes[8..12].try_into().ok()?);
    let payload_len = u32::from_be_bytes(bytes[12..16].try_into().ok()?) as usize;
    let end = AUDIO_DUMP_HEADER_LEN.checked_add(payload_len)?;
    if bytes.len() < end {
        return None;
    }
    Some((
        AudioDumpRecord {
            sequence,
            timestamp,
            payload: &bytes[AUDIO_DUMP_HEADER_LEN..end],
        },
        end,
    ))
}

/// Diagnostic dump of the NVSP audio packets the sender loop actually
/// puts on the wire, enabled by `HYDRA_STREAM_AUDIO_DUMP`
/// (`config::AUDIO_DUMP_ENV`). Mirrors [`crate::video::VideoDump`]: opened
/// once per session (truncating), completely inert when unset, and one
/// record per packet at the one point in the loop where the packet is
/// committed to the client — after the peer is known, immediately after
/// the socket accepts the datagram — so the file holds exactly the
/// sequence the client's `RtpAudioQueue` saw, in order. A send the
/// nonblocking socket dropped (WouldBlock) never reached the client and
/// so is never recorded; the sequence gap it leaves is the client's too.
///
/// Cost while enabled: two `write_all`s per packet (the 16-byte header
/// from [`audio_dump_header`] then the borrowed payload), no allocation,
/// no buffer and no flush; the handle is closed when the session ends. The
/// payload is whatever left the socket — plaintext Opus, or AES-CBC
/// ciphertext when the client asked for encrypted audio, which the
/// announcing line states.
struct AudioDump {
    file: Option<File>,
    window_packets: u64,
    window_bytes: u64,
    packets: u64,
    bytes: u64,
    /// one-shot: the first sent packet has been announced
    announced: bool,
}

impl AudioDump {
    /// Opens the target once per session (truncating) when the env var is
    /// set, and logs the single line that announces the dump — including
    /// whether its payloads are ciphertext, since a dump of an encrypted
    /// session is not decodable as Opus without the session key. A path
    /// that cannot be opened disables the dump instead of failing the
    /// session.
    fn open(encrypted_payloads: bool) -> Self {
        let mut dump = AudioDump {
            file: None,
            window_packets: 0,
            window_bytes: 0,
            packets: 0,
            bytes: 0,
            announced: false,
        };
        let Some(path) = crate::config::audio_dump_path() else {
            return dump;
        };
        match File::create(path) {
            Ok(file) => {
                dump.file = Some(file);
                eprintln!(
                    "audio: {}={path} (16-byte record per sent packet: seq, timestamp, payload — {})",
                    crate::config::AUDIO_DUMP_ENV,
                    if encrypted_payloads {
                        "AES-128-CBC ciphertext of the Opus frame"
                    } else {
                        "the plaintext Opus frame"
                    }
                );
            }
            Err(error) => eprintln!(
                "audio: {}={path} could not be opened ({error}); dump disabled",
                crate::config::AUDIO_DUMP_ENV
            ),
        }
        dump
    }

    /// Appends the record for one RTP packet the socket just accepted for
    /// the client. A disk error disables the dump rather than logging at
    /// 200Hz; a write that stops between header and payload leaves a
    /// record the parser reads as truncated, which is why it is disabled
    /// immediately.
    fn write(&mut self, rtp_packet: &[u8]) {
        let Some(file) = self.file.as_mut() else {
            return;
        };
        // the 12-byte RTP header the packetizer builds (see the module
        // docs): seq and timestamp are read back out of it rather than
        // duplicated, so the record always matches the bytes sent
        if rtp_packet.len() < 12 {
            return;
        }
        let sequence = u16::from_be_bytes(rtp_packet[2..4].try_into().expect("seq slice"));
        let timestamp = u32::from_be_bytes(rtp_packet[4..8].try_into().expect("timestamp slice"));
        let payload = &rtp_packet[12..];
        let header = audio_dump_header(sequence, timestamp, payload.len() as u32);
        if let Err(error) = file.write_all(&header).and_then(|()| file.write_all(payload)) {
            eprintln!(
                "audio: dump write failed ({error}) after {} packets/{} bytes; dump disabled",
                self.packets, self.bytes
            );
            self.file = None;
            return;
        }
        self.window_packets += 1;
        self.window_bytes += (AUDIO_DUMP_HEADER_LEN + payload.len()) as u64;
        self.packets += 1;
        self.bytes += (AUDIO_DUMP_HEADER_LEN + payload.len()) as u64;
        if !self.announced {
            self.announced = true;
            eprintln!(
                "audio: dump first packet (seq {sequence}, ts {timestamp}, {} payload bytes)",
                payload.len()
            );
        }
    }

    /// Per-window progress, on its own line beside the sender report, so a
    /// dump file can be correlated with the stream's state.
    fn report_window(&mut self) {
        if self.file.is_none() {
            return;
        }
        eprintln!(
            "audio: dump +{} packets/+{} bytes this window (session {} packets, {} bytes)",
            self.window_packets, self.window_bytes, self.packets, self.bytes
        );
        self.window_packets = 0;
        self.window_bytes = 0;
    }

    /// The session-end summary: the counts a dump file must account for.
    fn report_session(&self) {
        if self.file.is_none() {
            return;
        }
        eprintln!(
            "audio: dump session {} packets, {} bytes",
            self.packets, self.bytes
        );
    }
}

/// Blocking sender loop; runs on its own thread like the video loop.
/// The client endpoint is learned from the ping datagrams Moonlight
/// sends to the audio port; packets are dropped until then. Only datagrams
/// from the session's own client are accepted (`session_client`, the IP the
/// RTSP handshake came from) — any port of that IP may become the
/// destination, nothing else may. QoS marking (qWAVE Voice / DSCP EF) is
/// applied to the accepted endpoint and re-marked when it moves, per the
/// client's `x-nv-aqos.qosTrafficType` ANNOUNCE attribute.
///
/// `cipher` is the session's audio payload cipher, `Some` only when the
/// client's ANNOUNCE asked for encrypted audio; `None` sends plaintext
/// Opus exactly as before the option existed.
pub fn run_audio_loop(
    socket: UdpSocket,
    shared: Arc<crate::video::StreamShared>,
    mut pipeline: Box<dyn AudioPipeline>,
    packet_duration_ms: u32,
    audio_qos_type: Option<i32>,
    session_client: Option<IpAddr>,
    cipher: Option<AudioCipher>,
) -> Result<(), String> {
    socket
        .set_nonblocking(true)
        .map_err(|error| format!("audio socket: {error}"))?;

    // The payload encryption decision, once per pipeline start: a session
    // log must say whether what follows is ciphertext, and why.
    match &cipher {
        Some(_) => eprintln!(
            "audio: encrypting payloads (AES-128-CBC/PKCS#7, key = launch rikey, iv = BE(rikeyid+seq)): the client's x-nv-general.featureFlags asked for NVFF_AUDIO_ENCRYPTION (0x20)"
        ),
        None => eprintln!(
            "audio: payloads in the clear: the client's x-nv-general.featureFlags did not ask for NVFF_AUDIO_ENCRYPTION (0x20)"
        ),
    }

    // The timestamp step must follow the negotiated duration: the client
    // reconstructs FEC base timestamps as
    // `baseTimestamp + i * AudioPacketDuration`.
    let mut packetizer = AudioPacketizer::new(packet_duration_ms).with_cipher(cipher);
    let mut buffer = [0u8; 512];
    let epoch = Instant::now();
    let mut packets_sent: u64 = 0;
    let mut sends = crate::video::SendGuard::new("audio");
    let mut last_report = Instant::now();
    let mut steady_reported = false;
    let mut first_send = true;
    let mut _audio_qos_flow: Option<crate::qos::QosFlow> = None;
    // PCM level telemetry: `window` is the interval since the previous report,
    // `session` the whole stream, both folded from the pipeline's takes.
    let mut window = PcmLevels::default();
    let mut session = PcmLevels::default();
    // Buffer-flag telemetry, folded and reported beside the levels: it is
    // what separates "the engine handed us silence" from "the silence is
    // ours" (see `BufferFlags`).
    let mut window_flags = BufferFlags::default();
    let mut session_flags = BufferFlags::default();
    // A second of frames at this packet duration is long enough that a cold
    // audio engine (the first frames of a stream) cannot be mistaken for a
    // capture that never delivers sound.
    let silent_capture_frames = (1000 / packet_duration_ms.max(1)) as u64;
    let mut silent_capture_reported = false;
    let mut ignored_source: Option<IpAddr> = None;
    // Diagnostic dump of what leaves for the client (HYDRA_STREAM_AUDIO_DUMP):
    // opened once here, inert when unset, and told what the payloads are so
    // its announcing line cannot be mistaken about plaintext vs ciphertext.
    let mut dump = AudioDump::open(cipher.is_some());
    loop {
        if shared.stop.load(Ordering::Relaxed) {
            window.fold(pipeline.take_levels());
            session.fold(window.take());
            window_flags.fold(pipeline.take_buffer_flags());
            session_flags.fold(window_flags.take());
            eprintln!(
                "audio: loop stopped (session ended; {}) | {} | {}",
                sends.summary(),
                session.session_summary(),
                session_flags.summary()
            );
            dump.report_session();
            return Ok(());
        }

        // Learn the client endpoint from its pings and drain the socket.
        // A new port on the session client's IP is a legitimate rebind and
        // moves the destination; a datagram from any other address is
        // counted and dropped without touching the destination, so a second
        // device on the network cannot take the stream over.
        let mut learned_peer: Option<SocketAddr> = None;
        loop {
            match socket.recv_from(&mut buffer) {
                Ok((_, source)) => {
                    if !audio_source_allowed(session_client, source) {
                        if ignored_source != Some(source.ip()) {
                            ignored_source = Some(source.ip());
                            eprintln!(
                                "audio: ignoring pings from {source} (session client is {})",
                                session_client.map_or("unknown".to_string(), |ip| ip.to_string())
                            );
                        }
                        continue;
                    }
                    let mut peer = shared.audio_peer.lock().expect("audio peer lock");
                    if peer.as_ref() != Some(&source) {
                        if peer.is_none() {
                            eprintln!("audio client at {source}");
                        } else {
                            eprintln!("audio: client endpoint moved {peer:?} -> {source}");
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
            _audio_qos_flow = None;
            _audio_qos_flow = match audio_qos_type {
                Some(0) => {
                    eprintln!("audio: client sent qosTrafficType=0, socket stays unmarked");
                    None
                }
                Some(_) => crate::qos::apply_socket_qos(
                    &socket,
                    source,
                    crate::qos::QosTraffic::Audio,
                    "x-nv-aqos.qosTrafficType",
                ),
                None => None,
            };
        }

        let Some(encoded) = pipeline.encode_next()? else {
            continue;
        };
        window.fold(pipeline.take_levels());
        window_flags.fold(pipeline.take_buffer_flags());
        if !silent_capture_reported
            && window.all_zero_since_start()
            && window.total_frames >= silent_capture_frames
        {
            silent_capture_reported = true;
            eprintln!(
                "audio: SILENT CAPTURE — {} all-zero frames (~{}ms) have reached the encoder since the stream started: the captured device is delivering digital silence (nothing playing, or loopback capture is not working)",
                window.total_frames,
                window.total_frames * packet_duration_ms.max(1) as u64
            );
        }
        let Some(peer) = *shared.audio_peer.lock().expect("audio peer lock") else {
            continue;
        };
        let packet = packetizer.packetize(&encoded.payload);
        let send = socket.send_to(&packet, peer);
        // only a datagram the socket accepted reached the client, so only
        // one is dumped; the sequence the file shows is the client's exactly
        if send.is_ok() {
            dump.write(&packet);
        }
        sends.record(&send);
        packets_sent += 1;
        if first_send && sends.sent > 0 {
            first_send = false;
            eprintln!("audio: first RTP packet sent to {peer}");
        }
        // Reporting runs for the whole session: one line per second through
        // the ramp, then one line every `AUDIO_STEADY_REPORT_SECS`. The
        // cadence of the interval that starts now follows the line that just
        // closed, so the ramp prints its full per-second run.
        let now = Instant::now();
        let elapsed = now.duration_since(last_report);
        let since_epoch = last_report.duration_since(epoch);
        if elapsed >= report_cadence(since_epoch) {
            let ramp = since_epoch < Duration::from_secs(AUDIO_RAMP_REPORT_SECS);
            let window_levels = window.take();
            // The ramp lines keep the shape they always had; the steady line
            // covers the whole interval and carries the session peak, which
            // no window boundary resets. Formatted before the fold: the
            // session read here is the state the interval started from.
            let levels = if ramp {
                window_levels.window_summary()
            } else {
                window_levels.interval_summary(session)
            };
            session.fold(window_levels);
            let window_census = window_flags.take();
            session_flags.fold(window_census);
            eprintln!(
                "audio: sent {packets_sent} packets in {}ms ({}) | {} | {}",
                elapsed.as_millis(),
                sends.summary(),
                levels,
                window_census.summary()
            );
            dump.report_window();
            packets_sent = 0;
            last_report = now;
            if !ramp && !steady_reported {
                steady_reported = true;
                eprintln!(
                    "audio: first-10s packet reporting done, now reporting every {AUDIO_STEADY_REPORT_SECS}s for the rest of the session"
                );
            }
        }
    }
}

/// Synthetic stereo sine source: encodes real Opus from a deterministic PCM
/// pattern, so tests exercise the encoder and the
/// HYDRA_STREAM_AUDIO_SOURCE=tone diagnostic can feed the sender loop with
/// unmistakable audio. It always encodes the stereo layout.
///
/// Unlike the WASAPI pipeline it has no capture buffer to block on, so it
/// reproduces the capture cadence itself: one frame per negotiated
/// `packet_duration_ms`, paced on wall-clock deadlines (see [`pace_step`]).
/// Before that pacing existed the loop was handed a frame on every call and
/// the source flooded the wire — measured at 21036 packets/s against a 200/s
/// negotiation (~100x, ~17Mbps of audio), which a client answers with
/// silence, so the tone test proved nothing.
pub struct SyntheticAudioPipeline {
    encoder: crate::audio_encode::OpusEncoder,
    frame_size: usize,
    /// the negotiated `x-nv-aqos.packetDuration`, as a pacing interval
    packet_duration: Duration,
    max_packets: u32,
    emitted: u32,
    phase: f32,
    levels: PcmLevels,
    /// due instant of the next frame; see [`pace_step`]
    deadline: Instant,
}

impl SyntheticAudioPipeline {
    /// `packet_duration_ms` is the same negotiated value the sender loop
    /// timestamps with, so the frame size and the pacing follow the client's
    /// cadence rather than a hardcoded 5ms.
    pub fn new(max_packets: u32, packet_duration_ms: u32) -> Result<Self, String> {
        let layout = layout_for(STEREO);
        let packet_duration_ms = packet_duration_ms.max(1);
        Ok(SyntheticAudioPipeline {
            encoder: crate::audio_encode::OpusEncoder::new(layout, layout.bitrate_bps)?,
            frame_size: SAMPLE_RATE * packet_duration_ms as usize / 1000,
            packet_duration: Duration::from_millis(packet_duration_ms as u64),
            max_packets,
            emitted: 0,
            phase: 0.0,
            levels: PcmLevels::default(),
            deadline: Instant::now(),
        })
    }
}

/// Pure pacing step for a frame due at `deadline`, observed at `now`: how
/// long to sleep before emitting it and the deadline for the frame after it.
/// A due time already in the past yields no sleep and restarts the schedule
/// from `now`, so a loop that fell behind resumes at one frame per interval
/// instead of bursting to catch up — the source can never flood the wire the
/// way the unpaced version did.
fn pace_step(deadline: Instant, now: Instant, interval: Duration) -> (Duration, Instant) {
    if now < deadline {
        (deadline - now, deadline + interval)
    } else {
        (Duration::ZERO, now + interval)
    }
}

impl AudioPipeline for SyntheticAudioPipeline {
    fn encode_next(&mut self) -> Result<Option<EncodedAudio>, String> {
        if self.emitted >= self.max_packets {
            return Ok(None);
        }
        // one frame per negotiated interval: sleep until this frame is due,
        // then schedule the next
        let (sleep, next_deadline) =
            pace_step(self.deadline, Instant::now(), self.packet_duration);
        if !sleep.is_zero() {
            std::thread::sleep(sleep);
        }
        self.deadline = next_deadline;
        // 440 Hz stereo sine, interleaved
        let mut pcm = vec![0f32; self.frame_size * 2];
        for index in 0..self.frame_size {
            let sample = (self.phase * 2.0 * std::f32::consts::PI * 440.0 / SAMPLE_RATE as f32)
                .sin()
                * 0.25;
            pcm[index * 2] = sample;
            pcm[index * 2 + 1] = sample;
            self.phase = (self.phase + 1.0) % SAMPLE_RATE as f32;
        }
        self.emitted += 1;
        // the tone is a real signal by construction: measuring it keeps the
        // reported levels honest when HYDRA_STREAM_AUDIO_SOURCE=tone is
        // proving the transport side of a silent session
        self.levels.observe_frame(&pcm);
        Ok(Some(EncodedAudio {
            payload: self.encoder.encode_float(&pcm, self.frame_size)?,
        }))
    }

    fn take_levels(&mut self) -> PcmLevels {
        self.levels.take()
    }

    /// The tone reads no WASAPI buffers, so there is no engine flag to
    /// report: an empty census, stated rather than defaulted.
    fn take_buffer_flags(&mut self) -> BufferFlags {
        BufferFlags::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(value: &str) -> Vec<u8> {
        crate::crypto::hex_decode(value).expect("hex")
    }

    fn openssl_key() -> [u8; 16] {
        hex("00112233445566778899aabbccddeeff")
            .try_into()
            .expect("16 bytes")
    }

    /// The IV is the whole contract with the client's decrypt path:
    /// `BE32(avRiKeyId + sequenceNumber)` in the first 4 bytes, zeros in the
    /// remaining 12 (`AudioStream.c:81-82,186-189`). The ciphertext asserted
    /// at the end was generated by OpenSSL for exactly that IV, so a wrong
    /// byte order here cannot pass.
    #[test]
    fn audio_iv_is_key_id_plus_sequence_big_endian() {
        let key = openssl_key();
        let cipher = AudioCipher::new(key, 0x12345678);
        assert_eq!(
            cipher.iv(7).to_vec(),
            hex("1234567f000000000000000000000000")
        );

        // the first packet of a session: the key id alone
        let first = AudioCipher::new(key, 1);
        assert_eq!(first.iv(0).to_vec(), hex("00000001000000000000000000000000"));

        // the client sums in uint32_t, so the id and sequence wrap together
        let wrapping = AudioCipher::new(key, 0xffff_ffff);
        assert_eq!(wrapping.iv(2), first.iv(0));
        let frame = hex("f8fffe");
        assert_eq!(
            wrapping.encrypt(2, &frame),
            hex("cf7052b4d1bd7bf71cfd4ddf1864e9b2")
        );
        assert_eq!(first.encrypt(0, &frame), wrapping.encrypt(2, &frame));
    }

    /// The key id is the two's complement of the SIGNED decimal the client
    /// sends (see `nvhttp::make_launch_params`), and this one is a real
    /// field value: `rikeyid=-1721505449` = 0x9963E957, negative in about
    /// half of all sessions. The IV, the sequence step and the ciphertext
    /// below are OpenSSL's for that id, so an unsigned parse (which read the
    /// field as unparsable and substituted 0, sealing the same frame under a
    /// different IV) cannot pass.
    #[test]
    fn audio_iv_from_a_negative_rikeyid_matches_openssl() {
        let key = openssl_key();
        let cipher = AudioCipher::new(key, (-1_721_505_449i32) as u32);
        assert_eq!(cipher.iv(0).to_vec(), hex("9963e957000000000000000000000000"));
        assert_eq!(cipher.iv(7).to_vec(), hex("9963e95e000000000000000000000000"));
        let frame = hex("5d0102030405060708090a0b0c0d0e0f1011121314");
        let sealed = cipher.encrypt(0, &frame);
        assert_eq!(
            sealed,
            hex("d27dbbcb3ca206e50ead32493879bb803f6c0fd998d5ee93c48f2f7db556cd6f")
        );
        assert_eq!(
            crate::crypto::client_audio_decrypt(&key, &cipher.iv(0), &sealed)
                .expect("the client decrypts"),
            frame
        );

        // what 0 would have sent instead: a different IV off the same key,
        // and a payload the client's decrypt turns into noise
        let buggy = AudioCipher::new(key, 0);
        assert_ne!(buggy.iv(0), cipher.iv(0));
        assert_ne!(buggy.encrypt(0, &frame), sealed);
        assert_ne!(
            crate::crypto::client_audio_decrypt(&key, &buggy.iv(0), &sealed)
                .expect("still unpads"),
            frame
        );

        // the id + sequence sum wraps in u32 space, as the client's does:
        // 0xFFFFFFF0 (the two's complement of -16) + 17 = 0x00000001
        let wrapping = AudioCipher::new(key, (-16i32) as u32);
        assert_eq!(
            wrapping.iv(17).to_vec(),
            hex("00000001000000000000000000000000")
        );
    }

    /// Encryption must touch payload bytes only. The header — payload type
    /// 97, sequence, timestamp, ssrc — is byte-identical to the plaintext
    /// packetizer's, and what the client receives decrypts with the sequence
    /// it reads out of that same header (its own rule).
    #[test]
    fn encrypted_packet_keeps_the_rtp_header_and_decrypts_with_its_own_sequence() {
        let key = openssl_key();
        let cipher = AudioCipher::new(key, 0x12345678);
        // a 21-byte Opus frame: PKCS#7 adds 11 bytes
        let frame = hex("5d0102030405060708090a0b0c0d0e0f1011121314");
        let mut clear = AudioPacketizer::new(5);
        let mut sealed = AudioPacketizer::new(5).with_cipher(Some(cipher));

        for index in 0..4u16 {
            let plaintext = clear.packetize(&frame);
            let ciphertext = sealed.packetize(&frame);
            assert_eq!(
                ciphertext[..12],
                plaintext[..12],
                "payload type, sequence, timestamp and ssrc are unchanged"
            );
            assert_eq!(&plaintext[12..], &frame[..], "no cipher, no change");
            assert_eq!(ciphertext.len(), 12 + 32);
            assert_ne!(&ciphertext[12..], &frame[..]);
            let sequence = u16::from_be_bytes(ciphertext[2..4].try_into().unwrap());
            assert_eq!(sequence, index);
            assert_eq!(
                crate::crypto::client_audio_decrypt(&key, &cipher.iv(sequence), &ciphertext[12..])
                    .expect("the client's decrypt"),
                frame
            );
        }

        // an aligned frame gains a whole block (16 -> 32), so the client's
        // unpad never eats the frame's own last byte
        let aligned = hex("5d0f0e0d0c0b0a090807060504030201");
        let ciphertext = AudioPacketizer::new(5)
            .with_cipher(Some(cipher))
            .packetize(&aligned);
        assert_eq!(ciphertext.len(), 12 + 32);
        assert_eq!(
            crate::crypto::client_audio_decrypt(&key, &cipher.iv(0), &ciphertext[12..])
                .expect("the client's decrypt"),
            aligned
        );
    }

    #[test]
    fn packetizer_matches_nvsp_audio_format() {
        let mut packetizer = AudioPacketizer::new(5);
        let first = packetizer.packetize(&[0xDE, 0xAD]);
        assert_eq!(first.len(), 12 + 2);
        assert_eq!(first[0], 0x80);
        assert_eq!(first[1], AUDIO_PAYLOAD_TYPE);
        assert_eq!(u16::from_be_bytes(first[2..4].try_into().unwrap()), 0);
        assert_eq!(u32::from_be_bytes(first[4..8].try_into().unwrap()), 0);
        assert_eq!(&first[8..12], &[0; 4]); // ssrc
        assert_eq!(&first[12..], &[0xDE, 0xAD]);

        // timestamps advance by packetDuration (milliseconds)
        let second = packetizer.packetize(&[0xBE]);
        assert_eq!(u16::from_be_bytes(second[2..4].try_into().unwrap()), 1);
        assert_eq!(u32::from_be_bytes(second[4..8].try_into().unwrap()), 5);

        // sequences are continuous and blocks of 4 stay aligned
        let mut long_run = AudioPacketizer::new(5);
        for index in 0..10 {
            let packet = long_run.packetize(&[0; 1]);
            assert_eq!(u16::from_be_bytes(packet[2..4].try_into().unwrap()), index);
            assert_eq!(
                u32::from_be_bytes(packet[4..8].try_into().unwrap()),
                index as u32 * 5
            );
        }
        assert_eq!(long_run.sequence(), 10);
    }

    #[test]
    fn packetizer_timestamp_step_follows_packet_duration() {
        // A 10 ms client (x-nv-aqos.packetDuration) must get a 10 ms step,
        // not the 5 ms fallback: moonlight's FEC path derives each
        // recovered packet's timestamp from the block base timestamp.
        let mut packetizer = AudioPacketizer::new(10);
        let mut timestamps = Vec::new();
        for index in 0..3 {
            let packet = packetizer.packetize(&[0; 1]);
            assert_eq!(u16::from_be_bytes(packet[2..4].try_into().unwrap()), index);
            timestamps.push(u32::from_be_bytes(packet[4..8].try_into().unwrap()));
        }
        assert_eq!(timestamps, vec![0, 10, 20]);
    }

    #[test]
    fn opus_encode_decode_roundtrip() {
        let layout = layout_for(STEREO);
        let mut encoder =
            crate::audio_encode::OpusEncoder::new(layout, layout.bitrate_bps).unwrap();
        let mut decoder = crate::audio_encode::OpusDecoder::new(layout).unwrap();
        let frame_size = SAMPLE_RATE * DEFAULT_PACKET_DURATION_MS as usize / 1000; // 240

        // 1 second of 440 Hz stereo sine
        let mut pcm = vec![0f32; SAMPLE_RATE * 2];
        for index in 0..SAMPLE_RATE {
            let sample =
                (index as f32 * 2.0 * std::f32::consts::PI * 440.0 / SAMPLE_RATE as f32).sin()
                    * 0.5;
            pcm[index * 2] = sample;
            pcm[index * 2 + 1] = sample;
        }

        let mut decoded_stream: Vec<f32> = Vec::new();
        for frame in pcm.chunks_exact(frame_size * 2) {
            let packet = encoder.encode_float(frame, frame_size).unwrap();
            assert!(!packet.is_empty() && packet.len() <= 1400);
            let decoded = decoder.decode_float(&packet, frame_size).unwrap();
            assert_eq!(decoded.len(), frame_size * 2);
            decoded_stream.extend_from_slice(&decoded);
        }

        // Opus buffers roughly one frame internally; measure fidelity at
        // the best lag over a small window instead of sample-aligning.
        let total = SAMPLE_RATE;
        let mut best = 0f32;
        let mut best_lag = 0i32;
        for lag in -(frame_size as i32) * 2..=(frame_size as i32) * 2 {
            let mut num = 0f32;
            let mut da = 0f32;
            let mut db = 0f32;
            for j in 0..total {
                let r_idx = j as i32;
                let d_idx = j as i32 + lag;
                if d_idx < 0 || d_idx >= decoded_stream.len() as i32 / 2 {
                    continue;
                }
                let reference = pcm[(r_idx * 2) as usize];
                let decoded = decoded_stream[(d_idx * 2) as usize];
                num += decoded * reference;
                da += decoded * decoded;
                db += reference * reference;
            }
            let correlation = num / (da.sqrt() * db.sqrt() + 1e-9);
            if correlation > best {
                best = correlation;
                best_lag = lag;
            }
        }
        assert!(
            best > 0.95,
            "round-trip correlation {best} at lag {best_lag}"
        );
        assert!(
            best_lag.abs() <= (frame_size as i32) * 2,
            "codec delay {best_lag} samples out of range"
        );
    }

    #[test]
    fn synthetic_pipeline_encodes_real_opus() {
        let mut pipeline = SyntheticAudioPipeline::new(3, DEFAULT_PACKET_DURATION_MS).unwrap();
        for _ in 0..3 {
            let packet = pipeline.encode_next().unwrap().unwrap();
            assert!(!packet.payload.is_empty());
        }
        assert!(pipeline.encode_next().unwrap().is_none());
    }

    /// The dump header's encoder and its reference parser are one format:
    /// what `audio_dump_header` writes, `parse_audio_dump_record` reads back
    /// — including a second record concatenated behind the first (the file
    /// is a bare concatenation) and the truncated tails a bad write leaves.
    #[test]
    fn audio_dump_record_round_trips() {
        let first = audio_dump_header(7, 35, 3);
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&first);
        bytes.extend_from_slice(&[0xAA, 0xBB, 0xCC]);
        bytes.extend_from_slice(&audio_dump_header(8, 40, 1));
        bytes.push(0xDD);

        let (record, used) = parse_audio_dump_record(&bytes).expect("first record");
        assert_eq!(record.sequence, 7);
        assert_eq!(record.timestamp, 35);
        assert_eq!(record.payload, &[0xAAu8, 0xBB, 0xCC][..]);
        assert_eq!(used, AUDIO_DUMP_HEADER_LEN + 3);

        let (record, used) = parse_audio_dump_record(&bytes[used..]).expect("second record");
        assert_eq!(record.sequence, 8);
        assert_eq!(record.timestamp, 40);
        assert_eq!(record.payload, &[0xDDu8][..]);
        assert_eq!(used, AUDIO_DUMP_HEADER_LEN + 1);

        // a header with no payload, and a payload shorter than the header
        // claims, are rejected rather than read out of bounds
        assert!(parse_audio_dump_record(&bytes[..AUDIO_DUMP_HEADER_LEN]).is_none());
        let mut truncated = audio_dump_header(9, 45, 4).to_vec();
        truncated.extend_from_slice(&[0x00, 0x01]);
        assert!(parse_audio_dump_record(&truncated).is_none());

        // a wrong magic or payload type is not this format
        let mut wrong_magic = first;
        wrong_magic[0] = b'X';
        let mut wrong_magic = wrong_magic.to_vec();
        wrong_magic.extend_from_slice(&[0xAA, 0xBB, 0xCC]);
        assert!(parse_audio_dump_record(&wrong_magic).is_none());
        let mut wrong_type = first;
        wrong_type[5] = 96;
        let mut wrong_type = wrong_type.to_vec();
        wrong_type.extend_from_slice(&[0xAA, 0xBB, 0xCC]);
        assert!(parse_audio_dump_record(&wrong_type).is_none());
    }

    /// The tone source is a truthful instrument only if it paces like the
    /// capture path: one frame per negotiated interval, never the flood the
    /// unpaced source produced (21036 packets/s against a 200/s negotiation).
    #[test]
    fn tone_pacing_steps_one_frame_per_interval() {
        let interval = Duration::from_millis(5);
        let base = Instant::now();

        // a frame due in the future: sleep the remainder, stay on the grid
        let (sleep, next) = pace_step(base + interval, base, interval);
        assert_eq!(sleep, interval);
        assert_eq!(next, base + interval + interval);

        // exactly due: emit now, next interval on
        let (sleep, next) = pace_step(base, base, interval);
        assert_eq!(sleep, Duration::ZERO);
        assert_eq!(next, base + interval);

        // late: no sleep and no catch-up burst — a stalled loop restarts the
        // schedule from now instead of firing a flurry of frames at once
        let late = base + interval * 3;
        let (sleep, next) = pace_step(base + interval, late, interval);
        assert_eq!(sleep, Duration::ZERO);
        assert_eq!(next, late + interval);

        // the frame size and the pacing interval follow the negotiated
        // duration: 5ms packets are 240-sample stereo frames, 200 packets/s
        let pipeline = SyntheticAudioPipeline::new(1, 10).unwrap();
        assert_eq!(pipeline.frame_size, 480);
        assert_eq!(pipeline.packet_duration, Duration::from_millis(10));
        // 0 clamps to 1ms, exactly as AudioPacketizer does with the same
        // negotiated value
        let fallback = SyntheticAudioPipeline::new(1, 0).unwrap();
        assert_eq!(fallback.frame_size, 48);
        assert_eq!(fallback.packet_duration, Duration::from_millis(1));
    }

    /// The capture-read census: the flags histogram the sender loop prints
    /// beside the PCM levels, and the take/fold pair that keeps a window's
    /// census separate from the session's.
    #[test]
    fn buffer_flags_census_counts_values_and_bits() {
        let mut flags = BufferFlags::default();
        // a normal window: three unflagged buffers and one the engine
        // flagged silent
        for _ in 0..3 {
            flags.observe(0x0, 240);
        }
        flags.observe(0x2, 240);
        assert_eq!(flags.buffers(), 4);
        assert_eq!(flags.frames, 960);
        assert_eq!(flags.silent(), 1);
        assert_eq!(flags.discontinuous(), 0);
        let summary = flags.summary();
        assert!(summary.contains("buffers=4"), "{summary}");
        assert!(summary.contains("frames=960"), "{summary}");
        assert!(summary.contains("0x0:3"), "{summary}");
        assert!(summary.contains("0x2:1"), "{summary}");
        assert!(summary.contains("silent=1"), "{summary}");

        // a buffer can carry SILENT together with other bits: the bit counts
        // it, the histogram keeps the exact value
        flags.observe(0x3, 240);
        assert_eq!(flags.silent(), 2);
        assert_eq!(flags.discontinuous(), 1);
        assert!(flags.summary().contains("0x3:1"));

        // the take clears the window; the fold accumulates it
        let mut session = BufferFlags::default();
        session.fold(flags.take());
        assert_eq!(flags.buffers(), 0);
        assert_eq!(flags.frames, 0);
        assert!(flags.summary().contains("buffers=0"));
        assert!(flags.summary().contains("flags{-}"), "{}", flags.summary());
        assert_eq!(session.buffers(), 5);
        assert_eq!(session.frames, 1200);
        session.fold(BufferFlags::default());
        assert_eq!(session.buffers(), 5, "an empty window adds nothing");
        assert_eq!(session.silent(), 2);
    }

    /// The tone source reports real levels: a silent session using
    /// HYDRA_STREAM_AUDIO_SOURCE=tone must not log the silent-capture
    /// signature, so the measurement has to see the sine it hands the
    /// encoder.
    #[test]
    fn synthetic_pipeline_reports_its_pcm_levels() {
        let mut pipeline = SyntheticAudioPipeline::new(3, DEFAULT_PACKET_DURATION_MS).unwrap();
        for _ in 0..3 {
            pipeline.encode_next().unwrap().unwrap();
        }
        let mut levels = pipeline.take_levels();
        assert_eq!(levels.frames, 3);
        assert_eq!(levels.total_frames, 3);
        assert_eq!(levels.zero_run, 0);
        // the 0.25 sine peaks at 8192/32767 (-12 dBFS)
        assert!(levels.peak > 8000, "peak {}", levels.peak);
        assert!(!levels.all_zero_since_start());
        assert!(levels.window_summary().contains("zero-run=0"));

        // a take clears the window but not the cumulative counters
        levels = pipeline.take_levels();
        assert_eq!(levels.frames, 0);
        assert_eq!(levels.total_frames, 3);
    }

    /// Peak and mean absolute per window, and the all-zero frame counters
    /// that separate encoded silence from encoded sound.
    #[test]
    fn pcm_levels_track_peak_mean_and_zero_frames() {
        let mut levels = PcmLevels::default();
        levels.observe_frame(&[0.5, 0.5]);
        levels.observe_frame(&[0.0, 0.0]);
        assert_eq!(levels.peak, 16384);
        assert_eq!(levels.samples, 4);
        assert_eq!(levels.frames, 2);
        // one of the two frames was digital silence
        assert_eq!(levels.zero_run, 1);
        assert_eq!(levels.zero_frames, 1);
        assert_eq!(levels.total_frames, 2);
        assert!(!levels.all_zero_since_start());
        let summary = levels.window_summary();
        assert!(summary.contains("peak=-6.0dBFS"), "{summary}");
        assert!(summary.contains("mean=-12.0dBFS"), "{summary}");
        assert!(summary.contains("zero-run=1"), "{summary}");

        // the take hands the window out and resets it, keeping the
        // cumulative counters (a run can outlive a reporting window)
        let taken = levels.take();
        assert_eq!(taken.peak, 16384);
        assert_eq!(taken.mean_abs(), 8192);
        assert_eq!(levels.frames, 0);
        assert_eq!(levels.samples, 0);
        assert_eq!(levels.peak, 0);
        assert_eq!(levels.zero_run, 1);
        assert_eq!(levels.total_frames, 2);

        // every frame zero since the start is the silent-capture signature
        let mut silence = PcmLevels::default();
        for _ in 0..3 {
            silence.observe_frame(&[0.0; 480]);
        }
        assert!(silence.all_zero_since_start());
        assert_eq!(silence.zero_run, 3);
        assert_eq!(silence.peak, 0);
        assert_eq!(silence.mean_abs(), 0);
        assert!(silence.window_summary().contains("peak=-120.0dBFS"));
        assert!(silence.session_summary().contains("zero-frames=3/3"));
    }

    /// Folding takes is what the sender loop does: the session peak is the
    /// max over windows, the sums add up and the cumulative counters follow
    /// the newest snapshot.
    #[test]
    fn pcm_levels_fold_accumulates_windows_into_the_session() {
        let mut flow = PcmLevels::default();
        let mut session = PcmLevels::default();

        flow.observe_frame(&[0.25, 0.25]);
        flow.observe_frame(&[0.0, 0.0]);
        let first = flow.take();
        session.fold(first);

        flow.observe_frame(&[1.0, 0.0]);
        let second = flow.take();
        session.fold(second);

        assert_eq!(session.peak, 32767, "session peak is the window max");
        assert_eq!(session.frames, 3);
        assert_eq!(session.total_frames, 3);
        assert_eq!(session.zero_frames, 1);
        assert_eq!(session.zero_run, 0, "the loud frame ended the run");
        assert!(!session.all_zero_since_start());
        let summary = session.session_summary();
        assert!(summary.contains("zero-frames=1/3"), "{summary}");
        assert!(summary.contains("zero-run=0"), "{summary}");
    }

    /// The reporting schedule: one line per second through the ramp, then one
    /// every `AUDIO_STEADY_REPORT_SECS` for the rest of the session. Reporting
    /// never stops, and the cadence never shrinks back to per-second.
    #[test]
    fn report_cadence_ramps_then_holds_for_the_whole_session() {
        assert_eq!(
            report_cadence(Duration::from_secs(0)),
            Duration::from_secs(1)
        );
        assert_eq!(
            report_cadence(Duration::from_secs(AUDIO_RAMP_REPORT_SECS - 1)),
            Duration::from_secs(1),
            "the last ramp interval is still per-second"
        );
        assert_eq!(
            report_cadence(Duration::from_secs(AUDIO_RAMP_REPORT_SECS)),
            Duration::from_secs(AUDIO_STEADY_REPORT_SECS)
        );

        // every interval of a 30-minute session, in order: the cadence is the
        // steady one after the ramp and never decreases
        let mut previous = Duration::from_secs(0);
        for second in 0..=30 * 60 {
            let cadence = report_cadence(Duration::from_secs(second));
            let expected = if second < AUDIO_RAMP_REPORT_SECS {
                Duration::from_secs(1)
            } else {
                Duration::from_secs(AUDIO_STEADY_REPORT_SECS)
            };
            assert_eq!(cadence, expected, "second {second}");
            assert!(cadence >= previous, "cadence shrank at second {second}");
            previous = cadence;
        }

        // ~370 lines for a 30-minute session, not the 1800 a per-second
        // cadence would print
        let lines =
            AUDIO_RAMP_REPORT_SECS + (30 * 60 - AUDIO_RAMP_REPORT_SECS) / AUDIO_STEADY_REPORT_SECS;
        assert!(lines < 400, "{lines}");
    }

    /// One steady-state line's numbers: the worst case of the interval that
    /// just elapsed, and the session peak every line re-reports. A loud
    /// interval after quiet ones must show up, and a quiet interval must never
    /// lower the session peak.
    #[test]
    fn interval_summary_reports_the_worst_case_and_keeps_the_session_peak() {
        let mut window = PcmLevels::default();
        let mut session = PcmLevels::default();

        // first interval: quiet frames only
        for _ in 0..4 {
            window.observe_frame(&[0.25, 0.25]);
        }
        let first = window.take();
        let summary = first.interval_summary(session);
        assert!(summary.contains("pcm peak=-12.0dBFS"), "{summary}");
        assert!(summary.contains("zero-frames=0/4"), "{summary}");
        assert!(summary.contains("session-peak=-12.0dBFS"), "{summary}");
        session.fold(first);

        // second interval: one silent frame and one peak, so the interval peak
        // is its own max over samples, and its zero-frame ratio is its own
        window.observe_frame(&[0.0, 0.0]);
        window.observe_frame(&[0.5, 0.5]);
        let second = window.take();
        let summary = second.interval_summary(session);
        assert!(summary.contains("pcm peak=-6.0dBFS"), "{summary}");
        assert!(summary.contains("zero-frames=1/2"), "{summary}");
        assert!(
            summary.contains("session-peak=-6.0dBFS"),
            "a later peak raises the session peak: {summary}"
        );
        session.fold(second);

        // third interval: quiet again — the interval peak drops, the session
        // peak does not
        window.observe_frame(&[0.125, 0.125]);
        let third = window.take();
        let summary = third.interval_summary(session);
        assert!(summary.contains("pcm peak=-18.1dBFS"), "{summary}");
        assert!(
            summary.contains("session-peak=-6.0dBFS"),
            "a quiet interval must not reset the session peak: {summary}"
        );
        session.fold(third);

        // the session-end line carries the whole session, not the trailing
        // interval
        let summary = session.session_summary();
        assert!(summary.contains("pcm session peak=-6.0dBFS"), "{summary}");
        assert!(summary.contains("zero-frames=1/7"), "{summary}");
        assert_eq!(session.frames, 7);
    }

    /// The audio destination belongs to the session's own client: any port
    /// of that IP (a legitimate rebind) is taken, another host never is.
    #[test]
    fn audio_source_filter_accepts_the_session_client_only() {
        let client: IpAddr = "192.168.1.27".parse().unwrap();
        let source = |address: &str| audio_source_allowed(Some(client), address.parse().unwrap());
        assert!(source("192.168.1.27:52398"), "the session client");
        assert!(source("192.168.1.27:33422"), "a rebind on the same IP");
        assert!(!source("192.168.1.4:33422"), "a second device");
        // no negotiated address (a session driven directly): legacy behaviour
        assert!(audio_source_allowed(None, "192.168.1.4:33422".parse().unwrap()));
    }

    /// Sunshine's `stream_configs` (`src/audio.cpp:51-100`), at 48 kHz.
    #[test]
    fn layout_table_matches_sunshine_stream_configs() {
        let expected: [(u8, u8, u8, [u8; 8], i32); 6] = [
            (2, 1, 1, [0, 1, 0, 0, 0, 0, 0, 0], 96_000),
            (2, 1, 1, [0, 1, 0, 0, 0, 0, 0, 0], 512_000),
            (6, 4, 2, [0, 1, 2, 3, 4, 5, 0, 0], 256_000),
            (6, 6, 0, [0, 1, 2, 3, 4, 5, 0, 0], 1_536_000),
            (8, 5, 3, [0, 1, 2, 3, 4, 5, 6, 7], 450_000),
            (8, 8, 0, [0, 1, 2, 3, 4, 5, 6, 7], 2_048_000),
        ];
        assert_eq!(AUDIO_LAYOUTS.len(), expected.len());
        for (index, (channels, streams, coupled, mapping, bitrate)) in
            expected.iter().enumerate()
        {
            let layout = layout_for(index);
            assert_eq!(layout.channel_count, *channels, "row {index} channels");
            assert_eq!(layout.streams, *streams, "row {index} streams");
            assert_eq!(
                layout.coupled_streams, *coupled,
                "row {index} coupled streams"
            );
            assert_eq!(layout.mapping, *mapping, "row {index} mapping");
            assert_eq!(layout.bitrate_bps, *bitrate, "row {index} bitrate");
        }
    }

    /// Sunshine's `audio::map_stream` (`src/audio.cpp:297-307`).
    #[test]
    fn map_stream_selects_sunshine_rows() {
        assert_eq!(map_stream(2, false), STEREO);
        assert_eq!(map_stream(2, true), STEREO + 1);
        assert_eq!(map_stream(6, false), SURROUND51);
        assert_eq!(map_stream(6, true), SURROUND51 + 1);
        assert_eq!(map_stream(8, false), SURROUND71);
        assert_eq!(map_stream(8, true), SURROUND71 + 1);
        // unsupported counts fall back to normal stereo, ignored quality
        for channel_count in [0u32, 1, 3, 4, 5, 7, 12] {
            assert_eq!(map_stream(channel_count, false), STEREO, "{channel_count}");
            assert_eq!(map_stream(channel_count, true), STEREO, "{channel_count}");
        }
    }

    /// The ANNOUNCE surround attributes decide the layout: channel count,
    /// the explicit `AudioQuality` flag (`src/rtsp.cpp:1152-1153`), the
    /// host-audio fallback for clients that never sent one, and
    /// `x-nv-audio.surround.enable=0` pinning stereo.
    #[test]
    fn select_layout_honours_announce_attributes() {
        // no AudioQuality yet: the pre-surround host-audio rule decides
        assert_eq!(select_layout(6, None, true, false).bitrate_bps, 256_000);
        assert_eq!(select_layout(6, None, true, true).bitrate_bps, 1_536_000);
        assert_eq!(select_layout(8, None, true, true).bitrate_bps, 2_048_000);
        assert_eq!(select_layout(2, None, true, true).bitrate_bps, 512_000);
        // an explicit AudioQuality overrides the host-audio rule
        assert_eq!(select_layout(6, Some(false), true, true).bitrate_bps, 256_000);
        assert_eq!(select_layout(6, Some(true), true, false).bitrate_bps, 1_536_000);
        assert_eq!(select_layout(6, Some(true), true, false).channel_count, 6);
        assert_eq!(select_layout(6, Some(true), true, false).streams, 6);
        assert_eq!(select_layout(6, Some(true), true, false).coupled_streams, 0);
        // surround disabled pins stereo, whatever else was negotiated
        assert_eq!(select_layout(8, Some(true), false, true).channel_count, 2);
        assert_eq!(select_layout(8, Some(true), false, true).bitrate_bps, 512_000);
    }

    /// A 5.1/7.1 client decodes with `opus_multistream_decode` at the layout
    /// its own parser built from the DESCRIBE surround-params
    /// (moonlight-common-c RtspConnection.c parseOpusConfigurations), so a
    /// per-channel round-trip at the advertised layout is exactly the
    /// client's decode path.
    fn multistream_roundtrip(index: usize) {
        let layout = layout_for(index);
        let channel_count = layout.channel_count as usize;
        let mut encoder = crate::audio_encode::OpusEncoder::new(layout, layout.bitrate_bps).unwrap();
        let mut decoder = crate::audio_encode::OpusDecoder::new(layout).unwrap();
        let frame_size = SAMPLE_RATE * DEFAULT_PACKET_DURATION_MS as usize / 1000; // 240
        let frequencies: [f32; 8] = [220.0, 330.0, 440.0, 550.0, 660.0, 770.0, 880.0, 990.0];

        // 1 second of a distinct sine per channel
        let reference: Vec<Vec<f32>> = (0..channel_count)
            .map(|channel| {
                (0..SAMPLE_RATE)
                    .map(|index| {
                        (index as f32 * 2.0 * std::f32::consts::PI * frequencies[channel]
                            / SAMPLE_RATE as f32)
                            .sin()
                            * 0.25
                    })
                    .collect()
            })
            .collect();

        let mut decoded: Vec<Vec<f32>> = vec![Vec::new(); channel_count];
        for frame in 0..SAMPLE_RATE / frame_size {
            let mut pcm = vec![0f32; frame_size * channel_count];
            for (channel, samples) in reference.iter().enumerate() {
                for sample in 0..frame_size {
                    pcm[sample * channel_count + channel] = samples[frame * frame_size + sample];
                }
            }
            let packet = encoder.encode_float(&pcm, frame_size).unwrap();
            assert!(!packet.is_empty() && packet.len() <= 1400);
            let out = decoder.decode_float(&packet, frame_size).unwrap();
            assert_eq!(out.len(), frame_size * channel_count);
            for channel in 0..channel_count {
                for sample in 0..frame_size {
                    decoded[channel].push(out[sample * channel_count + channel]);
                }
            }
        }

        // Opus buffers roughly one frame internally; measure fidelity at
        // the best lag over a small window instead of sample-aligning.
        for channel in 0..channel_count {
            let mut best = 0f32;
            let mut best_lag = 0i32;
            for lag in -(frame_size as i32) * 2..=(frame_size as i32) * 2 {
                let mut num = 0f32;
                let mut da = 0f32;
                let mut db = 0f32;
                for j in 0..SAMPLE_RATE {
                    let d_idx = j as i32 + lag;
                    if d_idx < 0 || d_idx >= decoded[channel].len() as i32 {
                        continue;
                    }
                    let expected = reference[channel][j];
                    let actual = decoded[channel][d_idx as usize];
                    num += actual * expected;
                    da += actual * actual;
                    db += expected * expected;
                }
                let correlation = num / (da.sqrt() * db.sqrt() + 1e-9);
                if correlation > best {
                    best = correlation;
                    best_lag = lag;
                }
            }
            assert!(
                best > 0.95,
                "row {index} channel {channel} correlation {best} at lag {best_lag}"
            );
        }
    }

    #[test]
    fn multistream_51_roundtrip() {
        multistream_roundtrip(SURROUND51);
        multistream_roundtrip(SURROUND51 + 1);
    }

    #[test]
    fn multistream_71_roundtrip() {
        multistream_roundtrip(SURROUND71);
        multistream_roundtrip(SURROUND71 + 1);
    }
}
