//! The main window's lifecycle (window-manager.ts): bounds saved to and
//! restored from `screenState`, and closing to the tray unless
//! preferQuitInsteadOfHiding.

use std::cell::Cell;

use hydra_db::keys;
use serde_json::{Value, json};
use slint::{ComponentHandle, LogicalPosition, LogicalSize};

use crate::{AppWindow, Chrome, shell};

const DEFAULT_WIDTH: f32 = 1200.0;
const DEFAULT_HEIGHT: f32 = 860.0;
const MIN_WIDTH: f32 = 1024.0;
const MIN_HEIGHT: f32 = 600.0;

thread_local! {
    /// initialConfigInitializationMainWindow's size: what a maximized window saves
    static INITIAL: Cell<(f32, f32)> = const { Cell::new((DEFAULT_WIDTH, DEFAULT_HEIGHT)) };
}

/// loadScreenConfig + fitToWorkArea (the work area check happens once the
/// native window exists, in `fit_to_monitor`).
pub fn restore(ui: &AppWindow) {
    let state: Option<Value> = shell::db().and_then(|db| db.get(keys::SCREEN_STATE));
    let number = |key: &str| {
        state
            .as_ref()
            .and_then(|s| s.get(key))
            .and_then(Value::as_f64)
            .map(|v| v as f32)
    };
    let width = number("width").unwrap_or(DEFAULT_WIDTH).max(MIN_WIDTH);
    let height = number("height").unwrap_or(DEFAULT_HEIGHT).max(MIN_HEIGHT);
    INITIAL.with(|i| i.set((width, height)));
    ui.window().set_size(LogicalSize::new(width, height));
    if let (Some(x), Some(y)) = (number("x"), number("y")) {
        ui.window().set_position(LogicalPosition::new(x, y));
    }
    let maximized = state
        .as_ref()
        .and_then(|s| s.get("isMaximized"))
        .and_then(Value::as_bool)
        == Some(true);
    if maximized {
        ui.window().set_maximized(true);
        ui.global::<Chrome>().set_maximized(true);
    }
}

/// fitToWorkArea: keep a restored window on a monitor that still exists.
pub fn fit_to_monitor(ui: &AppWindow) {
    use slint::winit_030::WinitWindowAccessor;
    ui.window().with_winit_window(|window| {
        if window.is_maximized() {
            return;
        }
        let Some(monitor) = window
            .current_monitor()
            .or_else(|| window.primary_monitor())
        else {
            return;
        };
        let scale = monitor.scale_factor();
        let area_pos = monitor.position().to_logical::<f64>(scale);
        let area_size = monitor.size().to_logical::<f64>(scale);
        let size = window.outer_size().to_logical::<f64>(scale);
        let Ok(pos) = window.outer_position().map(|p| p.to_logical::<f64>(scale)) else {
            return;
        };
        let width = size.width.min(area_size.width);
        let height = size.height.min(area_size.height);
        let max_x = (area_pos.x + area_size.width - width).max(area_pos.x);
        let max_y = (area_pos.y + area_size.height - height).max(area_pos.y);
        let x = pos.x.clamp(area_pos.x, max_x);
        let y = pos.y.clamp(area_pos.y, max_y);
        if (x - pos.x).abs() > 0.5 || (y - pos.y).abs() > 0.5 {
            window.set_outer_position(slint::winit_030::winit::dpi::LogicalPosition::new(x, y));
        }
    });
}

/// saveScreenConfig: the bounds, or the initial size when maximized.
fn save(ui: &AppWindow) {
    let Some(db) = shell::db() else { return };
    let window = ui.window();
    let state = if window.is_maximized() {
        let (width, height) = INITIAL.with(Cell::get);
        json!({ "width": width, "height": height, "isMaximized": true })
    } else {
        let scale = window.scale_factor();
        let size = window.size().to_logical(scale);
        let position = window.position().to_logical(scale);
        json!({
            "x": position.x.round(),
            "y": position.y.round(),
            "width": size.width.round(),
            "height": size.height.round(),
            "isMaximized": false,
        })
    };
    let _ = db.put(keys::SCREEN_STATE, &state);
}

/// mainWindow.on("close"): save the bounds, then quit (preferQuitInsteadOfHiding,
/// or no tray to come back from) or hide to the tray.
pub fn close(ui: &AppWindow) {
    save(ui);
    let quit = crate::prefs::flag(&crate::prefs::get(), "preferQuitInsteadOfHiding")
        || !crate::tray::available();
    if quit {
        let _ = slint::quit_event_loop();
        return;
    }
    let _ = ui.hide();
    // Electron destroys the window and opens a fresh one from the tray: start
    // over at the start page now, which also stops the game page media.
    crate::nav::reset(&start_path());
}

/// The first page of a new main window (window-manager.ts initialHash).
pub fn start_path() -> String {
    if crate::prefs::flag(&crate::prefs::get(), "launchToLibraryPage") {
        "/library".into()
    } else {
        "/".into()
    }
}

pub fn init(ui: &AppWindow) {
    let weak = ui.as_weak();
    ui.window().on_close_requested(move || {
        if let Some(ui) = weak.upgrade() {
            close(&ui);
        }
        slint::CloseRequestResponse::KeepWindowShown
    });
}
