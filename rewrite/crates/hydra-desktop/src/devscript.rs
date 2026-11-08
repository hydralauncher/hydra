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
//! - `open-friends`, `open-chat <friend id>`: open the social windows
//! - `target main|friends|chat`: later steps go to that window
//! - `notify-achievement-test`, `notify-achievement-combined <games> <n>`,
//!   `shot-notification <name>` - the achievement notification window
//! - `quit`

use slint::platform::{Key, PointerEventButton, WindowEvent};
use slint::{ComponentHandle, LogicalPosition, Timer};
use std::path::{Path, PathBuf};
use std::time::Duration;

thread_local! {
    static TARGET: std::cell::RefCell<String> = std::cell::RefCell::new("main".into());
}

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
    let target = TARGET.with(|t| t.borrow().clone());
    let friends = (target == "friends")
        .then(crate::friends_window::window)
        .flatten();
    let chat = (target == "chat")
        .then(crate::chat_window::window)
        .flatten();
    let window = match (&friends, &chat) {
        (Some(friends), _) => friends.window(),
        (_, Some(chat)) => chat.window(),
        _ => component.window(),
    };
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
        "click" | "rclick" => {
            let position = LogicalPosition::new(num(0), num(1));
            let button = if cmd == "rclick" {
                PointerEventButton::Right
            } else {
                PointerEventButton::Left
            };
            window.dispatch_event(WindowEvent::PointerMoved { position });
            if target == "main" {
                crate::popup::pointer_pressed_at(num(0), num(1));
            }
            if target == "chat" {
                crate::chat_window::pointer_pressed_at(num(0), num(1));
            }
            window.dispatch_event(WindowEvent::PointerPressed { position, button });
            window.dispatch_event(WindowEvent::PointerReleased { position, button });
        }
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
                "return" | "enter" => Key::Return.into(),
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
        // fire the download / extraction notifications for a game id (shop:objectId)
        "notify-download" => {
            crate::notify::download_complete(args.first().copied().unwrap_or_default())
        }
        "notify-extract" => {
            crate::notify::extraction_complete(args.first().copied().unwrap_or_default())
        }
        "open-friends" => crate::friends_window::open(),
        "open-friends-bg" => crate::friends_window::open_quiet(),
        "open-chat" => crate::chat_window::open_by_id(args.first().copied().unwrap_or_default()),
        // the chat window opened in the background (an incoming message)
        "open-chat-bg" => {
            crate::chat_window::open_in_background(args.first().copied().unwrap_or_default())
        }
        "target" => {
            TARGET.with(|t| *t.borrow_mut() = args.first().copied().unwrap_or("main").into())
        }
        // settings states the account can't reach on its own (settings_integrations::dev)
        "settings-dev" => crate::settings_integrations::dev(&args),
        // the Settings → Notifications test (plain, rare + hidden, platinum)
        "notify-achievement-test" => crate::achievement_notification::show_test(),
        // the combined "N achievements on M games" notification
        "notify-achievement-combined" => crate::achievement_notification::publish_combined(
            num(0).max(1.0) as usize,
            num(1).max(1.0) as usize,
        ),
        // hold the notification at <ms> (4000+ is the closing), or `off`
        "notification-time" => crate::achievement_notification::dev_pin(
            args.first().and_then(|a| a.parse::<f32>().ok()),
        ),
        // a frame of the achievement notification window
        "shot-notification" => match crate::achievement_notification::window() {
            Some(notification) => snapshot(
                notification.window(),
                &out,
                args.first().copied().unwrap_or("notification"),
            ),
            None => eprintln!("devscript: no notification window"),
        },
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
