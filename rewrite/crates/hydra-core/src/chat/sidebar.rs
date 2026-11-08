//! chat-sidebar-layout.ts: the conversation list's width, order, filter and
//! row previews.

use std::collections::HashSet;

use super::dto::{ChatConversationDto, UserFriend};
use super::official::MAX_SAFE_INTEGER;
use super::time::{collapse_whitespace, js_round, js_trim, parse_ms};
use super::types::{ChatConversation, ChatConversationLastMessage};

/// Same limits as the main window's sidebar (components/sidebar/sidebar.tsx).
pub const CHAT_SIDEBAR_MIN_WIDTH: f64 = 200.0;
pub const CHAT_SIDEBAR_INITIAL_WIDTH: f64 = 250.0;
pub const CHAT_SIDEBAR_MAX_WIDTH: f64 = 450.0;
/// localStorage key of the width.
pub const CHAT_SIDEBAR_WIDTH_STORAGE_KEY: &str = "chatSidebarWidth";
/// Room the conversation keeps next to the sidebar.
pub const CHAT_CONVERSATION_MIN_WIDTH: f64 = 200.0;

/// clampChatSidebarWidth. Pass `f64::INFINITY` for "no window limit".
pub fn clamp_chat_sidebar_width(width: f64, window_width: f64) -> f64 {
    if !width.is_finite() {
        return CHAT_SIDEBAR_INITIAL_WIDTH;
    }
    let max_width = CHAT_SIDEBAR_MAX_WIDTH.min(window_width - CHAT_CONVERSATION_MIN_WIDTH);
    CHAT_SIDEBAR_MIN_WIDTH.max(js_round(width).min(max_width))
}

/// isOfficialAccount: the Hydra team's one-way conversation.
pub fn is_official_account(friend: &UserFriend) -> bool {
    friend.is_official
}

/// getLatestMessage: the loaded (or live) history's last message, else the
/// one the conversation list reported.
pub fn get_latest_message(conversation: &ChatConversation) -> Option<ChatConversationLastMessage> {
    let listed = conversation.last_message.as_ref();
    let Some(last) = conversation.messages.last() else {
        return listed.cloned();
    };
    // A pending message has no seq yet: it is newer than anything stored.
    if let (Some(listed), Some(seq)) = (listed, last.seq)
        && seq < listed.seq
    {
        return Some(listed.clone());
    }
    Some(ChatConversationLastMessage {
        seq: last.seq.unwrap_or(MAX_SAFE_INTEGER),
        from_me: last.from_me,
        text: last.text.clone(),
        created_at: last.created_at.clone(),
        is_hidden: last.is_hidden,
        attachment_count: last.attachment_count() as u32,
    })
}

/// The order `sortConversationsByActivity` gives, as indexes: the official
/// conversation pinned first, then most recent activity; a conversation with
/// no message yet stays at the top; ties keep their order.
pub fn conversation_order_by_activity(conversations: &[ChatConversation]) -> Vec<usize> {
    let activity = |conversation: &ChatConversation| -> f64 {
        let created_at = get_latest_message(conversation).map(|m| m.created_at);
        match created_at.as_deref() {
            None | Some("") => f64::INFINITY,
            Some(text) => parse_ms(text).map_or(0.0, |ms| ms as f64),
        }
    };
    let mut keyed: Vec<(usize, u8, f64)> = conversations
        .iter()
        .enumerate()
        .map(|(index, c)| (index, u8::from(c.friend.is_official), activity(c)))
        .collect();
    keyed.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then(b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal))
            .then(a.0.cmp(&b.0))
    });
    keyed.into_iter().map(|(index, ..)| index).collect()
}

/// sortConversationsByActivity
pub fn sort_conversations_by_activity(
    conversations: &[ChatConversation],
) -> Vec<&ChatConversation> {
    conversation_order_by_activity(conversations)
        .into_iter()
        .map(|index| &conversations[index])
        .collect()
}

/// Whether a friend's name contains the query (filterConversations' test).
pub fn matches_conversation_query(display_name: &str, query: &str) -> bool {
    let normalized = js_trim(query).to_lowercase();
    normalized.is_empty() || display_name.to_lowercase().contains(&normalized)
}

/// filterConversations: names containing the query, in their order.
pub fn filter_conversations<'a>(
    conversations: impl IntoIterator<Item = &'a ChatConversation>,
    query: &str,
) -> Vec<&'a ChatConversation> {
    conversations
        .into_iter()
        .filter(|c| matches_conversation_query(&c.friend.display_name, query))
        .collect()
}

/// getAdjacentConversationId: Ctrl+Tab (step 1) or Ctrl+Shift+Tab (-1),
/// wrapping around; None when there is no other conversation.
pub fn get_adjacent_conversation_id<S: AsRef<str>>(
    ids: &[S],
    active_id: Option<&str>,
    step: i32,
) -> Option<String> {
    if ids.len() < 2 {
        return None;
    }
    let index = active_id.and_then(|active| ids.iter().position(|id| id.as_ref() == active));
    let Some(index) = index else {
        let end = if step == 1 { ids.first() } else { ids.last() };
        return end.map(|id| id.as_ref().to_string());
    };
    let len = ids.len() as i64;
    let next = (index as i64 + step as i64).rem_euclid(len) as usize;
    Some(ids[next].as_ref().to_string())
}

/// toConversationLastMessage: `fromMe` is by sender.
pub fn to_conversation_last_message(dto: &ChatConversationDto) -> ChatConversationLastMessage {
    let last = &dto.last_message;
    ChatConversationLastMessage {
        seq: last.seq,
        from_me: last.sender_id != dto.friend_id,
        text: last.body.clone(),
        created_at: last.created_at.clone(),
        is_hidden: last.hidden,
        attachment_count: last.attachment_count.unwrap_or(0),
    }
}

/// ChatConversationPreview
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatConversationPreview {
    Text { text: String, from_me: bool },
    Images { count: u32, from_me: bool },
    Removed,
}

/// getConversationPreview: what the row shows under the name.
pub fn get_conversation_preview(
    conversation: &ChatConversation,
) -> Option<ChatConversationPreview> {
    let latest = get_latest_message(conversation)?;
    if latest.is_hidden {
        return Some(ChatConversationPreview::Removed);
    }
    let text = collapse_whitespace(&latest.text);
    if !text.is_empty() {
        return Some(ChatConversationPreview::Text {
            text,
            from_me: latest.from_me,
        });
    }
    (latest.attachment_count > 0).then_some(ChatConversationPreview::Images {
        count: latest.attachment_count,
        from_me: latest.from_me,
    })
}

/// dropAbandonedConversations, in place: conversations opened from the
/// picker and left without a message, draft or unread message go once
/// another one is active. Returns whether any went.
pub fn drop_abandoned_conversations(
    conversations: &mut Vec<ChatConversation>,
    active_id: Option<&str>,
    keep_ids: &HashSet<String>,
) -> bool {
    let before = conversations.len();
    conversations.retain(|c| {
        Some(c.friend.id.as_str()) == active_id
            || keep_ids.contains(&c.friend.id)
            || !c.messages.is_empty()
            || c.last_message.is_some()
            || c.unread_count > 0
            || !js_trim(&c.draft).is_empty()
            || !c.draft_images.is_empty()
    });
    conversations.len() != before
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::dto::{ChatConversationFriend, ChatConversationLastMessageDto};
    use crate::chat::types::{ChatAttachment, ChatMessage, ChatMessageStatus};

    fn conversation(id: &str, name: &str) -> ChatConversation {
        ChatConversation::new(UserFriend {
            id: id.into(),
            display_name: name.into(),
            ..Default::default()
        })
    }

    #[test]
    fn clamps_width() {
        let inf = f64::INFINITY;
        assert_eq!(clamp_chat_sidebar_width(100.0, inf), CHAT_SIDEBAR_MIN_WIDTH);
        assert_eq!(clamp_chat_sidebar_width(900.0, inf), CHAT_SIDEBAR_MAX_WIDTH);
        assert_eq!(clamp_chat_sidebar_width(300.0, inf), 300.0);
        assert_eq!(clamp_chat_sidebar_width(450.0, 560.0), 360.0);
        assert_eq!(
            clamp_chat_sidebar_width(450.0, 400.0),
            CHAT_SIDEBAR_MIN_WIDTH
        );
        assert_eq!(clamp_chat_sidebar_width(250.0, 560.0), 250.0);
        assert_eq!(clamp_chat_sidebar_width(300.6, inf), 301.0);
        assert_eq!(
            clamp_chat_sidebar_width(f64::NAN, inf),
            CHAT_SIDEBAR_INITIAL_WIDTH
        );
    }

    #[test]
    fn filters_by_name() {
        let conversations = [
            conversation("a", "Marina"),
            conversation("b", "Lúcia"),
            conversation("c", "Amanda"),
        ];
        assert_eq!(filter_conversations(&conversations, "  ").len(), 3);
        let names: Vec<_> = filter_conversations(&conversations, "MA")
            .iter()
            .map(|c| c.friend.display_name.as_str())
            .collect();
        assert_eq!(names, vec!["Marina", "Amanda"]);
    }

    #[test]
    fn adjacent_conversations() {
        let ids = ["a", "b", "c"];
        assert_eq!(
            get_adjacent_conversation_id(&ids, Some("c"), 1).as_deref(),
            Some("a")
        );
        assert_eq!(
            get_adjacent_conversation_id(&ids, Some("a"), -1).as_deref(),
            Some("c")
        );
        assert_eq!(
            get_adjacent_conversation_id(&ids, None, 1).as_deref(),
            Some("a")
        );
        assert_eq!(
            get_adjacent_conversation_id(&ids, None, -1).as_deref(),
            Some("c")
        );
        assert_eq!(get_adjacent_conversation_id(&["a"], Some("a"), 1), None);
    }

    fn message(text: &str, from_me: bool) -> ChatMessage {
        ChatMessage {
            id: "1".into(),
            client_nonce: "1".into(),
            from_me,
            text: text.into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            status: ChatMessageStatus::Sent,
            ..Default::default()
        }
    }

    #[test]
    fn previews() {
        let mut c = conversation("a", "A");
        assert_eq!(get_conversation_preview(&c), None);

        c.messages = vec![message("first", false), message("  gg,\n\nrematch? ", true)];
        assert_eq!(
            get_conversation_preview(&c),
            Some(ChatConversationPreview::Text {
                text: "gg, rematch?".into(),
                from_me: true
            })
        );

        let mut images = message("", false);
        images.attachments = Some(vec![ChatAttachment::default(), ChatAttachment::default()]);
        c.messages = vec![images];
        assert_eq!(
            get_conversation_preview(&c),
            Some(ChatConversationPreview::Images {
                count: 2,
                from_me: false
            })
        );

        let mut removed = message("x", false);
        removed.is_hidden = true;
        c.messages = vec![removed];
        assert_eq!(
            get_conversation_preview(&c),
            Some(ChatConversationPreview::Removed)
        );
    }

    fn listed() -> ChatConversationLastMessage {
        ChatConversationLastMessage {
            seq: 5,
            from_me: false,
            text: "listed".into(),
            created_at: "2026-01-02T00:00:00Z".into(),
            is_hidden: false,
            attachment_count: 0,
        }
    }

    fn history(seq: Option<i64>, text: &str) -> ChatMessage {
        ChatMessage {
            id: text.into(),
            client_nonce: text.into(),
            seq,
            from_me: true,
            text: text.into(),
            created_at: "2026-01-03T00:00:00Z".into(),
            ..Default::default()
        }
    }

    #[test]
    fn latest_message() {
        let mut c = conversation("a", "A");
        c.last_message = Some(listed());
        assert_eq!(get_latest_message(&c), Some(listed()));
        c.messages = vec![history(Some(4), "old")];
        assert_eq!(get_latest_message(&c), Some(listed()));
        c.messages = vec![history(Some(6), "new")];
        assert_eq!(get_latest_message(&c).unwrap().text, "new");
        c.messages = vec![history(None, "pending")];
        assert_eq!(get_latest_message(&c).unwrap().text, "pending");
    }

    #[test]
    fn last_message_sides() {
        let dto = ChatConversationDto {
            friend_id: "friend".into(),
            friend: ChatConversationFriend {
                id: "friend".into(),
                display_name: "F".into(),
                ..Default::default()
            },
            last_message: ChatConversationLastMessageDto {
                seq: 3,
                sender_id: "me".into(),
                body: "hi".into(),
                hidden: false,
                attachment_count: Some(2),
                created_at: "2026-01-01T00:00:00Z".into(),
            },
            last_message_at: "2026-01-01T00:00:00Z".into(),
            last_read_seq: 3,
            unread_count: 0,
            can_send: true,
        };
        assert_eq!(
            to_conversation_last_message(&dto),
            ChatConversationLastMessage {
                seq: 3,
                from_me: true,
                text: "hi".into(),
                created_at: "2026-01-01T00:00:00Z".into(),
                is_hidden: false,
                attachment_count: 2,
            }
        );
    }

    fn at(id: &str, created_at: Option<&str>, official: bool) -> ChatConversation {
        let mut c = conversation(id, id);
        c.friend.is_official = official;
        c.last_message = created_at.map(|created_at| ChatConversationLastMessage {
            seq: 1,
            from_me: true,
            text: "x".into(),
            created_at: created_at.into(),
            ..Default::default()
        });
        c
    }

    fn ids(sorted: Vec<&ChatConversation>) -> Vec<&str> {
        sorted.iter().map(|c| c.friend.id.as_str()).collect()
    }

    #[test]
    fn sorts_by_activity() {
        let list = [
            at("old", Some("2026-01-01T00:00:00Z"), false),
            at("newer", Some("2026-01-03T00:00:00Z"), false),
            at("same", Some("2026-01-01T00:00:00Z"), false),
        ];
        assert_eq!(
            ids(sort_conversations_by_activity(&list)),
            vec!["newer", "old", "same"]
        );

        let list = [
            at("chatted", Some("2026-01-03T00:00:00Z"), false),
            at("empty", None, false),
        ];
        assert_eq!(
            ids(sort_conversations_by_activity(&list)),
            vec!["empty", "chatted"]
        );

        let list = [
            at("chatted", Some("2026-01-03T00:00:00Z"), false),
            at("official", Some("2026-01-01T00:00:00Z"), true),
            at("empty", None, false),
        ];
        assert_eq!(
            ids(sort_conversations_by_activity(&list)),
            vec!["official", "empty", "chatted"]
        );
    }

    #[test]
    fn official_account() {
        let mut friend = UserFriend::default();
        assert!(!is_official_account(&friend));
        friend.is_official = true;
        assert!(is_official_account(&friend));
    }

    #[test]
    fn drops_abandoned_conversations() {
        let mut list = vec![
            conversation("a", "a"),
            conversation("b", "b"),
            conversation("c", "c"),
        ];
        list[2].draft = "hey".into();
        assert!(drop_abandoned_conversations(
            &mut list,
            Some("b"),
            &HashSet::new()
        ));
        let remaining: Vec<_> = list.iter().map(|c| c.friend.id.as_str()).collect();
        assert_eq!(remaining, vec!["b", "c"]);

        let mut list = vec![conversation("a", "a"), conversation("b", "b")];
        let keep: HashSet<String> = ["a".to_string()].into();
        assert!(!drop_abandoned_conversations(&mut list, Some("b"), &keep));
        assert_eq!(list.len(), 2);

        let mut listed_one = conversation("a", "a");
        listed_one.last_message = Some(listed());
        let mut unread = conversation("b", "b");
        unread.unread_count = 1;
        let mut list = vec![listed_one, unread, conversation("c", "c")];
        assert!(!drop_abandoned_conversations(
            &mut list,
            Some("c"),
            &HashSet::new()
        ));
        assert_eq!(list.len(), 3);
    }
}
