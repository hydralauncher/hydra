//! Hydra desktop: the Rust + Slint rewrite of the Electron app.
//!
//! `hydra [--path /game/steam/1091500] [--locale pt-BR]`
//! See `rewrite/README.md` for what is ported and `rewrite/docs/parity-plan.md`
//! for what is next.

mod achievements_page;
mod auth;
mod catalogue_page;
mod chat_service;
mod chat_window;
mod classics_bookmark;
mod collections;
mod context_menu;
mod deeplink;
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
mod friends_window;
mod game_classics;
mod game_menu;
mod game_options;
mod game_page;
mod game_repacks;
mod games;
mod gifs;
mod headless;
mod home_page;
mod hoster_browser;
mod instance;
mod library_page;
mod main_window;
mod nav;
mod notifications_page;
mod notify;
mod playtime_modals;
mod popup;
mod prefs;
mod realtime;
mod screenshots;
mod search;
mod settings_account;
mod settings_debrid;
mod settings_page;
mod settings_sources;
mod shell;
mod social;
mod sound;
mod taskbar_badge;
mod toast;
mod torrent_step;
mod tray;

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
pub(crate) fn wheel_notch_px() -> f32 {
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
pub(crate) fn wheel_notch_px() -> f32 {
    40.0
}

struct Args {
    path: Option<String>,
    locale: Option<String>,
    /// a `hydralauncher://` link (protocol launches and shortcuts)
    deep_link: Option<String>,
    /// --hidden: start in the tray (auto-launch)
    hidden: bool,
    raw: Vec<String>,
}

fn parse_args() -> Args {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let mut args = Args {
        path: None,
        locale: None,
        deep_link: deeplink::find(&raw),
        hidden: false,
        raw: raw.clone(),
    };
    let mut it = raw.into_iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--path" => args.path = it.next(),
            // Kept from the game-page spike: `--steam-app <id>`.
            "--steam-app" => args.path = it.next().map(|id| format!("/game/steam/{id}")),
            "--locale" => args.locale = it.next(),
            "--hidden" => args.hidden = true,
            link if link.starts_with("hydralauncher://") => {}
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
            // the chat window opens in the background for incoming messages
            .with_winit_window_attributes_hook(social::window_attributes)
            .select()?;
    }

    // ---- local data: the rewrite's own LevelDB, imported from Electron on first run
    let api_url = hydra_core::config::api_url();
    let native_dir = paths::native_user_data().ok_or("no user data folder")?;
    // app.requestSingleInstanceLock(): a second launch hands over its
    // arguments and quits (before it would fail on the LevelDB lock).
    // HYDRA_TEST_SINGLE_INSTANCE: exercise the lock in headless test runs.
    if (!headless_mode || std::env::var_os("HYDRA_TEST_SINGLE_INSTANCE").is_some())
        && let instance::Lock::Forwarded = instance::acquire(&native_dir, &args.raw, |args| {
            let _ = slint::invoke_from_event_loop(move || deeplink::on_second_instance(args));
        })
    {
        return Ok(());
    }
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
    if !headless_mode {
        hoster_browser::init(&native_dir);
    }
    games::init(db.clone(), api.clone());
    shell::init(
        &ui,
        db,
        api,
        loader.clone(),
        args.locale.as_deref(),
        headless_mode,
    );
    screenshots::init(&ui);
    game_page::init(&ui, &loader);
    game_repacks::init(&ui);
    torrent_step::init(&ui);
    game_options::init(&ui);
    playtime_modals::init(&ui);
    settings_page::init(&ui);
    settings_sources::init(&ui);
    settings_account::init(&ui);
    settings_debrid::init(&ui);
    auth::init(&ui);
    social::load_bounds();
    notifications_page::init(&ui);
    search::init(&ui);
    achievements_page::init(&ui);
    if let Some(api) = shell::api() {
        realtime::init(api);
    }
    notifications_page::refresh_count();
    shell::refresh_friends_online();
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
            } else if owner == "torrent-sort" {
                torrent_step::set_sort(&value);
            }
        });
    }
    gifs::init(&ui);
    popup::init(&ui);
    toast::init(&ui);
    context_menu::init(&ui);
    dialogs::init(&ui);
    nav::init(
        &ui,
        &args.path.clone().unwrap_or_else(main_window::start_path),
    );
    deeplink::init(&ui);
    if !headless_mode {
        deeplink::register_protocol();
    }
    main_window::init(&ui);
    if !headless_mode {
        main_window::restore(&ui);
        tray::init();
    }
    // --hidden (auto-launch) and cold-start "run" links stay in the tray
    let start_hidden = tray::available()
        && (args.hidden
            || deeplink::is_background(
                args.deep_link.as_deref(),
                &deeplink::COLD_START_BACKGROUND_HOSTS,
            ));
    if let Some(link) = args.deep_link.clone() {
        let _ = slint::invoke_from_event_loop(move || deeplink::handle(&link));
    }

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

    if !start_hidden {
        ui.show()?;
        // restoreSocialWindows: only with the main window on screen
        if !headless_mode {
            slint::Timer::single_shot(std::time::Duration::from_millis(0), social::restore);
        }
    }
    // fitToWorkArea once the native window exists
    let weak = ui.as_weak();
    slint::Timer::single_shot(std::time::Duration::from_millis(0), move || {
        if let Some(ui) = weak.upgrade() {
            main_window::fit_to_monitor(&ui);
        }
    });
    // Hiding the window keeps the app running in the tray.
    slint::run_event_loop_until_quit()?;

    // before-quit: saveSocialWindowsSession
    social::shutdown();
    // quit-cleanup.ts: stop media threads first, then leave without running
    // thread-local destructors under worker threads that are still parked.
    screenshots::shutdown();
    game_page::shutdown();
    library_page::shutdown();
    home_page::shutdown();
    catalogue_page::shutdown();
    shell::shutdown();
    drop(ui);
    std::process::exit(0);
}
