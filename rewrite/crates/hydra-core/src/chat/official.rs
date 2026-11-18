//! chat-official.ts: the Hydra team's one-way conversation.
//!
//! Electron falls back to a bundled SVG data URL for the sender's avatar.
//! Here `to_official_friend` leaves `profile_image_url` None (with
//! `is_official` set) and the UI draws `OFFICIAL_AVATAR_SVG` itself.

use serde_json::Value;

use super::dto::{
    ChatMessageDto, ChatMessagesPage, OfficialMessagesPage, OfficialSender, UserFriend, parse,
};
use super::state::to_chat_message;
use super::types::{ChatConversation, ChatLoadState};

/// The paths of assets/icons/hydra.svg (viewBox 0 0 55 49).
pub const HYDRA_LOGO_PATHS: &str = r#"<path d="M17.8501 29.1176L19.9196 28.3235L20.6957 25.6764L20.437 24.8823L18.1088 25.9411L14.487 24.3528L10.0891 23.0293L5.69128 23.5587L3.10431 25.6764L2.58691 29.1176L4.1391 33.6177L5.69128 36.7942L8.53695 38.9118L10.8652 38.3824L13.9696 34.9412V31.5L12.9348 29.1176V32.2941L10.8652 34.9412H7.50216L4.91519 32.2941L5.69128 28.3235L9.57174 26.4705L13.9696 27.5294L17.8501 29.1176Z"/><path d="M36.9585 29.1176L34.889 28.3235L34.1129 25.6764L34.3716 24.8823L36.6998 25.9411L40.3216 24.3528L44.7195 23.0293L49.1173 23.5587L51.7043 25.6764L52.2217 29.1176L50.6695 33.6177L49.1173 36.7942L46.2716 38.9118L43.9434 38.3824L40.839 34.9412V31.5L41.8738 29.1176V32.2941L43.9434 34.9412H47.3064L49.8934 32.2941L49.1173 28.3235L45.2369 26.4705L40.839 27.5294L36.9585 29.1176Z"/><path d="M40.3873 19.4005L38.8784 19.9071L38.7685 19.0593L38.5553 17.7049L39.811 14.777L41.6564 11.5721L44.483 9.44001L47.1023 9.23162L49.2244 10.9371L50.7089 14.4032L51.4925 17.1031L50.9665 19.9071L49.3381 20.8916L45.7182 20.6206L43.8957 18.6282L43.2332 16.675L44.9154 18.5142L47.5156 18.8992L49.4627 17.0344L49.5586 14.0673L47.0064 12.1987L43.7784 13.2776L41.7929 16.3293L40.3873 19.4005Z"/><path d="M14.0238 19.4005L15.5327 19.9071L15.6426 19.0593L15.8559 17.7049L14.6001 14.777L12.7548 11.5721L9.92812 9.44001L7.30879 9.23162L5.18676 10.9371L3.70221 14.4032L2.91861 17.1031L3.44468 19.9071L5.07308 20.8916L8.69292 20.6206L10.5154 18.6282L11.178 16.675L9.4957 18.5142L6.89555 18.8992L4.94841 17.0344L4.8525 14.0673L7.4047 12.1987L10.6327 13.2776L12.6182 16.3293L14.0238 19.4005Z"/><path d="M19.9494 36.4343L22.554 34.3372L21.9876 34.0884L20.9528 31.9707L19.9494 32.5001L17.5898 34.0884L15.3904 37.377L14.744 40.4414L15.2615 43.0885L17.0724 45.4709L20.9528 47.3238L23.6932 46.5297L25.435 44.7653L26.0028 42.9192L25.6093 39.0508L25.0919 37.7913L23.6932 37.0002L24.3158 39.105L24.3158 42.0296L22.3597 43.9181L19.9494 43.9181L18.0225 42.0296L17.4949 39.105L19.9494 36.4343Z"/><path d="M35.0955 36.4343L32.4909 34.3372L33.0573 34.0884L34.0921 31.9707L35.0955 32.5001L37.4552 34.0884L39.6545 37.377L40.3009 40.4414L39.7834 43.0885L37.9725 45.4709L34.0921 47.3238L31.3518 46.5297L29.6099 44.7653L29.0421 42.9192L29.4356 39.0508L29.953 37.7913L31.3518 37.0002L30.7291 39.105L30.7291 42.0296L32.6852 43.9181L35.0955 43.9181L37.0224 42.0296L37.55 39.105L35.0955 36.4343Z"/><path d="M18.8447 8.70593V5.79413L20.1382 5H22.9839L27.3817 5.79413L31.7796 5H34.6252L35.9187 5.79413V8.70593L38.7644 11.353L37.2122 15.0589L37.9883 20.8825L35.9187 23.0002L33.3317 23.7943L32.8144 26.1767L33.3317 28.8238L32.8144 30.9415L31.7796 33.0591L30.2274 33.8533H27.3817H24.536L22.9839 33.0591L21.9491 30.9415L21.4317 28.8238L21.9491 26.1767L21.4317 23.7943L18.8447 23.0002L16.7751 20.8825L17.5512 15.0589L15.999 11.353L18.8447 8.70593Z"/><path d="M15.5205 6.88232L16.2966 8.73528L17.5901 7.67645V4.76465L15.5205 6.88232Z"/><path d="M39.2861 6.88232L38.51 8.73528L37.2166 7.67645V4.76465L39.2861 6.88232Z"/><path d="M18.3667 2.11767L18.6254 4.23534L19.4015 3.70593H20.9537L20.4363 2.11767L17.0732 0L18.3667 2.11767Z"/><path d="M35.6997 2.11767L35.441 4.23534L34.6649 3.70593H33.1127L33.6301 2.11767L36.9932 0L35.6997 2.11767Z"/>"#;

/// OFFICIAL_AVATAR_URL's SVG: the Hydra logo, white on a #1c1c1c square.
pub fn official_avatar_svg() -> String {
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" fill="#1c1c1c"/><g transform="translate(14 16.5) scale(0.95)" fill="#ffffff">{HYDRA_LOGO_PATHS}</g></svg>"##
    )
}

/// toOfficialFriend. A null picture stays None (the UI draws the logo).
pub fn to_official_friend(sender: &OfficialSender) -> UserFriend {
    UserFriend {
        id: sender.id.clone(),
        display_name: sender.display_name.clone(),
        profile_image_url: sender.profile_image_url.clone(),
        background_image_url: None,
        current_game: None,
        is_online: Some(false),
        is_official: true,
    }
}

/// isOfficialMessagesPage, as a parser: a Cloudflare error page once reached
/// the launcher as API data, so the shape is checked first.
pub fn parse_official_messages_page(value: &Value) -> Option<OfficialMessagesPage> {
    let object = value.as_object()?;
    object.get("messages")?.as_array()?;
    let sender = object.get("sender")?.as_object()?;
    sender.get("id")?.as_str()?;
    sender.get("displayName")?.as_str()?;
    let unread = object.get("unreadCount")?;
    // Number.isSafeInteger
    let is_safe_integer = unread.as_i64().is_some_and(|n| n.abs() <= MAX_SAFE_INTEGER)
        || unread
            .as_f64()
            .is_some_and(|n| n.fract() == 0.0 && n.abs() <= MAX_SAFE_INTEGER as f64);
    if !is_safe_integer {
        return None;
    }
    parse(value)
}

/// Number.MAX_SAFE_INTEGER
pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// toChatMessagesPage: the official page in the shape history loading uses.
pub fn to_chat_messages_page(
    page: &OfficialMessagesPage,
    after_seq: Option<i64>,
) -> ChatMessagesPage {
    ChatMessagesPage {
        messages: page
            .messages
            .iter()
            .filter(|message| after_seq.is_none_or(|after| message.seq > after))
            .map(|message| ChatMessageDto {
                seq: message.seq,
                sender_id: message.sender_id.clone(),
                body: message.body.clone(),
                client_nonce: message.id.clone(),
                created_at: message.created_at.clone(),
                attachments: Some(message.attachments.clone()),
                ..Default::default()
            })
            .collect(),
        has_more: after_seq.is_none() && page.has_more_before,
        can_send: false,
        last_read_seq: 0,
        unread_count: page.unread_count,
        pending_messages: Vec::new(),
    }
}

/// applyOfficialPage: replaces the official conversation with the latest
/// page (older ones page in again on scroll), first in the list; with no
/// visible messages the row goes away.
pub fn apply_official_page(conversations: &mut Vec<ChatConversation>, page: &OfficialMessagesPage) {
    let position = conversations
        .iter()
        .position(|conversation| conversation.friend.id == page.sender.id);
    let existing = position.map(|at| conversations.remove(at));
    if page.messages.is_empty() {
        return;
    }

    let friend = to_official_friend(&page.sender);
    let messages = to_chat_messages_page(page, None)
        .messages
        .iter()
        .map(|message| to_chat_message(message, &friend.id, true))
        .collect();
    let mut conversation = existing.unwrap_or_else(|| ChatConversation::new(friend.clone()));
    conversation.friend = friend;
    conversation.messages = messages;
    conversation.unread_count = page.unread_count;
    conversation.can_send = false;
    conversation.load_state = ChatLoadState::Loaded;
    conversation.has_more_before = page.has_more_before;
    conversation.is_loading_older = false;
    conversation.gap_after_seq = None;
    conversations.insert(0, conversation);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::dto::OfficialMessageDto;
    use serde_json::json;

    fn sender() -> OfficialSender {
        OfficialSender {
            id: "HYDRAOFC".into(),
            display_name: "Hydra".into(),
            profile_image_url: None,
            is_official: true,
        }
    }

    fn dto(seq: i64) -> OfficialMessageDto {
        OfficialMessageDto {
            id: format!("message-{seq}"),
            seq,
            sender_id: "HYDRAOFC".into(),
            body: format!("Message {seq}"),
            locale: "en".into(),
            attachments: vec![],
            created_at: format!("1970-01-01T00:00:{:02}.000Z", seq % 60),
            is_unread: false,
        }
    }

    fn page(seqs: &[i64], has_more_before: bool, unread_count: i64) -> OfficialMessagesPage {
        OfficialMessagesPage {
            sender: sender(),
            messages: seqs.iter().copied().map(dto).collect(),
            unread_count,
            has_more_before,
            next_poll_seconds: 1800.0,
        }
    }

    fn other() -> ChatConversation {
        ChatConversation::new(UserFriend {
            id: "friend01".into(),
            display_name: "Friend".into(),
            is_online: Some(false),
            ..Default::default()
        })
    }

    #[test]
    fn accepts_only_real_pages() {
        let real = serde_json::to_value(page(&[1], false, 0)).unwrap();
        assert!(parse_official_messages_page(&real).is_some());
        assert!(
            parse_official_messages_page(&json!({ "title": "Error 1200: rate limited" })).is_none()
        );
        assert!(parse_official_messages_page(&Value::Null).is_none());
        assert!(parse_official_messages_page(&json!("<html></html>")).is_none());
        let mut fractional = real.clone();
        fractional["unreadCount"] = json!(1.5);
        assert!(parse_official_messages_page(&fractional).is_none());
    }

    #[test]
    fn official_friend_falls_back_to_the_logo() {
        let friend = to_official_friend(&sender());
        assert!(friend.is_official);
        assert_eq!(friend.profile_image_url, None);
        assert!(official_avatar_svg().starts_with("<svg"));
    }

    #[test]
    fn messages_page_uses_ids_as_nonces_and_never_sends() {
        let result = to_chat_messages_page(&page(&[1, 2], true, 0), None);
        assert_eq!(result.messages[0].client_nonce, "message-1");
        assert!(!result.can_send);
        assert!(result.has_more);

        let after = to_chat_messages_page(&page(&[1, 2, 3], true, 0), Some(2));
        let seqs: Vec<_> = after.messages.iter().map(|m| m.seq).collect();
        assert_eq!(seqs, vec![3]);
        assert!(!after.has_more);
    }

    #[test]
    fn applies_as_a_loaded_conversation() {
        let mut conversations = vec![other()];
        apply_official_page(&mut conversations, &page(&[1, 7], false, 2));
        let official = &conversations[0];
        assert_eq!(official.friend.id, "HYDRAOFC");
        assert!(official.friend.is_official);
        assert_eq!(official.load_state, ChatLoadState::Loaded);
        assert!(!official.can_send);
        assert_eq!(official.unread_count, 2);
        assert_eq!(official.gap_after_seq, None);
        assert!(!official.messages[0].from_me);
        assert_eq!(conversations[1].friend.id, "friend01");
    }

    #[test]
    fn removes_the_row_once_empty() {
        let mut conversations = vec![other()];
        apply_official_page(&mut conversations, &page(&[1], false, 0));
        apply_official_page(&mut conversations, &page(&[], false, 0));
        let ids: Vec<_> = conversations.iter().map(|c| c.friend.id.as_str()).collect();
        assert_eq!(ids, vec!["friend01"]);
    }

    #[test]
    fn replaces_history_with_the_latest_page() {
        let mut conversations = Vec::new();
        apply_official_page(&mut conversations, &page(&[1, 2, 3, 4], false, 0));
        apply_official_page(&mut conversations, &page(&[3, 5], true, 0));
        let seqs: Vec<_> = conversations[0]
            .messages
            .iter()
            .map(|m| m.seq.unwrap())
            .collect();
        assert_eq!(seqs, vec![3, 5]);
        assert!(conversations[0].has_more_before);
    }
}
