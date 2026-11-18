//! The game page's ranking card (pages/game-details/leaderboard:
//! leaderboard-section.tsx, use-game-leaderboard.ts): the top five of the
//! game's board with the viewer pinned under them and their nudge, the scope,
//! period and metric selectors (shared with the Rankings page through the same
//! localStorage keys), every state, and "View full ranking", which opens the
//! game's board on the Rankings page.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use hydra_core::leaderboards::{self as lb, Board, CardState, Nudge, Request};
use hydra_media::images::{self, Op, Source};
use image::imageops::FilterType;
use slint::{ComponentHandle, Image, Model, ModelRc, VecModel};

use crate::leaderboards_page::{self as page, FetchError};
use crate::{AppWindow, GameLeaderboard, LbOption, LbRow, Session, features, nav, shell};

const PERIOD_STORAGE_KEY: &str = "leaderboard-period";
const SCOPE_STORAGE_KEY: &str = "leaderboard-scope";
const EXTENDED: &str = "GAME_LEADERBOARDS_EXTENDED";

/// LoadedLeaderboard: the board and the filters it was asked with.
struct Loaded {
    board_key: String,
    board: Board,
    period: String,
    scope: String,
    metric: String,
}

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    open: bool,
    shop: String,
    object_id: String,
    period: String,
    scope: String,
    selected_metric: String,
    served: Option<Vec<String>>,
    loaded: Option<Loaded>,
    loading: bool,
    failed_key: Option<String>,
    attempt: u32,
    request_id: u64,
    images: HashMap<String, Image>,
    pending: HashSet<String>,
    rows: Option<Rc<VecModel<LbRow>>>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn viewer() -> Option<lb::User> {
    shell::user_details().and_then(|u| lb::normalize_user(&u))
}

fn stored(key: &str, allowed: &[&str], fallback: &str) -> String {
    shell::storage_get(key)
        .filter(|v| allowed.contains(&v.as_str()))
        .unwrap_or_else(|| fallback.to_string())
}

/// The filters the request uses (effectiveScope / effectiveMetric).
fn effective(s: &State) -> (String, String) {
    let extended = features::enabled(EXTENDED);
    let scope = if extended && shell::signed_in() {
        s.scope.clone()
    } else {
        "global".to_string()
    };
    let served = lb::served_metrics(s.served.as_deref());
    let metric = if !extended {
        "playtime".to_string()
    } else if served.contains(&s.selected_metric.as_str()) {
        s.selected_metric.clone()
    } else {
        served[0].to_string()
    };
    (scope, metric)
}

fn board_key(s: &State) -> String {
    format!(
        "{}:{}:{}",
        s.shop,
        s.object_id,
        viewer().map(|v| v.id).unwrap_or_else(|| "anonymous".into())
    )
}

fn request_key(s: &State) -> String {
    let (scope, metric) = effective(s);
    format!(
        "{}|{}|{scope}|{metric}|{}",
        board_key(s),
        s.period,
        s.attempt
    )
}

fn eligible(s: &State) -> bool {
    !s.object_id.is_empty() && lb::is_leaderboard_shop(&s.shop)
}

/// useLeaderboardValue
fn format_value(metric: &str, value: f64) -> String {
    match metric {
        "playtime" => {
            let (unit, amount) = lb::duration_parts(value, lb::MAX_MINUTES_TO_SHOW_IN_PLAYTIME);
            let amount = shell::i18n()
                .map(|i| i.format_number(amount))
                .unwrap_or_default();
            shell::tr_with(
                &format!("leaderboard.value_{unit}"),
                &[("amount", amount.into())],
            )
        }
        "streak" => shell::i18n()
            .map(|i| i.t_count("leaderboard.value_days", value, &[]))
            .unwrap_or_default(),
        _ => shell::i18n()
            .map(|i| i.format_number(value))
            .unwrap_or_default(),
    }
}

/// fetchGameLeaderboard: with the session, retried without it when signed out.
fn load_board() {
    let Some((request, key, id)) = with(|s| {
        if !s.open || !eligible(s) {
            return None;
        }
        let (scope, metric) = effective(s);
        s.request_id += 1;
        s.loading = true;
        s.failed_key = None;
        Some((
            lb::card_request(
                &s.shop,
                &s.object_id,
                &metric,
                &s.period,
                &scope,
                shell::signed_in(),
            ),
            request_key(s),
            s.request_id,
        ))
    }) else {
        apply();
        return;
    };
    let (period, scope, metric, board_key) = with(|s| {
        let (scope, metric) = effective(s);
        (s.period.clone(), scope, metric, board_key(s))
    });
    let settle = move |result: Result<serde_json::Value, FetchError>| {
        let board = result.ok().and_then(|v| lb::normalize_board(&v));
        with(|s| {
            if s.request_id != id {
                return;
            }
            s.loading = false;
            match board {
                Some(board) => {
                    s.loaded = Some(Loaded {
                        board_key,
                        board,
                        period,
                        scope,
                        metric,
                    })
                }
                None => {
                    s.loaded = None;
                    s.failed_key = Some(key);
                }
            }
        });
        apply();
    };
    let anonymous = Request {
        needs_auth: false,
        ..request.clone()
    };
    page::fetch(&request, move |result| match result {
        Err(FetchError::SignedOut) if request.needs_auth => page::fetch(&anonymous, settle),
        other => settle(other),
    });
    apply();
}

/// The metrics the API serves for games (GAME_LEADERBOARDS_EXTENDED).
fn load_metrics() {
    if !features::enabled(EXTENDED) {
        return;
    }
    page::fetch(&lb::metrics_request("game"), |result| {
        let ids = result
            .ok()
            .and_then(|v| lb::normalize_metrics(&v))
            .map(|metrics| metrics.into_iter().map(|m| m.id).collect::<Vec<_>>());
        let changed = with(|s| {
            let before = effective(s).1;
            s.served = ids;
            effective(s).1 != before
        });
        if changed {
            load_board();
        } else {
            apply();
        }
    });
}

// ---- images -------------------------------------------------------------

fn image(url: Option<&str>, banner: bool) -> Image {
    let Some(url) = url.filter(|u| !u.is_empty()) else {
        return Image::default();
    };
    let key = format!("{}|{url}", if banner { "row" } else { "avatar" });
    if let Some(image) = with(|s| s.images.get(&key).cloned()) {
        return image;
    }
    if !with(|s| s.pending.insert(key.clone())) {
        return Image::default();
    }
    let Some((loader, scale)) = shell::loader() else {
        return Image::default();
    };
    let url = url.to_string();
    loader.run(move |http| {
        let bytes = images::fetch(http, &Source::Url(url.clone()));
        let pixels = bytes.and_then(|bytes| {
            if banner {
                let img = images::open_bytes(&bytes)?;
                Some(images::to_pixels(
                    img.resize_to_fill(960, 112, FilterType::Triangle),
                    Op::Full,
                ))
            } else {
                images::decode_bytes(&bytes, Op::MaxWidth((40.0 * scale).ceil() as u32))
            }
        });
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(pixels) = pixels {
                with(|s| s.images.insert(key, pixels.into_image()));
                apply();
            }
        });
    });
    Image::default()
}

// ---- apply --------------------------------------------------------------

fn apply() {
    let Some(ui) = with(|s| s.ui.upgrade()) else {
        return;
    };
    let data = ui.global::<GameLeaderboard>();
    let open = with(|s| s.open && eligible(s));
    if !open || !features::enabled("GLOBAL_LEADERBOARDS") {
        data.set_visible(false);
        return;
    }
    let viewer = viewer();
    let viewer_id = viewer.as_ref().map(|v| v.id.clone());
    let signed_in = viewer.is_some();
    let extended = features::enabled(EXTENDED);
    let (period, scope, metric, current, has_error, served) = with(|s| {
        let (scope, metric) = effective(s);
        let key = board_key(s);
        // selectLoadedLeaderboard: another game's board never shows here
        let current = s.loaded.as_ref().filter(|l| l.board_key == key).map(|l| {
            (
                l.board.clone(),
                l.period.clone(),
                l.scope.clone(),
                l.metric.clone(),
            )
        });
        let has_error = s.failed_key.as_deref() == Some(request_key(s).as_str());
        (
            s.period.clone(),
            scope,
            metric,
            current,
            has_error,
            lb::served_metrics(s.served.as_deref()),
        )
    });
    let (board, data_period, data_scope, data_metric) = match current {
        Some((board, p, sc, m)) => (Some(board), p, sc, m),
        None => (None, period.clone(), scope.clone(), metric.clone()),
    };
    let state = lb::card_state(
        true,
        has_error,
        board.as_ref(),
        &data_period,
        &data_scope,
        viewer_id.as_deref(),
    );
    // a filter change shows the skeleton, not the old board
    let showing_old = data_period != period || data_scope != scope || data_metric != metric;
    let state_name = match state {
        CardState::Hidden => {
            data.set_visible(false);
            return;
        }
        CardState::Error => "error",
        _ if showing_old => "loading",
        CardState::Loading => "loading",
        CardState::Ready => "ready",
        CardState::EmptyWeek => "empty_week",
        CardState::EmptyAll => "empty_all",
        CardState::EmptyFriends => "empty_friends",
        CardState::Solo => "solo",
    };
    data.set_visible(true);
    data.set_state(state_name.into());
    data.set_signed_in(signed_in);
    data.set_show_scope(extended && signed_in);
    data.set_show_metrics(extended && served.len() > 1);
    data.set_scope(scope.clone().into());
    data.set_period(period.clone().into());
    data.set_metric(metric.clone().into());
    let title = shell::tr("leaderboard.title");
    data.set_title(
        if extended {
            format!(
                "{title} · {}",
                shell::tr(&format!("leaderboard.metric_{metric}"))
            )
        } else {
            title
        }
        .into(),
    );
    let options: Vec<LbOption> = served
        .iter()
        .map(|id| LbOption {
            id: (*id).into(),
            label: shell::tr(&format!("leaderboard.metric_{id}")).into(),
        })
        .collect();
    let current_options = data.get_metrics();
    if current_options.row_count() != options.len()
        || options
            .iter()
            .enumerate()
            .any(|(i, o)| current_options.row_data(i).as_ref() != Some(o))
    {
        data.set_metrics(ModelRc::new(VecModel::from(options)));
    }

    let board = board.unwrap_or_default();
    let rows = lb::build_rows(&board, viewer.as_ref(), lb::CARD_SIZE);
    let nudge = lb::nudge(&board, viewer.as_ref(), &data_scope).map(|n| match n {
        Nudge::Leading => shell::tr("leaderboard.nudge_leading"),
        Nudge::ToTop { gap, rank } => shell::tr_with(
            "leaderboard.nudge_to_top",
            &[
                ("amount", format_value(&data_metric, gap).into()),
                ("rank", rank.to_string().into()),
            ],
        ),
        Nudge::Behind {
            gap, target_rank, ..
        } => shell::tr_with(
            "leaderboard.nudge_behind",
            &[
                ("amount", format_value(&data_metric, gap).into()),
                ("rank", target_rank.to_string().into()),
            ],
        ),
    });
    data.set_nudge(nudge.unwrap_or_default().into());
    let items: Vec<LbRow> = rows
        .iter()
        .map(|row| {
            let entry = &row.entry;
            let banner = image(entry.user.background_image_url.as_deref(), true);
            LbRow {
                user_id: entry.user.id.clone().into(),
                rank: entry.rank as i32,
                tier: lb::rank_tier(entry.rank).into(),
                name: entry.user.display_name.clone().into(),
                avatar: image(entry.user.profile_image_url.as_deref(), false),
                has_banner: banner.size().width > 0,
                banner,
                value: format_value(&data_metric, entry.value).into(),
                viewer: row.is_viewer,
                gap_before: row.gap_before,
                ..Default::default()
            }
        })
        .collect();
    let model = with(|s| s.rows.clone()).unwrap_or_else(|| {
        let model = Rc::new(VecModel::default());
        data.set_rows(ModelRc::from(model.clone()));
        with(|s| s.rows = Some(model.clone()));
        model
    });
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

// ---- wiring -------------------------------------------------------------

pub fn init(ui: &AppWindow) {
    with(|s| s.ui = ui.as_weak());
    let data = ui.global::<GameLeaderboard>();
    data.on_set_scope(|value| {
        shell::storage_set(SCOPE_STORAGE_KEY, &value);
        with(|s| s.scope = value.to_string());
        load_board();
    });
    data.on_set_period(|value| {
        shell::storage_set(PERIOD_STORAGE_KEY, &value);
        with(|s| s.period = value.to_string());
        load_board();
    });
    data.on_set_metric(|value| {
        with(|s| s.selected_metric = value.to_string());
        load_board();
    });
    data.on_retry(|| {
        with(|s| s.attempt += 1);
        load_board();
    });
    // buildGameLeaderboardPath with the filters of the board on screen
    data.on_open_ranking(|| {
        let link = with(|s| {
            let loaded = s.loaded.as_ref()?;
            Some(lb::game_page_link(
                &s.shop,
                &s.object_id,
                &loaded.period,
                &loaded.scope,
                &loaded.metric,
            ))
        });
        if let Some(link) = link {
            nav::navigate(&link);
        }
    });
    data.on_open_profile(|id| nav::navigate(&format!("/profile/{id}")));
    data.on_find_friends(|| {
        if let Some(ui) = with(|s| s.ui.upgrade()) {
            ui.global::<Session>().invoke_open_friends();
        }
    });
    data.on_sign_in(|| {
        if let Some(ui) = with(|s| s.ui.upgrade()) {
            ui.global::<Session>().invoke_sign_in();
        }
    });
    features::on_loaded(apply);
}

/// The game page opened (`/game/:shop/:objectId`).
pub fn open(shop: &str, object_id: &str) {
    let same = with(|s| s.open && s.shop == shop && s.object_id == object_id);
    if same {
        return;
    }
    with(|s| {
        s.open = true;
        s.shop = shop.to_string();
        s.object_id = object_id.to_string();
        s.period = stored(PERIOD_STORAGE_KEY, &lb::PERIODS, "week");
        s.scope = stored(SCOPE_STORAGE_KEY, &lb::SCOPES, "global");
        s.selected_metric = "playtime".into();
        s.served = None;
        s.loaded = None;
        s.failed_key = None;
        s.attempt = 0;
    });
    load_metrics();
    load_board();
}

/// The game page closed: drop the board and its images.
pub fn close() {
    with(|s| {
        s.open = false;
        s.loaded = None;
        s.images.clear();
        s.pending.clear();
    });
    if let Some(ui) = with(|s| s.ui.upgrade()) {
        ui.global::<GameLeaderboard>().set_visible(false);
    }
    if let Some(model) = with(|s| s.rows.clone()) {
        model.set_vec(Vec::new());
    }
}
