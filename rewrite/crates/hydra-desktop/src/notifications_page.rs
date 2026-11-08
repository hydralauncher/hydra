//! pages/notifications: API notifications (GET /profile/notifications) and
//! local ones (localNotifications), merged like notifications.tsx, with the
//! read/dismiss/clear actions and the unread count the sidebar shows.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::time::Duration;

use hydra_core::api::Options;
use hydra_db::keys;
use hydra_media::images::Op;
use serde_json::{Value, json};
use slint::{ComponentHandle, Image, ModelRc, VecModel};

use crate::{AppWindow, NotificationRow, NotificationsData, Session, nav, shell, toast};

const STAGGER_DELAY_MS: u64 = 70;
const EXIT_DURATION_MS: u64 = 250;

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    filter: String,
    api: Vec<Value>,
    local: Vec<Value>,
    badges: Vec<Value>,
    has_more: bool,
    skip: u64,
    loading: bool,
    first_load: bool,
    clearing: bool,
    leaving: HashSet<String>,
    images: HashMap<String, Image>,
    /// the list model, updated in place so rows keep their state (enter animations)
    rows: Option<Rc<VecModel<NotificationRow>>>,
    /// GET /profile/notifications/count, adjusted as items are read
    api_unread_count: i64,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State { filter: "all".into(), first_load: true, ..Default::default() });
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn t(key: &str) -> String {
    shell::tr(key)
}

fn text(v: &Value, key: &str) -> String {
    v.get(key)
        .map(|x| {
            x.as_str().map(str::to_string).unwrap_or_else(|| {
                if x.is_null() {
                    String::new()
                } else {
                    x.to_string()
                }
            })
        })
        .unwrap_or_default()
}

fn var(n: &Value, key: &str) -> String {
    n.get("variables").map(|v| text(v, key)).unwrap_or_default()
}

fn id_of(v: &Value) -> String {
    text(v, "id")
}

fn is_read(v: &Value) -> bool {
    v.get("isRead").and_then(Value::as_bool) == Some(true)
}

pub fn init(ui: &AppWindow) {
    with(|s| s.ui = ui.as_weak());
    let data = ui.global::<NotificationsData>();
    data.on_set_filter(|filter| {
        let changed = with(|s| {
            if s.filter == filter.as_str() {
                return false;
            }
            s.filter = filter.to_string();
            s.has_more = false;
            s.skip = 0;
            true
        });
        if !changed {
            return;
        }
        // AnimatePresence mode="wait": the old list slides out (200ms), then the new one in
        let ui = with(|s| s.ui.upgrade());
        if let Some(ui) = &ui {
            let data = ui.global::<NotificationsData>();
            data.set_filter(filter.clone());
            data.set_switch_phase(1);
        }
        slint::Timer::single_shot(Duration::from_millis(200), move || {
            load_all();
            let ui = with(|s| s.ui.upgrade());
            if let Some(ui) = ui {
                ui.global::<NotificationsData>().set_switch_phase(2);
                let weak = ui.as_weak();
                slint::Timer::single_shot(Duration::from_millis(16), move || {
                    if let Some(ui) = weak.upgrade() {
                        ui.global::<NotificationsData>().set_switch_phase(0);
                    }
                });
            }
        });
    });
    data.on_open(|key| open(&key));
    data.on_dismiss(|key| dismiss(&key, true));
    data.on_accept(|key| friend_request(&key, "ACCEPTED"));
    data.on_refuse(|key| friend_request(&key, "REFUSED"));
    data.on_mark_all_read(mark_all_read);
    data.on_clear_all(clear_all);
    data.on_load_more(|| {
        let (more, loading, skip) = with(|s| (s.has_more, s.loading, s.skip));
        if more && !loading {
            fetch_api(skip, true);
        }
    });
}

/// The /notifications route opened.
pub fn open_page() {
    with(|s| s.first_load = true);
    load_all();
}

fn local_notifications() -> Vec<Value> {
    let mut list: Vec<Value> = shell::db()
        .and_then(|db| db.values(keys::LOCAL_NOTIFICATIONS).ok())
        .unwrap_or_default();
    list.sort_by_key(|n| std::cmp::Reverse(text(n, "createdAt")));
    list
}

/// fetchAllNotifications: local, badges and (signed in) the API list.
fn load_all() {
    let local = local_notifications();
    with(|s| {
        s.local = local;
        s.loading = true;
    });
    apply();
    let language = shell::i18n()
        .map(|i| i.language().split('-').next().unwrap_or("en").to_string())
        .unwrap_or_else(|| "en".into());
    if let Some(api) = shell::api() {
        std::thread::spawn(move || {
            let badges = api
                .get("/badges", &[("locale", language)], Options::public())
                .ok()
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default();
            let _ = slint::invoke_from_event_loop(move || {
                with(|s| s.badges = badges);
                apply();
            });
        });
    }
    if shell::signed_in() {
        fetch_api(0, false);
    } else {
        with(|s| {
            s.loading = false;
            s.first_load = false;
        });
        apply();
    }
}

fn fetch_api(skip: u64, append: bool) {
    let Some(api) = shell::api() else { return };
    let filter = with(|s| {
        s.loading = true;
        s.filter.clone()
    });
    apply();
    std::thread::spawn(move || {
        let response = api.get(
            "/profile/notifications",
            &[
                ("filter", filter),
                ("take", "20".into()),
                ("skip", skip.to_string()),
            ],
            Options::default(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            with(|s| {
                s.loading = false;
                s.first_load = false;
                if let Ok(response) = &response {
                    let list = response
                        .get("notifications")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    if append {
                        s.api.extend(list);
                    } else {
                        s.api = list;
                    }
                    let pagination = response.get("pagination");
                    let num = |k: &str| {
                        pagination
                            .and_then(|p| p.get(k))
                            .and_then(Value::as_u64)
                            .unwrap_or(0)
                    };
                    s.has_more = pagination
                        .and_then(|p| p.get("hasMore"))
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    s.skip = num("skip") + num("take");
                }
            });
            if let Err(error) = response {
                eprintln!("Failed to fetch API notifications: {error}");
            }
            apply();
        });
    });
}

/// visibleApiNotifications: feature-gated leaderboard and screenshot types.
fn visible(n: &Value) -> bool {
    let kind = text(n, "type");
    if kind == "LEADERBOARD_RANK_CHANGED" || kind == "LEADERBOARD_MISSING_PHOTO" {
        return crate::features::enabled("GLOBAL_LEADERBOARDS");
    }
    if !kind.starts_with("SCREENSHOT_") {
        return true;
    }
    crate::features::enabled("SCREENSHOTS")
        && (kind == "SCREENSHOT_LIKE" || crate::features::enabled("SCREENSHOT_COMMENTS"))
}

/// buildLeaderboardNotificationText (and the rank chip).
fn leaderboard_text(n: &Value) -> Option<(String, String, String)> {
    let kind = text(n, "type");
    let rank_kind = kind == "LEADERBOARD_RANK_CHANGED";
    let photo_kind = kind == "LEADERBOARD_MISSING_PHOTO";
    if !rank_kind && !photo_kind {
        return None;
    }
    let metric = var(n, "metric");
    let rank: i64 = var(
        n,
        if rank_kind {
            "newRank"
        } else {
            "missingPhotoRank"
        },
    )
    .parse()
    .ok()
    .filter(|r: &i64| *r > 0)?;
    if metric.is_empty() {
        return None;
    }
    let scope = if rank_kind && var(n, "scope") == "friends" {
        "friends"
    } else {
        "global"
    };
    let game_title = (var(n, "boardType") == "game"
        && !var(n, "shop").is_empty()
        && !var(n, "objectId").is_empty())
    .then(|| var(n, "gameTitle"));
    let moment = var(n, "moment");
    let moment = ["leader", "top3", "top100"]
        .contains(&moment.as_str())
        .then_some(moment);
    let direction_down = rank_kind && var(n, "direction") == "down";
    let metric_label = {
        let key = format!("leaderboards.metric_{metric}");
        let value = t(&key);
        if value == key { metric.clone() } else { value }
    };
    let board = match &game_title {
        Some(game) => shell::tr_with(
            "notifications_page.leaderboard_board_game",
            &[
                ("metric", metric_label.clone().into()),
                ("game", game.clone().into()),
            ],
        ),
        None => shell::tr_with(
            &format!("notifications_page.leaderboard_board_{scope}"),
            &[("metric", metric_label.into())],
        ),
    };
    let title_key = if photo_kind {
        "leaderboard_missing_photo_title".to_string()
    } else if moment.as_deref() == Some("leader") && scope == "friends" {
        "leaderboard_leader_friends_title".to_string()
    } else if let Some(moment) = &moment {
        format!("leaderboard_{moment}_title")
    } else if direction_down {
        "leaderboard_down_title".to_string()
    } else {
        "leaderboard_up_title".to_string()
    };
    let title = t(&format!("notifications_page.{title_key}"));
    let args = [("rank", rank.to_string().into()), ("board", board.into())];
    let description = if photo_kind {
        shell::tr_with(
            "notifications_page.leaderboard_missing_photo_description",
            &args,
        )
    } else {
        let mut text = shell::tr_with(
            if direction_down {
                "notifications_page.leaderboard_down_description"
            } else {
                "notifications_page.leaderboard_rank_description"
            },
            &args,
        );
        if let Some(cloud) = var(n, "cloudRank").parse::<i64>().ok().filter(|r| *r > 0) {
            text = format!(
                "{text} {}",
                shell::tr_with(
                    "notifications_page.leaderboard_cloud_rank",
                    &[("rank", cloud.to_string().into())]
                )
            );
        }
        text
    };
    Some((title, description, format!("#{rank}")))
}

/// getNotificationContent + getIcon: title, description, icon, amber.
fn api_content(n: &Value, badges: &[Value]) -> (String, String, &'static str, bool) {
    let kind = text(n, "type");
    let tw = |key: &str, args: &[(&str, String)]| {
        let args: Vec<(&str, hydra_i18n::Arg)> =
            args.iter().map(|(k, v)| (*k, v.clone().into())).collect();
        shell::tr_with(&format!("notifications_page.{key}"), &args)
    };
    let count = |key: &str| -> f64 { var(n, key).parse::<f64>().unwrap_or(1.0) };
    let tc = |key: &str, c: f64, args: &[(&str, String)]| {
        let args: Vec<(&str, hydra_i18n::Arg)> =
            args.iter().map(|(k, v)| (*k, v.clone().into())).collect();
        shell::i18n()
            .map(|i| i.t_count(&format!("notifications_page.{key}"), c, &args))
            .unwrap_or_default()
    };
    let screenshot_game = {
        let g = var(n, "gameTitle");
        if !g.is_empty() {
            g
        } else if !var(n, "customGameTitle").is_empty() {
            var(n, "customGameTitle")
        } else {
            t("notifications_page.screenshot_custom_game")
        }
    };
    match kind.as_str() {
        "FRIEND_REQUEST_RECEIVED" => (
            tw("friend_request_received_title", &[]),
            tw(
                "friend_request_received_description",
                &[("displayName", var(n, "senderDisplayName"))],
            ),
            "person",
            false,
        ),
        "FRIEND_REQUEST_ACCEPTED" => (
            tw("friend_request_accepted_title", &[]),
            tw(
                "friend_request_accepted_description",
                &[("displayName", var(n, "accepterDisplayName"))],
            ),
            "person",
            false,
        ),
        "BADGE_RECEIVED" => {
            let name = var(n, "badgeName");
            let description = badges
                .iter()
                .find(|b| text(b, "name") == name)
                .map(|b| text(b, "description"))
                .filter(|d| !d.is_empty())
                .unwrap_or(name);
            (
                tw("badge_received_title", &[]),
                description,
                "person",
                false,
            )
        }
        "REVIEW_UPVOTE" => (
            tw("review_upvote_title", &[("gameTitle", var(n, "gameTitle"))]),
            tc("review_upvote_description", count("upvoteCount"), &[]),
            "star",
            true,
        ),
        "REVIEW_ANSWER" => (
            tw("review_answer_title", &[("gameTitle", var(n, "gameTitle"))]),
            tw(
                "review_answer_description",
                &[("displayName", var(n, "answerAuthorDisplayName"))],
            ),
            "comment",
            true,
        ),
        "REVIEW_ANSWER_UPVOTE" => (
            tw(
                "review_answer_upvote_title",
                &[("gameTitle", var(n, "gameTitle"))],
            ),
            tc(
                "review_answer_upvote_description",
                count("upvoteCount"),
                &[],
            ),
            "star",
            true,
        ),
        "SOUVENIR_LIKE" => (
            tw("souvenir_like_title", &[("gameTitle", var(n, "gameTitle"))]),
            tc("souvenir_like_description", count("likeCount"), &[]),
            "heart",
            false,
        ),
        "SCREENSHOT_LIKE" => (
            tw(
                "screenshot_like_title",
                &[("gameTitle", screenshot_game.clone())],
            ),
            tc("screenshot_like_description", count("likeCount"), &[]),
            "heart",
            false,
        ),
        "SCREENSHOT_COMMENT" => (
            tw(
                "screenshot_comment_title",
                &[("gameTitle", screenshot_game.clone())],
            ),
            tc(
                "screenshot_comment_description",
                count("commentCount"),
                &[("gameTitle", screenshot_game.clone())],
            ),
            "comment",
            false,
        ),
        "SCREENSHOT_COMMENT_UPVOTE" => (
            tw(
                "screenshot_comment_upvote_title",
                &[("gameTitle", screenshot_game)],
            ),
            tc(
                "screenshot_comment_upvote_description",
                count("upvoteCount"),
                &[],
            ),
            "thumbsup",
            false,
        ),
        "RETROACHIEVEMENTS_CREDENTIALS_RESTORED" => (
            tw("retroachievements_credentials_restored_title", &[]),
            tw("retroachievements_credentials_restored_description", &[]),
            "ra",
            false,
        ),
        "RETROACHIEVEMENTS_CREDENTIALS_INVALID" => (
            tw("retroachievements_credentials_invalid_title", &[]),
            tw("retroachievements_credentials_invalid_description", &[]),
            "ra",
            false,
        ),
        "RETROACHIEVEMENTS_SYNC_FAILED" => (
            tw("retroachievements_sync_failed_title", &[]),
            tw(
                "retroachievements_sync_failed_description",
                &[("gameTitle", var(n, "gameTitle"))],
            ),
            "ra",
            false,
        ),
        "CLOUD_GIFT_RECEIVED" => {
            let months: Option<f64> = var(n, "durationMonths").parse().ok();
            let title = match months {
                Some(m) => tc("cloud_gift_received_title", m, &[]),
                None => tw("cloud_gift_received_title", &[]),
            };
            (
                title,
                tw(
                    "cloud_gift_received_description",
                    &[("displayName", var(n, "buyerDisplayName"))],
                ),
                "gift",
                false,
            )
        }
        _ => (tw("notification", &[]), String::new(), "person", false),
    }
}

/// mergedNotifications: priority-1 API items first (API order), then the
/// rest of the API items and local ones by date.
fn merged() -> Vec<(String, Value)> {
    with(|s| {
        let api: Vec<&Value> = s.api.iter().filter(|n| visible(n)).collect();
        let high: Vec<(String, Value)> = api
            .iter()
            .filter(|n| n.get("priority").and_then(Value::as_i64) == Some(1))
            .map(|n| (format!("api:{}", id_of(n)), (*n).clone()))
            .collect();
        let mut low: Vec<(String, Value)> = api
            .iter()
            .filter(|n| n.get("priority").and_then(Value::as_i64) != Some(1))
            .map(|n| (format!("api:{}", id_of(n)), (*n).clone()))
            .collect();
        low.extend(
            s.local
                .iter()
                .filter(|n| s.filter != "unread" || !is_read(n))
                .map(|n| (format!("local:{}", id_of(n)), n.clone())),
        );
        low.sort_by(|a, b| {
            let at = |v: &Value| {
                hydra_core::library::parse_iso_millis(&text(v, "createdAt")).unwrap_or(0)
            };
            at(&b.1).cmp(&at(&a.1))
        });
        let mut all = high;
        all.extend(low);
        all
    })
}

fn time_label(n: &Value) -> String {
    let created = hydra_core::library::parse_iso_millis(&text(n, "createdAt")).unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64);
    let language = shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into());
    hydra_i18n::date::format_distance(&language, created, now, false)
}

/// Rebuild the rows and the counters.
fn apply() {
    let list = merged();
    let (badges, leaving, filter, first_load, loading, clearing, has_more) = with(|s| {
        (
            s.badges.clone(),
            s.leaving.clone(),
            s.filter.clone(),
            s.first_load,
            s.loading,
            s.clearing,
            s.has_more,
        )
    });
    let mut wanted: Vec<String> = Vec::new();
    let rows: Vec<NotificationRow> = list
        .iter()
        .map(|(key, n)| {
            let local = key.starts_with("local:");
            let picture_url = text(n, "pictureUrl");
            if !picture_url.is_empty() {
                wanted.push(picture_url.clone());
            }
            let picture = with(|s| s.images.get(&picture_url).cloned()).unwrap_or_default();
            let kind = text(n, "type");
            if local {
                let icon = match kind.as_str() {
                    "EXTRACTION_COMPLETE" => "package",
                    "UPDATE_AVAILABLE" | "SCAN_GAMES_COMPLETE" => "sync",
                    "ACHIEVEMENT_UNLOCKED" => "trophy",
                    _ => "download",
                };
                return NotificationRow {
                    key: key.into(),
                    title: text(n, "title").into(),
                    description: text(n, "description").into(),
                    time: time_label(n).into(),
                    unread: !is_read(n),
                    picture,
                    icon: icon.into(),
                    amber: false,
                    badge: false,
                    chip: "".into(),
                    friend_request: false,
                    dismissable: true,
                    leaving: leaving.contains(key),
                };
            }
            let (title, description, icon, amber, chip) = match leaderboard_text(n) {
                Some((title, description, chip)) => (title, description, "trophy", false, chip),
                None => {
                    let (title, description, icon, amber) = api_content(n, &badges);
                    (title, description, icon, amber, String::new())
                }
            };
            let friend_request = kind == "FRIEND_REQUEST_RECEIVED";
            NotificationRow {
                key: key.into(),
                title: title.into(),
                description: description.into(),
                time: time_label(n).into(),
                unread: !is_read(n) || friend_request,
                picture,
                icon: icon.into(),
                amber,
                badge: kind == "BADGE_RECEIVED",
                chip: chip.into(),
                friend_request,
                dismissable: !friend_request,
                leaving: leaving.contains(key),
            }
        })
        .collect();
    let unread = with(|s| {
        s.api.iter().filter(|n| visible(n) && !is_read(n)).count()
            + s.local.iter().filter(|n| !is_read(n)).count()
    });
    let has_api_unread = with(|s| s.api.iter().any(|n| !is_read(n)));
    let ui = with(|s| s.ui.upgrade());
    if let Some(ui) = ui {
        let data = ui.global::<NotificationsData>();
        data.set_filter(filter.into());
        data.set_mark_all_disabled(clearing || (rows.is_empty() && !has_api_unread));
        sync_rows(&data, rows);
        data.set_unread(unread as i32);
        data.set_first_load(first_load && loading);
        data.set_loading(loading);
        data.set_clearing(clearing);
        data.set_has_more(has_more);
    }
    load_pictures(wanted);
    update_count();
}

/// Updates the list model in place: rows that stay keep their element (and
/// do not replay the enter animation), like React keys under AnimatePresence.
fn sync_rows(data: &NotificationsData, rows: Vec<NotificationRow>) {
    use slint::Model;
    let model = with(|s| s.rows.clone()).unwrap_or_else(|| {
        let model = Rc::new(VecModel::default());
        with(|s| s.rows = Some(model.clone()));
        data.set_rows(ModelRc::from(model.clone()));
        model
    });
    let keys: HashSet<&str> = rows.iter().map(|r| r.key.as_str()).collect();
    for i in (0..model.row_count()).rev() {
        if model
            .row_data(i)
            .is_some_and(|r| !keys.contains(r.key.as_str()))
        {
            model.remove(i);
        }
    }
    for (i, item) in rows.iter().enumerate() {
        match model.row_data(i) {
            Some(existing) if existing.key == item.key => {
                if existing != *item {
                    model.set_row_data(i, item.clone());
                }
            }
            _ => model.insert(i, item.clone()),
        }
    }
    // an order change leaves stale rows behind: start over
    if model.row_count() != rows.len()
        || (0..rows.len()).any(|i| model.row_data(i).is_none_or(|r| r.key != rows[i].key))
    {
        model.set_vec(rows);
    }
}

fn load_pictures(urls: Vec<String>) {
    let Some((loader, scale)) = shell::loader() else {
        return;
    };
    for url in urls {
        if with(|s| s.images.contains_key(&url)) {
            continue;
        }
        with(|s| s.images.insert(url.clone(), Image::default()));
        let key = url.clone();
        loader.load(
            url,
            Op::MaxWidth((48.0 * scale).ceil() as u32),
            move |img| {
                with(|s| s.images.insert(key, img));
                apply();
            },
        );
    }
}

fn find(key: &str) -> Option<Value> {
    let (source, id) = key.split_once(':')?;
    with(|s| {
        let list = if source == "local" { &s.local } else { &s.api };
        list.iter().find(|n| id_of(n) == id).cloned()
    })
}

/// handleMarkAsRead
fn mark_read(key: &str) {
    let Some((source, id)) = key.split_once(':') else {
        return;
    };
    let id = id.to_string();
    if source == "local" {
        if let Some(db) = shell::db()
            && let Some(mut n) = db.get_in::<Value>(keys::LOCAL_NOTIFICATIONS, &id)
            && let Some(map) = n.as_object_mut()
        {
            map.insert("isRead".into(), json!(true));
            let _ = db.put_in(keys::LOCAL_NOTIFICATIONS, &id, &n);
        }
        with(|s| s.local = local_notifications());
        apply();
        return;
    }
    let Some(api) = shell::api() else { return };
    with(|s| {
        if let Some(n) = s.api.iter_mut().find(|n| id_of(n) == id)
            && let Some(map) = n.as_object_mut()
        {
            if map.get("isRead").and_then(Value::as_bool) != Some(true) {
                s.api_unread_count = (s.api_unread_count - 1).max(0);
            }
            map.insert("isRead".into(), json!(true));
        }
    });
    apply();
    std::thread::spawn(move || {
        let _ = api.patch(
            &format!("/profile/notifications/{id}/read"),
            &json!({ "id": id }),
            Options::default(),
        );
    });
}

/// buildProfileTarget / parseNotificationUrl / getNotificationTarget
fn target(n: &Value) -> Option<String> {
    let kind = text(n, "type");
    let mut url = text(n, "url");
    if url.is_empty() {
        if !kind.starts_with("SCREENSHOT_") {
            return None;
        }
        let owner = var(n, "ownerId");
        if owner.is_empty() {
            return None;
        }
        url = format!("/profile/{owner}");
    }
    let parsed = reqwest::Url::parse(&format!(
        "http://localhost{}",
        if url.starts_with('/') {
            url.clone()
        } else {
            format!("/{url}")
        }
    ))
    .ok()?;
    let param = |k: &str| {
        parsed
            .query_pairs()
            .find(|(key, _)| key == k)
            .map(|(_, v)| v.into_owned())
    };
    let path = parsed.path().to_string();
    if path == "/profile"
        && let Some(user) = param("userId")
    {
        return Some(format!("/profile/{user}"));
    }
    if path == "/badges"
        && let Some(name) = param("name")
    {
        return Some(format!("/badges/{name}"));
    }
    if path == "/profile/integrations/retroachievements" || path == "/profile/integrations/steam" {
        return Some("/settings?tab=integrations".into());
    }
    if path.starts_with("/game/") {
        let mut query: Vec<String> = Vec::new();
        for key in ["title", "reviews", "reviewId"] {
            if let Some(value) = param(key) {
                query.push(format!("{key}={}", url_encode(&value)));
            }
        }
        return Some(if query.is_empty() {
            path
        } else {
            format!("{path}?{}", query.join("&"))
        });
    }
    Some(url)
}

fn url_encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// handleClick
fn open(key: &str) {
    let Some(n) = find(key) else { return };
    if !is_read(&n) {
        mark_read(key);
    }
    if key.starts_with("local:") {
        let url = text(&n, "url");
        if !url.is_empty() {
            nav::navigate(&url);
        }
        return;
    }
    if text(&n, "type") == "CLOUD_GIFT_RECEIVED" && !var(&n, "giftId").is_empty() {
        eprintln!("TODO(cloud): openCloudGiftModal");
        return;
    }
    let destination = if text(&n, "type") == "LEADERBOARD_MISSING_PHOTO" {
        shell::user_details().map(|u| format!("/profile/{}?edit=profile", text(&u, "id")))
    } else {
        target(&n)
    };
    if let Some(destination) = destination {
        nav::navigate(&destination);
    }
}

/// handleDismiss (with the row's exit animation first)
fn dismiss(key: &str, animate: bool) {
    let Some((source, id)) = key.split_once(':') else {
        return;
    };
    let (source, id, key) = (source.to_string(), id.to_string(), key.to_string());
    let leaving_key = key.clone();
    let finish = move || {
        if source == "local" {
            if let Some(db) = shell::db() {
                let _ = db.delete_in(keys::LOCAL_NOTIFICATIONS, &id);
            }
            with(|s| {
                s.local = local_notifications();
                s.leaving.remove(&key);
            });
            apply();
            return;
        }
        let was_unread = with(|s| s.api.iter().any(|n| id_of(n) == id && !is_read(n)));
        with(|s| {
            s.api.retain(|n| id_of(n) != id);
            s.leaving.remove(&key);
            if was_unread {
                s.api_unread_count = (s.api_unread_count - 1).max(0);
            }
        });
        apply();
        if let Some(api) = shell::api() {
            let id = id.clone();
            std::thread::spawn(move || {
                if api
                    .delete(&format!("/profile/notifications/{id}"), Options::default())
                    .is_err()
                {
                    let _ = slint::invoke_from_event_loop(|| {
                        toast::error(&t("notifications_page.failed_to_dismiss"))
                    });
                }
            });
        }
    };
    if animate {
        with(|s| s.leaving.insert(leaving_key));
        apply();
        slint::Timer::single_shot(Duration::from_millis(EXIT_DURATION_MS), finish);
    } else {
        finish();
    }
}

/// updateFriendRequestState from the item's Accept / Refuse.
fn friend_request(key: &str, state: &'static str) {
    let Some(n) = find(key) else { return };
    let sender = var(&n, "senderId");
    if sender.is_empty() {
        return;
    }
    let Some(api) = shell::api() else { return };
    let key = key.to_string();
    std::thread::spawn(move || {
        let ok = api
            .patch(
                &format!("/profile/friend-requests/{sender}"),
                &json!({ "requestState": state }),
                Options::default(),
            )
            .is_ok();
        let _ = slint::invoke_from_event_loop(move || {
            if ok {
                toast::success(&t(if state == "ACCEPTED" {
                    "notifications_page.friend_request_accepted"
                } else {
                    "notifications_page.friend_request_refused"
                }));
                dismiss(&key, true);
            }
        });
    });
}

/// handleMarkAllAsRead
fn mark_all_read() {
    if let Some(db) = shell::db() {
        for (id, mut n) in db
            .entries::<Value>(keys::LOCAL_NOTIFICATIONS)
            .unwrap_or_default()
        {
            if let Some(map) = n.as_object_mut() {
                map.insert("isRead".into(), json!(true));
                let _ = db.put_in(keys::LOCAL_NOTIFICATIONS, &id, &n);
            }
        }
    }
    let signed_in = shell::signed_in();
    with(|s| {
        s.local = local_notifications();
        if signed_in {
            for n in s.api.iter_mut() {
                if let Some(map) = n.as_object_mut() {
                    map.insert("isRead".into(), json!(true));
                }
            }
            s.api_unread_count = 0;
        }
    });
    apply();
    let Some(api) = shell::api().filter(|_| signed_in) else {
        toast::success(&t("notifications_page.marked_all_as_read"));
        return;
    };
    std::thread::spawn(move || {
        let ok = api
            .patch(
                "/profile/notifications/all/read",
                &Value::Null,
                Options::default(),
            )
            .is_ok();
        let _ = slint::invoke_from_event_loop(move || {
            if ok {
                toast::success(&t("notifications_page.marked_all_as_read"));
            } else {
                toast::error(&t("notifications_page.failed_to_mark_as_read"));
            }
        });
    });
}

/// handleClearAll: rows leave one by one (70ms apart), then everything is deleted.
fn clear_all() {
    let list = merged();
    if with(|s| s.clearing) || list.is_empty() {
        return;
    }
    with(|s| s.clearing = true);
    apply();
    let total = list.len() as u64;
    for (index, (key, _)) in list.into_iter().enumerate() {
        slint::Timer::single_shot(
            Duration::from_millis(index as u64 * STAGGER_DELAY_MS),
            move || {
                with(|s| s.leaving.insert(key));
                apply();
            },
        );
    }
    let done =
        Duration::from_millis((total.saturating_sub(1)) * STAGGER_DELAY_MS + EXIT_DURATION_MS);
    slint::Timer::single_shot(done, || {
        if let Some(db) = shell::db() {
            for (id, _) in db
                .entries::<Value>(keys::LOCAL_NOTIFICATIONS)
                .unwrap_or_default()
            {
                let _ = db.delete_in(keys::LOCAL_NOTIFICATIONS, &id);
            }
        }
        with(|s| {
            s.local.clear();
            s.api.clear();
            s.leaving.clear();
            s.has_more = false;
            s.skip = 0;
            s.api_unread_count = 0;
        });
        let api = shell::api().filter(|_| shell::signed_in());
        std::thread::spawn(move || {
            let ok = api.is_none_or(|api| {
                api.delete("/profile/notifications/all", Options::default())
                    .is_ok()
            });
            let _ = slint::invoke_from_event_loop(move || {
                with(|s| s.clearing = false);
                apply();
                if ok {
                    toast::success(&t("notifications_page.cleared_all"));
                } else {
                    toast::error(&t("notifications_page.failed_to_clear"));
                }
            });
        });
    });
}

/// sidebar-profile's notificationCount: API unread + local unread.
fn update_count() {
    let (api_count, local_unread) = with(|s| {
        (
            s.api_unread_count,
            s.local.iter().filter(|n| !is_read(n)).count() as i64,
        )
    });
    let ui = with(|s| s.ui.upgrade());
    if let Some(ui) = ui {
        ui.global::<Session>()
            .set_unread_notifications((api_count + local_unread) as i32);
    }
}

/// on-local-notification-created: the bell count, and the list when it is open.
pub fn on_local_created() {
    let local = local_notifications();
    with(|s| s.local = local);
    let open = with(|s| s.ui.upgrade())
        .is_some_and(|ui| ui.global::<crate::Nav>().get_route() == "notifications");
    if open {
        apply();
    } else {
        update_count();
    }
}

/// A realtime "notification" event: the count, and the list when it is open.
pub fn on_remote_change() {
    let open = with(|s| s.ui.upgrade())
        .is_some_and(|ui| ui.global::<crate::Nav>().get_route() == "notifications");
    if open {
        load_all();
    }
    refresh_count();
}

/// fetchApiNotificationCount (startup and after sign-in).
pub fn refresh_count() {
    let local = local_notifications();
    with(|s| s.local = local);
    update_count();
    if !shell::signed_in() {
        with(|s| s.api_unread_count = 0);
        update_count();
        return;
    }
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let count = api
            .get("/profile/notifications/count", &[], Options::default())
            .ok()
            .and_then(|v| v.get("count").and_then(Value::as_i64));
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(count) = count {
                with(|s| s.api_unread_count = count);
            }
            update_count();
        });
    });
}
