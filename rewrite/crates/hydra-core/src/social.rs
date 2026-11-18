//! The friends and chat windows' main-process state:
//! services/social-window-bounds.ts, social-windows-restore-plan.ts, the
//! LevelDB shapes of social-windows-session.ts, window-manager.ts's chat
//! window state and getSocialWindowsSession, events/chat/chat-state.ts's
//! checks and services/friends-snapshot.ts.

use serde::{Deserialize, Serialize};

use crate::chat::{FriendRequest, UserFriend, is_friend_id};

/// LevelDB keys (levelKeys.socialWindowsSession / socialWindowsBounds).
pub const SOCIAL_WINDOWS_SESSION_KEY: &str = "social-windows-session";
pub const SOCIAL_WINDOWS_BOUNDS_KEY: &str = "social-windows-bounds";
/// levelKeys.chatNotificationCursor (see `chat_unread::ChatNotificationCursor`).
pub const CHAT_NOTIFICATION_CURSOR_KEY: &str = crate::chat_unread::CHAT_NOTIFICATION_CURSOR_KEY;

/// window-manager.ts: (width, height) in px.
pub const FRIENDS_WINDOW_DEFAULT_SIZE: (u32, u32) = (420, 780);
pub const FRIENDS_WINDOW_MIN_SIZE: (u32, u32) = (260, 360);
pub const CHAT_WINDOW_DEFAULT_SIZE: (u32, u32) = (560, 560);
pub const CHAT_WINDOW_MIN_SIZE: (u32, u32) = (400, 420);
/// The longest a painted friends window stays hidden waiting for its list.
pub const FRIENDS_WINDOW_SHOW_FALLBACK_MS: u64 = 400;
/// Both windows' background color (#1c1c1c).
pub const SOCIAL_WINDOW_BACKGROUND: u32 = 0x1c1c1c;

const MIN_VISIBLE_TITLE_BAR_WIDTH: f64 = 120.0;
const TITLE_BAR_HEIGHT: f64 = 35.0;

/// WindowRect / SocialWindowBounds (Electron's `getNormalBounds()`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct WindowRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// SocialWindowKind
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SocialWindowKind {
    Friends,
    Chat,
}

/// SocialWindowsBounds: the last normal bounds of each window.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SocialWindowsBounds {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub friends: Option<WindowRect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat: Option<WindowRect>,
}

impl SocialWindowsBounds {
    pub fn get(&self, kind: SocialWindowKind) -> Option<WindowRect> {
        match kind {
            SocialWindowKind::Friends => self.friends,
            SocialWindowKind::Chat => self.chat,
        }
    }

    pub fn set(&mut self, kind: SocialWindowKind, rect: WindowRect) {
        match kind {
            SocialWindowKind::Friends => self.friends = Some(rect),
            SocialWindowKind::Chat => self.chat = Some(rect),
        }
    }
}

/// What resolveSocialWindowBounds gives: the size, and the position when the
/// saved one is still reachable (Electron's Partial<WindowRect>).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ResolvedWindowBounds {
    pub position: Option<(i32, i32)>,
    pub width: i32,
    pub height: i32,
}

fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

fn visible_area(rect: &WindowRect, area: &WindowRect) -> (f64, f64) {
    (
        (rect.x + rect.width).min(area.x + area.width) - rect.x.max(area.x),
        (rect.y + rect.height).min(area.y + area.height) - rect.y.max(area.y),
    )
}

/// resolveSocialWindowBounds: the saved size (at least the minimum), and
/// the saved position only when at least 120px of the title bar is on a
/// display's work area.
pub fn resolve_social_window_bounds(
    saved: Option<&WindowRect>,
    work_areas: &[WindowRect],
    minimum_size: (u32, u32),
) -> Option<ResolvedWindowBounds> {
    let saved = saved?;
    if ![saved.x, saved.y, saved.width, saved.height]
        .iter()
        .all(|v| v.is_finite())
    {
        return None;
    }
    let width = js_round(saved.width).max(minimum_size.0 as f64);
    let height = js_round(saved.height).max(minimum_size.1 as f64);
    let rect = WindowRect {
        x: js_round(saved.x),
        y: js_round(saved.y),
        width,
        height,
    };
    let title_bar = WindowRect {
        height: TITLE_BAR_HEIGHT,
        ..rect
    };
    let reachable = work_areas.iter().any(|area| {
        let (w, h) = visible_area(&title_bar, area);
        w >= MIN_VISIBLE_TITLE_BAR_WIDTH && h >= TITLE_BAR_HEIGHT
    });
    Some(ResolvedWindowBounds {
        position: reachable.then_some((rect.x as i32, rect.y as i32)),
        width: width as i32,
        height: height as i32,
    })
}

/// SocialWindowsSession: what was open when Hydra quit. Parses leniently: a
/// session in an older format (`chatFriendIds`) restores nothing.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SocialWindowsSession {
    #[serde(deserialize_with = "crate::chat::lenient")]
    pub friends_window_open: bool,
    #[serde(deserialize_with = "crate::chat::lenient_list")]
    pub chat_friends: Vec<UserFriend>,
    pub active_chat_friend_id: Option<String>,
    pub top_window: Option<SocialWindowKind>,
}

/// getSocialWindowsRestorePlan's result.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SocialWindowsRestorePlan {
    pub open_friends_window: bool,
    pub chat_friends: Vec<UserFriend>,
    pub active_chat_friend_id: Option<String>,
    pub show_order: Vec<SocialWindowKind>,
}

/// getSocialWindowsRestorePlan. `open_friends_window_on_startup` is
/// userPreferences.openFriendsWindowOnStartup.
pub fn get_social_windows_restore_plan(
    session: Option<&SocialWindowsSession>,
    open_friends_window_on_startup: bool,
) -> SocialWindowsRestorePlan {
    let chat_friends = session.map(|s| s.chat_friends.clone()).unwrap_or_default();
    let open_friends_window =
        session.is_some_and(|s| s.friends_window_open) || open_friends_window_on_startup;
    let show_order = get_social_windows_show_order(
        open_friends_window,
        !chat_friends.is_empty(),
        session.and_then(|s| s.top_window),
    );
    SocialWindowsRestorePlan {
        open_friends_window,
        chat_friends,
        active_chat_friend_id: session.and_then(|s| s.active_chat_friend_id.clone()),
        show_order,
    }
}

/// getSocialWindowsShowOrder: the window that was on top shows last.
pub fn get_social_windows_show_order(
    open_friends_window: bool,
    open_chat_window: bool,
    top_window: Option<SocialWindowKind>,
) -> Vec<SocialWindowKind> {
    let mut windows = Vec::new();
    if open_friends_window {
        windows.push(SocialWindowKind::Friends);
    }
    if open_chat_window {
        windows.push(SocialWindowKind::Chat);
    }
    if top_window == Some(SocialWindowKind::Friends) {
        windows.reverse();
    }
    windows
}

/// getTopSocialWindow
pub fn get_top_social_window(
    is_friends_window_open: bool,
    is_chat_window_open: bool,
    last_focused: Option<SocialWindowKind>,
) -> Option<SocialWindowKind> {
    match (is_friends_window_open, is_chat_window_open) {
        (true, true) => Some(last_focused.unwrap_or(SocialWindowKind::Chat)),
        (_, true) => Some(SocialWindowKind::Chat),
        (true, false) => Some(SocialWindowKind::Friends),
        (false, false) => None,
    }
}

/// orderChatFriends: the friends of `open_friend_ids`, in that order.
pub fn order_chat_friends<S: AsRef<str>>(
    open_friend_ids: &[S],
    open_friends: &[UserFriend],
) -> Vec<UserFriend> {
    open_friend_ids
        .iter()
        .filter_map(|id| open_friends.iter().find(|f| f.id == id.as_ref()).cloned())
        .collect()
}

/// ChatWindowState: what the chat window reports (setChatWindowState).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ChatWindowState {
    pub active_friend_id: Option<String>,
    pub open_friend_ids: Vec<String>,
    pub open_friends: Vec<UserFriend>,
}

impl ChatWindowState {
    /// events/chat/chat-state.ts: only hashids and named friends get through.
    pub fn sanitized(self) -> Self {
        ChatWindowState {
            active_friend_id: self.active_friend_id.filter(|id| is_friend_id(id)),
            open_friend_ids: self
                .open_friend_ids
                .into_iter()
                .filter(|id| is_friend_id(id))
                .collect(),
            open_friends: self
                .open_friends
                .into_iter()
                .filter(|f| is_friend_id(&f.id))
                .collect(),
        }
    }
}

/// window-manager.ts getSocialWindowsSession: the chat window brings back
/// only its active conversation (the sidebar reloads the rest).
pub fn social_windows_session(
    is_friends_window_open: bool,
    is_chat_window_open: bool,
    chat: &ChatWindowState,
    last_focused: Option<SocialWindowKind>,
) -> SocialWindowsSession {
    let chat_friends = if is_chat_window_open {
        let first = chat
            .active_friend_id
            .clone()
            .or_else(|| chat.open_friend_ids.first().cloned())
            .filter(|id| !id.is_empty());
        order_chat_friends(&first.into_iter().collect::<Vec<_>>(), &chat.open_friends)
    } else {
        Vec::new()
    };
    SocialWindowsSession {
        friends_window_open: is_friends_window_open,
        chat_friends,
        active_chat_friend_id: if is_chat_window_open {
            chat.active_friend_id.clone()
        } else {
            None
        },
        top_window: get_top_social_window(
            is_friends_window_open,
            is_chat_window_open,
            last_focused,
        ),
    }
}

/// PendingChatFriend: a conversation waiting for the chat window to open
/// its tab. A background one was opened for an unseen message.
#[derive(Clone, Debug, PartialEq)]
pub struct PendingChatFriend {
    pub friend: UserFriend,
    pub is_background: bool,
}

/// window-manager.ts restoreChatWindow: the conversation to activate and the
/// pending tabs to queue (foreground ones).
pub fn restore_chat_window_plan(
    friends: &[UserFriend],
    active_friend_id: Option<&str>,
) -> Option<(UserFriend, Vec<PendingChatFriend>)> {
    let active = friends
        .iter()
        .find(|f| Some(f.id.as_str()) == active_friend_id)
        .or_else(|| friends.first())?
        .clone();
    let pending = friends
        .iter()
        .cloned()
        .map(|friend| PendingChatFriend {
            friend,
            is_background: false,
        })
        .collect();
    Some((active, pending))
}

// ---- friends-snapshot.ts ----------------------------------------------------

/// Reopening the profile menu within this window reuses the last snapshot.
pub const FRIENDS_SNAPSHOT_MAX_AGE_MS: i64 = 15_000;

/// FriendsSnapshot: what the friends window paints on its first frame.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FriendsSnapshot {
    pub friends: Vec<UserFriend>,
    pub online_friends: i64,
    pub friend_requests: Vec<FriendRequest>,
}

/// FriendsSnapshotCache: one fetch at a time, results from before a
/// sign-out dropped. `now` in ms.
#[derive(Debug, Default)]
pub struct FriendsSnapshotCache {
    snapshot: Option<FriendsSnapshot>,
    fetched_at: i64,
    in_flight: Option<u64>,
    generation: u64,
}

impl FriendsSnapshotCache {
    /// prefetch, first half: the snapshot when it is fresh enough.
    pub fn fresh(&self, now: i64) -> Option<&FriendsSnapshot> {
        self.snapshot
            .as_ref()
            .filter(|_| now - self.fetched_at < FRIENDS_SNAPSHOT_MAX_AGE_MS)
    }

    /// Whether a fetch is running (prefetch and get wait for it).
    pub fn is_fetching(&self) -> bool {
        self.in_flight.is_some()
    }

    /// prefetch: Some(token) when a fetch should start now (none running);
    /// fetch /profile/friends + /profile/friend-requests, then `finish_fetch`.
    pub fn begin_fetch(&mut self) -> Option<u64> {
        if self.in_flight.is_some() {
            return None;
        }
        self.in_flight = Some(self.generation);
        Some(self.generation)
    }

    /// fetchSnapshot's end: stores the snapshot unless the user signed out
    /// meanwhile. Returns whether it was stored.
    pub fn finish_fetch(
        &mut self,
        token: u64,
        snapshot: Option<FriendsSnapshot>,
        now: i64,
    ) -> bool {
        if self.in_flight == Some(token) {
            self.in_flight = None;
        }
        let Some(snapshot) = snapshot else {
            return false;
        };
        if token != self.generation {
            return false;
        }
        self.snapshot = Some(snapshot);
        self.fetched_at = now;
        true
    }

    /// get: whatever is cached (once any running fetch has finished).
    pub fn get(&self) -> Option<&FriendsSnapshot> {
        self.snapshot.as_ref()
    }

    /// clear (sign-out)
    pub fn clear(&mut self) {
        self.snapshot = None;
        self.fetched_at = 0;
        self.in_flight = None;
        self.generation += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const MINIMUM: (u32, u32) = (420, 560);

    fn rect(x: f64, y: f64, width: f64, height: f64) -> WindowRect {
        WindowRect {
            x,
            y,
            width,
            height,
        }
    }

    fn areas() -> Vec<WindowRect> {
        vec![rect(0.0, 0.0, 1920.0, 1040.0)]
    }

    fn at(x: i32, y: i32, width: i32, height: i32) -> Option<ResolvedWindowBounds> {
        Some(ResolvedWindowBounds {
            position: Some((x, y)),
            width,
            height,
        })
    }

    fn sized(width: i32, height: i32) -> Option<ResolvedWindowBounds> {
        Some(ResolvedWindowBounds {
            position: None,
            width,
            height,
        })
    }

    #[test]
    fn window_bounds() {
        let resolve = |saved: WindowRect, areas: &[WindowRect]| {
            resolve_social_window_bounds(Some(&saved), areas, MINIMUM)
        };
        assert_eq!(
            resolve(rect(1400.0, 120.0, 500.0, 800.0), &areas()),
            at(1400, 120, 500, 800)
        );
        assert_eq!(
            resolve(rect(3000.0, 200.0, 500.0, 800.0), &areas()),
            sized(500, 800)
        );
        assert_eq!(
            resolve(rect(10.0, 10.0, 200.0, 300.0), &areas()),
            at(10, 10, 420, 560)
        );
        assert_eq!(
            resolve(rect(200.0, -300.0, 500.0, 800.0), &areas()),
            sized(500, 800)
        );
        assert_eq!(
            resolve(rect(1850.0, 100.0, 500.0, 800.0), &areas()),
            sized(500, 800)
        );
        let mut two = areas();
        two.push(rect(-1920.0, 0.0, 1920.0, 1080.0));
        assert_eq!(
            resolve(rect(-1500.0, 100.0, 600.0, 700.0), &two),
            at(-1500, 100, 600, 700)
        );
        assert_eq!(resolve_social_window_bounds(None, &areas(), MINIMUM), None);
        assert_eq!(resolve(rect(f64::NAN, 0.0, 500.0, 600.0), &areas()), None);
    }

    fn friend(id: &str) -> UserFriend {
        UserFriend {
            id: id.into(),
            display_name: id.into(),
            ..Default::default()
        }
    }

    #[test]
    fn restore_plans() {
        let session = SocialWindowsSession {
            friends_window_open: true,
            chat_friends: vec![friend("aaaaaaaa"), friend("bbbbbbbb")],
            active_chat_friend_id: Some("bbbbbbbb".into()),
            top_window: Some(SocialWindowKind::Chat),
        };
        let plan = get_social_windows_restore_plan(Some(&session), false);
        assert!(plan.open_friends_window);
        assert_eq!(plan.chat_friends.len(), 2);
        assert_eq!(plan.active_chat_friend_id.as_deref(), Some("bbbbbbbb"));
        assert_eq!(
            plan.show_order,
            vec![SocialWindowKind::Friends, SocialWindowKind::Chat]
        );

        let startup = get_social_windows_restore_plan(None, true);
        assert!(startup.open_friends_window);
        assert_eq!(startup.show_order, vec![SocialWindowKind::Friends]);

        assert_eq!(
            get_social_windows_restore_plan(None, false),
            SocialWindowsRestorePlan::default()
        );

        let old: SocialWindowsSession =
            serde_json::from_value(json!({ "chatFriendIds": ["aaaaaaaa"] })).unwrap();
        let plan = get_social_windows_restore_plan(Some(&old), false);
        assert!(plan.chat_friends.is_empty());
        assert!(plan.show_order.is_empty());
        let garbage: SocialWindowsSession =
            serde_json::from_value(json!({ "chatFriends": "x" })).unwrap();
        assert!(garbage.chat_friends.is_empty());
    }

    #[test]
    fn stacking() {
        use SocialWindowKind::{Chat, Friends};
        assert_eq!(
            get_social_windows_show_order(true, true, Some(Chat)),
            vec![Friends, Chat]
        );
        assert_eq!(
            get_social_windows_show_order(true, true, Some(Friends)),
            vec![Chat, Friends]
        );
        assert_eq!(
            get_top_social_window(true, true, Some(Friends)),
            Some(Friends)
        );
        assert_eq!(get_top_social_window(true, true, None), Some(Chat));
        assert_eq!(
            get_top_social_window(true, false, Some(Chat)),
            Some(Friends)
        );
        assert_eq!(get_top_social_window(false, false, Some(Chat)), None);
        let ordered: Vec<_> = order_chat_friends(
            &["bbbbbbbb", "aaaaaaaa", "cccccccc"],
            &[friend("aaaaaaaa"), friend("bbbbbbbb")],
        )
        .into_iter()
        .map(|f| f.id)
        .collect();
        assert_eq!(ordered, vec!["bbbbbbbb", "aaaaaaaa"]);
    }

    #[test]
    fn sessions_keep_the_active_conversation() {
        let chat = ChatWindowState {
            active_friend_id: Some("bbbbbbbb".into()),
            open_friend_ids: vec!["aaaaaaaa".into(), "bbbbbbbb".into()],
            open_friends: vec![friend("aaaaaaaa"), friend("bbbbbbbb")],
        };
        let session = social_windows_session(true, true, &chat, Some(SocialWindowKind::Friends));
        assert_eq!(session.chat_friends, vec![friend("bbbbbbbb")]);
        assert_eq!(session.active_chat_friend_id.as_deref(), Some("bbbbbbbb"));
        assert_eq!(session.top_window, Some(SocialWindowKind::Friends));
        assert_eq!(
            serde_json::to_value(&session).unwrap()["topWindow"],
            json!("friends")
        );

        let closed = social_windows_session(false, false, &chat, None);
        assert!(closed.chat_friends.is_empty());
        assert_eq!(closed.active_chat_friend_id, None);
        assert_eq!(closed.top_window, None);

        let none_active = ChatWindowState {
            active_friend_id: None,
            ..chat.clone()
        };
        assert_eq!(
            social_windows_session(false, true, &none_active, None).chat_friends,
            vec![friend("aaaaaaaa")]
        );
    }

    #[test]
    fn chat_window_state_checks_ids() {
        let state = ChatWindowState {
            active_friend_id: Some("../x".into()),
            open_friend_ids: vec!["aaaaaaaa".into(), "bad".into()],
            open_friends: vec![friend("aaaaaaaa"), friend("no")],
        }
        .sanitized();
        assert_eq!(state.active_friend_id, None);
        assert_eq!(state.open_friend_ids, vec!["aaaaaaaa".to_string()]);
        assert_eq!(state.open_friends.len(), 1);
    }

    #[test]
    fn restore_chat_window() {
        let friends = [friend("aaaaaaaa"), friend("bbbbbbbb")];
        let (active, pending) = restore_chat_window_plan(&friends, Some("bbbbbbbb")).unwrap();
        assert_eq!(active.id, "bbbbbbbb");
        assert_eq!(pending.len(), 2);
        assert!(pending.iter().all(|p| !p.is_background));
        assert_eq!(
            restore_chat_window_plan(&friends, Some("zzzzzzzz"))
                .unwrap()
                .0
                .id,
            "aaaaaaaa"
        );
        assert!(restore_chat_window_plan(&[], None).is_none());
    }

    #[test]
    fn bounds_json() {
        let mut bounds: SocialWindowsBounds = serde_json::from_value(json!({
            "friends": { "x": 10, "y": 20, "width": 420, "height": 780 }
        }))
        .unwrap();
        assert_eq!(
            bounds.get(SocialWindowKind::Friends),
            Some(rect(10.0, 20.0, 420.0, 780.0))
        );
        assert_eq!(bounds.get(SocialWindowKind::Chat), None);
        bounds.set(SocialWindowKind::Chat, rect(1.0, 2.0, 560.0, 560.0));
        assert_eq!(
            serde_json::to_value(bounds).unwrap()["chat"],
            json!({ "x": 1.0, "y": 2.0, "width": 560.0, "height": 560.0 })
        );
    }

    #[test]
    fn friends_snapshot_cache() {
        let mut cache = FriendsSnapshotCache::default();
        let token = cache.begin_fetch().unwrap();
        assert!(cache.begin_fetch().is_none());
        assert!(cache.finish_fetch(token, Some(FriendsSnapshot::default()), 1_000));
        assert!(
            cache
                .fresh(1_000 + FRIENDS_SNAPSHOT_MAX_AGE_MS - 1)
                .is_some()
        );
        assert!(cache.fresh(1_000 + FRIENDS_SNAPSHOT_MAX_AGE_MS).is_none());
        assert!(cache.get().is_some());

        let token = cache.begin_fetch().unwrap();
        cache.clear();
        assert!(!cache.finish_fetch(token, Some(FriendsSnapshot::default()), 2_000));
        assert!(cache.get().is_none());
        assert!(!cache.is_fetching());
    }
}
