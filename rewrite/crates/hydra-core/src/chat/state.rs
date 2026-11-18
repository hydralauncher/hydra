//! chat-state.ts: turning API messages into the window's messages and
//! updating a conversation's list. The TS functions return new arrays; these
//! change the list in place and return whether anything matched.

use std::collections::HashMap;

use super::dto::{ChatAttachmentDto, ChatMessageDto, ChatPendingMessageDto, ChatReactionDto};
use super::reactions::merge_reactions;
use super::types::{
    ChatAttachment, ChatFailure, ChatMessage, ChatMessageReply, ChatMessageStatus, ChatReaction,
    QuotedMessage,
};

/// toChatAttachments
pub fn to_chat_attachments(dtos: &[ChatAttachmentDto]) -> Vec<ChatAttachment> {
    dtos.iter()
        .map(|dto| ChatAttachment {
            id: dto.id.clone(),
            content_type: dto.content_type.clone(),
            width: dto.width,
            height: dto.height,
            spoiler: dto.spoiler,
            url: dto.url.clone(),
            local_url: None,
        })
        .collect()
}

/// toChatReactions: a reaction not from the friend is the user's.
pub fn to_chat_reactions(dtos: &[ChatReactionDto], friend_id: &str) -> Vec<ChatReaction> {
    dtos.iter()
        .map(|dto| ChatReaction {
            emoji: Some(dto.emoji.clone()),
            from_me: dto.user_id != friend_id,
            updated_at: dto.updated_at.clone(),
            is_pending: false,
        })
        .collect()
}

fn to_chat_message_reply(dto: &ChatMessageDto, friend_id: &str) -> Option<ChatMessageReply> {
    let seq = dto.reply_to_seq.filter(|seq| *seq != 0)?;
    Some(ChatMessageReply {
        seq,
        quoted: dto.reply_to.as_ref().map(|reply| QuotedMessage {
            from_me: reply.sender_id != friend_id,
            text: reply.body.clone(),
            is_hidden: reply.hidden,
            attachment_count: reply.attachment_count.unwrap_or(0),
        }),
    })
}

/// toChatMessage
pub fn to_chat_message(dto: &ChatMessageDto, friend_id: &str, from_history: bool) -> ChatMessage {
    ChatMessage {
        id: dto.client_nonce.clone(),
        client_nonce: dto.client_nonce.clone(),
        seq: Some(dto.seq),
        from_me: dto.sender_id != friend_id,
        text: dto.body.clone(),
        created_at: dto.created_at.clone(),
        status: ChatMessageStatus::Sent,
        is_hidden: dto.hidden,
        reply_to: to_chat_message_reply(dto, friend_id),
        reactions: dto
            .reactions
            .as_ref()
            .map(|reactions| to_chat_reactions(reactions, friend_id)),
        from_history,
        attachments: dto
            .attachments
            .as_ref()
            .filter(|attachments| !attachments.is_empty())
            .map(|attachments| to_chat_attachments(attachments)),
        upload_progress: None,
        failure: None,
    }
}

/// toPendingChatMessage: the user's own message with images the server holds.
pub fn to_pending_chat_message(dto: &ChatPendingMessageDto) -> ChatMessage {
    use super::dto::ChatPendingMessageStatus as Held;
    ChatMessage {
        id: dto.client_nonce.clone(),
        client_nonce: dto.client_nonce.clone(),
        seq: None,
        from_me: true,
        text: dto.body.clone(),
        created_at: dto.created_at.clone(),
        status: match dto.status {
            Held::Checking => ChatMessageStatus::Checking,
            Held::Blocked => ChatMessageStatus::Blocked,
            Held::Failed => ChatMessageStatus::Failed,
        },
        reply_to: dto
            .reply_to_seq
            .filter(|seq| *seq != 0)
            .map(|seq| ChatMessageReply { seq, quoted: None }),
        attachments: Some(to_chat_attachments(&dto.attachments)),
        from_history: true,
        ..Default::default()
    }
}

/// createReply: only stored, visible messages can be replied to.
pub fn create_reply(target: &ChatMessage) -> Option<ChatMessageReply> {
    let seq = target.seq?;
    if target.is_hidden {
        return None;
    }
    Some(ChatMessageReply {
        seq,
        quoted: Some(QuotedMessage {
            from_me: target.from_me,
            text: target.text.clone(),
            is_hidden: false,
            attachment_count: target.attachment_count() as u32,
        }),
    })
}

/// createPendingMessage. `created_at` None is now.
pub fn create_pending_message(
    text: &str,
    client_nonce: &str,
    created_at: Option<String>,
    reply_to: Option<ChatMessageReply>,
    attachments: Vec<ChatAttachment>,
) -> ChatMessage {
    let has_attachments = !attachments.is_empty();
    ChatMessage {
        id: client_nonce.to_string(),
        client_nonce: client_nonce.to_string(),
        seq: None,
        from_me: true,
        text: text.to_string(),
        created_at: created_at.unwrap_or_else(crate::library_actions::now_iso),
        status: ChatMessageStatus::Pending,
        reply_to,
        attachments: has_attachments.then_some(attachments),
        upload_progress: has_attachments.then_some(0.0),
        ..Default::default()
    }
}

/// keepLocalCopies: the sender's local copies stay on the stored images.
/// Attachments match by id, else by position when the counts agree.
fn keep_local_copies(incoming: &mut [ChatAttachment], existing: &[ChatAttachment]) {
    let same_length = existing.len() == incoming.len();
    for (index, attachment) in incoming.iter_mut().enumerate() {
        let previous = existing
            .iter()
            .find(|current| current.id == attachment.id)
            .or_else(|| same_length.then(|| &existing[index]));
        let Some(previous) = previous else { continue };
        let Some(local) = &previous.local_url else {
            continue;
        };
        attachment.local_url = Some(local.clone());
        attachment.width = attachment.width.or(previous.width);
        attachment.height = attachment.height.or(previous.height);
    }
}

/// mergeChatMessages: a stored message replaces the optimistic copy with the
/// same nonce, duplicates collapse, stored messages are in seq order and
/// unsent ones follow in the order they were written.
pub fn merge_chat_messages(current: &mut Vec<ChatMessage>, incoming: Vec<ChatMessage>) {
    let mut ordered: Vec<ChatMessage> = Vec::with_capacity(current.len() + incoming.len());
    let mut index: HashMap<String, usize> = HashMap::new();
    for message in current.drain(..) {
        match index.get(&message.client_nonce) {
            Some(&at) => ordered[at] = message,
            None => {
                index.insert(message.client_nonce.clone(), ordered.len());
                ordered.push(message);
            }
        }
    }

    for mut message in incoming {
        let at = index.get(&message.client_nonce).copied();
        if let Some(existing) = at.map(|at| &ordered[at]) {
            if let Some(known) = &existing.reactions {
                // Realtime messages carry no reactions; keep the ones known.
                message.reactions = Some(match &message.reactions {
                    Some(stored) => merge_reactions(known, stored, false),
                    None => known.clone(),
                });
            }
            if let (Some(existing_attachments), Some(attachments)) =
                (&existing.attachments, &mut message.attachments)
            {
                keep_local_copies(attachments, existing_attachments);
            }
            if existing.from_history {
                message.from_history = true;
            }
        }
        match at {
            Some(at) => ordered[at] = message,
            None => {
                index.insert(message.client_nonce.clone(), ordered.len());
                ordered.push(message);
            }
        }
    }

    let (mut stored, unsent): (Vec<_>, Vec<_>) = ordered
        .into_iter()
        .partition(|message| message.seq.is_some());
    stored.sort_by_key(|message| message.seq.unwrap_or(0));
    current.extend(stored);
    current.extend(unsent);
}

/// setMessageVisibility: removes the message with `seq` (`text` None) or puts
/// it back with `text`, along with the quotes of it in replies.
pub fn set_message_visibility(messages: &mut [ChatMessage], seq: i64, text: Option<&str>) -> bool {
    let mut changed = false;
    for message in messages.iter_mut() {
        if message.seq == Some(seq) {
            changed = true;
            message.text = text.unwrap_or_default().to_string();
            if text.is_none() {
                message.is_hidden = true;
                // Removed images keep their size for the placeholder, not their URL.
                if let Some(attachments) = &mut message.attachments {
                    for attachment in attachments {
                        attachment.url = None;
                        attachment.local_url = None;
                    }
                }
            } else {
                message.is_hidden = false;
            }
        }

        if let Some(reply) = &mut message.reply_to
            && reply.seq == seq
            && let Some(quoted) = &mut reply.quoted
        {
            changed = true;
            match text {
                None => {
                    quoted.text.clear();
                    quoted.is_hidden = true;
                }
                Some(text) => {
                    quoted.text = text.to_string();
                    quoted.is_hidden = false;
                }
            }
        }
    }
    changed
}

fn update_unsent(
    messages: &mut [ChatMessage],
    client_nonce: &str,
    mut update: impl FnMut(&mut ChatMessage),
) -> bool {
    let mut changed = false;
    for message in messages
        .iter_mut()
        .filter(|m| m.client_nonce == client_nonce && m.seq.is_none())
    {
        update(message);
        changed = true;
    }
    changed
}

/// setMessageStatus: only unsent messages change.
pub fn set_message_status(
    messages: &mut [ChatMessage],
    client_nonce: &str,
    status: ChatMessageStatus,
) -> bool {
    update_unsent(messages, client_nonce, |m| m.status = status)
}

/// setMessageFailed: `failure` replaces the previous reason (None clears it).
pub fn set_message_failed(
    messages: &mut [ChatMessage],
    client_nonce: &str,
    failure: Option<ChatFailure>,
) -> bool {
    update_unsent(messages, client_nonce, |m| {
        m.status = ChatMessageStatus::Failed;
        m.failure = failure;
    })
}

/// setMessageUploadProgress
pub fn set_message_upload_progress(
    messages: &mut [ChatMessage],
    client_nonce: &str,
    upload_progress: f64,
) -> bool {
    update_unsent(messages, client_nonce, |m| {
        m.upload_progress = Some(upload_progress)
    })
}

/// setMessageAttachmentIds: swaps local ids for the reserved ones.
pub fn set_message_attachment_ids(
    messages: &mut [ChatMessage],
    client_nonce: &str,
    ids: &[String],
) -> bool {
    update_unsent(messages, client_nonce, |m| {
        if let Some(attachments) = &mut m.attachments {
            for (index, attachment) in attachments.iter_mut().enumerate() {
                if let Some(id) = ids.get(index) {
                    attachment.id = id.clone();
                }
            }
        }
    })
}

/// settleSendingMessage: moves a `pending` message on once its request
/// settles, unless a realtime event already did.
pub fn settle_sending_message(
    messages: &mut [ChatMessage],
    client_nonce: &str,
    status: ChatMessageStatus,
) -> bool {
    let mut changed = false;
    update_unsent(messages, client_nonce, |m| {
        if m.status == ChatMessageStatus::Pending {
            m.upload_progress = None;
            m.status = status;
            changed = true;
        }
    });
    changed
}

/// removeUnsentMessage
pub fn remove_unsent_message(messages: &mut Vec<ChatMessage>, client_nonce: &str) -> bool {
    let before = messages.len();
    messages.retain(|m| m.client_nonce != client_nonce || m.seq.is_some());
    messages.len() != before
}

/// mergePendingMessages: the server's view of the user's held messages. One
/// still uploading or posting here keeps its local state.
pub fn merge_pending_messages(current: &mut Vec<ChatMessage>, pending: Vec<ChatMessage>) {
    let in_flight: Vec<&str> = current
        .iter()
        .filter(|m| m.seq.is_none() && m.status == ChatMessageStatus::Pending)
        .map(|m| m.client_nonce.as_str())
        .collect();
    let delivered: Vec<&str> = current
        .iter()
        .filter(|m| m.seq.is_some())
        .map(|m| m.client_nonce.as_str())
        .collect();
    let incoming: Vec<ChatMessage> = pending
        .into_iter()
        .filter(|m| {
            !in_flight.contains(&m.client_nonce.as_str())
                && !delivered.contains(&m.client_nonce.as_str())
        })
        .collect();
    merge_chat_messages(current, incoming);
}

/// getLatestSeq
pub fn get_latest_seq(messages: &[ChatMessage]) -> i64 {
    messages
        .iter()
        .fold(0, |latest, m| latest.max(m.seq.unwrap_or(0)))
}

/// hasGapBefore: messages between what is loaded and `seq` were never received.
pub fn has_gap_before(messages: &[ChatMessage], seq: i64) -> bool {
    let latest = get_latest_seq(messages);
    latest > 0 && seq > latest + 1
}

/// findGapAfter: the gap already recorded, else the newest loaded message if
/// `seq` skips past it.
pub fn find_gap_after(
    messages: &[ChatMessage],
    gap_after_seq: Option<i64>,
    seq: i64,
) -> Option<i64> {
    gap_after_seq.or_else(|| has_gap_before(messages, seq).then(|| get_latest_seq(messages)))
}

/// countFriendMessagesAfter: 0 once the message is gone.
pub fn count_friend_messages_after(messages: &[ChatMessage], message_id: &str) -> usize {
    let Some(index) = messages.iter().position(|m| m.id == message_id) else {
        return 0;
    };
    messages[index + 1..].iter().filter(|m| !m.from_me).count()
}

/// findFirstFriendMessageAfter
pub fn find_first_friend_message_after<'a>(
    messages: &'a [ChatMessage],
    message_id: &str,
) -> Option<&'a ChatMessage> {
    let index = messages.iter().position(|m| m.id == message_id)?;
    messages[index + 1..].iter().find(|m| !m.from_me)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::dto::{ChatPendingMessageStatus, ChatReplyDto};

    const FRIEND_ID: &str = "friend01";
    const MY_ID: &str = "myself01";
    const CREATED_AT: &str = "2026-10-05T12:00:00.000Z";

    fn dto(seq: i64, sender: &str) -> ChatMessageDto {
        ChatMessageDto {
            seq,
            sender_id: sender.into(),
            body: format!("message {seq}"),
            client_nonce: format!("nonce-{seq}"),
            created_at: CREATED_AT.into(),
            ..Default::default()
        }
    }
    fn stored(seq: i64) -> ChatMessage {
        to_chat_message(&dto(seq, FRIEND_ID), FRIEND_ID, false)
    }
    fn stored_from(seq: i64, sender: &str) -> ChatMessage {
        to_chat_message(&dto(seq, sender), FRIEND_ID, false)
    }
    fn pending(text: &str, nonce: &str) -> ChatMessage {
        create_pending_message(text, nonce, Some(CREATED_AT.into()), None, vec![])
    }
    fn image() -> ChatAttachmentDto {
        ChatAttachmentDto {
            id: "attachment-1".into(),
            content_type: "image/jpeg".into(),
            width: Some(1568),
            height: Some(882),
            spoiler: false,
            url: Some("https://images.example/attachment-1".into()),
        }
    }
    fn image_model() -> ChatAttachment {
        to_chat_attachments(&[image()]).remove(0)
    }
    fn local_image() -> ChatAttachment {
        ChatAttachment {
            id: "local-1".into(),
            url: None,
            local_url: Some("blob:1".into()),
            ..image_model()
        }
    }
    fn reaction(emoji: Option<&str>, from_me: bool, at: &str) -> ChatReaction {
        ChatReaction {
            emoji: emoji.map(str::to_string),
            from_me,
            updated_at: at.into(),
            is_pending: false,
        }
    }

    #[test]
    fn to_chat_message_keys_by_nonce_and_side() {
        assert_eq!(
            stored(3),
            ChatMessage {
                id: "nonce-3".into(),
                client_nonce: "nonce-3".into(),
                seq: Some(3),
                from_me: false,
                text: "message 3".into(),
                created_at: CREATED_AT.into(),
                status: ChatMessageStatus::Sent,
                ..Default::default()
            }
        );
        assert!(stored_from(4, MY_ID).from_me);
    }

    #[test]
    fn to_chat_message_keeps_reactions() {
        let mut source = dto(6, FRIEND_ID);
        source.reactions = Some(vec![
            ChatReactionDto {
                user_id: FRIEND_ID.into(),
                emoji: "😂".into(),
                updated_at: CREATED_AT.into(),
            },
            ChatReactionDto {
                user_id: MY_ID.into(),
                emoji: "💀".into(),
                updated_at: CREATED_AT.into(),
            },
        ]);
        let message = to_chat_message(&source, FRIEND_ID, false);
        assert_eq!(
            message.reactions,
            Some(vec![
                reaction(Some("😂"), false, CREATED_AT),
                reaction(Some("💀"), true, CREATED_AT)
            ])
        );
        assert_eq!(stored(7).reactions, None);
    }

    #[test]
    fn to_chat_message_keeps_the_replied_to_message() {
        let reply = |sender: &str| {
            let mut source = dto(5, FRIEND_ID);
            source.reply_to_seq = Some(4);
            source.reply_to = Some(ChatReplyDto {
                sender_id: sender.into(),
                body: "lunch?".into(),
                ..Default::default()
            });
            to_chat_message(&source, FRIEND_ID, false).reply_to
        };
        assert_eq!(
            reply(MY_ID),
            Some(ChatMessageReply {
                seq: 4,
                quoted: Some(QuotedMessage {
                    from_me: true,
                    text: "lunch?".into(),
                    ..Default::default()
                })
            })
        );
        assert!(!reply(FRIEND_ID).unwrap().quoted.unwrap().from_me);

        let mut gone = dto(5, FRIEND_ID);
        gone.reply_to_seq = Some(4);
        assert_eq!(
            to_chat_message(&gone, FRIEND_ID, false).reply_to,
            Some(ChatMessageReply {
                seq: 4,
                quoted: None
            })
        );
    }

    #[test]
    fn to_chat_message_marks_removed_messages_and_quotes() {
        let mut source = dto(8, MY_ID);
        source.body.clear();
        source.hidden = true;
        source.reply_to_seq = Some(7);
        source.reply_to = Some(ChatReplyDto {
            sender_id: FRIEND_ID.into(),
            hidden: true,
            ..Default::default()
        });
        let message = to_chat_message(&source, FRIEND_ID, false);
        assert!(message.is_hidden);
        assert_eq!(
            message.reply_to.unwrap().quoted,
            Some(QuotedMessage {
                is_hidden: true,
                ..Default::default()
            })
        );
        assert!(!stored(3).is_hidden);
    }

    #[test]
    fn create_reply_rules() {
        assert_eq!(
            create_reply(&stored(3)),
            Some(ChatMessageReply {
                seq: 3,
                quoted: Some(QuotedMessage {
                    text: "message 3".into(),
                    ..Default::default()
                })
            })
        );
        assert_eq!(create_reply(&pending("hi", "nonce-9")), None);
        let mut hidden = stored(3);
        hidden.is_hidden = true;
        assert_eq!(create_reply(&hidden), None);

        let reply = create_reply(&stored(3));
        let carried = create_pending_message(
            "ok",
            "nonce-9",
            Some(CREATED_AT.into()),
            reply.clone(),
            vec![],
        );
        assert_eq!(carried.reply_to, reply);
        assert_eq!(pending("ok", "nonce-10").reply_to, None);
    }

    #[test]
    fn merge_orders_and_dedupes() {
        let mut messages = vec![stored(1), stored(3)];
        merge_chat_messages(&mut messages, vec![stored(2), stored(3)]);
        let seqs: Vec<_> = messages.iter().map(|m| m.seq.unwrap()).collect();
        assert_eq!(seqs, vec![1, 2, 3]);
    }

    #[test]
    fn merge_keeps_known_reactions() {
        let mut reacted = stored(1);
        reacted.reactions = Some(vec![reaction(Some("🔥"), true, CREATED_AT)]);

        let mut from_realtime = vec![reacted.clone()];
        merge_chat_messages(&mut from_realtime, vec![stored(1)]);
        assert_eq!(from_realtime[0].reactions, reacted.reactions);

        let mut from_history = vec![reacted];
        let mut empty = stored(1);
        empty.reactions = Some(vec![]);
        merge_chat_messages(&mut from_history, vec![empty]);
        assert_eq!(
            from_history[0].reactions,
            Some(vec![reaction(None, true, CREATED_AT)])
        );
    }

    #[test]
    fn merge_keeps_a_newer_reaction() {
        let later = "2026-10-09T13:00:00.000Z";
        let mut reacted = stored(1);
        reacted.reactions = Some(vec![reaction(Some("🔥"), false, later)]);
        let mut history = stored(1);
        history.reactions = Some(vec![reaction(Some("😂"), false, CREATED_AT)]);
        let mut messages = vec![reacted.clone()];
        merge_chat_messages(&mut messages, vec![history]);
        assert_eq!(messages[0].reactions, reacted.reactions);
    }

    #[test]
    fn merge_replaces_the_optimistic_copy() {
        let mut confirmed_dto = dto(2, MY_ID);
        confirmed_dto.body = "hi".into();
        confirmed_dto.client_nonce = "nonce-9".into();
        let confirmed = to_chat_message(&confirmed_dto, FRIEND_ID, false);
        let mut messages = vec![stored(1), pending("hi", "nonce-9")];
        merge_chat_messages(&mut messages, vec![confirmed]);
        let summary: Vec<_> = messages
            .iter()
            .map(|m| (m.id.as_str(), m.seq, m.status))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("nonce-1", Some(1), ChatMessageStatus::Sent),
                ("nonce-9", Some(2), ChatMessageStatus::Sent)
            ]
        );
    }

    #[test]
    fn merge_keeps_unsent_after_stored() {
        let mut messages = vec![pending("first", "a"), pending("second", "b")];
        merge_chat_messages(&mut messages, vec![stored(1)]);
        let ids: Vec<_> = messages.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["nonce-1", "a", "b"]);
    }

    #[test]
    fn status_only_changes_unsent() {
        let mut messages = vec![stored(1), pending("hi", "nonce-9")];
        set_message_status(&mut messages, "nonce-9", ChatMessageStatus::Failed);
        assert_eq!(messages[1].status, ChatMessageStatus::Failed);
        assert!(!set_message_status(
            &mut messages,
            "nonce-1",
            ChatMessageStatus::Failed
        ));
        assert_eq!(messages[0].status, ChatMessageStatus::Sent);
    }

    #[test]
    fn failure_reason_lasts_until_the_next_failure() {
        let mut messages = vec![pending("", "nonce-9")];
        set_message_failed(&mut messages, "nonce-9", Some(ChatFailure::DailyLimit));
        assert_eq!(messages[0].status, ChatMessageStatus::Failed);
        assert_eq!(messages[0].failure, Some(ChatFailure::DailyLimit));
        set_message_failed(&mut messages, "nonce-9", None);
        assert_eq!(messages[0].failure, None);
    }

    fn reply_message(seq: i64, reply_to_seq: i64) -> ChatMessage {
        let mut source = dto(seq, MY_ID);
        source.body = "lol".into();
        source.reply_to_seq = Some(reply_to_seq);
        source.reply_to = Some(ChatReplyDto {
            sender_id: FRIEND_ID.into(),
            body: format!("message {reply_to_seq}"),
            ..Default::default()
        });
        to_chat_message(&source, FRIEND_ID, false)
    }

    #[test]
    fn visibility_removes_the_message_and_its_quotes() {
        let mut messages = vec![stored(1), stored(2), reply_message(3, 2)];
        set_message_visibility(&mut messages, 2, None);
        assert!(!messages[0].is_hidden);
        assert!(messages[1].is_hidden);
        assert_eq!(messages[1].text, "");
        assert_eq!(
            messages[2].reply_to.as_ref().unwrap().quoted,
            Some(QuotedMessage {
                is_hidden: true,
                ..Default::default()
            })
        );
        assert_eq!(messages[2].text, "lol");
    }

    #[test]
    fn visibility_puts_them_back() {
        let original = vec![stored(2), reply_message(3, 2)];
        let mut messages = original.clone();
        set_message_visibility(&mut messages, 2, None);
        set_message_visibility(&mut messages, 2, Some("message 2"));
        assert_eq!(messages, original);
    }

    #[test]
    fn visibility_leaves_others_alone() {
        let original = vec![stored(1), reply_message(3, 1)];
        let mut messages = original.clone();
        assert!(!set_message_visibility(&mut messages, 2, None));
        assert_eq!(messages, original);
    }

    #[test]
    fn gaps() {
        assert_eq!(get_latest_seq(&[]), 0);
        assert_eq!(
            get_latest_seq(&[stored(2), pending("x", "x"), stored(5)]),
            5
        );
        assert!(!has_gap_before(&[stored(1), stored(2)], 3));
        assert!(has_gap_before(&[stored(1), stored(2)], 5));
        assert!(!has_gap_before(&[], 5));

        let messages = vec![stored(1), stored(2), stored(3)];
        assert_eq!(find_gap_after(&messages, None, 4), None);
        assert_eq!(find_gap_after(&messages, None, 6), Some(3));
        let mut with_six = messages.clone();
        with_six.push(stored(6));
        assert_eq!(find_gap_after(&with_six, Some(3), 7), Some(3));
    }

    #[test]
    fn friend_messages_after() {
        let messages = vec![stored(1), stored_from(2, MY_ID), stored(3), stored(4)];
        assert_eq!(count_friend_messages_after(&messages, "nonce-1"), 2);
        let two = vec![stored(1), stored(2)];
        assert_eq!(count_friend_messages_after(&two, "nonce-2"), 0);
        assert_eq!(
            count_friend_messages_after(&[stored(1)], "nonce-missing"),
            0
        );

        let mixed = vec![stored(1), stored_from(2, MY_ID), stored(3)];
        assert_eq!(
            find_first_friend_message_after(&mixed, "nonce-1"),
            Some(&mixed[2])
        );
        let mine = vec![stored(1), stored_from(2, MY_ID)];
        assert_eq!(find_first_friend_message_after(&mine, "nonce-1"), None);
    }

    #[test]
    fn images_of_stored_messages_and_reply_counts() {
        let mut source = dto(9, FRIEND_ID);
        source.body.clear();
        source.reply_to_seq = Some(8);
        source.reply_to = Some(ChatReplyDto {
            sender_id: MY_ID.into(),
            attachment_count: Some(2),
            ..Default::default()
        });
        source.attachments = Some(vec![image()]);
        let message = to_chat_message(&source, FRIEND_ID, false);
        assert_eq!(message.attachments, Some(vec![image_model()]));
        assert_eq!(
            message.reply_to,
            Some(ChatMessageReply {
                seq: 8,
                quoted: Some(QuotedMessage {
                    from_me: true,
                    attachment_count: 2,
                    ..Default::default()
                })
            })
        );
        assert_eq!(stored(10).attachments, None);

        let mut target = stored(11);
        target.attachments = Some(vec![image_model(), image_model()]);
        assert_eq!(
            create_reply(&target)
                .unwrap()
                .quoted
                .unwrap()
                .attachment_count,
            2
        );
    }

    #[test]
    fn restores_held_messages() {
        let message = to_pending_chat_message(&ChatPendingMessageDto {
            client_nonce: "nonce-held".into(),
            status: ChatPendingMessageStatus::Blocked,
            body: "look".into(),
            reply_to_seq: Some(4),
            created_at: CREATED_AT.into(),
            attachments: vec![image()],
        });
        assert_eq!(
            message,
            ChatMessage {
                id: "nonce-held".into(),
                client_nonce: "nonce-held".into(),
                from_me: true,
                text: "look".into(),
                created_at: CREATED_AT.into(),
                status: ChatMessageStatus::Blocked,
                reply_to: Some(ChatMessageReply {
                    seq: 4,
                    quoted: None
                }),
                attachments: Some(vec![image_model()]),
                from_history: true,
                ..Default::default()
            }
        );
    }

    #[test]
    fn local_images() {
        let message = create_pending_message(
            "",
            "nonce-new",
            Some(CREATED_AT.into()),
            None,
            vec![local_image()],
        );
        assert_eq!(message.status, ChatMessageStatus::Pending);
        assert_eq!(message.upload_progress, Some(0.0));
        assert_eq!(message.attachments, Some(vec![local_image()]));

        let mut messages = vec![create_pending_message(
            "",
            "nonce-9",
            Some(CREATED_AT.into()),
            None,
            vec![local_image()],
        )];
        let mut delivered = dto(9, MY_ID);
        delivered.body.clear();
        delivered.client_nonce = "nonce-9".into();
        delivered.attachments = Some(vec![image()]);
        merge_chat_messages(
            &mut messages,
            vec![to_chat_message(&delivered, FRIEND_ID, false)],
        );
        assert_eq!(messages[0].status, ChatMessageStatus::Sent);
        let mut kept = image_model();
        kept.local_url = Some("blob:1".into());
        assert_eq!(messages[0].attachments, Some(vec![kept]));
    }

    #[test]
    fn attachment_ids_and_progress() {
        let mut messages = vec![create_pending_message(
            "",
            "nonce-9",
            Some(CREATED_AT.into()),
            None,
            vec![local_image()],
        )];
        set_message_attachment_ids(&mut messages, "nonce-9", &["server-1".into()]);
        let attachment = &messages[0].attachments.as_ref().unwrap()[0];
        assert_eq!(attachment.id, "server-1");
        assert_eq!(attachment.local_url.as_deref(), Some("blob:1"));

        let mut messages = vec![pending("hi", "nonce-x"), stored(1)];
        set_message_upload_progress(&mut messages, "nonce-x", 0.5);
        assert_eq!(messages[0].upload_progress, Some(0.5));
        assert_eq!(messages[1].upload_progress, None);
    }

    #[test]
    fn settles_sending_messages() {
        let mut sending = pending("", "nonce-a");
        sending.upload_progress = Some(1.0);
        let mut blocked = sending.clone();
        blocked.client_nonce = "nonce-b".into();
        blocked.status = ChatMessageStatus::Blocked;
        let mut messages = vec![sending, blocked];
        settle_sending_message(&mut messages, "nonce-a", ChatMessageStatus::Checking);
        settle_sending_message(&mut messages, "nonce-b", ChatMessageStatus::Checking);
        assert_eq!(messages[0].status, ChatMessageStatus::Checking);
        assert_eq!(messages[0].upload_progress, None);
        assert_eq!(messages[1].status, ChatMessageStatus::Blocked);
    }

    #[test]
    fn removes_only_unsent_copies() {
        let mut messages = vec![pending("hi", "nonce-x")];
        set_message_status(&mut messages, "nonce-x", ChatMessageStatus::Failed);
        messages.push(stored(1));
        remove_unsent_message(&mut messages, "nonce-x");
        assert_eq!(messages, vec![stored(1)]);
        let mut only_stored = vec![stored(1)];
        assert!(!remove_unsent_message(&mut only_stored, "nonce-1"));
    }

    #[test]
    fn hides_image_urls_but_keeps_sizes() {
        let mut message = stored(9);
        let mut attachment = image_model();
        attachment.local_url = Some("blob:1".into());
        message.attachments = Some(vec![attachment]);
        let mut messages = vec![message];
        set_message_visibility(&mut messages, 9, None);
        assert!(messages[0].is_hidden);
        let mut expected = image_model();
        expected.url = None;
        assert_eq!(messages[0].attachments, Some(vec![expected]));
    }

    fn held(nonce: &str, status: ChatPendingMessageStatus) -> ChatMessage {
        to_pending_chat_message(&ChatPendingMessageDto {
            client_nonce: nonce.into(),
            status,
            created_at: CREATED_AT.into(),
            attachments: vec![image()],
            ..Default::default()
        })
    }

    #[test]
    fn merge_pending_adds_unknown_held_messages() {
        let mut messages = vec![stored(1)];
        merge_pending_messages(
            &mut messages,
            vec![held("nonce-h", ChatPendingMessageStatus::Checking)],
        );
        let nonces: Vec<_> = messages.iter().map(|m| m.client_nonce.as_str()).collect();
        assert_eq!(nonces, vec!["nonce-1", "nonce-h"]);
    }

    #[test]
    fn merge_pending_applies_the_servers_status() {
        let mut messages = vec![pending("", "nonce-h")];
        set_message_status(&mut messages, "nonce-h", ChatMessageStatus::Checking);
        merge_pending_messages(
            &mut messages,
            vec![held("nonce-h", ChatPendingMessageStatus::Blocked)],
        );
        assert_eq!(messages[0].status, ChatMessageStatus::Blocked);
    }

    #[test]
    fn merge_pending_leaves_in_flight_messages() {
        let mut messages = vec![pending("", "nonce-h")];
        merge_pending_messages(
            &mut messages,
            vec![held("nonce-h", ChatPendingMessageStatus::Blocked)],
        );
        assert_eq!(messages[0].status, ChatMessageStatus::Pending);
    }

    #[test]
    fn merge_pending_never_brings_back_delivered_messages() {
        let mut delivered = stored_from(5, MY_ID);
        delivered.client_nonce = "nonce-h".into();
        delivered.id = "nonce-h".into();
        let mut messages = vec![delivered.clone()];
        merge_pending_messages(
            &mut messages,
            vec![held("nonce-h", ChatPendingMessageStatus::Checking)],
        );
        assert_eq!(messages, vec![delivered]);
    }
}
