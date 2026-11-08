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

/// Fetch a source's bytes (blocking; call from a worker).
pub fn fetch(http: &reqwest::blocking::Client, source: &Source) -> Option<Vec<u8>> {
    match source {
        Source::Path(path) => std::fs::read(path).ok(),
        Source::Url(url) => http
            .get(url)
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.bytes())
            .ok()
            .map(|b| b.to_vec()),
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
        .ok()?;
    Some(transform(img, op))
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
                Source::Url(url) => http
                    .get(url)
                    .send()
                    .and_then(|r| r.error_for_status())
                    .and_then(|r| r.bytes())
                    .ok()
                    .and_then(|bytes| decode_bytes(&bytes, op)),
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
