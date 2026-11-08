//! The main process's chat state: services/chat/chat-unread-store.ts
//! (unread counts), missed-chat-conversations.ts, should-notify-chat-message.ts,
//! chat-badge-image.ts, the cursor of chat-unread-catch-up.ts, the pure
//! parts of chat-official-messages.ts and chat-sender-profiles.ts.
//!
//! Everything here is plain state driven from one thread; the desktop app
//! does the requests and calls these with the results.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::chat::time::{is_after, parse_ms};
use crate::chat::{ChatUnreadSummary, OFFICIAL_CHAT_FRIEND_ID, UnreadChatConversation, UserFriend};

/// ChatUnreadState: what every window's badges show.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChatUnreadState {
    pub total_unread: i64,
    pub by_friend: BTreeMap<String, i64>,
    pub last_message_at_by_friend: BTreeMap<String, String>,
    /// Bumped by each official messages poll, so an open chat window refetches.
    pub official_revision: u64,
}

/// What changed in one conversation while an unread load was in flight.
#[derive(Clone, Debug, Default)]
struct PendingUnreadChange {
    /// The count a mark-read response reported.
    unread_count: Option<i64>,
    /// Creation times of the messages counted as unread after that.
    incoming: Vec<String>,
}

/// A running `/profile/chats/unread` load, from `begin_load`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UnreadLoad {
    id: u64,
    generation: u64,
}

/// ChatUnreadStore: the server is authoritative; counts load from
/// /profile/chats/unread on startup, sign-in and reconnect, are nudged
/// locally in between, and replaced by mark-read responses.
///
/// Electron broadcasts the state after each change. Here every change that
/// would broadcast bumps `revision()`: compare it before and after a call
/// and send `to_state()` to the windows when it moved.
#[derive(Debug, Default)]
pub struct ChatUnreadStore {
    unread: BTreeMap<String, i64>,
    last_message_at: HashMap<String, String>,
    last_seen_seq: HashMap<String, i64>,
    /// Unread messages seen here, by seq, so a mark-read response that
    /// predates one of them can't drop it.
    unread_seqs: HashMap<String, BTreeSet<i64>>,
    is_loaded: bool,
    loading: Option<u64>,
    next_load_id: u64,
    pending_changes: Option<(u64, HashMap<String, PendingUnreadChange>)>,
    official_unread: i64,
    official_revision: u64,
    /// Bumped by each read, so a poll that started before it can't undo it.
    official_read_mark: u64,
    /// Bumped on clear() so a load from before sign-out can't repopulate it.
    generation: u64,
    revision: u64,
}

impl ChatUnreadStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Bumped whenever Electron would broadcast `on-chat-unread-updated`.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    fn broadcast(&mut self) {
        self.revision += 1;
    }

    /// Whether a load has succeeded since the last clear (getState waits
    /// for a refresh until then).
    pub fn is_loaded(&self) -> bool {
        self.is_loaded
    }

    /// Whether a load is running (refresh() joins it instead of starting one).
    pub fn is_loading(&self) -> bool {
        self.loading.is_some()
    }

    /// getGeneration: identifies the signed-in session; changes on sign-out.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// refresh/load, first half: None while a load is already running (wait
    /// for that one). Request GET /profile/chats/unread, then `finish_load`.
    pub fn begin_load(&mut self) -> Option<UnreadLoad> {
        if self.loading.is_some() {
            return None;
        }
        self.next_load_id += 1;
        let id = self.next_load_id;
        self.loading = Some(id);
        self.pending_changes = Some((id, HashMap::new()));
        Some(UnreadLoad {
            id,
            generation: self.generation,
        })
    }

    /// load, second half: `summary` None for a failed request. Returns
    /// whether the counts were applied.
    pub fn finish_load(&mut self, load: UnreadLoad, summary: Option<ChatUnreadSummary>) -> bool {
        if self.loading == Some(load.id) {
            self.loading = None;
        }
        let changes = match self.pending_changes.take() {
            Some((id, changes)) if id == load.id => Some(changes),
            other => {
                self.pending_changes = other;
                None
            }
        };
        let Some(summary) = summary else {
            return false;
        };
        if load.generation != self.generation {
            return false;
        }

        self.unread = summary
            .conversations
            .iter()
            .map(|c| (c.friend_id.clone(), c.unread_count))
            .collect();
        self.last_message_at = summary
            .conversations
            .iter()
            .map(|c| (c.friend_id.clone(), c.last_message_at.clone()))
            .collect();
        for (friend_id, change) in changes.unwrap_or_default() {
            self.apply_pending_change(&friend_id, &change);
            for created_at in &change.incoming {
                self.record_message_time(&friend_id, created_at);
            }
        }
        self.is_loaded = true;
        self.broadcast();
        true
    }

    /// registerIncoming: false for a seq already seen (duplicate delivery).
    pub fn register_incoming(
        &mut self,
        friend_id: &str,
        seq: i64,
        created_at: &str,
        count_as_unread: bool,
    ) -> bool {
        if seq <= self.last_seen_seq.get(friend_id).copied().unwrap_or(0) {
            return false;
        }
        self.last_seen_seq.insert(friend_id.to_string(), seq);
        if !count_as_unread {
            return true;
        }

        self.unread_seqs
            .entry(friend_id.to_string())
            .or_default()
            .insert(seq);
        if let Some((_, changes)) = &mut self.pending_changes {
            changes
                .entry(friend_id.to_string())
                .or_default()
                .incoming
                .push(created_at.to_string());
        }
        self.record_message_time(friend_id, created_at);

        if self.is_loaded {
            *self.unread.entry(friend_id.to_string()).or_insert(0) += 1;
            self.broadcast();
        }
        true
    }

    /// getUnreadConversations
    pub fn get_unread_conversations(&self) -> Vec<UnreadChatConversation> {
        self.unread
            .iter()
            .map(|(friend_id, count)| UnreadChatConversation {
                friend_id: friend_id.clone(),
                unread_count: *count,
                last_message_at: self
                    .last_message_at
                    .get(friend_id)
                    .cloned()
                    .unwrap_or_default(),
            })
            .collect()
    }

    /// setUnread: applies a mark-read response up to `read_seq`. One from a
    /// request started before sign-out (an older `generation`) is dropped.
    pub fn set_unread(
        &mut self,
        friend_id: &str,
        reported_count: i64,
        read_seq: i64,
        generation: u64,
    ) {
        if generation != self.generation {
            return;
        }
        let remaining = match self.unread_seqs.get_mut(friend_id) {
            Some(seqs) => {
                seqs.retain(|seq| *seq > read_seq);
                seqs.len() as i64
            }
            None => 0,
        };
        // Both count the messages after read_seq; the response may predate some.
        let unread_count = reported_count.max(remaining);
        if let Some((_, changes)) = &mut self.pending_changes {
            changes.insert(
                friend_id.to_string(),
                PendingUnreadChange {
                    unread_count: Some(unread_count),
                    incoming: Vec::new(),
                },
            );
        }
        if unread_count > 0 {
            self.unread.insert(friend_id.to_string(), unread_count);
        } else {
            self.unread.remove(friend_id);
        }
        self.broadcast();
    }

    /// getOfficialReadMark
    pub fn official_read_mark(&self) -> u64 {
        self.official_read_mark
    }

    /// applyOfficialPoll
    pub fn apply_official_poll(&mut self, unread_count: i64, generation: u64, read_mark: u64) {
        if generation != self.generation {
            return;
        }
        if read_mark == self.official_read_mark {
            self.official_unread = unread_count;
        }
        self.official_revision += 1;
        self.broadcast();
    }

    /// clearOfficialUnread (after POST /profile/official-messages/read)
    pub fn clear_official_unread(&mut self, generation: u64) {
        if generation != self.generation {
            return;
        }
        self.official_read_mark += 1;
        self.official_unread = 0;
        self.broadcast();
    }

    /// clear (sign-out)
    pub fn clear(&mut self) {
        self.generation += 1;
        self.official_unread = 0;
        self.unread.clear();
        self.last_message_at.clear();
        self.last_seen_seq.clear();
        self.unread_seqs.clear();
        self.is_loaded = false;
        self.loading = None;
        self.pending_changes = None;
        self.broadcast();
    }

    fn apply_pending_change(&mut self, friend_id: &str, change: &PendingUnreadChange) {
        // Without a mark-read, the response already counts the messages up to
        // its newest one, so only later ones are missing from it.
        let counted_until = if change.unread_count.is_none() {
            self.last_message_at
                .get(friend_id)
                .filter(|at| !at.is_empty())
                .cloned()
        } else {
            None
        };
        let missing = match &counted_until {
            Some(until) => change
                .incoming
                .iter()
                .filter(|at| is_after(at, until))
                .count(),
            None => change.incoming.len(),
        } as i64;
        let base = change
            .unread_count
            .or_else(|| self.unread.get(friend_id).copied())
            .unwrap_or(0);
        let unread_count = base + missing;
        if unread_count > 0 {
            self.unread.insert(friend_id.to_string(), unread_count);
        } else {
            self.unread.remove(friend_id);
        }
    }

    fn record_message_time(&mut self, friend_id: &str, created_at: &str) {
        let newer = match self.last_message_at.get(friend_id) {
            Some(current) if !current.is_empty() => is_after(created_at, current),
            _ => true,
        };
        if newer {
            self.last_message_at
                .insert(friend_id.to_string(), created_at.to_string());
        }
    }

    /// toState
    pub fn to_state(&self) -> ChatUnreadState {
        let mut total_unread = 0;
        let mut last_message_at_by_friend = BTreeMap::new();
        for (friend_id, count) in &self.unread {
            total_unread += count;
            if let Some(at) = self
                .last_message_at
                .get(friend_id)
                .filter(|at| !at.is_empty())
            {
                last_message_at_by_friend.insert(friend_id.clone(), at.clone());
            }
        }
        let mut by_friend = self.unread.clone();
        if self.official_unread > 0 {
            by_friend.insert(OFFICIAL_CHAT_FRIEND_ID.to_string(), self.official_unread);
        }
        ChatUnreadState {
            total_unread: total_unread + self.official_unread,
            by_friend,
            last_message_at_by_friend,
            official_revision: self.official_revision,
        }
    }
}

// ---- missed-chat-conversations.ts ---------------------------------------

/// The missed conversations and their message total.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MissedChatConversations {
    pub conversations: Vec<UnreadChatConversation>,
    pub message_count: i64,
}

/// getMissedChatConversations: unread conversations whose newest message is
/// newer than the last one announced there, skipping ones the user is
/// already looking at.
pub fn get_missed_chat_conversations(
    conversations: &[UnreadChatConversation],
    notified_until: &BTreeMap<String, String>,
    is_open_in_focused_chat_window: impl Fn(&str) -> bool,
) -> MissedChatConversations {
    let missed: Vec<UnreadChatConversation> = conversations
        .iter()
        .filter(|c| {
            let announced = notified_until.get(&c.friend_id).filter(|at| !at.is_empty());
            c.unread_count > 0
                && announced.is_none_or(|at| is_after(&c.last_message_at, at))
                && !is_open_in_focused_chat_window(&c.friend_id)
        })
        .cloned()
        .collect();
    let message_count = missed.iter().map(|c| c.unread_count).sum();
    MissedChatConversations {
        conversations: missed,
        message_count,
    }
}

// ---- should-notify-chat-message.ts --------------------------------------

/// ChatMessageNotificationContext
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChatMessageNotificationContext {
    pub notifications_enabled: bool,
    pub from_me: bool,
    pub is_new_message: bool,
    pub is_open_in_focused_chat_window: bool,
}

/// shouldNotifyChatMessage: a focused chat window with the friend's tab open
/// shows the message itself, so only messages the user can't see notify.
pub fn should_notify_chat_message(context: ChatMessageNotificationContext) -> bool {
    context.notifications_enabled
        && !context.from_me
        && context.is_new_message
        && !context.is_open_in_focused_chat_window
}

// ---- chat-badge-image.ts --------------------------------------------------

/// Twice the 16px taskbar overlay slot.
pub const CHAT_BADGE_SIZE: u32 = 32;
/// $error-color, the same red as the sidebar unread dot.
pub const CHAT_BADGE_COLOR: &str = "#e11d48";
const MAX_LABELLED_COUNT: i64 = 9;

/// getChatBadgeLabel: None when there is nothing to show; "9+" past nine.
pub fn get_chat_badge_label(count: i64) -> Option<String> {
    if count <= 0 {
        return None;
    }
    Some(if count > MAX_LABELLED_COUNT {
        format!("{MAX_LABELLED_COUNT}+")
    } else {
        count.to_string()
    })
}

/// The badge's font size for a label (16 for two characters, else 20).
pub fn chat_badge_font_size(label: &str) -> u32 {
    if label.chars().count() > 1 { 16 } else { 20 }
}

// ---- chat-unread-catch-up.ts: the notification cursor -------------------

/// LevelDB key of the cursor (levelKeys.chatNotificationCursor).
pub const CHAT_NOTIFICATION_CURSOR_KEY: &str = "chatNotificationCursor";

/// ChatNotificationCursor: the newest announced message per conversation,
/// for the signed-in user. Same JSON as Electron's LevelDB value.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatNotificationCursor {
    pub user_id: String,
    #[serde(default)]
    pub notified_until: BTreeMap<String, String>,
}

/// readNotifiedUntil: the user's cursor, or nothing for another user's.
pub fn read_notified_until(
    cursor: Option<&ChatNotificationCursor>,
    user_id: &str,
) -> BTreeMap<String, String> {
    cursor
        .filter(|cursor| cursor.user_id == user_id)
        .map(|cursor| cursor.notified_until.clone())
        .unwrap_or_default()
}

/// recordAnnounced: merges `announced` (friend id → createdAt) into the
/// stored cursor. Some(new cursor) to write when anything moved forward.
pub fn record_announced(
    cursor: Option<&ChatNotificationCursor>,
    user_id: &str,
    announced: &BTreeMap<String, String>,
) -> Option<ChatNotificationCursor> {
    let mut notified_until = read_notified_until(cursor, user_id);
    let mut changed = false;
    for (friend_id, created_at) in announced {
        if created_at.is_empty() {
            continue;
        }
        let already = notified_until.get(friend_id).is_some_and(|current| {
            matches!(
                (parse_ms(current), parse_ms(created_at)),
                (Some(current), Some(created_at)) if current >= created_at
            )
        });
        if already {
            continue;
        }
        notified_until.insert(friend_id.clone(), created_at.clone());
        changed = true;
    }
    changed.then(|| ChatNotificationCursor {
        user_id: user_id.to_string(),
        notified_until,
    })
}

// ---- notifications/index.ts: chat notification constants ----------------

pub const CHAT_NOTIFICATION_BODY_MAX_LENGTH: usize = 200;
/// Matches the chat window's own playback (chat-sounds.ts).
pub const CHAT_MESSAGE_SOUND_VOLUME: f32 = 0.35;
/// The key of the "messages from N friends" notification.
pub const CHAT_UNREAD_SUMMARY_NOTIFICATION_KEY: &str = "unread-summary";

/// The body showChatNotification shows: cut at 200 UTF-16 units plus "…".
pub fn truncate_chat_notification_body(body: &str) -> String {
    if crate::chat::time::js_length(body) <= CHAT_NOTIFICATION_BODY_MAX_LENGTH {
        return body.to_string();
    }
    let mut units = 0;
    let mut out = String::new();
    for c in body.chars() {
        if units + c.len_utf16() > CHAT_NOTIFICATION_BODY_MAX_LENGTH {
            break;
        }
        units += c.len_utf16();
        out.push(c);
    }
    out.push('…');
    out
}

// ---- chat-official-messages.ts --------------------------------------------

/// OfficialUnreadSummary (GET /profile/official-messages/unread)
#[derive(Clone, Debug, PartialEq)]
pub struct OfficialUnreadSummary {
    pub unread_count: i64,
    pub latest_seq: Option<i64>,
    pub next_poll_seconds: f64,
}

/// isOfficialUnreadSummary, as a parser: a Cloudflare error page once
/// reached the launcher as API data, so the shape is checked.
pub fn parse_official_unread_summary(value: &Value) -> Option<OfficialUnreadSummary> {
    let object = value.as_object()?;
    let unread = object.get("unreadCount")?;
    let unread_count = unread
        .as_i64()
        .or_else(|| {
            unread
                .as_f64()
                .filter(|n| n.fract() == 0.0)
                .map(|n| n as i64)
        })
        .filter(|n| *n >= 0 && *n <= crate::chat::MAX_SAFE_INTEGER)?;
    let next_poll_seconds = object
        .get("nextPollSeconds")?
        .as_f64()
        .filter(|n| n.is_finite())?;
    Some(OfficialUnreadSummary {
        unread_count,
        latest_seq: object.get("latestSeq").and_then(Value::as_i64),
        next_poll_seconds,
    })
}

pub const OFFICIAL_FIRST_POLL_MAX_DELAY_MS: u64 = 60 * 1000;
pub const OFFICIAL_POLL_JITTER_MAX_MS: u64 = 10 * 60 * 1000;
pub const OFFICIAL_DEFAULT_POLL_SECONDS: f64 = 30.0 * 60.0;
pub const OFFICIAL_MIN_POLL_SECONDS: f64 = 60.0;

/// `randomDelay(maximum)`: `random` is Math.random() (0 ≤ random < 1).
fn random_delay(maximum: u64, random: f64) -> u64 {
    (random.clamp(0.0, 1.0) * maximum as f64).floor() as u64
}

/// The first poll after start(): random, up to a minute.
pub fn official_first_poll_delay_ms(random: f64) -> u64 {
    random_delay(OFFICIAL_FIRST_POLL_MAX_DELAY_MS, random)
}

/// The delay after a poll. `next_poll_seconds` None when the poll failed or
/// answered garbage (the 30 min default); `same_session` false when the
/// user signed in again meanwhile (that session starts like any sign-in).
pub fn official_next_poll_delay_ms(
    next_poll_seconds: Option<f64>,
    same_session: bool,
    random: f64,
) -> u64 {
    if !same_session {
        return official_first_poll_delay_ms(random);
    }
    let seconds = next_poll_seconds
        .unwrap_or(OFFICIAL_DEFAULT_POLL_SECONDS)
        .max(OFFICIAL_MIN_POLL_SECONDS);
    (seconds * 1000.0) as u64 + random_delay(OFFICIAL_POLL_JITTER_MAX_MS, random)
}

// ---- chat-sender-profiles.ts ----------------------------------------------

pub const SENDER_PROFILE_TTL_MS: i64 = 5 * 60 * 1000;

/// The sender a notification needs, from GET /users/{id}.
pub fn sender_profile_from_user(friend_id: &str, user: &Value) -> UserFriend {
    let text = |key: &str| {
        user.get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    UserFriend {
        id: friend_id.to_string(),
        display_name: text("displayName").unwrap_or_default(),
        profile_image_url: text("profileImageUrl"),
        background_image_url: text("backgroundImageUrl"),
        current_game: None,
        is_online: None,
        is_official: user.get("isOfficial").and_then(Value::as_bool) == Some(true),
    }
}

/// The sender profile cache (5 minutes per friend). `now` in ms.
#[derive(Debug, Default)]
pub struct ChatSenderProfiles {
    profiles: HashMap<String, (UserFriend, i64)>,
}

impl ChatSenderProfiles {
    pub fn get(&self, friend_id: &str, now: i64) -> Option<&UserFriend> {
        self.profiles
            .get(friend_id)
            .filter(|(_, fetched_at)| now - fetched_at < SENDER_PROFILE_TTL_MS)
            .map(|(profile, _)| profile)
    }

    pub fn insert(&mut self, profile: UserFriend, now: i64) {
        self.profiles.insert(profile.id.clone(), (profile, now));
    }

    /// clearChatSenderProfiles (sign-out)
    pub fn clear(&mut self) {
        self.profiles.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn conversation(
        friend_id: &str,
        unread_count: i64,
        last_message_at: &str,
    ) -> UnreadChatConversation {
        UnreadChatConversation {
            friend_id: friend_id.into(),
            unread_count,
            last_message_at: last_message_at.into(),
        }
    }

    fn summary(conversations: Vec<UnreadChatConversation>) -> ChatUnreadSummary {
        ChatUnreadSummary {
            total_unread: conversations.iter().map(|c| c.unread_count).sum(),
            conversations,
        }
    }

    const T1: &str = "2026-10-05T12:00:00.000Z";
    const T2: &str = "2026-10-05T13:00:00.000Z";
    const T3: &str = "2026-10-05T14:00:00.000Z";

    #[test]
    fn loads_counts_and_nudges_them() {
        let mut store = ChatUnreadStore::new();
        // Before the first load, incoming messages don't count yet.
        assert!(store.register_incoming("a", 1, T1, true));
        assert_eq!(store.to_state().total_unread, 0);

        let load = store.begin_load().unwrap();
        assert!(store.begin_load().is_none());
        let before = store.revision();
        assert!(store.finish_load(load, Some(summary(vec![conversation("a", 2, T2)]))));
        assert!(store.revision() > before);
        assert_eq!(store.to_state().by_friend.get("a"), Some(&2));

        assert!(store.register_incoming("a", 2, T3, true));
        assert!(!store.register_incoming("a", 2, T3, true));
        let state = store.to_state();
        assert_eq!(state.total_unread, 3);
        assert_eq!(
            state.last_message_at_by_friend.get("a").map(String::as_str),
            Some(T3)
        );
    }

    #[test]
    fn a_load_keeps_messages_that_arrived_meanwhile() {
        let mut store = ChatUnreadStore::new();
        let load = store.begin_load().unwrap();
        // Counted by the response (not newer than its last message) and not.
        store.register_incoming("a", 5, T1, true);
        store.register_incoming("a", 6, T3, true);
        store.finish_load(load, Some(summary(vec![conversation("a", 3, T2)])));
        assert_eq!(store.to_state().by_friend.get("a"), Some(&4));
    }

    #[test]
    fn a_mark_read_during_a_load_wins_over_the_response() {
        let mut store = ChatUnreadStore::new();
        let load = store.begin_load().unwrap();
        let generation = store.generation();
        store.set_unread("a", 0, 10, generation);
        store.register_incoming("a", 11, T3, true);
        store.finish_load(load, Some(summary(vec![conversation("a", 7, T2)])));
        assert_eq!(store.to_state().by_friend.get("a"), Some(&1));
    }

    #[test]
    fn mark_read_keeps_newer_seen_messages() {
        let mut store = ChatUnreadStore::new();
        let load = store.begin_load().unwrap();
        store.finish_load(load, Some(summary(vec![])));
        store.register_incoming("a", 1, T1, true);
        store.register_incoming("a", 2, T2, true);
        store.register_incoming("a", 3, T3, true);
        // The response predates seq 3.
        store.set_unread("a", 0, 2, store.generation());
        assert_eq!(store.to_state().by_friend.get("a"), Some(&1));
        store.set_unread("a", 0, 3, store.generation());
        assert!(store.to_state().by_friend.is_empty());
    }

    #[test]
    fn sign_out_drops_late_results() {
        let mut store = ChatUnreadStore::new();
        let load = store.begin_load().unwrap();
        let generation = store.generation();
        store.clear();
        assert!(!store.finish_load(load, Some(summary(vec![conversation("a", 2, T1)]))));
        store.set_unread("a", 5, 0, generation);
        assert_eq!(store.to_state(), ChatUnreadState::default());
        assert!(store.begin_load().is_some());
    }

    #[test]
    fn failed_loads_stay_unloaded() {
        let mut store = ChatUnreadStore::new();
        let load = store.begin_load().unwrap();
        assert!(!store.finish_load(load, None));
        assert!(!store.is_loaded());
        assert!(!store.is_loading());
    }

    #[test]
    fn official_unread_counts_and_reads() {
        let mut store = ChatUnreadStore::new();
        let generation = store.generation();
        let mark = store.official_read_mark();
        store.apply_official_poll(2, generation, mark);
        let state = store.to_state();
        assert_eq!(state.total_unread, 2);
        assert_eq!(state.by_friend.get(OFFICIAL_CHAT_FRIEND_ID), Some(&2));
        assert_eq!(state.official_revision, 1);

        // A poll that started before a read can't undo it.
        let stale_mark = store.official_read_mark();
        store.clear_official_unread(generation);
        store.apply_official_poll(2, generation, stale_mark);
        assert_eq!(store.to_state().total_unread, 0);
        assert_eq!(store.to_state().official_revision, 2);
    }

    #[test]
    fn missed_conversations() {
        let alice = conversation("alice001", 2, T1);
        let bob = conversation("bob00001", 3, T2);
        let nothing_open = |_: &str| false;
        let list = [alice.clone(), bob.clone()];

        let missed = get_missed_chat_conversations(&list, &BTreeMap::new(), nothing_open);
        assert_eq!(missed.conversations, vec![alice.clone(), bob.clone()]);
        assert_eq!(missed.message_count, 5);

        let announced = BTreeMap::from([("alice001".to_string(), T1.to_string())]);
        assert_eq!(
            get_missed_chat_conversations(&list, &announced, nothing_open).conversations,
            vec![bob.clone()]
        );

        let all = BTreeMap::from([
            ("alice001".to_string(), T1.to_string()),
            ("bob00001".to_string(), T2.to_string()),
        ]);
        let none = get_missed_chat_conversations(&list, &all, nothing_open);
        assert!(none.conversations.is_empty());
        assert_eq!(none.message_count, 0);

        let bob_only = BTreeMap::from([("bob00001".to_string(), T2.to_string())]);
        assert_eq!(
            get_missed_chat_conversations(&list, &bob_only, nothing_open).conversations,
            vec![alice.clone()]
        );

        let older = BTreeMap::from([(
            "alice001".to_string(),
            "2026-10-05T11:00:00.000Z".to_string(),
        )]);
        assert_eq!(
            get_missed_chat_conversations(std::slice::from_ref(&alice), &older, nothing_open)
                .conversations,
            vec![alice.clone()]
        );

        assert_eq!(
            get_missed_chat_conversations(&list, &BTreeMap::new(), |id| id == "bob00001")
                .conversations,
            vec![alice]
        );
    }

    fn context() -> ChatMessageNotificationContext {
        ChatMessageNotificationContext {
            notifications_enabled: true,
            from_me: false,
            is_new_message: true,
            is_open_in_focused_chat_window: false,
        }
    }

    #[test]
    fn notifies_only_unseen_messages() {
        assert!(should_notify_chat_message(context()));
        assert!(!should_notify_chat_message(
            ChatMessageNotificationContext {
                is_open_in_focused_chat_window: true,
                ..context()
            }
        ));
        assert!(!should_notify_chat_message(
            ChatMessageNotificationContext {
                notifications_enabled: false,
                ..context()
            }
        ));
        assert!(!should_notify_chat_message(
            ChatMessageNotificationContext {
                from_me: true,
                ..context()
            }
        ));
        assert!(!should_notify_chat_message(
            ChatMessageNotificationContext {
                is_new_message: false,
                ..context()
            }
        ));
    }

    #[test]
    fn badge_labels() {
        assert_eq!(get_chat_badge_label(0), None);
        assert_eq!(get_chat_badge_label(1).as_deref(), Some("1"));
        assert_eq!(get_chat_badge_label(9).as_deref(), Some("9"));
        assert_eq!(get_chat_badge_label(10).as_deref(), Some("9+"));
        assert_eq!(get_chat_badge_label(250).as_deref(), Some("9+"));
        assert_eq!(chat_badge_font_size("9+"), 16);
        assert_eq!(chat_badge_font_size("3"), 20);
    }

    #[test]
    fn notification_cursor() {
        let announced = BTreeMap::from([("a".to_string(), T2.to_string())]);
        let cursor = record_announced(None, "me", &announced).unwrap();
        assert_eq!(
            serde_json::to_value(&cursor).unwrap(),
            json!({ "userId": "me", "notifiedUntil": { "a": T2 } })
        );
        // Older or equal announcements don't move it.
        let older = BTreeMap::from([("a".to_string(), T1.to_string())]);
        assert_eq!(record_announced(Some(&cursor), "me", &older), None);
        assert_eq!(record_announced(Some(&cursor), "me", &announced), None);
        let newer = BTreeMap::from([
            ("a".to_string(), T3.to_string()),
            ("b".to_string(), String::new()),
        ]);
        let moved = record_announced(Some(&cursor), "me", &newer).unwrap();
        assert_eq!(moved.notified_until.get("a").map(String::as_str), Some(T3));
        assert!(!moved.notified_until.contains_key("b"));
        // Another user's cursor starts over.
        assert!(read_notified_until(Some(&cursor), "other").is_empty());
        let other = record_announced(Some(&cursor), "other", &older).unwrap();
        assert_eq!(other.user_id, "other");
    }

    #[test]
    fn notification_bodies() {
        assert_eq!(truncate_chat_notification_body("hi"), "hi");
        let long = "a".repeat(250);
        let cut = truncate_chat_notification_body(&long);
        assert_eq!(cut.chars().count(), 201);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn official_unread_summaries() {
        assert_eq!(
            parse_official_unread_summary(
                &json!({ "unreadCount": 2, "latestSeq": 9, "nextPollSeconds": 1800 })
            ),
            Some(OfficialUnreadSummary {
                unread_count: 2,
                latest_seq: Some(9),
                next_poll_seconds: 1800.0
            })
        );
        assert!(
            parse_official_unread_summary(&json!({ "unreadCount": -1, "nextPollSeconds": 1 }))
                .is_none()
        );
        assert!(
            parse_official_unread_summary(&json!({ "unreadCount": 1.5, "nextPollSeconds": 1 }))
                .is_none()
        );
        assert!(parse_official_unread_summary(&json!({ "unreadCount": 1 })).is_none());
        assert!(parse_official_unread_summary(&json!("<html>")).is_none());
    }

    #[test]
    fn official_poll_delays() {
        assert_eq!(official_first_poll_delay_ms(0.5), 30_000);
        assert_eq!(official_next_poll_delay_ms(Some(10.0), true, 0.0), 60_000);
        assert_eq!(
            official_next_poll_delay_ms(Some(120.0), true, 0.5),
            120_000 + 300_000
        );
        assert_eq!(official_next_poll_delay_ms(None, true, 0.0), 1_800_000);
        assert_eq!(official_next_poll_delay_ms(Some(120.0), false, 0.5), 30_000);
    }

    #[test]
    fn sender_profiles() {
        let mut cache = ChatSenderProfiles::default();
        let profile = sender_profile_from_user(
            "abcd1234",
            &json!({ "displayName": "Ana", "profileImageUrl": "https://x/a.png", "isOfficial": false }),
        );
        assert_eq!(profile.display_name, "Ana");
        assert!(!profile.is_official);
        cache.insert(profile, 1_000);
        assert!(
            cache
                .get("abcd1234", 1_000 + SENDER_PROFILE_TTL_MS - 1)
                .is_some()
        );
        assert!(
            cache
                .get("abcd1234", 1_000 + SENDER_PROFILE_TTL_MS)
                .is_none()
        );
        cache.clear();
        assert!(cache.get("abcd1234", 1_000).is_none());
    }
}
