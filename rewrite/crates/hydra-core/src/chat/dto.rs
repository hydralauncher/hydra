//! The API's chat and friends shapes (src/types/index.ts) and the realtime
//! payloads (src/main/services/sse/types.ts), parsed leniently: missing or
//! null fields take their default instead of failing the whole value.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

/// Parses any of the types below from a JSON value; None when it doesn't fit.
pub fn parse<T: DeserializeOwned>(value: &Value) -> Option<T> {
    serde_json::from_value(value.clone()).ok()
}

/// A null field reads as its default.
pub(crate) fn lenient<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

/// `Array.isArray(value) ? value : []`, keeping the items that parse.
pub(crate) fn lenient_list<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    Ok(match Value::deserialize(deserializer)? {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|item| serde_json::from_value(item).ok())
            .collect(),
        _ => Vec::new(),
    })
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// UserFriend.currentGame: the game a friend is playing (ShopAssets plus the
/// session length). Fields this port doesn't read are kept in `extra`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FriendGame {
    #[serde(deserialize_with = "lenient")]
    pub object_id: String,
    #[serde(deserialize_with = "lenient")]
    pub shop: String,
    #[serde(deserialize_with = "lenient")]
    pub title: String,
    pub icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_duration_in_seconds: Option<f64>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// UserFriend
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UserFriend {
    #[serde(deserialize_with = "lenient")]
    pub id: String,
    #[serde(deserialize_with = "lenient")]
    pub display_name: String,
    pub profile_image_url: Option<String>,
    pub background_image_url: Option<String>,
    pub current_game: Option<FriendGame>,
    /// Unset when the source doesn't report presence (friend search).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_online: Option<bool>,
    /// The Hydra team's account: it messages users, nobody messages it.
    #[serde(deserialize_with = "lenient", skip_serializing_if = "is_false")]
    pub is_official: bool,
}

impl UserFriend {
    /// `Boolean(friend.isOnline)`
    pub fn online(&self) -> bool {
        self.is_online == Some(true)
    }
}

/// ProfileFriends (GET /profile/friends)
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfileFriends {
    #[serde(deserialize_with = "lenient")]
    pub total_friends: i64,
    #[serde(deserialize_with = "lenient")]
    pub online_friends: i64,
    #[serde(deserialize_with = "lenient_list")]
    pub friends: Vec<UserFriend>,
}

/// FriendRequest.type
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum FriendRequestType {
    Sent,
    Received,
    #[default]
    #[serde(other)]
    Unknown,
}

/// FriendRequest (GET /profile/friend-requests)
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FriendRequest {
    #[serde(deserialize_with = "lenient")]
    pub id: String,
    #[serde(deserialize_with = "lenient")]
    pub display_name: String,
    pub profile_image_url: Option<String>,
    #[serde(rename = "type", deserialize_with = "lenient")]
    pub kind: FriendRequestType,
}

/// ChatReplyDto
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatReplyDto {
    #[serde(deserialize_with = "lenient")]
    pub sender_id: String,
    #[serde(deserialize_with = "lenient")]
    pub body: String,
    #[serde(deserialize_with = "lenient")]
    pub hidden: bool,
    pub attachment_count: Option<u32>,
}

/// ChatAttachmentDto. `content_type`: "image/jpeg" | "image/png" | "image/gif".
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatAttachmentDto {
    #[serde(deserialize_with = "lenient")]
    pub id: String,
    #[serde(deserialize_with = "lenient")]
    pub content_type: String,
    /// Null while the image is still being checked.
    pub width: Option<u32>,
    pub height: Option<u32>,
    #[serde(deserialize_with = "lenient")]
    pub spoiler: bool,
    /// Signed for at least a day; null when moderation removed the message.
    pub url: Option<String>,
}

/// ChatReactionDto
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatReactionDto {
    #[serde(deserialize_with = "lenient")]
    pub user_id: String,
    #[serde(deserialize_with = "lenient")]
    pub emoji: String,
    #[serde(deserialize_with = "lenient")]
    pub updated_at: String,
}

/// ChatMessageDto
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatMessageDto {
    #[serde(deserialize_with = "lenient")]
    pub seq: i64,
    #[serde(deserialize_with = "lenient")]
    pub sender_id: String,
    /// Empty when `hidden`, or when the message is images only.
    #[serde(deserialize_with = "lenient")]
    pub body: String,
    #[serde(deserialize_with = "lenient")]
    pub hidden: bool,
    #[serde(deserialize_with = "lenient")]
    pub client_nonce: String,
    #[serde(deserialize_with = "lenient")]
    pub created_at: String,
    pub reply_to_seq: Option<i64>,
    /// The replied-to message; null once it is past chat retention.
    pub reply_to: Option<ChatReplyDto>,
    /// Realtime messages leave it out (None), history sends a list.
    pub reactions: Option<Vec<ChatReactionDto>>,
    pub attachments: Option<Vec<ChatAttachmentDto>>,
}

/// ChatPendingMessageStatus
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatPendingMessageStatus {
    #[default]
    Checking,
    Blocked,
    Failed,
}

/// ChatPendingMessageDto: the user's own message with images, held.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatPendingMessageDto {
    #[serde(deserialize_with = "lenient")]
    pub client_nonce: String,
    #[serde(deserialize_with = "lenient")]
    pub status: ChatPendingMessageStatus,
    #[serde(deserialize_with = "lenient")]
    pub body: String,
    pub reply_to_seq: Option<i64>,
    #[serde(deserialize_with = "lenient")]
    pub created_at: String,
    #[serde(deserialize_with = "lenient_list")]
    pub attachments: Vec<ChatAttachmentDto>,
}

/// ChatMessagesPage (GET /profile/chats/{id}/messages)
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatMessagesPage {
    #[serde(deserialize_with = "lenient_list")]
    pub messages: Vec<ChatMessageDto>,
    #[serde(deserialize_with = "lenient")]
    pub has_more: bool,
    #[serde(deserialize_with = "lenient")]
    pub can_send: bool,
    #[serde(deserialize_with = "lenient")]
    pub last_read_seq: i64,
    #[serde(deserialize_with = "lenient")]
    pub unread_count: i64,
    /// Empty for paged requests.
    #[serde(deserialize_with = "lenient_list")]
    pub pending_messages: Vec<ChatPendingMessageDto>,
}

/// ChatConversationDto.friend
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatConversationFriend {
    #[serde(deserialize_with = "lenient")]
    pub id: String,
    #[serde(deserialize_with = "lenient")]
    pub display_name: String,
    pub profile_image_url: Option<String>,
    #[serde(deserialize_with = "lenient")]
    pub is_official: bool,
}

impl ChatConversationFriend {
    /// `{ ...dto.friend, currentGame: null, backgroundImageUrl: null, isOnline: false }`
    pub fn to_user_friend(&self) -> UserFriend {
        UserFriend {
            id: self.id.clone(),
            display_name: self.display_name.clone(),
            profile_image_url: self.profile_image_url.clone(),
            background_image_url: None,
            current_game: None,
            is_online: Some(false),
            is_official: self.is_official,
        }
    }
}

/// ChatConversationDto.lastMessage: ChatReplyDto plus seq and createdAt.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatConversationLastMessageDto {
    #[serde(deserialize_with = "lenient")]
    pub sender_id: String,
    #[serde(deserialize_with = "lenient")]
    pub body: String,
    #[serde(deserialize_with = "lenient")]
    pub hidden: bool,
    pub attachment_count: Option<u32>,
    #[serde(deserialize_with = "lenient")]
    pub seq: i64,
    #[serde(deserialize_with = "lenient")]
    pub created_at: String,
}

/// ChatConversationDto: one row of GET /profile/chats.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatConversationDto {
    #[serde(deserialize_with = "lenient")]
    pub friend_id: String,
    #[serde(deserialize_with = "lenient")]
    pub friend: ChatConversationFriend,
    #[serde(deserialize_with = "lenient")]
    pub last_message: ChatConversationLastMessageDto,
    #[serde(deserialize_with = "lenient")]
    pub last_message_at: String,
    #[serde(deserialize_with = "lenient")]
    pub last_read_seq: i64,
    #[serde(deserialize_with = "lenient")]
    pub unread_count: i64,
    #[serde(deserialize_with = "lenient")]
    pub can_send: bool,
}

/// ChatConversationsPage
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatConversationsPage {
    #[serde(deserialize_with = "lenient_list")]
    pub conversations: Vec<ChatConversationDto>,
    /// Null on the last page.
    pub next_cursor: Option<String>,
}

/// ChatUnreadSummary.conversations[number]
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UnreadChatConversation {
    #[serde(deserialize_with = "lenient")]
    pub friend_id: String,
    #[serde(deserialize_with = "lenient")]
    pub unread_count: i64,
    #[serde(deserialize_with = "lenient")]
    pub last_message_at: String,
}

/// ChatUnreadSummary (GET /profile/chats/unread)
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatUnreadSummary {
    #[serde(deserialize_with = "lenient")]
    pub total_unread: i64,
    #[serde(deserialize_with = "lenient_list")]
    pub conversations: Vec<UnreadChatConversation>,
}

/// ChatMessageReactionsDto (PUT/DELETE …/messages/{seq}/reaction)
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatMessageReactionsDto {
    #[serde(deserialize_with = "lenient")]
    pub seq: i64,
    #[serde(deserialize_with = "lenient_list")]
    pub reactions: Vec<ChatReactionDto>,
}

/// ChatAttachmentReservation (POST /profile/chats/{id}/attachments)
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatAttachmentReservation {
    #[serde(deserialize_with = "lenient")]
    pub id: String,
    #[serde(deserialize_with = "lenient")]
    pub upload_url: String,
    #[serde(deserialize_with = "lenient")]
    pub expires_at: String,
}

/// OfficialMessagesPage.sender
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OfficialSender {
    #[serde(deserialize_with = "lenient")]
    pub id: String,
    #[serde(deserialize_with = "lenient")]
    pub display_name: String,
    /// Null: the launcher shows its own logo.
    pub profile_image_url: Option<String>,
    #[serde(deserialize_with = "lenient")]
    pub is_official: bool,
}

/// OfficialMessageDto
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OfficialMessageDto {
    #[serde(deserialize_with = "lenient")]
    pub id: String,
    #[serde(deserialize_with = "lenient")]
    pub seq: i64,
    #[serde(deserialize_with = "lenient")]
    pub sender_id: String,
    #[serde(deserialize_with = "lenient")]
    pub body: String,
    #[serde(deserialize_with = "lenient")]
    pub locale: String,
    #[serde(deserialize_with = "lenient_list")]
    pub attachments: Vec<ChatAttachmentDto>,
    #[serde(deserialize_with = "lenient")]
    pub created_at: String,
    #[serde(deserialize_with = "lenient")]
    pub is_unread: bool,
}

/// OfficialMessagesPage (GET /profile/official-messages). Parse it with
/// `chat::parse_official_messages_page`, which checks the shape first.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OfficialMessagesPage {
    #[serde(deserialize_with = "lenient")]
    pub sender: OfficialSender,
    #[serde(deserialize_with = "lenient_list")]
    pub messages: Vec<OfficialMessageDto>,
    #[serde(deserialize_with = "lenient")]
    pub unread_count: i64,
    #[serde(deserialize_with = "lenient")]
    pub has_more_before: bool,
    #[serde(deserialize_with = "lenient")]
    pub next_poll_seconds: f64,
}

// ---- realtime payloads (services/sse/types.ts) -------------------------

/// ChatMessage.replyTo
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RealtimeReplyTo {
    #[serde(deserialize_with = "lenient")]
    pub sender_id: String,
    #[serde(deserialize_with = "lenient")]
    pub body: String,
    pub attachment_count: Option<u32>,
}

/// The `chatMessage` event.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RealtimeChatMessage {
    #[serde(deserialize_with = "lenient")]
    pub sender_id: String,
    #[serde(deserialize_with = "lenient")]
    pub recipient_id: String,
    #[serde(deserialize_with = "lenient")]
    pub seq: i64,
    /// Empty when the message is images only.
    #[serde(deserialize_with = "lenient")]
    pub body: String,
    #[serde(deserialize_with = "lenient")]
    pub client_nonce: String,
    #[serde(deserialize_with = "lenient")]
    pub created_at: String,
    pub reply_to_seq: Option<i64>,
    pub reply_to: Option<RealtimeReplyTo>,
    pub attachments: Option<Vec<ChatAttachmentDto>>,
}

impl RealtimeChatMessage {
    /// The other side of the conversation (chat-message.ts `friendId`).
    pub fn friend_id(&self, my_id: &str) -> &str {
        if self.sender_id == my_id {
            &self.recipient_id
        } else {
            &self.sender_id
        }
    }

    /// The ChatMessageSync `message` chat-message.ts builds from the event.
    pub fn to_dto(&self) -> ChatMessageDto {
        ChatMessageDto {
            seq: self.seq,
            sender_id: self.sender_id.clone(),
            body: self.body.clone(),
            hidden: false,
            client_nonce: self.client_nonce.clone(),
            created_at: self.created_at.clone(),
            reply_to_seq: self.reply_to_seq,
            reply_to: self.reply_to.as_ref().map(|reply| ChatReplyDto {
                sender_id: reply.sender_id.clone(),
                body: reply.body.clone(),
                hidden: false,
                attachment_count: reply.attachment_count,
            }),
            reactions: None,
            attachments: self.attachments.clone(),
        }
    }
}

/// ChatMessageRejected.reason
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRejectReason {
    Blocked,
    #[default]
    #[serde(other)]
    Failed,
}

/// The `chatMessageRejected` event (only to the sender of a message with images).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RealtimeChatMessageRejected {
    #[serde(deserialize_with = "lenient")]
    pub sender_id: String,
    #[serde(deserialize_with = "lenient")]
    pub recipient_id: String,
    #[serde(deserialize_with = "lenient")]
    pub client_nonce: String,
    #[serde(deserialize_with = "lenient")]
    pub reason: ChatRejectReason,
}

/// The `chatTyping` event.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RealtimeChatTyping {
    #[serde(deserialize_with = "lenient")]
    pub sender_id: String,
}

/// The `chatReaction` event; a null emoji removes the reaction.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RealtimeChatReaction {
    #[serde(deserialize_with = "lenient")]
    pub sender_id: String,
    #[serde(deserialize_with = "lenient")]
    pub recipient_id: String,
    #[serde(deserialize_with = "lenient")]
    pub seq: i64,
    pub emoji: Option<String>,
    #[serde(deserialize_with = "lenient")]
    pub updated_at: String,
}

/// `chatMessageHidden` and `chatMessageRestored`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RealtimeChatMessageVisibility {
    #[serde(deserialize_with = "lenient")]
    pub sender_id: String,
    #[serde(deserialize_with = "lenient")]
    pub recipient_id: String,
    #[serde(deserialize_with = "lenient")]
    pub seq: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_friends_leniently() {
        let friends: ProfileFriends = parse(&json!({
            "totalFriends": 2,
            "onlineFriends": null,
            "friends": [
                {
                    "id": "abcd1234",
                    "displayName": "Ana",
                    "profileImageUrl": null,
                    "currentGame": {
                        "objectId": "1091500",
                        "shop": "steam",
                        "title": "Cyberpunk 2077",
                        "iconUrl": "https://x/icon.jpg",
                        "libraryHeroImageUrl": null,
                        "sessionDurationInSeconds": 30
                    },
                    "isOnline": true
                },
                { "id": "efgh5678", "displayName": "Bo" },
                "garbage"
            ]
        }))
        .unwrap();

        assert_eq!(friends.online_friends, 0);
        assert_eq!(friends.friends.len(), 2);
        let game = friends.friends[0].current_game.as_ref().unwrap();
        assert_eq!(game.title, "Cyberpunk 2077");
        assert!(game.extra.contains_key("libraryHeroImageUrl"));
        assert!(friends.friends[0].online());
        assert_eq!(friends.friends[1].is_online, None);
    }

    #[test]
    fn friend_requests_keep_their_type() {
        let request: FriendRequest = parse(&json!({
            "id": "abcd1234", "displayName": "Ana", "profileImageUrl": null, "type": "RECEIVED"
        }))
        .unwrap();
        assert_eq!(request.kind, FriendRequestType::Received);
        let odd: FriendRequest = parse(&json!({ "id": "x", "type": "OTHER" })).unwrap();
        assert_eq!(odd.kind, FriendRequestType::Unknown);
    }

    #[test]
    fn serializes_friends_in_electrons_shape() {
        let friend = UserFriend {
            id: "abcd1234".into(),
            display_name: "Ana".into(),
            ..Default::default()
        };
        assert_eq!(
            serde_json::to_value(&friend).unwrap(),
            json!({
                "id": "abcd1234",
                "displayName": "Ana",
                "profileImageUrl": null,
                "backgroundImageUrl": null,
                "currentGame": null
            })
        );
    }

    #[test]
    fn realtime_messages_become_dtos() {
        let event: RealtimeChatMessage = parse(&json!({
            "senderId": "me000001",
            "recipientId": "friend01",
            "seq": 4,
            "body": "",
            "clientNonce": "n",
            "createdAt": "2026-10-05T12:00:00.000Z",
            "replyTo": { "senderId": "friend01", "body": "hi" },
            "replyToSeq": 3,
            "attachments": [{ "id": "a", "contentType": "image/png", "width": 10, "height": 5, "spoiler": false, "url": "u" }]
        }))
        .unwrap();
        assert_eq!(event.friend_id("me000001"), "friend01");
        let dto = event.to_dto();
        assert_eq!(dto.reply_to_seq, Some(3));
        assert_eq!(dto.reply_to.unwrap().body, "hi");
        assert_eq!(dto.attachments.unwrap()[0].width, Some(10));
        assert!(dto.reactions.is_none());
    }

    #[test]
    fn messages_page_tolerates_missing_fields() {
        let page: ChatMessagesPage = parse(&json!({
            "messages": [{ "seq": 1, "senderId": "a", "body": "x", "clientNonce": "n", "createdAt": "t", "reactions": [] }],
            "hasMore": true
        }))
        .unwrap();
        assert!(page.has_more);
        assert!(!page.can_send);
        assert_eq!(page.messages[0].reactions, Some(vec![]));
        assert!(page.pending_messages.is_empty());
    }
}
