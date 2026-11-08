//! pages/profile: context/user-profile (profile, stats, library pages,
//! badges, souvenir count), profile-content (tabs, the library tab, the
//! reviews tab, the right rail) and profile-hero (banner or avatar color,
//! friend code, current game, the profile actions).
//!
//! The modals it opens live in `profile_modals.rs`. Not ported yet: the
//! Souvenirs and Screenshots tabs' content (they show a TODO panel), and the
//! gamification pieces (level box, pills, Missions tab, Shop button), which
//! stay hidden while the GAMIFICATION flag is off, as it is in production.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use hydra_core::api::Options;
use hydra_core::profile::{self, Platform, Relation, Sort, Tab};
use hydra_i18n::Arg;
use hydra_media::images::{self, Op, Pixels, Source};
use image::DynamicImage;
use serde_json::{Value, json};
use slint::{ComponentHandle, Image, Model, ModelRc, SharedString, StyledText, VecModel};

use crate::{
    AppWindow, ProfileBadge, ProfileData, ProfileFriend, ProfileGameCard, ProfileRecentGame,
    ProfileReview, Session, features, nav, shell, toast,
};

#[derive(Default)]
struct Review {
    raw: Value,
    upvotes: i64,
    downvotes: i64,
    has_upvoted: bool,
    has_downvoted: bool,
    prev_upvotes: i64,
    prev_downvotes: i64,
    up_gen: i32,
    down_gen: i32,
    show_original: bool,
    icon: Image,
}

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    user_id: String,
    /// Bumped when another profile opens: late responses are dropped.
    generation: u64,
    profile: Option<Value>,
    stats: Option<Value>,
    badge_catalog: Vec<Value>,
    platform: Platform,
    sort: Sort,
    /// readStoredProfileSort() when the page opened (the prefetch).
    prefetched_sort: Option<Sort>,
    loaded_sort: Option<Sort>,
    /// the sort of the last library request (the prefetch may still be out)
    requested_sort: Option<Sort>,
    library: Vec<Value>,
    pinned: Vec<Value>,
    library_page: usize,
    has_more: bool,
    loading_library: bool,
    loaded_library: bool,
    library_request: u64,
    stats_request: u64,
    souvenirs_total: i64,
    screenshots_total: Option<i64>,
    tab: Tab,
    reviews: Vec<Review>,
    reviews_total: i64,
    reviews_loading: bool,
    voting: HashSet<String>,
    // images
    card_px: u32,
    range: (usize, usize),
    /// cover, classics backdrop, natural size
    covers: HashMap<String, (Image, Image, (f32, f32))>,
    pending: HashSet<String>,
    failed: HashSet<String>,
    placeholders: HashMap<String, Image>,
    images: HashMap<String, Image>,
    /// The avatar's full-size picture, for the fullscreen view.
    avatar_full: Option<Image>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
    static STATS_TIMER: slint::Timer = slint::Timer::default();
    static COPIED_TIMER: slint::Timer = slint::Timer::default();
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn window() -> Option<AppWindow> {
    with(|s| s.ui.upgrade())
}

fn data(ui: &AppWindow) -> ProfileData<'_> {
    ui.global::<ProfileData>()
}

fn t(key: &str) -> String {
    shell::tr(key)
}

fn language() -> String {
    shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into())
}

/// The renderer's numberFormatter (Intl.NumberFormat, no fraction digits).
pub fn format_number(value: f64) -> String {
    shell::i18n()
        .map(|i| i.format_number(value.round()))
        .unwrap_or_else(|| format!("{}", value.round() as i64))
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
        .filter(|s| !s.trim().is_empty())
}

fn num(value: &Value, key: &str) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or_default()
}

fn flag(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// The play time line (amount_minutes / amount_hours, short variants).
pub fn play_time(seconds: f64, short: bool) -> String {
    let (key, amount) = profile::play_time(seconds, short, format_number);
    shell::tr_with(
        &format!("user_profile.{key}"),
        &[("amount", Arg::Text(amount))],
    )
}

pub fn signed_in_user_id() -> Option<String> {
    shell::user_details()
        .and_then(|u| u.get("id").and_then(Value::as_str).map(str::to_string))
        .filter(|id| !id.is_empty())
}

/// The open profile's id and whether it is the signed-in user's.
pub fn current() -> Option<(String, bool)> {
    with(|s| {
        s.profile.as_ref().map(|p| {
            let id = text(p, "id");
            let me = signed_in_user_id().as_deref() == Some(id.as_str());
            (id, me)
        })
    })
}

pub fn current_profile() -> Option<Value> {
    with(|s| s.profile.clone())
}

pub fn init(ui: &AppWindow) {
    with(|s| {
        s.ui = ui.as_weak();
        s.range = (0, 24);
    });
    let data = ui.global::<ProfileData>();
    data.on_set_tab(|tab| set_tab(&tab));
    data.on_set_platform(|platform| {
        let platform = Platform::parse(Some(&platform));
        shell::storage_set("profile-platform", platform.as_str());
        with(|s| s.platform = platform);
        refresh_filters();
        load_library(true);
        load_stats();
    });
    data.on_set_sort(|sort| {
        let sort = Sort::parse(Some(&sort));
        shell::storage_set("profile-sort-by", sort.as_str());
        with(|s| s.sort = sort);
        refresh_filters();
        load_library(true);
    });
    data.on_open_game(|index, pinned| open_game(index as usize, pinned));
    data.on_game_context_menu(|index, pinned, x, y| game_menu(index as usize, pinned, x, y));
    data.on_load_more_games(load_more);
    data.on_visible_games(|first, last| {
        with(|s| s.range = (first.max(0) as usize, last.max(0) as usize));
        load_covers();
    });
    data.on_card_width_changed(|px| {
        let changed = with(|s| {
            let changed = s.card_px != px.max(0) as u32;
            s.card_px = px.max(0) as u32;
            changed
        });
        if changed {
            load_covers();
        }
    });
    data.on_avatar_clicked(|| {
        let (has_avatar, is_me) = with(|s| {
            (
                s.profile
                    .as_ref()
                    .and_then(|p| opt_text(p, "profileImageUrl"))
                    .is_some(),
                s.profile.as_ref().map(|p| is_me(p)).unwrap_or(false),
            )
        });
        if has_avatar {
            crate::profile_modals::open_avatar();
        } else if is_me {
            crate::profile_modals::open_edit();
        }
    });
    data.on_copy_friend_code(copy_friend_code);
    data.on_friend_action(|action| friend_action(&action));
    data.on_edit_profile(crate::profile_modals::open_edit);
    data.on_sign_out(|| {
        if let Some(ui) = window() {
            ui.global::<Session>().invoke_sign_out();
        }
    });
    data.on_open_shop(|| nav::navigate("/shop"));
    data.on_gift(gift);
    data.on_banner_clicked(|x, y, w, h| crate::profile_modals::banner_clicked(x, y, w, h));
    data.on_open_recent(|index| {
        let game = with(|s| {
            s.profile.as_ref().and_then(|p| {
                p.get("recentGames")
                    .and_then(Value::as_array)
                    .and_then(|g| g.get(index as usize))
                    .cloned()
            })
        });
        if let Some(game) = game {
            nav::navigate(&game_details_path(&game));
        }
    });
    data.on_open_friend(|id| nav::navigate(&format!("/profile/{id}")));
    data.on_view_all_badges(|| crate::profile_modals::open("badges"));
    data.on_view_all_friends(crate::profile_modals::open_friends);
    data.on_add_friends(crate::profile_modals::open_add_friend);
    data.on_report(|| {
        if !shell::signed_in() {
            if let Some(ui) = window() {
                ui.global::<Session>().invoke_sign_in();
            }
            return;
        }
        crate::profile_modals::open_report();
    });
    data.on_hydra_cloud(|feature| eprintln!("TODO(cloud): showHydraCloudModal({feature:?})"));
    data.on_open_current_game(open_current_game);
    data.on_open_review_game(|id| {
        let game = with(|s| {
            s.reviews
                .iter()
                .find(|r| text(&r.raw, "id") == id.as_str())
                .and_then(|r| r.raw.get("game").cloned())
        });
        if let Some(game) = game {
            nav::navigate(&game_details_path(&game));
        }
    });
    data.on_vote_review(|id, up| vote_review(&id, up));
    data.on_delete_review(|id| delete_review(&id));
    data.on_toggle_original(|id| {
        with(|s| {
            if let Some(review) = s
                .reviews
                .iter_mut()
                .find(|r| text(&r.raw, "id") == id.as_str())
            {
                review.show_original = !review.show_original;
            }
        });
        apply_reviews();
    });
}

fn is_me(profile: &Value) -> bool {
    signed_in_user_id().as_deref() == Some(text(profile, "id").as_str())
}

/// buildGameDetailsPath: /game/{shop}/{objectId}?title=…
pub fn game_details_path(game: &Value) -> String {
    let identity = game
        .get("catalogueGame")
        .filter(|c| c.is_object())
        .unwrap_or(game);
    format!(
        "/game/{}/{}?title={}",
        text(identity, "shop"),
        text(identity, "objectId"),
        nav::encode(&text(game, "title"))
    )
}

// ---- route --------------------------------------------------------------

/// The /profile/:userId route (also on a query change of the same profile).
pub fn open(path: &str, query: &nav::Location, previous: Option<&str>) {
    let user_id = path
        .trim_start_matches('/')
        .split('/')
        .nth(1)
        .unwrap_or_default()
        .to_string();
    let requested_tab = query.param("tab").map(str::to_string);
    let requested_screenshot = query.param("screenshot").is_some();
    let edit = query.param("edit") == Some("profile");
    let same = previous == Some(path) && with(|s| s.user_id == user_id && s.profile.is_some());
    let screenshots = features::enabled("SCREENSHOTS");
    let mut tab = profile::requested_tab(
        requested_tab.as_deref(),
        requested_screenshot,
        screenshots,
        false,
    );
    // ?souvenir= (souvenir like notifications) opens the Souvenirs tab.
    // TODO(profile): then the souvenir in the lightbox.
    let requested_souvenir = query.param("souvenir").is_some_and(|s| !s.is_empty());
    if requested_souvenir {
        tab = Tab::Souvenirs;
    }
    if same {
        // A notification link to the profile that is already open.
        if requested_tab.is_some() || requested_screenshot || requested_souvenir {
            set_tab(tab.as_str());
        }
        if edit && current().is_some_and(|(_, me)| me) {
            crate::profile_modals::open_edit();
        }
        return;
    }
    start_stats_cycle();
    let generation = with(|s| {
        s.generation += 1;
        s.user_id = user_id.clone();
        s.profile = None;
        s.stats = None;
        s.library.clear();
        s.pinned.clear();
        s.library_page = 0;
        s.has_more = true;
        s.loading_library = false;
        s.loaded_library = false;
        s.loaded_sort = None;
        s.requested_sort = None;
        s.library_request += 1;
        s.stats_request += 1;
        s.souvenirs_total = 0;
        s.screenshots_total = None;
        s.reviews.clear();
        s.reviews_total = 0;
        s.reviews_loading = false;
        s.voting.clear();
        s.tab = tab;
        s.platform = Platform::parse(shell::storage_get("profile-platform").as_deref());
        s.sort = Sort::parse(shell::storage_get("profile-sort-by").as_deref());
        s.prefetched_sort = Some(s.sort);
        s.avatar_full = None;
        s.range = (0, 24);
        s.generation
    });
    if let Some(ui) = window() {
        let d = data(&ui);
        d.set_loaded(false);
        d.set_user_id(user_id.as_str().into());
        d.set_display_name("".into());
        d.set_avatar(Image::default());
        d.set_has_avatar(false);
        d.set_hero_from(slint::Color::from_argb_u8(0xb3, 0x15, 0x15, 0x15));
        d.set_hero_to(slint::Color::from_argb_u8(0xb3, 0x15, 0x15, 0x15));
        d.set_has_banner(false);
        d.set_banner(Image::default());
        d.set_banner_frost(Image::default());
        d.set_current_game("".into());
        d.set_copied(false);
        d.set_busy(false);
        d.set_tab(tab.as_str().into());
        d.set_show_screenshots(screenshots);
        d.set_games(ModelRc::default());
        d.set_pinned(ModelRc::default());
        d.set_library_awaiting(true);
        d.set_reviews(ModelRc::default());
        d.set_reviews_count(0);
        d.set_souvenirs_count(0);
        d.set_screenshots_count(0);
        d.set_show_rail(false);
        d.set_recent(ModelRc::default());
        d.set_friends(ModelRc::default());
        d.set_badges(ModelRc::default());
        d.set_badges_count(0);
    }
    refresh_filters();
    // getUserProfile: stats, the first library page and the souvenirs start
    // with the stored filter and sort, then the profile itself.
    load_stats();
    load_library(true);
    crate::profile_souvenirs::open(&user_id);
    load_profile(generation, edit);
    load_badges(generation);
}

/// Leaving the profile route.
pub fn close() {
    STATS_TIMER.with(|t| t.stop());
    with(|s| {
        s.generation += 1;
        s.covers.clear();
        s.pending.clear();
        s.images.clear();
        s.avatar_full = None;
    });
}

fn start_stats_cycle() {
    // user-library-game-stats-cycle: the column is up from 50% to 92.86% of
    // each 7s period, on the wall clock (every card shares the phase).
    STATS_TIMER.with(|timer| {
        timer.start(
            slint::TimerMode::Repeated,
            std::time::Duration::from_millis(50),
            || {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or_default();
                let phase = (now % 7000) as f64 / 7000.0;
                let up = (0.5..0.9286).contains(&phase);
                if let Some(ui) = window() {
                    let d = data(&ui);
                    if d.get_stats_up() != up {
                        d.set_stats_up(up);
                    }
                }
            },
        )
    });
}

fn set_tab(tab: &str) {
    let Some(tab) = Tab::parse(tab) else { return };
    if tab == Tab::Missions {
        return;
    }
    if tab == Tab::Screenshots && !features::enabled("SCREENSHOTS") {
        return;
    }
    let changed = with(|s| {
        let changed = s.tab != tab;
        s.tab = tab;
        changed
    });
    if let Some(ui) = window() {
        let d = data(&ui);
        d.set_tab(tab.as_str().into());
        if changed {
            d.set_tab_switch(d.get_tab_switch() + 1);
        }
    }
    apply_rail();
}

// ---- loading ------------------------------------------------------------

fn load_profile(generation: u64, edit: bool) {
    let Some(api) = shell::api() else { return };
    let user_id = with(|s| s.user_id.clone());
    std::thread::spawn(move || {
        // needsAuth: false still sends the session; Electron's token is fresh
        // from the app's other requests, so make sure ours is too (relation).
        if api.is_logged_in() {
            let _ = api.fresh_access_token();
        }
        let result = api.get(
            &format!("/users/{user_id}"),
            &[("shop", "steam".into()), ("shop", "launchbox".into())],
            Options::public(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation {
                return;
            }
            match result {
                Ok(profile) if profile.is_object() => {
                    on_profile(profile, true);
                    if edit && current().is_some_and(|(_, me)| me) {
                        crate::profile_modals::open_edit();
                    }
                }
                _ => {
                    toast::error(&t("user_profile.user_not_found"));
                    nav::go(-1);
                }
            }
        });
    });
}

/// getUserProfile after an edit or a friend action: the profile again
/// (and the library, stats and souvenirs like Electron).
pub fn reload() {
    let generation = with(|s| s.generation);
    load_stats();
    load_library(true);
    crate::profile_souvenirs::reload();
    load_profile(generation, false);
}

fn on_profile(profile: Value, first: bool) {
    let avatar_url = opt_text(&profile, "profileImageUrl").map(str::to_string);
    let banner_url = opt_text(&profile, "backgroundImageUrl").map(str::to_string);
    let previous_avatar = with(|s| {
        s.profile
            .as_ref()
            .and_then(|p| opt_text(p, "profileImageUrl").map(str::to_string))
    });
    let has_subscription = flag(&profile, "hasActiveSubscription");
    // isCorrectingPrefetchedSort: the prefetch used the stored sort, which
    // may need Hydra Cloud the profile doesn't have.
    let correct_sort = with(|s| {
        s.profile = Some(profile);
        s.requested_sort != Some(s.sort.effective(has_subscription))
    });
    let generation = with(|s| s.generation);
    if first || avatar_url != previous_avatar {
        load_avatar(avatar_url, generation);
    }
    crate::profile_modals::on_profile_banner(banner_url);
    apply_profile();
    refresh_filters();
    crate::profile_souvenirs::apply();
    // The effects on userProfile: the library with the effective sort when
    // the prefetch used another one, the reviews.
    if correct_sort {
        load_library(true);
    }
    if first {
        load_reviews();
    }
}

fn load_stats() {
    let Some(api) = shell::api() else { return };
    let (user_id, platform, request) = with(|s| {
        s.stats_request += 1;
        (s.user_id.clone(), s.platform, s.stats_request)
    });
    std::thread::spawn(move || {
        let result = api.get(
            &format!("/users/{user_id}/stats"),
            &profile::stats_query(platform),
            Options::public(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.stats_request) != request {
                return;
            }
            if let Ok(stats) = result
                && stats.is_object()
            {
                with(|s| s.stats = Some(stats));
                apply_rail();
                apply_library();
            }
        });
    });
}

fn effective_sort() -> Sort {
    with(|s| {
        let subscribed = s
            .profile
            .as_ref()
            .map(|p| flag(p, "hasActiveSubscription"))
            .unwrap_or(false);
        match &s.profile {
            Some(_) => s.sort.effective(subscribed),
            // the prefetch: readStoredProfileSort() as is
            None => s.sort,
        }
    })
}

/// getUserLibraryGames(sortBy, reset)
fn load_library(reset: bool) {
    let Some(api) = shell::api() else { return };
    let sort = effective_sort();
    let (user_id, platform, request) = with(|s| {
        if reset {
            s.library_request += 1;
            s.library_page = 0;
            s.has_more = true;
            s.loading_library = true;
            s.requested_sort = Some(sort);
        }
        (s.user_id.clone(), s.platform, s.library_request)
    });
    apply_library();
    std::thread::spawn(move || {
        let result = profile::fetch_library_page(&api, &user_id, 0, platform, Some(sort));
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.library_request) != request {
                return;
            }
            with(|s| {
                s.loaded_sort = Some(sort);
                match result {
                    Ok((library, pinned)) => {
                        s.has_more = library.len() == profile::LIBRARY_PAGE_SIZE;
                        s.library = library;
                        s.pinned = pinned;
                    }
                    Err(error) => {
                        eprintln!("profile library: {error}");
                        s.library.clear();
                        s.pinned.clear();
                        s.has_more = false;
                    }
                }
                s.loading_library = false;
                s.loaded_library = true;
            });
            apply_library();
            apply_rail();
        });
    });
}

/// loadMoreLibraryGames: the next 48, deduplicated by objectId.
fn load_more() {
    let go =
        with(|s| s.tab == Tab::Library && !s.loading_library && s.has_more && s.loaded_library);
    if !go {
        return;
    }
    let Some(api) = shell::api() else { return };
    let sort = effective_sort();
    let (user_id, platform, request, next) = with(|s| {
        s.loading_library = true;
        (
            s.user_id.clone(),
            s.platform,
            s.library_request,
            s.library_page + 1,
        )
    });
    if let Some(ui) = window() {
        data(&ui).set_loading_more_games(true);
    }
    std::thread::spawn(move || {
        let result = profile::fetch_library_page(
            &api,
            &user_id,
            next * profile::LIBRARY_PAGE_SIZE,
            platform,
            Some(sort),
        );
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.library_request) != request {
                return;
            }
            with(|s| {
                s.loading_library = false;
                match result {
                    Ok((library, _)) if !library.is_empty() => {
                        let existing: HashSet<String> =
                            s.library.iter().map(|g| text(g, "objectId")).collect();
                        s.has_more = library.len() == profile::LIBRARY_PAGE_SIZE;
                        s.library.extend(
                            library
                                .into_iter()
                                .filter(|g| !existing.contains(&text(g, "objectId"))),
                        );
                        s.library_page = next;
                    }
                    _ => s.has_more = false,
                }
            });
            if let Some(ui) = window() {
                data(&ui).set_loading_more_games(false);
            }
            append_library();
        });
    });
}

fn load_badges(generation: u64) {
    let Some(api) = shell::api() else { return };
    let lang = language().split('-').next().unwrap_or("en").to_string();
    std::thread::spawn(move || {
        let result = api.get("/badges", &[("locale", lang)], Options::public());
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation {
                return;
            }
            if let Ok(Value::Array(badges)) = result {
                with(|s| s.badge_catalog = badges);
                apply_rail();
            }
        });
    });
}

fn load_reviews() {
    let Some(api) = shell::api() else { return };
    let (user_id, generation) = with(|s| {
        s.reviews_loading = true;
        (s.user_id.clone(), s.generation)
    });
    apply_reviews();
    std::thread::spawn(move || {
        let result = api.get(&format!("/users/{user_id}/reviews"), &[], Options::public());
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation {
                return;
            }
            with(|s| {
                s.reviews_loading = false;
                if let Ok(response) = &result {
                    s.reviews_total = response
                        .get("totalCount")
                        .and_then(Value::as_i64)
                        .unwrap_or(0);
                    s.reviews = response
                        .get("reviews")
                        .and_then(Value::as_array)
                        .map(|list| {
                            list.iter()
                                .map(|r| Review {
                                    upvotes: num(r, "upvotes") as i64,
                                    downvotes: num(r, "downvotes") as i64,
                                    prev_upvotes: num(r, "upvotes") as i64,
                                    prev_downvotes: num(r, "downvotes") as i64,
                                    has_upvoted: flag(r, "hasUpvoted"),
                                    has_downvoted: flag(r, "hasDownvoted"),
                                    raw: r.clone(),
                                    ..Review::default()
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                }
            });
            apply_reviews();
            load_review_icons(generation);
        });
    });
}

// ---- hero ---------------------------------------------------------------

/// The avatar at 96px, its color average for the hero gradient
/// (getHeroBackgroundFromImageUrl) and the full picture for the viewer.
fn load_avatar(url: Option<String>, generation: u64) {
    let Some(url) = url else { return };
    let Some((loader, scale)) = shell::loader() else {
        return;
    };
    loader.run(move |http| {
        let decoded = images::fetch(http, &Source::from(url.clone()))
            .and_then(|bytes| images::open_bytes(&bytes));
        let result = decoded.map(|img| {
            let average = profile::average_color(img.to_rgba8().as_raw());
            let size = (96.0 * scale).ceil() as u32;
            let small = images::to_pixels(
                img.resize_to_fill(size, size, image::imageops::FilterType::Triangle),
                Op::Full,
            );
            let full = images::to_pixels(img, Op::Full);
            (average, small, full)
        });
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation {
                return;
            }
            let Some((average, small, full)) = result else {
                return;
            };
            let (from, to) = profile::hero_gradient(average);
            with(|s| s.avatar_full = Some(full.into_image()));
            if let Some(ui) = window() {
                let d = data(&ui);
                d.set_avatar(small.into_image());
                d.set_hero_from(slint::Color::from_argb_u8(
                    from[3], from[0], from[1], from[2],
                ));
                d.set_hero_to(slint::Color::from_argb_u8(to[3], to[0], to[1], to[2]));
            }
        });
    });
}

pub fn avatar_full() -> Option<Image> {
    with(|s| s.avatar_full.clone())
}

fn apply_profile() {
    let Some(ui) = window() else { return };
    let Some(profile) = with(|s| s.profile.clone()) else {
        return;
    };
    let me = is_me(&profile);
    let d = data(&ui);
    d.set_loaded(true);
    d.set_user_id(text(&profile, "id").into());
    d.set_display_name(text(&profile, "displayName").into());
    d.set_has_avatar(opt_text(&profile, "profileImageUrl").is_some());
    d.set_is_me(me);
    d.set_relation(
        match profile::relation(&profile, me) {
            Relation::Me => "me",
            Relation::None => "none",
            Relation::Friends => "friends",
            Relation::Sent => "sent",
            Relation::Received => "received",
        }
        .into(),
    );
    d.set_can_gift(!me && flag(&profile, "canReceiveCloudGift"));
    d.set_shop_enabled(features::enabled("GAMIFICATION") && features::enabled("GAMIFICATION_SHOP"));
    d.set_viewer_subscriber(ui.global::<Session>().get_has_subscription());
    d.set_has_banner_url(opt_text(&profile, "backgroundImageUrl").is_some());
    d.set_locked(profile::is_locked(&profile, me));
    d.set_sort_achievements(flag(&profile, "hasActiveSubscription"));
    let screenshots =
        with(|s| s.screenshots_total).unwrap_or_else(|| num(&profile, "screenshotCount") as i64);
    d.set_screenshots_count(screenshots as i32);
    apply_current_game(&ui, &profile, me);
    apply_rail();
    apply_library();
}

/// currentGame: the running game on the own profile, else the API's.
fn apply_current_game(ui: &AppWindow, profile: &Value, me: bool) {
    let d = data(ui);
    if me {
        let title = ui.global::<Session>().get_running_title();
        let session = crate::games::shown_game()
            .map(|(_, millis)| millis)
            .unwrap_or(0);
        d.set_current_game(title.clone());
        d.set_current_game_hidden(false);
        d.set_playing_for(if title.is_empty() {
            "".into()
        } else {
            shell::tr_with(
                "user_profile.playing_for",
                &[("amount", Arg::Text(distance(session as f64 / 1000.0)))],
            )
            .into()
        });
        return;
    }
    match profile.get("currentGame").filter(|g| g.is_object()) {
        Some(game) => {
            d.set_current_game(text(game, "title").into());
            d.set_current_game_hidden(flag(game, "isHiddenFromOthers"));
            d.set_playing_for(
                shell::tr_with(
                    "user_profile.playing_for",
                    &[(
                        "amount",
                        Arg::Text(distance(num(game, "sessionDurationInSeconds"))),
                    )],
                )
                .into(),
            );
        }
        None => d.set_current_game("".into()),
    }
}

/// formatDistance(now - seconds, now)
fn distance(seconds: f64) -> String {
    let now = chrono_now_ms();
    hydra_i18n::date::format_distance(&language(), now - (seconds * 1000.0) as i64, now, false)
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

fn open_current_game() {
    let Some(profile) = current_profile() else {
        return;
    };
    if is_me(&profile) {
        if let Some((key, _)) = crate::games::shown_game()
            && let Some((shop, object_id)) = key.split_once(':')
            && let Some(ui) = window()
        {
            nav::navigate(&format!(
                "/game/{shop}/{object_id}?title={}",
                nav::encode(&ui.global::<Session>().get_running_title())
            ));
        }
        return;
    }
    if let Some(game) = profile.get("currentGame").filter(|g| g.is_object()) {
        nav::navigate(&game_details_path(game));
    }
}

fn copy_friend_code() {
    let Some((id, _)) = current() else { return };
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        let _ = clipboard.set_text(id);
    }
    if let Some(ui) = window() {
        data(&ui).set_copied(true);
    }
    COPIED_TIMER.with(|timer| {
        timer.start(
            slint::TimerMode::SingleShot,
            std::time::Duration::from_millis(1200),
            || {
                if let Some(ui) = window() {
                    data(&ui).set_copied(false);
                }
            },
        )
    });
}

/// handleFriendAction. The writes only run on an explicit click.
fn friend_action(action: &str) {
    let Some(profile) = current_profile() else {
        return;
    };
    if !shell::signed_in() {
        if let Some(ui) = window() {
            ui.global::<Session>().invoke_sign_in();
        }
        return;
    }
    let Some(api) = shell::api() else { return };
    let user_id = text(&profile, "id");
    let relation = profile.get("relation").cloned().unwrap_or(Value::Null);
    // CANCEL targets relation.BId, ACCEPTED/REFUSED relation.AId (both the profile).
    let target = match action {
        "CANCEL" => text(&relation, "BId"),
        "ACCEPTED" | "REFUSED" => text(&relation, "AId"),
        _ => user_id.clone(),
    };
    let action = action.to_string();
    if let Some(ui) = window() {
        data(&ui).set_busy(true);
    }
    std::thread::spawn(move || {
        let result = match action.as_str() {
            "UNDO_FRIENDSHIP" | "CANCEL" => api
                .delete(
                    &format!("/profile/friend-requests/{target}"),
                    Options::default(),
                )
                .map(|_| ()),
            "BLOCK" => api
                .post(
                    &format!("/users/{target}/block"),
                    &Value::Null,
                    Options::default(),
                )
                .map(|_| ()),
            "SEND" => api
                .post(
                    "/profile/friend-requests",
                    &json!({ "friendCode": target }),
                    Options::default(),
                )
                .map(|_| ()),
            _ => api
                .patch(
                    &format!("/profile/friend-requests/{target}"),
                    &json!({ "requestState": action }),
                    Options::default(),
                )
                .map(|_| ()),
        };
        // updateFriendRequestState / sendFriendRequest refetch the requests.
        if result.is_ok() && action != "UNDO_FRIENDSHIP" && action != "BLOCK" {
            let _ = api.get("/profile/friend-requests", &[], Options::default());
        }
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = window() {
                data(&ui).set_busy(false);
            }
            match result {
                Ok(()) if action == "BLOCK" => {
                    toast::success(&t("user_profile.user_blocked_successfully"));
                    nav::go(-1);
                }
                Ok(()) => reload(),
                Err(error) => {
                    eprintln!("friend action {action}: {error}");
                    toast::error(&t("user_profile.try_again"));
                }
            }
        });
    });
}

/// The gift button: sign in first, else the checkout's /gift page.
fn gift() {
    if !shell::signed_in() {
        if let Some(ui) = window() {
            ui.global::<Session>().invoke_sign_in();
        }
        return;
    }
    let Some((recipient, _)) = current() else {
        return;
    };
    open_gift_checkout(recipient);
}

/// openCheckout({ path: "/gift", recipientId }): a payment token from
/// POST /auth/payment, then the checkout's /gift page in the browser.
fn open_gift_checkout(recipient: String) {
    let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
        return;
    };
    let Some(refresh_token) = db.get::<Value>(hydra_db::keys::AUTH).and_then(|a| {
        a.get("refreshToken")
            .and_then(Value::as_str)
            .map(str::to_string)
    }) else {
        return;
    };
    std::thread::spawn(move || {
        let token = api
            .post(
                "/auth/payment",
                &json!({ "refreshToken": refresh_token }),
                Options::default(),
            )
            .ok()
            .and_then(|v| {
                v.get("accessToken")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
        let Some(token) = token else {
            eprintln!("openCheckout: no payment token");
            return;
        };
        let Ok(mut url) = reqwest::Url::parse(&hydra_core::config::checkout_url()) else {
            return;
        };
        url.set_path("/gift");
        {
            let mut query = url.query_pairs_mut();
            // isEncodedId: 8 letters or digits
            if recipient.len() == 8 && recipient.chars().all(|c| c.is_ascii_alphanumeric()) {
                query.append_pair("recipientId", &recipient);
            }
            query.append_pair("token", &token);
        }
        // shell.openExternal (not `cmd /C start`, which would cut the URL at `&`)
        #[cfg(windows)]
        let _ = std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url.as_str()])
            .spawn();
        #[cfg(not(windows))]
        let _ = std::process::Command::new(if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        })
        .arg(url.as_str())
        .spawn();
    });
}

// ---- library ------------------------------------------------------------

fn refresh_filters() {
    let Some(ui) = window() else { return };
    let (platform, sort) = with(|s| (s.platform, s.sort));
    let d = data(&ui);
    d.set_platform(platform.as_str().into());
    // the trigger shows the effective sort
    let _ = sort;
    d.set_sort(effective_sort().as_str().into());
}

fn card_for(s: &mut State, game: &Value, subscribed: bool) -> ProfileGameCard {
    let custom = opt_text(game, "customLibraryImageUrl");
    let cover_url = custom.or_else(|| opt_text(game, "coverImageUrl"));
    let classics = text(game, "shop") == "launchbox" && custom.is_none();
    let achievements = num(game, "achievementCount") as i64;
    let unlocked = num(game, "unlockedAchievementCount") as i64;
    let completed = profile::is_completed(achievements, unlocked);
    let points = num(game, "achievementsPointsEarnedSum");
    let seconds = num(game, "playTimeInSeconds");
    let plan = cover_plan(s, game);
    let (cover, backdrop, natural) = plan
        .as_ref()
        .and_then(|(url, _)| s.covers.get(url).cloned())
        .unwrap_or_default();
    let placeholder = plan
        .as_ref()
        .and_then(|(_, hash)| hash.clone())
        .map(|hash| placeholder(s, &hash))
        .unwrap_or_default();
    ProfileGameCard {
        title: text(game, "title").into(),
        cover,
        placeholder,
        backdrop,
        natural_width: natural.0,
        natural_height: natural.1,
        mode: if cover_url.is_none() {
            2
        } else if classics {
            1
        } else {
            0
        },
        playtime_long: play_time(seconds, false).into(),
        playtime_short: play_time(seconds, true).into(),
        manual_playtime: flag(game, "hasManuallyUpdatedPlaytime"),
        hidden_from_others: flag(game, "isHiddenFromOthers"),
        concealed: flag(game, "isConcealed"),
        show_achievements: subscribed && achievements > 0,
        unlocked: unlocked as i32,
        total: achievements as i32,
        completed,
        percent: if achievements > 0 {
            crate::downloads_page::format_progress(unlocked as f64 / achievements as f64, 1)
        } else {
            "0%".to_string()
        }
        .into(),
        points: if points > 0.0 {
            profile::achievement_points(points, format_number).into()
        } else {
            SharedString::default()
        },
    }
}

/// The URL to load for a card (the catalogue copy at the card's width when
/// the API sent one) and its ThumbHash.
fn cover_plan(s: &State, game: &Value) -> Option<(String, Option<String>)> {
    let custom = opt_text(game, "customLibraryImageUrl");
    let raw = custom.or_else(|| opt_text(game, "coverImageUrl"))?.trim();
    let classics = text(game, "shop") == "launchbox" && custom.is_none();
    if !classics
        && let Some(variants) = game
            .get("images")
            .and_then(|i| i.get(raw))
            .and_then(Value::as_object)
        && let Some(base) = variants.get("base").and_then(Value::as_str)
        && let Some(widths) = variants.get("widths").and_then(Value::as_array)
        && !widths.is_empty()
    {
        let mut widths: Vec<u64> = widths.iter().filter_map(Value::as_u64).collect();
        widths.sort_unstable();
        let target = s.card_px.max(1) as u64;
        let width = widths
            .iter()
            .copied()
            .find(|w| *w >= target)
            .or_else(|| widths.last().copied())?;
        let url = format!("{base}/w{width}.webp");
        if !s.failed.contains(&url) {
            let hash = variants
                .get("thumbHash")
                .and_then(Value::as_str)
                .map(str::to_string);
            return Some((url, hash));
        }
    }
    Some((resolve_source(raw), None))
}

/// resolveImageSource
fn resolve_source(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("data:")
    {
        return trimmed.to_string();
    }
    if let Some(path) = trimmed.strip_prefix("local:") {
        return format!("local:{}", path.replace('\\', "/"));
    }
    let normalized = trimmed.replace('\\', "/");
    let bytes = normalized.as_bytes();
    if (bytes.len() > 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/')
        || normalized.starts_with('/')
    {
        return format!("local:{normalized}");
    }
    normalized
}

fn source_of(url: &str) -> Source {
    match url.strip_prefix("local:") {
        Some(path) => std::path::PathBuf::from(path).into(),
        None => url.to_string().into(),
    }
}

fn placeholder(s: &mut State, hash: &str) -> Image {
    use base64::Engine;
    if let Some(image) = s.placeholders.get(hash) {
        return image.clone();
    }
    let image = base64::engine::general_purpose::STANDARD
        .decode(hash)
        .or_else(|_| {
            base64::engine::general_purpose::STANDARD_NO_PAD.decode(hash.trim_end_matches('='))
        })
        .ok()
        .and_then(|bytes| thumbhash::thumb_hash_to_rgba(&bytes).ok())
        .map(|(w, h, rgba)| images::rgba_pixels(w as u32, h as u32, &rgba).into_image())
        .unwrap_or_default();
    if s.placeholders.len() > 500 {
        s.placeholders.clear();
    }
    s.placeholders.insert(hash.to_string(), image.clone());
    image
}

fn subscribed() -> bool {
    with(|s| {
        s.profile
            .as_ref()
            .map(|p| flag(p, "hasActiveSubscription"))
            .unwrap_or(false)
    })
}

/// Rebuild both grids (a new page of results, a new sort or platform).
fn apply_library() {
    let Some(ui) = window() else { return };
    let subscribed = subscribed();
    let (games, pinned, awaiting, count, has_more) = with(|s| {
        let library = s.library.clone();
        let pinned = s.pinned.clone();
        let games: Vec<ProfileGameCard> =
            library.iter().map(|g| card_for(s, g, subscribed)).collect();
        let pinned: Vec<ProfileGameCard> =
            pinned.iter().map(|g| card_for(s, g, subscribed)).collect();
        // isCorrectingPrefetchedSort || !hasLoaded || (loading && empty)
        let effective = s
            .profile
            .as_ref()
            .map(|p| s.sort.effective(flag(p, "hasActiveSubscription")));
        let correcting = s.profile.is_some()
            && Some(s.sort) == s.prefetched_sort
            && effective != s.prefetched_sort
            && s.loaded_sort != effective;
        let awaiting = correcting
            || !s.loaded_library
            || (s.loading_library && s.library.is_empty() && s.pinned.is_empty());
        let count = s
            .stats
            .as_ref()
            .and_then(|st| st.get("libraryCount"))
            .and_then(Value::as_f64)
            .map(format_number)
            .unwrap_or_default();
        (games, pinned, awaiting, count, s.has_more)
    });
    let d = data(&ui);
    d.set_games(ModelRc::new(VecModel::from(games)));
    d.set_pinned(ModelRc::new(VecModel::from(pinned)));
    d.set_library_awaiting(awaiting);
    d.set_library_count(count.into());
    d.set_has_more_games(has_more);
    load_covers();
}

/// A new page arrived: append its cards (the rows on screen keep theirs).
fn append_library() {
    let Some(ui) = window() else { return };
    let subscribed = subscribed();
    let model = data(&ui).get_games();
    let Some(vec) = model.as_any().downcast_ref::<VecModel<ProfileGameCard>>() else {
        apply_library();
        return;
    };
    let new_cards: Vec<ProfileGameCard> = with(|s| {
        let start = vec.row_count();
        let library = s.library.clone();
        library
            .iter()
            .skip(start)
            .map(|g| card_for(s, g, subscribed))
            .collect()
    });
    for card in new_cards {
        vec.push(card);
    }
    data(&ui).set_has_more_games(with(|s| s.has_more));
    load_covers();
}

/// Fetch and decode the covers on screen (plus the pinned ones).
fn load_covers() {
    let Some((loader, scale)) = shell::loader() else {
        return;
    };
    let jobs = with(|s| {
        if s.card_px == 0 {
            return Vec::new();
        }
        let (first, last) = s.range;
        let games: Vec<Value> = s
            .pinned
            .iter()
            .chain(
                s.library
                    .iter()
                    .skip(first)
                    .take(last.saturating_sub(first)),
            )
            .cloned()
            .collect();
        let mut jobs = Vec::new();
        for game in games {
            let classics = text(&game, "shop") == "launchbox"
                && opt_text(&game, "customLibraryImageUrl").is_none();
            if let Some((url, _)) = cover_plan(s, &game)
                && !s.covers.contains_key(&url)
                && !s.pending.contains(&url)
                && !s.failed.contains(&url)
            {
                s.pending.insert(url.clone());
                jobs.push((url, classics));
            }
        }
        if s.covers.len() > 300 {
            s.covers.clear();
        }
        jobs
    });
    let card_px = with(|s| s.card_px);
    let generation = with(|s| s.generation);
    for (url, classics) in jobs {
        loader.run(move |http| {
            let decoded =
                images::fetch(http, &source_of(&url)).and_then(|bytes| images::open_bytes(&bytes));
            let result = decoded.map(|img| {
                let natural = (img.width() as f32, img.height() as f32);
                (cover_pixels(img, classics, card_px, scale), natural)
            });
            let _ = slint::invoke_from_event_loop(move || {
                if with(|s| s.generation) != generation {
                    return;
                }
                with(|s| s.pending.remove(&url));
                match result {
                    Some(((cover, backdrop), natural)) => {
                        let images = (
                            cover.into_image(),
                            backdrop.map(Pixels::into_image).unwrap_or_default(),
                            natural,
                        );
                        with(|s| s.covers.insert(url.clone(), images));
                        update_cards_for(&url);
                    }
                    None => {
                        with(|s| s.failed.insert(url.clone()));
                        // A failed catalogue copy falls back to the original.
                        apply_library();
                    }
                }
            });
        });
    }
}

/// The cover at about the card's size; for classics also the backdrop
/// (blur 16px, saturate 1.1).
fn cover_pixels(
    img: DynamicImage,
    classics: bool,
    card_px: u32,
    scale: f32,
) -> (Pixels, Option<Pixels>) {
    use image::imageops::FilterType;
    let card_w = card_px.max(1) as f32;
    let card_h = card_w * 1.5;
    let (w, h) = (img.width().max(1) as f32, img.height().max(1) as f32);
    // room for the 1.05 hover scale
    let fit = (card_w * 1.05 / w).max(card_h * 1.05 / h);
    let display = if fit < 1.0 / 1.5 {
        img.resize(
            (w * fit).ceil() as u32,
            (h * fit).ceil() as u32,
            FilterType::CatmullRom,
        )
    } else {
        img
    };
    let backdrop = classics.then(|| {
        let shrink = 4.0;
        let small = display.resize(
            ((display.width() as f32 / shrink).ceil() as u32).max(1),
            ((display.height() as f32 / shrink).ceil() as u32).max(1),
            FilterType::Triangle,
        );
        let phys_per_px = (card_w / display.width() as f32).max(card_h / display.height() as f32);
        let sigma = (16.0 * scale / phys_per_px.max(1e-3) / shrink).max(0.5);
        let mut blurred = small.blur(sigma).to_rgb8();
        crate::library_page::saturate(&mut blurred, 1.1);
        images::to_pixels(DynamicImage::ImageRgb8(blurred), Op::Full)
    });
    (images::to_pixels(display, Op::Full), backdrop)
}

/// Swap a decoded cover into the cards that show it.
fn update_cards_for(url: &str) {
    let Some(ui) = window() else { return };
    let d = data(&ui);
    let (images, library_urls, pinned_urls) = with(|s| {
        let urls = |list: &Vec<Value>| -> Vec<Option<String>> {
            list.iter()
                .map(|g| cover_plan(s, g).map(|(u, _)| u))
                .collect()
        };
        (
            s.covers.get(url).cloned(),
            urls(&s.library),
            urls(&s.pinned),
        )
    });
    let Some((cover, backdrop, natural)) = images else {
        return;
    };
    for (model, urls) in [(d.get_games(), library_urls), (d.get_pinned(), pinned_urls)] {
        for (index, row_url) in urls.iter().enumerate() {
            if row_url.as_deref() == Some(url)
                && let Some(mut row) = model.row_data(index)
            {
                row.cover = cover.clone();
                row.backdrop = backdrop.clone();
                row.natural_width = natural.0;
                row.natural_height = natural.1;
                model.set_row_data(index, row);
            }
        }
    }
}

fn game_at(index: usize, pinned: bool) -> Option<Value> {
    with(|s| {
        if pinned {
            s.pinned.get(index).cloned()
        } else {
            s.library.get(index).cloned()
        }
    })
}

/// buildUserGameDetailsPath: the achievements page (with the user) for
/// subscribers' games that have achievements, else the game page.
fn open_game(index: usize, pinned: bool) {
    let Some(game) = game_at(index, pinned) else {
        return;
    };
    let subscribed = subscribed();
    if !subscribed || num(&game, "achievementCount") as i64 == 0 {
        nav::navigate(&game_details_path(&game));
        return;
    }
    let user_id = with(|s| s.user_id.clone());
    nav::navigate(&format!(
        "/achievements/?title={}&shop={}&objectId={}&userId={}",
        nav::encode(&text(&game, "title")),
        nav::encode(&text(&game, "shop")),
        nav::encode(&text(&game, "objectId")),
        nav::encode(&user_id)
    ));
}

/// The game context menu (own profile only), with the local library entry.
fn game_menu(index: usize, pinned: bool, x: f32, y: f32) {
    if !current().is_some_and(|(_, me)| me) {
        return;
    }
    let Some(game) = game_at(index, pinned) else {
        return;
    };
    let Some(local) = shell::find_library_game(&text(&game, "shop"), &text(&game, "objectId"))
    else {
        return;
    };
    crate::game_menu::show(Rc::new(local), x, y, None);
}

/// onGamesRunning: the own profile's "Playing for …" follows the session.
pub fn on_games_running() {
    let Some(ui) = window() else { return };
    if ui.global::<crate::Nav>().get_route() != "profile" {
        return;
    }
    if let Some(profile) = current_profile()
        && is_me(&profile)
    {
        apply_current_game(&ui, &profile, true);
    }
}

/// "hydra:game-visibility-updated": the own profile reloads (getUserProfile).
pub fn on_visibility_changed() {
    let on_profile = window().is_some_and(|ui| ui.global::<crate::Nav>().get_route() == "profile");
    if on_profile && current().is_some_and(|(_, me)| me) {
        reload();
    }
}

/// "hydra:game-pin-toggled": the pin changed from the context menu.
pub fn on_pin_toggled() {
    if window().is_some_and(|ui| ui.global::<crate::Nav>().get_route() == "profile") {
        load_library(true);
    }
}

// ---- right rail ---------------------------------------------------------

fn apply_rail() {
    let Some(ui) = window() else { return };
    let Some(profile) = with(|s| s.profile.clone()) else {
        return;
    };
    let me = is_me(&profile);
    let lang = language();
    let d = data(&ui);
    let (stats, catalog, has_games, tab) = with(|s| {
        (
            s.stats.clone(),
            s.badge_catalog.clone(),
            !s.library.is_empty() || !s.pinned.is_empty(),
            s.tab,
        )
    });
    let friends = profile
        .get("friends")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    d.set_show_rail(tab != Tab::Missions && (has_games || !friends.is_empty() || me));

    // user-stats-box
    d.set_show_stats(stats.is_some());
    if let Some(stats) = &stats {
        let sum = stats.get("unlockedAchievementSum").filter(|v| !v.is_null());
        d.set_show_achievements_row(me || sum.is_some());
        d.set_achievements_text(
            sum.and_then(Value::as_f64)
                .map(|n| format!("{} {}", n as i64, t("user_profile.achievements")))
                .unwrap_or_default()
                .into(),
        );
        let points = stats
            .get("achievementsPointsEarnedSum")
            .filter(|v| !v.is_null());
        d.set_show_points_row(me || points.is_some());
        d.set_points_text(
            points
                .map(|p| format_number(num(p, "value")))
                .unwrap_or_default()
                .into(),
        );
        d.set_points_percentile(points.map(percentile).unwrap_or_default().into());
        let playtime = stats
            .get("totalPlayTimeInSeconds")
            .cloned()
            .unwrap_or_default();
        d.set_playtime_text(play_time(num(&playtime, "value"), false).into());
        d.set_playtime_percentile(percentile(&playtime).into());
    }
    let karma = if me {
        shell::user_details().and_then(|u| u.get("karma").and_then(Value::as_f64))
    } else {
        profile.get("karma").and_then(Value::as_f64)
    };
    d.set_show_karma(karma.is_some());
    d.set_karma_text(
        karma
            .map(|k| format!("{} {}", format_number(k), t("user_profile.karma_count")))
            .unwrap_or_default()
            .into(),
    );

    // badges-box
    let names: Vec<String> = profile
        .get("badges")
        .and_then(Value::as_array)
        .map(|b| {
            b.iter()
                .filter_map(|n| n.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let unlock_dates: HashMap<String, String> = profile
        .get("badgesDetails")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .map(|b| (text(b, "badge"), text(b, "unlockedAt")))
                .collect()
        })
        .unwrap_or_default();
    let make = |name: &String| -> Option<ProfileBadge> {
        let badge = catalog.iter().find(|b| text(b, "name") == *name)?;
        let url = badge
            .get("badge")
            .and_then(|b| b.get("url"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        Some(ProfileBadge {
            title: text(badge, "title").into(),
            description: text(badge, "description").into(),
            icon: image_for(&url, 32.0),
            unlocked_on: unlock_dates
                .get(name)
                .and_then(|d| hydra_core::library::parse_iso_millis(d))
                .map(|ms| {
                    shell::tr_with(
                        "user_profile.badge_unlocked_on",
                        &[("date", Arg::Text(hydra_i18n::date::format_date(&lang, ms)))],
                    )
                })
                .unwrap_or_default()
                .into(),
        })
    };
    // userProfile.badges.slice(0, 4), each looked up in the catalogue
    let visible: Vec<ProfileBadge> = names
        .iter()
        .take(profile::MAX_VISIBLE_BADGES)
        .filter_map(make)
        .collect();
    let badge_rows: Vec<ProfileBadge> = names.iter().filter_map(make).collect();
    d.set_badges(ModelRc::new(VecModel::from(visible)));
    d.set_all_badges(ModelRc::new(VecModel::from(badge_rows)));
    d.set_badges_count(names.len() as i32);
    d.set_badges_more(names.len() > profile::MAX_VISIBLE_BADGES);

    // recent-games-box
    let recent: Vec<ProfileRecentGame> = profile
        .get("recentGames")
        .and_then(Value::as_array)
        .map(|games| {
            games
                .iter()
                .map(|g| ProfileRecentGame {
                    title: text(g, "title").into(),
                    icon: image_for(&text(g, "iconUrl"), 32.0),
                    playtime: play_time(num(g, "playTimeInSeconds"), false).into(),
                    hidden_from_others: flag(g, "isHiddenFromOthers"),
                    concealed: flag(g, "isConcealed"),
                })
                .collect()
        })
        .unwrap_or_default();
    d.set_recent(ModelRc::new(VecModel::from(recent)));

    // friends-box
    d.set_show_friends(!friends.is_empty() || me);
    d.set_friends_count(
        stats
            .as_ref()
            .and_then(|s| s.get("friendsCount"))
            .and_then(Value::as_i64)
            .filter(|n| *n > 0)
            .unwrap_or(friends.len() as i64) as i32,
    );
    d.set_friends_more(friends.len() > profile::MAX_VISIBLE_FRIENDS);
    let rows: Vec<ProfileFriend> = friends
        .iter()
        .take(profile::MAX_VISIBLE_FRIENDS)
        .map(|f| friend_row(f, 32.0))
        .collect();
    d.set_friends(ModelRc::new(VecModel::from(rows)));
}

/// top_percentile with the API's number as JS prints it.
fn percentile(value: &Value) -> String {
    let p = num(value, "topPercentile");
    let shown = if p.fract() == 0.0 {
        format!("{}", p as i64)
    } else {
        format!("{p}")
    };
    shell::tr_with(
        "user_profile.top_percentile",
        &[("percentile", Arg::Text(shown))],
    )
}

pub fn friend_row(friend: &Value, size: f32) -> ProfileFriend {
    let game = friend.get("currentGame").filter(|g| g.is_object());
    let game_icon = game
        .and_then(|g| opt_text(g, "iconUrl"))
        .map(str::to_string);
    ProfileFriend {
        id: text(friend, "id").into(),
        name: text(friend, "displayName").into(),
        has_avatar: opt_text(friend, "profileImageUrl").is_some(),
        avatar: image_for(&text(friend, "profileImageUrl"), size),
        game: game.map(|g| text(g, "title")).unwrap_or_default().into(),
        has_game_icon: game_icon.is_some(),
        game_icon: game_icon
            .map(|url| image_for(&url, 16.0))
            .unwrap_or_default(),
    }
}

/// A small remote image (icons, avatars, badges) at `size` CSS px; the rows
/// that use it are refreshed when it arrives.
pub fn image_for(url: &str, size: f32) -> Image {
    if url.is_empty() {
        return Image::default();
    }
    if let Some(image) = with(|s| s.images.get(url).cloned()) {
        return image;
    }
    let Some((loader, scale)) = shell::loader() else {
        return Image::default();
    };
    with(|s| s.images.insert(url.to_string(), Image::default()));
    let key = url.to_string();
    loader.load(
        url.to_string(),
        Op::MaxWidth((size * scale).ceil() as u32),
        move |img| {
            with(|s| s.images.insert(key.clone(), img));
            apply_rail();
            crate::profile_modals::on_image_loaded();
            crate::profile_souvenirs::apply();
        },
    );
    Image::default()
}

// ---- reviews ------------------------------------------------------------

fn rating_text(score: i64) -> String {
    let key = match score {
        1 => "rating_very_negative",
        2 => "rating_negative",
        3 => "rating_neutral",
        4 => "rating_positive",
        5 => "rating_very_positive",
        _ => return String::new(),
    };
    t(&format!("game_details.{key}"))
}

/// Intl.DisplayNames(language).of(code), for the languages reviews come in.
fn language_display_name(code: &str, ui_language: &str) -> String {
    let base = code.split('-').next().unwrap_or(code).to_ascii_lowercase();
    if ui_language.starts_with("en") {
        let name = match base.as_str() {
            "en" => "English",
            "pt" => "Portuguese",
            "es" => "Spanish",
            "fr" => "French",
            "de" => "German",
            "it" => "Italian",
            "ru" => "Russian",
            "pl" => "Polish",
            "tr" => "Turkish",
            "uk" => "Ukrainian",
            "zh" => "Chinese",
            "ja" => "Japanese",
            "ko" => "Korean",
            "ar" => "Arabic",
            "nl" => "Dutch",
            "cs" => "Czech",
            "hu" => "Hungarian",
            "ro" => "Romanian",
            "sv" => "Swedish",
            "id" => "Indonesian",
            "vi" => "Vietnamese",
            _ => "",
        };
        if !name.is_empty() {
            return name.to_string();
        }
    }
    hydra_i18n::language_name(&base).unwrap_or_else(|| base.to_ascii_uppercase())
}

/// sanitizeHtml(reviewHtml) -> markdown blocks for StyledText.
fn review_markdown(html: &str) -> StyledText {
    use hydra_store::html::Block;
    let blocks = hydra_store::html::about_to_blocks(html);
    let mut lines = Vec::new();
    for block in blocks {
        match block {
            Block::Heading(text) | Block::Paragraph(text) => lines.push(text),
            Block::Bullet(text) => lines.push(format!("- {text}")),
            Block::Spacer => lines.push(String::new()),
            Block::Image(_) => {}
        }
    }
    let markdown = lines.join("\n\n");
    StyledText::from_markdown(&markdown).unwrap_or_else(|_| StyledText::from_plain_text(&markdown))
}

fn apply_reviews() {
    let Some(ui) = window() else { return };
    let me = signed_in_user_id();
    let lang = language();
    let base = |l: &str| l.split('-').next().unwrap_or_default().to_ascii_lowercase();
    let (rows, total, loading) = with(|s| {
        let voting = s.voting.clone();
        let rows: Vec<ProfileReview> = s
            .reviews
            .iter()
            .map(|review| {
                let r = &review.raw;
                let id = text(r, "id");
                let own = me.as_deref()
                    == r.get("user")
                        .and_then(|u| u.get("id"))
                        .and_then(Value::as_str);
                let detected = opt_text(r, "detectedLanguage").unwrap_or_default();
                let translation = (!own && base(detected) != base(&lang))
                    .then(|| {
                        r.get("translations")
                            .and_then(|t| t.get(base(&lang)))
                            .and_then(Value::as_str)
                            .filter(|t| !t.is_empty())
                    })
                    .flatten();
                let html = text(r, "reviewHtml");
                let seconds = num(r, "playTimeInSeconds");
                let created = hydra_core::library::parse_iso_millis(&text(r, "createdAt"))
                    .unwrap_or_default();
                let game = r.get("game").cloned().unwrap_or_default();
                ProfileReview {
                    id: id.as_str().into(),
                    game_title: text(&game, "title").into(),
                    game_icon: review.icon.clone(),
                    date: hydra_i18n::date::format_distance(&lang, created, chrono_now_ms(), true)
                        .into(),
                    score: num(r, "score") as i32,
                    rating_text: rating_text(num(r, "score") as i64).into(),
                    playtime: if seconds > 0.0 {
                        play_time(seconds, false).into()
                    } else {
                        SharedString::default()
                    },
                    content: review_markdown(translation.unwrap_or(&html)),
                    original: review_markdown(&html),
                    translation_label: if translation.is_some() {
                        shell::tr_with(
                            "game_details.show_original_translated_from",
                            &[(
                                "language",
                                Arg::Text(language_display_name(detected, &lang)),
                            )],
                        )
                        .into()
                    } else {
                        SharedString::default()
                    },
                    hide_original_label: t("game_details.hide_original").into(),
                    show_original: review.show_original,
                    upvotes: review.upvotes as i32,
                    downvotes: review.downvotes as i32,
                    prev_upvotes: review.prev_upvotes as i32,
                    prev_downvotes: review.prev_downvotes as i32,
                    up_gen: review.up_gen,
                    down_gen: review.down_gen,
                    has_upvoted: review.has_upvoted,
                    has_downvoted: review.has_downvoted,
                    voting: voting.contains(&id),
                    own,
                }
            })
            .collect();
        (rows, s.reviews_total, s.reviews_loading)
    });
    let d = data(&ui);
    d.set_reviews_loading(loading);
    d.set_reviews_count(total as i32);
    // In place when the list is the same, so the vote animations keep their state.
    let model = d.get_reviews();
    if model.row_count() == rows.len()
        && rows
            .iter()
            .enumerate()
            .all(|(i, r)| model.row_data(i).is_some_and(|m| m.id == r.id))
    {
        for (index, row) in rows.into_iter().enumerate() {
            model.set_row_data(index, row);
        }
    } else {
        d.set_reviews(ModelRc::new(VecModel::from(rows)));
    }
}

/// The review icons (24px); Epic games ask getGameAssets for theirs.
fn load_review_icons(generation: u64) {
    let Some((loader, scale)) = shell::loader() else {
        return;
    };
    let urls: Vec<(String, String)> = with(|s| {
        s.reviews
            .iter()
            .map(|r| {
                let game = r.raw.get("game").cloned().unwrap_or_default();
                (text(&r.raw, "id"), text(&game, "iconUrl"))
            })
            .collect()
    });
    for (id, url) in urls {
        if url.is_empty() {
            continue;
        }
        loader.load(
            resolve_source(&url),
            Op::MaxWidth((24.0 * scale).ceil() as u32),
            move |img| {
                if with(|s| s.generation) != generation {
                    return;
                }
                with(|s| {
                    if let Some(review) = s.reviews.iter_mut().find(|r| text(&r.raw, "id") == id) {
                        review.icon = img;
                    }
                });
                apply_reviews();
            },
        );
    }
}

/// handleVoteReview: optimistic counts, PUT …/upvote|downvote, rollback on error.
fn vote_review(id: &str, up: bool) {
    if !shell::signed_in() {
        if let Some(ui) = window() {
            ui.global::<Session>().invoke_sign_in();
        }
        return;
    }
    let Some(api) = shell::api() else { return };
    let before = with(|s| {
        if s.voting.contains(id) {
            return None;
        }
        let review = s.reviews.iter_mut().find(|r| text(&r.raw, "id") == id)?;
        let before = (
            review.upvotes,
            review.downvotes,
            review.has_upvoted,
            review.has_downvoted,
        );
        let (was_up, was_down) = (review.has_upvoted, review.has_downvoted);
        let (mut upvotes, mut downvotes) = (review.upvotes, review.downvotes);
        let (mut has_up, mut has_down) = (was_up, was_down);
        if up {
            if was_up {
                upvotes -= 1;
                has_up = false;
            } else {
                upvotes += 1;
                has_up = true;
                if was_down {
                    downvotes -= 1;
                    has_down = false;
                }
            }
        } else if was_down {
            downvotes -= 1;
            has_down = false;
        } else {
            downvotes += 1;
            has_down = true;
            if was_up {
                upvotes -= 1;
                has_up = false;
            }
        }
        set_votes(review, upvotes, downvotes, has_up, has_down);
        let game = review.raw.get("game").cloned().unwrap_or_default();
        s.voting.insert(id.to_string());
        Some((before, text(&game, "shop"), text(&game, "objectId")))
    });
    let Some((before, shop, object_id)) = before else {
        return;
    };
    apply_reviews();
    let id = id.to_string();
    let endpoint = if up { "upvote" } else { "downvote" };
    std::thread::spawn(move || {
        let result = api.put(
            &format!("/games/{shop}/{object_id}/reviews/{id}/{endpoint}"),
            &Value::Null,
            Options::default(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            if let Err(error) = result {
                eprintln!("Failed to vote on review: {error}");
                with(|s| {
                    if let Some(review) = s.reviews.iter_mut().find(|r| text(&r.raw, "id") == id) {
                        set_votes(review, before.0, before.1, before.2, before.3);
                    }
                });
                apply_reviews();
            }
            // the buttons unlock 500ms after the request settles
            slint::Timer::single_shot(std::time::Duration::from_millis(500), move || {
                with(|s| s.voting.remove(&id));
                apply_reviews();
            });
        });
    });
}

fn set_votes(review: &mut Review, upvotes: i64, downvotes: i64, has_up: bool, has_down: bool) {
    if upvotes != review.upvotes {
        review.prev_upvotes = review.upvotes;
        review.up_gen += 1;
    }
    if downvotes != review.downvotes {
        review.prev_downvotes = review.downvotes;
        review.down_gen += 1;
    }
    review.upvotes = upvotes;
    review.downvotes = downvotes;
    review.has_upvoted = has_up;
    review.has_downvoted = has_down;
}

/// DeleteReviewModal, then DELETE /games/{shop}/{objectId}/reviews/{id}.
fn delete_review(id: &str) {
    let id = id.to_string();
    let t = shell::tr;
    crate::dialogs::confirm(
        crate::dialogs::Confirm {
            title: &t("game_details.delete_review_modal_title"),
            description: &t("game_details.delete_review_modal_description"),
            body: "",
            confirm_label: &t("game_details.delete_review_modal_delete_button"),
            cancel_label: &t("game_details.delete_review_modal_cancel_button"),
            danger: true,
        },
        move || {
            crate::dialogs::close();
            let Some(api) = shell::api() else { return };
            let Some(game) = with(|s| {
                s.reviews
                    .iter()
                    .find(|r| text(&r.raw, "id") == id)
                    .and_then(|r| r.raw.get("game").cloned())
            }) else {
                return;
            };
            let id = id.clone();
            std::thread::spawn(move || {
                let result = api.delete(
                    &format!(
                        "/games/{}/{}/reviews/{id}",
                        text(&game, "shop"),
                        text(&game, "objectId")
                    ),
                    Options::default(),
                );
                let _ = slint::invoke_from_event_loop(move || match result {
                    Ok(_) => {
                        with(|s| {
                            s.reviews.retain(|r| text(&r.raw, "id") != id);
                            s.reviews_total -= 1;
                        });
                        apply_reviews();
                    }
                    Err(error) => eprintln!("Failed to delete review: {error}"),
                });
            });
        },
    );
}
