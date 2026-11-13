//! The chat window: pages/chat-window (chat-window.tsx, use-chat.ts and its
//! components) and window-manager.ts openChatWindow / restoreChatWindow /
//! showIncomingChatMessage.
//!
//! Every write (messages, reactions, typing, reports, attachments) goes
//! through `social::write`, so `HYDRA_SOCIAL_DRY_RUN=1` keeps them local.
//! `HYDRA_CHAT_MOCK=1` (dev only) fills the window with fake conversations
//! covering every message state, without the API.

use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::rc::Rc;
use std::time::Duration;

use hydra_core::api::{ApiError, Options};
use hydra_core::chat::{
    self, ChatAttachment, ChatConversation, ChatConversationPreview, ChatConversationsPage,
    ChatLoadState, ChatMessage, ChatMessageDto, ChatMessageReactionsDto, ChatMessageStatus,
    ChatMessagesPage, ChatReaction, ChatReactionUpdate, ChatSendCooldown, ChatTextPart,
    EmojiCategoryId, UserFriend, parse,
};
use hydra_core::chat_unread::ChatUnreadState;
use hydra_core::social::{ChatWindowState, PendingChatFriend};
use hydra_media::images::Op;
use serde_json::{Value, json};
use slint::{ComponentHandle, Image, Model, ModelRc, SharedString, VecModel};

use crate::social::{self, Kind};
use crate::{
    ChatConversationRow, ChatData, ChatDraftImage, ChatEmoji, ChatImageCell, ChatItem,
    ChatPickerRow, ChatReactionPill, ChatWindow, ContextMenu, MenuEntry, Popup, SmoothScroll,
    shell,
};

const DEFAULT_SIZE: (f32, f32) = (560.0, 560.0);
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

fn mock() -> bool {
    std::env::var_os("HYDRA_CHAT_MOCK").is_some()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn uuid() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    for i in 0..4 {
        let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
        hasher.write_i64(now_ms() + i);
        out.push_str(&format!("{:08x}", hasher.finish() as u32));
        if i < 3 {
            out.push('-');
        }
    }
    out
}

/// A message with images, from the composer until the server answers.
struct Outgoing {
    friend_id: String,
    text: String,
    reply_to_seq: Option<i64>,
    files: Vec<(Rc<[u8]>, String)>,
    spoilers: Vec<bool>,
    ids: Vec<Option<String>>,
}

#[derive(Default)]
struct ListView {
    /// While scrolled away: the newest message then (newer ones count as new).
    away_from: Option<String>,
    /// Where the "New messages" divider goes from.
    new_since: Option<String>,
    days_above: BTreeSet<String>,
    /// Messages already there when the conversation opened (no entrance).
    initial: HashSet<String>,
    flash: Option<String>,
    flash_timer: Option<slint::Timer>,
    from_top: f32,
}

struct State {
    window: ChatWindow,
    conversations: Vec<ChatConversation>,
    active: Option<String>,
    friends: Vec<UserFriend>,
    focused: bool,
    shown: bool,
    list_request: u64,
    friends_request: u64,
    official_request: u64,
    official_revision: Option<u64>,
    // use-chat.ts
    last_typing_ping: HashMap<String, i64>,
    typing_timers: HashMap<String, slint::Timer>,
    last_marked_seq: HashMap<String, i64>,
    newer_loads: HashSet<String>,
    cooldown: Option<ChatSendCooldown>,
    cooldown_timer: slint::Timer,
    cooldown_tick: slint::Timer,
    rejections: i32,
    rate_window: Option<i64>,
    reaction_error: Option<(String, bool)>,
    reaction_error_timer: slint::Timer,
    reaction_targets: HashMap<String, Option<String>>,
    outgoing: HashMap<String, Outgoing>,
    hidden_at: HashMap<String, i64>,
    pending_checks: HashMap<String, (slint::Timer, u32)>,
    mark_read_timer: slint::Timer,
    // the sidebar
    query: String,
    picker_open: bool,
    picker_query: String,
    picker_active: i32,
    picker_timer: slint::Timer,
    sidebar_width: f32,
    // the list
    view: ListView,
    revealed: HashSet<String>,
    reaction_bar: Option<(String, bool)>,
    reaction_picker: Option<i64>,
    menu_key: Option<String>,
    lightbox: Option<(String, String)>,
    report_seq: Option<i64>,
    report_timer: slint::Timer,
    report_sent_timer: slint::Timer,
    leaving_url: Option<String>,
    leaving_timer: slint::Timer,
    // the composer
    image_note: Option<chat::ChatDraftImageError>,
    image_note_timer: slint::Timer,
    preparing: HashMap<String, usize>,
    emoji_tab: EmojiCategoryId,
    emoji_query: String,
    selection: Option<usize>,
    // pictures by "<kind>:<url>"
    images: HashMap<String, Image>,
    pending_images: HashSet<String>,
    rows: Rc<VecModel<ChatConversationRow>>,
    items: Rc<VecModel<ChatItem>>,
    pickers: Rc<VecModel<ChatPickerRow>>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    /// Conversations asked for before the window drained them.
    static PENDING: RefCell<Vec<PendingChatFriend>> = const { RefCell::new(Vec::new()) };
}

fn with_state<R>(f: impl FnOnce(&mut State) -> R) -> Option<R> {
    STATE.with(|s| s.borrow_mut().as_mut().map(f))
}

/// The open window, if any.
pub fn window() -> Option<ChatWindow> {
    STATE.with(|s| s.borrow().as_ref().map(|s| s.window.clone_strong()))
}

/// setChatWindowState: what the session restores.
pub fn window_state() -> ChatWindowState {
    with_state(|s| ChatWindowState {
        active_friend_id: s.active.clone(),
        open_friend_ids: s
            .conversations
            .iter()
            .map(|c| c.friend.id.clone())
            .collect(),
        open_friends: s.conversations.iter().map(|c| c.friend.clone()).collect(),
    })
    .unwrap_or_default()
    .sanitized()
}

// ---- focus (window-manager.ts) --------------------------------------------

/// isChatWindowFocused
pub fn is_focused() -> bool {
    with_state(|s| s.shown && s.focused).unwrap_or(false)
}

/// isChatConversationVisible: focused, on that conversation.
pub fn is_conversation_visible(friend_id: &str) -> bool {
    with_state(|s| s.shown && s.focused && s.active.as_deref() == Some(friend_id)).unwrap_or(false)
}

/// isChatConversationOpenInFocusedWindow
pub fn is_conversation_open_in_focused_window(friend_id: &str) -> bool {
    with_state(|s| s.shown && s.focused && s.conversations.iter().any(|c| c.friend.id == friend_id))
        .unwrap_or(false)
}

// ---- opening ----------------------------------------------------------------

/// openChatWindow(friend): focus (or create) the window on that conversation.
pub fn open(friend: UserFriend) {
    open_with(friend, true);
}

/// The developer script's `open-chat <id>` (mock mode, or a known friend).
pub fn open_by_id(id: &str) {
    let friend = UserFriend {
        id: id.to_string(),
        display_name: id.to_string(),
        ..Default::default()
    };
    open(friend);
}

/// The developer script's `open-chat-bg <id>`: opened like an incoming message.
pub fn open_in_background(id: &str) {
    let friend = UserFriend {
        id: id.to_string(),
        display_name: id.to_string(),
        ..Default::default()
    };
    open_with(friend, false);
}

/// openChatWindow with `activate`: false opens it in the background and
/// flashes its taskbar button instead of taking focus.
fn open_with(friend: UserFriend, activate: bool) {
    PENDING.with(|p| {
        p.borrow_mut().push(PendingChatFriend {
            friend,
            is_background: !activate,
        })
    });
    if let Some(window) = self::window() {
        if activate {
            let _ = window.show();
            social::focus(window.window());
        }
        open_pending();
        return;
    }
    create(activate);
}

/// restoreChatWindow: every conversation of the session, the active one shown.
pub fn restore(friends: Vec<UserFriend>, active: Option<String>) {
    let Some((first, pending)) =
        hydra_core::social::restore_chat_window_plan(&friends, active.as_deref())
    else {
        return;
    };
    PENDING.with(|p| p.borrow_mut().extend(pending));
    open(first);
}

/// showIncomingChatMessage: a closed window opens in the background on the
/// sender; an open one flashes and gets a background tab for a new sender.
pub fn show_incoming_message(friend: UserFriend) {
    let Some(window) = self::window() else {
        open_with(friend, false);
        return;
    };
    let has_tab =
        with_state(|s| s.conversations.iter().any(|c| c.friend.id == friend.id)).unwrap_or(false);
    if !has_tab {
        PENDING.with(|p| {
            p.borrow_mut().push(PendingChatFriend {
                friend,
                is_background: true,
            })
        });
        open_pending();
    }
    if !is_focused() {
        social::flash(window.window(), true);
    }
}

fn create(activate: bool) {
    let window = if activate {
        ChatWindow::new()
    } else {
        social::create_inactive(ChatWindow::new)
    };
    let Ok(window) = window else { return };
    crate::wire_translations!(&window);
    social::apply_saved_bounds(window.window(), Kind::Chat, DEFAULT_SIZE);
    let data = window.global::<ChatData>();
    data.set_native_decorations(
        cfg!(target_os = "linux") && shell::preference("useNativeWindowDecorations"),
    );
    data.set_images_enabled(crate::features::enabled("CHAT_IMAGES"));
    let rows = Rc::new(VecModel::default());
    let items = Rc::new(VecModel::default());
    let pickers = Rc::new(VecModel::default());
    data.set_conversations(ModelRc::from(rows.clone()));
    data.set_items(ModelRc::from(items.clone()));
    data.set_picker_rows(ModelRc::from(pickers.clone()));
    let width = shell::storage_get(chat::CHAT_SIDEBAR_WIDTH_STORAGE_KEY)
        .and_then(|w| w.parse::<f64>().ok())
        .filter(|w| *w > 0.0)
        .map(|w| chat::clamp_chat_sidebar_width(w, f64::INFINITY) as f32)
        .unwrap_or(chat::CHAT_SIDEBAR_INITIAL_WIDTH as f32);
    STATE.with(|s| {
        *s.borrow_mut() = Some(State {
            window: window.clone_strong(),
            conversations: Vec::new(),
            active: None,
            friends: Vec::new(),
            focused: activate,
            shown: false,
            list_request: 0,
            friends_request: 0,
            official_request: 0,
            official_revision: None,
            last_typing_ping: HashMap::new(),
            typing_timers: HashMap::new(),
            last_marked_seq: HashMap::new(),
            newer_loads: HashSet::new(),
            cooldown: None,
            cooldown_timer: slint::Timer::default(),
            cooldown_tick: slint::Timer::default(),
            rejections: 0,
            rate_window: None,
            reaction_error: None,
            reaction_error_timer: slint::Timer::default(),
            reaction_targets: HashMap::new(),
            outgoing: HashMap::new(),
            hidden_at: HashMap::new(),
            pending_checks: HashMap::new(),
            mark_read_timer: slint::Timer::default(),
            query: String::new(),
            picker_open: false,
            picker_query: String::new(),
            picker_active: 0,
            picker_timer: slint::Timer::default(),
            sidebar_width: width,
            view: ListView::default(),
            revealed: HashSet::new(),
            reaction_bar: None,
            reaction_picker: None,
            menu_key: None,
            lightbox: None,
            report_seq: None,
            report_timer: slint::Timer::default(),
            report_sent_timer: slint::Timer::default(),
            leaving_url: None,
            leaving_timer: slint::Timer::default(),
            image_note: None,
            image_note_timer: slint::Timer::default(),
            preparing: HashMap::new(),
            emoji_tab: EmojiCategoryId::Recent,
            emoji_query: String::new(),
            selection: None,
            images: HashMap::new(),
            pending_images: HashSet::new(),
            rows,
            items,
            pickers,
        })
    });
    wire(&window);
    {
        let weak = window.as_weak();
        let focus_weak = window.as_weak();
        social::install_hooks(
            window.window(),
            Kind::Chat,
            move |lines, scale| {
                if let Some(w) = weak.upgrade() {
                    let smooth = w.global::<SmoothScroll>();
                    smooth.set_lines(lines);
                    smooth.set_wheel_scale(scale);
                }
            },
            move |focused| {
                with_state(|s| s.focused = focused);
                if focused && let Some(w) = focus_weak.upgrade() {
                    social::flash(w.window(), false);
                }
                if !focused {
                    // a click outside the window closes the popovers
                    close_popovers();
                }
                schedule_mark_read();
            },
        );
        install_input_hooks(&window);
    }
    {
        let weak = window.as_weak();
        window.window().on_close_requested(move || {
            if let Some(w) = weak.upgrade() {
                social::remember_bounds(w.window(), Kind::Chat);
            }
            slint::Timer::single_shot(Duration::ZERO, drop_window);
            slint::CloseRequestResponse::HideWindow
        });
    }
    render_all();
    open_pending();
    if mock() {
        load_mock();
    } else {
        load_conversations(Some(Box::new(|| {
            refresh_friends();
            crate::chat_service::official_refresh(|| {
                let revision = crate::chat_service::unread_state().official_revision;
                with_state(|s| s.official_revision = Some(revision));
                load_official_conversation();
            });
        })));
    }
    // ready-to-show: the first frame is painted by then
    slint::Timer::single_shot(Duration::from_millis(16), move || show_window(activate));
}

fn show_window(activate: bool) {
    let Some(window) = self::window() else { return };
    if window.show().is_err() {
        return;
    }
    // the frame comes off once the native window exists: size it again
    social::resize_when_ready(window.as_weak(), Kind::Chat, DEFAULT_SIZE, 0);
    with_state(|s| s.shown = true);
    if activate {
        social::set_focused(Kind::Chat);
        social::focus(window.window());
    } else {
        social::flash(window.window(), true);
    }
}

fn drop_window() {
    let state = STATE.with(|s| s.borrow_mut().take());
    PENDING.with(|p| p.borrow_mut().clear());
    if let Some(state) = state {
        let _ = state.window.hide();
        drop(state);
    }
}

/// WindowManager.closeChatWindow
pub fn close() {
    if let Some(window) = self::window() {
        social::remember_bounds(window.window(), Kind::Chat);
    }
    drop_window();
}

/// openPendingConversations: drain the queue into tabs.
fn open_pending() {
    let pending = PENDING.with(|p| std::mem::take(&mut *p.borrow_mut()));
    let Some(last) = pending.last().cloned() else {
        return;
    };
    let unread = crate::chat_service::unread_state();
    with_state(|s| {
        for entry in &pending {
            let friend = &entry.friend;
            match s
                .conversations
                .iter_mut()
                .find(|c| c.friend.id == friend.id)
            {
                None => {
                    let mut conversation = ChatConversation::new(friend.clone());
                    if entry.is_background {
                        conversation.unread_count = unread
                            .by_friend
                            .get(&friend.id)
                            .copied()
                            .unwrap_or(0)
                            .max(1);
                    }
                    s.conversations.insert(0, conversation);
                }
                Some(existing) if !entry.is_background => {
                    merge_friend(&mut existing.friend, friend);
                    existing.unread_count = 0;
                }
                Some(_) => {}
            }
        }
        // a background open keeps the active conversation
        let foreground = pending.iter().rev().find(|p| !p.is_background);
        s.active = foreground
            .map(|p| p.friend.id.clone())
            .or_else(|| s.active.clone())
            .or_else(|| Some(last.friend.id.clone()));
    });
    on_active_changed();
    if !mock() {
        refresh_friends();
    }
}

/// `{ ...conversation.friend, ...friend }`: the newer copy wins, but a
/// copy without presence or pictures doesn't erase them.
fn merge_friend(target: &mut UserFriend, update: &UserFriend) {
    let mut merged = update.clone();
    if merged.profile_image_url.is_none() {
        merged.profile_image_url = target.profile_image_url.clone();
    }
    if merged.background_image_url.is_none() {
        merged.background_image_url = target.background_image_url.clone();
    }
    if merged.is_online.is_none() {
        merged.is_online = target.is_online;
    }
    if merged.current_game.is_none() && update.is_online.is_none() {
        merged.current_game = target.current_game.clone();
    }
    merged.is_official = merged.is_official || target.is_official;
    *target = merged;
}

// ---- loading ---------------------------------------------------------------

/// loadConversations: every conversation with messages, most recent first.
fn load_conversations(then: Option<Box<dyn FnOnce()>>) {
    let Some(api) = shell::api() else { return };
    let Some(request) = with_state(|s| {
        s.list_request += 1;
        s.list_request
    }) else {
        return;
    };
    social::spawn(
        move || {
            let mut listed = Vec::new();
            let mut cursor: Option<String> = None;
            loop {
                let mut query = vec![("take", chat::CHAT_CONVERSATIONS_PAGE_SIZE.to_string())];
                if let Some(cursor) = &cursor {
                    query.push(("cursor", cursor.clone()));
                }
                let page = api
                    .get(chat::CHAT_CONVERSATIONS_PATH, &query, Options::default())
                    .ok()
                    .and_then(|v| parse::<ChatConversationsPage>(&v))?;
                listed.extend(page.conversations);
                cursor = page.next_cursor;
                if cursor.is_none() || listed.len() >= chat::CHAT_CONVERSATIONS_LIMIT {
                    break;
                }
            }
            Some(listed)
        },
        move |listed| {
            let Some(listed) = listed else {
                if let Some(then) = then {
                    then();
                }
                return;
            };
            let current = with_state(|s| s.list_request == request).unwrap_or(false);
            if !current {
                return;
            }
            with_state(|s| {
                let open: HashSet<String> = s
                    .conversations
                    .iter()
                    .map(|c| c.friend.id.clone())
                    .collect();
                for conversation in &mut s.conversations {
                    if let Some(dto) = listed
                        .iter()
                        .find(|d| d.friend_id == conversation.friend.id)
                    {
                        let friend = dto.friend.to_user_friend();
                        conversation.friend.display_name = friend.display_name;
                        if friend.profile_image_url.is_some() {
                            conversation.friend.profile_image_url = friend.profile_image_url;
                        }
                        conversation.friend.is_official |= friend.is_official;
                        conversation.last_message = Some(chat::to_conversation_last_message(dto));
                        conversation.can_send = dto.can_send && !dto.friend.is_official;
                    }
                }
                for dto in listed.iter().filter(|d| !open.contains(&d.friend_id)) {
                    let mut friend = dto.friend.to_user_friend();
                    friend.is_online = Some(false);
                    let mut conversation = ChatConversation::new(friend);
                    conversation.last_message = Some(chat::to_conversation_last_message(dto));
                    conversation.unread_count = dto.unread_count;
                    conversation.can_send = dto.can_send && !dto.friend.is_official;
                    s.conversations.push(conversation);
                }
                if s.active.is_none() {
                    s.active = listed.first().map(|d| d.friend_id.clone());
                }
            });
            on_active_changed();
            if let Some(then) = then {
                then();
            }
        },
    );
}

/// loadOfficialConversation: the official messages page as a conversation.
fn load_official_conversation() {
    let Some(api) = shell::api() else { return };
    let Some(request) = with_state(|s| {
        s.official_request += 1;
        s.official_request
    }) else {
        return;
    };
    let language = shell::shop_language();
    social::spawn(
        move || {
            api.get(
                chat::OFFICIAL_MESSAGES_PATH,
                &[("language", language)],
                Options::default(),
            )
            .ok()
            .and_then(|v| chat::parse_official_messages_page(&v))
        },
        move |page| {
            let Some(page) = page else { return };
            with_state(|s| {
                if s.official_request != request {
                    return;
                }
                chat::apply_official_page(&mut s.conversations, &page);
                if !page.messages.is_empty() {
                    if s.active.is_none() {
                        s.active = Some(page.sender.id.clone());
                    }
                } else if s.active.as_deref() == Some(page.sender.id.as_str()) {
                    s.active = None;
                }
            });
            on_active_changed();
        },
    );
}

/// refreshFriends: presence and games of the open conversations and the picker.
fn refresh_friends() {
    if mock() {
        return;
    }
    let Some(api) = shell::api() else { return };
    let Some(request) = with_state(|s| {
        s.friends_request += 1;
        s.friends_request
    }) else {
        return;
    };
    social::spawn(
        move || social::fetch_all_friends(&api).ok(),
        move |response| {
            let Some(response) = response else { return };
            with_state(|s| {
                if s.friends_request != request {
                    return;
                }
                for conversation in &mut s.conversations {
                    if let Some(friend) = response
                        .friends
                        .iter()
                        .find(|f| f.id == conversation.friend.id)
                    {
                        merge_friend(&mut conversation.friend, friend);
                    }
                }
                s.friends = response.friends;
            });
            render_all();
        },
    );
}

/// fetchMessages: a chat page, or the official one in the same shape.
fn fetch_page(
    friend_id: &str,
    before: Option<i64>,
    after: Option<i64>,
    take: u32,
) -> Result<ChatMessagesPage, ApiError> {
    let api = social::api().ok_or(ApiError::NotLoggedIn)?;
    if friend_id != chat::OFFICIAL_CHAT_FRIEND_ID {
        let mut query = vec![("take", take.to_string())];
        if let Some(before) = before {
            query.push(("before", before.to_string()));
        }
        if let Some(after) = after {
            query.push(("after", after.to_string()));
        }
        let value = api.get(
            &chat::chat_path(friend_id, "messages"),
            &query,
            Options::default(),
        )?;
        return parse(&value).ok_or(ApiError::Network("unexpected page".into()));
    }
    let mut query = vec![
        ("language", social::language()),
        (
            "limit",
            take.min(chat::OFFICIAL_MESSAGES_PAGE_MAXIMUM).to_string(),
        ),
    ];
    if let Some(before) = before {
        query.push(("beforeSeq", before.to_string()));
    }
    let value = api.get(chat::OFFICIAL_MESSAGES_PATH, &query, Options::default())?;
    let page = chat::parse_official_messages_page(&value)
        .ok_or(ApiError::Network("unexpected page".into()))?;
    Ok(chat::to_chat_messages_page(&page, after))
}

/// Marks messages hidden after the fetch started as hidden (hiddenAtRef).
fn apply_hidden(friend_id: &str, started: i64, page: &mut ChatMessagesPage) {
    with_state(|s| {
        for message in &mut page.messages {
            let key = format!("{friend_id}:{}", message.seq);
            if s.hidden_at.get(&key).copied().unwrap_or(0) > started {
                message.hidden = true;
            }
        }
    });
}

fn update<R>(friend_id: &str, f: impl FnOnce(&mut ChatConversation) -> R) -> Option<R> {
    with_state(|s| {
        s.conversations
            .iter_mut()
            .find(|c| c.friend.id == friend_id)
            .map(f)
    })
    .flatten()
}

/// loadLatest: the newest page (replace: start over from it).
fn load_latest(friend_id: &str, replace: bool) {
    if mock() {
        update(friend_id, |c| c.load_state = ChatLoadState::Loaded);
        render_all();
        return;
    }
    update(friend_id, |c| {
        if c.load_state != ChatLoadState::Loaded {
            c.load_state = ChatLoadState::Loading;
        }
    });
    let id = friend_id.to_string();
    let started = now_ms();
    social::spawn(
        {
            let id = id.clone();
            move || fetch_page(&id, None, None, chat::CHAT_MESSAGES_PAGE_SIZE)
        },
        move |page| {
            let mut page = match page {
                Ok(page) => page,
                Err(error) => {
                    eprintln!("Failed to load chat messages: {error}");
                    update(&id, |c| {
                        if c.load_state != ChatLoadState::Loaded {
                            c.load_state = ChatLoadState::Error;
                        }
                    });
                    render_all();
                    return;
                }
            };
            apply_hidden(&id, started, &mut page);
            let messages: Vec<ChatMessage> = page
                .messages
                .iter()
                .map(|m| chat::to_chat_message(m, &id, true))
                .collect();
            let pending: Vec<ChatMessage> = page
                .pending_messages
                .iter()
                .map(|dto| {
                    let mut message = chat::to_pending_chat_message(dto);
                    if let Some(target) = messages.iter().find(|m| m.seq == dto.reply_to_seq) {
                        message.reply_to = chat::create_reply(target);
                    }
                    message
                })
                .collect();
            update(&id, |c| {
                let first_load = c.load_state != ChatLoadState::Loaded;
                if replace {
                    c.messages.retain(|m| m.seq.is_none());
                }
                chat::merge_chat_messages(&mut c.messages, messages);
                chat::merge_pending_messages(&mut c.messages, pending);
                c.can_send = page.can_send && !c.friend.is_official;
                if first_load || replace {
                    c.has_more_before = page.has_more;
                }
                if replace {
                    c.gap_after_seq = None;
                }
                c.load_state = ChatLoadState::Loaded;
            });
            for message in &page.messages {
                stop_pending_check(&message.client_nonce);
            }
            for dto in &page.pending_messages {
                if dto.status == chat::ChatPendingMessageStatus::Checking {
                    watch_pending(&id, &dto.client_nonce);
                } else {
                    stop_pending_check(&dto.client_nonce);
                }
            }
            render_all();
            schedule_mark_read();
        },
    );
}

/// loadNewerThan: what was missed after `after_seq` (or start over).
fn load_newer_than(friend_id: &str, after_seq: i64) {
    let running = with_state(|s| !s.newer_loads.insert(friend_id.to_string())).unwrap_or(true);
    if running || mock() {
        return;
    }
    let id = friend_id.to_string();
    let started = now_ms();
    social::spawn(
        {
            let id = id.clone();
            move || {
                fetch_page(
                    &id,
                    None,
                    Some(after_seq),
                    chat::CHAT_MESSAGES_MAX_PAGE_SIZE,
                )
            }
        },
        move |page| {
            with_state(|s| s.newer_loads.remove(&id));
            let Ok(mut page) = page else { return };
            if page.has_more {
                load_latest(&id, true);
                return;
            }
            apply_hidden(&id, started, &mut page);
            let messages: Vec<ChatMessage> = page
                .messages
                .iter()
                .map(|m| chat::to_chat_message(m, &id, true))
                .collect();
            update(&id, |c| {
                c.can_send = page.can_send && !c.friend.is_official;
                if c.gap_after_seq.is_some_and(|gap| gap >= after_seq) {
                    c.gap_after_seq = None;
                }
                chat::merge_chat_messages(&mut c.messages, messages);
            });
            render_all();
            schedule_mark_read();
        },
    );
}

/// loadOlder: the page before the oldest loaded message.
fn load_older(friend_id: &str) {
    let Some(oldest) = update(friend_id, |c| {
        if c.is_loading_older || !c.has_more_before {
            return None;
        }
        let oldest = c.messages.iter().find_map(|m| m.seq)?;
        c.is_loading_older = true;
        Some(oldest)
    })
    .flatten() else {
        return;
    };
    let id = friend_id.to_string();
    let started = now_ms();
    social::spawn(
        {
            let id = id.clone();
            move || fetch_page(&id, Some(oldest), None, chat::CHAT_MESSAGES_PAGE_SIZE)
        },
        move |page| {
            match page {
                Ok(mut page) => {
                    apply_hidden(&id, started, &mut page);
                    update(&id, |c| {
                        c.is_loading_older = false;
                        // history replaced meanwhile: this page would leave a hole
                        if c.messages.iter().find_map(|m| m.seq) != Some(oldest) {
                            return;
                        }
                        c.has_more_before = page.has_more;
                        let older = page
                            .messages
                            .iter()
                            .map(|m| chat::to_chat_message(m, &id, true))
                            .collect();
                        chat::merge_chat_messages(&mut c.messages, older);
                    });
                }
                Err(_) => {
                    update(&id, |c| c.is_loading_older = false);
                }
            }
            render_all();
        },
    );
}

/// loadThrough: older history until `seq` is loaded, then reveal it.
fn load_through(friend_id: &str, seq: i64) {
    let Some(oldest) = update(friend_id, |c| {
        let oldest = c.messages.iter().find_map(|m| m.seq)?;
        if oldest <= seq || c.is_loading_older || !c.has_more_before {
            return None;
        }
        c.is_loading_older = true;
        Some(oldest)
    })
    .flatten() else {
        return;
    };
    let id = friend_id.to_string();
    social::spawn(
        {
            let id = id.clone();
            move || {
                let mut loaded = Vec::new();
                let mut oldest = oldest;
                let mut has_more = true;
                while has_more && oldest > seq {
                    let Ok(page) =
                        fetch_page(&id, Some(oldest), None, chat::CHAT_MESSAGES_MAX_PAGE_SIZE)
                    else {
                        break;
                    };
                    let Some(first) = page.messages.first().map(|m| m.seq) else {
                        has_more = false;
                        break;
                    };
                    oldest = first;
                    has_more = page.has_more;
                    loaded.extend(page.messages);
                }
                (loaded, has_more)
            }
        },
        move |(loaded, has_more)| {
            let found = loaded.iter().any(|m| m.seq == seq);
            update(&id, |c| {
                c.is_loading_older = false;
                c.has_more_before = has_more;
                let older = loaded
                    .iter()
                    .map(|m| chat::to_chat_message(m, &id, true))
                    .collect();
                chat::merge_chat_messages(&mut c.messages, older);
            });
            render_all();
            if found {
                reveal(&format!("seq:{seq}"));
            }
        },
    );
}

/// resyncConversation (chat resync after a reconnect)
fn resync_conversation(friend_id: &str) {
    if friend_id == chat::OFFICIAL_CHAT_FRIEND_ID {
        load_latest(friend_id, true);
        return;
    }
    let Some((loaded, latest, gap, checking)) = update(friend_id, |c| {
        (
            c.load_state == ChatLoadState::Loaded,
            chat::get_latest_seq(&c.messages),
            c.gap_after_seq,
            c.messages
                .iter()
                .any(|m| m.status == ChatMessageStatus::Checking),
        )
    }) else {
        return;
    };
    if !loaded || latest == 0 {
        load_latest(friend_id, false);
        return;
    }
    load_newer_than(friend_id, gap.unwrap_or(latest));
    if checking {
        load_latest(friend_id, false);
    }
}

/// onChatResync: reload what each open conversation missed, and the list.
pub fn on_resync() {
    let ids: Vec<String> = with_state(|s| {
        s.conversations
            .iter()
            .filter(|c| c.load_state != ChatLoadState::Idle)
            .map(|c| c.friend.id.clone())
            .collect()
    })
    .unwrap_or_default();
    for id in ids {
        resync_conversation(&id);
    }
    if self::window().is_some() && !mock() {
        load_conversations(None);
        with_state(|s| s.last_marked_seq.clear());
        schedule_mark_read();
    }
}

// ---- pending checks (held messages with images) -------------------------------

fn stop_pending_check(client_nonce: &str) {
    with_state(|s| s.pending_checks.remove(client_nonce));
}

/// watchPending: look the conversation up again when the server stays quiet.
fn watch_pending(friend_id: &str, client_nonce: &str) {
    let lookups = with_state(|s| {
        s.pending_checks
            .remove(client_nonce)
            .map_or(0, |(_, lookups)| lookups)
    })
    .unwrap_or(0);
    if lookups >= chat::PENDING_CHECK_MAX_LOOKUPS {
        update(friend_id, |c| {
            chat::set_message_failed(&mut c.messages, client_nonce, None)
        });
        render_all();
        return;
    }
    let timer = slint::Timer::default();
    let id = friend_id.to_string();
    let nonce = client_nonce.to_string();
    timer.start(
        slint::TimerMode::SingleShot,
        Duration::from_millis(chat::PENDING_CHECK_TIMEOUT_MS),
        move || {
            with_state(|s| {
                if let Some(entry) = s.pending_checks.get_mut(&nonce) {
                    entry.1 = lookups + 1;
                }
            });
            load_latest(&id, false);
            // a failed lookup leaves this check in place, so it looks again
            let id = id.clone();
            let nonce = nonce.clone();
            slint::Timer::single_shot(Duration::from_millis(1500), move || {
                let still = with_state(|s| s.pending_checks.contains_key(&nonce)).unwrap_or(false);
                if still {
                    watch_pending(&id, &nonce);
                }
            });
        },
    );
    with_state(|s| {
        s.pending_checks
            .insert(client_nonce.to_string(), (timer, lookups))
    });
}

// ---- realtime ----------------------------------------------------------------

/// onChatMessage
pub fn on_message(friend_id: &str, dto: ChatMessageDto) {
    let Some(known) = update(friend_id, |c| {
        let incoming = chat::to_chat_message(&dto, friend_id, false);
        let is_known = c
            .messages
            .iter()
            .any(|m| m.client_nonce == incoming.client_nonce && m.seq.is_some());
        let gap = if c.load_state == ChatLoadState::Loaded {
            chat::find_gap_after(&c.messages, c.gap_after_seq, dto.seq)
        } else {
            None
        };
        (incoming, is_known, gap)
    }) else {
        return;
    };
    let (incoming, is_known, gap) = known;
    if incoming.from_me {
        with_state(|s| s.outgoing.remove(&incoming.client_nonce));
        stop_pending_check(&incoming.client_nonce);
    }
    if let Some(gap) = gap {
        load_newer_than(friend_id, gap);
    }
    let visible = is_conversation_visible(friend_id);
    let new_from_friend = !incoming.from_me && !is_known;
    if new_from_friend {
        stop_typing(friend_id);
    }
    update(friend_id, |c| {
        if c.gap_after_seq.is_none() {
            c.gap_after_seq = gap;
        }
        chat::merge_chat_messages(&mut c.messages, vec![incoming]);
        if new_from_friend && !visible {
            c.unread_count += 1;
        }
    });
    render_all();
    schedule_mark_read();
}

/// onChatTyping: the dots for 5s (TYPING_INDICATOR_TIMEOUT_MS).
pub fn on_typing(friend_id: &str) {
    if update(friend_id, |c| c.is_typing = true).is_none() {
        return;
    }
    let timer = slint::Timer::default();
    let id = friend_id.to_string();
    timer.start(
        slint::TimerMode::SingleShot,
        Duration::from_millis(chat::TYPING_INDICATOR_TIMEOUT_MS),
        move || stop_typing(&id),
    );
    with_state(|s| s.typing_timers.insert(friend_id.to_string(), timer));
    render_all();
}

fn stop_typing(friend_id: &str) {
    with_state(|s| s.typing_timers.remove(friend_id));
    let changed =
        update(friend_id, |c| std::mem::replace(&mut c.is_typing, false)).unwrap_or(false);
    if changed {
        render_all();
    }
}

/// onChatReaction
pub fn on_reaction(
    friend_id: &str,
    seq: i64,
    from_me: bool,
    emoji: Option<String>,
    updated_at: &str,
) {
    let changed = update(friend_id, |c| {
        chat::update_message_reactions(&mut c.messages, seq, |reactions| {
            chat::apply_reaction(
                reactions,
                ChatReactionUpdate {
                    from_me,
                    emoji: emoji.clone(),
                    updated_at: updated_at.to_string(),
                    is_pending: false,
                },
            )
        })
    })
    .unwrap_or(false);
    if changed {
        render_all();
    }
}

/// onChatMessageVisibility: removed by moderation, or put back.
pub fn on_visibility(friend_id: &str, seq: i64, hidden: bool) {
    let key = format!("{friend_id}:{seq}");
    if hidden {
        with_state(|s| s.hidden_at.insert(key, now_ms()));
        update(friend_id, |c| {
            if c.reply_to_seq == Some(seq) {
                c.reply_to_seq = None;
            }
            chat::set_message_visibility(&mut c.messages, seq, None);
            if let Some(last) = &mut c.last_message
                && last.seq == seq
            {
                last.text.clear();
                last.is_hidden = true;
            }
        });
        render_all();
        return;
    }
    with_state(|s| s.hidden_at.remove(&key));
    // the event carries no text: fetch it back
    let id = friend_id.to_string();
    social::spawn(
        {
            let id = id.clone();
            move || fetch_page(&id, None, Some(seq - 1), 1)
        },
        move |page| {
            let Ok(page) = page else { return };
            let Some(restored) = page.messages.iter().find(|m| m.seq == seq) else {
                return;
            };
            if restored.hidden {
                return;
            }
            update(&id, |c| {
                chat::set_message_visibility(&mut c.messages, seq, Some(&restored.body));
                chat::merge_chat_messages(
                    &mut c.messages,
                    vec![chat::to_chat_message(restored, &id, true)],
                );
            });
            render_all();
        },
    );
}

/// onChatMessageRejected (the user's own message with images)
pub fn on_rejected(friend_id: &str, client_nonce: &str, blocked: bool) {
    stop_pending_check(client_nonce);
    if blocked {
        with_state(|s| s.outgoing.remove(client_nonce));
    }
    let status = if blocked {
        ChatMessageStatus::Blocked
    } else {
        ChatMessageStatus::Failed
    };
    update(friend_id, |c| {
        chat::set_message_status(&mut c.messages, client_nonce, status)
    });
    render_all();
}

/// onChatUnreadUpdated: dots on the tabs the user isn't looking at, and the
/// official conversation reloads when a poll changed it.
pub fn on_unread_changed(state: &ChatUnreadState) {
    let Some(reload_official) = with_state(|s| {
        let visible_id = (s.focused && s.shown).then(|| s.active.clone()).flatten();
        for conversation in &mut s.conversations {
            if Some(&conversation.friend.id) == visible_id.as_ref() {
                continue;
            }
            conversation.unread_count = state
                .by_friend
                .get(&conversation.friend.id)
                .copied()
                .unwrap_or(0);
        }
        match s.official_revision {
            Some(revision) if revision != state.official_revision => {
                s.official_revision = Some(state.official_revision);
                true
            }
            _ => false,
        }
    }) else {
        return;
    };
    if reload_official {
        load_official_conversation();
    }
    render_all();
}

/// onFriendPresence
pub fn on_presence(friend_id: &str, online: bool) {
    if update(friend_id, |c| c.friend.is_online = Some(online)).is_some() {
        render_all();
    }
}

/// onFriendsUpdated
pub fn on_friends_updated() {
    if self::window().is_some() {
        refresh_friends();
    }
}

pub fn on_language_changed() {
    if let Some(window) = self::window() {
        let t = window.global::<crate::T>();
        t.set_rev(t.get_rev() + 1);
        if with_state(|s| s.official_revision.is_some()).unwrap_or(false) {
            load_official_conversation();
        }
        render_all();
    }
}

// ---- selection --------------------------------------------------------------

/// handleSelect
fn select(friend_id: &str) {
    with_state(|s| {
        s.active = Some(friend_id.to_string());
        let keep: HashSet<String> = s.preparing.keys().cloned().collect();
        chat::drop_abandoned_conversations(&mut s.conversations, Some(friend_id), &keep);
        if let Some(c) = s
            .conversations
            .iter_mut()
            .find(|c| c.friend.id == friend_id)
        {
            c.unread_count = 0;
        }
    });
    on_active_changed();
}

/// A new conversation is shown: its history loads once, the list starts at
/// the bottom and its messages render without the entrance.
fn on_active_changed() {
    let Some((active, idle)) = with_state(|s| {
        let active = s.active.clone();
        let idle = active.as_ref().and_then(|id| {
            s.conversations
                .iter()
                .find(|c| &c.friend.id == id)
                .map(|c| c.load_state == ChatLoadState::Idle)
        });
        s.view = ListView::default();
        if let Some(c) = active
            .as_ref()
            .and_then(|id| s.conversations.iter().find(|c| &c.friend.id == id))
        {
            s.view.initial = c.messages.iter().map(|m| m.id.clone()).collect();
        }
        s.reaction_bar = None;
        s.reaction_picker = None;
        s.lightbox = None;
        (active, idle)
    }) else {
        return;
    };
    if let Some(window) = self::window() {
        let data = window.global::<ChatData>();
        data.set_emoji_open(false);
        data.set_focus_composer(data.get_focus_composer() + 1);
    }
    if let (Some(id), Some(true)) = (&active, idle) {
        load_latest(id, false);
    }
    render_all();
    schedule_mark_read();
}

// ---- mark read (use-chat.ts) --------------------------------------------------

/// The active conversation is read once it is loaded and the window is
/// focused (500ms debounce; only a saved read is remembered).
fn schedule_mark_read() {
    let Some(plan) = with_state(|s| {
        if !s.focused || !s.shown {
            return None;
        }
        let id = s.active.clone()?;
        let c = s.conversations.iter_mut().find(|c| c.friend.id == id)?;
        if c.load_state != ChatLoadState::Loaded {
            return None;
        }
        c.unread_count = 0;
        let read_seq = c
            .gap_after_seq
            .unwrap_or_else(|| chat::get_latest_seq(&c.messages));
        if read_seq == 0 || s.last_marked_seq.get(&id).copied().unwrap_or(0) >= read_seq {
            return None;
        }
        Some((id, read_seq))
    })
    .flatten() else {
        return;
    };
    let (id, seq) = plan;
    with_state(|s| {
        s.mark_read_timer.start(
            slint::TimerMode::SingleShot,
            Duration::from_millis(chat::MARK_READ_DEBOUNCE_MS),
            move || {
                if mock() {
                    return;
                }
                let id2 = id.clone();
                crate::chat_service::mark_read(&id, seq, move |ok| {
                    if ok {
                        with_state(|s| {
                            let marked = s.last_marked_seq.get(&id2).copied().unwrap_or(0);
                            s.last_marked_seq.insert(id2.clone(), marked.max(seq));
                        });
                    }
                });
            },
        )
    });
}

// ---- sending (use-chat.ts) ------------------------------------------------------

fn error_text(error: &ApiError) -> String {
    match error {
        ApiError::Status { .. } => {
            error.code().map(str::to_string).unwrap_or_default() + " " + &error.to_string()
        }
        other => other.to_string(),
    }
}

fn is_cooling_down() -> bool {
    with_state(|s| s.cooldown.is_some_and(|c| c.until > now_ms())).unwrap_or(false)
}

fn reject_send() {
    with_state(|s| s.rejections += 1);
    render_composer();
}

fn start_rate_window() -> i64 {
    with_state(|s| {
        let start = chat::get_rate_limit_window_start(s.rate_window, now_ms());
        s.rate_window = Some(start);
        start
    })
    .unwrap_or_else(now_ms)
}

/// failSend: the rate limit's countdown, the not-friends lock, the failure.
fn fail_send(friend_id: &str, client_nonce: &str, error: &str, window_start: i64) {
    if error.contains(chat::RATE_LIMITED_ERROR) {
        if !is_cooling_down() {
            let cooldown = chat::create_send_cooldown(window_start, now_ms());
            start_cooldown(cooldown);
        }
        reject_send();
    }
    let daily = error.contains(chat::ATTACHMENTS_DAILY_LIMIT_ERROR);
    update(friend_id, |c| {
        if error.contains(chat::NOT_FRIENDS_ERROR) {
            c.can_send = false;
        }
        chat::set_message_failed(
            &mut c.messages,
            client_nonce,
            daily.then_some(chat::ChatFailure::DailyLimit),
        );
    });
    render_all();
}

fn start_cooldown(cooldown: ChatSendCooldown) {
    with_state(|s| {
        s.cooldown = Some(cooldown);
        s.cooldown_timer.start(
            slint::TimerMode::SingleShot,
            Duration::from_millis((cooldown.until - now_ms()).max(0) as u64),
            || {
                with_state(|s| {
                    s.cooldown = None;
                    s.cooldown_tick.stop();
                });
                render_composer();
            },
        );
        // the seconds left (TICK_MS 250)
        s.cooldown_tick.start(
            slint::TimerMode::Repeated,
            Duration::from_millis(250),
            render_composer,
        );
    });
    render_composer();
}

/// send: the draft's text, and its images if it has any.
fn send() {
    if is_cooling_down() {
        reject_send();
        return;
    }
    let Some((friend_id, text, images, reply)) = with_state(|s| {
        let id = s.active.clone()?;
        let c = s.conversations.iter_mut().find(|c| c.friend.id == id)?;
        let text = chat::time::js_trim(&c.draft).to_string();
        let reply = c
            .reply_to_seq
            .and_then(|seq| c.messages.iter().find(|m| m.seq == Some(seq)))
            .and_then(chat::create_reply);
        let images = std::mem::take(&mut c.draft_images);
        c.draft.clear();
        c.reply_to_seq = None;
        Some((id, text, images, reply))
    })
    .flatten() else {
        return;
    };
    let client_nonce = uuid();
    let attachments: Vec<ChatAttachment> = images
        .iter()
        .map(|image| ChatAttachment {
            id: image.id.clone(),
            content_type: image.content_type.clone(),
            width: Some(image.width),
            height: Some(image.height),
            spoiler: image.spoiler,
            url: None,
            local_url: Some(image.url.clone()),
        })
        .collect();
    let reply_seq = reply.as_ref().map(|r| r.seq);
    update(&friend_id, |c| {
        c.messages.push(chat::create_pending_message(
            &text,
            &client_nonce,
            Some(now_iso()),
            reply,
            attachments,
        ));
    });
    with_state(|s| {
        s.last_typing_ping.remove(&friend_id);
        s.view.new_since = None;
    });
    if let Some(window) = self::window() {
        let data = window.global::<ChatData>();
        data.set_emoji_open(false);
        data.set_scroll_to_latest(data.get_scroll_to_latest() + 1);
    }
    render_all();
    if images.is_empty() {
        deliver(&friend_id, &text, &client_nonce, reply_seq);
        return;
    }
    with_state(|s| {
        s.outgoing.insert(
            client_nonce.clone(),
            Outgoing {
                friend_id: friend_id.clone(),
                text: text.clone(),
                reply_to_seq: reply_seq,
                files: images
                    .iter()
                    .map(|i| (Rc::from(&*i.bytes), i.content_type.clone()))
                    .collect(),
                spoilers: images.iter().map(|i| i.spoiler).collect(),
                ids: images.iter().map(|_| None).collect(),
            },
        )
    });
    deliver_images(&client_nonce);
}

/// deliver: POST the text message.
fn deliver(friend_id: &str, text: &str, client_nonce: &str, reply_to_seq: Option<i64>) {
    let window_start = start_rate_window();
    let id = friend_id.to_string();
    let nonce = client_nonce.to_string();
    let mut body = json!({ "body": text, "clientNonce": client_nonce });
    if let Some(seq) = reply_to_seq {
        body["replyToSeq"] = json!(seq);
    }
    if mock() {
        let fail = text.contains("fail");
        slint::Timer::single_shot(Duration::from_millis(600), move || {
            if fail {
                fail_send(&id, &nonce, "mock failure", window_start);
                return;
            }
            let seq = update(&id, |c| chat::get_latest_seq(&c.messages) + 1).unwrap_or(1);
            let mut stored = mock_dto(
                &id,
                seq,
                true,
                &body["body"].as_str().unwrap_or_default().to_string(),
                &now_iso(),
            );
            stored.client_nonce = nonce.clone();
            stored.reply_to_seq = reply_to_seq;
            update(&id, |c| {
                chat::merge_chat_messages(
                    &mut c.messages,
                    vec![chat::to_chat_message(&stored, &id, false)],
                )
            });
            render_all();
        });
        return;
    }
    let path = chat::chat_path(friend_id, "messages");
    social::spawn(
        move || {
            social::write("send chat message", |api| {
                api.post(&path, &body, Options::default())
            })
        },
        move |result| match result {
            Ok(value) => {
                if let Some(stored) = parse::<ChatMessageDto>(&value) {
                    update(&id, |c| {
                        chat::merge_chat_messages(
                            &mut c.messages,
                            vec![chat::to_chat_message(&stored, &id, false)],
                        )
                    });
                }
                render_all();
            }
            Err(error) => fail_send(&id, &nonce, &error_text(&error), window_start),
        },
    );
}

/// deliverImages: upload what isn't up yet, then post the message; the
/// server holds it until the images pass moderation.
fn deliver_images(client_nonce: &str) {
    let Some((friend_id, text, reply, files, spoilers, ids)) = with_state(|s| {
        s.outgoing.get(client_nonce).map(|o| {
            (
                o.friend_id.clone(),
                o.text.clone(),
                o.reply_to_seq,
                o.files
                    .iter()
                    .map(|(b, t)| (b.to_vec(), t.clone()))
                    .collect::<Vec<_>>(),
                o.spoilers.clone(),
                o.ids.clone(),
            )
        })
    })
    .flatten() else {
        return;
    };
    let window_start = start_rate_window();
    let nonce = client_nonce.to_string();
    let id = friend_id.clone();
    if mock() {
        let id2 = id.clone();
        slint::Timer::single_shot(Duration::from_millis(900), move || {
            update(&id2, |c| {
                chat::set_message_upload_progress(&mut c.messages, &nonce, 1.0);
                chat::settle_sending_message(&mut c.messages, &nonce, ChatMessageStatus::Checking)
            });
            render_all();
        });
        return;
    }
    social::spawn(
        move || -> Result<(Vec<String>, Value, u16), String> {
            let mut ids = ids;
            for (index, (bytes, content_type)) in files.iter().enumerate() {
                if ids.get(index).cloned().flatten().is_some() {
                    continue;
                }
                let reservation = social::write("reserve chat attachment", |api| {
                    api.post(
                        &chat::chat_path(&id, "attachments"),
                        &json!({ "contentType": content_type, "size": bytes.len() }),
                        Options::default(),
                    )
                })
                .map_err(|e| error_text(&e))?;
                let reservation = parse::<chat::ChatAttachmentReservation>(&reservation)
                    .ok_or("chat-attachment-upload-failed")?;
                let client = hydra_store::http_client();
                let response = client
                    .put(&reservation.upload_url)
                    .header("Content-Type", content_type)
                    .timeout(Duration::from_secs(5 * 60))
                    .body(bytes.clone())
                    .send()
                    .map_err(|e| e.to_string())?;
                if !response.status().is_success() {
                    return Err(format!("upload failed {}", response.status()));
                }
                if let Some(slot) = ids.get_mut(index) {
                    *slot = Some(reservation.id);
                }
            }
            let ids: Vec<String> = ids.into_iter().flatten().collect();
            let mut body = json!({
                "clientNonce": nonce,
                "attachments": ids.iter().zip(&spoilers).map(|(id, spoiler)| json!({ "id": id, "spoiler": spoiler })).collect::<Vec<_>>(),
            });
            if !text.is_empty() {
                body["body"] = json!(text);
            }
            if let Some(seq) = reply {
                body["replyToSeq"] = json!(seq);
            }
            let value = social::write("send chat images", |api| {
                api.post(&chat::chat_path(&id, "messages"), &body, Options::default())
            })
            .map_err(|e| error_text(&e))?;
            let status = if value.get("status").is_some() {
                202
            } else {
                201
            };
            Ok((ids, value, status))
        },
        {
            let nonce = client_nonce.to_string();
            move |result: Result<(Vec<String>, Value, u16), String>| match result {
                Ok((ids, value, status)) => {
                    update(&friend_id, |c| {
                        chat::set_message_upload_progress(&mut c.messages, &nonce, 1.0);
                        chat::set_message_attachment_ids(&mut c.messages, &nonce, &ids);
                    });
                    if status == 201 {
                        with_state(|s| s.outgoing.remove(&nonce));
                        if let Some(stored) = parse::<ChatMessageDto>(&value) {
                            update(&friend_id, |c| {
                                chat::merge_chat_messages(
                                    &mut c.messages,
                                    vec![chat::to_chat_message(&stored, &friend_id, false)],
                                )
                            });
                        }
                    } else {
                        let checking =
                            value.get("status").and_then(Value::as_str) == Some("checking");
                        let status = match value.get("status").and_then(Value::as_str) {
                            Some("blocked") => ChatMessageStatus::Blocked,
                            Some("failed") => ChatMessageStatus::Failed,
                            _ => ChatMessageStatus::Checking,
                        };
                        update(&friend_id, |c| {
                            chat::settle_sending_message(&mut c.messages, &nonce, status)
                        });
                        if checking {
                            watch_pending(&friend_id, &nonce);
                        }
                    }
                    render_all();
                }
                Err(error) => {
                    if error.contains(chat::ATTACHMENT_NOT_FOUND_ERROR) {
                        with_state(|s| {
                            if let Some(o) = s.outgoing.get_mut(&nonce) {
                                o.ids.iter_mut().for_each(|i| *i = None);
                            }
                        });
                    }
                    fail_send(&friend_id, &nonce, &error, window_start);
                }
            }
        },
    );
}

/// retry: a failed message goes out again (its uploaded images stay up).
fn retry(key: &str) {
    let Some((friend_id, message)) = with_state(|s| {
        let id = s.active.clone()?;
        let c = s.conversations.iter().find(|c| c.friend.id == id)?;
        let message = c.messages.iter().find(|m| item_key(m) == key)?.clone();
        Some((id, message))
    })
    .flatten() else {
        return;
    };
    if message.status != ChatMessageStatus::Failed {
        return;
    }
    if is_cooling_down() {
        reject_send();
        return;
    }
    let nonce = message.client_nonce.clone();
    if message.attachment_count() == 0 {
        update(&friend_id, |c| {
            chat::set_message_status(&mut c.messages, &nonce, ChatMessageStatus::Pending)
        });
        render_all();
        deliver(
            &friend_id,
            &message.text,
            &nonce,
            message.reply_to.as_ref().map(|r| r.seq),
        );
        return;
    }
    with_state(|s| {
        s.outgoing.entry(nonce.clone()).or_insert_with(|| Outgoing {
            friend_id: friend_id.clone(),
            text: message.text.clone(),
            reply_to_seq: message.reply_to.as_ref().map(|r| r.seq),
            files: Vec::new(),
            spoilers: message
                .attachments
                .iter()
                .flatten()
                .map(|a| a.spoiler)
                .collect(),
            ids: message
                .attachments
                .iter()
                .flatten()
                .map(|a| Some(a.id.clone()))
                .collect(),
        });
    });
    update(&friend_id, |c| {
        chat::set_message_status(&mut c.messages, &nonce, ChatMessageStatus::Pending);
        chat::set_message_upload_progress(&mut c.messages, &nonce, 0.0);
    });
    render_all();
    deliver_images(&nonce);
}

/// remove: drop a message that wasn't sent (and tell the server to forget it).
fn remove(key: &str) {
    let Some((friend_id, message)) = with_state(|s| {
        let id = s.active.clone()?;
        let c = s.conversations.iter().find(|c| c.friend.id == id)?;
        let message = c
            .messages
            .iter()
            .find(|m| item_key(m) == key && m.seq.is_none())?
            .clone();
        Some((id, message))
    })
    .flatten() else {
        return;
    };
    if !matches!(
        message.status,
        ChatMessageStatus::Failed | ChatMessageStatus::Blocked
    ) {
        return;
    }
    let nonce = message.client_nonce.clone();
    with_state(|s| s.outgoing.remove(&nonce));
    stop_pending_check(&nonce);
    update(&friend_id, |c| {
        chat::remove_unsent_message(&mut c.messages, &nonce)
    });
    render_all();
    if message.attachment_count() > 0 && !mock() {
        let path = chat::chat_path(&friend_id, &format!("pending/{nonce}"));
        std::thread::spawn(move || {
            let _ = social::write("forget pending chat message", |api| {
                api.delete(&path, Options::default())
            });
        });
    }
}

/// notifyTyping: at most one ping per 3s, only with text to send.
fn notify_typing(friend_id: &str, draft: &str) {
    let Some(ping) = with_state(|s| {
        let can_send = s
            .conversations
            .iter()
            .find(|c| c.friend.id == friend_id)
            .is_some_and(|c| c.can_send);
        if chat::time::js_trim(draft).is_empty() || !can_send {
            return false;
        }
        let now = now_ms();
        let last = s.last_typing_ping.get(friend_id).copied().unwrap_or(0);
        if now - last < chat::TYPING_PING_INTERVAL_MS as i64 {
            return false;
        }
        s.last_typing_ping.insert(friend_id.to_string(), now);
        true
    }) else {
        return;
    };
    if !ping || mock() {
        return;
    }
    let path = chat::chat_path(friend_id, "typing");
    std::thread::spawn(move || {
        let _ = social::write("typing ping", |api| {
            api.post(&path, &Value::Null, Options::default())
        });
    });
}

// ---- reactions ----------------------------------------------------------------

/// react: optimistic, one request at a time per message, the saved
/// reaction restored when the last change fails.
fn react(friend_id: &str, seq: i64, emoji: Option<String>) {
    let Some(saved_mine) = update(friend_id, |c| {
        let message = c.messages.iter().find(|m| m.seq == Some(seq))?;
        let saved = message
            .reactions
            .iter()
            .flatten()
            .find(|r| r.from_me)
            .cloned();
        chat::update_message_reactions(&mut c.messages, seq, |reactions| {
            chat::apply_reaction(
                reactions,
                ChatReactionUpdate {
                    from_me: true,
                    emoji: emoji.clone(),
                    updated_at: now_iso(),
                    is_pending: true,
                },
            )
        });
        Some(saved)
    })
    .flatten() else {
        return;
    };
    with_state(|s| s.reaction_error = None);
    render_all();
    let key = format!("{friend_id}:{seq}");
    let sending = with_state(|s| {
        s.reaction_targets
            .insert(key.clone(), emoji.clone())
            .is_some()
    })
    .unwrap_or(false);
    if sending {
        return;
    }
    send_reaction_targets(friend_id.to_string(), seq, key, saved_mine, None);
}

fn send_reaction_targets(
    friend_id: String,
    seq: i64,
    key: String,
    saved_mine: Option<ChatReaction>,
    previous: Option<ChatMessageReactionsDto>,
) {
    let Some(target) = with_state(|s| s.reaction_targets.get(&key).cloned()).flatten() else {
        return;
    };
    let path = chat::chat_path(&friend_id, &format!("messages/{seq}/reaction"));
    let mocked = mock();
    social::spawn(
        {
            let target = target.clone();
            move || -> Result<ChatMessageReactionsDto, String> {
                if mocked {
                    return Ok(ChatMessageReactionsDto {
                        seq,
                        reactions: target
                            .iter()
                            .map(|emoji| chat::ChatReactionDto {
                                user_id: "me".into(),
                                emoji: emoji.clone(),
                                updated_at: now_iso(),
                            })
                            .collect(),
                    });
                }
                let value = social::write("chat reaction", |api| match &target {
                    Some(emoji) => api.put(&path, &json!({ "emoji": emoji }), Options::default()),
                    None => api.delete(&path, Options::default()),
                })
                .map_err(|e| error_text(&e))?;
                parse(&value).ok_or_else(|| "unexpected".to_string())
            }
        },
        move |result| {
            let (settled, error) = match result {
                Ok(settled) => (Some(settled), None),
                Err(error) => (previous, Some(error)),
            };
            let still = with_state(|s| s.reaction_targets.get(&key).cloned()).flatten();
            if still != Some(target.clone()) {
                send_reaction_targets(friend_id, seq, key, saved_mine, settled);
                return;
            }
            with_state(|s| s.reaction_targets.remove(&key));
            update(&friend_id, |c| {
                if error
                    .as_ref()
                    .is_some_and(|e| e.contains(chat::NOT_FRIENDS_ERROR))
                {
                    c.can_send = false;
                }
                chat::update_message_reactions(&mut c.messages, seq, |reactions| match &settled {
                    Some(settled) => chat::merge_reactions(
                        reactions,
                        &chat::to_chat_reactions(&settled.reactions, &friend_id),
                        true,
                    ),
                    None => {
                        let mut next: Vec<ChatReaction> =
                            reactions.iter().filter(|r| !r.from_me).cloned().collect();
                        next.extend(saved_mine.clone());
                        chat::sort_reactions(&mut next);
                        next
                    }
                });
            });
            if let Some(error) = error {
                let rate = error.contains(chat::RATE_LIMITED_ERROR);
                with_state(|s| {
                    s.reaction_error = Some((friend_id.clone(), rate));
                    s.reaction_error_timer.start(
                        slint::TimerMode::SingleShot,
                        Duration::from_millis(chat::REACTION_ERROR_DURATION_MS),
                        || {
                            with_state(|s| s.reaction_error = None);
                            render_composer();
                        },
                    );
                });
            }
            render_all();
        },
    );
}

/// reactTo: picking the reaction the user already has takes it back.
fn react_to(key: &str, emoji: &str) {
    let Some((friend_id, seq, mine)) = with_state(|s| {
        let id = s.active.clone()?;
        let c = s.conversations.iter().find(|c| c.friend.id == id)?;
        let message = c.messages.iter().find(|m| item_key(m) == key)?;
        let seq = message.seq?;
        Some((id, seq, chat::get_my_reaction(message).map(str::to_string)))
    })
    .flatten() else {
        return;
    };
    if mine.as_deref() != Some(emoji) {
        remember_emoji(emoji);
        remember_reaction(emoji);
    }
    react(
        &friend_id,
        seq,
        (mine.as_deref() != Some(emoji)).then(|| emoji.to_string()),
    );
}

fn recent_list(key: &str, defaults: &[&str]) -> Vec<String> {
    chat::parse_emoji_list(shell::storage_get(key).as_deref(), defaults)
}

/// rememberEmoji: the picker's Recent tab.
fn remember_emoji(emoji: &str) {
    let recent = recent_list(chat::RECENT_EMOJI_STORAGE_KEY, &chat::DEFAULT_RECENT_EMOJI);
    let next = chat::add_recent_emoji(&recent, emoji, chat::MAX_RECENT_EMOJI);
    shell::storage_set(
        chat::RECENT_EMOJI_STORAGE_KEY,
        &serde_json::to_string(&next).unwrap_or_default(),
    );
}

/// rememberReaction: the quick reaction bar.
fn remember_reaction(emoji: &str) {
    let recent = recent_list(chat::RECENT_REACTIONS_STORAGE_KEY, &chat::QUICK_REACTIONS);
    let next = chat::add_recent_emoji(&recent, emoji, chat::QUICK_REACTIONS.len());
    shell::storage_set(
        chat::RECENT_REACTIONS_STORAGE_KEY,
        &serde_json::to_string(&next).unwrap_or_default(),
    );
}

// ---- wiring --------------------------------------------------------------------

/// A message's key in the list: its seq when stored, else its nonce.
fn item_key(message: &ChatMessage) -> String {
    match message.seq {
        Some(seq) => format!("seq:{seq}"),
        None => format!("nonce:{}", message.client_nonce),
    }
}

fn active_message(key: &str) -> Option<(String, ChatMessage)> {
    with_state(|s| {
        let id = s.active.clone()?;
        let c = s.conversations.iter().find(|c| c.friend.id == id)?;
        let message = c.messages.iter().find(|m| item_key(m) == key)?.clone();
        Some((id, message))
    })
    .flatten()
}

fn wire(window: &ChatWindow) {
    let data = window.global::<ChatData>();
    let weak = window.as_weak();
    data.on_minimize({
        let weak = weak.clone();
        move || {
            if let Some(w) = weak.upgrade() {
                w.window().set_minimized(true);
            }
        }
    });
    data.on_close(close);
    data.on_drag({
        let weak = weak.clone();
        move || {
            if let Some(w) = weak.upgrade() {
                social::drag(w.window());
            }
        }
    });
    data.on_select(|id| select(&id));
    data.on_query_edited(|text| {
        with_state(|s| s.query = text.to_string());
        render_sidebar();
    });
    data.on_toggle_picker(toggle_picker);
    data.on_picker_edited(|text| {
        with_state(|s| {
            s.picker_query = text.to_string();
            s.picker_active = 0;
        });
        render_sidebar();
    });
    data.on_picker_pick(|id| pick_friend(&id));
    data.on_picker_key(|key| picker_key(&key));
    data.on_sidebar_resized(|width| resize_sidebar(width));
    data.on_open_profile(|| {
        if let Some(id) = with_state(|s| s.active.clone()).flatten() {
            social::focus_main_and_navigate(&format!("/profile/{id}"));
        }
    });
    data.on_open_game(open_game);
    data.on_open_settings(|| social::focus_main_and_navigate("/settings?tab=notifications"));
    data.on_reload(|| {
        if let Some(id) = with_state(|s| s.active.clone()).flatten() {
            load_latest(&id, false);
        }
    });
    data.on_draft_edited(|text| draft_edited(&text));
    data.on_send(try_send);
    data.on_composer_key(composer_key);
    data.on_window_key(window_key);
    data.on_cancel_reply(|| {
        set_reply(None);
    });
    data.on_show_reply(|| {
        let key = with_state(|s| {
            let id = s.active.clone()?;
            let c = s.conversations.iter().find(|c| c.friend.id == id)?;
            c.reply_to_seq.map(|seq| format!("seq:{seq}"))
        })
        .flatten();
        if let Some(key) = key {
            reveal(&key);
        }
    });
    data.on_add_images(add_images);
    data.on_remove_image(|id| {
        if let Some(friend) = with_state(|s| s.active.clone()).flatten() {
            update(&friend, |c| c.draft_images.retain(|i| i.id != id.as_str()));
        }
        render_composer();
    });
    data.on_toggle_spoiler(|id| {
        if let Some(friend) = with_state(|s| s.active.clone()).flatten() {
            update(&friend, |c| {
                for image in c.draft_images.iter_mut().filter(|i| i.id == id.as_str()) {
                    image.spoiler = !image.spoiler;
                }
            });
        }
        render_composer();
    });
    data.on_emoji_tab_picked(|tab| {
        let tab = chat::CATEGORY_IDS
            .into_iter()
            .find(|c| c.as_str() == tab.as_str())
            .unwrap_or(EmojiCategoryId::Recent);
        with_state(|s| {
            s.emoji_tab = tab;
            s.emoji_query.clear();
        });
        render_emoji();
    });
    data.on_emoji_query_edited(|query| {
        with_state(|s| s.emoji_query = query.to_string());
        render_emoji();
    });
    data.on_emoji_picked(|emoji| emoji_picked(&emoji));
    data.on_emoji_closed(close_emoji);
    data.on_emoji_opened(|| {
        with_state(|s| {
            s.reaction_picker = None;
            s.emoji_tab = EmojiCategoryId::Recent;
            s.emoji_query.clear();
        });
        render_emoji();
    });
    data.on_reply(|key| {
        if let Some((_, message)) = active_message(&key) {
            set_reply(message.seq);
        }
    });
    data.on_react_toggle(|key, below| {
        with_state(|s| {
            s.reaction_picker = None;
            s.reaction_bar = Some((key.to_string(), below));
        });
        render_overlays();
    });
    data.on_react_bar_pick(|emoji| {
        let key = with_state(|s| s.reaction_bar.take().map(|(k, _)| k)).flatten();
        if let Some(key) = key {
            react_to(&key, &emoji);
        }
        render_overlays();
    });
    data.on_react_more(|| {
        let seq = with_state(|s| {
            let key = s.reaction_bar.take().map(|(k, _)| k)?;
            key.strip_prefix("seq:")?.parse::<i64>().ok()
        })
        .flatten();
        with_state(|s| {
            s.reaction_picker = seq;
            s.emoji_query.clear();
            s.emoji_tab = EmojiCategoryId::Recent;
        });
        render_emoji();
        render_overlays();
    });
    data.on_reaction_bar_closed(|| {
        with_state(|s| s.reaction_bar = None);
        render_overlays();
    });
    data.on_pill_toggled(|key, emoji| react_to(&key, &emoji));
    data.on_retry(|key| retry(&key));
    data.on_remove(|key| remove(&key));
    data.on_jump_to(|seq| jump_to(seq as i64));
    data.on_open_link(|url| open_link(&url));
    data.on_open_image(|key, id| {
        with_state(|s| s.lightbox = Some((key.to_string(), id.to_string())));
        render_overlays();
    });
    data.on_reveal_spoiler(|id| {
        with_state(|s| s.revealed.insert(id.to_string()));
        render_all();
    });
    data.on_message_menu(|key, x, y| message_menu(&key, x, y));
    data.on_scrolled(|from_bottom, from_top| scrolled(from_bottom, from_top));
    data.on_day_above(|key, above| {
        with_state(|s| {
            if above {
                s.view.days_above.insert(key.to_string());
            } else {
                s.view.days_above.remove(key.as_str());
            }
        });
        render_sticky();
    });
    data.on_revealed(|key, _, _| {
        with_state(|s| {
            s.view.flash = Some(key.to_string());
            let timer = slint::Timer::default();
            timer.start(
                slint::TimerMode::SingleShot,
                Duration::from_millis(chat::FLASH_DURATION_MS),
                || {
                    with_state(|s| s.view.flash = None);
                    render_overlays();
                },
            );
            s.view.flash_timer = Some(timer);
        });
        render_overlays();
    });
    data.on_jump_latest(|| {
        with_state(|s| s.view.new_since = None);
    });
    data.on_lightbox_closed(|| {
        with_state(|s| s.lightbox = None);
        render_overlays();
    });
    data.on_report_submit(submit_report);
    data.on_report_cancel(|| close_report(false));
    data.on_leaving_open_link(leaving_open);
    data.on_leaving_cancel(close_leaving);
    data.on_toast_dismissed(|| {
        if let Some(window) = self::window() {
            window.global::<ChatData>().set_report_sent(0);
        }
    });
    window
        .global::<ContextMenu>()
        .on_activated(|id| menu_activated(&id));
}

/// Window input the Slint tree doesn't see: presses outside a popover,
/// Escape, dropped files.
fn install_input_hooks(window: &ChatWindow) {
    if shell::headless() {
        return;
    }
    use slint::winit_030::{EventResult, WinitWindowAccessor, winit};
    let weak = window.as_weak();
    let cursor = std::cell::Cell::new((0.0f32, 0.0f32));
    window.window().on_winit_window_event(move |w, event| {
        let Some(chat) = weak.upgrade() else {
            return EventResult::Propagate;
        };
        match event {
            winit::event::WindowEvent::MouseWheel { delta, .. } => {
                let lines = matches!(delta, winit::event::MouseScrollDelta::LineDelta(..));
                let smooth = chat.global::<SmoothScroll>();
                smooth.set_lines(lines);
                smooth.set_wheel_scale(if lines {
                    crate::wheel_notch_px() / 60.0
                } else {
                    1.0
                });
            }
            winit::event::WindowEvent::CursorMoved { position, .. } => {
                let scale = w.scale_factor();
                cursor.set((position.x as f32 / scale, position.y as f32 / scale));
            }
            winit::event::WindowEvent::MouseInput {
                state: winit::event::ElementState::Pressed,
                ..
            } => {
                let (x, y) = cursor.get();
                pointer_pressed_at(x, y);
            }
            winit::event::WindowEvent::Focused(focused) => {
                with_state(|s| s.focused = *focused);
                if *focused {
                    social::set_focused(Kind::Chat);
                    social::flash(chat.window(), false);
                } else {
                    close_popovers();
                }
                schedule_mark_read();
            }
            winit::event::WindowEvent::HoveredFile(_) => {
                let can = with_state(|s| active_can_attach(s)).unwrap_or(false);
                if can {
                    chat.global::<ChatData>().set_dropping(true);
                }
            }
            winit::event::WindowEvent::HoveredFileCancelled => {
                chat.global::<ChatData>().set_dropping(false);
            }
            winit::event::WindowEvent::DroppedFile(path) => {
                chat.global::<ChatData>().set_dropping(false);
                let can = with_state(|s| active_can_attach(s)).unwrap_or(false);
                if can {
                    add_image_files(vec![path.clone()]);
                }
            }
            _ => {}
        }
        EventResult::Propagate
    });
}

fn active_can_attach(s: &State) -> bool {
    crate::features::enabled("CHAT_IMAGES")
        && s.active
            .as_ref()
            .and_then(|id| s.conversations.iter().find(|c| &c.friend.id == id))
            .is_some_and(|c| c.can_send && !c.friend.is_official)
}

/// The popovers close when the window loses focus.
fn close_popovers() {
    let changed = with_state(|s| {
        let had = s.reaction_bar.is_some() || s.reaction_picker.is_some();
        s.reaction_bar = None;
        s.reaction_picker = None;
        had
    })
    .unwrap_or(false);
    if let Some(window) = self::window() {
        let data = window.global::<ChatData>();
        if data.get_emoji_open() {
            data.set_emoji_open(false);
        }
    }
    if changed {
        render_overlays();
    }
}

fn open_game() {
    let path = with_state(|s| {
        let id = s.active.clone()?;
        let c = s.conversations.iter().find(|c| c.friend.id == id)?;
        let game = c.friend.current_game.as_ref()?;
        Some(format!(
            "/game/{}/{}?title={}",
            game.shop,
            game.object_id,
            urlencode(&game.title)
        ))
    })
    .flatten();
    if let Some(path) = path {
        social::focus_main_and_navigate(&path);
    }
}

fn urlencode(text: &str) -> String {
    reqwest::Url::parse_with_params("http://q/", &[("t", text)])
        .ok()
        .and_then(|u| u.query().map(|q| q.trim_start_matches("t=").to_string()))
        .unwrap_or_default()
}

fn toggle_picker() {
    let open = with_state(|s| {
        s.picker_open = !s.picker_open;
        s.picker_query.clear();
        s.picker_active = 0;
        if s.picker_open {
            s.picker_timer.start(
                slint::TimerMode::SingleShot,
                Duration::from_millis(chat::PICKER_SETTLE_MS),
                || {
                    if let Some(window) = self::window() {
                        window.global::<ChatData>().set_picker_settled(true);
                    }
                },
            );
        }
        s.picker_open
    })
    .unwrap_or(false);
    if let Some(window) = self::window() {
        window.global::<ChatData>().set_picker_settled(false);
    }
    if open {
        refresh_friends();
    }
    render_sidebar();
}

fn picker_rows(s: &State) -> Vec<UserFriend> {
    let query = s.picker_query.trim().to_lowercase();
    let mut matches: Vec<UserFriend> = s
        .friends
        .iter()
        .filter(|f| f.display_name.to_lowercase().contains(&query))
        .cloned()
        .collect();
    // online first, each group in the API's order
    matches.sort_by_key(|f| !f.online());
    matches
}

fn pick_friend(id: &str) {
    let friend = with_state(|s| s.friends.iter().find(|f| f.id == id).cloned()).flatten();
    let Some(friend) = friend else { return };
    with_state(|s| {
        if !s.conversations.iter().any(|c| c.friend.id == friend.id) {
            s.conversations
                .insert(0, ChatConversation::new(friend.clone()));
        }
        s.picker_open = false;
    });
    select(&friend.id);
}

fn picker_key(key: &str) -> bool {
    let down = key == "\u{f701}";
    let up = key == "\u{f700}";
    if down || up {
        with_state(|s| {
            let count = picker_rows(s).len() as i32;
            let next = s.picker_active + if down { 1 } else { -1 };
            s.picker_active = next.clamp(0, (count - 1).max(0));
        });
        render_sidebar();
        return true;
    }
    if key == "\n" || key == "\r" {
        let id = with_state(|s| {
            let rows = picker_rows(s);
            rows.get(s.picker_active.max(0) as usize)
                .map(|f| f.id.clone())
        })
        .flatten();
        if let Some(id) = id {
            pick_friend(&id);
        }
        return true;
    }
    false
}

fn resize_sidebar(width: f32) {
    let Some(window) = self::window() else { return };
    let data = window.global::<ChatData>();
    let window_width = window
        .window()
        .size()
        .to_logical(window.window().scale_factor())
        .width;
    let clamped = chat::clamp_chat_sidebar_width(width as f64, window_width as f64) as f32;
    with_state(|s| s.sidebar_width = clamped);
    data.set_sidebar_width(clamped);
    if !data.get_resizing() {
        shell::storage_set(chat::CHAT_SIDEBAR_WIDTH_STORAGE_KEY, &clamped.to_string());
    }
}

fn draft_edited(text: &str) {
    let Some(id) = with_state(|s| s.active.clone()).flatten() else {
        return;
    };
    update(&id, |c| c.draft = text.to_string());
    notify_typing(&id, text);
    render_composer();
    render_sidebar();
}

/// handleSend: over the limit shakes; otherwise sends when there is something.
fn try_send() {
    let Some((too_long, can_send)) = with_state(|s| {
        let id = s.active.clone()?;
        let c = s.conversations.iter().find(|c| c.friend.id == id)?;
        let text = chat::time::js_trim(&c.draft);
        let too_long = chat::get_overflow_range(&c.draft).is_some();
        let preparing = s.preparing.get(&id).copied().unwrap_or(0);
        let can = c.can_send && (!text.is_empty() || !c.draft_images.is_empty()) && preparing == 0;
        Some((too_long, can))
    })
    .flatten() else {
        return;
    };
    if too_long {
        reject_send();
        return;
    }
    if can_send {
        send();
    }
}

fn composer_key(text: SharedString, shift: bool) -> bool {
    let text = text.as_str();
    if text == "\u{1b}" {
        let has_reply = with_state(|s| {
            let id = s.active.clone()?;
            s.conversations
                .iter()
                .find(|c| c.friend.id == id)
                .map(|c| c.reply_to_seq.is_some())
        })
        .flatten()
        .unwrap_or(false);
        if has_reply {
            set_reply(None);
            return true;
        }
        return false;
    }
    if (text == "\n" || text == "\r") && !shift {
        try_send();
        return true;
    }
    false
}

/// Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+T, and Escape for the open layers.
fn window_key(text: SharedString, control: bool, shift: bool, alt: bool) -> bool {
    let text = text.as_str();
    let ctrl = control && !alt;
    if ctrl && text == "\t" {
        let dialog =
            with_state(|s| s.report_seq.is_some() || s.leaving_url.is_some()).unwrap_or(false);
        if dialog {
            return false;
        }
        let next = with_state(|s| {
            let order = chat::conversation_order_by_activity(&s.conversations);
            let ids: Vec<String> = order
                .into_iter()
                .map(|i| s.conversations[i].friend.id.clone())
                .collect();
            chat::get_adjacent_conversation_id(
                &ids,
                s.active.as_deref(),
                if shift { -1 } else { 1 },
            )
        })
        .flatten();
        if let Some(next) = next {
            select(&next);
        }
        return true;
    }
    if ctrl && !shift && text.eq_ignore_ascii_case("t") {
        toggle_picker();
        return true;
    }
    if text == "\u{1b}" {
        let layer = with_state(|s| {
            if s.lightbox.is_some() {
                s.lightbox = None;
                return 1;
            }
            if s.report_seq.is_some() {
                return 2;
            }
            if s.leaving_url.is_some() {
                return 3;
            }
            if s.reaction_bar.is_some() || s.reaction_picker.is_some() {
                s.reaction_bar = None;
                s.reaction_picker = None;
                return 4;
            }
            if s.picker_open {
                s.picker_open = false;
                return 5;
            }
            0
        })
        .unwrap_or(0);
        match layer {
            1 | 4 => render_overlays(),
            2 => close_report(false),
            3 => close_leaving(),
            5 => render_sidebar(),
            _ => {
                if let Some(window) = self::window() {
                    let data = window.global::<ChatData>();
                    if data.get_emoji_open() {
                        close_emoji();
                        return true;
                    }
                    let popup = window.global::<Popup>();
                    if popup.get_open() != "" {
                        popup.set_open("".into());
                        return true;
                    }
                }
                return false;
            }
        }
        return true;
    }
    false
}

fn set_reply(seq: Option<i64>) {
    if let Some(id) = with_state(|s| s.active.clone()).flatten() {
        update(&id, |c| c.reply_to_seq = seq);
    }
    if let Some(window) = self::window() {
        let data = window.global::<ChatData>();
        data.set_focus_composer(data.get_focus_composer() + 1);
    }
    render_all();
}

/// insertEmoji at the caret (the end when the caret is unknown).
fn emoji_picked(emoji: &str) {
    let reaction = with_state(|s| s.reaction_picker).flatten();
    if let Some(seq) = reaction {
        react_to(&format!("seq:{seq}"), emoji);
        with_state(|s| s.reaction_picker = None);
        render_overlays();
        return;
    }
    remember_emoji(emoji);
    if let Some(id) = with_state(|s| s.active.clone()).flatten() {
        let draft = update(&id, |c| {
            c.draft.push_str(emoji);
            c.draft.clone()
        })
        .unwrap_or_default();
        notify_typing(&id, &draft);
    }
    render_composer();
}

fn close_emoji() {
    let reaction = with_state(|s| s.reaction_picker.take().is_some()).unwrap_or(false);
    if reaction {
        render_overlays();
        return;
    }
    if let Some(window) = self::window() {
        let data = window.global::<ChatData>();
        data.set_emoji_open(false);
        data.set_focus_composer(data.get_focus_composer() + 1);
    }
}

fn jump_to(seq: i64) {
    let key = format!("seq:{seq}");
    let loaded = with_state(|s| {
        let id = s.active.clone()?;
        let c = s.conversations.iter().find(|c| c.friend.id == id)?;
        Some((id, c.messages.iter().any(|m| m.seq == Some(seq))))
    })
    .flatten();
    match loaded {
        Some((_, true)) => reveal(&key),
        Some((id, false)) => load_through(&id, seq),
        None => {}
    }
}

/// revealMessage: scroll it to the middle and flash it.
fn reveal(key: &str) {
    if let Some(window) = self::window() {
        let data = window.global::<ChatData>();
        data.set_reveal_key(key.into());
        data.set_reveal_request(data.get_reveal_request() + 1);
    }
}

/// openLink: trusted https hosts open right away, others ask first.
fn open_link(url: &str) {
    let hosts = chat::parse_trusted_hosts(
        shell::storage_get(chat::TRUSTED_LINK_HOSTS_STORAGE_KEY).as_deref(),
    );
    if chat::is_trusted_link(url, &hosts) {
        crate::settings_debrid::open_url(url);
        return;
    }
    with_state(|s| s.leaving_url = Some(url.to_string()));
    if let Some(window) = self::window() {
        let data = window.global::<ChatData>();
        let parsed = chat::parse_web_url(url);
        data.set_leaving_host(
            parsed
                .as_ref()
                .and_then(|u| u.host_str())
                .unwrap_or_default()
                .into(),
        );
        data.set_leaving_url(url.into());
        data.set_leaving_insecure(url.starts_with("http:"));
        data.set_leaving_trust(false);
        let host = parsed
            .as_ref()
            .and_then(|u| u.host_str())
            .unwrap_or_default();
        data.set_leaving_trust_label(strong_parts(&shell::tr_with(
            "chat_window.leaving_trust_host",
            &[("host", host.to_string().into())],
        )));
        data.set_leaving_closing(false);
        data.set_leaving_open(true);
    }
}

fn leaving_open() {
    let Some(window) = self::window() else { return };
    let data = window.global::<ChatData>();
    let url = data.get_leaving_url().to_string();
    if data.get_leaving_trust() && !url.starts_with("http:") {
        let mut hosts = chat::parse_trusted_hosts(
            shell::storage_get(chat::TRUSTED_LINK_HOSTS_STORAGE_KEY).as_deref(),
        );
        if chat::trust_link_host(&mut hosts, data.get_leaving_host().as_str()) {
            shell::storage_set(
                chat::TRUSTED_LINK_HOSTS_STORAGE_KEY,
                &serde_json::to_string(&hosts).unwrap_or_default(),
            );
        }
    }
    crate::settings_debrid::open_url(&url);
    close_leaving();
}

/// The dialog animates out (200ms) before it goes.
fn close_leaving() {
    if let Some(window) = self::window() {
        window.global::<ChatData>().set_leaving_closing(true);
    }
    with_state(|s| {
        s.leaving_timer.start(
            slint::TimerMode::SingleShot,
            Duration::from_millis(200),
            || {
                with_state(|s| s.leaving_url = None);
                if let Some(window) = self::window() {
                    window.global::<ChatData>().set_leaving_open(false);
                }
            },
        )
    });
}

// ---- the message menu and reports --------------------------------------------

fn message_menu(key: &str, x: f32, y: f32) {
    let Some((friend_id, message)) = active_message(key) else {
        return;
    };
    let Some(window) = self::window() else { return };
    let (can_act, can_report) = with_state(|s| {
        let c = s.conversations.iter().find(|c| c.friend.id == friend_id);
        let can_reply = c.is_some_and(|c| c.can_send && !c.friend.is_official);
        let reportable = c.is_some_and(|c| !c.friend.is_official);
        (
            can_reply
                && message.seq.is_some()
                && message.status == ChatMessageStatus::Sent
                && !message.is_hidden,
            reportable && !message.from_me && message.seq.is_some() && !message.is_hidden,
        )
    })
    .unwrap_or((false, false));
    let mut items = Vec::new();
    let entry = |id: &str, label: &str, icon: &str, danger: bool| MenuEntry {
        id: id.into(),
        label: label.into(),
        icon: icon.into(),
        disabled: false,
        danger,
        danger_border: false,
        separator: false,
        children: ModelRc::default(),
    };
    if can_act {
        items.push(entry(
            "react",
            &shell::tr("chat_window.add_reaction"),
            "smiley",
            false,
        ));
        items.push(entry(
            "reply",
            &shell::tr("chat_window.reply"),
            "reply",
            false,
        ));
    }
    if can_report {
        let mut report = entry(
            "report",
            &shell::tr("chat_window.report_message"),
            "report",
            true,
        );
        // the menu draws a line above danger items, unless it is the only one
        report.danger_border = can_act;
        items.push(report);
    }
    if items.is_empty() {
        return;
    }
    with_state(|s| {
        s.menu_key = Some(key.to_string());
        s.reaction_bar = None;
    });
    let menu = window.global::<ContextMenu>();
    menu.set_items(ModelRc::new(VecModel::from(items)));
    menu.set_x(x);
    menu.set_y(y);
    menu.set_generation(menu.get_generation() + 1);
    window.global::<Popup>().set_open("context-menu".into());
    render_overlays();
}

fn menu_activated(id: &str) {
    let Some(window) = self::window() else { return };
    window.global::<Popup>().set_open("".into());
    let Some(key) = with_state(|s| s.menu_key.take()).flatten() else {
        return;
    };
    match id {
        "react" => {
            // openReactionBar: the bar over that message
            if let Some(window) = self::window() {
                let data = window.global::<ChatData>();
                with_state(|s| s.reaction_bar = Some((key.clone(), false)));
                data.set_reaction_bar_key(key.as_str().into());
            }
            render_overlays();
        }
        "reply" => {
            if let Some((_, message)) = active_message(&key) {
                set_reply(message.seq);
            }
        }
        "report" => {
            if let Some(seq) = key.strip_prefix("seq:").and_then(|s| s.parse().ok()) {
                with_state(|s| s.report_seq = Some(seq));
                let data = window.global::<ChatData>();
                data.set_report_reason("".into());
                data.set_report_details("".into());
                data.set_report_error("".into());
                data.set_report_sending(false);
                data.set_report_closing(false);
                data.set_report_open(true);
            }
        }
        _ => {}
    }
}

fn submit_report() {
    let Some(window) = self::window() else { return };
    let data = window.global::<ChatData>();
    let reason = data.get_report_reason().to_string();
    if reason.is_empty() || data.get_report_sending() {
        return;
    }
    let details = chat::time::js_trim(&data.get_report_details()).to_string();
    let Some((friend_id, seq)) = with_state(|s| Some((s.active.clone()?, s.report_seq?))).flatten()
    else {
        return;
    };
    data.set_report_sending(true);
    data.set_report_error("".into());
    let mut body = json!({ "reason": reason });
    if !details.is_empty() {
        body["description"] = json!(details);
    }
    let path = chat::chat_path(&friend_id, &format!("messages/{seq}/report"));
    social::spawn(
        move || {
            social::write("report chat message", |api| {
                api.post(&path, &body, Options::default())
            })
        },
        move |result| {
            let Some(window) = self::window() else { return };
            let data = window.global::<ChatData>();
            match result {
                Ok(_) => close_report(true),
                Err(error) => {
                    data.set_report_sending(false);
                    let kind = chat::get_report_error_kind(&error_text(&error));
                    data.set_report_error(
                        match kind {
                            chat::ChatReportErrorKind::RateLimited => "rate_limited",
                            _ => "failed",
                        }
                        .into(),
                    );
                }
            }
        },
    );
}

/// The dialog animates out (200ms); a sent report shows the confirmation.
fn close_report(sent: bool) {
    let Some(window) = self::window() else { return };
    let data = window.global::<ChatData>();
    if data.get_report_sending() && !sent {
        return;
    }
    data.set_report_closing(true);
    with_state(|s| {
        s.report_timer.start(
            slint::TimerMode::SingleShot,
            Duration::from_millis(200),
            move || {
                with_state(|s| s.report_seq = None);
                let Some(window) = self::window() else { return };
                let data = window.global::<ChatData>();
                data.set_report_open(false);
                if sent {
                    data.set_report_sent(data.get_report_sent() + 1);
                    with_state(|s| {
                        s.report_sent_timer.start(
                            slint::TimerMode::SingleShot,
                            Duration::from_millis(chat::REPORT_SENT_DURATION_MS),
                            || {
                                if let Some(window) = self::window() {
                                    window.global::<ChatData>().set_report_sent(0);
                                }
                            },
                        )
                    });
                }
            },
        )
    });
}

// ---- images --------------------------------------------------------------------

/// The image button: a file dialog for images.
fn add_images() {
    let files = rfd::FileDialog::new()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
        .pick_files()
        .unwrap_or_default();
    add_image_files(files);
}

/// addImages: picked, pasted or dropped files, prepared off the UI thread
/// (stills redrawn upright as JPEG at most 1568px, GIFs as they are).
fn add_image_files(files: Vec<std::path::PathBuf>) {
    let Some((friend_id, held)) = with_state(|s| {
        let id = s.active.clone()?;
        let c = s.conversations.iter().find(|c| c.friend.id == id)?;
        if !c.can_send {
            return None;
        }
        let held = c.draft_images.len() + s.preparing.get(&id).copied().unwrap_or(0);
        Some((id, held))
    })
    .flatten() else {
        return;
    };
    let typed: Vec<(std::path::PathBuf, String)> = files
        .into_iter()
        .map(|path| {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or_default()
                .to_lowercase();
            let kind = match ext.as_str() {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "bmp" => "image/bmp",
                _ => "application/octet-stream",
            };
            (path, kind.to_string())
        })
        .collect();
    let (picked, error) = chat::select_image_files(typed, held, |(_, kind)| kind.as_str());
    if let Some(error) = error {
        set_image_note(error);
    }
    for (path, kind) in picked {
        with_state(|s| *s.preparing.entry(friend_id.clone()).or_default() += 1);
        let id = friend_id.clone();
        social::spawn(
            move || prepare_image(&path, &kind),
            move |prepared| {
                with_state(|s| {
                    if let Some(count) = s.preparing.get_mut(&id) {
                        *count = count.saturating_sub(1);
                    }
                });
                match prepared {
                    Ok(image) => {
                        let fits = update(&id, |c| {
                            chat::fits_message_budget(&c.draft_images, image.size())
                        })
                        .unwrap_or(false);
                        if !fits {
                            set_image_note(chat::ChatDraftImageError::TooLarge);
                        } else {
                            update(&id, |c| c.draft_images.push(image));
                        }
                    }
                    Err(error) => set_image_note(error),
                }
                render_composer();
            },
        );
    }
    if let Some(window) = self::window() {
        let data = window.global::<ChatData>();
        data.set_focus_composer(data.get_focus_composer() + 1);
    }
    render_composer();
}

fn prepare_image(
    path: &std::path::Path,
    content_type: &str,
) -> Result<chat::ChatDraftImage, chat::ChatDraftImageError> {
    use chat::ChatDraftImageError as E;
    let bytes = std::fs::read(path).map_err(|_| E::Unreadable)?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    let id = uuid();
    if chat::is_gif(content_type) {
        if bytes.len() > chat::CHAT_GIF_MAX_BYTES {
            return Err(E::GifTooLarge);
        }
        let image = image::load_from_memory(&bytes).map_err(|_| E::Unreadable)?;
        return Ok(chat::ChatDraftImage {
            id,
            name,
            content_type: "image/gif".into(),
            width: image.width(),
            height: image.height(),
            url: path.display().to_string(),
            bytes: bytes.into(),
            spoiler: false,
        });
    }
    let decoder = image::ImageReader::new(std::io::Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|_| E::Unreadable)?;
    let mut decoder = decoder.into_decoder().map_err(|_| E::Unreadable)?;
    use image::ImageDecoder;
    let orientation = decoder.orientation().ok();
    let mut image = image::DynamicImage::from_decoder(decoder).map_err(|_| E::Unreadable)?;
    if let Some(orientation) = orientation {
        image.apply_orientation(orientation);
    }
    let (width, height) =
        chat::fit_within(image.width(), image.height(), chat::CHAT_IMAGE_MAX_SIDE);
    let resized = image.resize_exact(width, height, image::imageops::FilterType::Lanczos3);
    // JPEG has no alpha: transparent pixels land on the chat's background
    let mut backdrop =
        image::RgbaImage::from_pixel(width, height, image::Rgba([0x12, 0x12, 0x12, 0xff]));
    image::imageops::overlay(&mut backdrop, &resized.to_rgba8(), 0, 0);
    let canvas = image::DynamicImage::ImageRgba8(backdrop).to_rgb8();
    for quality in [85u8, 75, 65, 50] {
        let mut out = Vec::new();
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
        if canvas.write_with_encoder(encoder).is_ok() && out.len() <= chat::CHAT_STILL_MAX_BYTES {
            return Ok(chat::ChatDraftImage {
                id,
                name,
                content_type: "image/jpeg".into(),
                width,
                height,
                url: format!("memory:{}", uuid()),
                bytes: out.into(),
                spoiler: false,
            });
        }
    }
    Err(E::TooLarge)
}

fn set_image_note(error: chat::ChatDraftImageError) {
    with_state(|s| {
        s.image_note = Some(error);
        s.image_note_timer.start(
            slint::TimerMode::SingleShot,
            Duration::from_millis(chat::IMAGE_NOTE_DURATION_MS),
            || {
                with_state(|s| s.image_note = None);
                render_composer();
            },
        );
    });
    render_composer();
}

fn picture(key: &str) -> Image {
    with_state(|s| s.images.get(key).cloned())
        .flatten()
        .unwrap_or_default()
}

/// Loads a picture once (by "<kind>:<url>"); renders when it lands.
fn load_picture(key: String, source: hydra_media::images::Source, op: Op) {
    let start = with_state(|s| {
        if s.images.contains_key(&key) || s.pending_images.contains(&key) {
            return false;
        }
        s.pending_images.insert(key.clone());
        true
    })
    .unwrap_or(false);
    if !start {
        return;
    }
    let Some((loader, _)) = shell::loader() else {
        return;
    };
    loader.load(source, op, move |image| {
        with_state(|s| s.images.insert(key, image));
        render_all();
    });
}

fn picture_of(url: &Option<String>, kind: &str, op: Op) -> Image {
    let Some(url) = url.as_ref().filter(|u| u.starts_with("http")) else {
        return Image::default();
    };
    let key = format!("{kind}:{url}");
    let image = picture(&key);
    if image.size().width == 0 {
        load_picture(key, url.clone().into(), op);
    }
    image
}

/// A draft image: decoded from its bytes once.
fn draft_picture(image: &chat::ChatDraftImage, blurred: bool, scale: f32) -> Image {
    let key = format!("draft{}:{}", if blurred { "-blur" } else { "" }, image.id);
    let cached = picture(&key);
    if cached.size().width > 0 {
        return cached;
    }
    let started = with_state(|s| s.pending_images.insert(key.clone())).unwrap_or(false);
    if !started {
        return cached;
    }
    let bytes = image.bytes.clone();
    let size = (72.0 * scale).ceil() as u32;
    social::spawn(
        move || {
            let op = if blurred {
                Op::CoverBlur {
                    width: size,
                    height: size,
                    sigma: 8.0 * scale,
                    pad: 0,
                    darken: 0.55,
                    background: Some([0x12, 0x12, 0x12]),
                }
            } else {
                Op::Cover {
                    width: size,
                    height: size,
                }
            };
            hydra_media::images::decode_bytes(&bytes, op).map(|p| match p {
                hydra_media::images::Pixels::Rgb(b) => {
                    (b.width(), b.height(), b.as_bytes().to_vec(), false)
                }
                hydra_media::images::Pixels::Rgba(b) => {
                    (b.width(), b.height(), b.as_bytes().to_vec(), true)
                }
            })
        },
        move |pixels| {
            if let Some((w, h, data, alpha)) = pixels {
                let image = if alpha {
                    Image::from_rgba8(slint::SharedPixelBuffer::clone_from_slice(&data, w, h))
                } else {
                    Image::from_rgb8(slint::SharedPixelBuffer::clone_from_slice(&data, w, h))
                };
                with_state(|s| s.images.insert(key, image));
                render_composer();
            }
        },
    );
    cached
}

// ---- dates (chat-sidebar.tsx usePreviewTime, chat-message-list.tsx) -------------

const WEEKDAYS_EN: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_EN: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

fn language() -> String {
    shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into())
}

/// Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" })
fn time_label(ms: i64) -> String {
    let english = language().starts_with("en");
    hydra_i18n::date::format_pattern(ms, if english { "hh:mm a" } else { "HH:mm" })
}

fn local(ms: i64) -> chrono::DateTime<chrono::Local> {
    use chrono::TimeZone;
    chrono::Local
        .timestamp_millis_opt(ms)
        .single()
        .unwrap_or_else(chrono::Local::now)
}

/// { month: "short", day: "numeric" }
fn short_date(ms: i64) -> String {
    use chrono::Datelike;
    let d = local(ms);
    if language().starts_with("en") {
        format!("{} {}", MONTHS_EN[d.month0() as usize], d.day())
    } else {
        format!("{:02}/{:02}", d.day(), d.month())
    }
}

fn start_of_today() -> i64 {
    let now = chrono::Local::now();
    now.date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|d| d.and_local_timezone(chrono::Local).single())
        .map_or(now_ms(), |d| d.timestamp_millis())
}

/// "14:32" today, "Yesterday", a weekday within the week, else a short date.
fn preview_time(created_at: &str) -> String {
    use chrono::Datelike;
    let Some(ms) = chat::time::parse_ms(created_at) else {
        return String::new();
    };
    let today = start_of_today();
    if ms >= today {
        return time_label(ms);
    }
    let days_ago = (today - ms).div_euclid(DAY_MS) + 1;
    if days_ago == 1 {
        return shell::tr("chat_window.yesterday");
    }
    if days_ago < chat::WEEKDAY_LABEL_DAYS {
        if language().starts_with("en") {
            return WEEKDAYS_EN[local(ms).weekday().num_days_from_sunday() as usize].into();
        }
        return short_date(ms);
    }
    short_date(ms)
}

/// getDayLabel: Today, Yesterday, else a short date.
fn day_label(date: Option<chrono::NaiveDate>) -> String {
    let Some(date) = date else {
        return String::new();
    };
    let today = chrono::Local::now().date_naive();
    if date == today {
        return shell::tr("chat_window.today");
    }
    if Some(date) == today.pred_opt() {
        return shell::tr("chat_window.yesterday");
    }
    use chrono::Datelike;
    if language().starts_with("en") {
        format!("{} {}", MONTHS_EN[date.month0() as usize], date.day())
    } else {
        format!("{:02}/{:02}", date.day(), date.month())
    }
}

// ---- rendering --------------------------------------------------------------

fn render_all() {
    render_sidebar();
    render_header();
    render_items();
    render_composer();
    render_overlays();
}

fn active_conversation(s: &State) -> Option<&ChatConversation> {
    let id = s.active.as_ref()?;
    s.conversations.iter().find(|c| &c.friend.id == id)
}

fn render_sidebar() {
    let Some(window) = self::window() else { return };
    let scale = window.window().scale_factor();
    let data = window.global::<ChatData>();
    let Some((
        rows,
        visible,
        count,
        picker,
        picker_open,
        query,
        picker_query,
        picker_active,
        width,
        no_friends,
    )) = with_state(|s| {
        let order = chat::conversation_order_by_activity(&s.conversations);
        let mut rank = vec![-1i32; s.conversations.len()];
        let mut visible = 0;
        for index in order {
            let c = &s.conversations[index];
            if chat::matches_conversation_query(&c.friend.display_name, &s.query) {
                rank[index] = visible;
                visible += 1;
            }
        }
        let rows: Vec<(ChatConversation, i32, bool)> = s
            .conversations
            .iter()
            .enumerate()
            .map(|(i, c)| {
                (
                    c.clone(),
                    rank[i],
                    s.active.as_deref() == Some(c.friend.id.as_str()),
                )
            })
            .collect();
        let open: HashSet<String> = s
            .conversations
            .iter()
            .map(|c| c.friend.id.clone())
            .collect();
        let picker: Vec<(UserFriend, bool)> = picker_rows(s)
            .into_iter()
            .map(|f| {
                let open = open.contains(&f.id);
                (f, open)
            })
            .collect();
        (
            rows,
            visible,
            s.conversations.len(),
            picker,
            s.picker_open,
            s.query.clone(),
            s.picker_query.clone(),
            s.picker_active,
            s.sidebar_width,
            s.friends.is_empty(),
        )
    })
    else {
        return;
    };
    let you = shell::tr("chat_window.you");
    let avatar_op = || Op::MaxWidth((40.0 * scale).ceil() as u32);
    let rows: Vec<ChatConversationRow> = rows
        .into_iter()
        .map(|(c, order, active)| {
            let preview = chat::get_conversation_preview(&c);
            let (kind, text) = match preview {
                None => ("", String::new()),
                Some(ChatConversationPreview::Removed) => {
                    ("removed", shell::tr("chat_window.message_removed"))
                }
                Some(ChatConversationPreview::Text { text, from_me }) => (
                    "text",
                    if from_me {
                        format!("{you}: {text}")
                    } else {
                        text
                    },
                ),
                Some(ChatConversationPreview::Images { count, from_me }) => {
                    let images = social::tr_count(
                        "chat_window.quoted_images",
                        count as f64,
                        &[("count", count.to_string().into())],
                    );
                    (
                        "images",
                        if from_me {
                            format!("{you}: {images}")
                        } else {
                            images
                        },
                    )
                }
            };
            // the official account is neither online nor offline
            let (kind, text) = if kind.is_empty() && c.friend.is_official {
                ("official", shell::tr("chat_window.official_subtitle"))
            } else {
                (kind, text)
            };
            let game = c.friend.current_game.clone();
            ChatConversationRow {
                id: c.friend.id.as_str().into(),
                name: c.friend.display_name.as_str().into(),
                avatar: picture_of(&c.friend.profile_image_url, "avatar", avatar_op()),
                official: c.friend.is_official,
                online: c.friend.online(),
                time: chat::get_latest_message(&c)
                    .map(|m| preview_time(&m.created_at))
                    .unwrap_or_default()
                    .into(),
                preview_kind: kind.into(),
                preview: text.into(),
                game: game
                    .as_ref()
                    .map(|g| g.title.as_str())
                    .unwrap_or_default()
                    .into(),
                game_icon: game
                    .as_ref()
                    .map(|g| {
                        picture_of(
                            &g.icon_url,
                            "icon",
                            Op::MaxWidth((14.0 * scale).ceil() as u32),
                        )
                    })
                    .unwrap_or_default(),
                game_has_icon: game
                    .as_ref()
                    .is_some_and(|g| g.icon_url.as_ref().is_some_and(|u| !u.is_empty())),
                typing: c.is_typing,
                unread: c.unread_count as i32,
                active,
                order,
            }
        })
        .collect();
    sync_rows(&with_state(|s| s.rows.clone()).unwrap(), rows, |a, b| {
        a.id == b.id
    });
    let (bw, bh) = chat::FRIEND_BACKGROUND_IMAGE_SIZE;
    let query_lower = picker_query.trim().to_lowercase();
    let pickers: Vec<ChatPickerRow> = picker
        .into_iter()
        .map(|(f, open)| {
            let (before, matched, after) = split_match(&f.display_name, &query_lower);
            let game = f.current_game.clone();
            ChatPickerRow {
                id: f.id.as_str().into(),
                name: f.display_name.as_str().into(),
                before: before.into(),
                r#match: matched.into(),
                after: after.into(),
                avatar: picture_of(
                    &f.profile_image_url,
                    "avatar",
                    Op::MaxWidth((32.0 * scale).ceil() as u32),
                ),
                banner: if picker_open {
                    picture_of(
                        &f.background_image_url,
                        "banner",
                        Op::Cover {
                            width: bw,
                            height: bh,
                        },
                    )
                } else {
                    Image::default()
                },
                online: f.online(),
                game: game
                    .as_ref()
                    .map(|g| g.title.as_str())
                    .unwrap_or_default()
                    .into(),
                game_icon: game
                    .as_ref()
                    .map(|g| {
                        picture_of(
                            &g.icon_url,
                            "icon",
                            Op::MaxWidth((14.0 * scale).ceil() as u32),
                        )
                    })
                    .unwrap_or_default(),
                game_has_icon: game
                    .as_ref()
                    .is_some_and(|g| g.icon_url.as_ref().is_some_and(|u| !u.is_empty())),
                open,
            }
        })
        .collect();
    sync_rows(
        &with_state(|s| s.pickers.clone()).unwrap(),
        pickers,
        |a, b| a.id == b.id,
    );
    data.set_visible_count(visible);
    data.set_conversation_count(count as i32);
    data.set_picker_open(picker_open);
    data.set_query(query.into());
    data.set_picker_query(picker_query.into());
    data.set_picker_active(picker_active);
    data.set_sidebar_width(width);
    data.set_no_friends(no_friends);
}

/// highlightMatch: the name split around the (lowercased) query.
fn split_match(name: &str, query: &str) -> (String, String, String) {
    if query.is_empty() {
        return (name.to_string(), String::new(), String::new());
    }
    let lower = name.to_lowercase();
    match lower.find(query) {
        Some(start) if lower.len() == name.len() => {
            let end = start + query.len();
            (
                name[..start].to_string(),
                name[start..end].to_string(),
                name[end..].to_string(),
            )
        }
        _ => (name.to_string(), String::new(), String::new()),
    }
}

/// Keeps rows in place (and their hover state) when their ids line up.
fn sync_rows<T: Clone + PartialEq + 'static>(
    model: &VecModel<T>,
    rows: Vec<T>,
    same: impl Fn(&T, &T) -> bool,
) {
    let aligned = model.row_count() == rows.len()
        && model.iter().zip(&rows).all(|(old, new)| same(&old, new));
    if aligned {
        for (i, row) in rows.into_iter().enumerate() {
            if model.row_data(i).as_ref() != Some(&row) {
                model.set_row_data(i, row);
            }
        }
    } else {
        model.set_vec(rows);
    }
}

fn render_header() {
    let Some(window) = self::window() else { return };
    let scale = window.window().scale_factor();
    let data = window.global::<ChatData>();
    let active = with_state(|s| active_conversation(s).cloned()).flatten();
    let Some(c) = active else {
        data.set_has_active(false);
        return;
    };
    let game = c.friend.current_game.clone();
    data.set_has_active(true);
    data.set_active_id(c.friend.id.as_str().into());
    data.set_active_name(c.friend.display_name.as_str().into());
    data.set_active_avatar(picture_of(
        &c.friend.profile_image_url,
        "avatar",
        Op::MaxWidth((40.0 * scale).ceil() as u32),
    ));
    data.set_active_official(c.friend.is_official);
    data.set_active_online(c.friend.online());
    let (bw, bh) = chat::FRIEND_BACKGROUND_IMAGE_SIZE;
    data.set_active_banner(picture_of(
        &c.friend.background_image_url,
        "banner",
        Op::Cover {
            width: bw,
            height: bh,
        },
    ));
    data.set_active_game(
        game.as_ref()
            .map(|g| g.title.as_str())
            .unwrap_or_default()
            .into(),
    );
    data.set_active_game_icon(
        game.as_ref()
            .map(|g| {
                picture_of(
                    &g.icon_url,
                    "icon",
                    Op::MaxWidth((14.0 * scale).ceil() as u32),
                )
            })
            .unwrap_or_default(),
    );
    data.set_active_game_has_icon(
        game.as_ref()
            .is_some_and(|g| g.icon_url.as_ref().is_some_and(|u| !u.is_empty())),
    );
    data.set_active_typing(c.is_typing);
    data.set_can_send(c.can_send);
    let state = match c.load_state {
        ChatLoadState::Error if c.messages.is_empty() => "error",
        ChatLoadState::Loaded if c.messages.is_empty() => "empty",
        _ if !c.messages.is_empty() => "loaded",
        _ => "loading",
    };
    data.set_pane_state(state.into());
}

/// The message as StyledText markdown: plain text escaped, links clickable,
/// line breaks and leading spaces kept.
fn styled(text: &str) -> (slint::StyledText, bool) {
    let parts = chat::split_message_links(text);
    let has_links = parts.iter().any(|p| matches!(p, ChatTextPart::Link { .. }));
    if !has_links {
        return (slint::StyledText::default(), false);
    }
    let escape = |text: &str| -> String {
        let mut out = String::new();
        let mut line_start = true;
        for ch in text.chars() {
            match ch {
                '\n' => {
                    out.push_str("  \n");
                    line_start = true;
                    continue;
                }
                ' ' if line_start => out.push('\u{a0}'),
                c if c.is_ascii_punctuation() => {
                    out.push('\\');
                    out.push(c);
                }
                c => out.push(c),
            }
            line_start = false;
        }
        out
    };
    let mut markdown = String::new();
    for part in parts {
        match part {
            ChatTextPart::Text(text) => markdown.push_str(&escape(&text)),
            ChatTextPart::Link { text, url } => {
                markdown.push('[');
                markdown.push_str(&escape(&text));
                markdown.push_str("](<");
                markdown.push_str(&url.replace('>', "%3E"));
                markdown.push_str(">)");
            }
        }
    }
    (
        slint::StyledText::from_markdown(&markdown)
            .unwrap_or_else(|_| slint::StyledText::from_plain_text(text)),
        true,
    )
}

fn render_items() {
    let Some(window) = self::window() else { return };
    let scale = window.window().scale_factor();
    let Some(plan) = with_state(|s| {
        let c = active_conversation(s)?.clone();
        Some((
            c,
            s.view.away_from.clone(),
            s.view.new_since.clone(),
            s.view.initial.clone(),
            s.revealed.clone(),
        ))
    })
    .flatten() else {
        with_state(|s| s.items.set_vec(Vec::new()));
        return;
    };
    let (c, away_from, new_since, initial, revealed) = plan;
    let friend_id = c.friend.id.clone();
    let friend_name = c.friend.display_name.clone();
    let official = c.friend.is_official;
    let can_reply = c.can_send && !official;
    let first_new = new_since
        .as_ref()
        .and_then(|id| chat::find_first_friend_message_after(&c.messages, id))
        .map(|m| m.id.clone());
    let jump_count = away_from
        .as_ref()
        .map(|id| chat::count_friend_messages_after(&c.messages, id))
        .unwrap_or(0);
    let days = chat::group_chat_messages(&c.messages, first_new.as_deref());
    let you = shell::tr("chat_window.you");
    let mut items: Vec<ChatItem> = Vec::new();
    let mut first_item = true;
    let mut gap = |items_len: usize| -> f32 {
        let _ = items_len;
        if first_item {
            first_item = false;
            0.0
        } else {
            12.0
        }
    };
    for day in &days {
        items.push(ChatItem {
            kind: "day".into(),
            key: format!("day:{}", day.key).into(),
            label: day_label(day.date).into(),
            gap: gap(items.len()),
            ..Default::default()
        });
        for group in &day.groups {
            if Some(&group.key) == first_new.as_ref() {
                items.push(ChatItem {
                    kind: "new".into(),
                    key: "new".into(),
                    gap: gap(items.len()),
                    ..Default::default()
                });
            }
            let count = group.messages.len();
            let mut group_gap = gap(items.len());
            for (position, &index) in group.messages.iter().enumerate() {
                let m = &c.messages[index];
                let entering = !initial.contains(&m.id) && !m.from_history;
                let has_images = m.attachment_count() > 0;
                let emoji = if m.reply_to.is_some() || has_images {
                    0
                } else {
                    match chat::count_emoji_only(&m.text) {
                        0 => 0,
                        n if n <= chat::LARGE_EMOJI_MAX_COUNT => 1,
                        _ => 2,
                    }
                };
                let (styled, has_links) = if emoji == 0 && !m.is_hidden {
                    styled(&m.text)
                } else {
                    (slint::StyledText::default(), false)
                };
                let quoted = m.reply_to.as_ref().and_then(|r| r.quoted.clone());
                let reply_text = quoted.as_ref().map(|q| {
                    if q.is_hidden {
                        shell::tr("chat_window.message_removed")
                    } else if !q.text.is_empty() {
                        q.text.replace('\n', " ")
                    } else if q.attachment_count > 0 {
                        social::tr_count(
                            "chat_window.quoted_images",
                            q.attachment_count as f64,
                            &[("count", q.attachment_count.to_string().into())],
                        )
                    } else {
                        String::new()
                    }
                });
                let pills = chat::to_reaction_pills(m.reactions.as_deref().unwrap_or_default());
                let has_mine = pills.iter().any(|p| p.from_me);
                let reactions: Vec<ChatReactionPill> = pills
                    .iter()
                    .map(|p| {
                        let emoji = p.emoji.clone();
                        let (label, hint) = if p.from_me && p.from_friend {
                            (
                                shell::tr_with(
                                    "chat_window.reaction_both",
                                    &[
                                        ("name", friend_name.clone().into()),
                                        ("emoji", emoji.clone().into()),
                                    ],
                                ),
                                shell::tr("chat_window.reaction_remove_yours"),
                            )
                        } else if p.from_me {
                            (
                                shell::tr_with(
                                    "chat_window.reaction_mine",
                                    &[("emoji", emoji.clone().into())],
                                ),
                                shell::tr("chat_window.reaction_remove"),
                            )
                        } else {
                            (
                                shell::tr_with(
                                    "chat_window.reaction_friend",
                                    &[
                                        ("name", friend_name.clone().into()),
                                        ("emoji", emoji.clone().into()),
                                    ],
                                ),
                                if has_mine {
                                    shell::tr_with(
                                        "chat_window.reaction_switch",
                                        &[("emoji", emoji.clone().into())],
                                    )
                                } else {
                                    shell::tr("chat_window.reaction_add")
                                },
                            )
                        };
                        ChatReactionPill {
                            emoji: emoji.into(),
                            mine: p.from_me,
                            both: p.from_me && p.from_friend,
                            pending: p.is_pending,
                            initial: !entering,
                            label: label.into(),
                            hint: hint.into(),
                        }
                    })
                    .collect();
                // images: their layout and pictures
                let attachments = m.attachments.clone().unwrap_or_default();
                let sizes: Vec<(Option<u32>, Option<u32>)> =
                    attachments.iter().map(|a| (a.width, a.height)).collect();
                let layout = chat::get_chat_image_layout(&sizes);
                let mut cells = Vec::new();
                let mut images_height = 0.0f32;
                if has_images && !m.is_hidden {
                    let inner = layout.width as f32 - 2.0;
                    let column = if layout.columns == 2 {
                        (inner - 2.0) / 2.0
                    } else {
                        inner
                    };
                    let mut y = 0.0f32;
                    let mut x_slot = 0;
                    let mut row_height = 0.0f32;
                    for (i, attachment) in attachments.iter().enumerate() {
                        let cell = layout.cells.get(i).cloned().unwrap_or(chat::ChatImageCell {
                            height: 120,
                            is_wide: false,
                        });
                        let (x, width) = if cell.is_wide || layout.columns == 1 {
                            if x_slot != 0 {
                                y += row_height + 2.0;
                                x_slot = 0;
                            }
                            (0.0, inner)
                        } else {
                            (x_slot as f32 * (column + 2.0), column)
                        };
                        let h = cell.height as f32;
                        let src = attachment.local_url.clone().or(attachment.url.clone());
                        let covered = attachment.spoiler
                            && m.status != ChatMessageStatus::Blocked
                            && !revealed.contains(&attachment.id);
                        let blurred_needed = covered || m.status == ChatMessageStatus::Blocked;
                        let pw = (width * scale).ceil() as u32;
                        let ph = (h * scale).ceil() as u32;
                        let (image, blurred) = match &src {
                            Some(src) if src.starts_with("http") => (
                                picture_of(
                                    &Some(src.clone()),
                                    &format!("cell{pw}x{ph}"),
                                    Op::Cover {
                                        width: pw,
                                        height: ph,
                                    },
                                ),
                                if blurred_needed {
                                    picture_of(
                                        &Some(src.clone()),
                                        &format!("blur{pw}x{ph}"),
                                        Op::CoverBlur {
                                            width: pw,
                                            height: ph,
                                            sigma: 24.0 * scale,
                                            pad: 0,
                                            darken: if covered { 0.55 } else { 0.6 },
                                            background: Some([0x1c, 0x1c, 0x1c]),
                                        },
                                    )
                                } else {
                                    Image::default()
                                },
                            ),
                            Some(_) => (
                                draft_cell(&c, attachment, pw, ph, false),
                                if blurred_needed {
                                    draft_cell(&c, attachment, pw, ph, true)
                                } else {
                                    Image::default()
                                },
                            ),
                            None => (Image::default(), Image::default()),
                        };
                        cells.push(ChatImageCell {
                            id: attachment.id.as_str().into(),
                            image,
                            blurred,
                            x,
                            y,
                            width,
                            height: h,
                            covered,
                            has_source: src.is_some(),
                        });
                        row_height = row_height.max(h);
                        if cell.is_wide || layout.columns == 1 {
                            y += h + 2.0;
                            row_height = 0.0;
                        } else {
                            x_slot += 1;
                            if x_slot == 2 {
                                x_slot = 0;
                                y += row_height + 2.0;
                                row_height = 0.0;
                            }
                        }
                    }
                    if x_slot != 0 {
                        y += row_height + 2.0;
                    }
                    images_height = (y - 2.0).max(0.0) + 2.0;
                } else if has_images {
                    images_height = layout
                        .cells
                        .first()
                        .map_or(0, |c| c.height)
                        .max(chat::REMOVED_IMAGES_MIN_HEIGHT)
                        as f32;
                }
                let status_text = if has_images {
                    match m.status {
                        ChatMessageStatus::Pending => shell::tr_with(
                            "chat_window.sending_progress",
                            &[(
                                "percent",
                                ((m.upload_progress.unwrap_or(0.0) * 100.0).round() as i64)
                                    .to_string()
                                    .into(),
                            )],
                        ),
                        ChatMessageStatus::Checking => social::tr_count(
                            "chat_window.checking_images",
                            attachments.len() as f64,
                            &[("count", attachments.len().to_string().into())],
                        ),
                        ChatMessageStatus::Blocked => social::tr_count(
                            "chat_window.images_blocked",
                            attachments.len() as f64,
                            &[("count", attachments.len().to_string().into())],
                        ),
                        ChatMessageStatus::Failed => {
                            if m.failure == Some(chat::ChatFailure::DailyLimit) {
                                shell::tr("chat_window.images_daily_limit")
                            } else {
                                shell::tr("chat_window.images_failed")
                            }
                        }
                        ChatMessageStatus::Sent => String::new(),
                    }
                } else {
                    String::new()
                };
                items.push(ChatItem {
                    kind: "message".into(),
                    key: item_key(m).into(),
                    gap: group_gap,
                    mine: group.from_me,
                    seq: m.seq.unwrap_or(0) as i32,
                    has_seq: m.seq.is_some(),
                    text: m.text.as_str().into(),
                    styled,
                    has_links,
                    emoji,
                    status: m.status.as_str().into(),
                    daily_limit: m.failure == Some(chat::ChatFailure::DailyLimit),
                    hidden: m.is_hidden,
                    first: position == 0,
                    last: position + 1 == count,
                    enter: entering,
                    reply: m.reply_to.is_some(),
                    reply_available: quoted.is_some(),
                    reply_seq: m.reply_to.as_ref().map_or(0, |r| r.seq) as i32,
                    reply_name: quoted
                        .as_ref()
                        .map(|q| {
                            if q.from_me {
                                you.clone()
                            } else {
                                friend_name.clone()
                            }
                        })
                        .unwrap_or_default()
                        .into(),
                    reply_text: reply_text.unwrap_or_default().into(),
                    reply_removed: quoted.as_ref().is_some_and(|q| q.is_hidden),
                    reactions: ModelRc::new(VecModel::from(reactions)),
                    images: ModelRc::new(VecModel::from(cells)),
                    images_width: if has_images { layout.width as f32 } else { 0.0 },
                    images_height,
                    captioned: has_images
                        && !m.is_hidden
                        && (!m.text.is_empty() || m.reply_to.is_some()),
                    upload_progress: m.upload_progress.unwrap_or(0.0) as f32,
                    images_removed_title: social::tr_count(
                        "chat_window.image_removed",
                        attachments.len() as f64,
                        &[("count", attachments.len().to_string().into())],
                    )
                    .into(),
                    can_act: can_reply
                        && m.seq.is_some()
                        && m.status == ChatMessageStatus::Sent
                        && !m.is_hidden,
                    can_report: !official && !m.from_me && m.seq.is_some() && !m.is_hidden,
                    can_react: can_reply,
                    status_text: status_text.into(),
                    label: SharedString::default(),
                });
                group_gap = 2.0;
            }
            if let Some(&last) = group.messages.last() {
                let m = &c.messages[last];
                let first = &c.messages[group.messages[0]];
                items.push(ChatItem {
                    kind: "time".into(),
                    key: format!("time:{}", group.key).into(),
                    label: chat::time::parse_ms(&m.created_at)
                        .map(time_label)
                        .unwrap_or_default()
                        .into(),
                    gap: 2.0,
                    mine: group.from_me,
                    enter: !initial.contains(&first.id) && !first.from_history,
                    ..Default::default()
                });
            }
        }
    }
    let _ = &friend_id;
    if let Some(model) = with_state(|s| s.items.clone()) {
        sync_rows(&model, items, |a, b| a.key == b.key);
    }
    let data = window.global::<ChatData>();
    data.set_jump_count(jump_count.min(9999) as i32);
    data.set_loading_older(c.is_loading_older);
    render_sticky();
}

fn draft_cell(
    c: &ChatConversation,
    attachment: &ChatAttachment,
    _w: u32,
    _h: u32,
    blurred: bool,
) -> Image {
    // the sender's own copy: the draft image it came from, if still known
    let key = format!(
        "draft{}:{}",
        if blurred { "-blur" } else { "" },
        attachment.id
    );
    let cached = picture(&key);
    if cached.size().width > 0 {
        return cached;
    }
    let _ = c;
    cached
}

fn render_sticky() {
    let Some(window) = self::window() else { return };
    let label = with_state(|s| {
        let c = active_conversation(s)?;
        let days = chat::group_chat_messages(&c.messages, None);
        let last = days
            .iter()
            .rev()
            .find(|d| s.view.days_above.contains(&format!("day:{}", d.key)))?;
        Some(day_label(last.date))
    })
    .flatten()
    .unwrap_or_default();
    window.global::<ChatData>().set_sticky_day(label.into());
}

/// getComposerHint and the composer's state.
fn render_composer() {
    let Some(window) = self::window() else { return };
    let scale = window.window().scale_factor();
    let data = window.global::<ChatData>();
    let Some(plan) = with_state(|s| {
        let c = active_conversation(s)?.clone();
        let preparing = s.preparing.get(&c.friend.id).copied().unwrap_or(0);
        let reaction_error = s
            .reaction_error
            .as_ref()
            .filter(|(id, _)| id == &c.friend.id)
            .map(|(_, rate)| *rate);
        Some((
            c,
            preparing,
            s.cooldown,
            s.rejections,
            reaction_error,
            s.image_note,
        ))
    })
    .flatten() else {
        return;
    };
    let (c, preparing, cooldown, rejections, reaction_error, image_note) = plan;
    let name = c.friend.display_name.clone();
    let text = chat::time::js_trim(&c.draft).to_string();
    let length = chat::get_message_length(&c.draft);
    let too_long = chat::get_overflow_range(&c.draft).is_some();
    let has_images = !c.draft_images.is_empty();
    let can_send = c.can_send && (!text.is_empty() || has_images) && !too_long && preparing == 0;
    let (kind, hint) = if !c.can_send {
        (
            "info",
            shell::tr_with(
                "chat_window.cannot_send_hint",
                &[("name", name.clone().into())],
            ),
        )
    } else if cooldown.is_some() {
        ("error", shell::tr("chat_window.rate_limited_hint"))
    } else if let Some(rate) = reaction_error {
        (
            "error",
            shell::tr(if rate {
                "chat_window.reaction_rate_limited_hint"
            } else {
                "chat_window.reaction_failed_hint"
            }),
        )
    } else if let Some(error) = image_note {
        (
            "error",
            if error == chat::ChatDraftImageError::TooMany {
                social::tr_count(
                    "chat_window.image_error_too_many",
                    chat::CHAT_ATTACHMENTS_PER_MESSAGE as f64,
                    &[(
                        "count",
                        chat::CHAT_ATTACHMENTS_PER_MESSAGE.to_string().into(),
                    )],
                )
            } else {
                shell::tr(&format!("chat_window.image_error_{}", error.as_str()))
            },
        )
    } else if too_long {
        let over = length.saturating_sub(chat::CHAT_MESSAGE_MAX_LENGTH);
        (
            "error",
            social::tr_count(
                "chat_window.message_too_long",
                over as f64,
                &[("count", over.to_string().into())],
            ),
        )
    } else if c.is_typing {
        (
            "typing",
            shell::tr_with("chat_window.typing", &[("name", name.clone().into())]),
        )
    } else if !c.friend.online() {
        (
            "offline",
            shell::tr_with("chat_window.offline_hint", &[("name", name.clone().into())]),
        )
    } else if c.messages.is_empty() && c.load_state == ChatLoadState::Loaded {
        ("info", shell::tr("chat_window.enter_hint"))
    } else {
        ("", String::new())
    };
    data.set_hint_kind(kind.into());
    data.set_hint(hint.into());
    data.set_counter(
        if chat::should_show_length_counter(length) {
            format!(
                "{} / {}",
                group_number(length),
                group_number(chat::CHAT_MESSAGE_MAX_LENGTH)
            )
        } else {
            String::new()
        }
        .into(),
    );
    data.set_counter_over(too_long);
    data.set_invalid(too_long);
    data.set_rejections(rejections);
    data.set_send_enabled(can_send);
    data.set_draft(c.draft.as_str().into());
    data.set_placeholder(
        if has_images {
            shell::tr("chat_window.add_message_placeholder")
        } else {
            shell::tr_with("chat_window.message_placeholder", &[("name", name.into())])
        }
        .into(),
    );
    data.set_attach_enabled(
        crate::features::enabled("CHAT_IMAGES")
            && c.can_send
            && c.draft_images.len() < chat::CHAT_ATTACHMENTS_PER_MESSAGE,
    );
    let drafts: Vec<ChatDraftImage> = c
        .draft_images
        .iter()
        .enumerate()
        .map(|(i, image)| ChatDraftImage {
            id: image.id.as_str().into(),
            image: draft_picture(image, false, scale),
            blurred: if image.spoiler {
                draft_picture(image, true, scale)
            } else {
                Image::default()
            },
            name: if image.name.is_empty() {
                shell::tr_with(
                    "chat_window.image_number",
                    &[("index", (i + 1).to_string().into())],
                )
            } else {
                image.name.clone()
            }
            .into(),
            spoiler: image.spoiler,
        })
        .collect();
    data.set_draft_images(ModelRc::new(VecModel::from(drafts)));
    // the reply strip
    let reply = c
        .reply_to_seq
        .and_then(|seq| c.messages.iter().find(|m| m.seq == Some(seq)));
    data.set_has_reply(reply.is_some());
    if let Some(reply) = reply {
        data.set_reply_to_self(reply.from_me);
        let label = if reply.from_me {
            shell::tr("chat_window.replying_to_self")
        } else {
            shell::tr_with(
                "chat_window.replying_to",
                &[("name", c.friend.display_name.clone().into())],
            )
        };
        data.set_reply_label(strong_parts(&label));
        data.set_reply_name(c.friend.display_name.as_str().into());
        let text = if !reply.text.is_empty() {
            reply.text.replace('\n', " ")
        } else if reply.attachment_count() > 0 {
            social::tr_count(
                "chat_window.quoted_images",
                reply.attachment_count() as f64,
                &[("count", reply.attachment_count().to_string().into())],
            )
        } else {
            String::new()
        };
        data.set_reply_text(text.into());
    }
    // the cooldown ring
    match cooldown {
        Some(cooldown) => {
            data.set_cooldown(true);
            data.set_cooldown_total((cooldown.until - cooldown.started_at) as i32);
            data.set_cooldown_elapsed((now_ms() - cooldown.started_at) as i32);
            data.set_cooldown_seconds(chat::cooldown_seconds_left(cooldown.until, now_ms()) as i32);
        }
        None => data.set_cooldown(false),
    }
}

/// <Trans components={{ strong }}>: the label split around <strong> parts
/// (odd entries are bold).
fn strong_parts(text: &str) -> ModelRc<SharedString> {
    let mut parts = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("<strong>") {
        parts.push(SharedString::from(&rest[..start]));
        let after = &rest[start + 8..];
        let end = after.find("</strong>").unwrap_or(after.len());
        parts.push(SharedString::from(&after[..end]));
        rest = after.get(end + 9..).unwrap_or_default();
    }
    parts.push(SharedString::from(rest));
    ModelRc::new(VecModel::from(parts))
}

/// A press outside the open context menu closes it (it is not modal: the
/// press still lands).
pub fn pointer_pressed_at(x: f32, y: f32) {
    let Some(window) = self::window() else { return };
    let popup = window.global::<Popup>();
    if popup.get_open() == "context-menu" {
        let inside = x >= popup.get_box_x()
            && x <= popup.get_box_x() + popup.get_box_width()
            && y >= popup.get_box_y()
            && y <= popup.get_box_y() + popup.get_box_height();
        if !inside {
            popup.set_open("".into());
        }
    }
}

/// Intl.NumberFormat grouping (1,850).
fn group_number(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(if language().starts_with("en") {
                ','
            } else {
                '.'
            });
        }
        out.push(c);
    }
    out
}

fn render_emoji() {
    let Some(window) = self::window() else { return };
    let data = window.global::<ChatData>();
    let Some((tab, query, selected)) = with_state(|s| {
        let selected = s.reaction_picker.and_then(|seq| {
            active_conversation(s)?
                .messages
                .iter()
                .find(|m| m.seq == Some(seq))
                .and_then(chat::get_my_reaction)
                .map(str::to_string)
        });
        (s.emoji_tab, s.emoji_query.clone(), selected)
    }) else {
        return;
    };
    let searching = !query.trim().is_empty();
    let items: Vec<chat::EmojiItem> = if searching {
        chat::search_emoji(&query)
    } else if tab == EmojiCategoryId::Recent {
        recent_list(chat::RECENT_EMOJI_STORAGE_KEY, &chat::DEFAULT_RECENT_EMOJI)
            .iter()
            .map(|e| chat::find_emoji(e))
            .collect()
    } else {
        chat::category_items(tab).to_vec()
    };
    data.set_emoji_items(ModelRc::new(VecModel::from(
        items
            .into_iter()
            .map(|i| ChatEmoji {
                emoji: i.emoji.into(),
                name: i.name.into(),
            })
            .collect::<Vec<_>>(),
    )));
    data.set_emoji_tab(tab.as_str().into());
    data.set_emoji_query(query.into());
    data.set_emoji_hover_index(-1);
    data.set_emoji_selected(selected.unwrap_or_default().into());
    data.set_emoji_section(
        if searching {
            shell::tr("chat_window.emoji_search_results")
        } else {
            shell::tr(&format!("chat_window.emoji_category_{}", tab.as_str()))
        }
        .into(),
    );
}

fn render_overlays() {
    let Some(window) = self::window() else { return };
    let scale = window.window().scale_factor();
    let data = window.global::<ChatData>();
    let Some(plan) = with_state(|s| {
        let c = active_conversation(s).cloned();
        (
            c,
            s.reaction_bar.clone(),
            s.reaction_picker,
            s.lightbox.clone(),
            s.view.flash.clone(),
        )
    }) else {
        return;
    };
    let (c, bar, picker, lightbox, flash) = plan;
    let replying = c
        .as_ref()
        .and_then(|c| c.reply_to_seq)
        .map(|seq| format!("seq:{seq}"))
        .unwrap_or_default();
    let reacting = bar
        .as_ref()
        .map(|(k, _)| k.clone())
        .or(picker.map(|seq| format!("seq:{seq}")))
        .unwrap_or_default();
    data.set_replying_key(replying.into());
    data.set_reacting_key(reacting.into());
    data.set_flash_key(flash.unwrap_or_default().into());
    data.set_reaction_bar_key(
        bar.as_ref()
            .map(|(k, _)| k.as_str())
            .unwrap_or_default()
            .into(),
    );
    data.set_reaction_bar_below(bar.as_ref().is_some_and(|(_, below)| *below));
    data.set_quick_reactions(ModelRc::new(VecModel::from(
        recent_list(chat::RECENT_REACTIONS_STORAGE_KEY, &chat::QUICK_REACTIONS)
            .into_iter()
            .map(SharedString::from)
            .collect::<Vec<_>>(),
    )));
    let bar_selected = bar
        .as_ref()
        .and_then(|(key, _)| {
            c.as_ref()?
                .messages
                .iter()
                .find(|m| &item_key(m) == key)
                .and_then(chat::get_my_reaction)
                .map(str::to_string)
        })
        .unwrap_or_default();
    data.set_reaction_bar_selected(bar_selected.into());
    data.set_reaction_picker_open(picker.is_some());
    data.set_reaction_picker_mine(
        picker
            .and_then(|seq| {
                c.as_ref()?
                    .messages
                    .iter()
                    .find(|m| m.seq == Some(seq))
                    .map(|m| m.from_me)
            })
            .unwrap_or(false),
    );
    if picker.is_some() {
        render_emoji();
    }
    // the lightbox: the image at full size, its sender and time
    let open = lightbox.and_then(|(key, id)| {
        let c = c.as_ref()?;
        let m = c.messages.iter().find(|m| item_key(m) == key)?;
        if m.is_hidden {
            return None;
        }
        let a = m.attachments.as_ref()?.iter().find(|a| a.id == id)?;
        let url = a.url.clone().or(a.local_url.clone())?;
        let who = if m.from_me {
            shell::tr("chat_window.you")
        } else {
            c.friend.display_name.clone()
        };
        let when = chat::time::parse_ms(&m.created_at)
            .map(time_label)
            .unwrap_or_default();
        Some((url, format!("{who} · {when}")))
    });
    data.set_lightbox_open(open.is_some());
    if let Some((url, caption)) = open {
        data.set_lightbox_caption(caption.into());
        let width = (window.window().size().width as f32).max(400.0);
        data.set_lightbox_image(picture_of(
            &Some(url),
            "full",
            Op::MaxWidth((width * scale.max(1.0)) as u32),
        ));
    }
    if let Some(window) = self::window() {
        let data = window.global::<ChatData>();
        let emoji_open = data.get_emoji_open();
        if emoji_open {
            render_emoji();
        }
    }
}

// ---- the list's scroll state ---------------------------------------------------

/// handleScroll: away from the newest message, older history near the top.
fn scrolled(from_bottom: f32, from_top: f32) {
    let away = from_bottom > chat::JUMP_TO_LATEST_THRESHOLD_PX as f32;
    let Some((was_away, load, id)) = with_state(|s| {
        let c = active_conversation(s)?;
        let latest = c.messages.last().map(|m| m.id.clone());
        let has_new = s
            .view
            .new_since
            .as_ref()
            .and_then(|id| chat::find_first_friend_message_after(&c.messages, id))
            .is_some();
        let load = c.has_more_before && from_top < chat::LOAD_OLDER_THRESHOLD_PX as f32;
        let id = c.friend.id.clone();
        let was_away = s.view.away_from.is_some();
        if away != was_away {
            if away {
                s.view.away_from = latest.clone();
                // a divider still in the list keeps its place
                if !has_new {
                    s.view.new_since = latest;
                }
            } else {
                s.view.away_from = None;
                // nothing arrived while away: later messages are seen live
                if !has_new {
                    s.view.new_since = None;
                }
            }
        }
        s.view.from_top = from_top;
        Some((was_away, load, id))
    })
    .flatten() else {
        return;
    };
    if was_away != away {
        render_items();
    }
    if load {
        load_older(&id);
    }
}

// ---- mock data (HYDRA_CHAT_MOCK) -----------------------------------------------

fn mock_dto(friend_id: &str, seq: i64, mine: bool, body: &str, created_at: &str) -> ChatMessageDto {
    ChatMessageDto {
        seq,
        sender_id: if mine { "me".into() } else { friend_id.into() },
        body: body.into(),
        hidden: false,
        client_nonce: format!("mock-{friend_id}-{seq}"),
        created_at: created_at.into(),
        reply_to_seq: None,
        reply_to: None,
        reactions: None,
        attachments: None,
    }
}

/// Fake conversations covering every state (dev only, no API).
fn load_mock() {
    let now = now_ms();
    let iso = |ms: i64| {
        chrono::DateTime::from_timestamp_millis(ms)
            .unwrap_or_default()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    };
    let friend = |id: &str, name: &str, online: bool, game: Option<&str>| UserFriend {
        id: id.into(),
        display_name: name.into(),
        is_online: Some(online),
        current_game: game.map(|title| chat::FriendGame {
            object_id: "1091500".into(),
            shop: "steam".into(),
            title: title.into(),
            icon_url: None,
            ..Default::default()
        }),
        ..Default::default()
    };
    let ana = friend("MOCKANA1", "Ana", true, Some("Cyberpunk 2077"));
    let bruno = friend("MOCKBRU2", "Bruno", false, None);
    let carla = friend("MOCKCAR3", "Carla", true, None);
    let mut messages = vec![
        mock_dto(
            &ana.id,
            1,
            false,
            "Hey! Are you playing tonight?",
            &iso(now - 2 * DAY_MS),
        ),
        mock_dto(
            &ana.id,
            2,
            true,
            "Yes, after dinner 🎮",
            &iso(now - 2 * DAY_MS + 60_000),
        ),
        mock_dto(
            &ana.id,
            3,
            false,
            "Check this out: https://hydralauncher.gg/ (the new site)",
            &iso(now - DAY_MS),
        ),
        mock_dto(&ana.id, 4, false, "😂😂", &iso(now - DAY_MS + 30_000)),
        mock_dto(
            &ana.id,
            5,
            true,
            "That's great.\nSecond line, and a longer message that should wrap inside the bubble once it reaches the width limit of three quarters of the row.",
            &iso(now - 3_600_000),
        ),
        mock_dto(
            &ana.id,
            6,
            false,
            "This one was removed",
            &iso(now - 3_000_000),
        ),
        mock_dto(
            &ana.id,
            7,
            false,
            "Replying to your message",
            &iso(now - 600_000),
        ),
    ];
    messages[5].hidden = true;
    messages[5].body.clear();
    messages[6].reply_to_seq = Some(5);
    messages[6].reply_to = Some(chat::ChatReplyDto {
        sender_id: "me".into(),
        body: "That's great. Second line…".into(),
        hidden: false,
        attachment_count: None,
    });
    messages[1].reactions = Some(vec![
        chat::ChatReactionDto {
            user_id: ana.id.clone(),
            emoji: "🔥".into(),
            updated_at: iso(now - DAY_MS),
        },
        chat::ChatReactionDto {
            user_id: "me".into(),
            emoji: "🔥".into(),
            updated_at: iso(now - DAY_MS),
        },
    ]);
    messages[4].reactions = Some(vec![chat::ChatReactionDto {
        user_id: ana.id.clone(),
        emoji: "❤️".into(),
        updated_at: iso(now - 3_000_000),
    }]);
    let mut ana_c = ChatConversation::new(ana.clone());
    ana_c.messages = messages
        .iter()
        .map(|m| chat::to_chat_message(m, &ana.id, true))
        .collect();
    // an unsent text and held images
    let mut failed = chat::create_pending_message(
        "This failed to send",
        "mock-failed",
        Some(iso(now - 120_000)),
        None,
        Vec::new(),
    );
    failed.status = ChatMessageStatus::Failed;
    failed.from_history = true;
    ana_c.messages.push(failed);
    ana_c.load_state = ChatLoadState::Loaded;
    ana_c.unread_count = 0;
    let mut bruno_c = ChatConversation::new(bruno.clone());
    bruno_c.last_message = Some(chat::ChatConversationLastMessage {
        seq: 10,
        from_me: true,
        text: "See you tomorrow".into(),
        created_at: iso(now - 5 * DAY_MS),
        is_hidden: false,
        attachment_count: 0,
    });
    bruno_c.can_send = false;
    let mut carla_c = ChatConversation::new(carla.clone());
    carla_c.last_message = Some(chat::ChatConversationLastMessage {
        seq: 3,
        from_me: false,
        text: "Did you see the update?".into(),
        created_at: iso(now - 300_000),
        is_hidden: false,
        attachment_count: 0,
    });
    carla_c.unread_count = 2;
    carla_c.is_typing = true;
    with_state(|s| {
        s.conversations = vec![ana_c, bruno_c, carla_c];
        s.friends = vec![ana.clone(), bruno.clone(), carla.clone()];
        s.active = Some(ana.id.clone());
        s.view.initial = s.conversations[0]
            .messages
            .iter()
            .map(|m| m.id.clone())
            .collect();
    });
    render_all();
}
