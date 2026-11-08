//! Hydra desktop: the Rust + Slint rewrite of the Electron app.
//!
//! `hydra [--path /game/steam/1091500] [--locale pt-BR]`
//! See `rewrite/README.md` for what is ported and `rewrite/docs/parity-plan.md`
//! for what is next.

mod catalogue_page;
mod classics_bookmark;
mod collections;
mod context_menu;
mod devscript;
mod dialogs;
mod download_indicator;
mod download_settings;
mod downloads;
mod downloads_menu;
mod downloads_page;
mod features;
mod format;
mod frametrace;
mod game_classics;
mod game_menu;
mod game_options;
mod game_page;
mod game_repacks;
mod games;
mod gifs;
mod headless;
mod home_page;
mod library_page;
mod nav;
mod popup;
mod shell;
mod toast;

use std::path::PathBuf;
use std::sync::Arc;

use hydra_core::api::HydraApi;
use hydra_db::{import, paths};
use hydra_media::images::Loader;
use slint::ComponentHandle;

slint::include_modules!();

/// The px one mouse wheel notch scrolls, as Chromium does it: on Windows
/// 100/3px per line times the system wheel scroll lines (3 by default, so
/// 100px, measured on Electron).
#[cfg(windows)]
fn wheel_notch_px() -> f32 {
    #[link(name = "user32")]
    unsafe extern "system" {
        fn SystemParametersInfoW(
            action: u32,
            param: u32,
            value: *mut std::ffi::c_void,
            ini: u32,
        ) -> i32;
    }
    const SPI_GETWHEELSCROLLLINES: u32 = 0x0068;
    let mut lines: u32 = 3;
    // SAFETY: SPI_GETWHEELSCROLLLINES writes one UINT to the pointer.
    let ok =
        unsafe { SystemParametersInfoW(SPI_GETWHEELSCROLLLINES, 0, (&raw mut lines).cast(), 0) };
    // WHEEL_PAGESCROLL (u32::MAX) scrolls pages; fall back to the default.
    if ok == 0 || lines == 0 || lines == u32::MAX {
        lines = 3;
    }
    lines as f32 * 100.0 / 3.0
}

/// TODO(linux): measure Chromium on X11/Wayland; 40px is the old value.
#[cfg(not(windows))]
fn wheel_notch_px() -> f32 {
    40.0
}

struct Args {
    path: Option<String>,
    locale: Option<String>,
}

fn parse_args() -> Args {
    let mut args = Args {
        path: None,
        locale: None,
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--path" => args.path = it.next(),
            // Kept from the game-page spike: `--steam-app <id>`.
            "--steam-app" => args.path = it.next().map(|id| format!("/game/steam/{id}")),
            "--locale" => args.locale = it.next(),
            other => eprintln!("unknown argument {other:?} (use --path <route> --locale <code>)"),
        }
    }
    args
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    hydra_store::init_tls();
    let args = parse_args();

    // HYDRA_HEADLESS=1: no OS window (software renderer in memory), for scripted validation.
    let headless_mode = std::env::var_os("HYDRA_HEADLESS").is_some();
    if headless_mode {
        let scale = std::env::var("HYDRA_HEADLESS_SCALE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1.0);
        let width = std::env::var("HYDRA_HEADLESS_WIDTH")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1200);
        let height = std::env::var("HYDRA_HEADLESS_HEIGHT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(860);
        headless::Headless::install(width, height, scale)?;
    } else if std::env::var_os("SLINT_BACKEND").is_none() {
        // Skia measured best overall (see docs/decisions.md). SLINT_BACKEND overrides.
        slint::BackendSelector::new()
            .backend_name("winit".into())
            .renderer_name("skia".into())
            .select()?;
    }

    // ---- local data: the rewrite's own LevelDB, imported from Electron on first run
    let api_url = hydra_core::config::api_url();
    let native_dir = paths::native_user_data().ok_or("no user data folder")?;
    let electron_dir = paths::electron_user_data();
    hydra_media::video::prepare_tls(&native_dir);
    hydra_media::images::set_cache_dir(native_dir.join("Cache").join("images"));
    let (db, origin) = import::open_or_import(
        &native_dir,
        electron_dir.as_deref(),
        paths::database_name(&api_url),
    )?;
    eprintln!("data: {} ({origin:?})", db.path().display());
    let db = Arc::new(db);
    let api = Arc::new(HydraApi::new(db.clone(), hydra_store::http_client()));

    let ui = AppWindow::new()?;
    let loader = Loader::new(3);

    // Chromium-like wheel: label each wheel event before Slint sees it. Mouse
    // wheels report lines (Chromium: 40px per line, Slint: 60px); trackpads
    // report pixels, which stay 1:1.
    if !headless_mode {
        use slint::winit_030::{EventResult, WinitWindowAccessor, winit};
        let weak = ui.as_weak();
        let cursor = std::cell::Cell::new((0.0f32, 0.0f32));
        ui.window().on_winit_window_event(move |window, event| {
            let Some(ui) = weak.upgrade() else {
                return EventResult::Propagate;
            };
            match event {
                winit::event::WindowEvent::MouseWheel { delta, .. } => {
                    let (x, y) = cursor.get();
                    popup::wheel_at(&ui, x, y);
                    let lines = matches!(delta, winit::event::MouseScrollDelta::LineDelta(..));
                    if frametrace::enabled() {
                        eprintln!("[wheel] {delta:?}");
                    }
                    ui.global::<Input>()
                        .set_wheel_scale(if lines { 40.0 / 60.0 } else { 1.0 });
                    let smooth = ui.global::<SmoothScroll>();
                    smooth.set_lines(lines);
                    // Slint turns one line into 60px.
                    smooth.set_wheel_scale(if lines { wheel_notch_px() / 60.0 } else { 1.0 });
                }
                winit::event::WindowEvent::RedrawRequested if frametrace::enabled() => {
                    frametrace::on_redraw(&ui);
                }
                winit::event::WindowEvent::CursorMoved { position, .. } => {
                    let scale = window.scale_factor();
                    cursor.set((position.x as f32 / scale, position.y as f32 / scale));
                }
                winit::event::WindowEvent::MouseInput {
                    state: winit::event::ElementState::Pressed,
                    ..
                } => {
                    let (x, y) = cursor.get();
                    popup::pointer_pressed(&ui, x, y);
                }
                winit::event::WindowEvent::KeyboardInput { event, .. }
                    if event.state == winit::event::ElementState::Pressed
                        && event.logical_key
                            == winit::keyboard::Key::Named(winit::keyboard::NamedKey::Escape)
                        && popup::escape(&ui) =>
                {
                    return EventResult::PreventDefault;
                }
                _ => {}
            }
            EventResult::Propagate
        });
    }

    downloads::init(&ui, db.clone(), api.clone(), &native_dir);
    games::init(db.clone(), api.clone());
    shell::init(
        &ui,
        db,
        api,
        loader.clone(),
        args.locale.as_deref(),
        headless_mode,
    );
    game_page::init(&ui, &loader);
    game_repacks::init(&ui);
    game_options::init(&ui);
    download_settings::init(&ui);
    downloads_page::init(&ui, &loader);
    download_indicator::init(&ui, &loader);
    downloads_menu::init(&ui);
    classics_bookmark::init(&ui);
    library_page::init(&ui);
    home_page::init(&ui, &loader);
    catalogue_page::init(&ui, &loader);
    {
        let select = ui.global::<SelectPopup>();
        select.on_chosen(|owner, value| {
            if owner == "catalogue-sort" {
                catalogue_page::set_sort(&value);
            }
        });
    }
    gifs::init(&ui);
    popup::init(&ui);
    toast::init(&ui);
    context_menu::init(&ui);
    dialogs::init(&ui);
    nav::init(&ui, args.path.as_deref().unwrap_or("/"));

    // HYDRA_TIMING=1: print when the first frame is on screen (benchmarks).
    if std::env::var_os("HYDRA_TIMING").is_some() {
        let started = std::time::Instant::now();
        // Skia on Direct3D doesn't call rendering notifiers, so take the
        // event loop's first turn: the window is mapped and the first frame
        // is painted right after it.
        let _ = slint::invoke_from_event_loop(move || {
            eprintln!(
                "timing: first frame {} ms after main() (event loop running)",
                started.elapsed().as_millis()
            );
        });
    }

    frametrace::install(&ui);

    if let Ok(steps) = std::env::var("HYDRA_DEV_SCRIPT") {
        let out = std::env::var("HYDRA_DEV_SHOTS")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir().join("hydra-shots"));
        devscript::run(&ui, &steps, out);
    }

    ui.run()?;

    // quit-cleanup.ts: stop media threads first, then leave without running
    // thread-local destructors under worker threads that are still parked.
    game_page::shutdown();
    library_page::shutdown();
    home_page::shutdown();
    catalogue_page::shutdown();
    shell::shutdown();
    drop(ui);
    std::process::exit(0);
}
