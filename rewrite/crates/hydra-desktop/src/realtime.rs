//! services/sse/sse-client.ts: what each realtime event does in the app.
//! The socket itself is hydra_core::realtime.

use std::cell::{Cell, RefCell};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use hydra_core::api::{HydraApi, Options};
use hydra_core::realtime::{Envelope, Realtime};
use serde_json::Value;

use crate::shell;

static CLIENT: OnceLock<Arc<Realtime>> = OnceLock::new();

/// FRIENDS_UPDATE_THROTTLE_MS: leading + trailing within 10s.
const FRIENDS_UPDATE_THROTTLE: Duration = Duration::from_secs(10);

thread_local! {
    static LAST_FRIENDS_UPDATE: Cell<Option<Instant>> = const { Cell::new(None) };
    static TRAILING: RefCell<Option<slint::Timer>> = const { RefCell::new(None) };
}

pub fn init(api: Arc<HydraApi>) {
    let client = Realtime::new(
        api.clone(),
        |envelope| {
            let _ = slint::invoke_from_event_loop(move || handle(envelope));
        },
        || {
            let _ = slint::invoke_from_event_loop(resync);
        },
    );
    let _ = CLIENT.set(client);
    if api.is_logged_in() {
        connect();
    }
}

/// SSEClient.connect (startup when signed in, and after a sign-in).
pub fn connect() {
    if let Some(client) = CLIENT.get() {
        client.close();
        client.connect();
        // messages sent while the launcher was closed are never pushed
        crate::chat_service::on_connect();
    }
}

/// SSEClient.close (sign-out).
pub fn close() {
    if let Some(client) = CLIENT.get() {
        client.close();
    }
    // a catch-up still running belongs to the previous account
    crate::chat_service::cancel_catch_up();
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn handle(envelope: Envelope) {
    if std::env::var_os("HYDRA_DEBUG_REALTIME").is_some() {
        eprintln!("realtime: {} {}", envelope.event, envelope.event_id);
    }
    let payload = envelope.payload;
    match envelope.event.as_str() {
        "friendRequest" => friend_request(&payload),
        "friendGameSession" => {
            friends_updated();
            // toFriendGameSessionNotification: needs a display name
            let Some(display_name) = text(&payload, "displayName") else {
                return;
            };
            if crate::prefs::get()
                .get("friendStartGameNotificationsEnabled")
                .and_then(Value::as_bool)
                == Some(false)
            {
                return;
            }
            crate::notify::friend_started_playing(
                &display_name,
                text(&payload, "profileImageUrl"),
                text(&payload, "gameTitle"),
            );
        }
        // on-friend-presence: the sidebar refetches the online count
        "friendPresence" => {
            shell::refresh_friends_online();
            // onFriendPresence in the friends and chat windows
            if let (Some(id), Some(online)) = (
                text(&payload, "friendId"),
                payload.get("isOnline").and_then(Value::as_bool),
            ) {
                crate::friends_window::on_presence(&id, online);
                crate::chat_window::on_presence(&id, online);
            }
        }
        // resyncNotifications
        "notification" => crate::notifications_page::on_remote_change(),
        "chatMessage" => crate::chat_service::on_message(&payload),
        "chatTyping" => crate::chat_service::on_typing(&payload),
        "chatReaction" => crate::chat_service::on_reaction(&payload),
        "chatMessageHidden" => crate::chat_service::on_visibility(&payload, true),
        "chatMessageRestored" => crate::chat_service::on_visibility(&payload, false),
        "chatMessageRejected" => crate::chat_service::on_rejected(&payload),
        "screenshotModerated" => {
            // TODO(screenshots): moderation results
        }
        other => eprintln!("realtime: unhandled event {other}"),
    }
}

/// friendRequestEvent: resync the requests, then announce the sender.
fn friend_request(payload: &Value) {
    let Some(api) = shell::api() else { return };
    let sender = text(payload, "senderId");
    std::thread::spawn(move || {
        // resyncFriendRequests
        let _ = api.get("/profile/friend-requests", &[], Options::default());
        let _ = slint::invoke_from_event_loop(crate::friends_window::on_friend_requests_changed);
        let Some(sender) = sender else { return };
        let Ok(user) = api.get(&format!("/users/{sender}"), &[], Options::default()) else {
            return;
        };
        let _ = slint::invoke_from_event_loop(move || {
            if !crate::prefs::flag(&crate::prefs::get(), "friendRequestNotificationsEnabled") {
                return;
            }
            let name = text(&user, "displayName").unwrap_or_default();
            crate::notify::new_friend_request(&name, text(&user, "profileImageUrl"));
        });
    });
}

/// broadcastFriendsUpdated, throttled (leading + trailing, 10s).
fn friends_updated() {
    let now = Instant::now();
    let last = LAST_FRIENDS_UPDATE.with(Cell::get);
    match last {
        Some(at) if now.duration_since(at) < FRIENDS_UPDATE_THROTTLE => {
            // one trailing call at the end of the window
            TRAILING.with(|t| {
                let mut t = t.borrow_mut();
                if t.as_ref().is_some_and(slint::Timer::running) {
                    return;
                }
                let timer = slint::Timer::default();
                timer.start(
                    slint::TimerMode::SingleShot,
                    FRIENDS_UPDATE_THROTTLE - now.duration_since(at),
                    || {
                        LAST_FRIENDS_UPDATE.with(|l| l.set(Some(Instant::now())));
                        broadcast_friends_updated();
                    },
                );
                *t = Some(timer);
            });
        }
        _ => {
            LAST_FRIENDS_UPDATE.with(|l| l.set(Some(now)));
            broadcast_friends_updated();
        }
    }
}

/// on-friends-updated in every app window: the sidebar count, and the
/// friends and chat windows refetch their lists.
fn broadcast_friends_updated() {
    shell::refresh_friends_online();
    crate::friends_window::on_friends_updated();
    crate::chat_window::on_friends_updated();
}

/// resyncAfterReconnect: events missed while disconnected are not replayed.
fn resync() {
    friends_updated();
    crate::friends_window::on_friend_requests_changed();
    crate::notifications_page::refresh_count();
    // syncChat: open conversations refetch what they missed
    crate::chat_service::resync();
}
