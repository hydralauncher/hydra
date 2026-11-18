//! The chat and friends windows' logic, ported from
//! src/renderer/src/pages/chat-window/* and friends-window/*. Pure functions
//! and types: the desktop app does the requests and drives the UI.
//!
//! Everything is re-exported here, so `hydra_core::chat::merge_chat_messages`.

mod attachments;
mod dto;
mod emoji;
mod friends;
mod groups;
mod limits;
mod links;
mod official;
mod reactions;
mod sidebar;
mod state;
pub mod time;
mod types;

pub use attachments::*;
pub use dto::*;
pub use emoji::*;
pub use friends::*;
pub use groups::*;
pub use limits::*;
pub use links::*;
pub use official::*;
pub use reactions::*;
pub use sidebar::*;
pub use state::*;
pub use types::*;

/// shared/official-chat.ts: the official conversation's sender (no user row).
pub const OFFICIAL_CHAT_FRIEND_ID: &str = "HYDRAOFC";
pub const OFFICIAL_MESSAGES_PATH: &str = "/profile/official-messages";
pub const OFFICIAL_MESSAGES_PAGE_MAXIMUM: u32 = 50;

/// chat-window.tsx: GET /profile/chats, the conversation list.
pub const CHAT_CONVERSATIONS_PATH: &str = "/profile/chats";
/// Largest page the API serves.
pub const CHAT_CONVERSATIONS_PAGE_SIZE: u32 = 50;
/// Conversations past this many stay reachable through the picker.
pub const CHAT_CONVERSATIONS_LIMIT: usize = 200;

/// use-chat.ts
pub const CHAT_MESSAGES_PAGE_SIZE: u32 = 50;
pub const CHAT_MESSAGES_MAX_PAGE_SIZE: u32 = 100;
/// The server relays at most one typing event per 3 seconds anyway.
pub const TYPING_PING_INTERVAL_MS: u64 = 3_000;
pub const TYPING_INDICATOR_TIMEOUT_MS: u64 = 5_000;
pub const MARK_READ_DEBOUNCE_MS: u64 = 500;
pub const REACTION_ERROR_DURATION_MS: u64 = 5_000;
/// A held message the server said nothing about for this long gets looked up.
pub const PENDING_CHECK_TIMEOUT_MS: u64 = 20_000;
pub const PENDING_CHECK_MAX_LOOKUPS: u32 = 6;
/// chat-conversation.tsx: five lines of text plus the input's padding.
pub const COMPOSER_MAX_HEIGHT: f64 = 110.0;
pub const IMAGE_NOTE_DURATION_MS: u64 = 4_000;
/// chat-message-list.tsx
pub const LOAD_OLDER_THRESHOLD_PX: f64 = 120.0;
pub const JUMP_TO_LATEST_THRESHOLD_PX: f64 = 200.0;
pub const MAX_NEW_MESSAGES_SHOWN: usize = 99;
pub const FLASH_DURATION_MS: u64 = 1_600;
pub const REPORT_SENT_DURATION_MS: u64 = 3_000;
/// Room the quick reaction bar needs above a message before it opens below.
pub const REACTION_BAR_CLEARANCE_PX: f64 = 56.0;
/// chat-sidebar.tsx: a reordered row glides for this long (cubic-bezier(0.22, 1, 0.36, 1)).
pub const ROW_MOVE_MS: u64 = 320;
/// chat-sidebar.tsx: messages newer than this many days show a weekday.
pub const WEEKDAY_LABEL_DAYS: i64 = 7;
/// chat-new-conversation.tsx
pub const MAX_STAGGERED_OPTIONS: usize = 8;
pub const PICKER_SETTLE_MS: u64 = 400;

/// API error codes use-chat.ts tells apart (found in the error message).
pub const NOT_FRIENDS_ERROR: &str = "chat/not-friends";
pub const RATE_LIMITED_ERROR: &str = "chat/rate-limited";
pub const ATTACHMENT_NOT_FOUND_ERROR: &str = "chat/attachment-not-found";
pub const ATTACHMENTS_DAILY_LIMIT_ERROR: &str = "chat/attachments-daily-limit";

/// use-chat.ts chatPath: `/profile/chats/{friendId}/{suffix}`.
pub fn chat_path(friend_id: &str, suffix: &str) -> String {
    format!("/profile/chats/{friend_id}/{suffix}")
}

/// chat-state.ts (main) FRIEND_ID_PATTERN `^[A-Za-z0-9]{8}$`: friend ids are
/// interpolated into API paths, so only hashids get through.
pub fn is_friend_id(value: &str) -> bool {
    value.len() == 8 && value.bytes().all(|b| b.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friend_ids() {
        assert!(is_friend_id("abcd1234"));
        assert!(is_friend_id(OFFICIAL_CHAT_FRIEND_ID));
        assert!(!is_friend_id("abcd123"));
        assert!(!is_friend_id("../../x1"));
        assert_eq!(
            chat_path("abcd1234", "typing"),
            "/profile/chats/abcd1234/typing"
        );
    }
}
