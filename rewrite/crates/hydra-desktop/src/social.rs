//! What the friends and chat windows share as OS windows (window-manager.ts
//! openFriendsWindow / openChatWindow, social-windows-session.ts):
//! translations and input hooks per window (Slint globals are per window),
//! saved bounds, the last focused social window, opening a window without
//! activating it, and the session restored at startup.
//!
//! `HYDRA_SOCIAL_DRY_RUN=1` (dev only) turns every friends and chat write
//! (messages, reactions, typing, read marks, reports, friend requests) into a
//! logged no-op, so the windows can be exercised against a real account.

use std::cell::{Cell, RefCell};

use hydra_core::api::{ApiError, HydraApi, Options};
use hydra_core::social::{self as plan, SocialWindowsBounds, SocialWindowsSession, WindowRect};
use hydra_db::keys;
use serde_json::Value;
use slint::winit_030::{WinitWindowAccessor, winit};
use slint::{ComponentHandle, LogicalPosition, LogicalSize};

use crate::shell;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Friends,
    Chat,
}

impl Kind {
    fn plan(self) -> plan::SocialWindowKind {
        match self {
            Kind::Friends => plan::SocialWindowKind::Friends,
            Kind::Chat => plan::SocialWindowKind::Chat,
        }
    }
}

thread_local! {
    static BOUNDS: RefCell<SocialWindowsBounds> = RefCell::new(SocialWindowsBounds::default());
    static LAST_FOCUSED: Cell<Option<Kind>> = const { Cell::new(None) };
    /// Read by the winit attributes hook while a window is being created.
    static NEXT_INACTIVE: Cell<bool> = const { Cell::new(false) };
}

type Task = Box<dyn FnOnce(Box<dyn std::any::Any + Send>)>;

thread_local! {
    static TASKS: RefCell<std::collections::HashMap<u64, Task>> = RefCell::new(Default::default());
    static NEXT_TASK: Cell<u64> = const { Cell::new(0) };
}

/// Runs `work` on a worker thread and hands its result to `done` on the UI
/// thread (`done` may hold UI state that can't cross threads).
pub fn spawn<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
    done: impl FnOnce(T) + 'static,
) {
    let id = NEXT_TASK.with(|n| {
        n.set(n.get() + 1);
        n.get()
    });
    TASKS.with(|t| {
        t.borrow_mut().insert(
            id,
            Box::new(move |value: Box<dyn std::any::Any + Send>| {
                if let Ok(value) = value.downcast::<T>() {
                    done(*value);
                }
            }),
        )
    });
    std::thread::spawn(move || {
        let value = work();
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(task) = TASKS.with(|t| t.borrow_mut().remove(&id)) {
                task(Box::new(value));
            }
        });
    });
}

/// The API client for worker threads (shell::api() is the UI thread's).
static API: std::sync::OnceLock<std::sync::Arc<HydraApi>> = std::sync::OnceLock::new();

/// The UI language, for requests made on worker threads.
static LANGUAGE: std::sync::RwLock<String> = std::sync::RwLock::new(String::new());

pub fn language() -> String {
    LANGUAGE
        .read()
        .map(|l| l.clone())
        .ok()
        .filter(|l| !l.is_empty())
        .unwrap_or_else(|| "en".into())
}

/// The shared API client, from any thread.
pub fn api() -> Option<std::sync::Arc<HydraApi>> {
    API.get().cloned()
}

/// fetchAllProfileFriends: the first page, then the rest in parallel
/// (Promise.all), friends repeated across pages dropped. Blocking.
pub fn fetch_all_friends(api: &HydraApi) -> Result<hydra_core::chat::ProfileFriends, ApiError> {
    use hydra_core::chat::{
        PROFILE_FRIENDS_PAGE_SIZE, PROFILE_FRIENDS_PATH, ProfileFriends, parse,
    };
    let page = |skip: u32| {
        api.get(
            PROFILE_FRIENDS_PATH,
            &[
                ("take", PROFILE_FRIENDS_PAGE_SIZE.to_string()),
                ("skip", skip.to_string()),
            ],
            Options::default(),
        )
        .map(|v| parse::<ProfileFriends>(&v).unwrap_or_default())
    };
    let first = page(0)?;
    let total = first.total_friends.max(0) as u32;
    let skips: Vec<u32> = (1..)
        .map(|i| i * PROFILE_FRIENDS_PAGE_SIZE)
        .take_while(|skip| *skip < total)
        .collect();
    let rest: Vec<Result<ProfileFriends, ApiError>> = std::thread::scope(|scope| {
        let handles: Vec<_> = skips
            .iter()
            .map(|&skip| scope.spawn(move || page(skip)))
            .collect();
        handles
            .into_iter()
            .map(|h| {
                h.join()
                    .unwrap_or_else(|_| Err(ApiError::Network("panicked".into())))
            })
            .collect()
    });
    let mut seen = std::collections::HashSet::new();
    let mut friends = Vec::new();
    let total_friends = first.total_friends;
    let online_friends = first.online_friends;
    for page in std::iter::once(Ok(first)).chain(rest) {
        for friend in page?.friends {
            if seen.insert(friend.id.clone()) {
                friends.push(friend);
            }
        }
    }
    Ok(ProfileFriends {
        total_friends,
        online_friends,
        friends,
    })
}

/// Dev guard: no friends or chat write leaves the app.
pub fn dry_run() -> bool {
    std::env::var_os("HYDRA_SOCIAL_DRY_RUN").is_some()
}

/// The API for a friends/chat write, or a refusal under the dry run.
pub fn write<R>(
    what: &str,
    request: impl FnOnce(&HydraApi) -> Result<R, ApiError>,
) -> Result<R, ApiError> {
    if dry_run() {
        eprintln!("social dry run: skipped {what}");
        return Err(ApiError::Network("dry run".into()));
    }
    let api = api().ok_or(ApiError::NotLoggedIn)?;
    request(&api)
}

/// POST with the dry-run guard (blocking, call off the UI thread).
pub fn post(api: &HydraApi, path: &str, body: &Value) -> Result<Value, ApiError> {
    if dry_run() {
        eprintln!("social dry run: skipped POST {path} {body}");
        return Err(ApiError::Network("dry run".into()));
    }
    api.post(path, body, Options::default())
}

/// BackendSelector::with_winit_window_attributes_hook: a window opened in
/// the background (showInactive) doesn't take focus.
pub fn window_attributes(
    attributes: winit::window::WindowAttributes,
) -> winit::window::WindowAttributes {
    if NEXT_INACTIVE.with(|n| n.replace(false)) {
        attributes.with_active(false)
    } else {
        attributes
    }
}

/// Runs `create` with the next native window opening inactive.
pub fn create_inactive<R>(create: impl FnOnce() -> R) -> R {
    // The attributes are read when the window adapter is created (new()).
    NEXT_INACTIVE.with(|n| n.set(true));
    let result = create();
    NEXT_INACTIVE.with(|n| n.set(false));
    result
}

pub fn set_focused(kind: Kind) {
    LAST_FOCUSED.with(|l| l.set(Some(kind)));
}

/// Wires the per-window `T` global (UI strings) like shell::wire_i18n does
/// for the main window. Bindings read `T.rev` through each call.
#[macro_export]
macro_rules! wire_translations {
    ($component:expr) => {{
        use slint::{ComponentHandle, Model};
        let component = $component;
        let t = component.global::<$crate::T>();
        if let Some(i18n) = $crate::shell::i18n() {
            t.set_rtl(i18n.dir() == hydra_i18n::Direction::Rtl);
        }
        let weak = component.as_weak();
        let touch = move || {
            if let Some(c) = weak.upgrade() {
                let _ = c.global::<$crate::T>().get_rev();
            }
        };
        fn pairs(args: &slint::ModelRc<slint::SharedString>) -> Vec<(String, String)> {
            let items: Vec<slint::SharedString> = args.iter().collect();
            items
                .chunks(2)
                .map(|pair| {
                    (
                        pair[0].to_string(),
                        pair.get(1).map(|v| v.to_string()).unwrap_or_default(),
                    )
                })
                .collect()
        }
        t.on_tr({
            let touch = touch.clone();
            move |key| {
                touch();
                $crate::shell::tr(&key).into()
            }
        });
        t.on_tr_with({
            let touch = touch.clone();
            move |key, args| {
                touch();
                let args = pairs(&args);
                let args: Vec<(&str, hydra_i18n::Arg)> = args
                    .iter()
                    .map(|(k, v)| (k.as_str(), hydra_i18n::Arg::from(v.as_str())))
                    .collect();
                $crate::shell::tr_with(&key, &args).into()
            }
        });
        t.on_tr_parts({
            let touch = touch.clone();
            move |key, part| {
                touch();
                $crate::shell::trans_part(&$crate::shell::tr(&key), part as usize).into()
            }
        });
        t.on_tr_count(move |key, count, args| {
            touch();
            let args = pairs(&args);
            let args: Vec<(&str, hydra_i18n::Arg)> = args
                .iter()
                .map(|(k, v)| (k.as_str(), hydra_i18n::Arg::from(v.as_str())))
                .collect();
            $crate::social::tr_count(&key, count as f64, &args).into()
        });
    }};
}

/// i18next t(key, { count }) with plurals.
pub fn tr_count(key: &str, count: f64, args: &[(&str, hydra_i18n::Arg)]) -> String {
    shell::i18n()
        .map(|i| i.t_count(key, count, args))
        .unwrap_or_default()
}

/// i18n.changeLanguage reached the main window: re-evaluate the social windows' strings.
pub fn on_language_changed() {
    if let Ok(mut language) = LANGUAGE.write() {
        *language = shell::shop_language();
    }
    crate::friends_window::on_language_changed();
    crate::chat_window::on_language_changed();
}

/// Chromium-like wheel scrolling and focus tracking for a social window.
/// `on_focus` runs when the window gains or loses focus.
pub fn install_hooks(
    window: &slint::Window,
    kind: Kind,
    set_wheel: impl Fn(bool, f32) + 'static,
    on_focus: impl Fn(bool) + 'static,
) {
    if shell::headless() {
        return;
    }
    window.on_winit_window_event(move |_window, event| {
        use slint::winit_030::EventResult;
        match event {
            winit::event::WindowEvent::MouseWheel { delta, .. } => {
                let lines = matches!(delta, winit::event::MouseScrollDelta::LineDelta(..));
                set_wheel(
                    lines,
                    if lines {
                        crate::wheel_notch_px() / 60.0
                    } else {
                        1.0
                    },
                );
            }
            winit::event::WindowEvent::Focused(focused) => {
                if *focused {
                    set_focused(kind);
                }
                on_focus(*focused);
            }
            _ => {}
        }
        EventResult::Propagate
    });
}

/// mainWindow focus + on-navigate (focusMainWindowAndNavigate).
pub fn focus_main_and_navigate(path: &str) {
    crate::deeplink::show_main_window();
    crate::nav::navigate(path);
}

/// winit's drag_window for the frameless title areas.
pub fn drag(window: &slint::Window) {
    window.with_winit_window(|w| {
        let _ = w.drag_window();
    });
}

/// win.focus() after a show: raise and activate the native window.
pub fn focus(window: &slint::Window) {
    window.with_winit_window(|w| {
        w.set_minimized(false);
        w.focus_window();
    });
}

pub fn is_minimized(window: &slint::Window) -> bool {
    window.is_minimized()
}

/// flashFrame(true/false): the taskbar button asks for attention.
pub fn flash(window: &slint::Window, on: bool) {
    window.with_winit_window(|w| {
        w.request_user_attention(on.then_some(winit::window::UserAttentionType::Informational));
    });
}

/// Whether the native window has keyboard focus (BrowserWindow.isFocused).
pub fn has_focus(window: &slint::Window) -> bool {
    window.with_winit_window(|w| w.has_focus()).unwrap_or(false)
}

// ---- bounds (social-window-bounds.ts) -----------------------------------

/// loadSocialWindowsBounds (and the API handle for worker threads).
pub fn load_bounds() {
    if let Some(api) = shell::api() {
        let _ = API.set(api);
    }
    if let Ok(mut language) = LANGUAGE.write() {
        *language = shell::shop_language();
    }
    let bounds: SocialWindowsBounds = shell::db()
        .and_then(|db| db.get::<Value>(keys::SOCIAL_WINDOWS_BOUNDS))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    BOUNDS.with(|b| *b.borrow_mut() = bounds);
}

/// The monitors' areas, in logical pixels, from the main window's view.
fn work_areas() -> Vec<WindowRect> {
    let Some(main) = crate::deeplink::main_window() else {
        return Vec::new();
    };
    main.window()
        .with_winit_window(|w| {
            w.available_monitors()
                .map(|m| {
                    let scale = m.scale_factor();
                    let pos = m.position().to_logical::<f64>(scale);
                    let size = m.size().to_logical::<f64>(scale);
                    WindowRect {
                        x: pos.x,
                        y: pos.y,
                        width: size.width,
                        height: size.height,
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// getSavedSocialWindowBounds: the saved bounds when the title bar is still
/// reachable, else only the saved size (the OS places the window).
pub fn apply_saved_bounds(window: &slint::Window, kind: Kind, default: (f32, f32)) {
    let min = match kind {
        Kind::Friends => plan::FRIENDS_WINDOW_MIN_SIZE,
        Kind::Chat => plan::CHAT_WINDOW_MIN_SIZE,
    };
    let saved = BOUNDS.with(|b| b.borrow().get(kind.plan()));
    let resolved = plan::resolve_social_window_bounds(saved.as_ref(), &work_areas(), min);
    match resolved {
        Some(rect) => {
            window.set_size(LogicalSize::new(rect.width as f32, rect.height as f32));
            if let Some((x, y)) = rect.position {
                window.set_position(LogicalPosition::new(x as f32, y as f32));
            }
        }
        None => window.set_size(LogicalSize::new(default.0, default.1)),
    }
}

/// The frame comes off when winit creates the native window, after show():
/// size the window again once it exists, or its client area keeps the
/// framed outer size.
pub fn resize_when_ready<C: ComponentHandle + 'static>(
    weak: slint::Weak<C>,
    kind: Kind,
    default: (f32, f32),
    attempt: u32,
) {
    let Some(component) = weak.upgrade() else {
        return;
    };
    let ready = component
        .window()
        .with_winit_window(|_: &winit::window::Window| ())
        .is_some();
    if ready || attempt > 100 || shell::headless() {
        apply_saved_bounds(component.window(), kind, default);
        return;
    }
    slint::Timer::single_shot(std::time::Duration::from_millis(10), move || {
        resize_when_ready(weak, kind, default, attempt + 1)
    });
}

/// captureSocialWindowBounds: the window's normal bounds, in logical pixels.
fn capture(window: &slint::Window, kind: Kind) {
    if window.is_minimized() || shell::headless() {
        return;
    }
    let scale = window.scale_factor();
    let size = window.size().to_logical(scale);
    let position = window.position().to_logical(scale);
    let rect = WindowRect {
        x: position.x.into(),
        y: position.y.into(),
        width: size.width.into(),
        height: size.height.into(),
    };
    BOUNDS.with(|b| b.borrow_mut().set(kind.plan(), rect));
}

fn persist_bounds() {
    let Some(db) = shell::db() else { return };
    let value = BOUNDS.with(|b| serde_json::to_value(&*b.borrow()).ok());
    if let Some(value) = value
        && let Err(error) = db.put(keys::SOCIAL_WINDOWS_BOUNDS, &value)
    {
        eprintln!("Failed to save the window position: {error}");
    }
}

/// rememberSocialWindowBounds (the window's "close" event).
pub fn remember_bounds(window: &slint::Window, kind: Kind) {
    capture(window, kind);
    persist_bounds();
}

// ---- session (social-windows-session.ts) --------------------------------

/// saveSocialWindowsSession (before-quit): the bounds of the open windows,
/// and which windows and conversations were open.
pub fn save_session() {
    let Some(api) = shell::api() else { return };
    if !api.is_logged_in() {
        return;
    }
    let friends = crate::friends_window::window();
    let chat = crate::chat_window::window();
    if let Some(friends) = &friends {
        capture(friends.window(), Kind::Friends);
    }
    if let Some(chat) = &chat {
        capture(chat.window(), Kind::Chat);
    }
    if friends.is_some() || chat.is_some() {
        persist_bounds();
    }
    let session = plan::social_windows_session(
        friends.is_some(),
        chat.is_some(),
        &crate::chat_window::window_state(),
        LAST_FOCUSED.with(Cell::get).map(Kind::plan),
    );
    if let (Some(db), Ok(value)) = (shell::db(), serde_json::to_value(&session))
        && let Err(error) = db.put(keys::SOCIAL_WINDOWS_SESSION, &value)
    {
        eprintln!("Failed to save the friends and chat windows: {error}");
    }
}

/// restoreSocialWindows: reopen what was open at quit (or the friends list
/// with openFriendsWindowOnStartup), in the order they were stacked.
pub fn restore() {
    let Some(db) = shell::db() else { return };
    let session: Option<SocialWindowsSession> = db
        .get::<Value>(keys::SOCIAL_WINDOWS_SESSION)
        .and_then(|v| serde_json::from_value(v).ok());
    let preferences = crate::prefs::get();
    if !shell::api().is_some_and(|api| api.is_logged_in()) {
        return;
    }
    let _ = db.delete(keys::SOCIAL_WINDOWS_SESSION);
    let open_on_startup = crate::prefs::flag(&preferences, "openFriendsWindowOnStartup");
    let restore = plan::get_social_windows_restore_plan(session.as_ref(), open_on_startup);
    if restore.show_order.is_empty() {
        return;
    }
    if restore.open_friends_window {
        crate::friends_window::prefetch();
    }
    for kind in restore.show_order {
        match kind {
            plan::SocialWindowKind::Friends => crate::friends_window::open(),
            plan::SocialWindowKind::Chat => crate::chat_window::restore(
                restore.chat_friends.clone(),
                restore.active_chat_friend_id.clone(),
            ),
        }
    }
}

/// Sign-out (or a 401): the windows only make sense while signed in.
pub fn on_sign_out() {
    crate::friends_window::on_sign_out();
    crate::chat_window::close();
    crate::chat_service::on_sign_out();
}

/// App quit: save the session first (before-quit).
pub fn shutdown() {
    save_session();
}
