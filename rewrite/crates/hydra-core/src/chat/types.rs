//! chat-message-groups.ts and chat-types.ts: the chat window's model.
//!
//! TS optional fields map to `Option` where "unset" and "empty" differ
//! (`reactions`, `attachments`), and to `false`/`0` where they don't
//! (`isHidden`, `fromHistory`, `attachmentCount`).

use std::sync::Arc;

use super::dto::UserFriend;

/// ChatMessageStatus: `pending` is on its way (images uploading), `checking`
/// held by the server until its images pass moderation, `blocked` turned away.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum ChatMessageStatus {
    #[default]
    Sent,
    Pending,
    Checking,
    Blocked,
    Failed,
}

impl ChatMessageStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ChatMessageStatus::Sent => "sent",
            ChatMessageStatus::Pending => "pending",
            ChatMessageStatus::Checking => "checking",
            ChatMessageStatus::Blocked => "blocked",
            ChatMessageStatus::Failed => "failed",
        }
    }
}

/// ChatMessageReply.quoted
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct QuotedMessage {
    pub from_me: bool,
    /// Empty while the replied-to message is removed, or images only.
    pub text: String,
    /// Removed by moderation.
    pub is_hidden: bool,
    /// Images on the replied-to message; 0 for none.
    pub attachment_count: u32,
}

/// ChatMessageReply
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChatMessageReply {
    pub seq: i64,
    /// None once the replied-to message is past chat retention.
    pub quoted: Option<QuotedMessage>,
}

/// ChatAttachment
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChatAttachment {
    /// The server's id; a local one until its upload is reserved.
    pub id: String,
    pub content_type: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub spoiler: bool,
    /// None while removed by moderation, or before the upload.
    pub url: Option<String>,
    /// The sender's own copy (a local file path or image cache key), kept past
    /// delivery so the image doesn't reload.
    pub local_url: Option<String>,
}

/// ChatReaction
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChatReaction {
    /// None once the side removed its reaction, kept for the time of the change.
    pub emoji: Option<String>,
    pub from_me: bool,
    pub updated_at: String,
    /// Set on the user's own reaction while it is being saved.
    pub is_pending: bool,
}

/// ChatMessage.failure: why a `failed` message failed, when the user can act.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatFailure {
    DailyLimit,
}

/// ChatMessage
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ChatMessage {
    /// The client nonce, so the row survives the pending → sent swap.
    pub id: String,
    pub client_nonce: String,
    /// Position in the conversation; None until the server stores it.
    pub seq: Option<i64>,
    pub from_me: bool,
    /// Empty while the message is removed.
    pub text: String,
    pub created_at: String,
    pub status: ChatMessageStatus,
    /// Removed by moderation: a placeholder, with no actions.
    pub is_hidden: bool,
    pub reply_to: Option<ChatMessageReply>,
    /// Oldest first, at most one from each side, removals included. None when
    /// the source didn't report them (realtime messages).
    pub reactions: Option<Vec<ChatReaction>>,
    /// Loaded from history rather than sent or received live: no entrance animation.
    pub from_history: bool,
    /// Images, in the order they were sent.
    pub attachments: Option<Vec<ChatAttachment>>,
    /// Share of the images uploaded, 0 to 1, while the status is `pending`.
    pub upload_progress: Option<f64>,
    pub failure: Option<ChatFailure>,
}

impl ChatMessage {
    /// `message.attachments?.length ?? 0`
    pub fn attachment_count(&self) -> usize {
        self.attachments.as_ref().map_or(0, Vec::len)
    }
}

/// ChatMessageGroup: consecutive messages from one sender. `messages` holds
/// indexes into the slice given to `group_chat_messages`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatMessageGroup {
    /// The first message's id.
    pub key: String,
    pub from_me: bool,
    pub messages: Vec<usize>,
}

/// ChatMessageDay
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatMessageDay {
    /// The local calendar date as `YYYY-MM-DD` (JS used `toDateString()`),
    /// or "Invalid Date".
    pub key: String,
    /// None for an unreadable `createdAt`.
    pub date: Option<chrono::NaiveDate>,
    pub groups: Vec<ChatMessageGroup>,
}

/// ChatLoadState
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ChatLoadState {
    #[default]
    Idle,
    Loading,
    Loaded,
    Error,
}

/// ChatConversationLastMessage: the latest message as the list reported it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChatConversationLastMessage {
    pub seq: i64,
    pub from_me: bool,
    /// Empty when hidden, or images only.
    pub text: String,
    pub created_at: String,
    pub is_hidden: bool,
    pub attachment_count: u32,
}

/// ChatDraftImage: an image in the composer, ready to send. The Blob is the
/// prepared bytes; `url` is whatever the UI shows the preview from (a local
/// file path or an image cache key).
#[derive(Clone, Debug, PartialEq)]
pub struct ChatDraftImage {
    pub id: String,
    pub name: String,
    pub bytes: Arc<[u8]>,
    /// "image/jpeg" | "image/png" | "image/gif"
    pub content_type: String,
    pub width: u32,
    pub height: u32,
    pub url: String,
    pub spoiler: bool,
}

impl ChatDraftImage {
    /// `blob.size`
    pub fn size(&self) -> usize {
        self.bytes.len()
    }
}

/// ChatConversation
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ChatConversation {
    pub friend: UserFriend,
    pub messages: Vec<ChatMessage>,
    /// Stands in for `messages` in the sidebar until history loads.
    pub last_message: Option<ChatConversationLastMessage>,
    pub is_typing: bool,
    pub unread_count: i64,
    pub draft: String,
    /// Images in the composer, sent with the draft.
    pub draft_images: Vec<ChatDraftImage>,
    /// Seq of the message the next send replies to.
    pub reply_to_seq: Option<i64>,
    /// False after an unfriend or block: history stays readable, sending stops.
    pub can_send: bool,
    pub load_state: ChatLoadState,
    pub has_more_before: bool,
    pub is_loading_older: bool,
    /// Seq of the last message before ones that were missed, until they load.
    pub gap_after_seq: Option<i64>,
}

impl ChatConversation {
    /// chat-window.tsx `createConversation`
    pub fn new(friend: UserFriend) -> Self {
        ChatConversation {
            friend,
            can_send: true,
            ..Default::default()
        }
    }
}
