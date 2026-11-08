//! The chat window (pages/chat-window). Placeholder API while the window is
//! being ported.

use hydra_core::chat::{ChatMessageDto, UserFriend};
use hydra_core::chat_unread::ChatUnreadState;
use hydra_core::social::ChatWindowState;

use crate::ChatWindow;

pub fn window() -> Option<ChatWindow> {
    None
}

pub fn window_state() -> ChatWindowState {
    ChatWindowState::default()
}

pub fn open(friend: UserFriend) {
    eprintln!("TODO(chat): open {}", friend.id);
}

pub fn restore(_friends: Vec<UserFriend>, _active: Option<String>) {}

pub fn open_by_id(_id: &str) {}

pub fn close() {}

pub fn on_language_changed() {}

pub fn on_friends_updated() {}

pub fn on_presence(_friend_id: &str, _online: bool) {}

pub fn on_unread_changed(_state: &ChatUnreadState) {}

pub fn is_focused() -> bool {
    false
}

pub fn is_conversation_visible(_friend_id: &str) -> bool {
    false
}

pub fn is_conversation_open_in_focused_window(_friend_id: &str) -> bool {
    false
}

pub fn show_incoming_message(_sender: UserFriend) {}

pub fn on_message(_friend_id: &str, _message: ChatMessageDto) {}

pub fn on_typing(_friend_id: &str) {}

pub fn on_reaction(
    _friend_id: &str,
    _seq: i64,
    _from_me: bool,
    _emoji: Option<String>,
    _updated_at: &str,
) {
}

pub fn on_visibility(_friend_id: &str, _seq: i64, _hidden: bool) {}

pub fn on_rejected(_friend_id: &str, _client_nonce: &str, _blocked: bool) {}

pub fn on_resync() {}
