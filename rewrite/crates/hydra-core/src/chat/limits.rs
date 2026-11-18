//! chat-message-limit.ts, chat-rate-limit.ts and chat-reports.ts.

use super::time::{is_js_whitespace, js_length, js_trim};

// ---- message length (chat-message-limit.ts) ----------------------------

/// The API rejects longer messages (CHAT_MESSAGE_MAX_LENGTH in hydra-api).
pub const CHAT_MESSAGE_MAX_LENGTH: usize = 2_000;

/// The length counter shows from this share of the limit.
const COUNTER_THRESHOLD: f64 = 0.9;

/// getMessageLength: the length the API checks, in UTF-16 code units, after
/// trimming like JS does.
pub fn get_message_length(draft: &str) -> usize {
    js_length(js_trim(draft))
}

/// shouldShowLengthCounter
pub fn should_show_length_counter(length: usize) -> bool {
    length as f64 >= CHAT_MESSAGE_MAX_LENGTH as f64 * COUNTER_THRESHOLD
}

/// getOverflowRange: the part of `draft` past the limit as a `[start, end)`
/// range of **byte** offsets into `draft` (the limit itself counts UTF-16
/// units like the API); None within the limit.
pub fn get_overflow_range(draft: &str) -> Option<(usize, usize)> {
    let trimmed = js_trim(draft);
    if js_length(trimmed) <= CHAT_MESSAGE_MAX_LENGTH {
        return None;
    }
    let leading = draft.len() - draft.trim_start_matches(is_js_whitespace).len();
    let mut units = 0;
    let mut start = trimmed.len();
    for (offset, c) in trimmed.char_indices() {
        if units >= CHAT_MESSAGE_MAX_LENGTH {
            start = offset;
            break;
        }
        units += c.len_utf16();
    }
    Some((leading + start, leading + trimmed.len()))
}

// ---- send rate limit (chat-rate-limit.ts) ------------------------------

/// The API allows 20 messages per 10 seconds per user, in fixed windows.
pub const CHAT_RATE_LIMIT_WINDOW_MS: i64 = 10_000;

/// Floor for the countdown, so a late 429 still shows the user something.
const MIN_COOLDOWN_MS: i64 = 1_000;

/// ChatSendCooldown (milliseconds since the epoch).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChatSendCooldown {
    pub started_at: i64,
    pub until: i64,
}

/// getRateLimitWindowStart: the window a send at `now` falls into.
pub fn get_rate_limit_window_start(window_start: Option<i64>, now: i64) -> i64 {
    match window_start {
        Some(start) if now - start < CHAT_RATE_LIMIT_WINDOW_MS => start,
        _ => now,
    }
}

/// createSendCooldown: after a send in the window opened at `window_start`
/// hit the limit.
pub fn create_send_cooldown(window_start: i64, now: i64) -> ChatSendCooldown {
    ChatSendCooldown {
        started_at: now,
        until: (window_start + CHAT_RATE_LIMIT_WINDOW_MS).max(now + MIN_COOLDOWN_MS),
    }
}

/// chat-send-cooldown.tsx getSecondsLeft
pub fn cooldown_seconds_left(until: i64, now: i64) -> i64 {
    ((until - now) as f64 / 1000.0).ceil().max(0.0) as i64
}

// ---- reports (chat-reports.ts) -----------------------------------------

/// CHAT_REPORT_REASONS: the reasons the API accepts, in the dialog's order
/// (also the `report_reason_*` translation key suffixes).
pub const CHAT_REPORT_REASONS: [&str; 7] = [
    "harassment",
    "scam",
    "sexual_content",
    "hate",
    "self_harm",
    "personal_information",
    "other",
];

pub const CHAT_REPORT_DESCRIPTION_MAX_LENGTH: usize = 500;

const RATE_LIMITED_ERROR: &str = "chat/rate-limited";

/// ChatReportErrorKind
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatReportErrorKind {
    Failed,
    RateLimited,
}

/// getReportErrorKind, from the error's message (`ApiError::to_string()`,
/// which carries the API's code like Electron's error message does).
pub fn get_report_error_kind(error_message: &str) -> ChatReportErrorKind {
    if error_message.contains(RATE_LIMITED_ERROR) {
        ChatReportErrorKind::RateLimited
    } else {
        ChatReportErrorKind::Failed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_length() {
        assert_eq!(get_message_length("  hi \n"), 2);
        assert!(!should_show_length_counter(CHAT_MESSAGE_MAX_LENGTH / 2));
        assert!(should_show_length_counter(CHAT_MESSAGE_MAX_LENGTH - 1));
    }

    #[test]
    fn overflow_range() {
        assert_eq!(
            get_overflow_range(&"a".repeat(CHAT_MESSAGE_MAX_LENGTH)),
            None
        );
        assert_eq!(
            get_overflow_range(&"a".repeat(CHAT_MESSAGE_MAX_LENGTH + 5)),
            Some((CHAT_MESSAGE_MAX_LENGTH, CHAT_MESSAGE_MAX_LENGTH + 5))
        );
        let draft = format!("  {}  ", "a".repeat(CHAT_MESSAGE_MAX_LENGTH + 3));
        assert_eq!(
            get_overflow_range(&draft),
            Some((CHAT_MESSAGE_MAX_LENGTH + 2, CHAT_MESSAGE_MAX_LENGTH + 5))
        );
        // Offsets are bytes; the limit is UTF-16 units.
        let accented = "é".repeat(CHAT_MESSAGE_MAX_LENGTH + 1);
        assert_eq!(
            get_overflow_range(&accented),
            Some((
                CHAT_MESSAGE_MAX_LENGTH * 2,
                (CHAT_MESSAGE_MAX_LENGTH + 1) * 2
            ))
        );
    }

    #[test]
    fn rate_limit_windows() {
        assert_eq!(get_rate_limit_window_start(None, 5_000), 5_000);
        assert_eq!(get_rate_limit_window_start(Some(5_000), 14_999), 5_000);
        assert_eq!(
            get_rate_limit_window_start(Some(5_000), 5_000 + CHAT_RATE_LIMIT_WINDOW_MS),
            5_000 + CHAT_RATE_LIMIT_WINDOW_MS
        );
    }

    #[test]
    fn cooldowns() {
        assert_eq!(
            create_send_cooldown(1_000, 4_000),
            ChatSendCooldown {
                started_at: 4_000,
                until: 1_000 + CHAT_RATE_LIMIT_WINDOW_MS
            }
        );
        assert_eq!(
            create_send_cooldown(1_000, 10_900),
            ChatSendCooldown {
                started_at: 10_900,
                until: 11_900
            }
        );
        assert_eq!(cooldown_seconds_left(11_000, 10_001), 1);
        assert_eq!(cooldown_seconds_left(11_000, 12_000), 0);
    }

    #[test]
    fn report_errors() {
        assert_eq!(
            get_report_error_kind("429 chat/rate-limited"),
            ChatReportErrorKind::RateLimited
        );
        assert_eq!(
            get_report_error_kind("network"),
            ChatReportErrorKind::Failed
        );
    }
}
