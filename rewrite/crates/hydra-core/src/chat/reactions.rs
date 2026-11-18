//! chat-reactions.ts: one reaction per side, merged from optimistic picks,
//! realtime events and server responses.

use super::time::{compare, is_after, parse_ms};
use super::types::{ChatMessage, ChatReaction};

/// ChatReactionUpdate: a change for one side; `emoji: None` removes it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChatReactionUpdate {
    pub from_me: bool,
    pub emoji: Option<String>,
    pub updated_at: String,
    pub is_pending: bool,
}

/// ChatReactionPill: one pill under a message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatReactionPill {
    pub emoji: String,
    pub from_me: bool,
    pub from_friend: bool,
    pub is_pending: bool,
}

fn sort_by_updated_at(reactions: &mut [ChatReaction]) {
    reactions.sort_by(|a, b| compare(&a.updated_at, &b.updated_at));
}

/// A removal that keeps the time of the side's last known change.
fn to_removal(reaction: &ChatReaction) -> ChatReaction {
    ChatReaction {
        emoji: None,
        from_me: reaction.from_me,
        updated_at: reaction.updated_at.clone(),
        is_pending: false,
    }
}

/// applyReaction: a change older than the side's current one is dropped,
/// unless either is an optimistic, unsaved reaction. Removals stay in the
/// list so an older change can't bring a removed reaction back.
pub fn apply_reaction(reactions: &[ChatReaction], update: ChatReactionUpdate) -> Vec<ChatReaction> {
    let current = reactions.iter().find(|r| r.from_me == update.from_me);
    if let Some(current) = current
        && !current.is_pending
        && !update.is_pending
        && matches!(
            (parse_ms(&update.updated_at), parse_ms(&current.updated_at)),
            (Some(update), Some(current)) if update < current
        )
    {
        return reactions.to_vec();
    }

    let mut next: Vec<ChatReaction> = reactions
        .iter()
        .filter(|r| r.from_me != update.from_me)
        .cloned()
        .collect();
    next.push(ChatReaction {
        emoji: update.emoji,
        from_me: update.from_me,
        updated_at: update.updated_at,
        is_pending: update.is_pending,
    });
    next
}

fn merge_side(
    current: Option<&ChatReaction>,
    saved: Option<&ChatReaction>,
    keep_missing: bool,
) -> Option<ChatReaction> {
    if let Some(current) = current
        && current.is_pending
    {
        return Some(current.clone());
    }
    let Some(saved) = saved else {
        return match current {
            Some(current) if !keep_missing => Some(to_removal(current)),
            other => other.cloned(),
        };
    };
    match current {
        Some(current) if is_after(&current.updated_at, &saved.updated_at) => Some(current.clone()),
        _ => Some(saved.clone()),
    }
}

/// mergeReactions: each side keeps whichever change is newer; a side the
/// response leaves out has no reaction. With `settle_mine`, the response is
/// the result of the user's latest change: their side is taken as is, and a
/// friend's reaction it leaves out is kept.
pub fn merge_reactions(
    known: &[ChatReaction],
    stored: &[ChatReaction],
    settle_mine: bool,
) -> Vec<ChatReaction> {
    let side_of = |reactions: &[ChatReaction], from_me: bool| {
        reactions.iter().find(|r| r.from_me == from_me).cloned()
    };

    let current = side_of(known, true);
    let saved = side_of(stored, true);
    let mine = if settle_mine {
        saved.or_else(|| current.as_ref().map(to_removal))
    } else {
        merge_side(current.as_ref(), saved.as_ref(), false)
    };
    let friend = merge_side(
        side_of(known, false).as_ref(),
        side_of(stored, false).as_ref(),
        settle_mine,
    );

    let mut merged: Vec<ChatReaction> = [mine, friend].into_iter().flatten().collect();
    sort_by_updated_at(&mut merged);
    merged
}

/// updateMessageReactions, in place. Returns whether a message matched.
pub fn update_message_reactions(
    messages: &mut [ChatMessage],
    seq: i64,
    mut update: impl FnMut(&[ChatReaction]) -> Vec<ChatReaction>,
) -> bool {
    let mut changed = false;
    for message in messages.iter_mut().filter(|m| m.seq == Some(seq)) {
        let reactions = update(message.reactions.as_deref().unwrap_or_default());
        message.reactions = Some(reactions);
        changed = true;
    }
    changed
}

/// toReactionPills: the same emoji from both sides share one pill, in the
/// order first used.
pub fn to_reaction_pills(reactions: &[ChatReaction]) -> Vec<ChatReactionPill> {
    let mut pills: Vec<ChatReactionPill> = Vec::new();
    for reaction in reactions {
        let Some(emoji) = &reaction.emoji else {
            continue;
        };
        if let Some(pill) = pills.iter_mut().find(|pill| &pill.emoji == emoji) {
            pill.from_me |= reaction.from_me;
            pill.from_friend |= !reaction.from_me;
            pill.is_pending |= reaction.is_pending;
        } else {
            pills.push(ChatReactionPill {
                emoji: emoji.clone(),
                from_me: reaction.from_me,
                from_friend: !reaction.from_me,
                is_pending: reaction.is_pending,
            });
        }
    }
    pills
}

/// getMyReaction
pub fn get_my_reaction(message: &ChatMessage) -> Option<&str> {
    message
        .reactions
        .as_ref()?
        .iter()
        .find(|r| r.from_me)?
        .emoji
        .as_deref()
}

/// use-chat.ts `byUpdatedAt`, for restoring the saved side after a failure.
pub fn sort_reactions(reactions: &mut [ChatReaction]) {
    sort_by_updated_at(reactions);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::types::ChatMessageStatus;

    const EARLIER: &str = "2026-10-09T12:00:00.000Z";
    const LATER: &str = "2026-10-09T12:05:00.000Z";
    const LATEST: &str = "2026-10-09T12:10:00.000Z";

    fn reaction(emoji: Option<&str>, from_me: bool, at: &str) -> ChatReaction {
        ChatReaction {
            emoji: emoji.map(str::to_string),
            from_me,
            updated_at: at.into(),
            is_pending: false,
        }
    }
    fn mine(emoji: &str, at: &str) -> ChatReaction {
        reaction(Some(emoji), true, at)
    }
    fn theirs(emoji: &str, at: &str) -> ChatReaction {
        reaction(Some(emoji), false, at)
    }
    fn pending(mut r: ChatReaction) -> ChatReaction {
        r.is_pending = true;
        r
    }
    fn update(from_me: bool, emoji: Option<&str>, at: &str) -> ChatReactionUpdate {
        ChatReactionUpdate {
            from_me,
            emoji: emoji.map(str::to_string),
            updated_at: at.into(),
            is_pending: false,
        }
    }
    fn message(seq: i64, reactions: Option<Vec<ChatReaction>>) -> ChatMessage {
        ChatMessage {
            id: format!("nonce-{seq}"),
            client_nonce: format!("nonce-{seq}"),
            seq: Some(seq),
            text: "hello".into(),
            created_at: EARLIER.into(),
            status: ChatMessageStatus::Sent,
            reactions,
            ..Default::default()
        }
    }

    #[test]
    fn apply_adds_after_the_other_side() {
        assert_eq!(
            apply_reaction(&[theirs("😂", EARLIER)], update(true, Some("🔥"), LATER)),
            vec![theirs("😂", EARLIER), mine("🔥", LATER)]
        );
    }

    #[test]
    fn apply_replaces_the_sides_earlier_reaction() {
        assert_eq!(
            apply_reaction(
                &[mine("👍", EARLIER), theirs("😂", EARLIER)],
                update(true, Some("🔥"), LATER)
            ),
            vec![theirs("😂", EARLIER), mine("🔥", LATER)]
        );
    }

    #[test]
    fn apply_records_removals() {
        assert_eq!(
            apply_reaction(
                &[mine("👍", EARLIER), theirs("😂", EARLIER)],
                update(false, None, LATER)
            ),
            vec![mine("👍", EARLIER), reaction(None, false, LATER)]
        );
    }

    #[test]
    fn apply_drops_older_changes() {
        let removed = vec![reaction(None, false, LATER)];
        assert_eq!(
            apply_reaction(&removed, update(false, Some("😂"), EARLIER)),
            removed
        );
        let current = vec![theirs("😂", LATER)];
        assert_eq!(
            apply_reaction(&current, update(false, None, EARLIER)),
            current
        );
    }

    #[test]
    fn apply_lets_a_server_change_replace_an_unsaved_reaction() {
        assert_eq!(
            apply_reaction(
                &[pending(mine("🔥", LATER))],
                update(true, Some("🔥"), EARLIER)
            ),
            vec![mine("🔥", EARLIER)]
        );
    }

    #[test]
    fn apply_marks_optimistic_reactions() {
        let mut optimistic = update(true, Some("🔥"), LATER);
        optimistic.is_pending = true;
        assert_eq!(
            apply_reaction(&[], optimistic),
            vec![pending(mine("🔥", LATER))]
        );
    }

    #[test]
    fn merge_keeps_the_newer_change_per_side() {
        assert_eq!(
            merge_reactions(
                &[theirs("🔥", LATER), mine("👍", EARLIER)],
                &[theirs("😂", EARLIER), mine("💀", LATEST)],
                false
            ),
            vec![theirs("🔥", LATER), mine("💀", LATEST)]
        );
    }

    #[test]
    fn merge_records_a_removal_for_a_missing_side() {
        assert_eq!(
            merge_reactions(&[theirs("😂", EARLIER)], &[], false),
            vec![reaction(None, false, EARLIER)]
        );
    }

    #[test]
    fn merge_keeps_an_unsaved_reaction() {
        let optimistic = pending(mine("🔥", LATER));
        assert_eq!(
            merge_reactions(
                std::slice::from_ref(&optimistic),
                &[mine("👍", EARLIER)],
                false
            ),
            vec![optimistic]
        );
    }

    #[test]
    fn merge_settles_mine() {
        let optimistic = pending(mine("🔥", LATER));
        assert_eq!(
            merge_reactions(
                &[optimistic.clone(), theirs("😂", LATER)],
                &[mine("👍", EARLIER)],
                true
            ),
            vec![mine("👍", EARLIER), theirs("😂", LATER)]
        );
        assert_eq!(
            merge_reactions(&[optimistic], &[], true),
            vec![reaction(None, true, LATER)]
        );
    }

    #[test]
    fn update_changes_only_the_seq() {
        let mut messages = vec![
            message(1, None),
            message(2, Some(vec![theirs("😂", EARLIER)])),
        ];
        let untouched = messages[1].clone();
        assert!(update_message_reactions(&mut messages, 1, |r| {
            let mut next = r.to_vec();
            next.push(mine("🔥", EARLIER));
            next
        }));
        assert_eq!(messages[0].reactions, Some(vec![mine("🔥", EARLIER)]));
        assert_eq!(messages[1], untouched);
    }

    #[test]
    fn pills() {
        assert!(to_reaction_pills(&[reaction(None, false, EARLIER)]).is_empty());
        assert_eq!(
            to_reaction_pills(&[theirs("😂", EARLIER), mine("😂", LATER)]),
            vec![ChatReactionPill {
                emoji: "😂".into(),
                from_me: true,
                from_friend: true,
                is_pending: false
            }]
        );
        assert_eq!(
            to_reaction_pills(&[theirs("😂", EARLIER), pending(mine("💀", LATER))]),
            vec![
                ChatReactionPill {
                    emoji: "😂".into(),
                    from_me: false,
                    from_friend: true,
                    is_pending: false
                },
                ChatReactionPill {
                    emoji: "💀".into(),
                    from_me: true,
                    from_friend: false,
                    is_pending: true
                },
            ]
        );
    }

    #[test]
    fn my_reaction() {
        assert_eq!(
            get_my_reaction(&message(
                1,
                Some(vec![theirs("😂", EARLIER), mine("🔥", EARLIER)])
            )),
            Some("🔥")
        );
        assert_eq!(
            get_my_reaction(&message(1, Some(vec![theirs("😂", EARLIER)]))),
            None
        );
        assert_eq!(get_my_reaction(&message(1, None)), None);
    }
}
