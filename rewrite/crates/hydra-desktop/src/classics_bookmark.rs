//! The classics hero's rainbow bands play tv-effect.mp4 through
//! `mix-blend-mode: overlay` at 0.3 opacity (hero.scss). Slint has no blend
//! modes, so the clip is decoded once per visit (only the rows a band shows,
//! at the band's pixel size) and every video frame is composited over each
//! band colour here, then handed to the `Bookmark` global.

use std::cell::RefCell;
use std::path::PathBuf;
use std::time::Duration;

use hydra_media::strips::{self, StripSpec, Strips};
use slint::{ComponentHandle, Image, Rgb8Pixel, SharedPixelBuffer, Timer, TimerMode};

use crate::{AppWindow, Bookmark};

const CLIP: &[u8] = include_bytes!("../../../../src/renderer/src/assets/emulation/tv-effect.mp4");
const BAND_HEIGHT: f32 = 14.405;
/// Band colours in `Bookmark` order (red, orange, yellow, green, blue) and
/// which strip they use (0: 382px wide, 1: 500px wide).
const BANDS: [([u8; 3], usize); 5] = [
    ([0xf8, 0xc8, 0x02], 0),
    ([0xfc, 0x58, 0x12], 0),
    ([0xfb, 0x00, 0x26], 0),
    ([0xc8, 0x00, 0x78], 0),
    ([0x73, 0x00, 0xa4], 1),
];

struct State {
    ui: slint::Weak<AppWindow>,
    generation: u64,
    strips: Option<Strips>,
    frame: usize,
    timer: Timer,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> Option<R> {
    STATE.with(|s| s.borrow_mut().as_mut().map(f))
}

pub fn init(ui: &AppWindow) {
    STATE.with(|s| {
        *s.borrow_mut() = Some(State {
            ui: ui.as_weak(),
            generation: 0,
            strips: None,
            frame: 0,
            timer: Timer::default(),
        })
    });
}

fn clip_path() -> Option<PathBuf> {
    // Next to the image cache, not in it (its trimming would delete the clip).
    let path = hydra_media::images::cache_dir()?
        .parent()?
        .join("tv-effect.mp4");
    let current = std::fs::metadata(&path).is_ok_and(|m| m.len() == CLIP.len() as u64);
    if !current {
        std::fs::create_dir_all(path.parent()?).ok()?;
        std::fs::write(&path, CLIP).ok()?;
    }
    Some(path)
}

/// A classics hero is showing: decode the clip and start compositing.
pub fn start() {
    let Some((generation, scale)) = with(|s| {
        s.generation += 1;
        s.timer.stop();
        s.strips = None;
        (
            s.generation,
            s.ui.upgrade()
                .map(|ui| ui.window().scale_factor())
                .unwrap_or(1.0),
        )
    }) else {
        return;
    };
    std::thread::spawn(move || {
        let Some(path) = clip_path() else { return };
        let decoded = strips::decode(&path, |w, h| {
            vec![
                StripSpec::cover(w, h, 382.0, BAND_HEIGHT, scale),
                StripSpec::cover(w, h, 500.0, BAND_HEIGHT, scale),
            ]
        });
        let strips = match decoded {
            Ok(strips) => strips,
            Err(error) => {
                eprintln!("classics bookmark: {error}");
                return;
            }
        };
        let interval = Duration::from_secs_f64(1.0 / strips.fps.clamp(1.0, 60.0));
        let specs = [
            StripSpec::cover(1164, 720, 382.0, BAND_HEIGHT, scale),
            StripSpec::cover(1164, 720, 500.0, BAND_HEIGHT, scale),
        ];
        let sizes = [
            (specs[0].width, specs[0].height),
            (specs[1].width, specs[1].height),
        ];
        let _ = slint::invoke_from_event_loop(move || {
            let current = with(|s| {
                if s.generation != generation {
                    return false;
                }
                s.strips = Some(strips);
                s.frame = 0;
                true
            })
            .unwrap_or(false);
            if !current {
                return;
            }
            tick(sizes);
            with(|s| {
                s.timer
                    .start(TimerMode::Repeated, interval, move || tick(sizes))
            });
        });
    });
}

/// Leaving the page (or a non-classics game): stop and free the frames.
pub fn stop() {
    let ui = with(|s| {
        s.generation += 1;
        s.timer.stop();
        s.strips = None;
        s.ui.upgrade()
    })
    .flatten();
    if let Some(ui) = ui {
        let b = ui.global::<Bookmark>();
        b.set_red(Image::default());
        b.set_orange(Image::default());
        b.set_yellow(Image::default());
        b.set_green(Image::default());
        b.set_blue(Image::default());
    }
}

/// Standard normal CDF (Abramowitz–Stegun erf), for the 1px blurred inset highlight.
fn phi(x: f32) -> f32 {
    let t = 1.0 / (1.0 + 0.3275911 * (x.abs() / std::f32::consts::SQRT_2));
    let y = 1.0
        - (((((1.061_405_4 * t - 1.453_152_1) * t) + 1.421_413_8) * t - 0.284_496_74) * t
            + 0.254_829_6)
            * t
            * (-(x * x) / 2.0).exp();
    if x >= 0.0 {
        0.5 * (1.0 + y)
    } else {
        0.5 * (1.0 - y)
    }
}

/// `color` + `inset 0 -1px 1px rgba(255,255,255,0.25)` + the video frame
/// blended with `overlay` at 0.3 opacity.
fn composite(
    color: [u8; 3],
    video: &[u8],
    width: u32,
    height: u32,
) -> SharedPixelBuffer<Rgb8Pixel> {
    let mut out = SharedPixelBuffer::<Rgb8Pixel>::new(width, height);
    let scale = height as f32 / BAND_HEIGHT;
    let pixels = out.make_mut_slice();
    for y in 0..height as usize {
        // Distance of the row centre from the bottom edge, in CSS px.
        let d = (height as f32 - (y as f32 + 0.5)) / scale;
        let highlight = 0.25 * phi((1.0 - d) / 0.5);
        let base: [f32; 3] = std::array::from_fn(|c| {
            let c = color[c] as f32 / 255.0;
            c * (1.0 - highlight) + highlight
        });
        for x in 0..width as usize {
            let i = y * width as usize + x;
            let v = &video[i * 3..i * 3 + 3];
            let mix = |c: usize| {
                let (b, s) = (base[c], v[c] as f32 / 255.0);
                let overlay = if b <= 0.5 {
                    2.0 * b * s
                } else {
                    1.0 - 2.0 * (1.0 - b) * (1.0 - s)
                };
                ((b * 0.7 + overlay * 0.3) * 255.0)
                    .round()
                    .clamp(0.0, 255.0) as u8
            };
            pixels[i] = Rgb8Pixel {
                r: mix(0),
                g: mix(1),
                b: mix(2),
            };
        }
    }
    out
}

fn tick(sizes: [(u32, u32); 2]) {
    let Some((ui, images)) = with(|s| {
        let ui = s.ui.upgrade()?;
        let strips = s.strips.as_ref()?;
        let count = strips.frames[0].len();
        let frame = s.frame % count;
        s.frame = (frame + 1) % count;
        let images: Vec<Image> = BANDS
            .iter()
            .map(|(color, strip)| {
                let (w, h) = sizes[*strip];
                Image::from_rgb8(composite(*color, &strips.frames[*strip][frame], w, h))
            })
            .collect();
        Some((ui, images))
    })
    .flatten() else {
        return;
    };
    let b = ui.global::<Bookmark>();
    let mut images = images.into_iter();
    let mut next = || images.next().unwrap_or_default();
    b.set_red(next());
    b.set_orange(next());
    b.set_yellow(next());
    b.set_green(next());
    b.set_blue(next());
}
