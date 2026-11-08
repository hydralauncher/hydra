//! The friends window's pure parts: add-friend-errors.ts,
//! friends-window-layout.ts and shared/profile-friends.ts.

use std::collections::{HashMap, HashSet};

use super::dto::{ProfileFriends, UserFriend};
use super::time::{js_trim, parse_ms};

/// GET path for the friends list: the API reports a friend's current game
/// for Steam and Epic only unless asked, so Classics are asked for too.
pub const PROFILE_FRIENDS_PATH: &str = "/profile/friends?shop=steam&shop=launchbox";
pub const PROFILE_FRIENDS_PAGE_SIZE: u32 = 100;

/// friends-window.tsx PAGE_SIZE for /profile/friends/search.
pub const FRIENDS_SEARCH_PAGE_SIZE: u32 = 100;
pub const FRIENDS_SEARCH_PATH: &str = "/profile/friends/search";
/// friends-window.tsx: the search waits this long after the last keystroke.
pub const FRIENDS_SEARCH_DEBOUNCE_MS: u64 = 300;
/// friends-window.tsx COPIED_FEEDBACK_MS
pub const COPIED_FEEDBACK_MS: u64 = 1200;
/// friends-window.tsx MAX_UNREAD_BADGE_COUNT ("99+")
pub const MAX_UNREAD_BADGE_COUNT: i64 = 99;
/// friends-window.tsx: avatars are processed at these sizes (px).
pub const FRIEND_AVATAR_IMAGE_SIZE: (u32, u32) = (80, 80);
pub const PROFILE_AVATAR_IMAGE_SIZE: (u32, u32) = (112, 112);
/// friends-window.tsx: skeleton rows, [name width, status width] in px.
pub const ONLINE_SKELETON_ROWS: [(u32, u32); 3] = [(128, 92), (96, 52), (150, 108)];
pub const OFFLINE_SKELETON_ROWS: [(u32, u32); 6] = [
    (112, 48),
    (140, 48),
    (84, 48),
    (124, 48),
    (100, 48),
    (136, 48),
];
/// Rows from this index on fade out, each losing SKELETON_FADE_STEP opacity.
pub const SKELETON_FADE_FROM_ROW: usize = 3;
pub const SKELETON_FADE_STEP: f32 = 0.25;
pub const SKELETON_ROW_STAGGER_MS: u64 = 90;

/// add-friend-request.ts: the main window asks an open friends window to
/// start in add mode through this localStorage key (a timestamp in ms).
pub const ADD_FRIEND_REQUEST_STORAGE_KEY: &str = "friends-window-add-friend-request";
/// An older request is one whose window never opened.
pub const ADD_FRIEND_REQUEST_MAX_AGE_MS: i64 = 10_000;

/// consumeAddFriendRequest's check, given the stored value and the time.
pub fn is_fresh_add_friend_request(stored: Option<&str>, now: i64) -> bool {
    let requested_at = stored
        .and_then(|value| value.trim().parse::<f64>().ok())
        .unwrap_or(0.0);
    requested_at != 0.0 && (now as f64 - requested_at) < ADD_FRIEND_REQUEST_MAX_AGE_MS as f64
}

/// BACKGROUND_IMAGE_SIZES: banners processed once at twice the default size.
pub const BACKGROUND_IMAGE_SCALE: u32 = 2;
pub const PROFILE_BACKGROUND_IMAGE_SIZE: (u32, u32) =
    (420 * BACKGROUND_IMAGE_SCALE, 180 * BACKGROUND_IMAGE_SCALE);
pub const FRIEND_BACKGROUND_IMAGE_SIZE: (u32, u32) =
    (480 * BACKGROUND_IMAGE_SCALE, 96 * BACKGROUND_IMAGE_SCALE);

/// sortFriendsByUnreadMessages: friends with unread messages first, latest
/// message first; the rest keep their order.
pub fn sort_friends_by_unread_messages<'a>(
    friends: &'a [UserFriend],
    unread_by_friend: &HashMap<String, i64>,
    last_message_at_by_friend: &HashMap<String, String>,
) -> Vec<&'a UserFriend> {
    let unread = |id: &str| unread_by_friend.get(id).copied().unwrap_or(0) > 0;
    let time = |id: &str| {
        last_message_at_by_friend
            .get(id)
            .and_then(|at| parse_ms(at))
            .unwrap_or(0)
    };
    let mut with_unread: Vec<&UserFriend> = friends.iter().filter(|f| unread(&f.id)).collect();
    with_unread.sort_by_key(|f| std::cmp::Reverse(time(&f.id)));
    with_unread.extend(friends.iter().filter(|f| !unread(&f.id)));
    with_unread
}

/// fetchAllProfileFriends: every page after the first, friends repeated
/// across pages dropped. Pages are fetched one after another.
pub fn fetch_all_profile_friends<E>(
    mut fetch_page: impl FnMut(u32, u32) -> Result<ProfileFriends, E>,
) -> Result<ProfileFriends, E> {
    let first = fetch_page(PROFILE_FRIENDS_PAGE_SIZE, 0)?;
    let mut pages = vec![first];
    let total = pages[0].total_friends.max(0) as u64;
    let mut skip = PROFILE_FRIENDS_PAGE_SIZE as u64;
    while skip < total {
        pages.push(fetch_page(PROFILE_FRIENDS_PAGE_SIZE, skip as u32)?);
        skip += PROFILE_FRIENDS_PAGE_SIZE as u64;
    }

    let mut seen = HashSet::new();
    let mut friends = Vec::new();
    for page in &mut pages {
        for friend in page.friends.drain(..) {
            if seen.insert(friend.id.clone()) {
                friends.push(friend);
            }
        }
    }
    Ok(ProfileFriends {
        total_friends: pages[0].total_friends,
        online_friends: pages[0].online_friends,
        friends,
    })
}

/// FRIEND_CODE_LENGTH
pub const FRIEND_CODE_LENGTH: usize = 8;

/// AddFriendErrorKey (friends_window translation keys).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AddFriendErrorKey {
    AlreadyFriends,
    FriendRequestPending,
    FriendCodeNotFound,
}

impl AddFriendErrorKey {
    pub fn as_str(self) -> &'static str {
        match self {
            AddFriendErrorKey::AlreadyFriends => "already_friends",
            AddFriendErrorKey::FriendRequestPending => "friend_request_pending",
            AddFriendErrorKey::FriendCodeNotFound => "friend_code_not_found",
        }
    }
}

/// getAddFriendErrorKey, from the error message (`ApiError::to_string()`
/// carries the API's code).
pub fn get_add_friend_error_key(error_message: &str) -> Option<AddFriendErrorKey> {
    const CODES: [(&str, AddFriendErrorKey); 4] = [
        (
            "friendship/users-already-friends",
            AddFriendErrorKey::AlreadyFriends,
        ),
        (
            "friendship/has-pending-invitation",
            AddFriendErrorKey::FriendRequestPending,
        ),
        (
            "friendship/not-found",
            AddFriendErrorKey::FriendCodeNotFound,
        ),
        ("user/not-found", AddFriendErrorKey::FriendCodeNotFound),
    ];
    CODES
        .iter()
        .find(|(code, _)| error_message.contains(code))
        .map(|(_, key)| *key)
}

/// `/\b404\b/`
fn has_word_404(text: &str) -> bool {
    let bytes = text.as_bytes();
    let is_word = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    text.match_indices("404").any(|(at, _)| {
        (at == 0 || !is_word(bytes[at - 1])) && bytes.get(at + 3).is_none_or(|&b| !is_word(b))
    })
}

/// isUserNotFoundError
pub fn is_user_not_found_error(error_message: &str) -> bool {
    error_message.contains("user/not-found") || has_word_404(error_message)
}

/// normalizeFriendCode: trimmed and cut to eight characters.
pub fn normalize_friend_code(value: &str) -> String {
    js_trim(value).chars().take(FRIEND_CODE_LENGTH).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn friend(id: &str) -> UserFriend {
        UserFriend {
            id: id.into(),
            ..Default::default()
        }
    }

    #[test]
    fn add_friend_errors() {
        assert_eq!(
            get_add_friend_error_key("friendship/users-already-friends"),
            Some(AddFriendErrorKey::AlreadyFriends)
        );
        assert_eq!(
            get_add_friend_error_key("friendship/has-pending-invitation"),
            Some(AddFriendErrorKey::FriendRequestPending)
        );
        assert_eq!(
            get_add_friend_error_key("user/not-found"),
            Some(AddFriendErrorKey::FriendCodeNotFound)
        );
        assert_eq!(get_add_friend_error_key("network down"), None);

        assert!(is_user_not_found_error("user/not-found"));
        assert!(is_user_not_found_error(
            "Request failed with status code 404"
        ));
        assert!(!is_user_not_found_error("profile/profile-not-visibile"));
        assert!(!is_user_not_found_error("code 4040"));

        assert_eq!(normalize_friend_code("  abcd1234xyz "), "abcd1234");
    }

    #[test]
    fn background_sizes() {
        assert_eq!(PROFILE_BACKGROUND_IMAGE_SIZE, (840, 360));
        assert_eq!(FRIEND_BACKGROUND_IMAGE_SIZE, (960, 192));
    }

    fn ids(friends: Vec<&UserFriend>) -> Vec<&str> {
        friends.iter().map(|f| f.id.as_str()).collect()
    }

    #[test]
    fn sorts_by_unread() {
        let list = [friend("a"), friend("b"), friend("c"), friend("d")];
        let unread = HashMap::from([("b".to_string(), 1), ("d".to_string(), 3)]);
        let at = HashMap::from([
            ("b".to_string(), "2026-10-20T10:00:00Z".to_string()),
            ("d".to_string(), "2026-10-21T09:00:00Z".to_string()),
        ]);
        assert_eq!(
            ids(sort_friends_by_unread_messages(&list, &unread, &at)),
            vec!["d", "b", "a", "c"]
        );

        let list = [friend("a"), friend("b"), friend("c")];
        assert_eq!(
            ids(sort_friends_by_unread_messages(
                &list,
                &HashMap::new(),
                &HashMap::new()
            )),
            vec!["a", "b", "c"]
        );

        let unread = HashMap::from([("a".to_string(), 1), ("c".to_string(), 2)]);
        let at = HashMap::from([("c".to_string(), "2026-10-21T09:00:00Z".to_string())]);
        assert_eq!(
            ids(sort_friends_by_unread_messages(&list, &unread, &at)),
            vec!["c", "a", "b"]
        );
    }

    fn pager(count: usize, online: i64) -> (Vec<UserFriend>, i64) {
        (
            (0..count).map(|i| friend(&format!("f{i}"))).collect(),
            online,
        )
    }

    #[test]
    fn loads_every_page() {
        let (all, online) = pager(250, 30);
        let mut requests = Vec::new();
        let result = fetch_all_profile_friends(|take, skip| {
            requests.push((take, skip));
            Ok::<_, ()>(ProfileFriends {
                total_friends: all.len() as i64,
                online_friends: online,
                friends: all
                    .iter()
                    .skip(skip as usize)
                    .take(take as usize)
                    .cloned()
                    .collect(),
            })
        })
        .unwrap();
        assert_eq!(result.friends.len(), 250);
        assert_eq!(result.total_friends, 250);
        assert_eq!(result.online_friends, 30);
        assert_eq!(
            requests.iter().map(|r| r.1).collect::<Vec<_>>(),
            vec![0, 100, 200]
        );
        assert!(requests.iter().all(|r| r.0 == PROFILE_FRIENDS_PAGE_SIZE));
    }

    #[test]
    fn single_page_and_duplicates() {
        let (all, _) = pager(40, 0);
        let mut count = 0;
        let result = fetch_all_profile_friends(|_, _| {
            count += 1;
            Ok::<_, ()>(ProfileFriends {
                total_friends: 40,
                online_friends: 0,
                friends: all.clone(),
            })
        })
        .unwrap();
        assert_eq!(result.friends.len(), 40);
        assert_eq!(count, 1);

        let (hundred, _) = pager(100, 0);
        let result = fetch_all_profile_friends(|_, skip| {
            Ok::<_, ()>(ProfileFriends {
                total_friends: 150,
                online_friends: 0,
                friends: if skip == 0 {
                    hundred.clone()
                } else {
                    vec![hundred[99].clone(), friend("extra")]
                },
            })
        })
        .unwrap();
        assert_eq!(result.friends.len(), 101);
    }

    #[test]
    fn add_friend_requests_expire() {
        assert!(is_fresh_add_friend_request(Some("1000"), 5_000));
        assert!(!is_fresh_add_friend_request(Some("1000"), 20_000));
        assert!(!is_fresh_add_friend_request(None, 5_000));
        assert!(!is_fresh_add_friend_request(Some("junk"), 5_000));
    }
}
