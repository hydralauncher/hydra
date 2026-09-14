//! WASAPI loopback capture of the default render device (host stays
//! audible) feeding the Opus encoder — the production audio pipeline.
//! The capture stream always declares 48 kHz and Windows resamples any
//! other device mix rate (Sunshine `audio.cpp:391-399`), so the encoder
//! only ever sees 48 kHz float. The device's own channel count (and, when
//! the mix format is `WAVEFORMATEXTENSIBLE`, its `dwChannelMask`) is mapped
//! into the client's Opus layout by [`channel_sources`].

use std::thread::sleep;
use std::time::Duration;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IAudioRenderClient, IMMDevice,
    IMMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, MMDeviceEnumerator, WAVEFORMATEX, WAVE_FORMAT_PCM,
};
use windows::Win32::Media::Multimedia::WAVE_FORMAT_IEEE_FLOAT;

const WAVE_FORMAT_EXTENSIBLE: u32 = 0xFFFE;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

use crate::audio::{AudioLayout, AudioPipeline, EncodedAudio, SAMPLE_RATE};
use crate::audio_encode::OpusEncoder;

const WAVE_FORMAT_EXTL_FLOAT_GUID: windows::core::GUID =
    windows::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

/// `KSAUDIO_SPEAKER_FRONT_CENTER` (ksmedia.h): the `dwChannelMask` bit for
/// the front-centre speaker, the one mask bit that changes the upmix.
const SPEAKER_FRONT_CENTER: u32 = 0x4;

/// Where one client-layout channel's samples come from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChannelSource {
    /// Sample the device's channel at this positional index.
    Device(usize),
    /// Average of two device channels (a synthesized centre).
    Mix(usize, usize),
    /// No device source: emit silence (an absent LFE).
    Silence,
}

/// One source per client channel (index `0..channel_count`), derived from the
/// captured device's channel count and, when known, its `dwChannelMask`.
///
/// Windows' canonical order for the standard masks is Moonlight's own
/// (FL, FR, FC, LFE, BL, BR, SL, SR), so the rules are positional:
///
/// - equal channel counts: identity (`Device(0..n)`);
/// - mono device: every client channel duplicates it;
/// - fewer device channels than the layout: the channels the device provides
///   are taken positionally (fronts, its own centre, LFE, backs); the centre
///   is synthesized as `Mix(FL, FR)` when the device has none — positional
///   channel 2 counts as the centre only when the mask says so, and without
///   a mask a third channel implies the canonical order; a missing LFE is
///   silence, and a missing back/side channel duplicates the corresponding
///   front channel (FL for the left ones, FR for the right);
/// - more device channels than the layout: the layout's front channels are
///   taken positionally.
///
/// Channels beyond `layout.channel_count` are [`ChannelSource::Silence`].
pub fn channel_sources(
    device_channels: u8,
    device_mask: Option<u32>,
    layout: &AudioLayout,
) -> [ChannelSource; 8] {
    let device = device_channels as usize;
    let channel_count = layout.channel_count as usize;
    let mut sources = [ChannelSource::Silence; 8];

    if device <= 1 {
        // mono (or, defensively, a device reporting no channels)
        let source = if device == 1 {
            ChannelSource::Device(0)
        } else {
            ChannelSource::Silence
        };
        for channel in 0..channel_count {
            sources[channel] = source;
        }
        return sources;
    }

    if device >= channel_count {
        // same count: identity; more: the layout's front channels, positionally
        for channel in 0..channel_count {
            sources[channel] = ChannelSource::Device(channel);
        }
        return sources;
    }

    let device_has_centre =
        device_mask.map_or(device >= 3, |mask| mask & SPEAKER_FRONT_CENTER != 0);
    for (channel, source) in sources[..channel_count].iter_mut().enumerate() {
        *source = match channel {
            // the device's positional channel 2 is the centre only when it
            // really has one; otherwise synthesize it from FL/FR
            2 if device >= 3 => {
                if device_has_centre {
                    ChannelSource::Device(2)
                } else {
                    ChannelSource::Mix(0, 1)
                }
            }
            // a channel the device has (fronts, its own centre, LFE, backs)
            channel if channel < device => ChannelSource::Device(channel),
            2 => ChannelSource::Mix(0, 1),
            3 => ChannelSource::Silence,
            // back/side without a device source: duplicate the front channel
            // on the same side
            channel => ChannelSource::Device(channel % 2),
        };
    }
    sources
}

/// Maps one device-interleaved chunk into the client layout, one
/// [`ChannelSource`] per client channel. Pure, so the upmix/downmix is
/// testable without an audio device.
fn map_to_layout(
    staging: &[f32],
    device_channels: usize,
    sources: &[ChannelSource; 8],
    channel_count: usize,
) -> Vec<f32> {
    let frames = match device_channels {
        0 => 0,
        device_channels => staging.len() / device_channels,
    };
    let mut mapped = vec![0f32; frames * channel_count];
    for frame in 0..frames {
        for (channel, source) in sources[..channel_count].iter().enumerate() {
            let value = match *source {
                ChannelSource::Device(index) if index < device_channels => {
                    staging[frame * device_channels + index]
                }
                ChannelSource::Mix(left, right)
                    if left < device_channels && right < device_channels =>
                {
                    0.5 * (staging[frame * device_channels + left]
                        + staging[frame * device_channels + right])
                }
                ChannelSource::Device(_) | ChannelSource::Mix(_, _) | ChannelSource::Silence => 0.0,
            };
            mapped[frame * channel_count + channel] = value;
        }
    }
    mapped
}

struct WasapiLoopback {
    _device: IMMDevice,
    client: IAudioClient,
    capture: IAudioCaptureClient,
    channels: u16,
    float: bool,
    /// `WAVEFORMATEXTENSIBLE.dwChannelMask`, when the mix format is
    /// extensible and carries one.
    mask: Option<u32>,
    /// Windows stops the audio engine (and loopback data) when nothing
    /// renders to the device; this silent render stream keeps it mixing.
    _silence: Option<SilenceKeeper>,
}

struct SilenceKeeper {
    _client: IAudioClient,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

/// Render client handle only touched from the silence writer thread.
struct SharedRender(IAudioRenderClient);
unsafe impl Send for SharedRender {}

unsafe impl Send for SilenceKeeper {}

/// Writes silence into the render buffer forever (keeps the audio engine
/// mixing so loopback capture yields data even when the host is quiet).
fn silence_writer_loop(
    wrapper: SharedRender,
    frames: u32,
    block_align: u16,
    stop: Arc<AtomicBool>,
) {
    let SharedRender(render) = wrapper;
    let chunk = frames / 2;
    while !stop.load(Ordering::Relaxed) {
        unsafe {
            if let Ok(pointer) = render.GetBuffer(chunk) {
                if !pointer.is_null() {
                    // zero `chunk` FRAMES: chunk * nBlockAlign bytes, from
                    // the actual mix format (hardcoding 8 would corrupt
                    // PCM16/non-stereo devices)
                    std::ptr::write_bytes(pointer, 0, chunk as usize * block_align as usize);
                }
                let _ = render.ReleaseBuffer(chunk, 0);
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

impl SilenceKeeper {
    fn start(device: &IMMDevice, mix_format: *const WAVEFORMATEX) -> Option<SilenceKeeper> {
        unsafe {
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None).ok()?;
            client
                .Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 200_000, 0, mix_format, None)
                .ok()?;
            let render: IAudioRenderClient = client.GetService().ok()?;
            let frames = client.GetBufferSize().ok()?;
            client.Start().ok()?;
            // bytes per frame from the actual mix format
            // (WAVEFORMATEX.nBlockAlign, offset 12)
            let block_align = (*mix_format).nBlockAlign;
            let stop = Arc::new(AtomicBool::new(false));
            let stop_for_thread = stop.clone();
            let wrapper = SharedRender(render);
            let thread = std::thread::spawn(move || {
                silence_writer_loop(wrapper, frames, block_align, stop_for_thread);
            });
            Some(SilenceKeeper {
                _client: client,
                stop,
                thread: Some(thread),
            })
        }
    }
}

impl Drop for SilenceKeeper {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// The format the capture stream declares to `IAudioClient::Initialize`:
/// always 48 kHz, so Windows' shared-mode resampler converts any other
/// device mix rate. Sunshine gets there from the other direction, building
/// its own 48 kHz format (`audio.cpp:124-127`) and setting AUTOCONVERTPCM
/// (`:391-399`). Pure, so it is testable without an audio device.
struct DeclaredFormat {
    sample_rate: u32,
    avg_bytes_per_sec: u32,
    /// True when the mixer rate differs and Windows has to resample.
    resampling: bool,
}

/// Decides what to declare for a detected mixer format. `block_align` is the
/// mixer's `nBlockAlign` (channels x bytes per sample): only the rate is
/// replaced, so `nAvgBytesPerSec` must follow the declared rate or
/// `Initialize` rejects the descriptor.
fn declared_format(mixer_rate: u32, block_align: u16) -> DeclaredFormat {
    let sample_rate = SAMPLE_RATE as u32;
    DeclaredFormat {
        sample_rate,
        avg_bytes_per_sec: sample_rate * block_align as u32,
        resampling: mixer_rate != sample_rate,
    }
}

impl WasapiLoopback {
    /// Opens a shared-mode loopback stream on the default console render
    /// device, delivering 48 kHz float at the device's own channel count:
    /// the descriptor declares 48 kHz and Windows resamples the device mix
    /// into it.
    fn new() -> Result<WasapiLoopback, String> {
        unsafe {
            // S_FALSE means COM is already initialized on this thread — fine.
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|error| format!("CoInitializeEx: {error}"))?;

            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|error| format!("MMDeviceEnumerator: {error}"))?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|error| format!("GetDefaultAudioEndpoint: {error}"))?;
            let client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|error| format!("Activate IAudioClient: {error}"))?;

            let mix_format_ptr = client
                .GetMixFormat()
                .map_err(|error| format!("GetMixFormat: {error}"))?;
            if mix_format_ptr.is_null() {
                return Err("GetMixFormat returned null".to_string());
            }
            // WAVEFORMATEX is packed: read fields unaligned.
            let read_u16 =
                |offset: usize| (mix_format_ptr as *const u8).add(offset).cast::<u16>().read_unaligned();
            let read_u32 =
                |offset: usize| (mix_format_ptr as *const u8).add(offset).cast::<u32>().read_unaligned();
            let format_tag = read_u16(0) as u32;
            let channels = read_u16(2);
            let sample_rate = read_u32(4);
            let block_align = read_u16(12);
            // WAVEFORMATEXTENSIBLE (packed) is WAVEFORMATEX (18 bytes) +
            // wValidBitsPerSample (u16) + dwChannelMask (u32) + SubFormat
            // (GUID), so the mask sits at byte 20 and the sub-format GUID the
            // code below reads at byte 24 is the final field (40 bytes
            // total); cbSize is the last WAVEFORMATEX word, at byte 16.
            let mask = (format_tag == WAVE_FORMAT_EXTENSIBLE && read_u16(16) >= 22)
                .then(|| read_u32(20));
            let float = match format_tag {
                WAVE_FORMAT_IEEE_FLOAT => true,
                WAVE_FORMAT_PCM => false,
                WAVE_FORMAT_EXTENSIBLE => {
                    // SubFormat GUID follows the WAVEFORMATEX header (offset 24).
                    let sub_format = std::ptr::read_unaligned(
                        (mix_format_ptr as *const u8)
                            .add(24)
                            .cast::<windows::core::GUID>(),
                    );
                    sub_format == WAVE_FORMAT_EXTL_FLOAT_GUID
                }
                tag => return Err(format!("unsupported mix format tag {tag}")),
            };
            let declared = declared_format(sample_rate, block_align);
            eprintln!(
                "audio loopback: {channels} channels, {sample_rate} Hz, {}, {}",
                if float { "float" } else { "pcm16" },
                if declared.resampling {
                    "will be resampled to 48000 by Windows"
                } else {
                    "no resampling needed"
                }
            );
            // Sunshine builds its own 48 kHz format and lets Windows do the
            // conversion (audio.cpp:391-399), so only nSamplesPerSec (offset
            // 4) and nAvgBytesPerSec (offset 8) are patched here: the
            // device's channel count, sample type and block align stay, and
            // read_chunk() adapts them as before. Initialize copies the
            // descriptor, so the device's own rate is restored below before
            // the silence keeper reuses this buffer (shared mode requires it
            // to pass the true mix format).
            let native_avg_bytes_per_sec = read_u32(8);
            (mix_format_ptr as *mut u8)
                .add(4)
                .cast::<u32>()
                .write_unaligned(declared.sample_rate);
            (mix_format_ptr as *mut u8)
                .add(8)
                .cast::<u32>()
                .write_unaligned(declared.avg_bytes_per_sec);
            // 20 ms buffer; loopback flag keeps the host audible, the
            // AUTOCONVERTPCM pair hands any rate mismatch to Windows' SRC.
            client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK
                        | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                        | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                    200_000, // 20 ms in 100 ns units
                    0,
                    mix_format_ptr,
                    None,
                )
                .map_err(|error| format!("IAudioClient::Initialize: {error}"))?;
            (mix_format_ptr as *mut u8)
                .add(4)
                .cast::<u32>()
                .write_unaligned(sample_rate);
            (mix_format_ptr as *mut u8)
                .add(8)
                .cast::<u32>()
                .write_unaligned(native_avg_bytes_per_sec);
            let capture: IAudioCaptureClient = client
                .GetService()
                .map_err(|error| format!("GetService IAudioCaptureClient: {error}"))?;
            client
                .Start()
                .map_err(|error| format!("IAudioClient::Start: {error}"))?;

            let silence = SilenceKeeper::start(&device, mix_format_ptr);
            if silence.is_some() {
                eprintln!("audio: silence keeper active");
            }
            Ok(WasapiLoopback {
                _device: device,
                client,
                capture,
                channels,
                float,
                mask,
                _silence: silence,
            })
        }
    }

    /// Reads the next available capture chunk as interleaved f32 at the
    /// device's own channel count; the pipeline maps it to the client layout
    /// with [`map_to_layout`]. Returns an empty vector when no packet is
    /// ready yet.
    fn read_chunk(&mut self) -> Result<Vec<f32>, String> {
        unsafe {
            let mut packet: *mut u8 = std::ptr::null_mut();
            let mut frames = 0u32;
            let mut flags = 0u32;
            self.capture
                .GetBuffer(
                    &mut packet,
                    &mut frames,
                    &mut flags,
                    None,
                    None,
                )
                .map_err(|error| format!("GetBuffer: {error}"))?;
            if frames == 0 {
                return Ok(Vec::new());
            }

            let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
            let count = frames as usize;
            let channels = self.channels as usize;
            let mut staging = vec![0f32; count * channels];
            if !silent && !packet.is_null() {
                let total = count * channels;
                if self.float {
                    staging.copy_from_slice(std::slice::from_raw_parts(
                        packet as *const f32,
                        total,
                    ));
                } else {
                    for (index, sample) in std::slice::from_raw_parts(packet as *const i16, total)
                        .iter()
                        .enumerate()
                    {
                        staging[index] = *sample as f32 / 32768.0;
                    }
                }
            }

            self.capture
                .ReleaseBuffer(frames)
                .map_err(|error| format!("ReleaseBuffer: {error}"))?;
            Ok(staging)
        }
    }
}

unsafe impl Send for WasapiLoopback {}

impl Drop for WasapiLoopback {
    fn drop(&mut self) {
        unsafe {
            let _ = self.client.Stop();
        }
    }
}

/// Production pipeline: WASAPI loopback -> Opus frames in the client's
/// layout (the encoder and the mapping come from the same [`AudioLayout`]).
pub struct WasapiAudioPipeline {
    capture: WasapiLoopback,
    encoder: OpusEncoder,
    frame_size: usize,
    channel_count: usize,
    device_channels: usize,
    sources: [ChannelSource; 8],
    pending: Vec<f32>,
}

impl WasapiAudioPipeline {
    /// Captures the default render device and encodes `layout` — the same
    /// row the DESCRIBE advertised, so the client's decoder lines up with
    /// the encoder's mapping (Sunshine `audio.cpp:101-128` builds the
    /// encoder straight from its `stream_configs` row).
    pub fn new(
        layout: &AudioLayout,
        packet_duration_ms: u32,
    ) -> Result<WasapiAudioPipeline, String> {
        let capture = WasapiLoopback::new()?;
        let device_channels = capture.channels as usize;
        let channel_count = layout.channel_count as usize;
        let sources = channel_sources(capture.channels.min(255) as u8, capture.mask, layout);
        eprintln!(
            "audio: {} device channels (mask {}) -> {} channel layout, sources {:?}",
            device_channels,
            capture
                .mask
                .map(|mask| format!("{mask:#x}"))
                .unwrap_or_else(|| "unknown".to_string()),
            channel_count,
            &sources[..channel_count]
        );
        let encoder = OpusEncoder::new(layout, layout.bitrate_bps)?;
        Ok(WasapiAudioPipeline {
            capture,
            encoder,
            frame_size: SAMPLE_RATE * packet_duration_ms.max(1) as usize / 1000,
            channel_count,
            device_channels,
            sources,
            pending: Vec::with_capacity(SAMPLE_RATE / 10 * channel_count),
        })
    }
}

impl AudioPipeline for WasapiAudioPipeline {
    fn encode_next(&mut self) -> Result<Option<EncodedAudio>, String> {
        // Accumulate captured samples until a full Opus frame is ready.
        // The capture thread delivers in device-buffer quanta (10-20 ms).
        let samples_per_frame = self.frame_size * self.channel_count;
        while self.pending.len() < samples_per_frame {
            let chunk = self.capture.read_chunk()?;
            if chunk.is_empty() {
                if self.pending.is_empty() {
                    // nothing captured yet: pace the caller
                    sleep(Duration::from_millis(2));
                    return Ok(None);
                }
                // pad a partial frame with silence to avoid drift
                self.pending.resize(samples_per_frame, 0.0);
                break;
            }
            self.pending.extend_from_slice(&map_to_layout(
                &chunk,
                self.device_channels,
                &self.sources,
                self.channel_count,
            ));
        }

        let frame: Vec<f32> = self.pending.drain(..samples_per_frame).collect();
        Ok(Some(EncodedAudio {
            payload: self.encoder.encode_float(&frame, self.frame_size)?,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The mixer rates that used to hard-fail the pipeline (44.1, 88.2, 96
    /// kHz) must now declare 48 kHz and let Windows resample; a 48 kHz
    /// mixer is left alone.
    #[test]
    fn declared_format_resamples_non_48k_mixers() {
        let native = declared_format(48_000, 8);
        assert_eq!(native.sample_rate, 48_000);
        assert_eq!(native.avg_bytes_per_sec, 48_000 * 8);
        assert!(!native.resampling);

        for rate in [44_100, 88_200, 96_000] {
            let declared = declared_format(rate, 8);
            assert_eq!(declared.sample_rate, 48_000, "mixer {rate}");
            assert_eq!(declared.avg_bytes_per_sec, 48_000 * 8, "mixer {rate}");
            assert!(declared.resampling, "mixer {rate}");
        }

        // mono pcm16 mixer: block align 2, rate still declared 48 kHz
        let mono = declared_format(44_100, 2);
        assert_eq!(mono.sample_rate, 48_000);
        assert_eq!(mono.avg_bytes_per_sec, 48_000 * 2);
        assert!(mono.resampling);
    }

    /// The device -> client-layout mapping: identity on equal counts, mono
    /// duplication, upmix (synthesized centre, silent LFE, fronts duplicated
    /// into the back/side channels) and downmix, with and without a device
    /// channel mask.
    #[test]
    fn channel_sources_map_device_to_client_layout() {
        use crate::audio::{layout_for, STEREO, SURROUND51, SURROUND71};
        use ChannelSource::{Device, Mix, Silence};
        let stereo = layout_for(STEREO);
        let surround51 = layout_for(SURROUND51);
        let surround71 = layout_for(SURROUND71);

        // equal counts: identity (the mask never changes that)
        assert_eq!(
            &channel_sources(2, None, stereo)[..2],
            &[Device(0), Device(1)]
        );
        assert_eq!(
            &channel_sources(2, Some(0x3), stereo)[..2],
            &[Device(0), Device(1)]
        );
        assert_eq!(
            &channel_sources(6, Some(0x3F), surround51)[..6],
            &[Device(0), Device(1), Device(2), Device(3), Device(4), Device(5)]
        );

        // mono device duplicates into every client channel
        assert_eq!(
            &channel_sources(1, Some(0x4), stereo)[..2],
            &[Device(0), Device(0)]
        );

        // 2 -> 6: fronts positional, centre synthesized, LFE silent, backs
        // duplicated from the fronts
        assert_eq!(
            &channel_sources(2, None, surround51)[..6],
            &[Device(0), Device(1), Mix(0, 1), Silence, Device(0), Device(1)]
        );
        assert_eq!(
            &channel_sources(2, Some(0x3), surround51)[..6],
            &[Device(0), Device(1), Mix(0, 1), Silence, Device(0), Device(1)]
        );
        // 2 -> 8: same rule, sides included
        assert_eq!(
            &channel_sources(2, None, surround71)[..8],
            &[
                Device(0),
                Device(1),
                Mix(0, 1),
                Silence,
                Device(0),
                Device(1),
                Device(0),
                Device(1)
            ]
        );
        // 6 -> 8: the device's own centre and LFE survive, only the missing
        // sides duplicate the fronts
        assert_eq!(
            &channel_sources(6, Some(0x3F), surround71)[..8],
            &[
                Device(0),
                Device(1),
                Device(2),
                Device(3),
                Device(4),
                Device(5),
                Device(0),
                Device(1)
            ]
        );
        // 4 -> 6: with an LFE present the LFE channel is kept, not silenced
        assert_eq!(
            &channel_sources(4, Some(0x3F), surround51)[..4],
            &[Device(0), Device(1), Device(2), Device(3)]
        );

        // a device that reports no front centre must not lend its third
        // channel to the centre (quad mask: FL, FR, BL, BR): the centre is
        // synthesized from the fronts instead
        let quad = channel_sources(4, Some(0x33), surround51);
        assert_eq!(quad[2], Mix(0, 1));
        // ... while a mask naming a front centre keeps the positional channel
        let positional = channel_sources(4, Some(0x3F), surround51);
        assert_eq!(positional[2], Device(2));

        // more device channels than the layout: the layout's fronts, positional
        assert_eq!(
            &channel_sources(6, Some(0x3F), stereo)[..2],
            &[Device(0), Device(1)]
        );
        assert_eq!(
            &channel_sources(8, Some(0x63F), surround51)[..6],
            &[Device(0), Device(1), Device(2), Device(3), Device(4), Device(5)]
        );

        // channels past the layout stay silent
        assert_eq!(
            &channel_sources(6, Some(0x3F), surround51)[6..],
            &[Silence, Silence]
        );
    }

    /// Applying the sources: FL/FR straight from the device, centre averaged,
    /// LFE silent, back left/right duplicated from the fronts.
    #[test]
    fn map_to_layout_applies_the_sources() {
        let sources = channel_sources(2, None, crate::audio::layout_for(crate::audio::SURROUND51));
        // two device frames: FL/FR = (0.0, 1.0) and (2.0, 3.0)
        let staging = [0.0f32, 1.0, 2.0, 3.0];
        let mapped = map_to_layout(&staging, 2, &sources, 6);
        assert_eq!(mapped.len(), 2 * 6);
        assert_eq!(&mapped[..6], &[0.0, 1.0, 0.5, 0.0, 0.0, 1.0]);
        assert_eq!(&mapped[6..], &[2.0, 3.0, 2.5, 0.0, 2.0, 3.0]);
    }
}
