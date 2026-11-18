//! The main process side of chat: services/chat (chat-unread-store.ts,
//! chat-unread-catch-up.ts, chat-official-messages.ts,
//! chat-sender-profiles.ts), the chat notifications and sound of
//! services/notifications, and the realtime chat events
//! (services/sse/events/chat-*.ts).

use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::time::Duration;

use hydra_core::api::Options;
use hydra_core::chat::{
    self, RealtimeChatMessage, RealtimeChatMessageRejected, RealtimeChatMessageVisibility,
    RealtimeChatReaction, RealtimeChatTyping, UserFriend, parse,
};
use hydra_core::chat_unread::{
    self, ChatMessageNotificationContext, ChatNotificationCursor, ChatSenderProfiles,
    ChatUnreadState, ChatUnreadStore,
};
use hydra_db::keys;
use serde_json::{Value, json};

use crate::shell;

thread_local! {
    static STORE: RefCell<ChatUnreadStore> = RefCell::new(ChatUnreadStore::new());
    static BROADCAST_REVISION: Cell<u64> = const { Cell::new(u64::MAX) };
    static SENDERS: RefCell<ChatSenderProfiles> = RefCell::new(ChatSenderProfiles::default());
    /// Callbacks waiting for the unread load in flight (ChatUnreadStore.refresh).
    static REFRESH_WAITERS: RefCell<Vec<Box<dyn FnOnce()>>> = const { RefCell::new(Vec::new()) };
    /// Bumped by cancelChatCatchUp (sign-out, a new connect).
    static CATCH_UP: Cell<u64> = const { Cell::new(0) };
    static CATCH_UP_RUNNING: Cell<bool> = const { Cell::new(false) };
    static OFFICIAL_TIMER: slint::Timer = slint::Timer::default();
    static OFFICIAL_POLLING: Cell<bool> = const { Cell::new(false) };
    /// chatNotificationSession: notifications from before a sign-out neither
    /// show nor react to clicks.
    static NOTIFY_SESSION: Cell<u64> = const { Cell::new(0) };
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

fn random() -> f64 {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_i64(now_ms());
    (hasher.finish() % 1_000_000) as f64 / 1_000_000.0
}

/// The signed-in user's id (levelKeys.user / userDetails).
pub fn my_id() -> Option<String> {
    shell::user_details()
        .and_then(|u| u.get("id").and_then(Value::as_str).map(str::to_string))
        .filter(|id| !id.is_empty())
}

// ---- unread store -------------------------------------------------------

/// ChatUnreadStore.getState
pub fn unread_state() -> ChatUnreadState {
    STORE.with(|s| s.borrow().to_state())
}

/// The store's broadcast: the sidebar badge, the friends and chat windows,
/// the taskbar badge. Only when something changed.
fn broadcast() {
    let (revision, state) = STORE.with(|s| {
        let s = s.borrow();
        (s.revision(), s.to_state())
    });
    if BROADCAST_REVISION.with(|r| r.replace(revision)) == revision {
        return;
    }
    shell::set_unread_chat(state.total_unread as i32);
    crate::friends_window::on_unread_changed(&state);
    crate::chat_window::on_unread_changed(&state);
    crate::taskbar_badge::set_count(state.total_unread);
}

/// ChatUnreadStore.refresh: one load at a time; `done` runs after it.
pub fn refresh(done: impl FnOnce() + 'static) {
    let Some(api) = shell::api().filter(|api| api.is_logged_in()) else {
        done();
        return;
    };
    REFRESH_WAITERS.with(|w| w.borrow_mut().push(Box::new(done)));
    let Some(load) = STORE.with(|s| s.borrow_mut().begin_load()) else {
        // already loading: the waiter runs when it lands
        return;
    };
    std::thread::spawn(move || {
        let summary = match api.get("/profile/chats/unread", &[], Options::default()) {
            Ok(value) => parse(&value),
            Err(error) => {
                eprintln!("Failed to load chat unread counts: {error}");
                None
            }
        };
        let _ = slint::invoke_from_event_loop(move || {
            STORE.with(|s| s.borrow_mut().finish_load(load, summary));
            broadcast();
            let waiters = REFRESH_WAITERS.with(|w| std::mem::take(&mut *w.borrow_mut()));
            for waiter in waiters {
                waiter();
            }
        });
    });
}

/// markChatRead (IPC): POST /profile/chats/{id}/read, or the official read.
pub fn mark_read(friend_id: &str, seq: i64, done: impl FnOnce(bool) + 'static) {
    if !chat::is_friend_id(friend_id) || seq < 0 {
        done(false);
        return;
    }
    if friend_id == chat::OFFICIAL_CHAT_FRIEND_ID {
        if seq > 0 {
            official_mark_read(seq, done);
        } else {
            done(false);
        }
        return;
    }
    let generation = STORE.with(|s| s.borrow().generation());
    let friend_id = friend_id.to_string();
    let id = friend_id.clone();
    crate::social::spawn(
        move || {
            crate::social::write("mark chat read", |api| {
                api.post(
                    &chat::chat_path(&id, "read"),
                    &json!({ "seq": seq }),
                    Options::default(),
                )
            })
            .map(|value| {
                value
                    .get("unreadCount")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
            })
            .map_err(|error| eprintln!("Failed to mark chat as read: {error}"))
            .ok()
        },
        move |unread| match unread {
            Some(count) => {
                STORE.with(|s| {
                    s.borrow_mut()
                        .set_unread(&friend_id, count, seq, generation)
                });
                broadcast();
                done(true);
            }
            None => done(false),
        },
    );
}

// ---- official messages (chat-official-messages.ts) -------------------------

/// ChatOfficialMessages.start: polling with jitter, unless it runs.
fn official_start() {
    if OFFICIAL_TIMER.with(slint::Timer::running) || OFFICIAL_POLLING.with(Cell::get) {
        return;
    }
    if !shell::api().is_some_and(|api| api.is_logged_in()) {
        return;
    }
    official_schedule(chat_unread::official_first_poll_delay_ms(random()));
}

fn official_stop() {
    OFFICIAL_TIMER.with(slint::Timer::stop);
}

fn official_schedule(delay_ms: u64) {
    OFFICIAL_TIMER.with(|t| {
        t.start(
            slint::TimerMode::SingleShot,
            Duration::from_millis(delay_ms),
            || official_refresh(|| {}),
        )
    });
}

/// ChatOfficialMessages.refresh: poll now (the chat window opened).
pub fn official_refresh(done: impl FnOnce() + 'static) {
    let Some(api) = shell::api().filter(|api| api.is_logged_in()) else {
        done();
        return;
    };
    official_stop();
    if OFFICIAL_POLLING.with(|p| p.replace(true)) {
        done();
        return;
    }
    let (generation, read_mark) = STORE.with(|s| {
        let s = s.borrow();
        (s.generation(), s.official_read_mark())
    });
    let language = shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into());
    crate::social::spawn(
        move || {
            api.get(
                &format!("{}/unread", chat::OFFICIAL_MESSAGES_PATH),
                &[("language", language)],
                Options::default(),
            )
            .map_err(|error| eprintln!("Failed to poll official messages: {error}"))
            .ok()
            .and_then(|v| {
                let parsed = chat_unread::parse_official_unread_summary(&v);
                if parsed.is_none() {
                    eprintln!("Unexpected official messages response");
                }
                parsed
            })
        },
        move |summary| {
            OFFICIAL_POLLING.with(|p| p.set(false));
            let next = summary.as_ref().map(|s| s.next_poll_seconds);
            if let Some(summary) = summary {
                STORE.with(|s| {
                    s.borrow_mut()
                        .apply_official_poll(summary.unread_count, generation, read_mark)
                });
                broadcast();
            }
            done();
            if !shell::api().is_some_and(|api| api.is_logged_in()) {
                return;
            }
            let same_session = generation == STORE.with(|s| s.borrow().generation());
            official_schedule(chat_unread::official_next_poll_delay_ms(
                next,
                same_session,
                random(),
            ));
        },
    );
}

fn official_mark_read(seq: i64, done: impl FnOnce(bool) + 'static) {
    let generation = STORE.with(|s| s.borrow().generation());
    crate::social::spawn(
        move || {
            crate::social::write("mark official messages read", |api| {
                api.post(
                    &format!("{}/read", chat::OFFICIAL_MESSAGES_PATH),
                    &json!({ "upToSeq": seq }),
                    Options::default(),
                )
            })
            .map_err(|error| eprintln!("Failed to mark official messages as read: {error}"))
            .is_ok()
        },
        move |ok| {
            if ok {
                STORE.with(|s| s.borrow_mut().clear_official_unread(generation));
                broadcast();
            }
            done(ok);
        },
    );
}

// ---- catch-up (chat-unread-catch-up.ts) ---------------------------------

fn read_cursor() -> Option<ChatNotificationCursor> {
    shell::db()?
        .get::<Value>(keys::CHAT_NOTIFICATION_CURSOR)
        .and_then(|v| serde_json::from_value(v).ok())
}

/// recordAnnounced: never announce these messages again.
fn record_announced(user_id: &str, announced: &BTreeMap<String, String>) {
    let cursor = read_cursor();
    if let Some(next) = chat_unread::record_announced(cursor.as_ref(), user_id, announced)
        && let (Some(db), Ok(value)) = (shell::db(), serde_json::to_value(&next))
        && let Err(error) = db.put(keys::CHAT_NOTIFICATION_CURSOR, &value)
    {
        eprintln!("Failed to record announced chat message: {error}");
    }
}

/// catchUpChatUnread: reload counts and announce what arrived while the
/// launcher was closed or offline (realtime never replays it).
pub fn catch_up(then: impl FnOnce() + 'static) {
    if CATCH_UP_RUNNING.with(|r| r.replace(true)) {
        then();
        return;
    }
    let token = CATCH_UP.with(Cell::get);
    official_start();
    refresh(move || {
        if CATCH_UP.with(Cell::get) == token {
            announce_missed(token);
        }
        CATCH_UP_RUNNING.with(|r| r.set(false));
        then();
    });
}

/// cancelChatCatchUp (sign-out, a new connect).
pub fn cancel_catch_up() {
    CATCH_UP.with(|c| c.set(c.get() + 1));
    CATCH_UP_RUNNING.with(|r| r.set(false));
}

fn announce_missed(token: u64) {
    let Some(user_id) = my_id() else { return };
    let notified = chat_unread::read_notified_until(read_cursor().as_ref(), &user_id);
    let conversations = STORE.with(|s| s.borrow().get_unread_conversations());
    let missed = chat_unread::get_missed_chat_conversations(&conversations, &notified, |id| {
        crate::chat_window::is_conversation_open_in_focused_window(id)
    });
    if missed.conversations.is_empty() {
        return;
    }
    let announced: BTreeMap<String, String> = missed
        .conversations
        .iter()
        .map(|c| (c.friend_id.clone(), c.last_message_at.clone()))
        .collect();
    record_announced(&user_id, &announced);
    if !notifications_enabled() {
        return;
    }
    if missed.conversations.len() == 1 {
        let conversation = missed.conversations[0].clone();
        sender_profile(&conversation.friend_id, move |sender| {
            if CATCH_UP.with(Cell::get) != token {
                return;
            }
            let Some(sender) = sender else { return };
            let title = shell::tr_with(
                "notifications.chat_message_title",
                &[("displayName", sender.display_name.clone().into())],
            );
            let body = crate::social::tr_count(
                "notifications.chat_unread_from_friend",
                conversation.unread_count as f64,
                &[("count", conversation.unread_count.to_string().into())],
            );
            let picture = sender.profile_image_url.clone();
            show_notification(title, body, picture, Click::Chat(sender));
        });
        return;
    }
    let title = crate::social::tr_count(
        "notifications.chat_unread_summary_title",
        missed.message_count as f64,
        &[("count", missed.message_count.to_string().into())],
    );
    let body = crate::social::tr_count(
        "notifications.chat_unread_summary_body",
        missed.conversations.len() as f64,
        &[("count", missed.conversations.len().to_string().into())],
    );
    show_notification(title, body, None, Click::Friends);
}

fn notifications_enabled() -> bool {
    crate::prefs::get()
        .get("chatMessageNotificationsEnabled")
        .and_then(Value::as_bool)
        != Some(false)
}

/// getChatSenderProfile: GET /users/{id}, cached 5 minutes.
pub fn sender_profile(friend_id: &str, done: impl FnOnce(Option<UserFriend>) + 'static) {
    if let Some(cached) = SENDERS.with(|s| s.borrow().get(friend_id, now_ms()).cloned()) {
        done(Some(cached));
        return;
    }
    let Some(api) = shell::api() else {
        done(None);
        return;
    };
    let id = friend_id.to_string();
    crate::social::spawn(
        move || {
            api.get(&format!("/users/{id}"), &[], Options::default())
                .ok()
        },
        {
            let id = friend_id.to_string();
            move |user: Option<Value>| {
                let profile = user.map(|user| chat_unread::sender_profile_from_user(&id, &user));
                if let Some(profile) = &profile {
                    SENDERS.with(|s| s.borrow_mut().insert(profile.clone(), now_ms()));
                }
                done(profile);
            }
        },
    );
}

// ---- notifications --------------------------------------------------------

enum Click {
    Chat(UserFriend),
    Friends,
}

/// showChatNotification: silent (chat plays its own sound), the sender's
/// picture (else the tray icon), a click opens the chat or the friends list.
fn show_notification(title: String, body: String, picture: Option<String>, click: Click) {
    let session = NOTIFY_SESSION.with(Cell::get);
    let body = chat_unread::truncate_chat_notification_body(&body);
    let friend = match &click {
        Click::Chat(friend) => Some(friend.clone()),
        Click::Friends => None,
    };
    std::thread::spawn(move || {
        let icon = picture
            .as_deref()
            .and_then(crate::notify::icon_for)
            .or_else(crate::notify::tray_icon);
        let _ = slint::invoke_from_event_loop(move || {
            if NOTIFY_SESSION.with(Cell::get) != session {
                return;
            }
            let clicked = move || {
                let friend = friend.clone();
                let _ = slint::invoke_from_event_loop(move || {
                    if NOTIFY_SESSION.with(Cell::get) != session {
                        return;
                    }
                    match friend {
                        Some(friend) => crate::chat_window::open(friend),
                        None => crate::friends_window::open(),
                    }
                });
            };
            crate::notify::show_clickable(&title, &body, icon.as_deref(), true, clicked);
            if !crate::chat_window::is_focused() {
                play_message_sound();
            }
        });
    });
}

/// closeChatNotifications (sign-out): later clicks do nothing.
fn close_notifications() {
    NOTIFY_SESSION.with(|s| s.set(s.get() + 1));
}

/// chat-sounds.ts / playChatMessageSound: the chat message sound at 0.35 volume.
pub fn play_message_sound() {
    crate::sound::play_chat_message();
}

// ---- realtime chat events -------------------------------------------------

/// chat-message.ts
pub fn on_message(payload: &Value) {
    let Some(message) = parse::<RealtimeChatMessage>(payload) else {
        return;
    };
    let Some(my_id) = my_id() else { return };
    let from_me = message.sender_id == my_id;
    let friend_id = message.friend_id(&my_id).to_string();
    crate::chat_window::on_message(&friend_id, message.to_dto());
    if from_me {
        return;
    }
    let is_new = STORE.with(|s| {
        s.borrow_mut().register_incoming(
            &friend_id,
            message.seq,
            &message.created_at,
            !crate::chat_window::is_conversation_visible(&friend_id),
        )
    });
    broadcast();
    if is_new {
        let announced = BTreeMap::from([(friend_id.clone(), message.created_at.clone())]);
        record_announced(&my_id, &announced);
    }
    let notify = chat_unread::should_notify_chat_message(ChatMessageNotificationContext {
        notifications_enabled: notifications_enabled(),
        from_me,
        is_new_message: is_new,
        is_open_in_focused_chat_window: crate::chat_window::is_conversation_open_in_focused_window(
            &friend_id,
        ),
    });
    if !notify {
        return;
    }
    let body = if message.body.is_empty() {
        let count = message.attachments.as_ref().map_or(1, Vec::len);
        crate::social::tr_count(
            "notifications.chat_message_images",
            count as f64,
            &[("count", count.to_string().into())],
        )
    } else {
        message.body.clone()
    };
    let session = NOTIFY_SESSION.with(Cell::get);
    sender_profile(&friend_id, move |sender| {
        let Some(sender) = sender else { return };
        if NOTIFY_SESSION.with(Cell::get) != session {
            return;
        }
        crate::chat_window::show_incoming_message(sender.clone());
        let title = shell::tr_with(
            "notifications.chat_message_title",
            &[("displayName", sender.display_name.clone().into())],
        );
        let picture = sender.profile_image_url.clone();
        show_notification(title, body, picture, Click::Chat(sender));
    });
}

/// chat-typing.ts
pub fn on_typing(payload: &Value) {
    if let Some(typing) = parse::<RealtimeChatTyping>(payload) {
        crate::chat_window::on_typing(&typing.sender_id);
    }
}

/// chat-reaction.ts
pub fn on_reaction(payload: &Value) {
    let Some(reaction) = parse::<RealtimeChatReaction>(payload) else {
        return;
    };
    let Some(my_id) = my_id() else { return };
    let from_me = reaction.sender_id == my_id;
    let friend_id = if from_me {
        &reaction.recipient_id
    } else {
        &reaction.sender_id
    };
    crate::chat_window::on_reaction(
        friend_id,
        reaction.seq,
        from_me,
        reaction.emoji.clone(),
        &reaction.updated_at,
    );
}

/// chat-message-visibility.ts (hidden or restored by moderation)
pub fn on_visibility(payload: &Value, hidden: bool) {
    let Some(event) = parse::<RealtimeChatMessageVisibility>(payload) else {
        return;
    };
    let Some(my_id) = my_id() else { return };
    let friend_id = if event.sender_id == my_id {
        &event.recipient_id
    } else {
        &event.sender_id
    };
    crate::chat_window::on_visibility(friend_id, event.seq, hidden);
}

/// chat-message-rejected.ts: only for the user's own messages.
pub fn on_rejected(payload: &Value) {
    let Some(event) = parse::<RealtimeChatMessageRejected>(payload) else {
        return;
    };
    let Some(my_id) = my_id() else { return };
    if event.sender_id != my_id {
        return;
    }
    crate::chat_window::on_rejected(
        &event.recipient_id,
        &event.client_nonce,
        event.reason == chat::ChatRejectReason::Blocked,
    );
}

/// resync.ts syncChat: events missed while disconnected are never replayed.
pub fn resync() {
    catch_up(crate::chat_window::on_resync);
}

/// SSEClient.connect (startup, sign-in): announce what arrived meanwhile.
pub fn on_connect() {
    cancel_catch_up();
    catch_up(|| {});
}

/// HydraApi.sendSignOutEvent's chat part.
pub fn on_sign_out() {
    cancel_catch_up();
    STORE.with(|s| s.borrow_mut().clear());
    official_stop();
    SENDERS.with(|s| s.borrow_mut().clear());
    close_notifications();
    broadcast();
}
