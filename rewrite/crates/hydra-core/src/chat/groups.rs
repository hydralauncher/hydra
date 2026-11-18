//! chat-message-groups.ts `groupChatMessages`: messages by local day, then
//! by sender runs no more than five minutes apart.

use chrono::TimeZone;

use super::time::parse_in;
use super::types::{ChatMessage, ChatMessageDay, ChatMessageGroup};

/// GROUP_GAP_MS: consecutive messages further apart start a new group.
pub const GROUP_GAP_MS: i64 = 5 * 60 * 1000;

/// groupChatMessages in the system time zone. `split_before_id` starts a new
/// group at that message, for the "New messages" divider.
pub fn group_chat_messages(
    messages: &[ChatMessage],
    split_before_id: Option<&str>,
) -> Vec<ChatMessageDay> {
    group_chat_messages_in(messages, split_before_id, &chrono::Local)
}

/// groupChatMessages with the days taken in `tz` (tests use a fixed offset).
pub fn group_chat_messages_in<Tz: TimeZone>(
    messages: &[ChatMessage],
    split_before_id: Option<&str>,
    tz: &Tz,
) -> Vec<ChatMessageDay> {
    let mut days: Vec<ChatMessageDay> = Vec::new();
    // The time of each message's createdAt, when readable.
    let mut times: Vec<Option<i64>> = Vec::with_capacity(messages.len());

    for (index, message) in messages.iter().enumerate() {
        let parsed = parse_in(&message.created_at, tz);
        let time = parsed.as_ref().map(|date| date.timestamp_millis());
        times.push(time);
        let date = parsed.map(|date| date.date_naive());
        let day_key = date.map_or_else(|| "Invalid Date".to_string(), |d| d.to_string());

        if days.last().is_none_or(|day| day.key != day_key) {
            days.push(ChatMessageDay {
                key: day_key,
                date,
                groups: Vec::new(),
            });
        }
        let day = days.last_mut().expect("a day was just pushed");

        let joins = day.groups.last().is_some_and(|group| {
            let previous = *group.messages.last().expect("groups are never empty");
            split_before_id != Some(message.id.as_str())
                && group.from_me == message.from_me
                && matches!((time, times[previous]), (Some(now), Some(before)) if now - before <= GROUP_GAP_MS)
        });

        if joins {
            day.groups
                .last_mut()
                .expect("checked above")
                .messages
                .push(index);
        } else {
            day.groups.push(ChatMessageGroup {
                key: message.id.clone(),
                from_me: message.from_me,
                messages: vec![index],
            });
        }
    }

    days
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::types::ChatMessageStatus;

    fn message(id: &str, from_me: bool, created_at: &str) -> ChatMessage {
        ChatMessage {
            id: id.into(),
            client_nonce: id.into(),
            from_me,
            text: id.into(),
            created_at: created_at.into(),
            status: ChatMessageStatus::Sent,
            ..Default::default()
        }
    }

    fn tz() -> chrono::FixedOffset {
        chrono::FixedOffset::west_opt(3 * 3600).unwrap()
    }

    #[test]
    fn groups_consecutive_messages_from_one_sender() {
        let messages = [
            message("a", false, "2026-09-30T19:30:00"),
            message("b", false, "2026-09-30T19:31:00"),
            message("c", true, "2026-09-30T19:32:00"),
        ];
        let days = group_chat_messages_in(&messages, None, &tz());
        assert_eq!(days.len(), 1);
        let groups: Vec<_> = days[0].groups.iter().map(|g| g.messages.clone()).collect();
        assert_eq!(groups, vec![vec![0, 1], vec![2]]);
    }

    #[test]
    fn starts_a_group_after_a_pause() {
        let messages = [
            message("a", true, "2026-09-30T19:30:00"),
            message("b", true, "2026-09-30T19:40:00"),
        ];
        assert_eq!(
            group_chat_messages_in(&messages, None, &tz())[0]
                .groups
                .len(),
            2
        );
    }

    #[test]
    fn splits_by_local_day() {
        let messages = [
            message("a", true, "2026-09-29T23:59:00"),
            message("b", true, "2026-09-30T00:01:00"),
        ];
        let days = group_chat_messages_in(&messages, None, &tz());
        assert_eq!(days.len(), 2);
        assert_eq!(days[1].groups[0].key, "b");
        assert_eq!(days[1].key, "2026-09-30");

        // The same instants in UTC fall on one UTC day.
        let utc = [
            message("a", true, "2026-09-30T02:59:00Z"),
            message("b", true, "2026-09-30T03:01:00Z"),
        ];
        assert_eq!(group_chat_messages_in(&utc, None, &tz()).len(), 2);
        assert_eq!(group_chat_messages_in(&utc, None, &chrono::Utc).len(), 1);
    }

    #[test]
    fn starts_a_group_at_the_split_message() {
        let messages = [
            message("a", false, "2026-09-30T19:30:00"),
            message("b", false, "2026-09-30T19:31:00"),
        ];
        let days = group_chat_messages_in(&messages, Some("b"), &tz());
        let keys: Vec<_> = days[0].groups.iter().map(|g| g.key.as_str()).collect();
        assert_eq!(keys, vec!["a", "b"]);
    }
}
