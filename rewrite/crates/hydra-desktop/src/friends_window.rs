//! The Friends window: pages/friends-window (friends-window.tsx,
//! use-add-friend.ts, add-friend-request.ts), window-manager.ts
//! openFriendsWindow and friends-snapshot.ts (the list the profile menu
//! prefetches so the window opens on real data).

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::time::{Duration, Instant};

use hydra_core::api::{ApiError, Options};
use hydra_core::chat::{self, FriendRequest, FriendRequestType, ProfileFriends, UserFriend, parse};
use hydra_core::chat_unread::ChatUnreadState;
use hydra_media::images::Op;
use serde_json::{Value, json};
use slint::{ComponentHandle, Image, Model, ModelRc, VecModel};

use crate::social::{self, Kind};
use crate::{FriendRow, FriendsData, FriendsWindow, SmoothScroll, Toast, shell};

/// friends-snapshot.ts SNAPSHOT_MAX_AGE_MS
const SNAPSHOT_MAX_AGE: Duration = Duration::from_secs(15);
/// FRIENDS_WINDOW_SHOW_FALLBACK_MS
const SHOW_FALLBACK: Duration = Duration::from_millis(400);
const DEFAULT_SIZE: (f32, f32) = (420.0, 780.0);
/// Rows this close to the viewport load their pictures (VISIBILITY_ROOT_MARGIN).
const VISIBILITY_MARGIN: f32 = 400.0;

/// FriendsSnapshot
#[derive(Clone, Default)]
struct Snapshot {
    friends: Vec<UserFriend>,
    friend_requests: Vec<FriendRequest>,
}

#[derive(Default)]
struct SnapshotCache {
    snapshot: Option<Snapshot>,
    fetched_at: Option<Instant>,
    in_flight: bool,
    /// Bumped on sign-out, so an old request can't repopulate the cache.
    generation: u64,
    /// Waiting for the prefetch (the window opening meanwhile).
    waiters: Vec<Box<dyn FnOnce(Option<Snapshot>)>>,
}

struct State {
    window: FriendsWindow,
    friends: Vec<UserFriend>,
    /// /profile/friends/search results; None without a query.
    search_results: Option<Vec<UserFriend>>,
    requests: Vec<FriendRequest>,
    /// backgroundImageUrl of request senders (GET /users/{id})
    request_backgrounds: HashMap<String, Option<String>>,
    requested_backgrounds: HashSet<String>,
    unread: ChatUnreadState,
    user: Option<Value>,
    search: String,
    friend_code: String,
    add_mode: bool,
    sending: bool,
    loading: bool,
    sent_collapsed: bool,
    online_override: Option<bool>,
    offline_override: Option<bool>,
    requests_override: Option<bool>,
    friends_request: u64,
    search_request: u64,
    search_timer: slint::Timer,
    /// Decoded pictures by "<kind>:<url>"; failed or pending keys aren't retried.
    images: HashMap<String, Image>,
    pending: HashSet<String>,
    /// The rows near the viewport (lazy pictures).
    visible: HashSet<String>,
    viewport: (f32, f32),
    shown: bool,
    self_game: (String, String),
    models: Models,
}

struct Models {
    official: Rc<VecModel<FriendRow>>,
    sent: Rc<VecModel<FriendRow>>,
    received: Rc<VecModel<FriendRow>>,
    online: Rc<VecModel<FriendRow>>,
    offline: Rc<VecModel<FriendRow>>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    static SNAPSHOT: RefCell<SnapshotCache> = RefCell::new(SnapshotCache::default());
    static GAME: RefCell<(String, String)> = const { RefCell::new((String::new(), String::new())) };
}

fn with_state<R>(f: impl FnOnce(&mut State) -> R) -> Option<R> {
    STATE.with(|s| s.borrow_mut().as_mut().map(f))
}

/// The open window, if any.
pub fn window() -> Option<FriendsWindow> {
    STATE.with(|s| s.borrow().as_ref().map(|s| s.window.clone_strong()))
}

// ---- snapshot (friends-snapshot.ts) -------------------------------------

fn fetch_snapshot(generation: u64) {
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let friends = api.get(
            chat::PROFILE_FRIENDS_PATH,
            &[
                ("take", chat::PROFILE_FRIENDS_PAGE_SIZE.to_string()),
                ("skip", "0".into()),
            ],
            Options::default(),
        );
        let requests = api.get("/profile/friend-requests", &[], Options::default());
        let snapshot = match (friends, requests) {
            (Ok(friends), Ok(requests)) => Some(Snapshot {
                friends: parse::<ProfileFriends>(&friends)
                    .map(|p| p.friends)
                    .unwrap_or_default(),
                friend_requests: parse::<Vec<FriendRequest>>(&requests).unwrap_or_default(),
            }),
            (Err(error), _) | (_, Err(error)) => {
                eprintln!("Failed to prefetch friends: {error}");
                None
            }
        };
        let _ = slint::invoke_from_event_loop(move || {
            let waiters = SNAPSHOT.with(|c| {
                let mut c = c.borrow_mut();
                c.in_flight = false;
                if c.generation != generation {
                    return Vec::new();
                }
                if let Some(snapshot) = &snapshot {
                    c.snapshot = Some(snapshot.clone());
                    c.fetched_at = Some(Instant::now());
                }
                std::mem::take(&mut c.waiters)
            });
            for waiter in waiters {
                waiter(snapshot.clone());
            }
        });
    });
}

/// FriendsSnapshotCache.prefetch (the profile menu opened).
pub fn prefetch() {
    if !shell::api().is_some_and(|api| api.is_logged_in()) {
        return;
    }
    let start = SNAPSHOT.with(|c| {
        let mut c = c.borrow_mut();
        let fresh = c
            .fetched_at
            .is_some_and(|at| at.elapsed() < SNAPSHOT_MAX_AGE);
        if c.in_flight || (c.snapshot.is_some() && fresh) {
            return None;
        }
        c.in_flight = true;
        Some(c.generation)
    });
    if let Some(generation) = start {
        fetch_snapshot(generation);
    }
}

/// FriendsSnapshotCache.get: waits for a prefetch that is still running.
fn snapshot_then(done: impl FnOnce(Option<Snapshot>) + 'static) {
    let ready = SNAPSHOT.with(|c| {
        let mut c = c.borrow_mut();
        if c.in_flight {
            c.waiters.push(Box::new(done));
            None
        } else {
            Some((c.snapshot.clone(), done))
        }
    });
    if let Some((snapshot, done)) = ready {
        done(snapshot);
    }
}

fn clear_snapshot() {
    SNAPSHOT.with(|c| {
        let mut c = c.borrow_mut();
        c.snapshot = None;
        c.fetched_at = None;
        c.in_flight = false;
        c.waiters.clear();
        c.generation += 1;
    });
}

// ---- opening and closing ------------------------------------------------

/// WindowManager.openFriendsWindow: focus the open window, or create it and
/// show it once the cached list (or the skeleton) is painted.
pub fn open() {
    if let Some(window) = window() {
        let _ = window.show();
        social::focus(window.window());
        return;
    }
    let Ok(window) = FriendsWindow::new() else {
        return;
    };
    crate::wire_translations!(&window);
    social::apply_saved_bounds(window.window(), Kind::Friends, DEFAULT_SIZE);
    let data = window.global::<FriendsData>();
    data.set_native_decorations(
        cfg!(target_os = "linux") && shell::preference("useNativeWindowDecorations"),
    );
    data.set_skeleton(true);
    let models = Models {
        official: Rc::new(VecModel::default()),
        sent: Rc::new(VecModel::default()),
        received: Rc::new(VecModel::default()),
        online: Rc::new(VecModel::default()),
        offline: Rc::new(VecModel::default()),
    };
    data.set_official(ModelRc::from(models.official.clone()));
    data.set_sent(ModelRc::from(models.sent.clone()));
    data.set_received(ModelRc::from(models.received.clone()));
    data.set_online(ModelRc::from(models.online.clone()));
    data.set_offline(ModelRc::from(models.offline.clone()));
    wire(&window);
    {
        let weak = window.as_weak();
        social::install_hooks(
            window.window(),
            Kind::Friends,
            move |lines, scale| {
                if let Some(w) = weak.upgrade() {
                    let smooth = w.global::<SmoothScroll>();
                    smooth.set_lines(lines);
                    smooth.set_wheel_scale(scale);
                }
            },
            |_| {},
        );
    }
    {
        let weak = window.as_weak();
        window.window().on_close_requested(move || {
            if let Some(w) = weak.upgrade() {
                social::remember_bounds(w.window(), Kind::Friends);
            }
            slint::Timer::single_shot(Duration::ZERO, drop_window);
            slint::CloseRequestResponse::HideWindow
        });
    }
    let unread = crate::chat_service::unread_state();
    STATE.with(|s| {
        *s.borrow_mut() = Some(State {
            window: window.clone_strong(),
            friends: Vec::new(),
            search_results: None,
            requests: Vec::new(),
            request_backgrounds: HashMap::new(),
            requested_backgrounds: HashSet::new(),
            unread,
            user: shell::user_details(),
            search: String::new(),
            friend_code: String::new(),
            add_mode: false,
            sending: false,
            loading: true,
            sent_collapsed: false,
            online_override: None,
            offline_override: None,
            requests_override: None,
            friends_request: 0,
            search_request: 0,
            search_timer: slint::Timer::default(),
            images: HashMap::new(),
            pending: HashSet::new(),
            visible: HashSet::new(),
            viewport: (0.0, DEFAULT_SIZE.1),
            shown: false,
            self_game: GAME.with(|g| g.borrow().clone()),
            models,
        })
    });
    apply_profile();
    render();
    // This window has its own store: hydrate the signed-in user.
    refresh_user_details();
    consume_add_friend_request();

    // Paint what the main window prefetched, then revalidate. The window
    // shows once that frame is ready, or after the fallback.
    let fallback = slint::Timer::default();
    fallback.start(slint::TimerMode::SingleShot, SHOW_FALLBACK, show_now);
    snapshot_then(move |snapshot| {
        drop(fallback);
        if let Some(snapshot) = snapshot {
            with_state(|s| {
                s.friends = snapshot.friends;
                s.requests = snapshot.friend_requests;
                s.loading = false;
            });
            render();
        }
        show_now();
        fetch_friends();
        fetch_friend_requests();
    });
}

fn show_now() {
    let Some((window, shown)) = with_state(|s| {
        let shown = s.shown;
        s.shown = true;
        (s.window.clone_strong(), shown)
    }) else {
        return;
    };
    if shown {
        return;
    }
    if window.show().is_ok() {
        social::set_focused(Kind::Friends);
        social::focus(window.window());
    }
}

/// The window was closed: drop it (and its pictures).
fn drop_window() {
    let state = STATE.with(|s| s.borrow_mut().take());
    if let Some(state) = state {
        let _ = state.window.hide();
        drop(state);
    }
}

/// WindowManager.closeFriendsWindow
pub fn close() {
    let window = window();
    if let Some(window) = window {
        social::remember_bounds(window.window(), Kind::Friends);
    }
    drop_window();
}

pub fn on_sign_out() {
    clear_snapshot();
    close();
}

fn wire(window: &FriendsWindow) {
    let data = window.global::<FriendsData>();
    let weak = window.as_weak();
    data.on_minimize({
        let weak = weak.clone();
        move || {
            if let Some(w) = weak.upgrade() {
                w.window().set_minimized(true);
            }
        }
    });
    data.on_close(close);
    data.on_drag({
        let weak = weak.clone();
        move || {
            if let Some(w) = weak.upgrade() {
                social::drag(w.window());
            }
        }
    });
    data.on_open_profile(|id| social::focus_main_and_navigate(&format!("/profile/{id}")));
    data.on_message(|id| message(&id));
    data.on_field_edited(field_edited);
    data.on_toggle_add_mode(toggle_add_mode);
    data.on_send_request(send_request);
    data.on_open_code_profile(open_code_profile);
    data.on_accept(|id| update_request(id.to_string(), "ACCEPTED"));
    data.on_refuse(|id| update_request(id.to_string(), "REFUSED"));
    data.on_cancel_request(|id| update_request(id.to_string(), "CANCEL"));
    data.on_toggle_section(|key| {
        with_state(|s| match key.as_str() {
            "sent" => s.sent_collapsed = !s.sent_collapsed,
            "received" => {
                let collapsed = s.requests_override.unwrap_or(received(s).is_empty());
                s.requests_override = Some(!collapsed);
            }
            "online" => {
                let collapsed = s.online_override.unwrap_or(split(s).0.is_empty());
                s.online_override = Some(!collapsed);
            }
            "offline" => {
                let collapsed = s.offline_override.unwrap_or(split(s).1.is_empty());
                s.offline_override = Some(!collapsed);
            }
            _ => {}
        });
        render();
    });
    data.on_list_viewport(|top, height| {
        with_state(|s| s.viewport = (top, height));
        load_visible_images();
    });
}

// ---- data ---------------------------------------------------------------

/// fetchFriends: every page; only the latest request may write.
pub fn fetch_friends() {
    let Some(api) = shell::api() else { return };
    let Some(request) = with_state(|s| {
        s.friends_request += 1;
        s.friends_request
    }) else {
        return;
    };
    std::thread::spawn(move || {
        let result = chat::fetch_all_profile_friends(|take, skip| {
            api.get(
                chat::PROFILE_FRIENDS_PATH,
                &[("take", take.to_string()), ("skip", skip.to_string())],
                Options::default(),
            )
            .map(|v| parse::<ProfileFriends>(&v).unwrap_or_default())
        });
        let _ = slint::invoke_from_event_loop(move || {
            with_state(|s| {
                if let Ok(response) = result
                    && request == s.friends_request
                {
                    s.friends = response.friends;
                }
                // drop the skeleton even on failure
                s.loading = false;
            });
            render();
        });
    });
}

/// fetchFriendRequests
pub fn fetch_friend_requests() {
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let Ok(value) = api.get("/profile/friend-requests", &[], Options::default()) else {
            return;
        };
        let requests = parse::<Vec<FriendRequest>>(&value).unwrap_or_default();
        let _ = slint::invoke_from_event_loop(move || {
            with_state(|s| s.requests = requests);
            fetch_request_backgrounds();
            render();
        });
    });
}

/// GET /users/{id} for each request sender's background, once.
fn fetch_request_backgrounds() {
    let Some(api) = shell::api() else { return };
    let ids: Vec<String> = with_state(|s| {
        let ids: Vec<String> = s
            .requests
            .iter()
            .filter(|r| !s.requested_backgrounds.contains(&r.id))
            .map(|r| r.id.clone())
            .collect();
        s.requested_backgrounds.extend(ids.iter().cloned());
        ids
    })
    .unwrap_or_default();
    for id in ids {
        let api = api.clone();
        std::thread::spawn(move || {
            let result = api.get(&format!("/users/{id}"), &[], Options::default());
            let _ = slint::invoke_from_event_loop(move || {
                with_state(|s| match result {
                    Ok(user) => {
                        let url = user
                            .get("backgroundImageUrl")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        s.request_backgrounds.insert(id, url);
                    }
                    Err(_) => {
                        s.requested_backgrounds.remove(&id);
                    }
                });
                render();
            });
        });
    }
}

/// refreshUserDetails: GET /profile/me into this window.
fn refresh_user_details() {
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let Ok(me) = api.get("/profile/me", &[], Options::default()) else {
            return;
        };
        let _ = slint::invoke_from_event_loop(move || {
            with_state(|s| s.user = Some(me));
            apply_profile();
            render();
        });
    });
}

/// onProfileUpdated
pub fn on_profile_updated() {
    if window().is_some() {
        refresh_user_details();
    }
}

/// onFriendsUpdated (realtime friendGameSession, reconnects)
pub fn on_friends_updated() {
    if window().is_some() {
        fetch_friends();
    }
}

/// onSyncFriendRequests
pub fn on_friend_requests_changed() {
    if window().is_some() {
        fetch_friend_requests();
    }
}

/// onFriendPresence: flip one friend's presence in place.
pub fn on_presence(friend_id: &str, online: bool) {
    let changed = with_state(|s| {
        let mut changed = false;
        for friend in s.friends.iter_mut().filter(|f| f.id == friend_id) {
            friend.is_online = Some(online);
            changed = true;
        }
        changed
    })
    .unwrap_or(false);
    if changed {
        render();
    }
}

/// onChatUnreadUpdated
pub fn on_unread_changed(state: &ChatUnreadState) {
    let changed = with_state(|s| s.unread = state.clone()).is_some();
    if changed {
        render();
    }
}

/// gameRunning (the profile hero shows the user's own game).
pub fn set_game_running(title: &str, icon_url: &str) {
    GAME.with(|g| *g.borrow_mut() = (title.to_string(), icon_url.to_string()));
    if with_state(|s| s.self_game = (title.to_string(), icon_url.to_string())).is_some() {
        apply_profile();
    }
}

pub fn on_language_changed() {
    if let Some(window) = window() {
        let t = window.global::<crate::T>();
        t.set_rev(t.get_rev() + 1);
        render();
    }
}

/// add-friend-request.ts consumeAddFriendRequest: the leaderboards asked for add mode.
fn consume_add_friend_request() {
    let stored = shell::storage_get(chat::ADD_FRIEND_REQUEST_STORAGE_KEY);
    if stored.is_none() {
        return;
    }
    shell::storage_remove(chat::ADD_FRIEND_REQUEST_STORAGE_KEY);
    if !chat::is_fresh_add_friend_request(stored.as_deref(), now_ms()) {
        return;
    }
    with_state(|s| {
        s.add_mode = true;
        s.search.clear();
    });
    if let Some(window) = window() {
        let data = window.global::<FriendsData>();
        data.set_focus_field(data.get_focus_field() + 1);
    }
    render();
}

/// requestAddFriendMode + openFriendsWindow (leaderboards' add friend).
pub fn open_in_add_mode() {
    shell::storage_set(chat::ADD_FRIEND_REQUEST_STORAGE_KEY, &now_ms().to_string());
    if window().is_some() {
        consume_add_friend_request();
    }
    open();
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

// ---- search and add friend ------------------------------------------------

fn field_edited(value: slint::SharedString) {
    let add_mode = with_state(|s| s.add_mode).unwrap_or(false);
    if add_mode {
        // changeFriendCode: trimmed, 8 characters at most
        let code = chat::normalize_friend_code(&value);
        with_state(|s| s.friend_code = code);
        render();
        return;
    }
    with_state(|s| s.search = value.to_string());
    schedule_search();
    render();
}

/// The debounced /profile/friends/search (300ms).
fn schedule_search() {
    let Some(query) = with_state(|s| s.search.trim().to_string()) else {
        return;
    };
    if query.is_empty() {
        with_state(|s| {
            s.search_results = None;
            s.search_timer.stop();
            s.search_request += 1;
        });
        return;
    }
    with_state(|s| {
        s.search_request += 1;
        let request = s.search_request;
        s.search_timer.start(
            slint::TimerMode::SingleShot,
            Duration::from_millis(chat::FRIENDS_SEARCH_DEBOUNCE_MS),
            move || run_search(query.clone(), request),
        );
    });
}

fn run_search(query: String, request: u64) {
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let response = api.get(
            chat::FRIENDS_SEARCH_PATH,
            &[
                ("query", query),
                ("take", chat::FRIENDS_SEARCH_PAGE_SIZE.to_string()),
                ("skip", "0".into()),
            ],
            Options::default(),
        );
        let results = response
            .ok()
            .and_then(|v| v.get("friends").cloned())
            .and_then(|v| parse::<Vec<UserFriend>>(&v))
            .unwrap_or_default();
        let _ = slint::invoke_from_event_loop(move || {
            with_state(|s| {
                if s.search_request == request {
                    s.search_results = Some(results);
                }
            });
            render();
        });
    });
}

fn toggle_add_mode() {
    with_state(|s| {
        s.add_mode = !s.add_mode;
        s.friend_code.clear();
        s.search.clear();
        s.search_results = None;
        s.search_request += 1;
        s.search_timer.stop();
    });
    if let Some(window) = window() {
        let data = window.global::<FriendsData>();
        data.set_focus_field(data.get_focus_field() + 1);
    }
    render();
}

/// showToastPreferringMainWindow: the main window's toast when it is on
/// screen, else this window's.
fn toast(success: bool, title: &str) {
    if crate::deeplink::main_window_visible() {
        if success {
            crate::toast::success(title);
        } else {
            crate::toast::error(title);
        }
        return;
    }
    if let Some(window) = window() {
        let toast = window.global::<Toast>();
        toast.set_title(title.into());
        toast.set_message("".into());
        toast.set_kind(if success { "success" } else { "error" }.into());
        toast.set_duration(2500);
        toast.set_visible(true);
    }
}

fn has_complete_code(code: &str) -> bool {
    if code.chars().count() == chat::FRIEND_CODE_LENGTH {
        return true;
    }
    toast(false, &shell::tr("user_profile.friend_code_length_error"));
    false
}

/// useAddFriend.sendRequest
fn send_request() {
    let Some((code, sending, own_id, is_friend)) = with_state(|s| {
        let own = s
            .user
            .as_ref()
            .and_then(|u| u.get("id"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let is_friend = s.friends.iter().any(|f| f.id == s.friend_code);
        (s.friend_code.clone(), s.sending, own, is_friend)
    }) else {
        return;
    };
    if sending || !has_complete_code(&code) {
        return;
    }
    if own_id == code {
        toast(false, &shell::tr("friends_window.cannot_add_yourself"));
        return;
    }
    if is_friend {
        toast(false, &shell::tr("friends_window.already_friends"));
        return;
    }
    with_state(|s| s.sending = true);
    render();
    std::thread::spawn(move || {
        let result = social::write("send friend request", |api| {
            api.post(
                "/profile/friend-requests",
                &json!({ "friendCode": code }),
                Options::default(),
            )
        });
        let _ = slint::invoke_from_event_loop(move || {
            with_state(|s| s.sending = false);
            match result {
                Ok(_) => {
                    with_state(|s| s.friend_code.clear());
                    fetch_friend_requests();
                    sync_friend_requests();
                    toast(true, &shell::tr("user_profile.request_sent"));
                }
                Err(error) => {
                    let message = error_message(&error);
                    let key = chat::get_add_friend_error_key(&message)
                        .map(|k| format!("friends_window.{}", k.as_str()))
                        .unwrap_or_else(|| "user_profile.error_adding_friend".into());
                    toast(false, &shell::tr(&key));
                }
            }
            render();
        });
    });
}

/// The axios error message the renderer matches codes in.
fn error_message(error: &ApiError) -> String {
    match error {
        ApiError::Status { status, .. } => match error.code() {
            Some(code) => format!("{code} {status}"),
            None => format!("Request failed with status code {status}"),
        },
        other => other.to_string(),
    }
}

/// useAddFriend.openProfile: only for a code that exists.
fn open_code_profile() {
    let Some(code) = with_state(|s| s.friend_code.clone()) else {
        return;
    };
    if !has_complete_code(&code) {
        return;
    }
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let exists = match api.get(&format!("/users/{code}"), &[], Options::default()) {
            Ok(_) => true,
            Err(error) => !chat::is_user_not_found_error(&error_message(&error)),
        };
        let _ = slint::invoke_from_event_loop(move || {
            if exists {
                social::focus_main_and_navigate(&format!("/profile/{code}"));
            } else {
                toast(false, &shell::tr("friends_window.friend_code_not_found"));
            }
        });
    });
}

/// updateFriendRequestState: accept/refuse (PATCH) or cancel (DELETE).
fn update_request(id: String, action: &'static str) {
    std::thread::spawn(move || {
        let result = social::write(&format!("friend request {action}"), |api| {
            if action == "CANCEL" {
                api.delete(
                    &format!("/profile/friend-requests/{id}"),
                    Options::default(),
                )
            } else {
                api.patch(
                    &format!("/profile/friend-requests/{id}"),
                    &json!({ "requestState": action }),
                    Options::default(),
                )
            }
        });
        let _ = slint::invoke_from_event_loop(move || match result {
            Ok(_) => {
                fetch_friend_requests();
                sync_friend_requests();
                if action == "ACCEPTED" {
                    fetch_friends();
                }
            }
            Err(_) => {
                if action == "CANCEL" {
                    toast(false, &shell::tr("user_profile.try_again"));
                }
            }
        });
    });
}

/// syncFriendRequests: the main window's badge follows this window's changes.
fn sync_friend_requests() {
    crate::notifications_page::refresh_count();
}

/// openChatWindow(friend)
fn message(id: &str) {
    let friend = with_state(|s| {
        if id == chat::OFFICIAL_CHAT_FRIEND_ID {
            return Some(official_friend());
        }
        s.friends
            .iter()
            .chain(s.search_results.iter().flatten())
            .find(|f| f.id == id)
            .cloned()
    })
    .flatten();
    if let Some(friend) = friend {
        crate::chat_window::open(friend);
    }
}

fn official_friend() -> UserFriend {
    UserFriend {
        id: chat::OFFICIAL_CHAT_FRIEND_ID.into(),
        display_name: shell::tr("friends_window.official_name"),
        is_official: true,
        ..Default::default()
    }
}

// ---- rendering ----------------------------------------------------------

fn received(s: &State) -> Vec<&FriendRequest> {
    s.requests
        .iter()
        .filter(|r| r.kind == FriendRequestType::Received)
        .collect()
}

/// displayedFriends (search results take presence from the full list),
/// sorted with unread conversations first, split into online / offline.
fn split(s: &State) -> (Vec<UserFriend>, Vec<UserFriend>) {
    let displayed: Vec<UserFriend> = match &s.search_results {
        None => s.friends.clone(),
        Some(results) => results
            .iter()
            .map(|f| {
                let mut f = f.clone();
                if f.is_online.is_none() {
                    f.is_online = Some(
                        s.friends
                            .iter()
                            .find(|known| known.id == f.id)
                            .is_some_and(UserFriend::online),
                    );
                }
                f
            })
            .collect(),
    };
    let unread: HashMap<String, i64> = s.unread.by_friend.clone().into_iter().collect();
    let last: HashMap<String, String> = s
        .unread
        .last_message_at_by_friend
        .clone()
        .into_iter()
        .collect();
    let sorted = chat::sort_friends_by_unread_messages(&displayed, &unread, &last);
    let (online, offline): (Vec<&UserFriend>, Vec<&UserFriend>) =
        sorted.into_iter().partition(|f| f.online());
    (
        online.into_iter().cloned().collect(),
        offline.into_iter().cloned().collect(),
    )
}

fn message_label(friend: &UserFriend, unread: i64) -> String {
    let unread_label = social::tr_count(
        "friends_window.unread_messages",
        unread as f64,
        &[("count", unread.to_string().into())],
    );
    if friend.is_official {
        return unread_label;
    }
    let message = shell::tr_with(
        "friends_window.message_friend",
        &[("name", friend.display_name.clone().into())],
    );
    if unread == 0 {
        message
    } else {
        format!("{message}, {unread_label}")
    }
}

fn image(s: &State, key: &str) -> Image {
    s.images.get(key).cloned().unwrap_or_default()
}

fn avatar_key(url: &Option<String>) -> Option<String> {
    url.as_ref()
        .filter(|u| u.starts_with("http"))
        .map(|u| format!("avatar:{u}"))
}

fn banner_key(url: &Option<String>) -> Option<String> {
    url.as_ref()
        .filter(|u| u.starts_with("http"))
        .map(|u| format!("banner:{u}"))
}

fn icon_key(url: &Option<String>) -> Option<String> {
    url.as_ref()
        .filter(|u| !u.is_empty())
        .map(|u| format!("icon:{u}"))
}

fn friend_row(s: &State, friend: &UserFriend) -> FriendRow {
    let unread = s.unread.by_friend.get(&friend.id).copied().unwrap_or(0);
    let game = friend.current_game.as_ref();
    FriendRow {
        id: friend.id.as_str().into(),
        name: friend.display_name.as_str().into(),
        avatar: avatar_key(&friend.profile_image_url)
            .map(|k| image(s, &k))
            .unwrap_or_default(),
        banner: banner_key(&friend.background_image_url)
            .map(|k| image(s, &k))
            .unwrap_or_default(),
        online: friend.online(),
        game: game.map(|g| g.title.as_str()).unwrap_or_default().into(),
        game_icon: game
            .and_then(|g| icon_key(&g.icon_url))
            .map(|k| image(s, &k))
            .unwrap_or_default(),
        game_has_icon: game.is_some_and(|g| g.icon_url.as_ref().is_some_and(|u| !u.is_empty())),
        unread: unread as i32,
        message_label: message_label(friend, unread).into(),
        official: friend.is_official,
    }
}

fn request_row(s: &State, request: &FriendRequest) -> FriendRow {
    let background = s.request_backgrounds.get(&request.id).cloned().flatten();
    FriendRow {
        id: request.id.as_str().into(),
        name: request.display_name.as_str().into(),
        avatar: avatar_key(&request.profile_image_url)
            .map(|k| image(s, &k))
            .unwrap_or_default(),
        banner: banner_key(&background)
            .map(|k| image(s, &k))
            .unwrap_or_default(),
        ..Default::default()
    }
}

/// Replaces a model's rows, in place where the ids line up so rows keep
/// their hover state.
fn sync_model(model: &VecModel<FriendRow>, rows: Vec<FriendRow>) {
    let same_ids = model.row_count() == rows.len()
        && model.iter().zip(&rows).all(|(old, new)| old.id == new.id);
    if same_ids {
        for (i, row) in rows.into_iter().enumerate() {
            if model.row_data(i).as_ref() != Some(&row) {
                model.set_row_data(i, row);
            }
        }
    } else {
        model.set_vec(rows);
    }
}

fn apply_profile() {
    let Some((window, user, game, avatar, banner, icon)) = with_state(|s| {
        let user = s.user.clone().unwrap_or(Value::Null);
        let url = |k: &str| user.get(k).and_then(Value::as_str).map(str::to_string);
        let avatar = url("profileImageUrl")
            .filter(|u| u.starts_with("http"))
            .map(|u| format!("profile:{u}"));
        let banner = url("backgroundImageUrl")
            .filter(|u| u.starts_with("http"))
            .map(|u| format!("hero:{u}"));
        let icon = Some(s.self_game.1.clone())
            .filter(|u| !u.is_empty())
            .map(|u| format!("icon:{u}"));
        (
            s.window.clone_strong(),
            user,
            s.self_game.clone(),
            avatar,
            banner,
            icon,
        )
    }) else {
        return;
    };
    let data = window.global::<FriendsData>();
    let text = |k: &str| {
        user.get(k)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    data.set_profile_id(text("id").into());
    data.set_profile_name(text("displayName").into());
    data.set_self_game(game.0.as_str().into());
    data.set_self_game_has_icon(!game.1.is_empty());
    let get = |key: &Option<String>| {
        key.as_ref()
            .and_then(|k| with_state(|s| s.images.get(k).cloned()).flatten())
            .unwrap_or_default()
    };
    data.set_profile_avatar(get(&avatar));
    data.set_profile_banner(get(&banner));
    data.set_self_game_icon(get(&icon));
    let scale = window.window().scale_factor();
    if let Some(key) = avatar {
        load_image(key, Op::MaxWidth((56.0 * scale).ceil() as u32));
    }
    if let Some(key) = banner {
        let (w, h) = chat::PROFILE_BACKGROUND_IMAGE_SIZE;
        load_image(
            key,
            Op::Cover {
                width: w,
                height: h,
            },
        );
    }
    if let Some(key) = icon {
        load_image(key, Op::MaxWidth((16.0 * scale).ceil() as u32));
    }
}

/// Fills FriendsData from the state.
fn render() {
    let Some(window) = window() else { return };
    let rows = with_state(|s| {
        let signed_in = s
            .user
            .as_ref()
            .and_then(|u| u.get("id"))
            .and_then(Value::as_str)
            .is_some_and(|id| !id.is_empty());
        let show_official = signed_in
            && !s.add_mode
            && s.search.trim().is_empty()
            && s.unread
                .by_friend
                .get(chat::OFFICIAL_CHAT_FRIEND_ID)
                .copied()
                .unwrap_or(0)
                > 0;
        let official = if show_official {
            vec![friend_row(s, &official_friend())]
        } else {
            Vec::new()
        };
        let sent: Vec<FriendRow> = s
            .requests
            .iter()
            .filter(|r| r.kind == FriendRequestType::Sent)
            .map(|r| request_row(s, r))
            .collect();
        let received: Vec<FriendRow> = received(s).into_iter().map(|r| request_row(s, r)).collect();
        let (online, offline) = split(s);
        let online_collapsed = s.online_override.unwrap_or(online.is_empty());
        let offline_collapsed = s.offline_override.unwrap_or(offline.is_empty());
        let requests_collapsed = s.requests_override.unwrap_or(received.is_empty());
        let online: Vec<FriendRow> = online.iter().map(|f| friend_row(s, f)).collect();
        let offline: Vec<FriendRow> = offline.iter().map(|f| friend_row(s, f)).collect();
        let skeleton = s.loading && s.search_results.is_none();
        sync_model(&s.models.official, official);
        sync_model(&s.models.sent, sent);
        sync_model(&s.models.received, received);
        sync_model(&s.models.online, online);
        sync_model(&s.models.offline, offline);
        (
            skeleton,
            s.search_results.is_some(),
            s.add_mode,
            if s.add_mode {
                s.friend_code.clone()
            } else {
                s.search.clone()
            },
            s.sending,
            (
                s.sent_collapsed,
                requests_collapsed,
                online_collapsed,
                offline_collapsed,
            ),
        )
    });
    let Some((skeleton, searching, add_mode, field, sending, collapsed)) = rows else {
        return;
    };
    let data = window.global::<FriendsData>();
    data.set_skeleton(skeleton);
    data.set_searching(searching);
    data.set_add_mode(add_mode);
    data.set_field(field.into());
    data.set_sending(sending);
    data.set_sent_collapsed(collapsed.0);
    data.set_received_collapsed(collapsed.1);
    data.set_online_collapsed(collapsed.2);
    data.set_offline_collapsed(collapsed.3);
    load_visible_images();
}

/// The rows within VISIBILITY_MARGIN of the viewport, from the list's fixed
/// geometry (56px rows, 8px gaps, 34px sticky headers, 16px between sections).
fn visible_ids(window: &FriendsWindow, top: f32, height: f32) -> Vec<String> {
    let data = window.global::<FriendsData>();
    if data.get_skeleton() {
        return Vec::new();
    }
    let lo = top - VISIBILITY_MARGIN;
    let hi = top + height + VISIBILITY_MARGIN;
    let mut ids = Vec::new();
    let mut y = 0.0f32;
    let mut first = true;
    let mut section = |rows: Option<ModelRc<FriendRow>>,
                       header: bool,
                       collapsed: bool,
                       y: &mut f32,
                       ids: &mut Vec<String>| {
        if !first {
            *y += 16.0;
        }
        first = false;
        if header {
            *y += 34.0 + 8.0;
        }
        if collapsed {
            return;
        }
        if let Some(rows) = rows {
            for (i, row) in rows.iter().enumerate() {
                if i > 0 {
                    *y += 8.0;
                }
                if *y + 56.0 >= lo && *y <= hi {
                    ids.push(row.id.to_string());
                }
                *y += 56.0;
            }
        }
    };
    let official = data.get_official();
    if official.row_count() > 0 {
        section(Some(official), false, false, &mut y, &mut ids);
    }
    let sent = data.get_sent();
    if data.get_add_mode() && sent.row_count() > 0 {
        section(
            Some(sent),
            true,
            data.get_sent_collapsed(),
            &mut y,
            &mut ids,
        );
    }
    let received = data.get_received();
    if received.row_count() > 0 {
        section(
            Some(received),
            true,
            data.get_received_collapsed(),
            &mut y,
            &mut ids,
        );
    }
    section(
        Some(data.get_online()),
        true,
        data.get_online_collapsed(),
        &mut y,
        &mut ids,
    );
    let offline = data.get_offline();
    if offline.row_count() > 0 {
        section(
            Some(offline),
            true,
            data.get_offline_collapsed(),
            &mut y,
            &mut ids,
        );
    }
    ids
}

/// Loads the avatars, banners and game icons of the rows near the viewport.
fn load_visible_images() {
    let Some(window) = window() else { return };
    let Some((top, height)) = with_state(|s| s.viewport) else {
        return;
    };
    let ids = visible_ids(&window, top, height);
    let scale = window.window().scale_factor();
    let jobs: Vec<(String, Op)> = with_state(|s| {
        s.visible.extend(ids.iter().cloned());
        let mut jobs = Vec::new();
        let mut add = |key: Option<String>, op: Op| {
            if let Some(key) = key {
                jobs.push((key, op));
            }
        };
        let avatar_op = || Op::MaxWidth((40.0 * scale).ceil() as u32);
        let (bw, bh) = chat::FRIEND_BACKGROUND_IMAGE_SIZE;
        let friends = s.friends.iter().chain(s.search_results.iter().flatten());
        for friend in friends.filter(|f| s.visible.contains(&f.id)) {
            add(avatar_key(&friend.profile_image_url), avatar_op());
            add(
                banner_key(&friend.background_image_url),
                Op::Cover {
                    width: bw,
                    height: bh,
                },
            );
            if let Some(game) = &friend.current_game {
                add(
                    icon_key(&game.icon_url),
                    Op::MaxWidth((16.0 * scale).ceil() as u32),
                );
            }
        }
        // Requests are few: always loaded (like the renderer).
        for request in &s.requests {
            add(avatar_key(&request.profile_image_url), avatar_op());
            let background = s.request_backgrounds.get(&request.id).cloned().flatten();
            add(
                banner_key(&background),
                Op::Cover {
                    width: bw,
                    height: bh,
                },
            );
        }
        jobs
    })
    .unwrap_or_default();
    for (key, op) in jobs {
        load_image(key, op);
    }
}

fn load_image(key: String, op: Op) {
    let start = with_state(|s| {
        if s.images.contains_key(&key) || s.pending.contains(&key) {
            return false;
        }
        s.pending.insert(key.clone());
        true
    })
    .unwrap_or(false);
    if !start {
        return;
    }
    let Some((loader, _)) = shell::loader() else {
        return;
    };
    let url = key
        .split_once(':')
        .map(|(_, u)| u.to_string())
        .unwrap_or_default();
    loader.load(url, op, move |image| {
        let is_profile = key.starts_with("profile:") || key.starts_with("hero:");
        let is_icon = key.starts_with("icon:");
        if with_state(|s| s.images.insert(key, image)).is_none() {
            return;
        }
        if is_profile || is_icon {
            apply_profile();
        }
        render();
    });
}
