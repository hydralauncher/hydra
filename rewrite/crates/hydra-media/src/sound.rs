//! Short UI sounds (the screenshot shutter and error sounds, and later the
//! achievement sound): decoded once with FFmpeg into the output device's
//! rate as interleaved f32, played through cpal. Electron plays them with an
//! `Audio` element in a hidden window (`resources/screenshot-sound.html`);
//! `volume` is the element's linear volume.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ffmpeg_next as ff;

/// A decoded sound in the output device's format.
#[derive(Clone)]
pub struct Sound {
    samples: Arc<Vec<f32>>,
    rate: u32,
    channels: u16,
}

impl Sound {
    pub fn duration(&self) -> Duration {
        let frames = self.samples.len() / usize::from(self.channels.max(1));
        Duration::from_secs_f64(frames as f64 / f64::from(self.rate.max(1)))
    }
}

fn output_format() -> (u32, u16) {
    cpal::default_host()
        .default_output_device()
        .and_then(|device| device.default_output_config().ok())
        .map(|config| (config.sample_rate(), config.channels()))
        .unwrap_or((48_000, 2))
}

/// Decodes `path` (any format FFmpeg reads) for the default output device.
pub fn load(path: &Path) -> Result<Sound, String> {
    ff::init().map_err(|e| e.to_string())?;
    let (rate, channels) = output_format();
    let mut input = ff::format::input(&path).map_err(|e| e.to_string())?;
    let stream = input
        .streams()
        .best(ff::media::Type::Audio)
        .ok_or("no audio stream")?;
    let index = stream.index();
    let mut decoder = ff::codec::context::Context::from_parameters(stream.parameters())
        .map_err(|e| e.to_string())?
        .decoder()
        .audio()
        .map_err(|e| e.to_string())?;
    let stereo = if channels >= 2 { 2usize } else { 1 };
    let layout = if stereo == 2 {
        ff::ChannelLayout::STEREO
    } else {
        ff::ChannelLayout::MONO
    };
    let mut resampler = ff::software::resampling::Context::get(
        decoder.format(),
        decoder.channel_layout(),
        decoder.rate(),
        ff::format::Sample::F32(ff::format::sample::Type::Packed),
        layout,
        rate,
    )
    .map_err(|e| e.to_string())?;

    let mut samples = Vec::new();
    let mut push = |resampled: &ff::frame::Audio| {
        let bytes = &resampled.data(0)[..resampled.samples() * stereo * 4];
        for chunk in bytes.chunks_exact(4 * stereo) {
            let left = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            let right = if stereo == 2 {
                f32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]])
            } else {
                left
            };
            for c in 0..channels {
                samples.push(if c % 2 == 0 { left } else { right });
            }
        }
    };
    let mut decoded = ff::frame::Audio::empty();
    let mut resampled = ff::frame::Audio::empty();
    let mut drain = |decoder: &mut ff::decoder::Audio, push: &mut dyn FnMut(&ff::frame::Audio)| {
        while decoder.receive_frame(&mut decoded).is_ok() {
            if resampler.run(&decoded, &mut resampled).is_ok() {
                push(&resampled);
            }
        }
    };
    for (stream, packet) in input.packets() {
        if stream.index() != index {
            continue;
        }
        if decoder.send_packet(&packet).is_ok() {
            drain(&mut decoder, &mut push);
        }
    }
    let _ = decoder.send_eof();
    drain(&mut decoder, &mut push);
    if samples.is_empty() {
        return Err("the sound has no samples".into());
    }
    Ok(Sound {
        samples: Arc::new(samples),
        rate,
        channels,
    })
}

/// Plays `sound` once at `volume` (0..1) on a short-lived thread; returns
/// at once. Errors are logged (no output device, device busy).
pub fn play(sound: &Sound, volume: f32) {
    let sound = sound.clone();
    let volume = volume.clamp(0.0, 1.0);
    let _ = std::thread::Builder::new()
        .name("ui-sound".into())
        .spawn(move || {
            if let Err(error) = play_blocking(&sound, volume) {
                eprintln!("sound: {error}");
            }
        });
}

fn play_blocking(sound: &Sound, volume: f32) -> Result<(), String> {
    let device = cpal::default_host()
        .default_output_device()
        .ok_or("no audio output device")?;
    let config = cpal::StreamConfig {
        channels: sound.channels,
        sample_rate: sound.rate,
        buffer_size: cpal::BufferSize::Default,
    };
    let samples = sound.samples.clone();
    let mut position = 0usize;
    let stream = device
        .build_output_stream(
            config,
            move |out: &mut [f32], _| {
                for sample in out.iter_mut() {
                    *sample = samples.get(position).map_or(0.0, |s| s * volume);
                    position += 1;
                }
            },
            |error| eprintln!("sound: {error}"),
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    // the stream plays until dropped; give the device buffer time to drain
    std::thread::sleep(sound.duration() + Duration::from_millis(250));
    Ok(())
}
