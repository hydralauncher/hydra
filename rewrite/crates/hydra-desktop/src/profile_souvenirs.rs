//! The profile's Souvenirs tab: getUserSouvenirs / loadMoreSouvenirs
//! (context/user-profile), souvenirs-tab.tsx (cards, game groups, notices,
//! empty states) and the like action of use-souvenir-actions.ts.
//!
//! Not ported yet: the souvenir lightbox (and its NSFW confirmation, delete,
//! visibility and report actions) and the sync status banner, which needs
//! the souvenir upload service.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use hydra_core::api::Options;
use hydra_media::images::{self, Op, Source};
use image::DynamicImage;
use serde_json::Value;
use slint::{ComponentHandle, Image, Model, ModelRc, VecModel};

use crate::{
    AppWindow, ProfileData, ProfileSouvenirCard, ProfileSouvenirGroup, Session, nav, profile_page,
    shell, toast,
};

/// SteamContentDescriptor.AdultOnlySexualContent
const ADULT_ONLY_SEXUAL_CONTENT: i64 = 3;
const PAGE_SIZE: usize = 24;

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    user_id: String,
    generation: u64,
    items: Vec<Value>,
    total: i64,
    has_reached_limit: bool,
    hidden_reason: Option<String>,
    loading: bool,
    request: u64,
    sort: String,
    grouping: String,
    liking: HashSet<String>,
    /// per souvenir: the previous like count and the change counter
    like_roll: HashMap<String, (i64, i32)>,
    collapsed: HashSet<String>,
    card_px: u32,
    thumbs: HashMap<String, Image>,
    pending: HashSet<String>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn window() -> Option<AppWindow> {
    with(|s| s.ui.upgrade())
}

fn t(key: &str) -> String {
    shell::tr(key)
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn opt_text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

pub fn init(ui: &AppWindow) {
    with(|s| {
        s.ui = ui.as_weak();
        s.sort = "recent".into();
        s.grouping = "none".into();
    });
    let d = ui.global::<ProfileData>();
    d.on_set_souvenir_grouping(|grouping| {
        let grouping = if grouping == "game" { "game" } else { "none" };
        shell::storage_set("profile-souvenir-grouping", grouping);
        with(|s| s.grouping = grouping.into());
        apply();
    });
    d.on_set_souvenir_sort(|sort| {
        let sort = hydra_core::profile::souvenir_sort(Some(&sort));
        shell::storage_set("profile-souvenir-sort-by", sort);
        with(|s| s.sort = sort.into());
        load(false);
    });
    d.on_open_souvenir(|id| eprintln!("TODO(profile): souvenir lightbox for {id}"));
    d.on_like_souvenir(|id| like(&id));
    d.on_open_souvenir_game(|id| {
        let item = with(|s| {
            s.items
                .iter()
                .find(|i| text(i, "id") == id.as_str())
                .cloned()
        });
        if let Some(item) = item {
            let title = opt_text(&item, "gameTitle")
                .map(str::to_string)
                .unwrap_or_else(|| t("user_profile.unknown_game"));
            nav::navigate(&format!(
                "/game/{}/{}?title={}",
                text(&item, "shop"),
                text(&item, "objectId"),
                nav::encode(&title)
            ));
        }
    });
    d.on_toggle_souvenir_group(|game| {
        with(|s| {
            if !s.collapsed.remove(game.as_str()) {
                s.collapsed.insert(game.to_string());
            }
        });
        apply();
    });
    d.on_dismiss_souvenirs_privacy(|| {
        if let Some(profile) = profile_page::current_profile() {
            shell::storage_set(
                &format!("souvenir-visibility-acknowledged:{}", text(&profile, "id")),
                &text(&profile, "souvenirsVisibility"),
            );
        }
        apply();
    });
    d.on_open_souvenir_settings(|| {
        nav::navigate("/settings?tab=content_gameplay#achievement-souvenirs")
    });
    d.on_load_more_souvenirs(load_more);
    d.on_souvenir_card_width(|px| {
        with(|s| s.card_px = px.max(0) as u32);
        load_thumbs();
    });
}

/// A profile opened: forget the last one and fetch the first page.
pub fn open(user_id: &str) {
    with(|s| {
        s.generation += 1;
        s.user_id = user_id.to_string();
        s.items.clear();
        s.total = 0;
        s.has_reached_limit = false;
        s.hidden_reason = None;
        s.liking.clear();
        s.like_roll.clear();
        s.collapsed.clear();
        s.thumbs.clear();
        s.pending.clear();
        s.sort = hydra_core::profile::souvenir_sort(
            shell::storage_get("profile-souvenir-sort-by").as_deref(),
        )
        .into();
        s.grouping = if shell::storage_get("profile-souvenir-grouping").as_deref() == Some("game") {
            "game".into()
        } else {
            "none".into()
        };
    });
    load(true);
}

/// getUserProfile refetches the first page (keeping the cards until it returns).
pub fn reload() {
    load(false);
}

/// buildUserSouvenirsPath
fn request(
    api: &hydra_core::api::HydraApi,
    user_id: &str,
    skip: usize,
    sort: &str,
) -> Result<Value, hydra_core::api::ApiError> {
    let language = shell::i18n()
        .map(|i| i.language().split('-').next().unwrap_or("en").to_string())
        .unwrap_or_else(|| "en".into());
    api.get(
        &format!("/users/{}/souvenirs", nav::encode(user_id)),
        &[
            ("take", PAGE_SIZE.to_string()),
            ("skip", skip.to_string()),
            ("sortBy", sort.to_string()),
            ("shop", "steam".into()),
            ("shop", "launchbox".into()),
            ("language", language),
        ],
        Options {
            needs_auth: shell::signed_in(),
            timeout: None,
        },
    )
}

/// getUserSouvenirs(sortBy): the first page.
fn load(first: bool) {
    let Some(api) = shell::api() else { return };
    let (user_id, sort, request_id) = with(|s| {
        s.request += 1;
        s.loading = true;
        (s.user_id.clone(), s.sort.clone(), s.request)
    });
    if !first {
        apply();
    }
    std::thread::spawn(move || {
        let result = request(&api, &user_id, 0, &sort);
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.request) != request_id {
                return;
            }
            with(|s| {
                s.loading = false;
                match result {
                    Ok(response) => {
                        s.items = response
                            .get("items")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default();
                        s.total = response.get("total").and_then(Value::as_i64).unwrap_or(0);
                        s.has_reached_limit = response
                            .get("hasReachedLimit")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                        s.hidden_reason = opt_text(&response, "hiddenReason").map(str::to_string);
                    }
                    Err(error) => {
                        eprintln!("souvenirs: {error}");
                        s.items.clear();
                        s.total = 0;
                        s.has_reached_limit = false;
                        s.hidden_reason = None;
                    }
                }
            });
            apply();
        });
    });
}

/// loadMoreSouvenirs: the next page, deduplicated by id.
fn load_more() {
    let go = with(|s| !s.loading && (s.items.len() as i64) < s.total);
    if !go {
        return;
    }
    let Some(api) = shell::api() else { return };
    let (user_id, sort, request_id, skip) = with(|s| {
        s.loading = true;
        (s.user_id.clone(), s.sort.clone(), s.request, s.items.len())
    });
    apply();
    std::thread::spawn(move || {
        let result = request(&api, &user_id, skip, &sort);
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.request) != request_id {
                return;
            }
            with(|s| {
                s.loading = false;
                if let Ok(response) = result {
                    let existing: HashSet<String> = s.items.iter().map(|i| text(i, "id")).collect();
                    if let Some(items) = response.get("items").and_then(Value::as_array) {
                        s.items.extend(
                            items
                                .iter()
                                .filter(|i| !existing.contains(&text(i, "id")))
                                .cloned(),
                        );
                    }
                    s.total = response
                        .get("total")
                        .and_then(Value::as_i64)
                        .unwrap_or(s.total);
                    s.has_reached_limit = response
                        .get("hasReachedLimit")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    s.hidden_reason = opt_text(&response, "hiddenReason").map(str::to_string);
                }
            });
            apply();
        });
    });
}

/// likeSouvenir: optimistic toggle, POST …/like, rollback with a toast.
fn like(id: &str) {
    if !shell::signed_in() {
        if let Some(ui) = window() {
            ui.global::<Session>().invoke_sign_in();
        }
        return;
    }
    let Some(api) = shell::api() else { return };
    let owner = with(|s| s.user_id.clone());
    let previous = with(|s| {
        if s.liking.contains(id) {
            return None;
        }
        let item = s.items.iter_mut().find(|i| text(i, "id") == id)?;
        let count = item.get("likeCount").and_then(Value::as_i64).unwrap_or(0);
        let liked = item
            .get("likedByMe")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let next = (count + if liked { -1 } else { 1 }).max(0);
        item["likeCount"] = Value::from(next);
        item["likedByMe"] = Value::Bool(!liked);
        let roll = s.like_roll.entry(id.to_string()).or_insert((count, 0));
        *roll = (count, roll.1 + 1);
        s.liking.insert(id.to_string());
        Some((count, liked))
    });
    let Some((count, liked)) = previous else {
        return;
    };
    apply();
    let id = id.to_string();
    std::thread::spawn(move || {
        let result = api.post(
            &format!(
                "/users/{}/souvenirs/{}/like",
                nav::encode(&owner),
                nav::encode(&id)
            ),
            &Value::Null,
            Options::default(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            with(|s| {
                s.liking.remove(&id);
                if result.is_err()
                    && let Some(item) = s.items.iter_mut().find(|i| text(i, "id") == id)
                {
                    let shown = item.get("likeCount").and_then(Value::as_i64).unwrap_or(0);
                    item["likeCount"] = Value::from(count);
                    item["likedByMe"] = Value::Bool(liked);
                    let roll = s.like_roll.entry(id.clone()).or_insert((shown, 0));
                    *roll = (shown, roll.1 + 1);
                }
            });
            if let Err(error) = &result {
                eprintln!("Failed to like souvenir: {error}");
                toast::error(&t("user_profile.souvenir_like_failed"));
            }
            apply();
        });
    });
}

/// getPrimarySouvenirAchievement
fn primary(item: &Value) -> Value {
    let name = text(item, "primaryAchievementName").to_uppercase();
    let list = item
        .get("achievements")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    list.iter()
        .find(|a| text(a, "name").to_uppercase() == name)
        .or_else(|| list.first())
        .cloned()
        .unwrap_or_else(|| {
            serde_json::json!({
                "displayName": text(item, "primaryAchievementName"),
                "unlockTime": item.get("capturedAt").cloned().unwrap_or(Value::Null),
            })
        })
}

fn millis(value: Option<&Value>) -> i64 {
    match value {
        Some(Value::Number(n)) => n.as_f64().unwrap_or_default() as i64,
        Some(Value::String(s)) => hydra_core::library::parse_iso_millis(s).unwrap_or_default(),
        _ => 0,
    }
}

fn warn(item: &Value) -> bool {
    let disabled = shell::preference("disableNsfwAlert");
    !disabled
        && item
            .get("gameContentDescriptorIds")
            .and_then(Value::as_array)
            .is_some_and(|ids| {
                ids.iter()
                    .any(|v| v.as_i64() == Some(ADULT_ONLY_SEXUAL_CONTENT))
            })
}

fn card(s: &State, item: &Value, show_game: bool, language: &str, now: i64) -> ProfileSouvenirCard {
    let id = text(item, "id");
    let achievement = primary(item);
    let others = item
        .get("achievements")
        .and_then(Value::as_array)
        .map(|a| a.len().saturating_sub(1))
        .unwrap_or(0);
    let icon_url = opt_text(&achievement, "achievementIcon").map(str::to_string);
    let game_icon = opt_text(item, "gameIconUrl").map(str::to_string);
    let image_url = opt_text(item, "imageUrl").map(str::to_string);
    let blurred = warn(item);
    let (prev, roll) = s.like_roll.get(&id).copied().unwrap_or_default();
    ProfileSouvenirCard {
        id: id.as_str().into(),
        has_image: image_url.is_some(),
        image: image_url
            .as_ref()
            .and_then(|u| s.thumbs.get(&thumb_key(u, blurred)).cloned())
            .unwrap_or_default(),
        blurred,
        variant: if achievement.get("isPlatinum").and_then(Value::as_bool) == Some(true) {
            "platinum"
        } else if achievement.get("isRare").and_then(Value::as_bool) == Some(true) {
            "rare"
        } else {
            ""
        }
        .into(),
        private: text(item, "visibility") == "PRIVATE",
        liked: item
            .get("likedByMe")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        likes: item.get("likeCount").and_then(Value::as_i64).unwrap_or(0) as i32,
        prev_likes: prev as i32,
        like_gen: roll,
        liking: s.liking.contains(&id),
        has_icon: icon_url.is_some(),
        icon: icon_url
            .map(|u| profile_page::image_for(&u, 32.0))
            .unwrap_or_default(),
        title: text(&achievement, "displayName").into(),
        others: if others > 0 {
            format!("+{others}")
        } else {
            String::new()
        }
        .into(),
        time: hydra_i18n::date::format_distance(
            language,
            millis(achievement.get("unlockTime")),
            now,
            true,
        )
        .into(),
        show_game,
        game_title: opt_text(item, "gameTitle")
            .map(str::to_string)
            .unwrap_or_else(|| t("user_profile.unknown_game"))
            .into(),
        has_game_icon: game_icon.is_some(),
        game_icon: game_icon
            .map(|u| profile_page::image_for(&u, 16.0))
            .unwrap_or_default(),
    }
}

fn thumb_key(url: &str, blurred: bool) -> String {
    if blurred {
        format!("blur:{url}")
    } else {
        url.to_string()
    }
}

/// Rebuild the cards, groups, notices and the empty state.
pub fn apply() {
    let Some(ui) = window() else { return };
    let Some(profile) = profile_page::current_profile() else {
        return;
    };
    let me = profile_page::signed_in_user_id().as_deref() == Some(text(&profile, "id").as_str());
    let subscribed = profile
        .get("hasActiveSubscription")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let language = shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default();
    let (cards, groups, empty, has_more, loading_more, limit, sort, grouping, total) = with(|s| {
        let grouped = s.grouping == "game";
        let mut cards = Vec::new();
        let mut groups = Vec::new();
        if grouped {
            // groupedAchievements: by gameId, in first-seen order
            let mut order: Vec<String> = Vec::new();
            let mut by_game: HashMap<String, Vec<&Value>> = HashMap::new();
            for item in &s.items {
                let game = text(item, "gameId");
                if !by_game.contains_key(&game) {
                    order.push(game.clone());
                }
                by_game.entry(game).or_default().push(item);
            }
            for game in order {
                let items = &by_game[&game];
                let first = cards.len();
                for item in items {
                    cards.push(card(s, item, false, &language, now));
                }
                let head = items[0];
                let icon = opt_text(head, "gameIconUrl").map(str::to_string);
                groups.push(ProfileSouvenirGroup {
                    game_id: game.as_str().into(),
                    title: opt_text(head, "gameTitle")
                        .map(str::to_string)
                        .unwrap_or_else(|| t("user_profile.unknown_game"))
                        .into(),
                    has_icon: icon.is_some(),
                    icon: icon
                        .map(|u| profile_page::image_for(&u, 24.0))
                        .unwrap_or_default(),
                    first: first as i32,
                    count: items.len() as i32,
                    expanded: !s.collapsed.contains(&game),
                });
            }
        } else {
            for item in &s.items {
                cards.push(card(s, item, true, &language, now));
            }
        }
        let empty = if !s.items.is_empty() {
            ""
        } else if s.loading {
            "loading"
        } else if !me && s.hidden_reason.is_some() {
            "locked"
        } else if !me {
            "other"
        } else if !subscribed {
            "cloud"
        } else if enabled() {
            "none"
        } else {
            "disabled"
        };
        (
            cards,
            groups,
            empty,
            (s.items.len() as i64) < s.total,
            s.loading && !s.items.is_empty(),
            me && s.has_reached_limit,
            s.sort.clone(),
            s.grouping.clone(),
            s.total,
        )
    });
    let d = ui.global::<ProfileData>();
    d.set_souvenirs_count(total as i32);
    d.set_souvenir_sort(sort.into());
    d.set_souvenir_grouping(grouping.into());
    d.set_souvenirs_empty(empty.into());
    d.set_souvenirs_has_more(has_more);
    d.set_souvenirs_loading_more(loading_more);
    d.set_souvenirs_limit(limit);
    d.set_souvenirs_privacy(privacy_notice(&profile, me, subscribed).into());
    let model = d.get_souvenirs();
    if model.row_count() == cards.len()
        && cards
            .iter()
            .enumerate()
            .all(|(i, c)| model.row_data(i).is_some_and(|m| m.id == c.id))
    {
        for (index, card) in cards.into_iter().enumerate() {
            model.set_row_data(index, card);
        }
    } else {
        d.set_souvenirs(ModelRc::new(VecModel::from(cards)));
    }
    d.set_souvenir_groups(ModelRc::new(VecModel::from(groups)));
    load_thumbs();
}

/// isAchievementSouvenirsEnabled(enableAchievementSouvenirs, platform)
fn enabled() -> bool {
    let preferences = shell::db().and_then(|db| db.get::<Value>(hydra_db::keys::USER_PREFERENCES));
    match preferences
        .as_ref()
        .and_then(|p| p.get("enableAchievementSouvenirs"))
        .and_then(Value::as_bool)
    {
        Some(value) => value,
        None => !cfg!(target_os = "linux"),
    }
}

/// The visibility notice: own profile with Hydra Cloud, not PUBLIC, and not
/// acknowledged for this visibility (PUBLIC records itself).
fn privacy_notice(profile: &Value, me: bool, subscribed: bool) -> String {
    if !me {
        return String::new();
    }
    let visibility = text(profile, "souvenirsVisibility");
    let key = format!("souvenir-visibility-acknowledged:{}", text(profile, "id"));
    if visibility == "PUBLIC" {
        if shell::storage_get(&key).as_deref() != Some("PUBLIC") {
            shell::storage_set(&key, "PUBLIC");
        }
        return String::new();
    }
    if !subscribed || shell::storage_get(&key).as_deref() == Some(visibility.as_str()) {
        return String::new();
    }
    visibility
}

/// The thumbnails at the cards' width (blurred 18px for the content warning).
fn load_thumbs() {
    let Some((loader, scale)) = shell::loader() else {
        return;
    };
    let jobs: Vec<(String, String, bool)> = with(|s| {
        if s.card_px == 0 {
            return Vec::new();
        }
        let mut jobs = Vec::new();
        for item in &s.items {
            let Some(url) = opt_text(item, "imageUrl").map(str::to_string) else {
                continue;
            };
            let blurred = warn(item);
            let key = thumb_key(&url, blurred);
            if !s.thumbs.contains_key(&key) && !s.pending.contains(&key) {
                s.pending.insert(key.clone());
                jobs.push((url, key, blurred));
            }
        }
        jobs
    });
    let card_px = with(|s| s.card_px);
    let generation = with(|s| s.generation);
    for (url, key, blurred) in jobs {
        loader.run(move |http| {
            let decoded = images::fetch(http, &Source::from(url.clone()))
                .and_then(|bytes| images::open_bytes(&bytes));
            let pixels = decoded.map(|img: DynamicImage| {
                let width = (card_px as f32 * 1.12).ceil() as u32;
                let img = if img.width() > width {
                    img.resize(width, u32::MAX, image::imageops::FilterType::CatmullRom)
                } else {
                    img
                };
                if blurred {
                    let per_px = card_px as f32 / img.width().max(1) as f32;
                    let sigma = (18.0 * scale / per_px.max(1e-3)).max(0.5);
                    images::to_pixels(img.blur(sigma), Op::Full)
                } else {
                    images::to_pixels(img, Op::Full)
                }
            });
            let _ = slint::invoke_from_event_loop(move || {
                if with(|s| s.generation) != generation {
                    return;
                }
                with(|s| {
                    s.pending.remove(&key);
                    if let Some(pixels) = pixels {
                        s.thumbs.insert(key.clone(), pixels.into_image());
                    }
                });
                apply();
            });
        });
    }
}
