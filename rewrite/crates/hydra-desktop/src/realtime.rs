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
    }
}

/// SSEClient.close (sign-out).
pub fn close() {
    if let Some(client) = CLIENT.get() {
        client.close();
    }
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
        "friendPresence" => shell::refresh_friends_online(),
        // resyncNotifications
        "notification" => crate::notifications_page::on_remote_change(),
        "chatMessage"
        | "chatTyping"
        | "chatReaction"
        | "chatMessageHidden"
        | "chatMessageRestored"
        | "chatMessageRejected" => {
            // TODO(chat): the chat window and its unread counts
        }
        "screenshotModerated" => crate::screenshots::on_moderated(&payload),
        other => eprintln!("realtime: unhandled event {other}"),
    }
}

/// friendRequestEvent: resync the requests, then announce the sender.
fn friend_request(payload: &Value) {
    let Some(api) = shell::api() else { return };
    let sender = text(payload, "senderId");
    std::thread::spawn(move || {
        // resyncFriendRequests (the count waits for the friends window)
        let _ = api.get("/profile/friend-requests", &[], Options::default());
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
                        shell::refresh_friends_online();
                    },
                );
                *t = Some(timer);
            });
        }
        _ => {
            LAST_FRIENDS_UPDATE.with(|l| l.set(Some(now)));
            shell::refresh_friends_online();
        }
    }
}

/// resyncAfterReconnect: events missed while disconnected are not replayed.
fn resync() {
    friends_updated();
    crate::notifications_page::refresh_count();
}
