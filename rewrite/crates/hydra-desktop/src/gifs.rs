//! The renderer's animated GIF icons (home flame and stars), decoded once at
//! display size into frames for `AnimatedImage` (ui/components/animated.slint).

use std::cell::Cell;

use image::AnimationDecoder;
use image::codecs::gif::GifDecoder;
use image::imageops::FilterType;
use slint::{ComponentHandle, Image, ModelRc, VecModel};

use crate::{AppWindow, Gifs};

const FLAME: &[u8] = include_bytes!("../assets/flame-animated.gif");
const STARS: &[u8] = include_bytes!("../assets/stars-animated.gif");

thread_local! {
    static WINDOW: std::cell::RefCell<Option<slint::Weak<AppWindow>>> = const { std::cell::RefCell::new(None) };
    static REQUESTED: Cell<bool> = const { Cell::new(false) };
}

pub fn init(ui: &AppWindow) {
    WINDOW.with(|w| *w.borrow_mut() = Some(ui.as_weak()));
}

type Frames = Vec<(u32, u32, Vec<u8>)>;

fn decode(bytes: &[u8], size: u32) -> Frames {
    let Ok(decoder) = GifDecoder::new(std::io::Cursor::new(bytes)) else {
        return Vec::new();
    };
    decoder
        .into_frames()
        .filter_map(Result::ok)
        .map(|frame| {
            let resized = image::imageops::resize(frame.buffer(), size, size, FilterType::Triangle);
            (resized.width(), resized.height(), resized.into_raw())
        })
        .collect()
}

fn to_images(frames: Frames) -> Vec<Image> {
    frames
        .into_iter()
        .map(|(w, h, rgba)| hydra_media::images::rgba_pixels(w, h, &rgba).into_image())
        .collect()
}

/// Decode both GIFs on a worker the first time a page needs them.
pub fn ensure_loaded() {
    if REQUESTED.with(|r| r.replace(true)) {
        return;
    }
    let Some(ui) = WINDOW.with(|w| w.borrow().as_ref().and_then(|w| w.upgrade())) else {
        return;
    };
    let scale = ui.window().scale_factor();
    // Displayed at up to 32px (flame) and 70px (stars).
    let flame_px = (32.0 * scale).ceil() as u32;
    let stars_px = (70.0 * scale).ceil() as u32;
    let weak = ui.as_weak();
    std::thread::spawn(move || {
        let flame = decode(FLAME, flame_px);
        let stars = decode(STARS, stars_px);
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = weak.upgrade() {
                let gifs = ui.global::<Gifs>();
                gifs.set_flame(ModelRc::new(VecModel::from(to_images(flame))));
                gifs.set_stars(ModelRc::new(VecModel::from(to_images(stars))));
            }
        });
    });
}
