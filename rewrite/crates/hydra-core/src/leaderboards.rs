//! The leaderboards page's data rules: request paths, response normalizers,
//! board states, the viewer's insight, the week, the play-activity heatmap
//! and badges (src/renderer/src/pages/leaderboards/global-leaderboard.ts,
//! pages/game-details/leaderboard/game-leaderboard.ts,
//! src/shared/leaderboard-notifications.ts), plus the 60s response cache
//! (helpers/response-cache.ts) the page reads through.

use std::collections::{HashMap, HashSet, VecDeque};

use chrono::{DateTime, Datelike};
use serde_json::Value;

pub const TAKE: u32 = 100;
pub const PAGE_SIZE: usize = 13;
pub const PAGE_STEP: usize = 10;
pub const PODIUM_SIZE: usize = 3;
pub const PLAY_ACTIVITY_WEEKS: u32 = 53;
/// Older backends cap play activity at 26 weeks and answer 400 above it.
pub const PLAY_ACTIVITY_FALLBACK_WEEKS: u32 = 26;
pub const BADGES_PAGE_SIZE: usize = 8;
pub const FRIEND_STREAK_PAGE_SIZE: usize = 6;
/// MAX_MINUTES_TO_SHOW_IN_PLAYTIME (renderer constants.ts).
pub const MAX_MINUTES_TO_SHOW_IN_PLAYTIME: f64 = 120.0;
pub const DAY_MS: i64 = 86_400_000;
pub const DAYS_PER_WEEK: usize = 7;
const WEEK_MS: i64 = 7 * DAY_MS;
const MIN_PROGRESS: u32 = 4;
const FRACTIONAL_HOURS_LIMIT: f64 = 10.0;
const PLAY_LEVEL_LOW_SECONDS: f64 = 3600.0;
const PLAY_LEVEL_HIGH_SECONDS: f64 = 3.0 * 3600.0;
const HEATMAP_MONTH_MIN_WEEKS: usize = 3;
const HEATMAP_MONTH_END_WEEKS: usize = 2;
// Keep in sync with the activity graph (leaderboards.scss).
const HEATMAP_DAY_LABELS_WIDTH: f64 = 36.0;
const HEATMAP_GAP: f64 = 6.0;
const HEATMAP_MIN_CELL_SIZE: f64 = 12.0;
const HEATMAP_MAX_CELL_SIZE: f64 = 32.0;
const BOARD_PODIUM_LAST_RANK: u32 = 3;
/// Merged into "reviews" by the API (hydra-api#858), so it is never listed.
const EXCLUDED_METRICS: [&str; 1] = ["review_upvotes"];

pub const PERIODS: [&str; 2] = ["week", "all"];
pub const SCOPES: [&str; 2] = ["global", "friends"];
pub const TABS: [&str; 3] = ["ranking", "games", "stats"];

// ---- values -------------------------------------------------------------

fn record(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    value.as_object()
}

/// A finite JSON number.
fn number(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| n.is_finite())
}

/// toPositiveInteger
fn positive_integer(value: &Value) -> Option<u32> {
    number(value)
        .filter(|n| *n > 0.0 && n.fract() == 0.0 && *n <= u32::MAX as f64)
        .map(|n| n as u32)
}

/// toNonNegativeNumber
fn non_negative(value: &Value, fallback: f64) -> f64 {
    number(value).filter(|n| *n >= 0.0).unwrap_or(fallback)
}

/// toStringOrNull
fn string_or_none(value: &Value) -> Option<String> {
    value.as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

fn text(value: &Value) -> String {
    value.as_str().unwrap_or_default().to_string()
}

/// `encodeURIComponent`.
pub fn encode_uri_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

// ---- types --------------------------------------------------------------

#[derive(Clone, Debug, Default, PartialEq)]
pub struct User {
    pub id: String,
    pub display_name: String,
    pub profile_image_url: Option<String>,
    pub background_image_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub rank: u32,
    pub value: f64,
    pub user: User,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Viewer {
    pub rank: u32,
    pub value: f64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Review {
    pub game_title: String,
    pub shop: String,
    pub object_id: String,
    pub cover_image_url: Option<String>,
    pub score: f64,
    pub created_at: Option<String>,
    pub text: String,
    /// Translated text by base language ("pt"), like GameReview.
    pub translations: HashMap<String, String>,
    pub detected_language: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Extras {
    pub previous_rank: Option<u32>,
    pub streak_active: Option<bool>,
    pub review: Option<Review>,
}

/// GlobalLeaderboard (also the shape of a game board on the page).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Board {
    pub entries: Vec<Entry>,
    pub viewer: Option<Viewer>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub total: Option<f64>,
    pub viewer_previous_rank: Option<u32>,
    pub extras: HashMap<String, Extras>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValueType {
    Duration,
    Count,
    Days,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Metric {
    pub id: String,
    pub value_type: ValueType,
    pub label: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoardState {
    Loading,
    Error,
    Ready,
    Empty,
    EmptyFriends,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MyGame {
    pub shop: String,
    pub object_id: String,
    pub title: String,
    pub cover_image_url: Option<String>,
    pub hero_image_url: Option<String>,
    pub rank: u32,
    pub previous_rank: Option<u32>,
    /// Players on the board; None while the API does not know it.
    pub total: Option<u64>,
    pub leader: Option<User>,
}

impl MyGame {
    /// gameKey
    pub fn key(&self) -> String {
        game_key(&self.shop, &self.object_id)
    }
}

pub fn game_key(shop: &str, object_id: &str) -> String {
    format!("{shop}:{object_id}")
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlayDay {
    pub date: String,
    pub seconds: f64,
    pub games: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlayActivity {
    /// Weeks the API answered for, which can be fewer than asked for.
    pub weeks: u32,
    pub current_streak: f64,
    pub best_streak: f64,
    pub played_today: bool,
    pub days: Vec<PlayDay>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FriendStreak {
    pub user: User,
    pub days: f64,
    pub best_days: f64,
    pub active: bool,
    pub online: bool,
}

pub const BADGE_KINDS: [&str; 5] = [
    "top_percent",
    "weekly_leader",
    "top_rank",
    "friends_podium",
    "streak_record",
];
pub const BADGE_TIERS: [&str; 4] = ["gold", "silver", "bronze", "streak"];

/// The badge a locked game badge leads to ("Top 10", "Top 5%").
#[derive(Clone, Debug, PartialEq)]
pub struct BadgeTarget {
    pub kind: String,
    pub value: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Badge {
    pub id: String,
    pub kind: String,
    pub tier: String,
    pub metric: Option<String>,
    pub scope: String,
    pub game_title: Option<String>,
    pub cover_image_url: Option<String>,
    pub value: f64,
    pub week: Option<u32>,
    pub current_rank: Option<u32>,
    pub earned_at: Option<String>,
    pub progress: Option<(f64, f64)>,
    pub target: Option<BadgeTarget>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Badges {
    pub earned: f64,
    pub total: f64,
    pub badges: Vec<Badge>,
}

// ---- requests -----------------------------------------------------------

/// buildLeaderboardBoardPath (shared/leaderboard-notifications.ts).
pub fn board_path(metric: &str, game: Option<(&str, &str)>) -> String {
    match game {
        Some((shop, object_id)) => format!(
            "/games/{shop}/{}/leaderboards/{}",
            encode_uri_component(object_id),
            encode_uri_component(metric)
        ),
        None => format!("/leaderboards/{}", encode_uri_component(metric)),
    }
}

/// A GET the page makes: path, params and whether it needs the session.
#[derive(Clone, Debug, PartialEq)]
pub struct Request {
    pub path: String,
    pub params: Vec<(String, String)>,
    pub needs_auth: bool,
}

impl Request {
    pub fn new(path: impl Into<String>, params: &[(&str, String)], needs_auth: bool) -> Self {
        Request {
            path: path.into(),
            params: params
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
            needs_auth,
        }
    }

    pub fn param(&self, name: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    /// getRequestKey: `account|path?sorted params|auth=bool`.
    pub fn key(&self, account_id: Option<&str>) -> String {
        let mut params: Vec<String> = self
            .params
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect();
        params.sort();
        format!(
            "{}|{}?{}|auth={}",
            account_id.unwrap_or("guest"),
            self.path,
            params.join("&"),
            self.needs_auth
        )
    }
}

/// buildGlobalLeaderboardRequest
pub fn global_request(metric: &str, period: &str, scope: &str, logged_in: bool) -> Request {
    let scope = if logged_in { scope } else { "global" };
    Request::new(
        board_path(metric, None),
        &[
            ("window", period.to_string()),
            ("scope", scope.to_string()),
            ("take", TAKE.to_string()),
        ],
        logged_in,
    )
}

/// The game board on the Rankings page (by-game-tab.tsx).
pub fn game_request(
    metric: &str,
    shop: &str,
    object_id: &str,
    period: &str,
    scope: &str,
) -> Request {
    Request::new(
        board_path(metric, Some((shop, object_id))),
        &[
            ("range", period.to_string()),
            ("scope", scope.to_string()),
            ("take", TAKE.to_string()),
        ],
        true,
    )
}

/// buildMetricsRequest
pub fn metrics_request(scope: &str) -> Request {
    Request::new(
        "/leaderboards/metrics",
        &[("scope", scope.to_string())],
        false,
    )
}

/// buildGameLeaderboardPath: the Rankings page on a game's board.
pub fn game_page_link(
    shop: &str,
    object_id: &str,
    period: &str,
    scope: &str,
    metric: &str,
) -> String {
    let pairs = [
        ("tab", "games"),
        ("shop", shop),
        ("objectId", object_id),
        ("period", period),
        ("scope", scope),
        ("metric", metric),
    ];
    let query: Vec<String> = pairs
        .iter()
        .map(|(k, v)| format!("{k}={}", search_param(v)))
        .collect();
    format!("/leaderboards?{}", query.join("&"))
}

/// URLSearchParams serialization (spaces as `+`).
fn search_param(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'*' => {
                out.push(byte as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

// ---- normalizers --------------------------------------------------------

/// normalizeUser (global-leaderboard.ts: empty strings read as missing).
pub fn normalize_user(value: &Value) -> Option<User> {
    let object = record(value)?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())?;
    Some(User {
        id: id.to_string(),
        display_name: text(object.get("displayName").unwrap_or(&Value::Null)),
        profile_image_url: string_or_none(object.get("profileImageUrl").unwrap_or(&Value::Null)),
        background_image_url: string_or_none(
            object.get("backgroundImageUrl").unwrap_or(&Value::Null),
        ),
    })
}

fn entry_value(object: &serde_json::Map<String, Value>) -> Option<f64> {
    object.get("value").and_then(number).filter(|n| *n >= 0.0)
}

fn normalize_entry(value: &Value) -> Option<Entry> {
    let object = record(value)?;
    let user = normalize_user(object.get("user")?)?;
    let rank = positive_integer(object.get("rank")?)?;
    let value = entry_value(object)?;
    Some(Entry { rank, value, user })
}

fn normalize_viewer(value: &Value) -> Option<Viewer> {
    let object = record(value)?;
    Some(Viewer {
        rank: positive_integer(object.get("rank")?)?,
        value: entry_value(object)?,
    })
}

fn normalize_translations(value: &Value) -> HashMap<String, String> {
    record(value)
        .map(|object| {
            object
                .iter()
                .filter_map(|(k, v)| {
                    v.as_str()
                        .filter(|s| !s.is_empty())
                        .map(|s| (k.clone(), s.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_review(value: &Value) -> Option<Review> {
    let object = record(value)?;
    let body = object.get("text")?.as_str()?;
    let field = |name: &str| object.get(name).unwrap_or(&Value::Null);
    Some(Review {
        game_title: text(field("gameTitle")),
        shop: text(field("shop")),
        object_id: text(field("objectId")),
        cover_image_url: string_or_none(field("coverImageUrl")),
        score: non_negative(field("score"), 0.0),
        created_at: string_or_none(field("createdAt")),
        text: body.to_string(),
        translations: normalize_translations(field("translations")),
        detected_language: string_or_none(field("detectedLanguage")),
    })
}

/// normalizeGlobalLeaderboardResponse (with normalizeLeaderboardResponse):
/// entries sorted by rank, one per user. None for a malformed response.
pub fn normalize_board(response: &Value) -> Option<Board> {
    let object = record(response)?;
    let raw = object
        .get("entries")
        .filter(|v| !v.is_null())
        .or_else(|| object.get("users"))?
        .as_array()?;
    let mut entries: Vec<Entry> = raw.iter().filter_map(normalize_entry).collect();
    entries.sort_by_key(|e| e.rank);
    let mut seen = HashSet::new();
    entries.retain(|e| seen.insert(e.user.id.clone()));

    let mut extras = HashMap::new();
    for item in raw {
        let Some(item) = record(item) else { continue };
        let Some(user) = item.get("user").and_then(normalize_user) else {
            continue;
        };
        let field = |name: &str| item.get(name).unwrap_or(&Value::Null);
        extras.insert(
            user.id,
            Extras {
                previous_rank: positive_integer(field("previousRank")),
                streak_active: field("streakActive").as_bool(),
                review: normalize_review(field("review")),
            },
        );
    }

    let field = |name: &str| object.get(name).filter(|v| !v.is_null());
    let viewer = object.get("viewer").unwrap_or(&Value::Null);
    Some(Board {
        entries,
        viewer: normalize_viewer(viewer),
        period_start: field("weekStart")
            .or_else(|| field("periodStart"))
            .and_then(string_or_none),
        period_end: field("weekEnd")
            .or_else(|| field("periodEnd"))
            .and_then(string_or_none),
        total: object.get("total").and_then(number).filter(|n| *n >= 0.0),
        viewer_previous_rank: record(viewer)
            .and_then(|v| v.get("previousRank"))
            .and_then(positive_integer),
        extras,
    })
}

/// normalizeMetricDefinitions: in order, unique, without excluded metrics.
pub fn normalize_metrics(response: &Value) -> Option<Vec<Metric>> {
    let items = match record(response) {
        Some(object) => object.get("metrics")?,
        None => response,
    }
    .as_array()?;
    let mut seen = HashSet::new();
    Some(
        items
            .iter()
            .filter_map(|item| {
                let object = record(item)?;
                let id = object.get("id")?.as_str().filter(|s| !s.is_empty())?;
                if EXCLUDED_METRICS.contains(&id) || !seen.insert(id.to_string()) {
                    return None;
                }
                let value_type = match object.get("valueType").and_then(Value::as_str) {
                    Some("duration") => ValueType::Duration,
                    Some("days") => ValueType::Days,
                    _ => ValueType::Count,
                };
                Some(Metric {
                    id: id.to_string(),
                    value_type,
                    label: object
                        .get("label")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                        .unwrap_or(id)
                        .to_string(),
                })
            })
            .collect(),
    )
}

/// normalizeMyGames
pub fn normalize_my_games(response: &Value) -> Option<Vec<MyGame>> {
    let items = match record(response) {
        Some(object) => object.get("games")?,
        None => response,
    }
    .as_array()?;
    Some(
        items
            .iter()
            .filter_map(|item| {
                let object = record(item)?;
                let field = |name: &str| object.get(name).unwrap_or(&Value::Null);
                let rank = positive_integer(field("rank"))?;
                let shop = field("shop").as_str()?;
                let object_id = field("objectId").as_str()?;
                // A total below the rank is as good as unknown.
                let total = number(field("total"))
                    .filter(|t| *t >= rank as f64)
                    .map(|t| t.floor() as u64);
                Some(MyGame {
                    shop: shop.to_string(),
                    object_id: object_id.to_string(),
                    title: text(field("title")),
                    cover_image_url: string_or_none(field("coverImageUrl")),
                    hero_image_url: string_or_none(field("heroImageUrl")),
                    rank,
                    previous_rank: positive_integer(field("previousRank")),
                    total,
                    leader: normalize_user(field("leader")),
                })
            })
            .collect(),
    )
}

/// normalizePlayActivity
pub fn normalize_play_activity(response: &Value, weeks: u32) -> Option<PlayActivity> {
    let object = record(response)?;
    let days = object.get("days")?.as_array()?;
    let field = |name: &str| object.get(name).unwrap_or(&Value::Null);
    Some(PlayActivity {
        weeks,
        current_streak: non_negative(field("currentStreak"), 0.0),
        best_streak: non_negative(field("bestStreak"), 0.0),
        played_today: field("playedToday").as_bool() == Some(true),
        days: days
            .iter()
            .filter_map(|day| {
                let day = record(day)?;
                Some(PlayDay {
                    date: day.get("date")?.as_str()?.to_string(),
                    seconds: non_negative(day.get("seconds").unwrap_or(&Value::Null), 0.0),
                    games: day
                        .get("games")
                        .and_then(Value::as_array)
                        .map(|games| {
                            games
                                .iter()
                                .filter_map(|g| g.as_str().map(str::to_string))
                                .collect()
                        })
                        .unwrap_or_default(),
                })
            })
            .collect(),
    })
}

/// normalizeFriendStreaks: active first, then by days.
pub fn normalize_friend_streaks(response: &Value) -> Option<Vec<FriendStreak>> {
    let items = match record(response) {
        Some(object) => object.get("friends")?,
        None => response,
    }
    .as_array()?;
    let mut list: Vec<FriendStreak> = items
        .iter()
        .filter_map(|item| {
            let object = record(item)?;
            let field = |name: &str| object.get(name).unwrap_or(&Value::Null);
            Some(FriendStreak {
                user: normalize_user(field("user"))?,
                days: non_negative(field("days"), 0.0),
                best_days: non_negative(field("bestDays"), 0.0),
                active: field("active").as_bool() == Some(true),
                online: field("online").as_bool() == Some(true),
            })
        })
        .collect();
    list.sort_by(|a, b| {
        b.active.cmp(&a.active).then(
            b.days
                .partial_cmp(&a.days)
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });
    Some(list)
}

fn is_top_badge_kind(kind: &str) -> bool {
    kind == "top_rank" || kind == "top_percent"
}

/// normalizeBadgeTarget: `target` when the API sends it, else the locked
/// badge itself (its kind and threshold describe the next badge).
fn badge_target(item: &serde_json::Map<String, Value>) -> Option<BadgeTarget> {
    if item.get("earnedAt").and_then(string_or_none).is_some() {
        return None;
    }
    let explicit = item.get("target").and_then(record);
    let source = explicit.unwrap_or(item);
    let kind = source.get("kind")?.as_str()?;
    if !is_top_badge_kind(kind) {
        return None;
    }
    let threshold = non_negative(source.get("threshold").unwrap_or(&Value::Null), 0.0);
    let value = if explicit.is_some() {
        non_negative(source.get("value").unwrap_or(&Value::Null), threshold)
    } else {
        threshold
    };
    (value != 0.0).then(|| BadgeTarget {
        kind: kind.to_string(),
        value,
    })
}

/// normalizeBadges
pub fn normalize_badges(response: &Value) -> Option<Badges> {
    let object = record(response)?;
    let items = object.get("badges")?.as_array()?;
    let badges: Vec<Badge> = items
        .iter()
        .filter_map(|item| {
            let item = record(item)?;
            let field = |name: &str| item.get(name).unwrap_or(&Value::Null);
            let id = field("id").as_str()?;
            let kind = field("kind").as_str().filter(|k| BADGE_KINDS.contains(k))?;
            let progress = record(field("progress")).map(|p| {
                let current = non_negative(p.get("current").unwrap_or(&Value::Null), 0.0);
                let target = non_negative(p.get("target").unwrap_or(&Value::Null), 1.0);
                (current, if target == 0.0 { 1.0 } else { target })
            });
            Some(Badge {
                id: id.to_string(),
                kind: kind.to_string(),
                tier: field("tier")
                    .as_str()
                    .filter(|t| BADGE_TIERS.contains(t))
                    .unwrap_or("gold")
                    .to_string(),
                metric: string_or_none(field("metric")),
                scope: if field("scope").as_str() == Some("friends") {
                    "friends".into()
                } else {
                    "global".into()
                },
                game_title: string_or_none(field("gameTitle")),
                cover_image_url: string_or_none(field("coverImageUrl")),
                // The N of "Top N" is `threshold`; `value` is the viewer's value.
                value: if is_top_badge_kind(kind) {
                    non_negative(field("threshold"), 0.0)
                } else {
                    non_negative(field("value"), 0.0)
                },
                week: positive_integer(field("week")),
                current_rank: positive_integer(field("currentRank")),
                earned_at: string_or_none(field("earnedAt")),
                progress,
                target: badge_target(item),
            })
        })
        .collect();
    let earned_count = badges.iter().filter(|b| b.earned_at.is_some()).count() as f64;
    let count = badges.len() as f64;
    Some(Badges {
        earned: non_negative(object.get("earned").unwrap_or(&Value::Null), earned_count),
        total: non_negative(object.get("total").unwrap_or(&Value::Null), count),
        badges,
    })
}

/// getBadgeProgress: 0..=100.
pub fn badge_progress(badge: &Badge) -> f64 {
    match badge.progress {
        Some((current, target)) => (current / target * 100.0).round().min(100.0),
        None => 0.0,
    }
}

// ---- boards -------------------------------------------------------------

/// getRowsBelowPodium: by position, so tied ranks are never dropped.
pub fn rows_below_podium<T: Clone>(rows: &[T], listed_count: usize) -> Vec<T> {
    let listed = listed_count.min(rows.len());
    let mut out: Vec<T> = rows
        .get(PODIUM_SIZE.min(listed)..listed)
        .unwrap_or_default()
        .to_vec();
    out.extend_from_slice(&rows[listed..]);
    out
}

/// getBoardState
pub fn board_state(
    is_loading: bool,
    has_error: bool,
    board: Option<&Board>,
    scope: &str,
    viewer_id: Option<&str>,
) -> BoardState {
    let Some(board) = board else {
        return if is_loading {
            BoardState::Loading
        } else {
            BoardState::Error
        };
    };
    if has_error {
        return BoardState::Error;
    }
    let others = board
        .entries
        .iter()
        .filter(|e| Some(e.user.id.as_str()) != viewer_id)
        .count();
    if scope == "friends" && others == 0 {
        return BoardState::EmptyFriends;
    }
    if board.entries.is_empty() {
        return BoardState::Empty;
    }
    BoardState::Ready
}

pub fn has_review_data(board: Option<&Board>) -> bool {
    board.is_some_and(|b| b.extras.values().any(|e| e.review.is_some()))
}

pub fn has_streak_data(board: Option<&Board>) -> bool {
    board.is_some_and(|b| b.extras.values().any(|e| e.streak_active.is_some()))
}

/// getRankDelta: positive when the player climbed.
pub fn rank_delta(rank: u32, previous_rank: Option<u32>) -> Option<i64> {
    previous_rank.map(|previous| previous as i64 - rank as i64)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ranking {
    pub rank: u32,
    pub value: f64,
    pub delta: Option<i64>,
}

/// getViewerRanking
pub fn viewer_ranking(board: Option<&Board>, viewer_id: Option<&str>) -> Option<Ranking> {
    let (board, viewer_id) = (board?, viewer_id?);
    if let Some(listed) = board.entries.iter().find(|e| e.user.id == viewer_id) {
        return Some(Ranking {
            rank: listed.rank,
            value: listed.value,
            delta: rank_delta(
                listed.rank,
                board.extras.get(viewer_id).and_then(|e| e.previous_rank),
            ),
        });
    }
    let viewer = board.viewer?;
    Some(Ranking {
        rank: viewer.rank,
        value: viewer.value,
        delta: rank_delta(viewer.rank, board.viewer_previous_rank),
    })
}

/// The previous rank the board shows for an entry (board-view.tsx).
pub fn previous_rank(board: &Board, entry: &Entry, viewer_id: Option<&str>) -> Option<u32> {
    board
        .extras
        .get(&entry.user.id)
        .and_then(|e| e.previous_rank)
        .or_else(|| {
            (Some(entry.user.id.as_str()) == viewer_id)
                .then_some(board.viewer_previous_rank)
                .flatten()
        })
}

#[derive(Clone, Debug, PartialEq)]
pub enum Insight {
    Leading {
        gap: f64,
        target: Option<User>,
    },
    Outside {
        gap: f64,
        last_rank: u32,
    },
    Ranked {
        rank: u32,
    },
    Unranked,
    Behind {
        gap: f64,
        target: User,
        target_rank: u32,
        /// ("podium" | "lead", gap)
        next: Option<(&'static str, f64)>,
    },
}

/// getBoardInsight: what the viewer needs to climb. None only when signed out.
pub fn insight(board: &Board, viewer_id: Option<&str>) -> Option<Insight> {
    let viewer_id = viewer_id?;
    let Some(ranking) = viewer_ranking(Some(board), Some(viewer_id)) else {
        return Some(Insight::Unranked);
    };
    let ranked = Insight::Ranked { rank: ranking.rank };
    let entries = &board.entries;
    let gap_to = |value: f64| value - ranking.value;

    if ranking.rank == 1 {
        let Some(second) = entries.iter().find(|e| e.user.id != viewer_id) else {
            return Some(Insight::Leading {
                gap: 0.0,
                target: None,
            });
        };
        let gap = ranking.value - second.value;
        return Some(if gap > 0.0 {
            Insight::Leading {
                gap,
                target: Some(second.user.clone()),
            }
        } else {
            ranked
        });
    }

    let Some(above) = entries.iter().rev().find(|e| e.rank < ranking.rank) else {
        return Some(ranked);
    };

    // Past the listed players the next one is unknown: the goal is the list.
    if above.rank != ranking.rank - 1 {
        let list_gap = gap_to(above.value);
        return Some(if list_gap > 0.0 {
            Insight::Outside {
                gap: list_gap,
                last_rank: above.rank,
            }
        } else {
            ranked
        });
    }

    let gap = gap_to(above.value);
    if gap <= 0.0 {
        return Some(ranked);
    }
    let past_podium = ranking.rank > BOARD_PODIUM_LAST_RANK + 1;
    let goal_rank = if past_podium {
        BOARD_PODIUM_LAST_RANK
    } else {
        1
    };
    let goal = entries.iter().find(|e| e.rank == goal_rank);
    let next_gap = match goal {
        Some(goal) if ranking.rank > 2 => gap_to(goal.value),
        _ => 0.0,
    };
    Some(Insight::Behind {
        gap,
        target: above.user.clone(),
        target_rank: above.rank,
        next: (next_gap > 0.0).then_some((if past_podium { "podium" } else { "lead" }, next_gap)),
    })
}

/// A row of the table (buildLeaderboardRows).
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub entry: Entry,
    pub is_viewer: bool,
    pub gap_before: bool,
    pub progress: u32,
}

fn progress(value: f64, top: f64) -> u32 {
    if top <= 0.0 {
        return MIN_PROGRESS;
    }
    ((value / top * 100.0).round() as u32).clamp(MIN_PROGRESS, 100)
}

/// findViewerEntry
pub fn viewer_entry(board: &Board, viewer: Option<&User>) -> Option<Entry> {
    let viewer = viewer?;
    if let Some(listed) = board.entries.iter().find(|e| e.user.id == viewer.id) {
        return Some(listed.clone());
    }
    board.viewer.map(|v| Entry {
        rank: v.rank,
        value: v.value,
        user: viewer.clone(),
    })
}

/// buildLeaderboardRows: the first `size` entries, then the viewer's own row
/// when they are not among them.
pub fn build_rows(board: &Board, viewer: Option<&User>, size: usize) -> Vec<Row> {
    let top = board.entries.first().map(|e| e.value).unwrap_or(0.0);
    let viewer_id = viewer.map(|v| v.id.as_str());
    let to_row = |entry: &Entry, gap_before: bool| Row {
        entry: entry.clone(),
        is_viewer: Some(entry.user.id.as_str()) == viewer_id,
        gap_before,
        progress: progress(entry.value, top),
    };
    let mut rows: Vec<Row> = board
        .entries
        .iter()
        .take(size)
        .map(|e| to_row(e, false))
        .collect();
    let Some(own) = viewer_entry(board, viewer) else {
        return rows;
    };
    if rows.iter().any(|r| r.is_viewer) {
        return rows;
    }
    let last_rank = rows.last().map(|r| r.entry.rank).unwrap_or(0);
    rows.push(to_row(&own, own.rank > last_rank + 1));
    rows
}

// ---- values -------------------------------------------------------------

/// getDurationParts: minutes under `max_minutes`, else hours (one decimal
/// under 10 h).
pub fn duration_parts(seconds: f64, max_minutes: f64) -> (&'static str, f64) {
    let minutes = seconds / 60.0;
    if minutes < max_minutes {
        let amount = if seconds > 0.0 {
            minutes.round().max(1.0)
        } else {
            0.0
        };
        return ("minutes", amount);
    }
    let hours = minutes / 60.0;
    let amount = if hours < FRACTIONAL_HOURS_LIMIT {
        (hours * 10.0).round() / 10.0
    } else {
        hours.round()
    };
    ("hours", amount)
}

/// getRankTier (components/rank-medal/rank-tier.ts).
pub fn rank_tier(rank: u32) -> &'static str {
    match rank {
        1 => "gold",
        2 => "silver",
        3 => "bronze",
        4..=10 => "top10",
        _ => "default",
    }
}

pub fn is_medal_tier(tier: &str) -> bool {
    matches!(tier, "gold" | "silver" | "bronze")
}

// ---- week ---------------------------------------------------------------

/// getUtcWeekRange: Monday 00:00 UTC to the next Monday, in ms.
pub fn utc_week_range(now_ms: i64) -> (i64, i64) {
    let day_start = now_ms.div_euclid(DAY_MS) * DAY_MS;
    let weekday = DateTime::from_timestamp_millis(day_start)
        .map(|d| d.weekday().num_days_from_monday() as i64)
        .unwrap_or(0);
    let start = day_start - weekday * DAY_MS;
    (start, start + WEEK_MS)
}

fn parse_date(text: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|d| d.timestamp_millis())
}

/// resolveWeekRange: the board's period, else the current UTC week.
pub fn resolve_week_range(board: Option<&Board>, now_ms: i64) -> (i64, i64) {
    let (fallback_start, fallback_end) = utc_week_range(now_ms);
    let start = board
        .and_then(|b| b.period_start.as_deref())
        .and_then(parse_date);
    let end = board
        .and_then(|b| b.period_end.as_deref())
        .and_then(parse_date);
    (start.unwrap_or(fallback_start), end.unwrap_or(fallback_end))
}

/// getCountdownParts: (days, hours, minutes), never negative.
pub fn countdown_parts(end_ms: i64, now_ms: i64) -> (i64, i64, i64) {
    let total_minutes = (end_ms - now_ms).max(0) / 60_000;
    (
        total_minutes / 1440,
        (total_minutes % 1440) / 60,
        total_minutes % 60,
    )
}

// ---- play activity ------------------------------------------------------

/// getPlayLevel: 0 none, 1 under an hour, 2 under three hours, 3 more.
pub fn play_level(seconds: f64) -> u8 {
    if seconds <= 0.0 {
        0
    } else if seconds < PLAY_LEVEL_LOW_SECONDS {
        1
    } else if seconds < PLAY_LEVEL_HIGH_SECONDS {
        2
    } else {
        3
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct HeatCell {
    /// 00:00 UTC of the day, in ms.
    pub date_ms: i64,
    pub seconds: f64,
    pub games: Vec<String>,
    pub level: u8,
    pub is_future: bool,
    pub is_today: bool,
    pub is_yesterday: bool,
}

/// `toISOString().slice(0, 10)`.
pub fn iso_day(ms: i64) -> String {
    DateTime::from_timestamp_millis(ms)
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

/// buildHeatmap: `weeks` columns of seven days, ending in the current week.
pub fn build_heatmap(days: &[PlayDay], now_ms: i64, weeks: u32) -> Vec<HeatCell> {
    let by_date: HashMap<&str, &PlayDay> = days
        .iter()
        .map(|d| (d.date.get(..10).unwrap_or(&d.date), d))
        .collect();
    let (current_week, _) = utc_week_range(now_ms);
    let first_day = current_week - (weeks as i64 - 1) * WEEK_MS;
    let today = iso_day(now_ms);
    let yesterday = iso_day(now_ms - DAY_MS);
    (0..weeks as i64 * 7)
        .map(|index| {
            let date_ms = first_day + index * DAY_MS;
            let key = iso_day(date_ms);
            let day = by_date.get(key.as_str());
            let seconds = day.map(|d| d.seconds).unwrap_or(0.0);
            HeatCell {
                date_ms,
                seconds,
                games: day.map(|d| d.games.clone()).unwrap_or_default(),
                level: play_level(seconds),
                is_future: key > today,
                is_today: key == today,
                is_yesterday: key == yesterday,
            }
        })
        .collect()
}

/// buildHeatmapMonths: (week, date) of each month's first week, without
/// labels too close to the next one or to the end of the grid.
pub fn heatmap_months(cells: &[HeatCell]) -> Vec<(usize, i64)> {
    let weeks = cells.len() / 7;
    let month_of = |ms: i64| {
        DateTime::from_timestamp_millis(ms)
            .map(|d| d.month())
            .unwrap_or(0)
    };
    let mut months = Vec::new();
    for week in 0..weeks {
        let date = cells[week * 7].date_ms;
        if week > 0 && month_of(cells[(week - 1) * 7].date_ms) == month_of(date) {
            continue;
        }
        months.push((week, date));
    }
    months
        .iter()
        .enumerate()
        .filter(|(index, (week, _))| {
            let next = months.get(index + 1).map(|(w, _)| *w).unwrap_or(weeks);
            weeks - week >= HEATMAP_MONTH_END_WEEKS
                && (*week > 0 || next >= HEATMAP_MONTH_MIN_WEEKS)
        })
        .map(|(_, month)| *month)
        .collect()
}

/// sumHeatmap: (seconds, played days).
pub fn sum_heatmap(cells: &[HeatCell]) -> (f64, usize) {
    cells.iter().fold((0.0, 0), |(seconds, days), cell| {
        (
            seconds + cell.seconds,
            days + usize::from(cell.seconds > 0.0),
        )
    })
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum HeatTotal {
    None,
    Minutes(f64),
    Hours(f64),
}

/// getHeatmapTotalDisplay: under an hour in minutes, so it never reads "0 h".
pub fn heatmap_total(seconds: f64, days: usize) -> HeatTotal {
    if days == 0 {
        return HeatTotal::None;
    }
    let minutes = (seconds / 60.0).round().max(1.0);
    if minutes < 60.0 {
        return HeatTotal::Minutes(minutes);
    }
    HeatTotal::Hours((seconds / 3600.0).round())
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HeatmapLayout {
    pub weeks: usize,
    pub cell_size: f64,
    pub width: f64,
}

/// getHeatmapLayout: cells grow up to a limit; a narrow card shows fewer weeks.
pub fn heatmap_layout(width: Option<f64>, total_weeks: usize) -> HeatmapLayout {
    let available = width.unwrap_or(0.0) - HEATMAP_DAY_LABELS_WIDTH;
    let fit = ((available + HEATMAP_GAP) / (HEATMAP_MIN_CELL_SIZE + HEATMAP_GAP)).floor();
    let weeks = (total_weeks as f64).min(fit).max(1.0) as usize;
    let cell_size = ((available - HEATMAP_GAP * (weeks as f64 - 1.0)) / weeks as f64)
        .floor()
        .clamp(HEATMAP_MIN_CELL_SIZE, HEATMAP_MAX_CELL_SIZE);
    HeatmapLayout {
        weeks,
        cell_size,
        width: HEATMAP_DAY_LABELS_WIDTH + weeks as f64 * (cell_size + HEATMAP_GAP) - HEATMAP_GAP,
    }
}

// ---- response cache -----------------------------------------------------

pub const RESPONSE_CACHE_TTL_MS: i64 = 60_000;
pub const MAX_CACHED_RESPONSES: usize = 200;

/// createResponseCache: responses by request key for 60s, at most 200, the
/// oldest dropped first. `clear` bumps the generation so a request that
/// started before it does not store its answer.
#[derive(Default)]
pub struct ResponseCache {
    entries: HashMap<String, (i64, Value)>,
    order: VecDeque<String>,
    generation: u64,
}

impl ResponseCache {
    pub fn peek(&mut self, key: &str, now_ms: i64) -> Option<Value> {
        let (at, response) = self.entries.get(key)?;
        if now_ms - at < RESPONSE_CACHE_TTL_MS {
            return Some(response.clone());
        }
        self.remove(key);
        None
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// Stores a response that a request started in `generation` received.
    pub fn store(&mut self, key: &str, response: Value, now_ms: i64, generation: u64) {
        if generation != self.generation {
            return;
        }
        self.remove(key);
        self.entries.insert(key.to_string(), (now_ms, response));
        self.order.push_back(key.to_string());
        while self.entries.len() > MAX_CACHED_RESPONSES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            self.entries.remove(&oldest);
        }
    }

    fn remove(&mut self, key: &str) {
        if self.entries.remove(key).is_some() {
            self.order.retain(|k| k != key);
        }
    }

    pub fn evict(&mut self, key: &str) {
        self.remove(key);
    }

    /// evictPath: every cached response for a path, whatever its params.
    pub fn evict_path(&mut self, path: &str) {
        let needle = format!("|{path}?");
        let keys: Vec<String> = self
            .entries
            .keys()
            .filter(|k| k.contains(&needle))
            .cloned()
            .collect();
        for key in keys {
            self.remove(&key);
        }
    }

    pub fn clear(&mut self) {
        self.generation += 1;
        self.entries.clear();
        self.order.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn raw_user(id: &str) -> Value {
        json!({
            "id": id,
            "displayName": id.to_uppercase(),
            "profileImageUrl": format!("https://cdn/{id}.png"),
            "backgroundImageUrl": null,
        })
    }

    fn raw_entry(rank: u32, id: &str) -> Value {
        json!({ "rank": rank, "value": 1000 - rank, "user": raw_user(id) })
    }

    fn user(id: &str) -> User {
        User {
            id: id.into(),
            display_name: id.into(),
            ..Default::default()
        }
    }

    fn entry(rank: u32, id: &str, value: f64) -> Entry {
        Entry {
            rank,
            value,
            user: user(id),
        }
    }

    fn board(entries: Vec<Entry>, viewer: Option<Viewer>) -> Board {
        Board {
            entries,
            viewer,
            ..Default::default()
        }
    }

    fn utc(y: i32, m: u32, d: u32, h: u32, min: u32) -> i64 {
        chrono::NaiveDate::from_ymd_opt(y, m, d)
            .unwrap()
            .and_hms_opt(h, min, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis()
    }

    #[test]
    fn builds_requests() {
        let request = global_request("playtime", "week", "friends", true);
        assert_eq!(request.path, "/leaderboards/playtime");
        assert_eq!(request.param("window"), Some("week"));
        assert_eq!(request.param("scope"), Some("friends"));
        assert_eq!(request.param("take"), Some("100"));
        assert!(request.needs_auth);
        let signed_out = global_request("playtime", "week", "friends", false);
        assert_eq!(signed_out.param("scope"), Some("global"));
        assert!(!signed_out.needs_auth);
        assert_eq!(
            board_path("playtime", Some(("steam", "a b"))),
            "/games/steam/a%20b/leaderboards/playtime"
        );
        assert_eq!(
            game_page_link("steam", "1091500", "week", "global", "playtime"),
            "/leaderboards?tab=games&shop=steam&objectId=1091500&period=week&scope=global&metric=playtime"
        );
        assert_eq!(
            request.key(Some("me")),
            "me|/leaderboards/playtime?scope=friends&take=100&window=week|auth=true"
        );
    }

    #[test]
    fn normalizes_boards() {
        let board = normalize_board(&json!({
            "entries": [
                { "rank": 2, "value": 50, "user": raw_user("b"), "previousRank": 4, "streakActive": true },
                { "rank": 1, "value": 90, "user": raw_user("a") },
                // a repeated user keeps its first entry; its extras are the last ones (like Electron)
                { "rank": 1, "value": 90, "user": raw_user("a"), "review": { "text": "Great", "score": 5, "translations": { "pt": "Ótimo", "es": "" } } },
                { "rank": 0, "value": 1, "user": raw_user("x") },
            ],
            "viewer": { "rank": 40, "value": 3, "previousRank": 38 },
            "weekStart": "2026-10-19T00:00:00.000Z",
            "weekEnd": "2026-10-26T00:00:00.000Z",
            "total": 1234,
        }))
        .unwrap();
        let ids: Vec<&str> = board.entries.iter().map(|e| e.user.id.as_str()).collect();
        assert_eq!(ids, ["a", "b"]);
        assert_eq!(
            board.viewer,
            Some(Viewer {
                rank: 40,
                value: 3.0
            })
        );
        assert_eq!(board.viewer_previous_rank, Some(38));
        assert_eq!(board.total, Some(1234.0));
        assert_eq!(
            board.period_start.as_deref(),
            Some("2026-10-19T00:00:00.000Z")
        );
        assert_eq!(board.extras["b"].previous_rank, Some(4));
        assert_eq!(board.extras["b"].streak_active, Some(true));
        let review = board.extras["a"].review.as_ref().unwrap();
        assert_eq!(review.translations.len(), 1);
        assert!(has_review_data(Some(&board)));
        assert!(has_streak_data(Some(&board)));
        // the legacy `users` shape
        let legacy = normalize_board(&json!({ "users": [raw_entry(1, "a")] })).unwrap();
        assert_eq!(legacy.entries.len(), 1);
        assert!(normalize_board(&json!("nope")).is_none());
        assert!(normalize_board(&json!({})).is_none());
    }

    #[test]
    fn normalizes_metrics() {
        let metrics = normalize_metrics(&json!({ "metrics": [
            { "id": "playtime", "valueType": "duration", "label": "Playtime" },
            { "id": "playtime" },
            { "id": "review_upvotes" },
            { "id": "streak", "valueType": "weird" },
            { "id": "" },
            "x",
        ]}))
        .unwrap();
        assert_eq!(metrics.len(), 2);
        assert_eq!(metrics[0].value_type, ValueType::Duration);
        assert_eq!(metrics[1].value_type, ValueType::Count);
        assert_eq!(metrics[1].label, "streak");
        assert!(normalize_metrics(&json!({})).is_none());
    }

    #[test]
    fn splits_rows_below_the_podium() {
        let board = normalize_board(&json!({ "entries": [
            raw_entry(1, "a"), raw_entry(2, "b"), raw_entry(3, "c"), raw_entry(3, "d"), raw_entry(5, "e"),
        ]}))
        .unwrap();
        let ids: Vec<String> = board.entries.iter().map(|e| e.user.id.clone()).collect();
        assert_eq!(rows_below_podium(&ids, ids.len()), ["d", "e"]);
        assert_eq!(rows_below_podium(&["a", "b", "viewer"], 2), ["viewer"]);
    }

    #[test]
    fn covers_every_board_state() {
        let two = normalize_board(&json!({ "entries": [raw_entry(1, "me"), raw_entry(2, "b")] }))
            .unwrap();
        let only_viewer = normalize_board(&json!({ "entries": [raw_entry(1, "me")] })).unwrap();
        let empty = normalize_board(&json!({ "entries": [] })).unwrap();
        let me = Some("me");
        assert_eq!(
            board_state(true, false, None, "global", me),
            BoardState::Loading
        );
        assert_eq!(
            board_state(false, false, None, "global", me),
            BoardState::Error
        );
        assert_eq!(
            board_state(false, true, Some(&two), "global", me),
            BoardState::Error
        );
        assert_eq!(
            board_state(false, false, Some(&empty), "global", me),
            BoardState::Empty
        );
        assert_eq!(
            board_state(false, false, Some(&two), "global", me),
            BoardState::Ready
        );
        assert_eq!(
            board_state(false, false, Some(&only_viewer), "friends", me),
            BoardState::EmptyFriends
        );
        assert_eq!(
            board_state(true, false, Some(&two), "global", me),
            BoardState::Ready
        );
    }

    #[test]
    fn reads_the_viewer_ranking() {
        assert_eq!(rank_delta(3, Some(5)), Some(2));
        assert_eq!(rank_delta(5, Some(3)), Some(-2));
        assert_eq!(rank_delta(4, None), None);
        let listed = normalize_board(&json!({ "entries": [
            raw_entry(1, "a"),
            { "rank": 2, "value": 998, "user": raw_user("me"), "previousRank": 4 },
        ]}))
        .unwrap();
        assert_eq!(
            viewer_ranking(Some(&listed), Some("me")),
            Some(Ranking {
                rank: 2,
                value: 998.0,
                delta: Some(2)
            })
        );
        let outside = normalize_board(&json!({
            "entries": [raw_entry(1, "a")],
            "viewer": { "rank": 50, "value": 3, "previousRank": 45 },
        }))
        .unwrap();
        assert_eq!(
            viewer_ranking(Some(&outside), Some("me")),
            Some(Ranking {
                rank: 50,
                value: 3.0,
                delta: Some(-5)
            })
        );
        let missing = normalize_board(&json!({ "entries": [raw_entry(1, "a")] })).unwrap();
        assert_eq!(viewer_ranking(Some(&missing), Some("me")), None);
        assert_eq!(viewer_ranking(None, Some("me")), None);
        assert_eq!(viewer_ranking(Some(&listed), None), None);
    }

    #[test]
    fn explains_the_board() {
        let top = vec![
            entry(1, "a", 100.0),
            entry(2, "b", 80.0),
            entry(3, "c", 60.0),
            entry(4, "d", 40.0),
            entry(5, "me", 30.0),
        ];
        let b = board(top.clone(), None);
        assert_eq!(
            insight(&b, Some("me")),
            Some(Insight::Behind {
                gap: 10.0,
                target: user("d"),
                target_rank: 4,
                next: Some(("podium", 30.0)),
            })
        );
        match insight(&b, Some("c")) {
            Some(Insight::Behind { next, .. }) => assert_eq!(next, Some(("lead", 40.0))),
            other => panic!("{other:?}"),
        }
        match insight(&b, Some("b")) {
            Some(Insight::Behind { next, .. }) => assert_eq!(next, None),
            other => panic!("{other:?}"),
        }
        assert_eq!(
            insight(&b, Some("a")),
            Some(Insight::Leading {
                gap: 20.0,
                target: Some(user("b")),
            })
        );
        assert_eq!(
            insight(&board(vec![entry(1, "me", 5.0)], None), Some("me")),
            Some(Insight::Leading {
                gap: 0.0,
                target: None,
            })
        );
        assert_eq!(
            insight(
                &board(
                    top.clone(),
                    Some(Viewer {
                        rank: 250,
                        value: 3.0
                    })
                ),
                Some("me2")
            ),
            Some(Insight::Outside {
                gap: 27.0,
                last_rank: 5,
            })
        );
        assert_eq!(insight(&b, Some("ghost")), Some(Insight::Unranked));
        assert_eq!(insight(&b, None), None);
        assert_eq!(
            insight(
                &board(
                    vec![
                        entry(1, "a", 100.0),
                        entry(2, "b", 50.0),
                        entry(3, "me", 60.0)
                    ],
                    None
                ),
                Some("me")
            ),
            Some(Insight::Ranked { rank: 3 })
        );
    }

    #[test]
    fn builds_rows_with_the_viewer() {
        let b = board(
            vec![
                entry(1, "a", 100.0),
                entry(2, "b", 50.0),
                entry(3, "c", 1.0),
            ],
            Some(Viewer {
                rank: 9,
                value: 0.0,
            }),
        );
        let me = user("me");
        let rows = build_rows(&b, Some(&me), 2);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[1].progress, 50);
        assert!(rows[2].is_viewer && rows[2].gap_before);
        assert_eq!(rows[2].progress, 4);
        assert_eq!(build_rows(&b, Some(&user("b")), 2).len(), 2);
    }

    #[test]
    fn splits_durations() {
        assert_eq!(duration_parts(0.0, 120.0), ("minutes", 0.0));
        assert_eq!(duration_parts(20.0, 120.0), ("minutes", 1.0));
        assert_eq!(duration_parts(7200.0, 120.0), ("hours", 2.0));
        assert_eq!(duration_parts(4484.0 * 2.0, 120.0), ("hours", 2.5));
        assert_eq!(duration_parts(590992.0, 120.0), ("hours", 164.0));
        assert_eq!(rank_tier(1), "gold");
        assert_eq!(rank_tier(10), "top10");
        assert_eq!(rank_tier(11), "default");
    }

    #[test]
    fn handles_the_week() {
        let sunday = utc(2026, 10, 25, 23, 59);
        let monday = utc(2026, 10, 26, 0, 0);
        assert_eq!(utc_week_range(sunday).0, utc(2026, 10, 19, 0, 0));
        assert_eq!(utc_week_range(monday), (monday, utc(2026, 11, 2, 0, 0)));
        let now = utc(2026, 10, 21, 0, 0);
        let from_response = Board {
            period_start: Some("2026-10-12T00:00:00.000Z".into()),
            period_end: Some("2026-10-19T00:00:00.000Z".into()),
            ..Default::default()
        };
        assert_eq!(
            resolve_week_range(Some(&from_response), now).1,
            utc(2026, 10, 19, 0, 0)
        );
        let broken = Board {
            period_start: Some("nope".into()),
            ..Default::default()
        };
        assert_eq!(
            resolve_week_range(Some(&broken), now).0,
            utc(2026, 10, 19, 0, 0)
        );
        assert_eq!(resolve_week_range(None, now).1, utc(2026, 10, 26, 0, 0));
        let end = utc(2026, 10, 26, 0, 0);
        let before = end - ((3 * 24 + 14) * 60 + 5) * 60_000;
        assert_eq!(countdown_parts(end, before), (3, 14, 5));
        assert_eq!(countdown_parts(end, end + 1), (0, 0, 0));
    }

    #[test]
    fn builds_the_heatmap() {
        assert_eq!(play_level(0.0), 0);
        assert_eq!(play_level(1800.0), 1);
        assert_eq!(play_level(7200.0), 2);
        assert_eq!(play_level(4.0 * 3600.0), 3);
        let now = utc(2026, 10, 21, 12, 0);
        let day = |date: &str, seconds: f64| PlayDay {
            date: date.into(),
            seconds,
            games: vec!["Brawlhalla".into()],
        };
        let cells = build_heatmap(&[day("2026-10-21", 5000.0)], now, 53);
        assert_eq!(cells.len(), 371);
        assert_eq!(iso_day(cells[0].date_ms), "2025-10-20");
        assert_eq!(iso_day(cells[cells.len() - 7].date_ms), "2026-10-19");
        let today = cells.iter().find(|c| c.is_today).unwrap();
        assert_eq!(today.level, 2);
        assert_eq!(today.games, ["Brawlhalla"]);
        assert_eq!(cells.iter().filter(|c| c.is_future).count(), 4);

        let labels = |now: i64| -> Vec<String> {
            heatmap_months(&build_heatmap(&[], now, 53))
                .iter()
                .map(|(week, date)| format!("{week}:{}", iso_day(*date)))
                .collect()
        };
        assert_eq!(
            labels(now),
            [
                "2:2025-11-03",
                "6:2025-12-01",
                "11:2026-01-05",
                "15:2026-02-02",
                "19:2026-03-02",
                "24:2026-04-06",
                "28:2026-05-04",
                "32:2026-06-01",
                "37:2026-07-06",
                "41:2026-08-03",
                "46:2026-09-07",
                "50:2026-10-05",
            ]
        );
        let december = labels(utc(2026, 11, 30, 12, 0));
        assert_eq!(december[0], "0:2025-12-01");
        assert_eq!(december.last().unwrap(), "48:2026-11-02");

        let summed = build_heatmap(
            &[
                day("2026-10-19", 3600.0),
                day("2026-10-21", 1800.0),
                day("2026-01-02", 0.0),
                day("2024-01-01", 9999.0),
            ],
            now,
            53,
        );
        assert_eq!(sum_heatmap(&summed), (5400.0, 2));
        assert_eq!(sum_heatmap(&[]), (0.0, 0));

        assert_eq!(
            heatmap_layout(Some(1000.0), 53),
            HeatmapLayout {
                weeks: 53,
                cell_size: 12.0,
                width: 984.0,
            }
        );
        assert_eq!(
            heatmap_layout(Some(360.0), 53),
            HeatmapLayout {
                weeks: 18,
                cell_size: 12.0,
                width: 354.0,
            }
        );
        assert_eq!(heatmap_layout(Some(4000.0), 53).cell_size, 32.0);

        assert_eq!(heatmap_total(0.0, 0), HeatTotal::None);
        assert_eq!(heatmap_total(20.0, 1), HeatTotal::Minutes(1.0));
        assert_eq!(heatmap_total(300.0, 1), HeatTotal::Minutes(5.0));
        assert_eq!(heatmap_total(3580.0, 1), HeatTotal::Hours(1.0));
        assert_eq!(heatmap_total(460800.0, 74), HeatTotal::Hours(128.0));

        let late = build_heatmap(&[], utc(2026, 10, 27, 1, 0), 53);
        assert_eq!(
            iso_day(late.iter().find(|c| c.is_today).unwrap().date_ms),
            "2026-10-27"
        );
        assert_eq!(
            iso_day(late.iter().find(|c| c.is_yesterday).unwrap().date_ms),
            "2026-10-26"
        );

        let activity = normalize_play_activity(
            &json!({ "days": [{ "date": "2026-10-20", "seconds": 7200, "games": [] }] }),
            26,
        )
        .unwrap();
        let short = build_heatmap(&activity.days, now, activity.weeks);
        assert_eq!(short.len(), 182);
        assert_eq!(iso_day(short[0].date_ms), "2026-04-27");
        let weeks: Vec<usize> = heatmap_months(&short).iter().map(|(w, _)| *w).collect();
        assert_eq!(weeks, [1, 5, 10, 14, 19, 23]);
    }

    #[test]
    fn normalizes_activity_games_and_streaks() {
        let activity = normalize_play_activity(
            &json!({
                "currentStreak": 5, "bestStreak": 12, "playedToday": true,
                "days": [{ "date": "2026-10-21", "seconds": 60, "games": ["A", 3] }, null],
            }),
            53,
        )
        .unwrap();
        assert_eq!(activity.current_streak, 5.0);
        assert_eq!(activity.days.len(), 1);
        assert_eq!(activity.days[0].games, ["A"]);
        assert!(normalize_play_activity(&json!({}), 53).is_none());

        let games = normalize_my_games(&json!({ "games": [
            { "shop": "steam", "objectId": "1", "title": "A", "rank": 3, "total": 2, "leader": raw_user("x") },
            { "shop": "steam", "objectId": "2", "rank": 0 },
            { "shop": "epic", "objectId": "3", "rank": 2, "total": 10.7 },
        ]}))
        .unwrap();
        assert_eq!(games.len(), 2);
        assert_eq!(games[0].total, None);
        assert_eq!(games[0].leader.as_ref().unwrap().id, "x");
        assert_eq!(games[1].total, Some(10));
        assert_eq!(games[1].key(), "epic:3");

        let streaks = normalize_friend_streaks(&json!({ "friends": [
            { "user": raw_user("a"), "days": 9, "active": false },
            { "user": raw_user("b"), "days": 3, "active": true },
            { "user": raw_user("c"), "days": 5, "active": true },
            { "user": null, "days": 50 },
        ]}))
        .unwrap();
        let ids: Vec<&str> = streaks.iter().map(|s| s.user.id.as_str()).collect();
        assert_eq!(ids, ["c", "b", "a"]);
    }

    #[test]
    fn normalizes_badges() {
        let badges = normalize_badges(&json!({ "badges": [
            { "id": "1", "kind": "top_rank", "tier": "gold", "threshold": 10, "value": 3, "earnedAt": "2026-10-01T00:00:00Z" },
            { "id": "2", "kind": "top_percent", "tier": "nope", "threshold": 5, "progress": { "current": 3, "target": 4 } },
            { "id": "3", "kind": "unknown" },
            { "id": "4", "kind": "weekly_leader", "target": { "kind": "top_rank", "value": 25 } },
        ]}))
        .unwrap();
        assert_eq!(badges.badges.len(), 3);
        assert_eq!(badges.earned, 1.0);
        assert_eq!(badges.total, 3.0);
        assert_eq!(badges.badges[0].value, 10.0);
        assert_eq!(badges.badges[0].target, None);
        assert_eq!(badges.badges[1].tier, "gold");
        assert_eq!(badge_progress(&badges.badges[1]), 75.0);
        assert_eq!(
            badges.badges[1].target,
            Some(BadgeTarget {
                kind: "top_percent".into(),
                value: 5.0,
            })
        );
        assert_eq!(badges.badges[2].target.as_ref().unwrap().value, 25.0);
    }

    #[test]
    fn caches_responses() {
        let mut cache = ResponseCache::default();
        let generation = cache.generation();
        cache.store("guest|/a?|auth=false", json!(1), 0, generation);
        assert_eq!(cache.peek("guest|/a?|auth=false", 59_999), Some(json!(1)));
        assert_eq!(cache.peek("guest|/a?|auth=false", 60_000), None);
        cache.store("guest|/a?x=1|auth=false", json!(2), 0, generation);
        cache.store("guest|/b?|auth=false", json!(3), 0, generation);
        cache.evict_path("/a");
        assert_eq!(cache.peek("guest|/a?x=1|auth=false", 1), None);
        assert_eq!(cache.peek("guest|/b?|auth=false", 1), Some(json!(3)));
        cache.clear();
        cache.store("guest|/c?|auth=false", json!(4), 0, generation);
        assert_eq!(cache.peek("guest|/c?|auth=false", 1), None);
        for i in 0..(MAX_CACHED_RESPONSES + 5) {
            cache.store(&format!("k{i}"), json!(i), 0, cache.generation());
        }
        assert_eq!(cache.peek("k0", 1), None);
        assert_eq!(cache.peek("k204", 1), Some(json!(204)));
    }
}
