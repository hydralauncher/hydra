//! Achievement unlock notifications: achievement-unlock-notifications.ts
//! (where each unlock goes), notifyCombinedAchievementsUnlocked, the custom
//! notification window (achievement-notification-presenter.ts and its
//! Electron host, pages/achievements/notification/achievement-notification.tsx)
//! and showAchievementTestNotification.
//!
//! The window is a separate frameless, transparent, always-on-top 360x180
//! Slint window on the primary monitor, created with the first queued
//! notification and dropped when the queue is empty. It never takes focus,
//! ignores the mouse and stays off the taskbar. Each notification plays the
//! SCSS keyframes (450ms in, wait, expand; 4s on screen; 450ms out); the first
//! of a batch plays the achievement sound at the user's volume. When the
//! window can't be shown, the batch falls back to OS toasts.
//!
//! Not ported: Linux's in-app overlay (sendAchievementToFocusedWindow; Linux
//! uses OS notifications), souvenir screenshot notifications.

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use hydra_core::achievement_watcher::{NotificationInfo, UnlockNotice};
use hydra_media::images::{self, Op, Source};
use hydra_media::sound::{self, Clip};
use serde_json::Value;
use slint::{ComponentHandle, Image, SharedString};

use crate::{AchievementNotificationWindow, NotificationCard, NotificationFrame, prefs, shell};

/// NOTIFICATION_TIMEOUT
const SHOWN: f32 = 4_000.0;
/// CLOSING_TIMEOUT
const CLOSING: f32 = 450.0;
/// IMAGE_PREPARATION_TIMEOUT
const ICON_TIMEOUT: Duration = Duration::from_millis(2_000);
const WIDTH: f64 = 360.0;
const HEIGHT: f64 = 180.0;
/// Hidden width of the collapsed card (content-in / content-wait).
const COLLAPSED: f32 = 80.0;
/// calc(360px - $margin-horizontal)
const EXPANDED: f32 = 320.0;

static SOUND: &[u8] = include_bytes!("../../../../resources/achievement.wav");

// ---- frames -------------------------------------------------------------

/// CSS `ease-in-out`: cubic-bezier(0.42, 0, 0.58, 1).
pub fn ease_in_out(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    let bezier = |t: f32, a: f32, b: f32| {
        let u = 1.0 - t;
        3.0 * u * u * t * a + 3.0 * u * t * t * b + t * t * t
    };
    let (mut low, mut high) = (0.0f32, 1.0f32);
    for _ in 0..30 {
        let mid = (low + high) / 2.0;
        if bezier(mid, 0.42, 0.58) < x {
            low = mid;
        } else {
            high = mid;
        }
    }
    bezier((low + high) / 2.0, 0.0, 1.0)
}

/// Eased progress of a keyframe segment that starts at `start` and lasts `duration`.
fn segment(t: f32, start: f32, duration: f32) -> f32 {
    ease_in_out((t - start) / duration)
}

/// The card `t` ms after it started playing (achievement-notification.scss keyframes).
pub fn frame_at(t: f32) -> NotificationFrame {
    let intro = if t < 450.0 {
        segment(t, 0.0, 450.0)
    } else {
        1.0
    };
    let reveal = segment(t, 900.0, 450.0);
    let revealing = t >= 900.0;
    let ellipses = if t < 900.0 {
        segment(t, 0.0, 900.0)
    } else {
        1.0
    };
    NotificationFrame {
        // content-in (scale, opacity), content-wait, content-expand
        outer_scale: intro,
        outer_opacity: intro,
        outer_width: if t < 900.0 {
            COLLAPSED
        } else {
            COLLAPSED + (EXPANDED - COLLAPSED) * reveal
        },
        outer_dy: 0.0,
        // dark-overlay: 0.7 until 50%, then out (900ms)
        dark_opacity: if t < 450.0 {
            0.7
        } else {
            0.7 * (1.0 - segment(t, 450.0, 450.0))
        },
        // trophy-out: 1 until 50%, then out (900ms)
        trophy_opacity: if t < 450.0 {
            1.0
        } else {
            1.0 - segment(t, 450.0, 450.0)
        },
        // ellipses-out: fade and grow to 1.5 (900ms), then the element's own opacity 0
        ellipses_opacity: if t < 900.0 { 1.0 - ellipses } else { 0.0 },
        ellipses_scale: if t < 900.0 { 1.0 + 0.5 * ellipses } else { 1.0 },
        // title-in / description-in at 900ms (hidden by the collapsed card before)
        title_dy: if revealing {
            10.0 * (1.0 - reveal)
        } else {
            0.0
        },
        title_opacity: if revealing { reveal } else { 1.0 },
        description_dy: if revealing {
            20.0 * (1.0 - reveal)
        } else {
            0.0
        },
        description_opacity: if revealing { reveal } else { 1.0 },
        // chip-stand-by, then chip-in at 900ms
        chip_dy: if revealing {
            20.0 * (1.0 - reveal)
        } else {
            0.0
        },
        chip_opacity: if revealing { reveal } else { 0.0 },
        // --rare shine at 1350ms
        shine_x: if (1350.0..1800.0).contains(&t) {
            420.0 * segment(t, 1350.0, 450.0)
        } else {
            0.0
        },
    }
}

/// `--closing`: every other animation off, content-out on the card and the chip.
pub fn closing_frame(t: f32) -> NotificationFrame {
    let out = segment(t, 0.0, CLOSING);
    NotificationFrame {
        outer_width: EXPANDED,
        outer_scale: 1.0,
        outer_opacity: 1.0 - out,
        outer_dy: -20.0 * out,
        dark_opacity: 0.0,
        trophy_opacity: 0.0,
        ellipses_opacity: 0.0,
        ellipses_scale: 1.0,
        title_dy: 0.0,
        title_opacity: 1.0,
        description_dy: 0.0,
        description_opacity: 1.0,
        chip_dy: -20.0 * out,
        chip_opacity: 1.0 - out,
        shine_x: 0.0,
    }
}

// ---- preferences --------------------------------------------------------

fn pref_bool(p: &serde_json::Map<String, Value>, key: &str) -> Option<bool> {
    p.get(key).and_then(Value::as_bool)
}

/// achievementCustomNotificationPosition ?? "top-left"
fn position() -> String {
    prefs::get()
        .get("achievementCustomNotificationPosition")
        .and_then(Value::as_str)
        .filter(|p| !p.is_empty())
        .unwrap_or("top-left")
        .to_string()
}

/// getAchievementSoundVolume: achievementSoundVolume ?? 0.15
fn volume() -> f32 {
    prefs::get()
        .get("achievementSoundVolume")
        .and_then(Value::as_f64)
        .unwrap_or(0.15) as f32
}

/// The achievement sound at the user's volume.
pub fn play_sound() {
    // scripted headless runs stay silent
    if std::env::var_os("HYDRA_HEADLESS").is_some() {
        eprintln!(
            "achievements: sound at volume {} (muted: headless)",
            volume()
        );
        return;
    }
    static CLIP: OnceLock<Option<Arc<Clip>>> = OnceLock::new();
    if let Some(clip) = CLIP.get_or_init(|| sound::decode_wav(SOUND).map(Arc::new)) {
        sound::play(clip.clone(), volume());
    }
}

// ---- where notifications go ---------------------------------------------

fn os_unlocked(notice: &UnlockNotice, infos: &[NotificationInfo], sound_played: bool) {
    crate::notify::achievement_unlocked(
        infos
            .iter()
            .map(|a| (a.title.clone(), a.icon_url.clone()))
            .collect(),
        notice.unlocked_count,
        notice.total_count,
        notice.game_title.clone(),
        notice.game_icon.clone(),
    );
    // on-achievement-unlocked: the main window plays the sound unless suppressed
    if !sound_played {
        play_sound();
    }
}

fn os_combined(achievements: usize, games: usize) {
    crate::notify::achievements_combined(achievements, games);
    play_sound();
}

/// publishAchievementUnlockNotifications (UI thread).
pub fn publish_unlock(notice: UnlockNotice) {
    let p = prefs::get();
    if notice.achievements.is_empty()
        || pref_bool(&p, "achievementNotificationsEnabled") == Some(false)
    {
        return;
    }
    let custom = pref_bool(&p, "achievementCustomNotificationsEnabled") != Some(false)
        && !cfg!(target_os = "macos");
    if cfg!(windows) && custom {
        let fallback_notice = notice.clone();
        enqueue_achievements(
            &position(),
            notice.achievements,
            Some(Box::new(move |infos, sound_played| {
                os_unlocked(&fallback_notice, &infos, sound_played)
            })),
        );
    } else {
        // TODO(linux): the in-app overlay in the focused main window
        os_unlocked(&notice, &notice.achievements, false);
    }
}

/// notifyCombinedAchievementsUnlocked: "X achievements in Y games" (UI thread).
pub fn publish_combined(games: usize, achievements: usize) {
    let p = prefs::get();
    let custom = pref_bool(&p, "achievementNotificationsEnabled") != Some(false)
        && pref_bool(&p, "achievementCustomNotificationsEnabled") != Some(false)
        && cfg!(windows);
    if custom {
        with(|s| {
            let batch = s.next_batch();
            s.queue.push_back(Item {
                kind: Kind::Combined {
                    games,
                    achievements,
                },
                position: position(),
                batch,
                fallback: Some(Rc::new(Fallback::new(Box::new(move |_, _| {
                    os_combined(achievements, games)
                })))),
                shown: Cell::new(false),
            });
        });
        present();
    } else {
        os_combined(achievements, games);
    }
}

/// showAchievementTestNotification: a plain, a rare hidden and a platinum one.
pub fn show_test() {
    let test = |rare: bool, hidden: bool, platinum: bool| NotificationInfo {
        title: shell::tr("notifications.test_achievement_notification_title"),
        description: Some(shell::tr(
            "notifications.test_achievement_notification_description",
        )),
        icon_url: "https://cdn.losbroxas.org/favicon.svg".into(),
        points: Some(2440),
        hidden,
        rare,
        platinum,
    };
    let achievements = vec![
        test(false, false, false),
        test(true, true, false),
        test(false, false, true),
    ];
    if cfg!(windows) {
        enqueue_achievements(&position(), achievements, None);
    } else {
        eprintln!("TODO(linux): the in-app test notification");
    }
}

// ---- the presenter ------------------------------------------------------

type FallbackFn = Box<dyn FnOnce(Vec<NotificationInfo>, bool)>;

/// FallbackReference: one per batch, called once with what was never shown.
struct Fallback {
    callback: RefCell<Option<FallbackFn>>,
    sound_played: Cell<bool>,
}

impl Fallback {
    fn new(callback: FallbackFn) -> Self {
        Self {
            callback: RefCell::new(Some(callback)),
            sound_played: Cell::new(false),
        }
    }
}

enum Kind {
    Achievement(NotificationInfo),
    Combined { games: usize, achievements: usize },
}

struct Item {
    kind: Kind,
    position: String,
    batch: u64,
    fallback: Option<Rc<Fallback>>,
    shown: Cell<bool>,
}

#[derive(Clone, Copy, PartialEq)]
enum Stage {
    Idle,
    Preparing,
    /// shown, waiting for the native window and two frames (arm-notification-animations.ts)
    Arming {
        since: Instant,
        frames: u8,
    },
    Playing(Instant),
    Closing(Instant),
}

struct Presenter {
    queue: VecDeque<Item>,
    active: Option<Item>,
    stage: Stage,
    window: Option<AchievementNotificationWindow>,
    window_position: String,
    /// the native per-pixel-alpha window the card is drawn into (Windows)
    #[cfg(windows)]
    layered: Option<crate::layered_window::LayeredWindow>,
    /// the frame last drawn into it
    drawn: Option<NotificationFrame>,
    timer: slint::Timer,
    played_batch: Option<u64>,
    batches: u64,
    /// bumps on every new preparation (late icon loads are dropped)
    generation: u64,
}

impl Presenter {
    fn next_batch(&mut self) -> u64 {
        self.batches += 1;
        self.batches
    }
}

thread_local! {
    static PRESENTER: RefCell<Presenter> = RefCell::new(Presenter {
        queue: VecDeque::new(),
        active: None,
        stage: Stage::Idle,
        window: None,
        window_position: String::new(),
        #[cfg(windows)]
        layered: None,
        drawn: None,
        timer: slint::Timer::default(),
        played_batch: None,
        batches: 0,
        generation: 0,
    });
}

fn with<R>(f: impl FnOnce(&mut Presenter) -> R) -> R {
    PRESENTER.with(|p| f(&mut p.borrow_mut()))
}

/// enqueueAchievements: one request per achievement, one batch.
fn enqueue_achievements(
    position: &str,
    achievements: Vec<NotificationInfo>,
    fallback: Option<FallbackFn>,
) {
    if achievements.is_empty() {
        return;
    }
    let fallback = fallback.map(|f| Rc::new(Fallback::new(f)));
    with(|s| {
        let batch = s.next_batch();
        for achievement in achievements {
            s.queue.push_back(Item {
                kind: Kind::Achievement(achievement),
                position: position.to_string(),
                batch,
                fallback: fallback.clone(),
                shown: Cell::new(false),
            });
        }
    });
    present();
}

fn present() {
    if with(|s| s.active.is_none()) {
        process_next();
    }
}

/// processNext: prepare the next request (its icon, 2s at most), then show it.
fn process_next() {
    let next = with(|s| {
        let item = s.queue.pop_front()?;
        s.generation += 1;
        s.stage = Stage::Preparing;
        let prepared = match &item.kind {
            Kind::Achievement(info) => (info.icon_url.clone(), card_of(info)),
            Kind::Combined {
                games,
                achievements,
            } => (String::new(), combined_card(*games, *achievements)),
        };
        s.active = Some(item);
        Some((s.generation, prepared))
    });
    let Some((generation, (icon_url, card))) = next else {
        destroy_window();
        return;
    };
    if icon_url.is_empty() {
        show(generation, card);
        return;
    }
    // resolveImageUrl: the icon, else the Hydra logo after an error or 2s
    let pending = Rc::new(Cell::new(true));
    {
        let pending = pending.clone();
        let card = card.clone();
        slint::Timer::single_shot(ICON_TIMEOUT, move || {
            if pending.replace(false) {
                show(generation, card);
            }
        });
    }
    load_icon(icon_url, move |icon| {
        if pending.replace(false) {
            let mut card = card;
            if let Some(icon) = icon {
                card.icon = icon;
                card.logo = false;
            }
            show(generation, card);
        }
    });
}

/// A request's icon callback, run on the UI thread.
type IconCallback = Box<dyn FnOnce(Option<Image>)>;

thread_local! {
    /// icon callbacks waiting for their worker, by request
    static ICON_CALLBACKS: RefCell<std::collections::HashMap<u64, IconCallback>> =
        RefCell::new(std::collections::HashMap::new());
}

/// Fetches an icon on the loader's workers (SVG through Slint's renderer).
fn load_icon(url: String, done: impl FnOnce(Option<Image>) + 'static) {
    let Some((loader, scale)) = shell::loader() else {
        done(None);
        return;
    };
    let size = (64.0 * scale).ceil() as u32;
    let id = with(|s| s.generation);
    ICON_CALLBACKS.with(|c| c.borrow_mut().insert(id, Box::new(done)));
    loader.run(move |http| {
        let bytes = images::fetch(http, &Source::Url(url.clone()));
        let svg = url.to_lowercase().ends_with(".svg")
            || bytes
                .as_ref()
                .is_some_and(|b| String::from_utf8_lossy(&b[..b.len().min(256)]).contains("<svg"));
        let pixels = if svg {
            None
        } else {
            bytes
                .as_deref()
                .and_then(|b| images::decode_bytes(b, Op::MaxWidth(size)))
        };
        let _ = slint::invoke_from_event_loop(move || {
            let Some(done) = ICON_CALLBACKS.with(|c| c.borrow_mut().remove(&id)) else {
                return;
            };
            let image = match (pixels, svg, bytes) {
                (Some(pixels), _, _) => Some(pixels.into_image()),
                (None, true, Some(bytes)) => Image::load_from_svg_data(&bytes).ok(),
                _ => None,
            };
            done(image);
        });
    });
}

fn logo() -> Image {
    // the window's own copy of hydra.svg
    static LOGO: &[u8] = include_bytes!("../ui/icons/hydra-notification.svg");
    Image::load_from_svg_data(LOGO).unwrap_or_default()
}

fn card_of(info: &NotificationInfo) -> NotificationCard {
    NotificationCard {
        title: info.title.clone().into(),
        description: info.description.clone().unwrap_or_default().into(),
        icon: logo(),
        logo: true,
        hidden: info.hidden,
        rare: info.rare,
        platinum: info.platinum,
        points: info
            .points
            .map(|p| format!("+{p}"))
            .unwrap_or_default()
            .into(),
    }
}

/// The combined request's content: "New achievements", "N achievements on M games".
fn combined_card(games: usize, achievements: usize) -> NotificationCard {
    let i18n = shell::i18n();
    let count = |key: &str, n: usize| {
        i18n.as_ref()
            .map(|i| i.t_count(key, n as f64, &[]))
            .unwrap_or_default()
    };
    NotificationCard {
        title: shell::tr("achievement.new_achievements").into(),
        description: shell::tr_with(
            "achievement.new_achievements_description",
            &[
                (
                    "achievements",
                    count(
                        "achievement.new_achievements_achievement_count",
                        achievements,
                    )
                    .into(),
                ),
                (
                    "games",
                    count("achievement.new_achievements_game_count", games).into(),
                ),
            ],
        )
        .into(),
        icon: logo(),
        logo: true,
        hidden: false,
        rare: false,
        platinum: false,
        points: SharedString::default(),
    }
}

/// Shows the prepared card: the window first (created or moved), then playback.
fn show(generation: u64, card: NotificationCard) {
    let Some(position) = with(|s| {
        (s.generation == generation && s.stage == Stage::Preparing)
            .then(|| s.active.as_ref().map(|i| i.position.clone()))
            .flatten()
    }) else {
        return;
    };
    let Some(window) = ensure_window(&position) else {
        fail("failed to create notification window");
        return;
    };
    window.set_card(card);
    window.set_right(position.ends_with("right"));
    window.set_bottom(position.starts_with("bottom"));
    // the first frame is invisible (scale 0, opacity 0) until playback starts
    window.set_frame(frame_at(0.0));
    window.set_shown(true);
    with(|s| {
        s.stage = Stage::Arming {
            since: Instant::now(),
            frames: 0,
        };
        s.timer
            .start(slint::TimerMode::Repeated, Duration::from_millis(16), tick);
    });
}

/// beginPlayback: the clock starts, the first of a batch plays the sound.
fn begin_playback() {
    let play = with(|s| {
        s.stage = Stage::Playing(Instant::now());
        let Some(item) = &s.active else {
            return false;
        };
        item.shown.set(true);
        let batch = item.batch;
        let first_of_batch = s.played_batch != Some(batch);
        s.played_batch = Some(batch);
        if first_of_batch && let Some(fallback) = &item.fallback {
            fallback.sound_played.set(true);
        }
        first_of_batch
    });
    if play {
        play_sound();
    }
}

/// ARMING_TIMEOUT
const ARMING_TIMEOUT: Duration = Duration::from_millis(1_000);

thread_local! {
    /// dev script: the playing card held at this time (ms; 4000+ is the closing)
    static PINNED: Cell<Option<f32>> = const { Cell::new(None) };
}

/// Pins (or with None releases) the animation clock, for frame-exact shots.
pub fn dev_pin(ms: Option<f32>) {
    PINNED.with(|p| p.set(ms));
}

/// One animation frame; moves on to closing, then to the next request.
fn tick() {
    let (stage, window) = with(|s| (s.stage, s.window.as_ref().map(|w| w.clone_strong())));
    let Some(window) = window else {
        return;
    };
    if let Some(t) = PINNED.with(Cell::get)
        && matches!(stage, Stage::Playing(_) | Stage::Closing(_))
    {
        window.set_frame(if t < SHOWN {
            frame_at(t)
        } else {
            closing_frame(t - SHOWN)
        });
        draw(&window);
        return;
    }
    match stage {
        // armNotificationAnimations: two frames on screen before the clock starts
        Stage::Arming { since, frames } => {
            with(|s| {
                s.stage = Stage::Arming {
                    since,
                    frames: frames + 1,
                }
            });
            if frames + 1 >= 2 {
                begin_playback();
            } else if since.elapsed() > ARMING_TIMEOUT {
                fail("notification window did not become visible");
                return;
            }
        }
        Stage::Playing(started) => {
            let t = started.elapsed().as_secs_f32() * 1000.0;
            if t >= SHOWN {
                with(|s| s.stage = Stage::Closing(Instant::now()));
                window.set_frame(closing_frame(0.0));
            } else {
                window.set_frame(frame_at(t));
            }
        }
        Stage::Closing(started) => {
            let t = started.elapsed().as_secs_f32() * 1000.0;
            if t >= CLOSING {
                finish();
                return;
            }
            window.set_frame(closing_frame(t));
        }
        Stage::Idle | Stage::Preparing => {}
    }
    draw(&window);
}

/// handleFinishedEvent: hide the card; the next request, or drop the window.
fn finish() {
    let window = with(|s| {
        s.timer.stop();
        s.active = None;
        s.stage = Stage::Idle;
        s.window.as_ref().map(|w| w.clone_strong())
    });
    if let Some(window) = window {
        window.set_shown(false);
    }
    // host.hide(): nothing on screen until the next card
    #[cfg(windows)]
    with(|s| {
        s.drawn = None;
        if let Some(layered) = s.layered.as_mut() {
            layered.clear();
        }
    });
    process_next();
}

/// failHost: every request not shown yet goes to its batch's fallback.
fn fail(reason: &str) {
    eprintln!("Achievement notification host failed: {reason}");
    let failed: Vec<Item> = with(|s| {
        s.timer.stop();
        s.stage = Stage::Idle;
        s.active
            .take()
            .into_iter()
            .chain(s.queue.drain(..))
            .collect()
    });
    destroy_window();
    let mut groups: Vec<(Rc<Fallback>, Vec<NotificationInfo>)> = Vec::new();
    for item in failed {
        let Some(fallback) = item.fallback else {
            continue;
        };
        if item.shown.get() || fallback.callback.borrow().is_none() {
            continue;
        }
        let info = match item.kind {
            Kind::Achievement(info) => Some(info),
            Kind::Combined { .. } => None,
        };
        match groups.iter_mut().find(|(f, _)| Rc::ptr_eq(f, &fallback)) {
            Some((_, list)) => list.extend(info),
            None => groups.push((fallback, info.into_iter().collect())),
        }
    }
    for (fallback, infos) in groups {
        if let Some(callback) = fallback.callback.borrow_mut().take() {
            callback(infos, fallback.sound_played.get());
        }
    }
}

// ---- the window ---------------------------------------------------------

/// getNotificationWindowPosition: the primary display's corner, edge center or
/// corner, in physical pixels, and the display's scale.
fn window_position(position: &str) -> (i32, i32, f64) {
    let (x, y, width, height, scale) = primary_display();
    let w = (WIDTH * scale).round();
    let h = (HEIGHT * scale).round();
    let left = if position.ends_with("center") {
        x + (width - w) / 2.0
    } else if position.ends_with("right") {
        x + width - w
    } else {
        x
    };
    let top = if position.starts_with("bottom") {
        y + height - h
    } else {
        y
    };
    (left.round() as i32, top.round() as i32, scale)
}

/// screen.getPrimaryDisplay().bounds in physical pixels, and its scale.
#[cfg(windows)]
fn primary_display() -> (f64, f64, f64, f64, f64) {
    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }
    #[repr(C)]
    struct MonitorInfo {
        size: u32,
        monitor: Rect,
        work: Rect,
        flags: u32,
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn MonitorFromPoint(point: i64, flags: u32) -> isize;
        fn GetMonitorInfoW(monitor: isize, info: *mut MonitorInfo) -> i32;
    }
    #[link(name = "shcore")]
    unsafe extern "system" {
        fn GetDpiForMonitor(monitor: isize, kind: i32, x: *mut u32, y: *mut u32) -> i32;
    }
    const MONITOR_DEFAULTTOPRIMARY: u32 = 1;
    // SAFETY: plain Win32 queries; POINT {0, 0} passed by value as one i64.
    unsafe {
        let monitor = MonitorFromPoint(0, MONITOR_DEFAULTTOPRIMARY);
        let mut info = MonitorInfo {
            size: std::mem::size_of::<MonitorInfo>() as u32,
            monitor: Rect {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 1080,
            },
            work: Rect {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            flags: 0,
        };
        GetMonitorInfoW(monitor, &mut info);
        let (mut dpi_x, mut dpi_y) = (96u32, 96u32);
        if GetDpiForMonitor(monitor, 0, &mut dpi_x, &mut dpi_y) != 0 {
            dpi_x = 96;
        }
        let r = info.monitor;
        (
            r.left as f64,
            r.top as f64,
            (r.right - r.left) as f64,
            (r.bottom - r.top) as f64,
            dpi_x as f64 / 96.0,
        )
    }
}

#[cfg(not(windows))]
fn primary_display() -> (f64, f64, f64, f64, f64) {
    (0.0, 0.0, 1920.0, 1080.0, 1.0)
}

fn headless() -> bool {
    std::env::var_os("HYDRA_HEADLESS").is_some()
}

/// The card's component (never shown itself: Skia renders it for the native
/// window) and, on Windows, the layered window, created on first use and
/// moved when the position changes.
fn ensure_window(position: &str) -> Option<AchievementNotificationWindow> {
    let (x, y, scale) = window_position(position);
    if let Some(window) = with(|s| s.window.as_ref().map(|w| w.clone_strong())) {
        if with(|s| s.window_position != position) {
            #[cfg(windows)]
            with(|s| {
                if let Some(layered) = s.layered.as_mut() {
                    layered.move_to(x, y);
                }
            });
            with(|s| s.window_position = position.to_string());
        }
        return Some(window);
    }
    let window = AchievementNotificationWindow::new().ok()?;
    if !headless() {
        window
            .window()
            .dispatch_event(slint::platform::WindowEvent::ScaleFactorChanged {
                scale_factor: scale as f32,
            });
    }
    window
        .window()
        .set_size(slint::LogicalSize::new(WIDTH as f32, HEIGHT as f32));
    if !headless() {
        window.window().set_size(slint::PhysicalSize::new(
            (WIDTH * scale).round() as u32,
            (HEIGHT * scale).round() as u32,
        ));
    }
    #[cfg(windows)]
    if !headless() {
        let layered = crate::layered_window::LayeredWindow::new(
            x,
            y,
            (WIDTH * scale).round() as i32,
            (HEIGHT * scale).round() as i32,
        )?;
        with(|s| s.layered = Some(layered));
    }
    with(|s| {
        s.window = Some(window.clone_strong());
        s.window_position = position.to_string();
        s.drawn = None;
    });
    Some(window)
}

/// Draws the current frame into the layered window when it changed: two Skia
/// renders, over black and over white, give the per-pixel alpha.
fn draw(window: &AchievementNotificationWindow) {
    #[cfg(windows)]
    {
        let frame = window.get_frame();
        let unchanged = with(|s| {
            s.layered.is_none() || !window.get_shown() || s.drawn.as_ref() == Some(&frame)
        });
        if unchanged {
            return;
        }
        window.set_matte(slint::Color::from_rgb_u8(0, 0, 0));
        let over_black = window.window().take_snapshot();
        window.set_matte(slint::Color::from_rgb_u8(255, 255, 255));
        let over_white = window.window().take_snapshot();
        window.set_matte(slint::Color::from_argb_u8(0, 0, 0, 0));
        let (Ok(over_black), Ok(over_white)) = (over_black, over_white) else {
            eprintln!("achievements: notification snapshot failed");
            return;
        };
        with(|s| {
            let Some(layered) = s.layered.as_mut() else {
                return;
            };
            // the unshown window may report its default size; the card is
            // drawn at the origin, so the top-left part is the frame
            let (width, height) = layered.size();
            if over_black.width() < width || over_black.height() < height {
                eprintln!(
                    "achievements: notification frame {}x{} for a {width}x{height} window",
                    over_black.width(),
                    over_black.height(),
                );
                return;
            }
            layered.present_mattes(
                over_black.as_bytes(),
                over_white.as_bytes(),
                over_black.width(),
            );
            s.drawn = Some(frame);
        });
    }
    #[cfg(not(windows))]
    let _ = window;
}

fn destroy_window() {
    let window = with(|s| {
        s.timer.stop();
        s.window_position.clear();
        s.drawn = None;
        #[cfg(windows)]
        {
            s.layered = None;
        }
        s.window.take()
    });
    drop(window);
}

/// presenter.dispose() (updateAchievementCustomNotificationWindow): drop the
/// queue and the window, without fallbacks.
pub fn dispose() {
    with(|s| {
        s.generation += 1;
        s.queue.clear();
        s.active = None;
        s.stage = Stage::Idle;
    });
    destroy_window();
}

/// The notification window, for dev script shots.
pub fn window() -> Option<AchievementNotificationWindow> {
    with(|s| s.window.as_ref().map(|w| w.clone_strong()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ease_matches_css() {
        assert_eq!(ease_in_out(0.0), 0.0);
        assert!((ease_in_out(1.0) - 1.0).abs() < 1e-4);
        assert!((ease_in_out(0.5) - 0.5).abs() < 1e-3);
        // cubic-bezier(.42,0,.58,1) at x = .25 is about 0.129
        assert!((ease_in_out(0.25) - 0.129).abs() < 0.01);
    }

    #[test]
    fn keyframes() {
        let start = frame_at(0.0);
        assert_eq!((start.outer_scale, start.outer_opacity), (0.0, 0.0));
        assert_eq!(start.outer_width, COLLAPSED);
        assert_eq!(start.dark_opacity, 0.7);
        assert_eq!(start.chip_opacity, 0.0);
        let waiting = frame_at(600.0);
        assert_eq!(waiting.outer_scale, 1.0);
        assert_eq!(waiting.outer_width, COLLAPSED);
        assert!(waiting.dark_opacity < 0.7 && waiting.dark_opacity > 0.0);
        let expanding = frame_at(1125.0);
        assert!((expanding.outer_width - 200.0).abs() < 1.0);
        assert!(expanding.chip_opacity > 0.4 && expanding.chip_opacity < 0.6);
        let shown = frame_at(2000.0);
        assert_eq!(shown.outer_width, EXPANDED);
        assert_eq!((shown.title_opacity, shown.chip_opacity), (1.0, 1.0));
        assert_eq!(shown.shine_x, 0.0);
        assert!(frame_at(1575.0).shine_x > 100.0);
        let closing = closing_frame(450.0);
        assert!(closing.outer_opacity < 1e-3);
        assert!((closing.outer_dy + 20.0).abs() < 1e-3);
    }
}
