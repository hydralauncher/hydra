//! Off-thread image loading. Files or URLs are fetched and decoded on a small
//! worker pool; pixels are handed back to the UI thread as `slint::Image`s.
//! Nothing is decoded until a view asks, and images are decoded at display
//! size (`Op::MaxWidth`) so memory follows what is on screen.

use image::{DynamicImage, ImageReader, imageops::FilterType};
use slint::{Image, Rgb8Pixel, Rgba8Pixel, SharedPixelBuffer};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, mpsc},
    thread,
};

#[derive(Clone, Copy, Debug)]
pub enum Op {
    /// Decode as-is.
    Full,
    /// Downscale so the width is at most this many pixels (decode at display size).
    MaxWidth(u32),
    /// Stand-in for CSS `backdrop-filter: blur()`: shrink, then gaussian blur.
    Blur { shrink: u32, sigma: f32 },
    /// CSS `filter: grayscale(100%)` for locked achievements.
    Grayscale,
    /// `object-fit: cover` into a `width`×`height` box (never upscaled past
    /// the source), so a banner keeps only the strip it shows.
    Cover { width: u32, height: u32 },
    /// An `object-fit: cover` image in a `width`×`height` box under CSS
    /// `filter: blur(sigma)`: transparent outside the box, so the edges fade.
    /// The result has `pad` extra pixels on every side (at least 3σ). With
    /// `background`, it is composited over that colour and then darkened
    /// (multiplied by `darken`), like a black overlay on top.
    CoverBlur {
        width: u32,
        height: u32,
        sigma: f32,
        pad: u32,
        darken: f32,
        background: Option<[u8; 3]>,
    },
}

fn cover_blur(
    img: &DynamicImage,
    width: u32,
    height: u32,
    sigma: f32,
    pad: u32,
    darken: f32,
    background: Option<[u8; 3]>,
) -> DynamicImage {
    let fitted = img
        .resize_to_fill(width.max(1), height.max(1), FilterType::Triangle)
        .to_rgba8();
    // Transparent pixels are (0, 0, 0, 0), so the canvas is premultiplied as is.
    let mut canvas = image::RgbaImage::new(width + 2 * pad, height + 2 * pad);
    image::imageops::overlay(&mut canvas, &fitted, pad as i64, pad as i64);
    let blurred = image::imageops::blur(&canvas, sigma);
    match background {
        Some([r, g, b]) => {
            let mut out = image::RgbImage::new(blurred.width(), blurred.height());
            for (dst, src) in out.pixels_mut().zip(blurred.pixels()) {
                let inv = 1.0 - src[3] as f32 / 255.0;
                let mix = |c: u8, bg: u8| {
                    ((c as f32 + bg as f32 * inv) * darken)
                        .round()
                        .clamp(0.0, 255.0) as u8
                };
                *dst = image::Rgb([mix(src[0], r), mix(src[1], g), mix(src[2], b)]);
            }
            DynamicImage::ImageRgb8(out)
        }
        None => {
            let mut out = blurred;
            for px in out.pixels_mut() {
                let a = px[3] as f32 / 255.0;
                if a > 0.0 {
                    for c in 0..3 {
                        px[c] = (px[c] as f32 / a).round().clamp(0.0, 255.0) as u8;
                    }
                }
            }
            DynamicImage::ImageRgba8(out)
        }
    }
}

pub enum Pixels {
    Rgb(SharedPixelBuffer<Rgb8Pixel>),
    Rgba(SharedPixelBuffer<Rgba8Pixel>),
}

impl Pixels {
    pub fn into_image(self) -> Image {
        match self {
            Pixels::Rgb(buffer) => Image::from_rgb8(buffer),
            Pixels::Rgba(buffer) => Image::from_rgba8(buffer),
        }
    }
}

/// Where an image comes from.
#[derive(Clone, Debug)]
pub enum Source {
    Path(PathBuf),
    Url(String),
}

impl From<PathBuf> for Source {
    fn from(path: PathBuf) -> Self {
        Source::Path(path)
    }
}

impl From<String> for Source {
    fn from(url: String) -> Self {
        Source::Url(url)
    }
}

pub fn decode(path: &Path, op: Op) -> Option<Pixels> {
    let img = ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()?;
    Some(transform(img, op))
}

/// Decode a file or downloaded bytes without transforming it (callers derive
/// several sizes/effects from one decode).
pub fn open_bytes(bytes: &[u8]) -> Option<DynamicImage> {
    ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()
}

pub fn open_path(path: &Path) -> Option<DynamicImage> {
    ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()
}

static CACHE_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
/// Cached images newer than this are used without asking the server.
const CACHE_FRESH: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 3600);
/// The cache is trimmed (oldest first) past this size.
const CACHE_MAX_BYTES: u64 = 512 * 1024 * 1024;

/// Keep downloaded images on disk, like Chromium's HTTP cache keeps covers
/// and icons between runs. Trims old entries in the background.
pub fn set_cache_dir(dir: PathBuf) {
    let _ = std::fs::create_dir_all(&dir);
    if CACHE_DIR.set(dir.clone()).is_ok() {
        let _ = thread::Builder::new()
            .name("image-cache-trim".into())
            .spawn(move || trim_cache(&dir));
    }
}

/// The image cache folder, once set.
pub fn cache_dir() -> Option<&'static Path> {
    CACHE_DIR.get().map(PathBuf::as_path)
}

fn trim_cache(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            Some((meta.modified().ok()?, meta.len(), e.path()))
        })
        .collect();
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    if total <= CACHE_MAX_BYTES {
        return;
    }
    files.sort_by_key(|f| f.0);
    for (_, len, path) in files {
        if total <= CACHE_MAX_BYTES * 3 / 4 {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total -= len;
        }
    }
}

/// FNV-1a 64: a stable file name per URL.
fn cache_key(url: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in url.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}-{:x}", url.len())
}

/// Fetch a source's bytes (blocking; call from a worker). URLs go through
/// the disk cache when one is set.
pub fn fetch(http: &reqwest::blocking::Client, source: &Source) -> Option<Vec<u8>> {
    match source {
        Source::Path(path) => std::fs::read(path).ok(),
        Source::Url(url) => {
            let cached = CACHE_DIR.get().map(|dir| dir.join(cache_key(url)));
            if let Some(path) = &cached
                && let Ok(meta) = std::fs::metadata(path)
                && meta
                    .modified()
                    .ok()
                    .and_then(|m| m.elapsed().ok())
                    .is_some_and(|age| age < CACHE_FRESH)
                && let Ok(bytes) = std::fs::read(path)
            {
                return Some(bytes);
            }
            let bytes = http
                .get(url)
                .send()
                .and_then(|r| r.error_for_status())
                .and_then(|r| r.bytes())
                .ok()
                .map(|b| b.to_vec());
            match (&bytes, &cached) {
                (Some(bytes), Some(path)) => {
                    let tmp = path.with_extension("tmp");
                    if std::fs::write(&tmp, bytes).is_ok() {
                        let _ = std::fs::rename(&tmp, path);
                    }
                }
                // Offline: an expired copy beats nothing.
                (None, Some(path)) => return std::fs::read(path).ok(),
                _ => {}
            }
            bytes
        }
    }
}

/// Apply `op` to a decoded image and keep 3 bytes per pixel when opaque.
pub fn to_pixels(img: DynamicImage, op: Op) -> Pixels {
    transform(img, op)
}

/// Raw RGBA pixels (e.g. a ThumbHash) as `Pixels`.
pub fn rgba_pixels(width: u32, height: u32, rgba: &[u8]) -> Pixels {
    Pixels::Rgba(SharedPixelBuffer::clone_from_slice(rgba, width, height))
}

pub fn decode_bytes(bytes: &[u8], op: Op) -> Option<Pixels> {
    let img = ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()
        .or_else(|| decode_ico_entries(bytes))?;
    Some(transform(img, op))
}

/// Steam's .ico files can hold two 256px PNG entries, which the `image`
/// crate refuses as a whole. Chromium shows them, so decode each entry on
/// its own (as a one-entry ICO) and keep the largest that works.
fn decode_ico_entries(bytes: &[u8]) -> Option<DynamicImage> {
    if bytes.len() < 6 || bytes[0..4] != [0, 0, 1, 0] {
        return None;
    }
    let count = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
    let mut best: Option<DynamicImage> = None;
    for i in 0..count {
        let entry = 6 + i * 16;
        let Some(dir) = bytes.get(entry..entry + 16) else {
            break;
        };
        let size = u32::from_le_bytes([dir[8], dir[9], dir[10], dir[11]]) as usize;
        let offset = u32::from_le_bytes([dir[12], dir[13], dir[14], dir[15]]) as usize;
        let Some(data) = bytes.get(offset..offset.saturating_add(size)) else {
            continue;
        };
        let decoded = if data.starts_with(&[0x89, b'P', b'N', b'G']) {
            image::load_from_memory_with_format(data, image::ImageFormat::Png).ok()
        } else {
            let mut single = Vec::with_capacity(22 + data.len());
            single.extend_from_slice(&[0, 0, 1, 0, 1, 0]);
            single.extend_from_slice(&dir[0..12]);
            single.extend_from_slice(&22u32.to_le_bytes());
            single.extend_from_slice(data);
            image::load_from_memory_with_format(&single, image::ImageFormat::Ico).ok()
        };
        if let Some(img) = decoded
            && best.as_ref().is_none_or(|b| img.width() > b.width())
        {
            best = Some(img);
        }
    }
    best
}

fn transform(img: DynamicImage, op: Op) -> Pixels {
    let img = match op {
        Op::Full => img,
        Op::MaxWidth(width) if img.width() > width => {
            img.resize(width, u32::MAX, FilterType::Triangle)
        }
        Op::MaxWidth(_) => img,
        Op::Blur { shrink, sigma } => img
            .resize_exact(
                img.width() / shrink,
                img.height() / shrink,
                FilterType::Triangle,
            )
            .blur(sigma),
        Op::Grayscale => DynamicImage::ImageLuma8(img.to_luma8()),
        Op::Cover { width, height } => {
            // Keep the box aspect, at most the source resolution.
            let scale = (img.width() as f32 / width.max(1) as f32)
                .min(img.height() as f32 / height.max(1) as f32)
                .min(1.0);
            let w = ((width as f32 * scale).round() as u32).max(1);
            let h = ((height as f32 * scale).round() as u32).max(1);
            img.resize_to_fill(w, h, FilterType::Triangle)
        }
        Op::CoverBlur {
            width,
            height,
            sigma,
            pad,
            darken,
            background,
        } => cover_blur(&img, width, height, sigma, pad, darken, background),
    };
    // Opaque images stay 3 bytes per pixel.
    if img.color().has_alpha() {
        let rgba = img.to_rgba8();
        Pixels::Rgba(SharedPixelBuffer::clone_from_slice(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
        ))
    } else {
        let rgb = img.to_rgb8();
        Pixels::Rgb(SharedPixelBuffer::clone_from_slice(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
        ))
    }
}

/// Blur an already-decoded RGBA frame (e.g. a window snapshot).
/// `shrink` halves/quarters it first; the blur radius is in shrunk pixels.
pub fn blur_rgba(
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    shrink: u32,
    sigma: f32,
) -> Option<Pixels> {
    let img = image::RgbaImage::from_raw(width, height, rgba)?;
    let small = image::imageops::resize(
        &img,
        (width / shrink).max(1),
        (height / shrink).max(1),
        FilterType::Triangle,
    );
    let blurred = DynamicImage::ImageRgba8(small).blur(sigma).to_rgb8();
    Some(Pixels::Rgb(SharedPixelBuffer::clone_from_slice(
        blurred.as_raw(),
        blurred.width(),
        blurred.height(),
    )))
}

type Job = Box<dyn FnOnce() + Send>;

/// A small fixed pool, so scrubbing through the gallery never spawns unbounded threads.
#[derive(Clone)]
pub struct Loader {
    tx: mpsc::Sender<Job>,
    http: reqwest::blocking::Client,
}

impl Loader {
    pub fn new(workers: usize) -> Self {
        let (tx, rx) = mpsc::channel::<Job>();
        let rx = Arc::new(Mutex::new(rx));
        for i in 0..workers {
            let rx = Arc::clone(&rx);
            thread::Builder::new()
                .name(format!("image-decode-{i}"))
                .spawn(move || {
                    loop {
                        let job = { rx.lock().unwrap().recv() };
                        match job {
                            Ok(job) => job(),
                            Err(_) => break,
                        }
                    }
                })
                .expect("spawn image worker");
        }
        let http = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("HTTP client");
        Self { tx, http }
    }

    /// Run `work` on a worker, then hand its result to `done` on the UI thread.
    pub fn spawn(
        &self,
        work: impl FnOnce() -> Option<Pixels> + Send + 'static,
        done: impl FnOnce(Image) + Send + 'static,
    ) {
        let _ = self.tx.send(Box::new(move || {
            if let Some(pixels) = work() {
                let _ = slint::invoke_from_event_loop(move || done(pixels.into_image()));
            }
        }));
    }

    /// Run `job` on a worker with the shared HTTP client. The job hands its
    /// results back with `slint::invoke_from_event_loop` itself.
    pub fn run(&self, job: impl FnOnce(&reqwest::blocking::Client) + Send + 'static) {
        let http = self.http.clone();
        let _ = self.tx.send(Box::new(move || job(&http)));
    }

    /// Fetch + decode `source` on a worker, then run `done` on the UI thread.
    pub fn load(
        &self,
        source: impl Into<Source>,
        op: Op,
        done: impl FnOnce(Image) + Send + 'static,
    ) {
        let source = source.into();
        let http = self.http.clone();
        let _ = self.tx.send(Box::new(move || {
            let pixels = match &source {
                Source::Path(path) => decode(path, op),
                Source::Url(_) => fetch(&http, &source).and_then(|bytes| decode_bytes(&bytes, op)),
            };
            match pixels {
                Some(pixels) => {
                    let _ = slint::invoke_from_event_loop(move || done(pixels.into_image()));
                }
                None => eprintln!("image: failed to load {source:?}"),
            }
        }));
    }
}
