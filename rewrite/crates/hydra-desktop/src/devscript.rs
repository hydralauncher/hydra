//! Scripted validation driver: `HYDRA_DEV_SCRIPT="wait 2000; move 500 600; shot hover; quit"`.
//!
//! Injects input through Slint's own event dispatch (no OS events) and saves
//! frames with `Window::take_snapshot()` into `HYDRA_DEV_SHOTS` (default:
//! `<tmp>/hydra-shots`). Combine with `HYDRA_HEADLESS=1` to run without a
//! window at all, so agents can validate screens without stealing focus.
//!
//! Steps (separated by `;`):
//! - `wait <ms>`
//! - `shot <name>` - save `<name>.png`
//! - `move <x> <y>`, `press <x> <y>`, `release <x> <y>` - logical pixels
//! - `wheel <x> <y> <dy>`, `hwheel <x> <y> <dx>` - scroll events
//! - `type <text>` - text input
//! - `keydown|keyup|tap <key> [count]` - key names: shift, meta, control,
//!   left, right, up, down, home, end, pagedown, space, escape, or a character
//! - `quit`

use slint::platform::{Key, PointerEventButton, WindowEvent};
use slint::{ComponentHandle, LogicalPosition, Timer};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub fn run<C: ComponentHandle + 'static>(component: &C, script: &str, out_dir: PathBuf) {
    let _ = std::fs::create_dir_all(&out_dir);
    let steps: Vec<String> = script
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    next(component.as_weak(), steps, 0, out_dir);
}

fn next<C: ComponentHandle + 'static>(
    weak: slint::Weak<C>,
    steps: Vec<String>,
    i: usize,
    out: PathBuf,
) {
    let Some(step) = steps.get(i).cloned() else {
        return;
    };
    let Some(component) = weak.upgrade() else {
        return;
    };
    let window = component.window();
    let mut parts = step.split_whitespace();
    let cmd = parts.next().unwrap_or_default();
    let args: Vec<&str> = parts.collect();
    let num = |n: usize| {
        args.get(n)
            .and_then(|a| a.parse::<f32>().ok())
            .unwrap_or(0.0)
    };
    let mut delay = Duration::from_millis(16);

    match cmd {
        "wait" => delay = Duration::from_millis(num(0) as u64),
        "shot" => snapshot(window, &out, args.first().copied().unwrap_or("shot")),
        "move" | "press" | "release" => {
            let position = LogicalPosition::new(num(0), num(1));
            window.dispatch_event(WindowEvent::PointerMoved { position });
            let button = PointerEventButton::Left;
            match cmd {
                "press" => window.dispatch_event(WindowEvent::PointerPressed { position, button }),
                "release" => {
                    window.dispatch_event(WindowEvent::PointerReleased { position, button })
                }
                _ => {}
            }
        }
        "wheel" | "hwheel" => window.dispatch_event(WindowEvent::PointerScrolled {
            position: LogicalPosition::new(num(0), num(1)),
            delta_x: if cmd == "hwheel" { num(2) } else { 0.0 },
            delta_y: if cmd == "wheel" { num(2) } else { 0.0 },
        }),
        "type" => {
            for ch in args.join(" ").chars() {
                window.dispatch_event(WindowEvent::KeyPressed { text: ch.into() });
                window.dispatch_event(WindowEvent::KeyReleased { text: ch.into() });
            }
        }
        "keydown" | "keyup" | "tap" => {
            let name = args.first().copied().unwrap_or_default();
            let text: slint::SharedString = match name {
                "shift" => Key::Shift.into(),
                "meta" => Key::Meta.into(),
                "control" => Key::Control.into(),
                "left" => Key::LeftArrow.into(),
                "right" => Key::RightArrow.into(),
                "up" => Key::UpArrow.into(),
                "down" => Key::DownArrow.into(),
                "home" => Key::Home.into(),
                "end" => Key::End.into(),
                "pagedown" => Key::PageDown.into(),
                "escape" => Key::Escape.into(),
                "space" => " ".into(),
                other => other.into(),
            };
            let count = args
                .get(1)
                .and_then(|n| n.parse::<usize>().ok())
                .unwrap_or(1);
            for _ in 0..count {
                if cmd != "keyup" {
                    window.dispatch_event(WindowEvent::KeyPressed { text: text.clone() });
                }
                if cmd != "keydown" {
                    window.dispatch_event(WindowEvent::KeyReleased { text: text.clone() });
                }
            }
        }
        "quit" => {
            let _ = slint::quit_event_loop();
            return;
        }
        other => eprintln!("devscript: unknown step {other:?}"),
    }

    Timer::single_shot(delay, move || next(weak, steps, i + 1, out));
}

fn snapshot(window: &slint::Window, out: &Path, name: &str) {
    match window.take_snapshot() {
        Ok(buffer) => {
            let path = out.join(format!("{name}.png"));
            match image::RgbaImage::from_raw(
                buffer.width(),
                buffer.height(),
                buffer.as_bytes().to_vec(),
            ) {
                Some(img) => {
                    if let Err(err) = img.save(&path) {
                        eprintln!("devscript: {name}: {err}");
                    }
                }
                None => eprintln!("devscript: {name}: bad snapshot buffer"),
            }
        }
        Err(err) => eprintln!("devscript: {name}: {err}"),
    }
}
