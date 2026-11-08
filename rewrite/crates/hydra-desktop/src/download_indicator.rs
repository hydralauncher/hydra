//! sidebar-download-icon.tsx + download-indicator.ts + download-flight.ts:
//! the Downloads icon's state (idle, downloading, paused, extracting,
//! preparing; progress; games left) and the flight that carries a new
//! download into it.

use std::cell::RefCell;
use std::time::Duration;

use hydra_downloads::layout::{self, Download};
use hydra_downloads::manager::Progress;
use hydra_media::images::{Loader, Op, Source};
use slint::{ComponentHandle, Timer};

use crate::{AppWindow, Flight, SidebarState};

/// A download that never reports back stops holding the icon after this long.
const HOLD_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct IndicatorState {
    pub phase: &'static str,
    pub progress: Option<f64>,
    pub games: usize,
}

const IDLE: IndicatorState = IndicatorState {
    phase: "idle",
    progress: None,
    games: 0,
};

struct State {
    ui: slint::Weak<AppWindow>,
    loader: Loader,
    /// While a download flies in, the icon keeps the look from before the click.
    held: Option<IndicatorState>,
    live: IndicatorState,
    hold_timer: Timer,
    landing_timer: Timer,
    finish_timer: Timer,
    flying: bool,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> Option<R> {
    STATE.with(|s| s.borrow_mut().as_mut().map(f))
}

pub fn init(ui: &AppWindow, loader: &Loader) {
    STATE.with(|s| {
        *s.borrow_mut() = Some(State {
            ui: ui.as_weak(),
            loader: loader.clone(),
            held: None,
            live: IDLE,
            hold_timer: Timer::default(),
            landing_timer: Timer::default(),
            finish_timer: Timer::default(),
            flying: false,
        })
    });
}

/// getDownloadIndicatorState
pub fn compute(
    downloads: &[Download],
    packet: Option<&Progress>,
    queue_order: &[String],
) -> IndicatorState {
    let tracked: Vec<&Download> = downloads
        .iter()
        .filter(|d| layout::status(d) != "removed")
        .collect();
    let queued: Vec<&Download> = tracked
        .iter()
        .copied()
        .filter(|d| layout::is_queued(d))
        .collect();
    let games = 1 + queued.len();
    if let Some(p) = packet {
        if p.is_downloading_metadata || p.is_reconnecting {
            return IndicatorState {
                phase: "preparing",
                progress: None,
                games,
            };
        }
        let progress = if p.is_recovering {
            p.recovery_progress
        } else {
            p.progress
        };
        return IndicatorState {
            phase: "downloading",
            progress: Some(progress),
            games,
        };
    }
    // TODO(downloads): the extraction packet (state.download.extraction).
    if let Some(active) = tracked.iter().find(|d| layout::is_active_like(d)) {
        let extracting = active.get("extracting").and_then(|v| v.as_bool()) == Some(true)
            || layout::status(active) == "extracting";
        if extracting {
            let progress = active.get("extractionProgress").and_then(|v| v.as_f64());
            return IndicatorState {
                phase: "extracting",
                progress,
                games,
            };
        }
        return IndicatorState {
            phase: "preparing",
            progress: None,
            games,
        };
    }
    if queued.is_empty() {
        return IDLE;
    }
    let position = |d: &Download| {
        queue_order
            .iter()
            .position(|id| *id == layout::id(d))
            .unwrap_or(usize::MAX)
    };
    let timestamp = |d: &Download| d.get("timestamp").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let head = queued
        .iter()
        .min_by(|a, b| {
            position(a).cmp(&position(b)).then(
                timestamp(a)
                    .partial_cmp(&timestamp(b))
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
        })
        .expect("queued is not empty");
    IndicatorState {
        phase: "paused",
        progress: head.get("progress").and_then(|v| v.as_f64()),
        games: queued.len(),
    }
}

fn apply(ui: &AppWindow, state: IndicatorState) {
    let s = ui.global::<SidebarState>();
    s.set_download_phase(state.phase.into());
    s.set_download_progress(state.progress.unwrap_or(0.0) as f32);
    s.set_download_has_progress(state.progress.is_some());
    s.set_download_games(state.games as i32);
}

/// A new live state (from the Downloads page refresh).
pub fn update(state: IndicatorState) {
    let Some((ui, held)) = with(|s| {
        s.live = state;
        (s.ui.upgrade(), s.held)
    }) else {
        return;
    };
    if let (Some(ui), None) = (ui, held) {
        apply(&ui, state);
    }
}

fn release() {
    let Some((ui, live)) = with(|s| {
        s.held = None;
        s.hold_timer.stop();
        (s.ui.upgrade(), s.live)
    }) else {
        return;
    };
    if let Some(ui) = ui {
        apply(&ui, live);
    }
}

/// beginDownloadFlight: hold the icon's look until the download lands.
pub fn begin_flight() {
    with(|s| {
        if s.held.is_none() {
            s.held = Some(s.live);
        }
        s.hold_timer
            .start(slint::TimerMode::SingleShot, HOLD_TIMEOUT, release);
    });
}

/// The download did not start.
pub fn cancel_flight() {
    release();
}

/// The download started: fly into Downloads (flyToDownloads).
pub fn launch_flight(icon_url: Option<String>) {
    let Some((ui, loader, flying)) = with(|s| (s.ui.upgrade(), s.loader.clone(), s.flying)) else {
        return;
    };
    let Some(ui) = ui else { return };
    // Its page is open and shows the new row: no flight.
    if ui.global::<crate::Nav>().get_path() == "/downloads" {
        release();
        return;
    }
    let flight = ui.global::<Flight>();
    if flying {
        // The icon still reacts, in place.
        land();
        return;
    }
    let spark = icon_url.is_none();
    // ICON_FLIGHT / SPARK_FLIGHT: lift + travel, then the absorb
    let (arrival, duration) = if spark {
        (110 + 480, 110 + 480 + 70)
    } else {
        (170 + 600, 170 + 600 + 90)
    };
    flight.set_to_x(flight.get_icon_x());
    flight.set_to_y(flight.get_icon_y());
    flight.set_spark(spark);
    flight.set_image(slint::Image::default());
    if let Some(url) = icon_url {
        let weak = ui.as_weak();
        loader.load(Source::Url(url), Op::MaxWidth(88), move |img| {
            if let Some(ui) = weak.upgrade() {
                ui.global::<Flight>().set_image(img);
            }
        });
    }
    flight.invoke_launch();
    with(|s| {
        s.flying = true;
        s.landing_timer.start(
            slint::TimerMode::SingleShot,
            Duration::from_millis(arrival),
            land,
        );
        let weak = ui.as_weak();
        s.finish_timer.start(
            slint::TimerMode::SingleShot,
            Duration::from_millis(duration),
            move || {
                with(|s| s.flying = false);
                if let Some(ui) = weak.upgrade() {
                    ui.global::<Flight>().set_flying(false);
                }
            },
        );
    });
}

/// The flyer reached the icon: show the live state, catch, flash.
fn land() {
    release();
    if let Some(ui) = with(|s| s.ui.upgrade()).flatten() {
        let s = ui.global::<SidebarState>();
        s.set_download_catch(s.get_download_catch() + 1);
    }
}
