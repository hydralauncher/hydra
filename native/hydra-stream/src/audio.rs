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
//! Blocks stay aligned because the sequence starts at 0. Audio payload
//! encryption (AES-CBC) is negotiated off via our DESCRIBE, so payloads
//! are plaintext Opus.

use std::io;
use std::net::UdpSocket;
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

/// A source of encoded Opus audio frames. Implemented by the WASAPI
/// pipeline in production and by a synthetic sine generator in tests.
pub trait AudioPipeline: Send {
    /// Encodes the next `frame_size`-sample frame. `Ok(None)` means no
    /// frame is available yet.
    fn encode_next(&mut self) -> Result<Option<EncodedAudio>, String>;
}

/// Packs Opus payloads into NVSP audio RTP packets. Pure: no sockets.
pub struct AudioPacketizer {
    packet_duration: u32,
    next_sequence: u16,
    timestamp: u32,
}

impl AudioPacketizer {
    pub fn new(packet_duration_ms: u32) -> Self {
        AudioPacketizer {
            packet_duration: packet_duration_ms.max(1),
            next_sequence: 0,
            timestamp: 0,
        }
    }

    pub fn packetize(&mut self, opus_payload: &[u8]) -> Vec<u8> {
        let mut packet = Vec::with_capacity(12 + opus_payload.len());
        packet.push(0x80);
        packet.push(AUDIO_PAYLOAD_TYPE);
        packet.extend_from_slice(&self.next_sequence.to_be_bytes());
        packet.extend_from_slice(&self.timestamp.to_be_bytes());
        packet.extend_from_slice(&0u32.to_be_bytes()); // ssrc
        packet.extend_from_slice(opus_payload);

        self.next_sequence = self.next_sequence.wrapping_add(1);
        self.timestamp = self.timestamp.wrapping_add(self.packet_duration);
        packet
    }

    pub fn sequence(&self) -> u16 {
        self.next_sequence
    }
}

/// Blocking sender loop; runs on its own thread like the video loop.
/// The client endpoint is learned from the ping datagrams Moonlight
/// sends to the audio port; packets are dropped until then. QoS
/// marking (qWAVE Voice / DSCP EF) is applied to the first endpoint and
/// re-marked when it moves, per the client's
/// `x-nv-aqos.qosTrafficType` ANNOUNCE attribute.
pub fn run_audio_loop(
    socket: UdpSocket,
    shared: Arc<crate::video::StreamShared>,
    mut pipeline: Box<dyn AudioPipeline>,
    packet_duration_ms: u32,
    audio_qos_type: Option<i32>,
) -> Result<(), String> {
    socket
        .set_nonblocking(true)
        .map_err(|error| format!("audio socket: {error}"))?;

    // The timestamp step must follow the negotiated duration: the client
    // reconstructs FEC base timestamps as
    // `baseTimestamp + i * AudioPacketDuration`.
    let mut packetizer = AudioPacketizer::new(packet_duration_ms);
    let mut buffer = [0u8; 512];
    let epoch = Instant::now();
    let mut packets_sent: u64 = 0;
    let mut sends = crate::video::SendGuard::new("audio");
    let mut last_report = Instant::now();
    let mut reporting = true;
    let mut first_send = true;
    let mut _audio_qos_flow: Option<crate::qos::QosFlow> = None;
    loop {
        if shared.stop.load(Ordering::Relaxed) {
            eprintln!(
                "audio: loop stopped (session ended; {})",
                sends.summary()
            );
            return Ok(());
        }

        // Learn the client endpoint from its pings and drain the socket;
        // the source may change between sessions (client socket rebind).
        // QoS marking re-runs for every new endpoint.
        let mut learned_peer: Option<std::net::SocketAddr> = None;
        loop {
            match socket.recv_from(&mut buffer) {
                Ok((_, source)) => {
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
        let Some(peer) = *shared.audio_peer.lock().expect("audio peer lock") else {
            continue;
        };
        let packet = packetizer.packetize(&encoded.payload);
        sends.record(&socket.send_to(&packet, peer));
        packets_sent += 1;
        if first_send && sends.sent > 0 {
            first_send = false;
            eprintln!("audio: first RTP packet sent to {peer}");
        }
        if reporting {
            let now = Instant::now();
            let elapsed = now.duration_since(last_report);
            if elapsed >= Duration::from_secs(1) {
                eprintln!(
                    "audio: sent {packets_sent} packets in {}ms ({})",
                    elapsed.as_millis(),
                    sends.summary()
                );
                packets_sent = 0;
                last_report = now;
                if now.duration_since(epoch) >= Duration::from_secs(10) {
                    reporting = false;
                    eprintln!("audio: first-10s packet reporting done, stream continuing");
                }
            }
        }
    }
}

/// Synthetic stereo sine source: encodes real Opus from a deterministic PCM
/// pattern, so tests exercise the encoder and the
/// HYDRA_STREAM_AUDIO_SOURCE=tone diagnostic can feed the sender loop with
/// unmistakable audio. It always encodes the stereo layout.
pub struct SyntheticAudioPipeline {
    encoder: crate::audio_encode::OpusEncoder,
    frame_size: usize,
    max_packets: u32,
    emitted: u32,
    phase: f32,
}

impl SyntheticAudioPipeline {
    pub fn new(max_packets: u32) -> Result<Self, String> {
        let layout = layout_for(STEREO);
        Ok(SyntheticAudioPipeline {
            encoder: crate::audio_encode::OpusEncoder::new(layout, layout.bitrate_bps)?,
            frame_size: SAMPLE_RATE * DEFAULT_PACKET_DURATION_MS as usize / 1000,
            max_packets,
            emitted: 0,
            phase: 0.0,
        })
    }
}

impl AudioPipeline for SyntheticAudioPipeline {
    fn encode_next(&mut self) -> Result<Option<EncodedAudio>, String> {
        if self.emitted >= self.max_packets {
            return Ok(None);
        }
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
        Ok(Some(EncodedAudio {
            payload: self.encoder.encode_float(&pcm, self.frame_size)?,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let mut pipeline = SyntheticAudioPipeline::new(3).unwrap();
        for _ in 0..3 {
            let packet = pipeline.encode_next().unwrap().unwrap();
            assert!(!packet.payload.is_empty());
        }
        assert!(pipeline.encode_next().unwrap().is_none());
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
