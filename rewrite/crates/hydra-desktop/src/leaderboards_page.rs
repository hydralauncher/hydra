//! pages/leaderboards: the Rankings page. The week header with the scope and
//! period filters (saved like use-leaderboard-filters.ts), the sidebar
//! (your stats, the metric categories with their leaders, your games), the
//! ranking of a metric, a game's board and your stats (week table, friends'
//! streaks, the play-activity heatmap, badges). Requests go through a 60s
//! cache shared by the whole page (leaderboards-cache.ts), and a page opened
//! from a rank notification tags its board request with `source`.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::time::Duration;

use hydra_core::api::{ApiError, Options};
use hydra_core::leaderboards::{
    self as lb, Board, BoardState, Insight, Metric, MyGame, Request, ValueType,
};
use hydra_i18n::{Arg, intl};
use hydra_media::images::{self, Op, Pixels, Source};
use image::{DynamicImage, imageops::FilterType};
use serde_json::Value;
use slint::{ComponentHandle, Image, Model, ModelRc, StyledText, VecModel};

use crate::nav::Location;
use crate::{
    AppWindow, LbBadge, LbFriendStreak, LbHeatCell, LbMetric, LbMineRow, LbMonth, LbOption,
    LbPodiumCard, LbRow, LbSideGame, LeaderboardsData, Session, SidebarState, dialogs, features,
    nav, shell, toast,
};

const PERIOD_STORAGE_KEY: &str = "leaderboard-period";
const SCOPE_STORAGE_KEY: &str = "leaderboard-scope";
const SOURCE_ATTRIBUTION_MS: i64 = 10_000;
const COUNTDOWN_TICK_MS: u64 = 30_000;
const WEEK_END_RETRY_BASE_MS: i64 = 30_000;
const WEEK_END_RETRY_MAX_MS: i64 = 5 * 60_000;
const REPORT_DESCRIPTION_MAX_LENGTH: usize = 255;
const RATE_LIMITED_ERROR: &str = "user/report-rate-limited";
const ADD_FRIEND_REQUEST_KEY: &str = "friends-window-add-friend-request";
const LEADER_BADGES: &str = "LEADERBOARD_BADGES";
const LEADERBOARD_REPORTS: &str = "LEADERBOARD_REPORTS";
const GLOBAL_LEADERBOARDS: &str = "GLOBAL_LEADERBOARDS";
/// The sidebar's inner width (320px minus padding and border) for the faded banners.
const SIDE_ITEM_WIDTH: u32 = 287;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

// ---- resources ----------------------------------------------------------

#[derive(Clone, Debug)]
enum FetchError {
    /// a 400 (older backends reject some params)
    BadRequest,
    Other(String),
}

type Done = Box<dyn FnOnce(Result<Value, FetchError>)>;

/// useApiResource's state: the request it is for, its data and flags.
struct Res<T> {
    key: String,
    data: Option<T>,
    loading: bool,
    error: bool,
}

impl<T> Default for Res<T> {
    fn default() -> Self {
        Res {
            key: String::new(),
            data: None,
            loading: false,
            error: false,
        }
    }
}

impl<T> Res<T> {
    fn idle() -> Self {
        Self::default()
    }
}

/// attributeNextLeaderboardRequest
struct Attribution {
    path: String,
    scope: String,
    period: String,
    source: String,
    expires_at: i64,
}

#[derive(Clone, Default)]
struct GameAssets {
    title: String,
    cover: Option<String>,
    icon: Option<String>,
}

#[derive(Clone, Copy, Debug)]
enum Pic {
    Avatar,
    /// a row's banner (LEADERBOARD_ROW_BANNER_IMAGE_SIZE 960x112)
    Row,
    /// LEADERBOARD_PODIUM_BANNER_IMAGE_SIZE 640x576
    Podium,
    /// LEADERBOARD_HEADER_BANNER_IMAGE_SIZE 960x240
    Header,
    /// LEADERBOARD_SIDEBAR_COVER_IMAGE_SIZE 88x128
    Cover,
    /// a game icon on the 44px board cover
    Icon,
    /// a sidebar item's banner, faded like the CSS mask, at the item's height
    Side(u32),
}

struct Models {
    metrics: Rc<VecModel<LbMetric>>,
    games: Rc<VecModel<LbSideGame>>,
    podium: Rc<VecModel<LbPodiumCard>>,
    rows: Rc<VecModel<LbRow>>,
    mine: Rc<VecModel<LbMineRow>>,
    friends: Rc<VecModel<LbFriendStreak>>,
    heat: Rc<VecModel<LbHeatCell>>,
    badges: Rc<VecModel<LbBadge>>,
}

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    open: bool,
    /// the URL this state was built for (to tell a new link from a re-render)
    last_link: String,
    // what the viewer asked for
    tab: String,
    metric: Option<String>,
    period: String,
    scope: String,
    selected_game: Option<String>,
    linked: Option<(String, String)>,
    game_metric: Option<String>,
    side_list: String,
    search: String,
    // data
    metrics: Res<Vec<Metric>>,
    game_metrics: Res<Vec<Metric>>,
    boards: HashMap<String, Res<Board>>,
    boards_query: String,
    games: Res<Vec<MyGame>>,
    last_games: Option<Vec<MyGame>>,
    game_board: Res<Board>,
    assets: HashMap<String, Option<GameAssets>>,
    activity: Res<lb::PlayActivity>,
    friends: Res<Vec<lb::FriendStreak>>,
    badges: Res<lb::Badges>,
    /// main requests the API rejected with a 400 this session
    rejected: HashSet<String>,
    // view state
    visible: usize,
    visible_for: String,
    friends_visible: usize,
    badges_expanded: bool,
    reviewer: Option<String>,
    last_period: Option<(Option<String>, Option<String>)>,
    week_clock: i64,
    week_key: String,
    generation: i32,
    countdown: Option<slint::Timer>,
    countdown_end: i64,
    next_attempt: i64,
    attempts: u32,
    heat_width: f32,
    // requests
    cache: lb::ResponseCache,
    in_flight: HashMap<String, Vec<Done>>,
    attribution: Option<Attribution>,
    attributed: Option<String>,
    // images
    images: HashMap<String, Image>,
    pending_images: HashSet<String>,
    apply_queued: bool,
    models: Option<Models>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
    static APPLYING: Cell<bool> = const { Cell::new(false) };
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn ui() -> Option<AppWindow> {
    with(|s| s.ui.upgrade())
}

// ---- strings ------------------------------------------------------------

fn tr(key: &str) -> String {
    shell::tr(key)
}

fn tr_with(key: &str, args: &[(&str, Arg)]) -> String {
    shell::tr_with(key, args)
}

fn tr_count(key: &str, count: f64, args: &[(&str, Arg)]) -> String {
    shell::i18n()
        .map(|i| i.t_count(key, count, args))
        .unwrap_or_default()
}

/// `t(key, { defaultValue })`: i18next returns the key without its namespace
/// when nothing matches.
fn or_default(key: &str, value: String, default: impl FnOnce() -> String) -> String {
    let bare = key.split_once('.').map(|(_, k)| k).unwrap_or(key);
    if value == bare { default() } else { value }
}

fn number(value: f64) -> String {
    shell::i18n()
        .map(|i| i.format_number(value))
        .unwrap_or_else(|| value.to_string())
}

fn language() -> String {
    shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into())
}

/// useMetricText().label
fn metric_label(metric: &Metric) -> String {
    let key = format!("leaderboards.metric_{}", metric.id);
    or_default(&key, tr(&key), || metric.label.clone())
}

/// useMetricText().format
fn format_value(metric: &Metric, value: f64) -> String {
    match metric.value_type {
        ValueType::Duration => {
            let (unit, amount) = lb::duration_parts(value, lb::MAX_MINUTES_TO_SHOW_IN_PLAYTIME);
            tr_with(
                &format!("leaderboards.value_{unit}"),
                &[("amount", number(amount).into())],
            )
        }
        ValueType::Days => tr_count("leaderboards.days_count", value, &[]),
        ValueType::Count => {
            let amount = number(value);
            let key = format!("leaderboards.value_{}", metric.id);
            let text = tr_count(&key, value, &[("amount", amount.clone().into())]);
            or_default(&key, text, || amount)
        }
    }
}

/// useMetricColumnLabel
fn column_label(metric: &Metric) -> String {
    match metric.value_type {
        ValueType::Duration => tr("leaderboards.column_hours"),
        ValueType::Days => tr("leaderboards.column_days"),
        ValueType::Count => metric_label(metric),
    }
}

fn ordinal(rank: u32) -> String {
    tr_with(
        "leaderboards.ordinal",
        &[("rank", number(rank as f64).into())],
    )
}

fn escape_markdown(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if matches!(
            ch,
            '\\' | '*' | '_' | '`' | '[' | ']' | '<' | '>' | '#' | '~' | '|' | '!'
        ) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// A <Trans> line with `<b>` parts in the muted color (board-insight.tsx).
fn rich_line(key: &str, count: Option<f64>, args: &[(&str, Arg)]) -> StyledText {
    let Some(i18n) = shell::i18n() else {
        return StyledText::default();
    };
    let mut markdown = String::new();
    for span in i18n.rich(key, count, args) {
        let text = escape_markdown(&span.text);
        if span.bold && !text.trim().is_empty() {
            markdown.push_str(&format!("**<font color=\"#f0f1f7\">{text}</font>**"));
        } else {
            markdown.push_str(&text);
        }
    }
    StyledText::from_markdown(&markdown).unwrap_or_else(|_| StyledText::from_plain_text(&markdown))
}

fn has_key(key: &str) -> bool {
    let bare = key.split_once('.').map(|(_, k)| k).unwrap_or(key);
    tr(key) != bare
}

// ---- viewer -------------------------------------------------------------

/// useLeaderboardViewer
fn viewer() -> Option<lb::User> {
    let user = shell::user_details()?;
    lb::normalize_user(&user)
}

fn account_id() -> Option<String> {
    viewer().map(|v| v.id)
}

// ---- requests -----------------------------------------------------------

/// leaderboardsGet's takeSource: the attribution for this request, once.
fn take_source(request: &Request) -> Option<String> {
    with(|s| {
        let pending = s.attribution.as_ref()?;
        if now_ms() > pending.expires_at {
            s.attribution = None;
            return None;
        }
        let period = request.param("window").or(request.param("range"));
        if pending.path != request.path
            || request.param("scope") != Some(pending.scope.as_str())
            || period != Some(pending.period.as_str())
        {
            return None;
        }
        s.attribution.take().map(|a| a.source)
    })
}

/// leaderboardsCache.get: a cached answer, a request already on its way, or
/// a new GET on a worker thread.
fn fetch(request: &Request, done: impl FnOnce(Result<Value, FetchError>) + 'static) {
    let account = account_id();
    let key = request.key(account.as_deref());
    if let Some(cached) = with(|s| s.cache.peek(&key, now_ms())) {
        done(Ok(cached));
        return;
    }
    let first = with(|s| {
        let waiting = s.in_flight.entry(key.clone()).or_default();
        waiting.push(Box::new(done));
        waiting.len() == 1
    });
    if !first {
        return;
    }
    let generation = with(|s| s.cache.generation());
    let mut params = request.params.clone();
    if let Some(source) = take_source(request) {
        eprintln!("leaderboards: {} tagged with source={source}", request.path);
        params.push(("source".into(), source));
    }
    let Some(api) = shell::api() else {
        finish(&key, Err(FetchError::Other("no API".into())), generation);
        return;
    };
    let path = request.path.clone();
    let options = Options {
        needs_auth: request.needs_auth,
        timeout: None,
    };
    std::thread::spawn(move || {
        let query: Vec<(&str, String)> = params
            .iter()
            .map(|(k, v)| (k.as_str(), v.clone()))
            .collect();
        let result = api
            .get(&path, &query, options)
            .map_err(|error| match error {
                ApiError::Status { status: 400, .. } => FetchError::BadRequest,
                other => FetchError::Other(other.to_string()),
            });
        let _ = slint::invoke_from_event_loop(move || finish(&key, result, generation));
    });
}

fn finish(key: &str, result: Result<Value, FetchError>, generation: u64) {
    if let Ok(value) = &result {
        with(|s| s.cache.store(key, value.clone(), now_ms(), generation));
    }
    match &result {
        Err(FetchError::Other(message)) => {
            eprintln!("leaderboards: request failed ({key}): {message}")
        }
        Err(FetchError::BadRequest) => eprintln!("leaderboards: request rejected (400) ({key})"),
        Ok(_) => {}
    }
    let waiting = with(|s| s.in_flight.remove(key)).unwrap_or_default();
    for done in waiting {
        done(result.clone());
    }
}

/// useApiResource: loads `request` into the resource `slot` picks, keeping
/// the answer only while the slot still wants that request. With a
/// fallback, a 400 is retried once with it and remembered for the session.
fn load<T: 'static>(
    request: Request,
    slot: fn(&mut State) -> &mut Res<T>,
    normalize: fn(&Value) -> Option<T>,
    fallback: Option<(Request, fn(&Value) -> Option<T>)>,
) {
    let account = account_id();
    let key = request.key(account.as_deref());
    let rejected = with(|s| s.rejected.contains(&key));
    // a resource already holding this request's data stays as it is
    // (a failed one too: only retry() asks again)
    let current = with(|s| {
        let res = slot(s);
        res.key == key && (res.data.is_some() || res.loading || res.error)
    });
    if current {
        return;
    }
    with(|s| {
        let res = slot(s);
        if res.key != key {
            res.data = None;
        }
        res.key = key.clone();
        res.loading = true;
        res.error = false;
    });
    let settle = move |data: Option<T>| {
        with(|s| {
            let res = slot(s);
            if res.key != key {
                return;
            }
            res.loading = false;
            res.error = data.is_none();
            res.data = data;
        });
        queue_apply();
    };
    let run_fallback = |fallback: (Request, fn(&Value) -> Option<T>),
                        settle: Box<dyn FnOnce(Option<T>)>| {
        let (request, normalize) = fallback;
        fetch(&request, move |result| {
            settle(result.ok().and_then(|v| normalize(&v)));
        });
    };
    let settle: Box<dyn FnOnce(Option<T>)> = Box::new(settle);
    if rejected && let Some(fallback) = fallback {
        run_fallback(fallback, settle);
        return;
    }
    let main_key = request.key(account.as_deref());
    fetch(&request, move |result| match result {
        Ok(value) => match normalize(&value) {
            Some(data) => settle(Some(data)),
            None => {
                with(|s| s.cache.evict(&main_key));
                settle(None)
            }
        },
        Err(FetchError::BadRequest) if fallback.is_some() => {
            with(|s| {
                s.rejected.insert(main_key);
            });
            if let Some(fallback) = fallback {
                run_fallback(fallback, settle);
            }
        }
        Err(_) => settle(None),
    });
}

/// Forgets a resource so the next `load` asks again (retry()).
fn reset<T>(slot: fn(&mut State) -> &mut Res<T>) {
    with(|s| {
        let res = slot(s);
        res.key.clear();
        res.loading = false;
    });
}

fn current_scope(s: &State) -> String {
    if shell::signed_in() {
        s.scope.clone()
    } else {
        "global".into()
    }
}

/// useGlobalLeaderboards: one request per metric for the period and scope.
fn load_boards(force: bool) {
    let Some(metrics) = with(|s| s.metrics.data.clone()) else {
        return;
    };
    let logged_in = shell::signed_in();
    let (period, scope) = with(|s| (s.period.clone(), current_scope(s)));
    let account = account_id();
    let query = format!(
        "{}|{period}|{scope}|{logged_in}|{}",
        metrics
            .iter()
            .map(|m| m.id.as_str())
            .collect::<Vec<_>>()
            .join(","),
        account.as_deref().unwrap_or("")
    );
    let changed = with(|s| {
        let changed = s.boards_query != query || force;
        if changed {
            s.boards_query = query.clone();
            s.boards.clear();
        }
        changed
    });
    if !changed {
        return;
    }
    for metric in metrics {
        let request = lb::global_request(&metric.id, &period, &scope, logged_in);
        let id = metric.id.clone();
        let query = query.clone();
        let cached = with(|s| s.cache.peek(&request.key(account.as_deref()), now_ms()));
        with(|s| {
            s.boards.insert(
                id.clone(),
                Res {
                    key: query.clone(),
                    data: cached.as_ref().and_then(lb::normalize_board),
                    loading: cached.is_none(),
                    error: false,
                },
            )
        });
        if cached.is_some() {
            continue;
        }
        let account = account.clone();
        fetch(&request.clone(), move |result| {
            let board = result.as_ref().ok().and_then(lb::normalize_board);
            if result.is_ok() && board.is_none() {
                with(|s| s.cache.evict(&request.key(account.as_deref())));
            }
            with(|s| {
                if s.boards_query != query {
                    return;
                }
                let error = board.is_none();
                s.boards.insert(
                    id,
                    Res {
                        key: query.clone(),
                        data: board,
                        loading: false,
                        error,
                    },
                );
            });
            queue_apply();
        });
    }
}

/// Everything the current view needs, requested (cached ones resolve now).
fn load_all() {
    ensure_loaded();
    queue_apply();
}

/// The requests the view depends on; the ones already made stay as they
/// are, so `apply` runs this after every change (new metrics ask for their
/// boards, a game list picks the game board).
fn ensure_loaded() {
    let logged_in = shell::signed_in();
    load(
        lb::metrics_request("global"),
        |s| &mut s.metrics,
        lb::normalize_metrics,
        None,
    );
    if logged_in {
        let (period, scope) = with(|s| (s.period.clone(), current_scope(s)));
        load(
            Request::new(
                "/leaderboards/me/games",
                &[("window", period), ("scope", scope)],
                true,
            ),
            |s| &mut s.games,
            lb::normalize_my_games,
            None,
        );
    } else {
        with(|s| s.games = Res::idle());
    }
    load_boards(false);
    let tab = effective_tab();
    if tab == "games" {
        load(
            lb::metrics_request("game"),
            |s| &mut s.game_metrics,
            lb::normalize_metrics,
            None,
        );
        load_game_board();
    }
    if tab == "stats" && logged_in {
        load(
            Request::new(
                "/users/me/play-activity",
                &[("weeks", lb::PLAY_ACTIVITY_WEEKS.to_string())],
                true,
            ),
            |s| &mut s.activity,
            |v| lb::normalize_play_activity(v, lb::PLAY_ACTIVITY_WEEKS),
            Some((
                Request::new(
                    "/users/me/play-activity",
                    &[("weeks", lb::PLAY_ACTIVITY_FALLBACK_WEEKS.to_string())],
                    true,
                ),
                |v| lb::normalize_play_activity(v, lb::PLAY_ACTIVITY_FALLBACK_WEEKS),
            )),
        );
        load(
            Request::new("/users/me/friends/streaks", &[], true),
            |s| &mut s.friends,
            lb::normalize_friend_streaks,
            None,
        );
        if features::enabled(LEADER_BADGES) {
            load(
                lb::metrics_request("game"),
                |s| &mut s.game_metrics,
                lb::normalize_metrics,
                None,
            );
            load(
                Request::new("/users/me/leaderboard-badges", &[], true),
                |s| &mut s.badges,
                lb::normalize_badges,
                None,
            );
        }
    }
}

/// by-game-tab.tsx: the board of the selected (or linked, or first) game.
fn load_game_board() {
    let Some((shop, object_id, metric)) = with(|s| {
        let (board_game, _) = board_game(s);
        let metric = game_metric(s)?;
        board_game.map(|(shop, object_id)| (shop, object_id, metric.id.clone()))
    }) else {
        with(|s| s.game_board = Res::idle());
        return;
    };
    let (period, scope) = with(|s| (s.period.clone(), current_scope(s)));
    load(
        lb::game_request(&metric, &shop, &object_id, &period, &scope),
        |s| &mut s.game_board,
        lb::normalize_board,
        None,
    );
    load_assets(&shop, &object_id);
}

/// getGameAssets: the shop assets cache (8 hours), else the API.
fn load_assets(shop: &str, object_id: &str) {
    let key = lb::game_key(shop, object_id);
    if with(|s| s.assets.contains_key(&key)) {
        return;
    }
    with(|s| s.assets.insert(key.clone(), None));
    let db = shell::db();
    let api = shell::api();
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    std::thread::spawn(move || {
        const LOCAL_CACHE_EXPIRATION: i64 = 1000 * 60 * 60 * 8;
        let cached: Option<Value> = db
            .as_ref()
            .and_then(|db| db.get_in(hydra_db::keys::GAME_SHOP_ASSETS, &key));
        let fresh = cached.as_ref().is_some_and(|c| {
            c.get("updatedAt").and_then(Value::as_i64).unwrap_or(0) + LOCAL_CACHE_EXPIRATION
                > now_ms()
        });
        let assets = if fresh {
            cached
        } else {
            api.and_then(|api| {
                api.get(
                    &format!("/games/{shop}/{object_id}/assets"),
                    &[],
                    Options::public(),
                )
                .ok()
            })
            .filter(|v| v.is_object())
            .map(|mut assets| {
                if let (Some(db), Some(object)) = (db.as_ref(), assets.as_object_mut()) {
                    let mut stored = object.clone();
                    // keep a title the user already had (shouldPreserveTitle)
                    if let Some(title) = cached
                        .as_ref()
                        .and_then(|c| c.get("title"))
                        .and_then(Value::as_str)
                        .filter(|t| !t.is_empty())
                    {
                        stored.insert("title".into(), Value::String(title.to_string()));
                    }
                    stored.insert("updatedAt".into(), Value::from(now_ms()));
                    let _ = db.put_in(
                        hydra_db::keys::GAME_SHOP_ASSETS,
                        &key,
                        &Value::Object(stored),
                    );
                }
                assets
            })
            .or(cached)
        };
        let text = |v: &Value, k: &str| {
            v.get(k)
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        let parsed = assets.map(|a| GameAssets {
            title: text(&a, "title").unwrap_or_default(),
            cover: text(&a, "coverImageUrl"),
            icon: text(&a, "iconUrl"),
        });
        let _ = slint::invoke_from_event_loop(move || {
            with(|s| s.assets.insert(key, Some(parsed.unwrap_or_default())));
            queue_apply();
        });
    });
}

// ---- derived view state -------------------------------------------------

fn shown_games(s: &State) -> Vec<MyGame> {
    s.games
        .data
        .clone()
        .or_else(|| {
            if s.games.loading {
                s.last_games.clone()
            } else {
                None
            }
        })
        .unwrap_or_default()
}

fn effective_tab_of(s: &State) -> String {
    if !shell::signed_in() {
        return "ranking".into();
    }
    let has_no_game = s.linked.is_none() && !s.games.loading && shown_games(s).is_empty();
    if s.tab == "games" && has_no_game {
        return "ranking".into();
    }
    s.tab.clone()
}

fn effective_tab() -> String {
    with(|s| effective_tab_of(s))
}

/// The game board's game: the selected one when listed, the linked one,
/// else the first game; and whether it came from the link.
fn board_game(s: &State) -> (Option<(String, String)>, bool) {
    let games = shown_games(s);
    let listed = games
        .iter()
        .find(|g| Some(g.key()) == s.selected_game)
        .map(|g| (g.shop.clone(), g.object_id.clone()));
    if listed.is_some() {
        return (listed, false);
    }
    if let Some((shop, object_id)) = &s.linked
        && s.selected_game.as_deref() == Some(lb::game_key(shop, object_id).as_str())
    {
        return (Some((shop.clone(), object_id.clone())), true);
    }
    (
        games.first().map(|g| (g.shop.clone(), g.object_id.clone())),
        false,
    )
}

fn game_metric(s: &State) -> Option<Metric> {
    let metrics = s.game_metrics.data.as_ref()?;
    metrics
        .iter()
        .find(|m| Some(&m.id) == s.game_metric.as_ref())
        .or(metrics.first())
        .cloned()
}

fn ranking_metric(s: &State) -> Option<Metric> {
    let metrics = s.metrics.data.as_ref()?;
    metrics
        .iter()
        .find(|m| Some(&m.id) == s.metric.as_ref())
        .or(metrics.first())
        .cloned()
}

// ---- images -------------------------------------------------------------

fn image_key(pic: Pic, url: &str) -> String {
    format!("{pic:?}|{url}")
}

/// A loaded image, or an empty one while it loads (the load starts here).
fn image(url: Option<&str>, pic: Pic) -> Image {
    let Some(url) = url.filter(|u| !u.is_empty()) else {
        return Image::default();
    };
    let key = image_key(pic, url);
    if let Some(image) = with(|s| s.images.get(&key).cloned()) {
        return image;
    }
    if !with(|s| s.pending_images.insert(key.clone())) {
        return Image::default();
    }
    let Some((loader, scale)) = shell::loader() else {
        return Image::default();
    };
    let url = url.to_string();
    loader.run(move |http| {
        let pixels = images::fetch(http, &Source::Url(url.clone()))
            .and_then(|bytes| decode(&bytes, pic, scale));
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(pixels) = pixels {
                with(|s| s.images.insert(key, pixels.into_image()));
                queue_apply();
            } else {
                eprintln!("leaderboards: image failed {url}");
            }
        });
    });
    Image::default()
}

/// useProcessedImage's sizes: a cover crop to the processed size (what
/// Electron then draws with `background-size: cover`).
fn decode(bytes: &[u8], pic: Pic, scale: f32) -> Option<Pixels> {
    let px = |v: f32| (v * scale).ceil().max(1.0) as u32;
    match pic {
        Pic::Avatar => images::decode_bytes(bytes, Op::MaxWidth(px(64.0))),
        Pic::Icon => images::decode_bytes(bytes, Op::MaxWidth(px(44.0))),
        Pic::Row | Pic::Podium | Pic::Header | Pic::Cover => {
            let (w, h) = match pic {
                Pic::Row => (960, 112),
                Pic::Podium => (640, 576),
                Pic::Header => (960, 240),
                _ => (88, 128),
            };
            let img = images::open_bytes(bytes)?;
            Some(images::to_pixels(
                img.resize_to_fill(w, h, FilterType::Triangle),
                Op::Full,
            ))
        }
        Pic::Side(height) => {
            // processed to 960x112, then covered into the item and faded:
            // opacity 0.5, mask-image: linear-gradient(to left, #000 0%, transparent 70%)
            let img = images::open_bytes(bytes)?.resize_to_fill(960, 112, FilterType::Triangle);
            let (w, h) = (px(SIDE_ITEM_WIDTH as f32), px(height as f32));
            let mut rgba = img.resize_to_fill(w, h, FilterType::Triangle).to_rgba8();
            for (x, _, pixel) in rgba.enumerate_pixels_mut() {
                let from_right = (w - x) as f32 / w as f32;
                let mask = (1.0 - from_right / 0.7).clamp(0.0, 1.0);
                pixel[3] = (pixel[3] as f32 * 0.5 * mask).round() as u8;
            }
            Some(images::to_pixels(DynamicImage::ImageRgba8(rgba), Op::Full))
        }
    }
}

// ---- apply --------------------------------------------------------------

/// Coalesces updates (several requests and images land in one frame).
fn queue_apply() {
    if with(|s| std::mem::replace(&mut s.apply_queued, true)) {
        return;
    }
    slint::Timer::single_shot(Duration::from_millis(0), || {
        with(|s| s.apply_queued = false);
        apply();
    });
}

fn sync<T: Clone + PartialEq + 'static>(model: &Rc<VecModel<T>>, items: Vec<T>) {
    let count = model.row_count();
    for (i, item) in items.iter().enumerate() {
        if i < count {
            if model.row_data(i).as_ref() != Some(item) {
                model.set_row_data(i, item.clone());
            }
        } else {
            model.push(item.clone());
        }
    }
    for i in (items.len()..count).rev() {
        model.remove(i);
    }
}

/// Whether a model already holds these rows (so a re-render keeps it).
fn same_rows<T: Clone + PartialEq + 'static>(model: &ModelRc<T>, items: &[T]) -> bool {
    model.row_count() == items.len()
        && items
            .iter()
            .enumerate()
            .all(|(i, item)| model.row_data(i).as_ref() == Some(item))
}

fn models(ui: &AppWindow) -> Models {
    if let Some(models) = with(|s| {
        s.models.as_ref().map(|m| Models {
            metrics: m.metrics.clone(),
            games: m.games.clone(),
            podium: m.podium.clone(),
            rows: m.rows.clone(),
            mine: m.mine.clone(),
            friends: m.friends.clone(),
            heat: m.heat.clone(),
            badges: m.badges.clone(),
        })
    }) {
        return models;
    }
    let made = Models {
        metrics: Rc::new(VecModel::default()),
        games: Rc::new(VecModel::default()),
        podium: Rc::new(VecModel::default()),
        rows: Rc::new(VecModel::default()),
        mine: Rc::new(VecModel::default()),
        friends: Rc::new(VecModel::default()),
        heat: Rc::new(VecModel::default()),
        badges: Rc::new(VecModel::default()),
    };
    let data = ui.global::<LeaderboardsData>();
    data.set_metrics(ModelRc::from(made.metrics.clone()));
    data.set_games(ModelRc::from(made.games.clone()));
    data.set_podium(ModelRc::from(made.podium.clone()));
    data.set_rows(ModelRc::from(made.rows.clone()));
    data.set_mine(ModelRc::from(made.mine.clone()));
    data.set_friend_streaks(ModelRc::from(made.friends.clone()));
    data.set_heat_cells(ModelRc::from(made.heat.clone()));
    data.set_badges(ModelRc::from(made.badges.clone()));
    let copy = Models {
        metrics: made.metrics.clone(),
        games: made.games.clone(),
        podium: made.podium.clone(),
        rows: made.rows.clone(),
        mine: made.mine.clone(),
        friends: made.friends.clone(),
        heat: made.heat.clone(),
        badges: made.badges.clone(),
    };
    with(|s| s.models = Some(made));
    copy
}

fn apply() {
    if !with(|s| s.open) || APPLYING.with(|a| a.replace(true)) {
        return;
    }
    if let Some(ui) = ui() {
        apply_to(&ui);
    }
    APPLYING.with(|a| a.set(false));
}

fn apply_to(ui: &AppWindow) {
    ensure_loaded();
    let data = ui.global::<LeaderboardsData>();
    let models = models(ui);
    let logged_in = shell::signed_in();
    let viewer = viewer();
    let viewer_id = viewer.as_ref().map(|v| v.id.clone());

    // games shown while a new list loads (lastGamesRef)
    with(|s| {
        if let Some(games) = &s.games.data {
            s.last_games = Some(games.clone());
        }
    });
    let tab = effective_tab();
    let (period, scope) = with(|s| (s.period.clone(), current_scope(s)));

    data.set_signed_in(logged_in);
    data.set_tab(tab.clone().into());
    data.set_period(period.clone().into());
    data.set_scope(scope.clone().into());
    data.set_side_list(
        (if logged_in {
            with(|s| s.side_list.clone())
        } else {
            "categories".into()
        })
        .into(),
    );
    data.set_show_badges(features::enabled(LEADER_BADGES));

    apply_week(&data, &period);
    apply_sidebar(&data, &models, &tab);
    match tab.as_str() {
        "games" => apply_game_board(&data, &models, &period, &scope, viewer.as_ref()),
        "stats" => {
            apply_stats(&data, &models, &period, viewer.as_ref());
            if features::enabled(LEADER_BADGES) {
                apply_badges(&data, &models);
            }
        }
        _ => apply_ranking(&data, &models, &period, &scope, viewer.as_ref()),
    }
    let _ = viewer_id;
}

/// week-subtitle.tsx: the week's dates and the countdown, or "All time".
fn apply_week(data: &LeaderboardsData, period: &str) {
    let (start, end) = week_range();
    if period == "all" {
        data.set_period_title(tr("leaderboards.period_all").into());
        data.set_subtitle(tr("leaderboards.subtitle_all").into());
    } else {
        data.set_period_title(intl::week_range(&language(), start, end - 1).into());
        let (days, hours, minutes) = lb::countdown_parts(end, now_ms());
        let countdown = if days > 0 {
            tr_with(
                "leaderboards.countdown_days",
                &[
                    ("days", days.to_string().into()),
                    ("hours", hours.to_string().into()),
                ],
            )
        } else if hours > 0 {
            tr_with(
                "leaderboards.countdown_hours",
                &[
                    ("hours", hours.to_string().into()),
                    ("minutes", minutes.to_string().into()),
                ],
            )
        } else {
            tr_with(
                "leaderboards.countdown_minutes",
                &[("minutes", minutes.to_string().into())],
            )
        };
        data.set_subtitle(
            tr_with("leaderboards.resets_in", &[("countdown", countdown.into())]).into(),
        );
    }
    // the countdown restarts with the week's end (WeekSubtitle's effect)
    start_countdown(end);
}

/// The week of the first loaded board (or the last one seen), else the clock.
fn week_range() -> (i64, i64) {
    with(|s| {
        let metrics = s.metrics.data.clone().unwrap_or_default();
        let loaded = metrics
            .iter()
            .filter_map(|m| s.boards.get(&m.id).and_then(|r| r.data.as_ref()))
            .next()
            .map(|b| (b.period_start.clone(), b.period_end.clone()));
        if loaded.is_some() {
            s.last_period = loaded.clone();
        }
        let reference = loaded
            .or_else(|| s.last_period.clone())
            .map(|(start, end)| Board {
                period_start: start,
                period_end: end,
                ..Default::default()
            });
        let clock = if s.week_clock == 0 {
            now_ms()
        } else {
            s.week_clock
        };
        let range = lb::resolve_week_range(reference.as_ref(), clock);
        // a new week remounts the content (generation)
        let key = lb::iso_day(range.0);
        if !s.week_key.is_empty() && s.week_key != key {
            s.generation += 1;
            reset_view(s);
        }
        s.week_key = key;
        range
    })
}

fn start_countdown(end: i64) {
    let unchanged = with(|s| s.countdown.is_some() && s.countdown_end == end);
    if unchanged {
        return;
    }
    let timer = slint::Timer::default();
    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(COUNTDOWN_TICK_MS),
        || {
            let now = now_ms();
            let due = with(|s| now >= s.next_attempt);
            if due {
                with(|s| {
                    s.next_attempt = now
                        + WEEK_END_RETRY_MAX_MS
                            .min(WEEK_END_RETRY_BASE_MS * 2i64.pow(s.attempts.min(10)));
                    s.attempts += 1;
                });
                // handleWeekEnd: drop the cache, move the clock, ask again
                with(|s| {
                    s.cache.clear();
                    s.week_clock = now;
                });
                retry_all();
            }
            queue_apply();
        },
    );
    with(|s| {
        s.countdown = Some(timer);
        s.countdown_end = end;
        s.next_attempt = end;
        s.attempts = 0;
    });
}

fn apply_sidebar(data: &LeaderboardsData, models: &Models, tab: &str) {
    let (metrics, metrics_loading, games_res, search, selected_metric, active_game) = with(|s| {
        let games = shown_games(s);
        let selected_game = if tab == "games" {
            let listed = games.iter().any(|g| Some(g.key()) == s.selected_game);
            if listed {
                s.selected_game.clone()
            } else if s.linked.is_some() {
                None
            } else {
                games.first().map(|g| g.key())
            }
        } else {
            None
        };
        (
            s.metrics.data.clone().unwrap_or_default(),
            s.metrics.loading,
            (games, s.games.loading, s.games.error),
            s.search.clone(),
            if tab == "ranking" {
                ranking_metric(s).map(|m| m.id)
            } else {
                None
            },
            selected_game,
        )
    });
    data.set_metrics_loading(metrics_loading);
    let items: Vec<LbMetric> = metrics
        .iter()
        .map(|metric| {
            let result = with(|s| {
                s.boards
                    .get(&metric.id)
                    .map(|r| (r.data.clone(), r.loading, r.error))
            });
            let (board, loading, error) = result.unwrap_or((None, true, false));
            let leader = board.as_ref().and_then(|b| b.entries.first().cloned());
            let state = if error {
                "error"
            } else if loading && board.is_none() {
                "loading"
            } else if leader.is_some() {
                "leader"
            } else {
                "none"
            };
            let banner_url = leader
                .as_ref()
                .and_then(|l| l.user.background_image_url.clone());
            let banner = image(banner_url.as_deref(), Pic::Side(59));
            LbMetric {
                id: metric.id.clone().into(),
                label: metric_label(metric).into(),
                selected: Some(&metric.id) == selected_metric.as_ref(),
                leader_state: state.into(),
                leader_name: leader
                    .as_ref()
                    .map(|l| l.user.display_name.clone())
                    .unwrap_or_default()
                    .into(),
                leader_avatar: image(
                    leader
                        .as_ref()
                        .and_then(|l| l.user.profile_image_url.as_deref()),
                    Pic::Avatar,
                ),
                leader_value: leader
                    .as_ref()
                    .map(|l| format_value(metric, l.value))
                    .unwrap_or_default()
                    .into(),
                has_banner: banner.size().width > 0,
                banner,
            }
        })
        .collect();
    sync(&models.metrics, items);

    let (games, games_loading, games_error) = games_res;
    data.set_games_loading(games_loading);
    data.set_games_error(games_error);
    data.set_has_games(!games.is_empty());
    let term = search.trim().to_lowercase();
    let side_games: Vec<LbSideGame> = games
        .iter()
        .filter(|g| term.is_empty() || g.title.to_lowercase().contains(&term))
        .map(|game| {
            let banner = image(
                game.leader
                    .as_ref()
                    .and_then(|l| l.background_image_url.as_deref()),
                Pic::Side(64),
            );
            LbSideGame {
                key: game.key().into(),
                title: game.title.clone().into(),
                cover: image(game.cover_image_url.as_deref(), Pic::Cover),
                rank: ordinal(game.rank).into(),
                has_leader: game.leader.is_some(),
                leader_name: game
                    .leader
                    .as_ref()
                    .map(|l| l.display_name.clone())
                    .unwrap_or_default()
                    .into(),
                leader_avatar: image(
                    game.leader
                        .as_ref()
                        .and_then(|l| l.profile_image_url.as_deref()),
                    Pic::Avatar,
                ),
                has_banner: banner.size().width > 0,
                banner,
                selected: Some(game.key()) == active_game,
            }
        })
        .collect();
    sync(&models.games, side_games);
}

/// The podium and table of a board (board-view.tsx).
#[allow(clippy::too_many_arguments)]
fn apply_board_view(
    data: &LeaderboardsData,
    models: &Models,
    board: &Board,
    board_key: &str,
    viewer: Option<&lb::User>,
    format: &dyn Fn(f64) -> String,
    show_delta: bool,
    can_report: bool,
) {
    let viewer_id = viewer.map(|v| v.id.as_str());
    let visible = with(|s| {
        if s.visible_for != board_key {
            s.visible_for = board_key.to_string();
            s.visible = lb::PAGE_SIZE;
            s.reviewer = None;
        }
        s.visible
    });
    let delta = |entry: &lb::Entry| {
        if show_delta {
            lb::rank_delta(entry.rank, lb::previous_rank(board, entry, viewer_id))
        } else {
            None
        }
    };
    let show_delta_column = show_delta && board.entries.iter().any(|e| delta(e).is_some());
    data.set_show_delta_column(show_delta_column);
    data.set_can_report(can_report);

    let podium: Vec<LbPodiumCard> = board
        .entries
        .iter()
        .take(lb::PODIUM_SIZE)
        .map(|entry| {
            let banner = image(entry.user.background_image_url.as_deref(), Pic::Podium);
            let d = if entry.rank > 1 { delta(entry) } else { None };
            LbPodiumCard {
                user_id: entry.user.id.clone().into(),
                rank: entry.rank as i32,
                tier: lb::rank_tier(entry.rank).into(),
                name: entry.user.display_name.clone().into(),
                avatar: image(entry.user.profile_image_url.as_deref(), Pic::Avatar),
                has_banner: banner.size().width > 0,
                banner,
                value: format(entry.value).into(),
                has_delta: d.is_some(),
                delta: d.unwrap_or(0) as i32,
                viewer: Some(entry.user.id.as_str()) == viewer_id,
                selected: false,
                reportable: can_report && Some(entry.user.id.as_str()) != viewer_id,
            }
        })
        .collect();
    sync(&models.podium, podium);

    let all = lb::build_rows(board, viewer, visible);
    let listed = visible.min(board.entries.len());
    let rows: Vec<LbRow> = lb::rows_below_podium(&all, listed)
        .iter()
        .map(|row| {
            let entry = &row.entry;
            let banner = image(entry.user.background_image_url.as_deref(), Pic::Row);
            let d = delta(entry);
            LbRow {
                user_id: entry.user.id.clone().into(),
                rank: entry.rank as i32,
                tier: lb::rank_tier(entry.rank).into(),
                name: entry.user.display_name.clone().into(),
                avatar: image(entry.user.profile_image_url.as_deref(), Pic::Avatar),
                has_banner: banner.size().width > 0,
                banner,
                value: format(entry.value).into(),
                has_delta: d.is_some(),
                delta: d.unwrap_or(0) as i32,
                viewer: row.is_viewer,
                gap_before: row.gap_before,
                reportable: can_report && !row.is_viewer,
                has_tip: false,
                tip_cover: Image::default(),
                tip_game: Default::default(),
                tip_score: Default::default(),
                tip_text: Default::default(),
            }
        })
        .collect();
    sync(&models.rows, rows);
    data.set_has_more(board.entries.len() > visible);
}

fn apply_insight(
    data: &LeaderboardsData,
    board: &Board,
    metric: &Metric,
    period: &str,
    viewer_id: Option<&str>,
) {
    let Some(insight) = lb::insight(board, viewer_id) else {
        data.set_has_insight(false);
        return;
    };
    data.set_has_insight(true);
    let amount = |value: f64| -> Arg {
        let key = format!("leaderboards.insight_amount_{}", metric.id);
        let text = tr_count(&key, value, &[("amount", number(value).into())]);
        or_default(&key, text, || format_value(metric, value)).into()
    };
    // The streak does not restart with the week, so it has no deadline.
    let deadline = period == "week" && metric.id != "streak";
    let mut detail = None;
    let main = match insight {
        Insight::Unranked => {
            let key = format!("leaderboards.insight_unranked_{}", metric.id);
            if has_key(&key) {
                rich_line(&key, None, &[])
            } else {
                rich_line("leaderboards.insight_unranked", None, &[])
            }
        }
        Insight::Ranked { rank } => rich_line(
            "leaderboards.insight_ranked",
            None,
            &[("rank", number(rank as f64).into())],
        ),
        Insight::Leading {
            gap,
            target: Some(target),
        } => rich_line(
            "leaderboards.insight_leading",
            None,
            &[
                ("amount", amount(gap)),
                ("name", target.display_name.into()),
            ],
        ),
        Insight::Leading { target: None, .. } => {
            rich_line("leaderboards.insight_leading_alone", None, &[])
        }
        Insight::Outside { gap, last_rank } => rich_line(
            if deadline {
                "leaderboards.insight_outside_week"
            } else {
                "leaderboards.insight_outside"
            },
            None,
            &[
                ("amount", amount(gap)),
                ("rank", number(last_rank as f64).into()),
            ],
        ),
        Insight::Behind {
            gap,
            target,
            target_rank,
            next,
        } => {
            if let Some((goal, next_gap)) = next {
                detail = Some(rich_line(
                    &format!("leaderboards.insight_next_{goal}"),
                    None,
                    &[("amount", amount(next_gap))],
                ));
            }
            rich_line(
                if deadline {
                    "leaderboards.insight_behind_week"
                } else {
                    "leaderboards.insight_behind"
                },
                None,
                &[
                    ("amount", amount(gap)),
                    ("name", target.display_name.into()),
                    ("rank", number(target_rank as f64).into()),
                ],
            )
        }
    };
    data.set_insight_main(main);
    data.set_has_insight_detail(detail.is_some());
    data.set_insight_detail(detail.unwrap_or_default());
}

fn set_empty(
    data: &LeaderboardsData,
    icon: &str,
    title: &str,
    description: &str,
    action: &str,
    kind: &str,
) {
    data.set_empty_icon(icon.into());
    data.set_empty_title(tr(title).into());
    data.set_empty_description(if description.is_empty() {
        Default::default()
    } else {
        tr(description).into()
    });
    data.set_empty_action(if action.is_empty() {
        Default::default()
    } else {
        tr(action).into()
    });
    data.set_empty_action_kind(kind.into());
}

fn state_name(state: BoardState) -> &'static str {
    match state {
        BoardState::Loading => "loading",
        BoardState::Error => "error",
        BoardState::Ready => "ready",
        BoardState::Empty => "empty",
        BoardState::EmptyFriends => "empty_friends",
    }
}

/// ranking-tab.tsx
fn apply_ranking(
    data: &LeaderboardsData,
    models: &Models,
    period: &str,
    scope: &str,
    viewer: Option<&lb::User>,
) {
    let viewer_id = viewer.map(|v| v.id.clone());
    let (metric, metrics_loading, metrics_error, current) = with(|s| {
        let metric = ranking_metric(s);
        let current = metric
            .as_ref()
            .and_then(|m| s.boards.get(&m.id))
            .map(|r| (r.data.clone(), r.loading, r.error, r.key.clone()));
        (metric, s.metrics.loading, s.metrics.error, current)
    });
    // EMPTY_BOARD_RESULT is loading
    let (board, loading, error, query) = current.unwrap_or((None, true, false, String::new()));
    let state = lb::board_state(
        loading || metrics_loading,
        error || metrics_error,
        board.as_ref(),
        scope,
        viewer_id.as_deref(),
    );
    let is_week = period == "week";
    data.set_board_is_game(false);
    data.set_board_state(state_name(state).into());
    data.set_board_title(metric.as_ref().map(metric_label).unwrap_or_default().into());
    data.set_board_description(
        metric
            .as_ref()
            .map(|m| {
                let key = format!("leaderboards.metric_description_{}", m.id);
                or_default(&key, tr(&key), String::new)
            })
            .unwrap_or_default()
            .into(),
    );
    data.set_board_icon(
        metric
            .as_ref()
            .map(|m| m.id.clone())
            .unwrap_or_default()
            .into(),
    );
    data.set_value_column(metric.as_ref().map(column_label).unwrap_or_default().into());
    let count = match (&board, state) {
        (Some(board), BoardState::Ready) => match board.total {
            Some(total) if scope == "global" => tr_count(
                "leaderboards.players_total",
                total,
                &[("total", number(total).into())],
            ),
            _ => tr_count(
                "leaderboards.players_count",
                board.entries.len() as f64,
                &[],
            ),
        },
        _ => String::new(),
    };
    data.set_board_count(count.into());
    match state {
        BoardState::Empty => {
            if is_week {
                set_empty(
                    data,
                    "clock",
                    "leaderboards.empty_week_title",
                    "leaderboards.empty_week_ranking_description",
                    "leaderboards.see_all_time",
                    "see_all",
                );
            } else {
                set_empty(
                    data,
                    "clock",
                    "leaderboards.empty_all_title",
                    "leaderboards.empty_all_ranking_description",
                    "leaderboards.go_to_library",
                    "library",
                );
            }
        }
        BoardState::EmptyFriends => set_empty(
            data,
            "people",
            "leaderboards.empty_friends_title",
            "leaderboards.empty_friends_ranking_description",
            "leaderboards.find_friends",
            "friends",
        ),
        _ => {}
    }
    match (state, board, metric) {
        (BoardState::Ready, Some(board), metric) => {
            if let Some(metric) = &metric {
                apply_insight(data, &board, metric, period, viewer_id.as_deref());
            } else {
                data.set_has_insight(false);
            }
            let format_metric = metric.clone();
            let format = move |value: f64| match &format_metric {
                Some(m) => format_value(m, value),
                None => value.to_string(),
            };
            let can_report =
                metric.is_some() && viewer.is_some() && features::enabled(LEADERBOARD_REPORTS);
            apply_board_view(
                data,
                models,
                &board,
                &format!(
                    "ranking|{query}|{}",
                    metric.map(|m| m.id).unwrap_or_default()
                ),
                viewer,
                &format,
                is_week,
                can_report,
            );
        }
        _ => {
            sync(&models.podium, Vec::new());
            sync(&models.rows, Vec::new());
            data.set_has_more(false);
            data.set_has_insight(false);
        }
    }
}

/// by-game-tab.tsx
fn apply_game_board(
    data: &LeaderboardsData,
    models: &Models,
    period: &str,
    scope: &str,
    viewer: Option<&lb::User>,
) {
    let viewer_id = viewer.map(|v| v.id.clone());
    let (
        metrics,
        metrics_loading,
        metrics_error,
        metric,
        game,
        from_link,
        board_res,
        games,
        assets,
    ) = with(|s| {
        let (game, from_link) = board_game(s);
        let assets = game
            .as_ref()
            .and_then(|(shop, id)| s.assets.get(&lb::game_key(shop, id)).cloned());
        (
            s.game_metrics.data.clone(),
            s.game_metrics.loading,
            s.game_metrics.error,
            game_metric(s),
            game,
            from_link,
            (
                s.game_board.data.clone(),
                s.game_board.loading,
                s.game_board.error,
                s.game_board.key.clone(),
            ),
            shown_games(s),
            assets,
        )
    });
    let Some((shop, object_id)) = game else {
        data.set_board_state("none".into());
        return;
    };
    let has_no_game_metrics =
        !metrics_loading && !metrics_error && metrics.as_ref().is_some_and(Vec::is_empty);
    let (board, board_loading, board_error, board_key) = board_res;
    let state = lb::board_state(
        board_loading || metrics_loading,
        board_error || metrics_error,
        board.as_ref(),
        scope,
        viewer_id.as_deref(),
    );
    let is_week = period == "week";
    let listed = games
        .iter()
        .find(|g| g.shop == shop && g.object_id == object_id);
    // the linked game's title and cover come from its assets
    let title = match listed {
        Some(game) => game.title.clone(),
        None if from_link => assets
            .as_ref()
            .and_then(|a| a.as_ref())
            .map(|a| a.title.clone())
            .unwrap_or_default(),
        None => String::new(),
    };
    let cover_url = listed.and_then(|g| g.cover_image_url.clone()).or_else(|| {
        assets
            .as_ref()
            .and_then(|a| a.as_ref())
            .and_then(|a| a.cover.clone())
    });
    // useGameIcon: nothing while loading, then the icon, else the cover
    let icon = match &assets {
        Some(Some(a)) => a.icon.clone().or(cover_url).map(|u| (u, Pic::Icon)),
        _ => None,
    };
    data.set_board_is_game(true);
    data.set_board_title(title.into());
    data.set_board_cover(match &icon {
        Some((url, pic)) => image(Some(url), *pic),
        None => Image::default(),
    });
    data.set_board_count(Default::default());
    data.set_board_description(
        metric
            .as_ref()
            .map(|m| {
                let key = format!("leaderboards.game_metric_description_{}", m.id);
                or_default(&key, tr(&key), String::new)
            })
            .unwrap_or_default()
            .into(),
    );
    let options: Vec<LbOption> = metrics
        .unwrap_or_default()
        .iter()
        .map(|m| LbOption {
            id: m.id.clone().into(),
            label: metric_label(m).into(),
        })
        .collect();
    if !same_rows(&data.get_game_metrics(), &options) {
        data.set_game_metrics(ModelRc::new(VecModel::from(options)));
    }
    data.set_game_metric(
        metric
            .as_ref()
            .map(|m| m.id.clone())
            .unwrap_or_default()
            .into(),
    );
    data.set_value_column(metric.as_ref().map(column_label).unwrap_or_default().into());
    let state_text = if has_no_game_metrics {
        "no_metrics"
    } else {
        state_name(state)
    };
    data.set_board_state(state_text.into());
    if has_no_game_metrics {
        set_empty(
            data,
            "trophy",
            "leaderboards.game_metrics_empty_title",
            "leaderboards.game_metrics_empty_description",
            "",
            "",
        );
    } else if state == BoardState::Empty {
        if is_week {
            set_empty(
                data,
                "trophy",
                "leaderboards.empty_week_title",
                "leaderboards.empty_week_game_description",
                "leaderboards.see_all_time",
                "see_all",
            );
        } else {
            set_empty(
                data,
                "trophy",
                "leaderboards.empty_all_title",
                "leaderboards.empty_all_game_description",
                "leaderboards.open_game_page",
                "game_page",
            );
        }
    } else if state == BoardState::EmptyFriends {
        set_empty(
            data,
            "people",
            "leaderboards.empty_friends_game_title",
            "leaderboards.empty_friends_game_description",
            "leaderboards.see_global_ranking",
            "global",
        );
    }
    match (state, board, metric) {
        (BoardState::Ready, Some(board), Some(metric)) if !has_no_game_metrics => {
            apply_insight(data, &board, &metric, period, viewer_id.as_deref());
            let m = metric.clone();
            let format = move |value: f64| format_value(&m, value);
            let can_report = viewer.is_some() && features::enabled(LEADERBOARD_REPORTS);
            apply_board_view(
                data,
                models,
                &board,
                &format!("game|{board_key}"),
                viewer,
                &format,
                is_week,
                can_report,
            );
        }
        _ => {
            sync(&models.podium, Vec::new());
            sync(&models.rows, Vec::new());
            data.set_has_more(false);
            data.set_has_insight(false);
        }
    }
}

/// stats-tab.tsx
fn apply_stats(data: &LeaderboardsData, models: &Models, period: &str, viewer: Option<&lb::User>) {
    let viewer_id = viewer.map(|v| v.id.clone());
    let is_week = period == "week";
    data.set_mine_title(
        tr(if is_week {
            "leaderboards.mine_week_title"
        } else {
            "leaderboards.mine_all_title"
        })
        .into(),
    );
    data.set_viewer_name(
        viewer
            .map(|v| v.display_name.clone())
            .unwrap_or_default()
            .into(),
    );
    data.set_viewer_avatar(image(
        viewer.and_then(|v| v.profile_image_url.as_deref()),
        Pic::Avatar,
    ));
    let banner = image(
        viewer.and_then(|v| v.background_image_url.as_deref()),
        Pic::Header,
    );
    data.set_has_viewer_banner(banner.size().width > 0);
    data.set_viewer_banner(banner);

    let (metrics, results) = with(|s| {
        let metrics = s.metrics.data.clone().unwrap_or_default();
        let results: Vec<(Option<Board>, bool, bool)> = metrics
            .iter()
            .map(|m| {
                s.boards
                    .get(&m.id)
                    .map(|r| (r.data.clone(), r.loading, r.error))
                    .unwrap_or((None, true, false))
            })
            .collect();
        (metrics, results)
    });
    let mut failed_any = false;
    let mine: Vec<LbMineRow> = metrics
        .iter()
        .zip(results.iter())
        .map(|(metric, (board, loading, error))| {
            let ranking = lb::viewer_ranking(board.as_ref(), viewer_id.as_deref());
            let pending = *loading && board.is_none();
            let failed = !*loading && *error && board.is_none();
            failed_any |= failed;
            let placeholder = if pending { "" } else { "–" };
            LbMineRow {
                metric_id: metric.id.clone().into(),
                label: metric_label(metric).into(),
                value: if failed {
                    tr("leaderboards.leader_error")
                } else {
                    ranking
                        .map(|r| format_value(metric, r.value))
                        .unwrap_or_else(|| placeholder.into())
                }
                .into(),
                rank: ranking
                    .map(|r| ordinal(r.rank))
                    .unwrap_or_else(|| placeholder.into())
                    .into(),
                pending,
                failed,
            }
        })
        .collect();
    sync(&models.mine, mine);
    data.set_mine_failed(failed_any);

    // friends' streaks
    let (friends, friends_loading, friends_error, visible) = with(|s| {
        (
            s.friends.data.clone(),
            s.friends.loading,
            s.friends.error,
            s.friends_visible,
        )
    });
    let state = if friends_loading && friends.is_none() {
        "loading"
    } else if friends_error || friends.is_none() {
        "error"
    } else if friends
        .as_ref()
        .is_some_and(|f| f.iter().all(|i| Some(&i.user.id) == viewer_id.as_ref()))
    {
        "empty"
    } else {
        "ready"
    };
    data.set_friends_state(state.into());
    let others: Vec<lb::FriendStreak> = friends
        .unwrap_or_default()
        .into_iter()
        .filter(|f| Some(&f.user.id) != viewer_id.as_ref())
        .collect();
    data.set_friends_total(others.len() as i32);
    data.set_friends_visible(visible as i32);
    let cards: Vec<LbFriendStreak> = others
        .iter()
        .take(visible)
        .map(|f| {
            let banner = image(f.user.background_image_url.as_deref(), Pic::Row);
            LbFriendStreak {
                user_id: f.user.id.clone().into(),
                name: f.user.display_name.clone().into(),
                avatar: image(f.user.profile_image_url.as_deref(), Pic::Avatar),
                has_banner: banner.size().width > 0,
                banner,
                online: f.online,
                days: tr_count("leaderboards.days_count", f.days, &[]).into(),
            }
        })
        .collect();
    sync(&models.friends, cards);

    // activity
    let (activity, activity_loading, activity_error, width) = with(|s| {
        (
            s.activity.data.clone(),
            s.activity.loading,
            s.activity.error,
            s.heat_width,
        )
    });
    let state = if activity_loading && activity.is_none() {
        "loading"
    } else if activity_error || activity.is_none() {
        "error"
    } else {
        "ready"
    };
    data.set_activity_state(state.into());
    let Some(activity) = activity else {
        sync(&models.heat, Vec::new());
        return;
    };
    let language = language();
    data.set_streak_current(activity.current_streak.to_string().into());
    data.set_streak_best(activity.best_streak.to_string().into());
    data.set_streak_current_unit(
        tr_count("leaderboards.days_unit", activity.current_streak, &[]).into(),
    );
    data.set_streak_best_unit(tr_count("leaderboards.days_unit", activity.best_streak, &[]).into());
    // useUtcDay
    let utc_day = now_ms().div_euclid(lb::DAY_MS) * lb::DAY_MS;
    let heatmap = lb::build_heatmap(&activity.days, utc_day, activity.weeks);
    let layout = lb::heatmap_layout(
        (width > 0.0).then_some(width as f64),
        heatmap.len() / lb::DAYS_PER_WEEK,
    );
    let visible_cells = &heatmap[heatmap.len() - layout.weeks * lb::DAYS_PER_WEEK..];
    data.set_heat_size(layout.cell_size as f32);
    data.set_heat_weeks(layout.weeks as i32);
    data.set_heat_width(layout.width as f32);
    let months: Vec<LbMonth> = lb::heatmap_months(visible_cells)
        .iter()
        .map(|(week, date)| LbMonth {
            week: *week as i32,
            label: intl::capitalize(&intl::month_short(&language, *date)).into(),
        })
        .collect();
    if !same_rows(&data.get_heat_months(), &months) {
        data.set_heat_months(ModelRc::new(VecModel::from(months)));
    }
    let days: Vec<slint::SharedString> = (0..7)
        .map(|i| {
            if [0, 2, 4].contains(&i) {
                intl::capitalize(&intl::weekday_short(&language, i)).into()
            } else {
                Default::default()
            }
        })
        .collect();
    if !same_rows(&data.get_heat_days(), &days) {
        data.set_heat_days(ModelRc::new(VecModel::from(days)));
    }
    let cells: Vec<LbHeatCell> = visible_cells
        .iter()
        .map(|cell| LbHeatCell {
            level: cell.level as i32,
            future: cell.is_future,
            today: cell.is_today,
            summary: cell_summary(cell, &language).into(),
            games: cell
                .games
                .iter()
                .enumerate()
                .map(|(i, g)| format!("{}{g}", if i == 0 { " · " } else { ", " }))
                .collect::<String>()
                .into(),
        })
        .collect();
    sync(&models.heat, cells);
    let (seconds, played) = lb::sum_heatmap(visible_cells);
    let total = match lb::heatmap_total(seconds, played) {
        lb::HeatTotal::None => tr("leaderboards.activity_empty"),
        lb::HeatTotal::Minutes(minutes) => tr_count(
            "leaderboards.activity_total_minutes",
            played as f64,
            &[("minutes", (minutes as i64).to_string().into())],
        ),
        lb::HeatTotal::Hours(hours) => tr_count(
            "leaderboards.activity_total",
            played as f64,
            &[("hours", number(hours).into())],
        ),
    };
    data.set_activity_total(total.into());
}

/// cellSummary: "Today · 1 h 20 min" (days are UTC, so today and yesterday
/// are named instead of shown as dates).
fn cell_summary(cell: &lb::HeatCell, language: &str) -> String {
    let label = if cell.is_today {
        tr("leaderboards.today")
    } else if cell.is_yesterday {
        tr("leaderboards.yesterday")
    } else {
        intl::day_label(language, cell.date_ms)
    };
    let total_minutes = (cell.seconds / 60.0).round().max(1.0) as i64;
    let (hours, minutes) = (total_minutes / 60, total_minutes % 60);
    let time = if cell.seconds <= 0.0 {
        tr("leaderboards.not_played")
    } else if hours > 0 {
        tr_with(
            "leaderboards.duration_hours_minutes",
            &[
                ("hours", hours.to_string().into()),
                ("minutes", minutes.to_string().into()),
            ],
        )
    } else {
        tr_with(
            "leaderboards.duration_minutes",
            &[("minutes", minutes.to_string().into())],
        )
    };
    format!("{label} · {time}")
}

/// badges-section.tsx
fn apply_badges(data: &LeaderboardsData, models: &Models) {
    let (badges, loading, error, expanded, definitions) = with(|s| {
        let mut definitions = s.metrics.data.clone().unwrap_or_default();
        definitions.extend(s.game_metrics.data.clone().unwrap_or_default());
        (
            s.badges.data.clone(),
            s.badges.loading,
            s.badges.error,
            s.badges_expanded,
            definitions,
        )
    });
    let state = if loading && badges.is_none() {
        "loading"
    } else if error || badges.is_none() {
        "error"
    } else {
        "ready"
    };
    data.set_badges_state(state.into());
    let Some(badges) = badges else {
        data.set_badges_count(Default::default());
        sync(&models.badges, Vec::new());
        return;
    };
    data.set_badges_count(
        tr_with(
            "leaderboards.badges_count",
            &[
                ("earned", number(badges.earned).into()),
                ("total", number(badges.total).into()),
            ],
        )
        .into(),
    );
    data.set_badges_more(!expanded && badges.badges.len() > lb::BADGES_PAGE_SIZE);
    let find = |id: &str| definitions.iter().find(|d| d.id == id).cloned();
    let language = language();
    let list: Vec<LbBadge> = badges
        .badges
        .iter()
        .take(if expanded {
            usize::MAX
        } else {
            lb::BADGES_PAGE_SIZE
        })
        .map(|badge| {
            let metric = badge.metric.as_deref().map(|id| {
                find(id).unwrap_or(Metric {
                    id: id.to_string(),
                    value_type: ValueType::Count,
                    label: id.to_string(),
                })
            });
            let metric_text = metric.as_ref().map(metric_label).unwrap_or_default();
            let game = badge.game_title.clone().unwrap_or_default();
            let title = match badge.kind.as_str() {
                "top_percent" => tr_with(
                    "leaderboards.badge_top_percent",
                    &[
                        ("percent", number(badge.value).into()),
                        ("game", game.clone().into()),
                    ],
                ),
                "weekly_leader" => tr_with(
                    "leaderboards.badge_weekly_leader",
                    &[("game", game.clone().into())],
                ),
                "top_rank" => tr_with(
                    "leaderboards.badge_top_rank",
                    &[
                        ("rank", number(badge.value).into()),
                        ("game", game.clone().into()),
                    ],
                ),
                "friends_podium" => tr("leaderboards.badge_friends_podium"),
                _ => tr_count("leaderboards.badge_streak_record", badge.value, &[]),
            };
            let subtitle = match badge.kind.as_str() {
                "streak_record" => tr("leaderboards.badge_personal_record"),
                "friends_podium" => [
                    badge.game_title.clone().unwrap_or_default(),
                    metric_text.clone(),
                ]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" · "),
                "weekly_leader" if badge.earned_at.is_none() && badge.current_rank.is_some() => {
                    format!(
                        "{metric_text} · {}",
                        tr_with(
                            "leaderboards.you_are_at",
                            &[("rank", badge.current_rank.unwrap_or(0).to_string().into())]
                        )
                    )
                }
                "weekly_leader" if badge.week.is_some() => format!(
                    "{metric_text} · {}",
                    tr_with(
                        "leaderboards.week_number",
                        &[("number", badge.week.unwrap_or(0).to_string().into())]
                    )
                ),
                _ => format!(
                    "{metric_text} · {}",
                    tr(&format!("leaderboards.scope_{}", badge.scope))
                ),
            };
            let chip = match badge.kind.as_str() {
                "top_percent" => tr_with(
                    "leaderboards.chip_top_percent",
                    &[("percent", number(badge.value).into())],
                ),
                "top_rank" => match (badge.current_rank, &badge.earned_at) {
                    (Some(rank), Some(_)) => format!("#{rank}"),
                    _ => tr_with(
                        "leaderboards.chip_top_rank",
                        &[("rank", number(badge.value).into())],
                    ),
                },
                "streak_record" => tr_count("leaderboards.chip_days", badge.value, &[]),
                _ => ordinal(badge.value as u32),
            };
            let meta = badge_meta(badge, metric.as_ref(), &language);
            let locked = badge.earned_at.is_none();
            LbBadge {
                id: badge.id.clone().into(),
                tier: badge.tier.clone().into(),
                locked,
                ring: !locked && badge.tier != "streak",
                streak: badge.kind == "streak_record",
                title: title.into(),
                subtitle: subtitle.into(),
                chip: chip.into(),
                meta: meta.into(),
                progress: lb::badge_progress(badge) as f32,
                cover: image(badge.cover_image_url.as_deref(), Pic::Icon),
            }
        })
        .collect();
    sync(&models.badges, list);
}

/// getMeta: earned date, or what is left to the target.
fn badge_meta(badge: &lb::Badge, metric: Option<&Metric>, language: &str) -> String {
    if let Some(earned) = &badge.earned_at {
        let date = lb::parse_date(earned)
            .map(|ms| hydra_i18n::date::format_date(language, ms))
            .unwrap_or_default();
        let key = if badge.kind == "weekly_leader" || badge.kind == "streak_record" {
            "leaderboards.badge_earned_on"
        } else {
            "leaderboards.badge_since"
        };
        return tr_with(key, &[("date", date.into())]);
    }
    let Some((current, target)) = badge.progress else {
        return String::new();
    };
    let remaining = (target - current).max(0.0);
    let Some(metric) = metric.filter(|_| badge.metric.is_some()) else {
        return tr_with(
            "leaderboards.badge_remaining",
            &[("amount", number(remaining.ceil()).into())],
        );
    };
    let count = remaining.ceil();
    let key = format!("leaderboards.badge_amount_{}", metric.id);
    let amount = or_default(
        &key,
        tr_count(&key, count, &[("amount", number(count).into())]),
        || format_value(metric, count),
    );
    if let Some(target) = &badge.target {
        let shown = if metric.value_type == ValueType::Duration {
            lb::duration_parts(count, lb::MAX_MINUTES_TO_SHOW_IN_PLAYTIME).1
        } else {
            count
        };
        return tr_count(
            &format!("leaderboards.badge_remaining_to_{}", target.kind),
            shown,
            &[
                ("amount", amount.into()),
                ("value", number(target.value).into()),
            ],
        );
    }
    tr_with("leaderboards.badge_remaining", &[("amount", amount.into())])
}

// ---- actions ------------------------------------------------------------

/// The view resets of a remount (key={generation}): rows shown, the selected
/// review, friends shown, badges expanded.
fn reset_view(s: &mut State) {
    s.visible = lb::PAGE_SIZE;
    s.visible_for.clear();
    s.reviewer = None;
    s.friends_visible = lb::FRIEND_STREAK_PAGE_SIZE;
    s.badges_expanded = false;
}

fn bump_generation() {
    with(|s| {
        s.generation += 1;
        reset_view(s);
    });
    if let Some(ui) = ui() {
        ui.global::<LeaderboardsData>()
            .set_generation(with(|s| s.generation));
    }
}

/// retryAll: the metrics and every board again.
fn retry_all() {
    reset(|s| &mut s.metrics);
    with(|s| s.boards_query.clear());
    load_all();
}

/// dropGameLink: leaving a linked game drops the link from the URL.
fn drop_game_link() {
    if with(|s| s.linked.take()).is_some() {
        nav::replace_current("/leaderboards");
    }
}

/// handleViewChange
fn change_view(tab: &str) {
    with(|s| s.tab = tab.to_string());
    drop_game_link();
    // scrollTo({ top: 0 })
    if let Some(ui) = ui() {
        let data = ui.global::<LeaderboardsData>();
        data.set_scroll_top(data.get_scroll_top() + 1);
    }
    load_all();
}

fn set_period(value: &str) {
    shell::storage_set(PERIOD_STORAGE_KEY, value);
    with(|s| s.period = value.to_string());
    load_all();
}

fn set_scope(value: &str) {
    shell::storage_set(SCOPE_STORAGE_KEY, value);
    with(|s| s.scope = value.to_string());
    load_all();
}

/// "Find friends": requestAddFriendMode + the friends window.
fn find_friends() {
    shell::storage_set(ADD_FRIEND_REQUEST_KEY, &now_ms().to_string());
    if let Some(ui) = ui() {
        ui.global::<Session>().invoke_open_friends();
    }
}

fn open_game_page() {
    let Some((shop, object_id, title)) = with(|s| {
        let (game, _) = board_game(s);
        let (shop, object_id) = game?;
        let title = shown_games(s)
            .iter()
            .find(|g| g.shop == shop && g.object_id == object_id)
            .map(|g| g.title.clone())
            .or_else(|| {
                s.assets
                    .get(&lb::game_key(&shop, &object_id))
                    .cloned()
                    .flatten()
                    .map(|a| a.title)
            })
            .unwrap_or_default();
        Some((shop, object_id, title))
    }) else {
        return;
    };
    nav::navigate(&format!(
        "/game/{shop}/{object_id}?title={}",
        nav::encode(&title)
    ));
}

fn empty_action() {
    let tab = effective_tab();
    if tab == "stats" {
        find_friends();
        return;
    }
    let Some(ui) = ui() else { return };
    let kind = ui.global::<LeaderboardsData>().get_empty_action_kind();
    match kind.as_str() {
        "see_all" => set_period("all"),
        "library" => nav::navigate("/library"),
        "friends" => find_friends(),
        "game_page" => open_game_page(),
        "global" => set_scope("global"),
        _ => {}
    }
}

/// ReportCheaterModal: POST /users/:id/report with the board's context.
fn report(user_id: &str) {
    let Some(entry) = with(|s| {
        let tab = effective_tab_of(s);
        let board = if tab == "games" {
            s.game_board.data.clone()
        } else {
            ranking_metric(s).and_then(|m| s.boards.get(&m.id).and_then(|r| r.data.clone()))
        };
        board.and_then(|b| b.entries.iter().find(|e| e.user.id == user_id).cloned())
    }) else {
        return;
    };
    let (tab, period, scope, metric, game) = with(|s| {
        let tab = effective_tab_of(s);
        let metric = if tab == "games" {
            game_metric(s)
        } else {
            ranking_metric(s)
        };
        let game = if tab == "games" {
            board_game(s).0
        } else {
            None
        };
        (tab, s.period.clone(), current_scope(s), metric, game)
    });
    let Some(metric) = metric else { return };
    let _ = tab;
    let value = format_value(&metric, entry.value);
    dialogs::field(
        dialogs::Field {
            title: &tr("leaderboards.report_cheater_title"),
            description: "",
            label: &tr("leaderboards.report_cheater_details"),
            placeholder: &tr("leaderboards.report_cheater_details_placeholder"),
            text: "",
            confirm_label: &tr("leaderboards.report_cheater_confirm"),
            cancel_label: &tr("leaderboards.report_cheater_cancel"),
        },
        move |description| {
            let Some(api) = shell::api() else { return };
            dialogs::set_busy(true);
            let mut context = serde_json::json!({
                "source": "leaderboard",
                "metric": metric.id,
                "window": period,
                "scope": scope,
                "rank": entry.rank,
                "value": entry.value,
            });
            if let Some((shop, object_id)) = &game {
                context["shop"] = Value::String(shop.clone());
                context["objectId"] = Value::String(object_id.clone());
            }
            let mut body = serde_json::json!({ "reason": "cheating", "context": context });
            let description = description.trim().to_string();
            if !description.is_empty() {
                body["description"] = Value::String(description);
            }
            let path = format!("/users/{}/report", entry.user.id);
            std::thread::spawn(move || {
                let result = api.post(&path, &body, Options::default());
                let _ = slint::invoke_from_event_loop(move || {
                    dialogs::set_busy(false);
                    match result {
                        Ok(_) => {
                            toast::success(&tr("leaderboards.report_cheater_sent"));
                            dialogs::close();
                        }
                        Err(error) => {
                            eprintln!("leaderboards: report failed: {error}");
                            let rate_limited = error.to_string().contains(RATE_LIMITED_ERROR)
                                || error.code() == Some(RATE_LIMITED_ERROR);
                            toast::error(&tr(if rate_limited {
                                "leaderboards.report_cheater_rate_limited"
                            } else {
                                "leaderboards.report_cheater_failed"
                            }));
                        }
                    }
                });
            });
        },
    );
    dialogs::set_field_extras(
        &tr_with(
            "leaderboards.report_cheater_description",
            &[
                ("name", entry.user.display_name.clone().into()),
                ("rank", entry.rank.to_string().into()),
                ("value", value.into()),
            ],
        ),
        ui().map(|ui| ui.global::<LeaderboardsData>().get_report_icon())
            .unwrap_or_default(),
        Some(REPORT_DESCRIPTION_MAX_LENGTH),
    );
}

// ---- wiring -------------------------------------------------------------

/// The sidebar entry shows with GLOBAL_LEADERBOARDS.
fn sync_feature() {
    let enabled = features::enabled(GLOBAL_LEADERBOARDS);
    if let Some(ui) = ui() {
        ui.global::<SidebarState>()
            .set_leaderboards_enabled(enabled);
    }
    // Leaderboards(): without the feature, the page goes home once flags load
    if !enabled && features::loaded() && with(|s| s.open) {
        nav::navigate("/");
    }
}

pub fn init(ui: &AppWindow) {
    with(|s| {
        s.ui = ui.as_weak();
        s.friends_visible = lb::FRIEND_STREAK_PAGE_SIZE;
        s.visible = lb::PAGE_SIZE;
    });
    let data = ui.global::<LeaderboardsData>();
    data.on_set_scope(|v| set_scope(&v));
    data.on_set_period(|v| set_period(&v));
    data.on_set_side_list(|v| {
        with(|s| s.side_list = v.to_string());
        queue_apply();
    });
    data.on_open_stats(|| change_view("stats"));
    data.on_open_metric(|id| {
        with(|s| s.metric = Some(id.to_string()));
        change_view("ranking");
    });
    data.on_open_game(|key| {
        with(|s| s.selected_game = Some(key.to_string()));
        change_view("games");
    });
    data.on_set_game_metric(|id| {
        with(|s| s.game_metric = Some(id.to_string()));
        load_all();
    });
    data.on_search_games(|text| {
        with(|s| s.search = text.to_string());
        queue_apply();
    });
    data.on_retry(|| {
        if effective_tab() == "games" {
            reset(|s| &mut s.game_metrics);
            reset(|s| &mut s.game_board);
            load_all();
        } else {
            retry_all();
        }
    });
    data.on_retry_games(|| {
        reset(|s| &mut s.games);
        load_all();
    });
    data.on_retry_friends(|| {
        reset(|s| &mut s.friends);
        load_all();
    });
    data.on_retry_activity(|| {
        reset(|s| &mut s.activity);
        load_all();
    });
    data.on_retry_badges(|| {
        reset(|s| &mut s.badges);
        load_all();
    });
    data.on_load_more(|| {
        with(|s| s.visible += lb::PAGE_STEP);
        queue_apply();
    });
    data.on_friends_more(|| {
        with(|s| s.friends_visible += lb::FRIEND_STREAK_PAGE_SIZE);
        queue_apply();
    });
    data.on_show_more_badges(|| {
        with(|s| s.badges_expanded = true);
        queue_apply();
    });
    data.on_open_profile(|id| nav::navigate(&format!("/profile/{id}")));
    data.on_select_entry(|id| nav::navigate(&format!("/profile/{id}")));
    data.on_open_game_page(open_game_page);
    data.on_empty_clicked(empty_action);
    data.on_go_library(|| nav::navigate("/library"));
    data.on_report(|id| report(&id));
    data.on_activity_width_changed(|width| {
        let changed = with(|s| {
            let changed = (s.heat_width - width).abs() > 0.5;
            s.heat_width = width;
            changed
        });
        if changed {
            queue_apply();
        }
    });

    features::on_loaded(sync_feature);
    sync_feature();
    features::load();
}

/// The /leaderboards route opened (or its link changed while open).
pub fn open(location: &Location) {
    let link = format!(
        "{}?{}",
        location.pathname,
        location
            .query
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("&")
    );
    let was_open = with(|s| std::mem::replace(&mut s.open, true));
    if was_open && with(|s| s.last_link == link) {
        return;
    }
    with(|s| s.last_link = link.clone());
    features::load();
    if !features::enabled(GLOBAL_LEADERBOARDS) && features::loaded() {
        nav::navigate("/");
        return;
    }

    let param = |name: &str| {
        location
            .param(name)
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    };
    let tab = param("tab").filter(|t| lb::TABS.contains(&t.as_str()));
    let linked = match (param("shop"), param("objectId")) {
        (Some(shop), Some(object_id)) => Some((shop, object_id)),
        _ => None,
    };
    let period = param("period").filter(|p| lb::PERIODS.contains(&p.as_str()));
    let scope = param("scope").filter(|p| lb::SCOPES.contains(&p.as_str()));
    let metric = param("metric");
    let source = param("source");

    with(|s| {
        if !was_open {
            // a fresh page (useState initializers)
            s.tab = tab.clone().unwrap_or_else(|| "ranking".into());
            s.metric = if linked.is_some() {
                None
            } else {
                metric.clone()
            };
            s.period = period.clone().unwrap_or_else(|| {
                shell::storage_get(PERIOD_STORAGE_KEY)
                    .filter(|p| lb::PERIODS.contains(&p.as_str()))
                    .unwrap_or_else(|| "week".into())
            });
            s.scope = scope.clone().unwrap_or_else(|| {
                shell::storage_get(SCOPE_STORAGE_KEY)
                    .filter(|p| lb::SCOPES.contains(&p.as_str()))
                    .unwrap_or_else(|| "global".into())
            });
            s.selected_game = linked.as_ref().map(|(shop, id)| lb::game_key(shop, id));
            s.side_list = if s.tab == "games" {
                "games".into()
            } else {
                "categories".into()
            };
            s.search.clear();
            s.week_clock = now_ms();
            s.week_key.clear();
            s.game_metric = if linked.is_some() {
                metric.clone()
            } else {
                None
            };
            s.last_period = None;
            reset_view(s);
            // a remount reads the cache again (60s), else asks the API
            s.metrics.key.clear();
            s.game_metrics.key.clear();
            s.games.key.clear();
            s.game_board.key.clear();
            s.activity.key.clear();
            s.friends.key.clear();
            s.badges.key.clear();
            s.boards_query.clear();
            s.last_games = None;
        } else {
            // the effects that follow the URL while the page is open
            if let Some(m) = &metric
                && linked.is_none()
            {
                s.metric = Some(m.clone());
            }
            if let Some(scope) = &scope {
                s.scope = scope.clone();
            }
            if let Some(period) = &period {
                s.period = period.clone();
            }
            if let Some(tab) = &tab {
                s.tab = tab.clone();
            }
            if let Some((shop, id)) = &linked {
                s.selected_game = Some(lb::game_key(shop, id));
                if s.linked.as_ref() != Some(&(shop.clone(), id.clone())) {
                    // ByGameTab remounts with the link's metric
                    s.game_metric = metric.clone();
                }
            }
            if s.tab == "games" {
                s.side_list = "games".into();
            }
        }
        s.linked = linked.clone();
    });

    // a rank notification: tag the next board request with its source
    if let Some(source) = source.filter(|v| lb::LEADERBOARD_REQUEST_SOURCES.contains(&v.as_str()))
        && let Some(metric) = &metric
    {
        let path = lb::board_path(
            metric,
            linked.as_ref().map(|(a, b)| (a.as_str(), b.as_str())),
        );
        with(|s| {
            s.cache.evict_path(&path);
            s.attribution = Some(Attribution {
                path,
                scope: scope.clone().unwrap_or_else(|| "global".into()),
                period: period.clone().unwrap_or_else(|| "week".into()),
                source,
                expires_at: now_ms() + SOURCE_ATTRIBUTION_MS,
            });
            s.attributed = Some(link.clone());
            // the board is asked again (setGeneration + retry)
            s.boards_query.clear();
            s.game_board.key.clear();
        });
        bump_generation();
        // the source leaves the URL
        let without: Vec<String> = location
            .query
            .iter()
            .filter(|(k, _)| k != "source")
            .map(|(k, v)| format!("{k}={}", nav::encode(v)))
            .collect();
        let path = if without.is_empty() {
            "/leaderboards".to_string()
        } else {
            format!("/leaderboards?{}", without.join("&"))
        };
        with(|s| s.last_link = format!("/leaderboards?{}", without.join("&")));
        nav::replace_current(&path);
    } else if !was_open {
        bump_generation();
    }

    if let Some(ui) = ui() {
        let data = ui.global::<LeaderboardsData>();
        data.set_game_search(with(|s| s.search.clone()).into());
    }
    load_all();
    apply();
}

/// The route closed: stop the countdown, keep the cache.
pub fn close() {
    with(|s| {
        s.open = false;
        s.last_link.clear();
        s.countdown = None;
        s.countdown_end = 0;
        s.linked = None;
        // useState values start over on the next visit
        s.images.clear();
        s.pending_images.clear();
    });
    if let Some(ui) = ui() {
        let data = ui.global::<LeaderboardsData>();
        data.set_board_state("loading".into());
    }
    let models = with(|s| s.models.take());
    if let Some(models) = models {
        sync(&models.podium, Vec::new());
        sync(&models.rows, Vec::new());
        sync(&models.heat, Vec::new());
        sync(&models.friends, Vec::new());
        sync(&models.metrics, Vec::new());
        sync(&models.games, Vec::new());
        sync(&models.mine, Vec::new());
        sync(&models.badges, Vec::new());
        with(|s| s.models = Some(models));
    }
}
