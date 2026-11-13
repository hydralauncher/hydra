//! `HYDRA_DEV_FRAMES=1`: one stderr line per redraw with the time since
//! start, the gap since the previous redraw and the library scroll offset.
//! For finding stutters and checking scroll curves against Electron. Costs
//! nothing when the variable is unset. (Skia on Direct3D never calls Slint's
//! rendering notifier, so this hooks winit's RedrawRequested instead.)

use std::cell::Cell;
use std::sync::OnceLock;
use std::time::Instant;

use slint::ComponentHandle;

use crate::{AppWindow, LibraryData};

static STARTED: OnceLock<Instant> = OnceLock::new();

thread_local! {
    static LAST: Cell<Option<Instant>> = const { Cell::new(None) };
}

pub fn enabled() -> bool {
    STARTED.get().is_some()
}

pub fn install(ui: &AppWindow) {
    if std::env::var_os("HYDRA_DEV_FRAMES").is_none() {
        return;
    }
    ui.global::<LibraryData>().set_trace(true);
    let _ = STARTED.set(Instant::now());
}

/// winit's RedrawRequested
pub fn on_redraw(ui: &AppWindow) {
    let Some(started) = STARTED.get() else { return };
    let now = Instant::now();
    let gap = LAST.with(|last| {
        let gap = last
            .get()
            .map_or(0.0, |l| now.duration_since(l).as_secs_f64() * 1000.0);
        last.set(Some(now));
        gap
    });
    eprintln!(
        "[frame] t={:.1} gap={:.1} render=0 offset={:.1}",
        now.duration_since(*started).as_secs_f64() * 1000.0,
        gap,
        ui.global::<LibraryData>().get_shown_offset()
    );
}
