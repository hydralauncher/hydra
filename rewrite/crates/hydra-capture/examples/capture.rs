//! Manual check of the capture paths:
//! `cargo run -p hydra-capture --example capture -- <window> <out.jpeg> [--crop]`
//! `<window>` is an HWND (Windows) or an X11 window id; `foreground` uses
//! the focused window. Prints which path produced the frame and its size.

use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (Some(window), Some(out)) = (args.first(), args.get(1)) else {
        eprintln!("usage: capture <window|foreground> <out.jpeg> [--crop]");
        std::process::exit(2);
    };
    let crop = args.iter().any(|a| a == "--crop");
    let window = if window == "foreground" {
        let foreground =
            hydra_capture::foreground::foreground_window().expect("no foreground window");
        println!("foreground: {foreground:?}");
        foreground
            .window_handle
            .or(foreground.window_id)
            .expect("no window id")
    } else {
        window.clone()
    };
    if let Some((frame, client)) = hydra_capture::window_capture::window_rects(&window) {
        println!("frame {frame:?} client {client:?}");
    }

    let started = Instant::now();
    let _ = hydra_capture::window_capture::prepare();
    let (path, frame) = match hydra_capture::window_capture::desktop_duplication_frame(&window) {
        Some(frame) => ("desktop duplication", frame),
        None => match hydra_capture::window_capture::capture_window(&window, crop) {
            Ok(frame) => ("window capture", frame),
            Err(error) => {
                eprintln!("capture failed: {error}");
                std::process::exit(1);
            }
        },
    };
    let grabbed = started.elapsed();
    let encoded = hydra_capture::encode_bgra_screenshot(
        &frame.pixels,
        frame.width,
        frame.height,
        95,
        1280,
        85,
    )
    .expect("encode");
    std::fs::write(out, &encoded.jpeg).expect("write");
    println!(
        "{path}: {}x{} in {} ms, blank {}, jpeg {} bytes, preview {} bytes, total {} ms",
        frame.width,
        frame.height,
        grabbed.as_millis(),
        hydra_capture::frame::is_blank_frame(&frame),
        encoded.jpeg.len(),
        encoded.preview.len(),
        started.elapsed().as_millis()
    );
    hydra_capture::window_capture::release();
}
