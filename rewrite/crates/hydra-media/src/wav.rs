//! Short sound effects (`new Audio(url)` with `audio.volume`): a PCM WAV
//! decoded once, resampled to the output device and played on its own
//! thread, so the UI never waits on the audio device.

use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

/// Decoded interleaved samples in -1..1.
#[derive(Clone, Debug, PartialEq)]
pub struct Clip {
    pub rate: u32,
    pub channels: u16,
    pub samples: Vec<f32>,
}

impl Clip {
    pub fn duration(&self) -> Duration {
        let frames = self.samples.len() / self.channels.max(1) as usize;
        Duration::from_secs_f64(frames as f64 / self.rate.max(1) as f64)
    }

    /// Linear resampling and channel mapping (mono → all, extra channels dropped).
    pub fn convert(&self, rate: u32, channels: u16) -> Vec<f32> {
        let in_channels = self.channels.max(1) as usize;
        let out_channels = channels.max(1) as usize;
        let in_frames = self.samples.len() / in_channels;
        if in_frames == 0 {
            return Vec::new();
        }
        let out_frames = (in_frames as u64 * rate as u64 / self.rate.max(1) as u64) as usize;
        let step = self.rate as f64 / rate.max(1) as f64;
        let mut out = Vec::with_capacity(out_frames * out_channels);
        for frame in 0..out_frames {
            let position = frame as f64 * step;
            let index = (position as usize).min(in_frames - 1);
            let next = (index + 1).min(in_frames - 1);
            let fraction = (position - index as f64) as f32;
            for channel in 0..out_channels {
                let source = if in_channels == 1 {
                    0
                } else {
                    channel.min(in_channels - 1)
                };
                let a = self.samples[index * in_channels + source];
                let b = self.samples[next * in_channels + source];
                out.push(a + (b - a) * fraction);
            }
        }
        out
    }
}

/// A RIFF/WAVE file with 8, 16, 24 or 32-bit PCM or 32-bit float data.
pub fn decode_wav(bytes: &[u8]) -> Option<Clip> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let u16_at = |at: usize| Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?));
    let u32_at = |at: usize| Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?));
    let mut at = 12;
    let mut format = None;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let size = u32_at(at + 4)? as usize;
        let body = at + 8;
        if id == b"fmt " {
            format = Some((
                u16_at(body)?,
                u16_at(body + 2)?,
                u32_at(body + 4)?,
                u16_at(body + 14)?,
            ));
        } else if id == b"data" {
            let (kind, channels, rate, bits) = format?;
            let data = bytes.get(body..(body + size).min(bytes.len()))?;
            let samples: Vec<f32> = match (kind, bits) {
                (1, 8) => data.iter().map(|&b| (b as f32 - 128.0) / 128.0).collect(),
                (1, 16) => data
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|c| i16::from_le_bytes(*c) as f32 / 32768.0)
                    .collect(),
                (1, 24) => data
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .map(|c| (i32::from_le_bytes([0, c[0], c[1], c[2]]) >> 8) as f32 / 8_388_608.0)
                    .collect(),
                (1, 32) => data
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .map(|c| i32::from_le_bytes(*c) as f32 / 2_147_483_648.0)
                    .collect(),
                (3, 32) => data
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .map(|c| f32::from_le_bytes(*c))
                    .collect(),
                _ => return None,
            };
            return Some(Clip {
                rate,
                channels,
                samples,
            });
        }
        // chunks are word aligned
        at = body + size + (size & 1);
    }
    None
}

/// Plays a clip at `volume` (0..1, HTMLMediaElement.volume: a linear gain).
/// Returns at once; the device is opened and held on a worker thread.
pub fn play(clip: Arc<Clip>, volume: f32) {
    let volume = volume.clamp(0.0, 1.0);
    std::thread::Builder::new()
        .name("sound".into())
        .spawn(move || {
            let Some(device) = cpal::default_host().default_output_device() else {
                eprintln!("sound: no output device");
                return;
            };
            let Ok(config) = device.default_output_config() else {
                eprintln!("sound: no output config");
                return;
            };
            let rate = config.sample_rate();
            let channels = config.channels();
            let samples = clip.convert(rate, channels);
            let length = samples.len();
            let mut position = 0usize;
            let stream = device.build_output_stream(
                config.into(),
                move |out: &mut [f32], _| {
                    for sample in out.iter_mut() {
                        *sample = samples.get(position).map_or(0.0, |s| s * volume);
                        position += 1;
                    }
                },
                |error| eprintln!("sound: {error}"),
                None,
            );
            let stream = match stream {
                Ok(stream) => stream,
                Err(error) => {
                    eprintln!("sound: {error}");
                    return;
                }
            };
            if let Err(error) = stream.play() {
                eprintln!("sound: {error}");
                return;
            }
            let frames = length / channels.max(1) as usize;
            // the clip plus room for the device's buffer to drain
            std::thread::sleep(
                Duration::from_secs_f64(frames as f64 / rate.max(1) as f64)
                    + Duration::from_millis(250),
            );
            drop(stream);
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(channels: u16, rate: u32, samples: &[i16], junk: bool) -> Vec<u8> {
        let mut out = b"RIFF\0\0\0\0WAVE".to_vec();
        if junk {
            out.extend_from_slice(b"JUNK\x03\0\0\0abc\0");
        }
        out.extend_from_slice(b"fmt \x10\0\0\0");
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * channels as u32 * 2).to_le_bytes());
        out.extend_from_slice(&(channels * 2).to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&((samples.len() * 2) as u32).to_le_bytes());
        for s in samples {
            out.extend_from_slice(&s.to_le_bytes());
        }
        out
    }

    #[test]
    fn decodes_pcm16_past_junk_chunks() {
        let clip = decode_wav(&wav(2, 44_100, &[0, 16384, -32768, 32767], true)).unwrap();
        assert_eq!((clip.rate, clip.channels), (44_100, 2));
        assert_eq!(clip.samples.len(), 4);
        assert_eq!(clip.samples[1], 0.5);
        assert_eq!(clip.samples[2], -1.0);
        assert!(decode_wav(b"nope").is_none());
    }

    #[test]
    fn converts_rate_and_channels() {
        let clip = Clip {
            rate: 2,
            channels: 1,
            samples: vec![0.0, 1.0],
        };
        // 2 Hz → 4 Hz stereo: each frame twice, interpolated
        assert_eq!(
            clip.convert(4, 2),
            vec![0.0, 0.0, 0.5, 0.5, 1.0, 1.0, 1.0, 1.0]
        );
        assert_eq!(clip.duration(), Duration::from_secs(1));
    }

    #[test]
    fn decodes_the_achievement_sound() {
        let bytes = include_bytes!("../../../../resources/achievement.wav");
        let clip = decode_wav(bytes).unwrap();
        assert_eq!((clip.rate, clip.channels), (44_100, 2));
        assert!(clip.duration() > Duration::from_millis(500));
    }
}
