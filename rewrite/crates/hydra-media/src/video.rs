//! Video playback (Steam trailers and any FFmpeg-readable URL/file).
//!
//! - A decode thread uses FFmpeg to open Steam's HLS stream, keep only the chosen
//!   rendition (+ audio), decode H.264 with the platform's hardware decoder
//!   (VideoToolbox / D3D11VA / DXVA2 / VAAPI / VDPAU; software fallback), and
//!   convert frames to RGB into `SharedPixelBuffer`s.
//! - Audio is resampled to the output device format and played through cpal.
//! - On the UI thread a presenter shows the frame that is due at the playback
//!   clock and feeds the `Playback` global (time, buffering, end, quality).
//!
//! Everything here is the same code on macOS, Windows and Linux; only the list
//! of hardware decoders to try differs.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ffmpeg_next as ff;
use slint::{Rgb8Pixel, SharedPixelBuffer};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

const MAX_FRAMES: usize = 6;
const AUDIO_AHEAD_SECONDS: f64 = 1.0;
/// Audio this far from the clock is dropped (late) or held back (early).
const AUDIO_SYNC_TOLERANCE: f64 = 0.06;

pub struct Frame {
    pub pts: f64,
    generation: u64,
    pub pixels: SharedPixelBuffer<Rgb8Pixel>,
}

/// Wall clock that only advances while playing and not stalled.
struct Clock {
    pts: f64,
    since: Option<Instant>,
}

impl Clock {
    fn now(&self) -> f64 {
        self.pts + self.since.map_or(0.0, |s| s.elapsed().as_secs_f64())
    }
    fn stop(&mut self) {
        self.pts = self.now();
        self.since = None;
    }
    fn start(&mut self) {
        if self.since.is_none() {
            self.since = Some(Instant::now());
        }
    }
    fn running(&self) -> bool {
        self.since.is_some()
    }
    fn set(&mut self, pts: f64) {
        self.pts = pts;
        if self.since.is_some() {
            self.since = Some(Instant::now());
        }
    }
}

struct AudioQueue {
    samples: VecDeque<f32>,
    /// Presentation time of `samples.front()`.
    front_pts: f64,
    generation: u64,
}

struct Shared {
    frames: Mutex<VecDeque<Frame>>,
    audio: Mutex<AudioQueue>,
    clock: Mutex<Clock>,
    generation: AtomicU64,
    stop: AtomicBool,
    /// Generation whose stream reached its end (u64::MAX = none).
    eof: AtomicU64,
    duration: Mutex<f64>,
    buffered_to: Mutex<f64>,
    active_height: AtomicU32,
    /// f32 bits; 0 when muted.
    volume: AtomicU32,
    out_rate: u32,
    out_channels: u16,
    decoder: Mutex<String>,
    error: Mutex<Option<String>>,
    /// Demuxed packets waiting to be decoded (the network read-ahead).
    packets: Mutex<VecDeque<Item>>,
    /// Set when a command is queued; aborts a blocked network read.
    command_pending: AtomicBool,
    /// Only packet reads may be interrupted (never opening or seeking).
    reading: AtomicBool,
}

/// Codec parameters + time base of the streams being played.
struct TrackParams {
    video: (ff::codec::Parameters, ff::Rational),
    audio: Option<(ff::codec::Parameters, ff::Rational)>,
}

/// What the demux thread hands to the decode thread.
enum Item {
    /// New streams (start, rendition switch): rebuild the decoders.
    Tracks {
        generation: u64,
        params: TrackParams,
        skip_until: f64,
    },
    /// Seek: flush the decoders and drop frames before `skip_until`.
    Flush {
        generation: u64,
        skip_until: f64,
    },
    Packet {
        generation: u64,
        video: bool,
        packet: ff::Packet,
    },
    End {
        generation: u64,
    },
}

enum Command {
    Seek(f64),
    Quality(u32),
}

/// One open trailer. Dropping it stops the decode thread and the audio output.
pub struct Session {
    pub index: i32,
    shared: Arc<Shared>,
    tx: mpsc::Sender<Command>,
    _audio: Option<cpal::Stream>,
    playing: bool,
    stalled: bool,
    needs_first_frame: bool,
    seek_target: f64,
    shown_generation: u64,
    started_at: Instant,
    logged_start: bool,
}

pub struct Status {
    pub time: f64,
    pub duration: f64,
    pub buffered_to: f64,
    pub waiting: bool,
    pub ended: bool,
    pub active_height: u32,
    pub frame: Option<SharedPixelBuffer<Rgb8Pixel>>,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.shared.stop.store(true, Ordering::SeqCst);
    }
}

impl Session {
    /// `quality`: 0 = automatic (pick by `auto_height`), otherwise a rendition height.
    pub fn open(index: i32, url: String, quality: u32, auto_height: u32, volume: f32) -> Session {
        let audio_config = cpal::default_host()
            .default_output_device()
            .and_then(|d| d.default_output_config().ok().map(|c| (d, c)));
        let (out_rate, out_channels) = audio_config
            .as_ref()
            .map(|(_, c)| (c.sample_rate(), c.channels()))
            .unwrap_or((48_000, 2));

        let shared = Arc::new(Shared {
            frames: Mutex::new(VecDeque::new()),
            audio: Mutex::new(AudioQueue {
                samples: VecDeque::new(),
                front_pts: 0.0,
                generation: 0,
            }),
            clock: Mutex::new(Clock {
                pts: 0.0,
                since: None,
            }),
            generation: AtomicU64::new(0),
            stop: AtomicBool::new(false),
            eof: AtomicU64::new(u64::MAX),
            duration: Mutex::new(0.0),
            buffered_to: Mutex::new(0.0),
            active_height: AtomicU32::new(0),
            volume: AtomicU32::new(volume.to_bits()),
            out_rate,
            out_channels,
            decoder: Mutex::new(String::new()),
            error: Mutex::new(None),
            packets: Mutex::new(VecDeque::new()),
            command_pending: AtomicBool::new(false),
            reading: AtomicBool::new(false),
        });

        let audio = audio_config
            .and_then(|(device, config)| start_audio(&device, &config.into(), shared.clone()));

        // Network/demux and decoding run on separate threads, so a segment
        // download never starves the decoder.
        let (tx, rx) = mpsc::channel();
        let demux_shared = shared.clone();
        std::thread::Builder::new()
            .name("video-demux".into())
            .spawn(move || {
                if let Err(err) = demux_loop(&url, &demux_shared, &rx, quality, auto_height)
                    && !demux_shared.stop.load(Ordering::SeqCst)
                {
                    eprintln!("video: {err}");
                    *demux_shared.error.lock().unwrap() = Some(err);
                }
            })
            .expect("spawn demux thread");
        let decode_shared = shared.clone();
        std::thread::Builder::new()
            .name("video-decode".into())
            .spawn(move || decode_thread(&decode_shared))
            .expect("spawn decode thread");

        Session {
            index,
            shared,
            tx,
            _audio: audio,
            playing: false,
            stalled: true,
            needs_first_frame: true,
            seek_target: 0.0,
            shown_generation: 0,
            started_at: Instant::now(),
            logged_start: false,
        }
    }

    pub fn play(&mut self) {
        self.playing = true;
        if !self.stalled {
            self.shared.clock.lock().unwrap().start();
        }
    }

    pub fn pause(&mut self) {
        self.playing = false;
        self.shared.clock.lock().unwrap().stop();
    }

    pub fn seek(&mut self, seconds: f64) {
        let duration = *self.shared.duration.lock().unwrap();
        let target = if duration > 0.0 {
            seconds.clamp(0.0, (duration - 0.1).max(0.0))
        } else {
            seconds.max(0.0)
        };
        self.begin_reposition(target);
        self.shared.command_pending.store(true, Ordering::SeqCst);
        let _ = self.tx.send(Command::Seek(target));
    }

    pub fn set_quality(&mut self, height: u32) {
        let now = self.shared.clock.lock().unwrap().now();
        self.begin_reposition(now);
        self.shared.command_pending.store(true, Ordering::SeqCst);
        let _ = self.tx.send(Command::Quality(height));
    }

    pub fn set_volume(&self, volume: f32) {
        self.shared
            .volume
            .store(volume.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
    }

    fn begin_reposition(&mut self, target: f64) {
        // Frames from before the reposition are stale; wait for new ones.
        self.shared.generation.fetch_add(1, Ordering::SeqCst);
        self.shared.frames.lock().unwrap().clear();
        let mut clock = self.shared.clock.lock().unwrap();
        clock.stop();
        clock.set(target);
        self.stalled = true;
        self.needs_first_frame = true;
        self.seek_target = target;
        self.started_at = Instant::now();
        self.logged_start = std::env::var_os("HYDRA_VIDEO_STATS").is_none();
    }

    /// Called from a UI timer: pick the due frame and report state.
    pub fn tick(&mut self) -> Status {
        let generation = self.shared.generation.load(Ordering::SeqCst);
        // Only an end reached after the latest seek counts.
        let eof = self.shared.eof.load(Ordering::SeqCst) == generation;
        let mut frames = self.shared.frames.lock().unwrap();
        frames.retain(|f| f.generation == generation);

        // Buffering: stall the clock when the queue runs dry, resume once refilled.
        if self.playing {
            if !self.stalled && frames.is_empty() && !eof {
                self.stalled = true;
                self.shared.clock.lock().unwrap().stop();
            } else if self.stalled
                && (frames.len() >= 3
                    || (eof && !frames.is_empty())
                    || (eof && !self.needs_first_frame))
            {
                self.stalled = false;
                self.shared.clock.lock().unwrap().start();
            }
        } else if self.stalled && !frames.is_empty() {
            self.stalled = false;
        }

        let mut shown = None;
        if self.needs_first_frame {
            // After open/seek, show the first decoded frame right away (also while paused).
            if let Some(first) = frames.pop_front() {
                self.shared
                    .clock
                    .lock()
                    .unwrap()
                    .set(first.pts.max(self.seek_target));
                shown = Some(first.pixels);
                self.needs_first_frame = false;
                self.shown_generation = generation;
                if !self.logged_start {
                    self.logged_start = true;
                    eprintln!(
                        "video: first frame {:.0} ms after open/seek ({}, {}p)",
                        self.started_at.elapsed().as_secs_f64() * 1000.0,
                        self.shared.decoder.lock().unwrap(),
                        self.shared.active_height.load(Ordering::Relaxed)
                    );
                }
            }
        } else {
            let now = self.shared.clock.lock().unwrap().now();
            while frames.front().is_some_and(|f| f.pts <= now) {
                shown = frames.pop_front().map(|f| f.pixels);
            }
        }
        drop(frames);

        let duration = *self.shared.duration.lock().unwrap();
        let time = self.shared.clock.lock().unwrap().now();
        let drained = eof && self.shared.frames.lock().unwrap().is_empty();
        // Also covers a seek that lands past the last frame (no frame ever arrives).
        let ended =
            drained && (self.needs_first_frame || duration <= 0.0 || time >= duration - 0.25);
        if ended {
            self.needs_first_frame = false;
        }
        if ended && self.shared.clock.lock().unwrap().running() {
            self.shared.clock.lock().unwrap().stop();
        }

        Status {
            time: if duration > 0.0 {
                time.min(duration)
            } else {
                time
            },
            duration,
            buffered_to: *self.shared.buffered_to.lock().unwrap(),
            waiting: (self.playing && self.stalled && !ended)
                || (self.needs_first_frame
                    && !drained
                    && self.shared.error.lock().unwrap().is_none()),
            ended,
            active_height: self.shared.active_height.load(Ordering::Relaxed),
            frame: shown,
        }
    }
}

fn start_audio(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    shared: Arc<Shared>,
) -> Option<cpal::Stream> {
    let channels = config.channels as usize;
    let rate = config.sample_rate as f64;
    let stream = device
        .build_output_stream(
            *config,
            move |out: &mut [f32], _| {
                out.fill(0.0);
                let clock = shared.clock.lock().unwrap();
                if !clock.running() {
                    return;
                }
                let now = clock.now();
                drop(clock);
                let volume = f32::from_bits(shared.volume.load(Ordering::Relaxed));
                let generation = shared.generation.load(Ordering::SeqCst);
                let mut queue = shared.audio.lock().unwrap();
                if queue.generation != generation {
                    return;
                }
                let per_second = rate * channels as f64;
                // Late audio: drop it so sound catches up with the picture.
                if queue.front_pts < now - AUDIO_SYNC_TOLERANCE {
                    let behind =
                        ((now - queue.front_pts) * per_second) as usize / channels * channels;
                    let drop = behind.min(queue.samples.len());
                    queue.samples.drain(..drop);
                    queue.front_pts += drop as f64 / per_second;
                }
                // Early audio: hold it back (silence) until the picture gets there.
                if queue.front_pts > now + AUDIO_SYNC_TOLERANCE {
                    return;
                }
                let n = out.len().min(queue.samples.len());
                for (dst, src) in out.iter_mut().zip(queue.samples.drain(..n)) {
                    *dst = src * volume;
                }
                queue.front_pts += n as f64 / per_second;
            },
            |err| eprintln!("audio: {err}"),
            None,
        )
        .ok()?;
    stream.play().ok()?;
    Some(stream)
}

fn seconds(ts: Option<i64>, time_base: ff::Rational) -> Option<f64> {
    ts.map(|t| t as f64 * f64::from(time_base))
}

/// Attach the platform hardware decoder to an unopened codec context.
fn attach_hardware(ctx: &mut ff::codec::context::Context) -> Option<&'static str> {
    use ff::ffi::{AVHWDeviceType, av_buffer_ref, av_buffer_unref, av_hwdevice_ctx_create};
    let candidates: &[(AVHWDeviceType, &str)] = &[
        #[cfg(target_os = "macos")]
        (
            AVHWDeviceType::AV_HWDEVICE_TYPE_VIDEOTOOLBOX,
            "VideoToolbox",
        ),
        #[cfg(target_os = "windows")]
        (AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA, "D3D11VA"),
        #[cfg(target_os = "windows")]
        (AVHWDeviceType::AV_HWDEVICE_TYPE_DXVA2, "DXVA2"),
        #[cfg(target_os = "linux")]
        (AVHWDeviceType::AV_HWDEVICE_TYPE_VAAPI, "VAAPI"),
        #[cfg(target_os = "linux")]
        (AVHWDeviceType::AV_HWDEVICE_TYPE_VDPAU, "VDPAU"),
    ];
    for (kind, name) in candidates {
        unsafe {
            let mut device = std::ptr::null_mut();
            if av_hwdevice_ctx_create(
                &mut device,
                *kind,
                std::ptr::null(),
                std::ptr::null_mut(),
                0,
            ) >= 0
            {
                (*ctx.as_mut_ptr()).hw_device_ctx = av_buffer_ref(device);
                av_buffer_unref(&mut device);
                return Some(name);
            }
        }
    }
    None
}

/// Hardware frames live in GPU memory; copy them to system memory (NV12).
fn download(frame: ff::frame::Video) -> ff::frame::Video {
    unsafe {
        if (*frame.as_ptr()).hw_frames_ctx.is_null() {
            return frame;
        }
        let mut software = ff::frame::Video::empty();
        if ff::ffi::av_hwframe_transfer_data(software.as_mut_ptr(), frame.as_ptr(), 0) < 0 {
            return frame;
        }
        software.set_pts(frame.pts());
        (*software.as_mut_ptr()).best_effort_timestamp = (*frame.as_ptr()).best_effort_timestamp;
        software
    }
}

struct VideoTrack {
    time_base: ff::Rational,
    decoder: ff::decoder::Video,
    scaler: Option<(ff::format::Pixel, u32, u32, ff::software::scaling::Context)>,
}

struct AudioTrack {
    time_base: ff::Rational,
    decoder: ff::decoder::Audio,
    resampler: ff::software::resampling::Context,
}

/// Read a (small) URL fully with FFmpeg's own I/O, so no second HTTP/TLS stack is needed.
fn fetch_text(url: &str) -> Option<String> {
    use std::ffi::CString;
    unsafe {
        let c_url = CString::new(url).ok()?;
        let mut io = std::ptr::null_mut();
        if ff::ffi::avio_open2(
            &mut io,
            c_url.as_ptr(),
            ff::ffi::AVIO_FLAG_READ,
            std::ptr::null(),
            std::ptr::null_mut(),
        ) < 0
        {
            return None;
        }
        let mut out = Vec::new();
        let mut buf = [0u8; 16 * 1024];
        loop {
            let n = ff::ffi::avio_read(io, buf.as_mut_ptr(), buf.len() as i32);
            if n <= 0 {
                break;
            }
            out.extend_from_slice(&buf[..n as usize]);
        }
        ff::ffi::avio_closep(&mut io);
        String::from_utf8(out).ok()
    }
}

/// An HLS master playlist reduced to what we need.
struct Master {
    audio: Option<String>,
    /// (height, STREAM-INF line, absolute URI)
    variants: Vec<(u32, String, String)>,
    header: Vec<String>,
}

fn parse_master(url: &str, text: &str) -> Option<Master> {
    if !text.contains("#EXT-X-STREAM-INF") {
        return None;
    }
    let base = url.split('?').next().unwrap_or(url);
    let base = &base[..base.rfind('/').map_or(0, |i| i + 1)];
    let absolute = |uri: &str| {
        if uri.contains("://") {
            uri.to_string()
        } else {
            format!("{base}{uri}")
        }
    };
    let mut master = Master {
        audio: None,
        variants: Vec::new(),
        header: Vec::new(),
    };
    let mut pending: Option<String> = None;
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if let Some(info) = pending.take() {
            let height = info
                .split("RESOLUTION=")
                .nth(1)
                .and_then(|r| r.split([',', '\n']).next())
                .and_then(|r| r.split('x').nth(1))
                .and_then(|h| h.parse().ok())
                .unwrap_or(0);
            master.variants.push((height, info, absolute(line)));
        } else if line.starts_with("#EXT-X-STREAM-INF") {
            pending = Some(line.to_string());
        } else if line.starts_with("#EXT-X-MEDIA") && line.contains("TYPE=AUDIO") {
            let uri = line
                .split("URI=\"")
                .nth(1)
                .and_then(|r| r.split('"').next())
                .unwrap_or_default();
            master.audio = Some(line.replace(
                &format!("URI=\"{uri}\""),
                &format!("URI=\"{}\"", absolute(uri)),
            ));
        } else if line.starts_with("#EXTM3U")
            || line.starts_with("#EXT-X-VERSION")
            || line.starts_with("#EXT-X-INDEPENDENT")
        {
            master.header.push(line.to_string());
        }
    }
    master.variants.sort_by_key(|(h, _, _)| *h);
    (!master.variants.is_empty()).then_some(master)
}

/// Windows: FFmpeg's TLS (OpenSSL) has no CA store of its own. Export the
/// system's trusted roots to a PEM file and point OpenSSL at it
/// (`SSL_CERT_FILE`). Call once at startup, before any other thread runs.
#[cfg(windows)]
pub fn prepare_tls(cache_dir: &std::path::Path) {
    use std::fmt::Write as _;
    if std::env::var_os("SSL_CERT_FILE").is_some() {
        return;
    }
    let certs = rustls_native_certs::load_native_certs();
    let mut pem = String::new();
    for cert in certs.certs {
        let encoded = base64_encode(cert.as_ref());
        pem.push_str("-----BEGIN CERTIFICATE-----\n");
        for line in encoded.as_bytes().chunks(64) {
            let _ = writeln!(pem, "{}", std::str::from_utf8(line).unwrap_or_default());
        }
        pem.push_str("-----END CERTIFICATE-----\n");
    }
    let path = cache_dir.join("ca-bundle.pem");
    if std::fs::create_dir_all(cache_dir).is_ok() && std::fs::write(&path, pem).is_ok() {
        // OpenSSL reads the C runtime's copy of the environment (getenv), which
        // SetEnvironmentVariableW (std::env::set_var) doesn't update.
        unsafe extern "C" {
            fn _putenv_s(name: *const std::ffi::c_char, value: *const std::ffi::c_char) -> i32;
        }
        let value = std::ffi::CString::new(path.to_string_lossy().as_bytes()).unwrap_or_default();
        // SAFETY: called on the main thread before workers start.
        unsafe {
            std::env::set_var("SSL_CERT_FILE", &path);
            _putenv_s(c"SSL_CERT_FILE".as_ptr(), value.as_ptr());
        }
    }
}

#[cfg(not(windows))]
pub fn prepare_tls(_cache_dir: &std::path::Path) {}

#[cfg(windows)]
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16
            | (*chunk.get(1).unwrap_or(&0) as u32) << 8
            | *chunk.get(2).unwrap_or(&0) as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn open_url(
    url: &str,
    shared: &Arc<Shared>,
    local_playlist: bool,
) -> Result<ff::format::context::Input, String> {
    let mut options = ff::Dictionary::new();
    options.set("probesize", "65536");
    options.set("analyzeduration", "500000");
    options.set("fpsprobesize", "0");
    // Never hang forever on a dead connection.
    options.set("rw_timeout", "10000000");
    if local_playlist {
        options.set(
            "protocol_whitelist",
            "file,http,https,tcp,tls,crypto,data,httpproxy",
        );
    }
    let flags = shared.clone();
    // Only a blocked packet read is interrupted by a new command.
    let interrupt = move || {
        flags.stop.load(Ordering::SeqCst)
            || (flags.reading.load(Ordering::SeqCst)
                && flags.command_pending.load(Ordering::SeqCst))
    };
    ff::format::input_with_interrupt_and_dictionary(&url, interrupt, options)
        .map_err(|e| format!("{url}: {e}"))
}

/// An HLS media playlist (one rendition), parsed so we can start at any segment.
struct MediaPlaylist {
    /// Header lines (version, target duration, absolute EXT-X-MAP init segment).
    header: Vec<String>,
    /// (start time, EXTINF line, absolute URI)
    segments: Vec<(f64, String, String)>,
}

impl MediaPlaylist {
    fn fetch(url: &str) -> Option<MediaPlaylist> {
        let text = fetch_text(url)?;
        let base = url.split('?').next().unwrap_or(url);
        let base = &base[..base.rfind('/').map_or(0, |i| i + 1)];
        let absolute = |uri: &str| {
            if uri.contains("://") {
                uri.to_string()
            } else {
                format!("{base}{uri}")
            }
        };
        let mut playlist = MediaPlaylist {
            header: Vec::new(),
            segments: Vec::new(),
        };
        let mut start = 0.0;
        let mut pending: Option<(String, f64)> = None;
        for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
            if let Some(extinf) = line.strip_prefix("#EXTINF:") {
                let duration = extinf
                    .split(',')
                    .next()
                    .and_then(|d| d.parse().ok())
                    .unwrap_or(0.0);
                pending = Some((line.to_string(), duration));
            } else if !line.starts_with('#') {
                if let Some((extinf, duration)) = pending.take() {
                    playlist.segments.push((start, extinf, absolute(line)));
                    start += duration;
                }
            } else if let Some(map) = line.strip_prefix("#EXT-X-MAP:URI=\"") {
                let uri = map.split('"').next().unwrap_or_default();
                playlist
                    .header
                    .push(format!("#EXT-X-MAP:URI=\"{}\"", absolute(uri)));
            } else if !line.starts_with("#EXT-X-MEDIA-SEQUENCE")
                && !line.starts_with("#EXT-X-ENDLIST")
            {
                playlist.header.push(line.to_string());
            }
        }
        (!playlist.segments.is_empty()).then_some(playlist)
    }

    /// Write a playlist that starts at the segment containing `time`.
    /// Returns (path, start time of that segment).
    fn starting_at(&self, time: f64, tag: &str) -> Result<(String, f64), String> {
        let index = self
            .segments
            .iter()
            .rposition(|(start, _, _)| *start <= time + 1e-3)
            .unwrap_or(0);
        let mut lines = self.header.clone();
        lines.push(format!("#EXT-X-MEDIA-SEQUENCE:{index}"));
        for (_, extinf, uri) in &self.segments[index..] {
            lines.push(extinf.clone());
            lines.push(uri.clone());
        }
        lines.push("#EXT-X-ENDLIST".to_string());
        let path =
            std::env::temp_dir().join(format!("hydra-video-{}-{tag}.m3u8", std::process::id()));
        std::fs::write(&path, lines.join("\n") + "\n").map_err(|e| e.to_string())?;
        Ok((path.to_string_lossy().into_owned(), self.segments[index].0))
    }
}

/// One FFmpeg input. For HLS, video and audio renditions are separate inputs,
/// and seeking never uses FFmpeg's HLS seek (unreliable on these fMP4
/// playlists): we reopen on a playlist that starts at the right segment and
/// drop decoded frames before the target.
struct Source {
    url: String,
    tag: &'static str,
    playlist: Option<MediaPlaylist>,
    input: ff::format::context::Input,
    video: Option<(usize, ff::Rational)>,
    audio: Option<(usize, ff::Rational)>,
    read_to: f64,
    eof: bool,
    interrupted: bool,
}

impl Source {
    fn open(
        url: &str,
        tag: &'static str,
        shared: &Arc<Shared>,
        want_video: bool,
        want_audio: bool,
    ) -> Result<Source, String> {
        let playlist = MediaPlaylist::fetch(url);
        let input = match &playlist {
            Some(p) => open_url(&p.starting_at(0.0, tag)?.0, shared, true)?,
            None => open_url(url, shared, false)?,
        };
        Ok(Source::from_input(
            url, tag, playlist, input, want_video, want_audio,
        ))
    }

    fn from_input(
        url: &str,
        tag: &'static str,
        playlist: Option<MediaPlaylist>,
        input: ff::format::context::Input,
        want_video: bool,
        want_audio: bool,
    ) -> Source {
        let video = if want_video {
            input
                .streams()
                .best(ff::media::Type::Video)
                .map(|s| (s.index(), s.time_base()))
        } else {
            None
        };
        let audio = if want_audio {
            input
                .streams()
                .best(ff::media::Type::Audio)
                .map(|s| (s.index(), s.time_base()))
        } else {
            None
        };
        Source {
            url: url.to_string(),
            tag,
            playlist,
            input,
            video,
            audio,
            read_to: 0.0,
            eof: false,
            interrupted: false,
        }
    }

    fn params(&self, index: usize) -> Option<ff::codec::Parameters> {
        // clone() makes owned copies that can move to the decode thread.
        self.input.stream(index).map(|s| s.parameters().clone())
    }

    fn duration(&self) -> f64 {
        match &self.playlist {
            Some(p) => p.segments.last().map_or(0.0, |(start, extinf, _)| {
                start
                    + extinf
                        .trim_start_matches("#EXTINF:")
                        .split(',')
                        .next()
                        .and_then(|d| d.parse::<f64>().ok())
                        .unwrap_or(0.0)
            }),
            None => (self.input.duration() as f64 / f64::from(ff::ffi::AV_TIME_BASE)).max(0.0),
        }
    }

    fn seek(&mut self, target: f64, shared: &Arc<Shared>) -> Result<(), String> {
        match &self.playlist {
            Some(playlist) => {
                let (path, start) = playlist.starting_at(target, self.tag)?;
                self.input = open_url(&path, shared, true)?;
                self.read_to = start;
            }
            None => {
                let ts = (target * f64::from(ff::ffi::AV_TIME_BASE)) as i64;
                self.input.seek(ts, ..ts).map_err(|e| e.to_string())?;
                self.read_to = target;
            }
        }
        self.eof = false;
        self.interrupted = false;
        Ok(())
    }
}

fn pick_variant(master: &Master, wanted_height: u32) -> (u32, String) {
    master
        .variants
        .iter()
        .find(|(h, _, _)| *h >= wanted_height)
        .or(master.variants.last())
        .map(|(h, _, uri)| (*h, uri.clone()))
        .unwrap_or_default()
}

/// Audio playlist URI from the master's EXT-X-MEDIA line.
fn audio_uri(master: &Master) -> Option<String> {
    master
        .audio
        .as_ref()?
        .split("URI=\"")
        .nth(1)?
        .split('"')
        .next()
        .map(str::to_string)
}

fn tracks_of(sources: &[Source]) -> Option<TrackParams> {
    let video = sources
        .iter()
        .find_map(|s| s.video.and_then(|(i, tb)| s.params(i).map(|p| (p, tb))))?;
    let audio = sources
        .iter()
        .find_map(|s| s.audio.and_then(|(i, tb)| s.params(i).map(|p| (p, tb))));
    Some(TrackParams { video, audio })
}

/// Network read-ahead: keep this much demuxed (not yet decoded) media queued.
const READ_AHEAD_SECONDS: f64 = 15.0;

/// Demux thread: owns the network inputs, handles seeks and rendition
/// switches, and keeps READ_AHEAD_SECONDS of packets queued.
fn demux_loop(
    url: &str,
    shared: &Arc<Shared>,
    rx: &mpsc::Receiver<Command>,
    quality: u32,
    auto_height: u32,
) -> Result<(), String> {
    ff::init().map_err(|e| e.to_string())?;
    ff::log::set_level(ff::log::Level::Error);

    let opened = Instant::now();
    let master = fetch_text(url).and_then(|text| parse_master(url, &text));
    let mut sources = match master.as_ref() {
        Some(m) => {
            let (height, variant) =
                pick_variant(m, if quality > 0 { quality } else { auto_height });
            shared.active_height.store(height, Ordering::Relaxed);
            let separate_audio = audio_uri(m);
            let mut sources = vec![Source::open(
                &variant,
                "video",
                shared,
                true,
                separate_audio.is_none(),
            )?];
            if let Some(audio) = separate_audio {
                sources.push(Source::open(&audio, "audio", shared, false, true)?);
            }
            sources
        }
        None => vec![Source::open(url, "file", shared, true, true)?],
    };
    let duration = sources.iter().map(Source::duration).fold(0.0, f64::max);
    *shared.duration.lock().unwrap() = duration;
    let mut generation = shared.generation.load(Ordering::SeqCst);
    let params = tracks_of(&sources).ok_or("no video stream")?;
    shared.packets.lock().unwrap().push_back(Item::Tracks {
        generation,
        params,
        skip_until: 0.0,
    });
    eprintln!(
        "video: opened {} in {:.0} ms ({} inputs, {} renditions available)",
        if master.is_some() { "HLS" } else { "file" },
        opened.elapsed().as_secs_f64() * 1000.0,
        sources.len(),
        master.as_ref().map_or(1, |m| m.variants.len())
    );
    let mut ended_pushed = false;
    let stats_enabled = std::env::var_os("HYDRA_VIDEO_STATS").is_some();
    let (mut stats_at, mut cpu_at) = (Instant::now(), thread_cpu_seconds());

    loop {
        if shared.stop.load(Ordering::SeqCst) {
            return Ok(());
        }
        if stats_enabled && stats_at.elapsed() >= Duration::from_secs(5) {
            let wall = stats_at.elapsed().as_secs_f64();
            eprintln!(
                "video stats: demux/network thread {:.1}% of a core",
                (thread_cpu_seconds() - cpu_at) / wall * 100.0
            );
            (stats_at, cpu_at) = (Instant::now(), thread_cpu_seconds());
        }

        // Commands: only the last seek / rendition request matters.
        if shared.command_pending.swap(false, Ordering::SeqCst) {
            let mut target = None;
            let mut new_height = None;
            while let Ok(command) = rx.try_recv() {
                match command {
                    Command::Seek(t) => target = Some(t),
                    Command::Quality(h) => new_height = Some(h),
                }
            }
            let target = target.unwrap_or_else(|| shared.clock.lock().unwrap().now());
            let mut tracks_changed = false;
            if let (Some(h), Some(m)) = (new_height, master.as_ref()) {
                let (height, variant) = pick_variant(m, h.max(1));
                let has_audio = sources[0].audio.is_some();
                sources[0] = Source::open(&variant, "video", shared, true, has_audio)?;
                shared.active_height.store(height, Ordering::Relaxed);
                tracks_changed = true;
            }
            let mut failed = None;
            for source in sources.iter_mut() {
                if source.playlist.is_none() && (source.interrupted || source.eof) {
                    // A progressive file reader that was interrupted: start fresh.
                    let (want_video, want_audio) = (source.video.is_some(), source.audio.is_some());
                    *source = Source::open(
                        &source.url.clone(),
                        source.tag,
                        shared,
                        want_video,
                        want_audio,
                    )?;
                }
                if let Err(err) = source.seek(target, shared) {
                    failed = Some(err);
                }
            }
            if let Some(err) = failed {
                if shared.command_pending.load(Ordering::SeqCst) {
                    continue; // superseded by a newer command
                }
                return Err(err);
            }
            generation = shared.generation.load(Ordering::SeqCst);
            let skip_until = target - 0.02;
            let item = match tracks_changed.then(|| tracks_of(&sources)).flatten() {
                Some(params) => Item::Tracks {
                    generation,
                    params,
                    skip_until,
                },
                None => Item::Flush {
                    generation,
                    skip_until,
                },
            };
            let mut packets = shared.packets.lock().unwrap();
            packets.clear();
            packets.push_back(item);
            drop(packets);
            *shared.buffered_to.lock().unwrap() = target;
            ended_pushed = false;
            continue;
        }

        // Read from whichever input is furthest behind, up to the read-ahead.
        let now = shared.clock.lock().unwrap().now();
        let next = sources
            .iter()
            .enumerate()
            .filter(|(_, s)| !s.eof && s.read_to - now < READ_AHEAD_SECONDS)
            .min_by(|a, b| a.1.read_to.total_cmp(&b.1.read_to))
            .map(|(i, _)| i);
        let Some(i) = next.filter(|_| shared.packets.lock().unwrap().len() < 8192) else {
            if !ended_pushed && sources.iter().all(|s| s.eof) {
                ended_pushed = true;
                *shared.buffered_to.lock().unwrap() = duration;
                shared
                    .packets
                    .lock()
                    .unwrap()
                    .push_back(Item::End { generation });
            }
            std::thread::sleep(Duration::from_millis(5));
            continue;
        };

        let source = &mut sources[i];
        let mut packet = ff::Packet::empty();
        shared.reading.store(true, Ordering::SeqCst);
        let result = packet.read(&mut source.input);
        shared.reading.store(false, Ordering::SeqCst);
        match result {
            Ok(()) => {
                let index = packet.stream();
                let kind = match (source.video, source.audio) {
                    (Some((v, tb)), _) if v == index => Some((true, tb)),
                    (_, Some((a, tb))) if a == index => Some((false, tb)),
                    _ => None,
                };
                let Some((video, time_base)) = kind else {
                    continue;
                };
                if let Some(ts) = packet.pts().or(packet.dts()) {
                    source.read_to = source.read_to.max(ts as f64 * f64::from(time_base));
                }
                let buffered = sources
                    .iter()
                    .map(|s| if s.eof { duration } else { s.read_to })
                    .fold(f64::MAX, f64::min);
                *shared.buffered_to.lock().unwrap() = buffered;
                shared.packets.lock().unwrap().push_back(Item::Packet {
                    generation,
                    video,
                    packet,
                });
            }
            Err(ff::Error::Eof) => source.eof = true,
            Err(_) if shared.command_pending.load(Ordering::SeqCst) => source.interrupted = true,
            Err(ff::Error::Other { errno }) if errno == ff::ffi::EAGAIN => {
                std::thread::sleep(Duration::from_millis(2))
            }
            Err(err) => return Err(err.to_string()),
        }
    }
}

fn build_video(
    params: &(ff::codec::Parameters, ff::Rational),
    shared: &Shared,
) -> Option<VideoTrack> {
    let mut ctx = ff::codec::context::Context::from_parameters(params.0.clone()).ok()?;
    let hardware = attach_hardware(&mut ctx);
    let decoder = ctx.decoder().video().ok()?;
    *shared.decoder.lock().unwrap() = hardware.map_or("software".to_string(), |h| h.to_string());
    if shared.active_height.load(Ordering::Relaxed) == 0 {
        shared
            .active_height
            .store(decoder.height(), Ordering::Relaxed);
    }
    Some(VideoTrack {
        time_base: params.1,
        decoder,
        scaler: None,
    })
}

fn build_audio(
    params: &(ff::codec::Parameters, ff::Rational),
    shared: &Shared,
) -> Option<AudioTrack> {
    let decoder = ff::codec::context::Context::from_parameters(params.0.clone())
        .ok()?
        .decoder()
        .audio()
        .ok()?;
    let layout = if shared.out_channels >= 2 {
        ff::ChannelLayout::STEREO
    } else {
        ff::ChannelLayout::MONO
    };
    let resampler = ff::software::resampling::Context::get(
        decoder.format(),
        decoder.channel_layout(),
        decoder.rate(),
        ff::format::Sample::F32(ff::format::sample::Type::Packed),
        layout,
        shared.out_rate,
    )
    .ok()?;
    Some(AudioTrack {
        time_base: params.1,
        decoder,
        resampler,
    })
}

/// CPU time used by the calling thread, in seconds.
#[cfg(unix)]
fn thread_cpu_seconds() -> f64 {
    let mut ts = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut ts) };
    ts.tv_sec as f64 + ts.tv_nsec as f64 / 1e9
}

/// CPU time used by the calling thread, in seconds.
#[cfg(windows)]
fn thread_cpu_seconds() -> f64 {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::{GetCurrentThread, GetThreadTimes};
    let zero = || FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let (mut created, mut exited, mut kernel, mut user) = (zero(), zero(), zero(), zero());
    unsafe {
        GetThreadTimes(
            GetCurrentThread(),
            &mut created,
            &mut exited,
            &mut kernel,
            &mut user,
        )
    };
    let ticks = |t: FILETIME| ((t.dwHighDateTime as u64) << 32 | t.dwLowDateTime as u64) as f64;
    // FILETIME counts 100 ns intervals.
    (ticks(kernel) + ticks(user)) / 1e7
}

/// `HYDRA_VIDEO_STATS=1`: log decode-thread CPU and per-frame cost every 5s.
struct Stats {
    enabled: bool,
    since: Instant,
    cpu_at: f64,
    frames: u32,
    convert_seconds: f64,
}

impl Stats {
    fn new() -> Self {
        Stats {
            enabled: std::env::var_os("HYDRA_VIDEO_STATS").is_some(),
            since: Instant::now(),
            cpu_at: thread_cpu_seconds(),
            frames: 0,
            convert_seconds: 0.0,
        }
    }
    fn report(&mut self, shared: &Shared) {
        if !self.enabled || self.since.elapsed() < Duration::from_secs(5) {
            return;
        }
        let wall = self.since.elapsed().as_secs_f64();
        let cpu = thread_cpu_seconds() - self.cpu_at;
        let now = shared.clock.lock().unwrap().now();
        let (queued, offset) = {
            let queue = shared.audio.lock().unwrap();
            let per_second = shared.out_rate as f64 * shared.out_channels as f64;
            (
                queue.samples.len() as f64 / per_second,
                (queue.front_pts - now) * 1000.0,
            )
        };
        eprintln!(
            "video stats: audio {:.2}s queued, next sample {:+.0} ms vs clock ({} Hz x{})",
            queued, offset, shared.out_rate, shared.out_channels
        );
        eprintln!(
            "video stats: {}p {} | {:.1} fps decoded | decode thread {:.1}% of a core | download+convert {:.2} ms/frame",
            shared.active_height.load(Ordering::Relaxed),
            shared.decoder.lock().unwrap(),
            self.frames as f64 / wall,
            cpu / wall * 100.0,
            if self.frames > 0 {
                self.convert_seconds / self.frames as f64 * 1000.0
            } else {
                0.0
            },
        );
        *self = Stats {
            enabled: true,
            since: Instant::now(),
            cpu_at: thread_cpu_seconds(),
            frames: 0,
            convert_seconds: 0.0,
        };
    }
}

/// Decode thread: turns queued packets into RGB frames and audio samples.
fn decode_thread(shared: &Arc<Shared>) {
    let mut video: Option<VideoTrack> = None;
    let mut audio: Option<AudioTrack> = None;
    let mut generation = u64::MAX;
    let mut skip_until = 0.0_f64;
    let mut decoded = ff::frame::Video::empty();
    let mut sound = ff::frame::Audio::empty();
    let mut resampled = ff::frame::Audio::empty();
    let mut stats = Stats::new();

    while !shared.stop.load(Ordering::SeqCst) {
        stats.report(shared);

        let frames = shared.frames.lock().unwrap().len();
        let audio_full = audio.is_none() || {
            let queue = shared.audio.lock().unwrap();
            queue.samples.len() as f64
                >= AUDIO_AHEAD_SECONDS * shared.out_rate as f64 * shared.out_channels as f64
        };
        if (frames >= MAX_FRAMES && audio_full) || frames >= MAX_FRAMES * 3 {
            std::thread::sleep(Duration::from_millis(3));
            continue;
        }

        let Some(item) = shared.packets.lock().unwrap().pop_front() else {
            std::thread::sleep(Duration::from_millis(3));
            continue;
        };
        match item {
            Item::Tracks {
                generation: g,
                params,
                skip_until: s,
            } => {
                video = build_video(&params.video, shared);
                audio = params.audio.as_ref().and_then(|a| build_audio(a, shared));
                (generation, skip_until) = (g, s);
                reset_outputs(shared, generation);
            }
            Item::Flush {
                generation: g,
                skip_until: s,
            } => {
                if let Some(track) = video.as_mut() {
                    track.decoder.flush();
                }
                if let Some(track) = audio.as_mut() {
                    track.decoder.flush();
                }
                (generation, skip_until) = (g, s);
                reset_outputs(shared, generation);
            }
            Item::Packet { generation: g, .. } | Item::End { generation: g } if g != generation => {
            }
            Item::Packet {
                video: true,
                packet,
                ..
            } => {
                if let Some(track) = video.as_mut()
                    && track.decoder.send_packet(&packet).is_ok()
                {
                    drain_video(
                        track,
                        &mut decoded,
                        shared,
                        generation,
                        skip_until,
                        &mut stats,
                    );
                }
            }
            Item::Packet { packet, .. } => {
                if let Some(track) = audio.as_mut()
                    && track.decoder.send_packet(&packet).is_ok()
                {
                    drain_audio(
                        track,
                        &mut sound,
                        &mut resampled,
                        shared,
                        generation,
                        skip_until,
                    );
                }
            }
            Item::End { .. } => {
                if let Some(track) = video.as_mut() {
                    let _ = track.decoder.send_eof();
                    drain_video(
                        track,
                        &mut decoded,
                        shared,
                        generation,
                        skip_until,
                        &mut stats,
                    );
                }
                shared.eof.store(generation, Ordering::SeqCst);
            }
        }
    }
}

fn reset_outputs(shared: &Shared, generation: u64) {
    let mut queue = shared.audio.lock().unwrap();
    queue.samples.clear();
    queue.generation = generation;
}

fn drain_audio(
    track: &mut AudioTrack,
    sound: &mut ff::frame::Audio,
    resampled: &mut ff::frame::Audio,
    shared: &Shared,
    generation: u64,
    skip_until: f64,
) {
    let stereo = shared.out_channels.min(2) as usize;
    while track.decoder.receive_frame(sound).is_ok() {
        let Some(pts) = seconds(sound.timestamp().or(sound.pts()), track.time_base) else {
            continue;
        };
        if pts < skip_until || track.resampler.run(sound, resampled).is_err() {
            continue;
        }
        let bytes = &resampled.data(0)[..resampled.samples() * stereo * 4];
        let mut queue = shared.audio.lock().unwrap();
        if queue.generation != generation {
            continue;
        }
        if queue.samples.is_empty() {
            queue.front_pts = pts;
        }
        let channels = shared.out_channels as usize;
        for chunk in bytes.chunks_exact(4 * stereo) {
            let left = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            let right = if stereo == 2 {
                f32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]])
            } else {
                left
            };
            // Stereo into however many channels the device has.
            for c in 0..channels {
                queue
                    .samples
                    .push_back(if c % 2 == 0 { left } else { right });
            }
        }
    }
}

fn drain_video(
    track: &mut VideoTrack,
    decoded: &mut ff::frame::Video,
    shared: &Shared,
    generation: u64,
    skip_until: f64,
    stats: &mut Stats,
) {
    while track.decoder.receive_frame(decoded).is_ok() {
        let Some(pts) = seconds(decoded.timestamp().or(decoded.pts()), track.time_base) else {
            continue;
        };
        if pts < skip_until {
            continue; // decoding forward from the keyframe to an exact seek target
        }
        let started = Instant::now();
        let frame = download(std::mem::replace(decoded, ff::frame::Video::empty()));
        let (format, width, height) = (frame.format(), frame.width(), frame.height());
        if track
            .scaler
            .as_ref()
            .is_none_or(|(f, w, h, _)| (*f, *w, *h) != (format, width, height))
        {
            match ff::software::scaling::Context::get(
                format,
                width,
                height,
                ff::format::Pixel::RGB24,
                width,
                height,
                ff::software::scaling::Flags::BILINEAR,
            ) {
                Ok(scaler) => track.scaler = Some((format, width, height, scaler)),
                Err(_) => continue,
            }
        }
        let mut rgb = ff::frame::Video::empty();
        let Some((_, _, _, scaler)) = track.scaler.as_mut() else {
            continue;
        };
        if scaler.run(&frame, &mut rgb).is_err() {
            continue;
        }
        let mut pixels = SharedPixelBuffer::<Rgb8Pixel>::new(width, height);
        let stride = rgb.stride(0);
        let row = width as usize * 3;
        let src = rgb.data(0);
        let dst = pixels.make_mut_bytes();
        for y in 0..height as usize {
            dst[y * row..(y + 1) * row].copy_from_slice(&src[y * stride..y * stride + row]);
        }
        stats.frames += 1;
        stats.convert_seconds += started.elapsed().as_secs_f64();
        if shared.generation.load(Ordering::SeqCst) == generation {
            shared.frames.lock().unwrap().push_back(Frame {
                pts,
                generation,
                pixels,
            });
        }
    }
}
