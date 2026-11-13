//! pages/achievements: a game's achievements with the banner, summaries,
//! search, status filter and sorting (achievements.tsx,
//! achievements-content.tsx, achievement-list.tsx), achievement sets with
//! collapsible headers (achievement-set-header.tsx), souvenir thumbnails and
//! their lightbox, hardcore badges, and another user's achievements
//! (`?userId=`) with the comparison (compared-achievement-list.tsx).
//!
//! Not ported: the RetroAchievements connect banner in the toolbar, the
//! Hydra Cloud modal (non-subscribers get a TODO instead of comparing), the
//! comparison grid's narrow (container query) layout.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use hydra_core::achievement_compare::{Compared, Filter};
use hydra_core::achievement_list::{self, Entry, Sort, Status};
use hydra_core::achievements::Achievement;
use hydra_media::images::Op;
use serde_json::Value;
use slint::{ComponentHandle, Image, ModelRc, VecModel};

use crate::{AchievementRow, AchievementsData, AppWindow, Session, nav, shell};

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    generation: u64,
    shop: String,
    object_id: String,
    title: String,
    /// the signed-in user's achievements (gameDetailsContext.achievements)
    achievements: Vec<Achievement>,
    own_loaded: bool,
    /// another user's page (`userId`), and the comparison with them
    user_id: Option<String>,
    compared: Option<Compared>,
    /// the compared target's list (getComparedTargetAchievements)
    target: Vec<Achievement>,
    comparing: bool,
    search: String,
    status: String,
    sort: String,
    filter: String,
    revealed: HashSet<String>,
    last_revealed: Option<String>,
    collapsed: HashSet<String>,
    /// the list entries shown, in display order
    entries: Vec<Entry>,
    range: (usize, usize),
    icons: HashMap<String, Image>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn app() -> Option<AppWindow> {
    with(|s| s.ui.upgrade())
}

fn language() -> String {
    shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into())
}

fn my_id() -> String {
    shell::user_details()
        .and_then(|u| u.get("id").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_default()
}

/// The list the page shows: the user's own, or the other user's.
fn list(s: &State) -> &[Achievement] {
    if s.user_id.is_some() {
        &s.target
    } else {
        &s.achievements
    }
}

/// Whether the viewer (the signed-in user) unlocked this row: their own
/// list, or the comparison's owner stats on another user's page.
fn viewer_unlocked(s: &State, a: &Achievement) -> bool {
    match &s.compared {
        Some(compared) if s.user_id.is_some() => a
            .name
            .parse::<usize>()
            .is_ok_and(|index| compared.owner_unlocked(index)),
        _ => a.unlocked,
    }
}

fn reset_list_state(s: &mut State) {
    s.search.clear();
    s.status = "all".into();
    s.sort = "most_common".into();
    s.filter = "all".into();
    s.revealed.clear();
    s.last_revealed = None;
    s.collapsed.clear();
    s.range = (0, 12);
}

pub fn init(ui: &AppWindow) {
    with(|s| {
        s.ui = ui.as_weak();
        s.range = (0, 12);
    });
    let data = ui.global::<AchievementsData>();
    data.on_search_edited(|text| {
        with(|s| s.search = text.to_string());
        apply();
    });
    data.on_set_status(|status| {
        with(|s| s.status = status.to_string());
        apply();
    });
    data.on_set_sort(|sort| {
        with(|s| s.sort = sort.to_string());
        apply();
    });
    data.on_set_filter(|filter| {
        with(|s| s.filter = filter.to_string());
        apply();
    });
    data.on_reveal(|key| {
        with(|s| {
            s.revealed.insert(key.to_string());
            s.last_revealed = Some(key.to_string());
        });
        apply();
    });
    data.on_toggle_set(|key| {
        with(|s| {
            let key = key.to_string();
            if !s.collapsed.remove(&key) {
                s.collapsed.insert(key);
            }
        });
        apply();
    });
    data.on_toggle_compare(toggle_compare);
    data.on_open_game(|| {
        let (shop, object_id, title) =
            with(|s| (s.shop.clone(), s.object_id.clone(), s.title.clone()));
        nav::navigate(&format!(
            "/game/{shop}/{object_id}?title={}",
            nav::encode(&title)
        ));
    });
    data.on_hydra_cloud(|| eprintln!("TODO(cloud): showHydraCloudModal(\"achievements-points\")"));
    data.on_visible_rows(|first, last| {
        with(|s| s.range = (first.max(0) as usize, last.max(0) as usize));
        load_icons();
    });
    data.on_open_souvenir(|key| open_souvenir(&key));
    data.on_close_souvenir(|| {
        if let Some(ui) = app() {
            let data = ui.global::<AchievementsData>();
            data.set_souvenir_open(false);
            data.set_souvenir(Image::default());
        }
    });
}

/// handleCompareClick: non-subscribers get the Hydra Cloud modal instead.
fn toggle_compare() {
    let Some(ui) = app() else { return };
    let comparing = with(|s| s.comparing);
    if !comparing && !ui.global::<Session>().get_has_subscription() {
        eprintln!("TODO(cloud): showHydraCloudModal(\"achievements\")");
        return;
    }
    with(|s| {
        s.comparing = !comparing;
        // the other list component mounts with its own state
        reset_list_state(s);
    });
    let data = ui.global::<AchievementsData>();
    data.set_search("".into());
    data.set_comparing(!comparing);
    apply();
}

/// The /achievements route (title, shop, objectId, userId).
pub fn open(shop: &str, object_id: &str, title: &str, user_id: Option<&str>) {
    let me = my_id();
    // otherUserId: the page is someone else's unless the id is ours
    let other = user_id
        .filter(|id| !id.is_empty() && *id != me)
        .map(str::to_string);
    let generation = with(|s| {
        s.generation += 1;
        s.shop = shop.to_string();
        s.object_id = object_id.to_string();
        s.title = title.to_string();
        s.achievements.clear();
        s.own_loaded = false;
        s.user_id = other.clone();
        s.compared = None;
        s.target.clear();
        s.comparing = false;
        reset_list_state(s);
        s.generation
    });
    let Some(app) = app() else { return };
    let data = app.global::<AchievementsData>();
    data.set_loading(true);
    data.set_search("".into());
    data.set_game_title(title.into());
    data.set_hero(Image::default());
    data.set_logo(Image::default());
    data.set_has_logo(false);
    data.set_rows(ModelRc::default());
    data.set_other_user(other.is_some());
    data.set_comparing(false);
    data.set_other_avatar(Image::default());
    data.set_other_name("".into());
    data.set_souvenir_open(false);
    let session = app.global::<Session>();
    data.set_signed_in(session.get_signed_in());
    data.set_subscriber(session.get_has_subscription());
    apply();
    load_artwork(shop, object_id, generation);
    let (Some(api), Some(db)) = (shell::api(), shell::db()) else {
        return;
    };
    crate::achievement_watcher::viewing("achievements", shop, object_id);
    {
        let (api, db) = (api.clone(), db.clone());
        let (shop, object_id) = (shop.to_string(), object_id.to_string());
        std::thread::spawn(move || {
            let result = crate::achievement_watcher::sync_and_get(&api, &db, &shop, &object_id);
            let _ = slint::invoke_from_event_loop(move || {
                if with(|s| s.generation) != generation {
                    return;
                }
                match result {
                    Ok(list) => with(|s| s.achievements = list),
                    Err(error) => eprintln!("achievements: {error}"),
                }
                with(|s| s.own_loaded = true);
                apply();
            });
        });
    }
    // getComparedUnlockedAchievements
    if let Some(user_id) = other {
        let (shop, object_id) = (shop.to_string(), object_id.to_string());
        std::thread::spawn(move || {
            crate::achievement_watcher::first_sync(&shop, &object_id);
            let result = hydra_core::achievement_compare::compared(
                &api,
                &db,
                hydra_core::achievement_store::memory(),
                &shop,
                &object_id,
                &user_id,
            );
            let _ = slint::invoke_from_event_loop(move || {
                if with(|s| s.generation) != generation {
                    return;
                }
                match result {
                    Ok(compared) => set_compared(compared, generation),
                    Err(error) => eprintln!("achievements: compare: {error}"),
                }
            });
        });
    }
}

fn set_compared(compared: Compared, generation: u64) {
    let picture = compared.target_picture.clone();
    let Some(ui) = app() else { return };
    let data = ui.global::<AchievementsData>();
    data.set_other_name(compared.target_name.clone().into());
    data.set_has_owner_stats(compared.has_owner_stats());
    data.set_has_community_stats(
        compared
            .rows
            .iter()
            .any(|r| r.points.is_some() || r.global_unlock_percentage.is_some()),
    );
    data.set_points_total(compared.points_total.to_string().into());
    data.set_owner_points(compared.owner.points.unwrap_or(0).to_string().into());
    data.set_target_points(compared.target.points.unwrap_or(0).to_string().into());
    data.set_other_unlocked(compared.target.unlocked as i32);
    data.set_other_total(compared.target.total as i32);
    data.set_other_percent(percent(compared.target.unlocked, compared.target.total).into());
    data.set_owner_unlocked(compared.owner.unlocked as i32);
    data.set_owner_total(compared.owner.total as i32);
    data.set_owner_percent(percent(compared.owner.unlocked, compared.owner.total).into());
    with(|s| {
        s.target = compared.target_achievements();
        s.compared = Some(compared);
    });
    apply();
    if let (Some(url), Some((loader, scale))) = (picture, shell::loader()) {
        loader.load(
            url,
            Op::MaxWidth((64.0 * scale).ceil() as u32),
            move |img| {
                if with(|s| s.generation) == generation
                    && let Some(ui) = app()
                {
                    ui.global::<AchievementsData>().set_other_avatar(img);
                }
            },
        );
    }
}

/// formatDownloadProgress(unlocked / total)
fn percent(unlocked: i64, total: i64) -> String {
    if total > 0 {
        crate::downloads_page::format_progress(unlocked as f64 / total as f64, 2)
    } else {
        "0%".into()
    }
}

/// on-update-achievements-${objectId}-${shop}: the watcher merged new unlocks.
pub fn on_achievements_updated(shop: &str, object_id: &str, list: Vec<Achievement>) {
    let current = with(|s| s.shop == shop && s.object_id == object_id);
    if !current {
        return;
    }
    with(|s| s.achievements = list);
    apply();
}

/// heroImage / logoImage: the custom artwork, else the shop assets.
fn load_artwork(shop: &str, object_id: &str, generation: u64) {
    let db = shell::db();
    let key = hydra_db::keys::game(shop, object_id);
    let game: Option<Value> = db
        .as_ref()
        .and_then(|db| db.get_in(hydra_db::keys::GAMES, &key));
    let stored: Option<Value> = db
        .as_ref()
        .and_then(|db| db.get_in(hydra_db::keys::GAME_SHOP_ASSETS, &key));
    let field = |v: &Option<Value>, k: &str| {
        v.as_ref()
            .and_then(|v| v.get(k))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let custom_hero = field(&game, "customHeroImageUrl");
    let custom_logo = field(&game, "customLogoImageUrl");
    let stored_hero = field(&stored, "libraryHeroImageUrl");
    let stored_logo = field(&stored, "logoImageUrl");
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    std::thread::spawn(move || {
        let (mut hero, mut logo) = (custom_hero.or(stored_hero), custom_logo.or(stored_logo));
        if hero.is_none() || logo.is_none() {
            let api = hydra_core::config::api_url();
            if let Some(assets) = hydra_store::steam::hydra_assets(
                &hydra_store::http_client(),
                &api,
                &shop,
                &object_id,
            ) {
                hero = hero.or(assets.hero);
                logo = logo.or(assets.logo);
            }
        }
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation {
                return;
            }
            let Some((loader, scale)) = shell::loader() else {
                return;
            };
            if let Some(url) = hero {
                loader.load(
                    url,
                    Op::MaxWidth((1200.0 * scale).ceil() as u32),
                    move |img| {
                        if with(|s| s.generation) == generation
                            && let Some(ui) = app()
                        {
                            ui.global::<AchievementsData>().set_hero(img);
                        }
                    },
                );
            }
            if let Some(url) = logo {
                if let Some(ui) = app() {
                    ui.global::<AchievementsData>().set_has_logo(true);
                }
                loader.load(
                    url,
                    Op::MaxWidth((200.0 * scale).ceil() as u32),
                    move |img| {
                        if with(|s| s.generation) == generation
                            && let Some(ui) = app()
                        {
                            ui.global::<AchievementsData>().set_logo(img);
                        }
                    },
                );
            }
        });
    });
}

/// The icon's cache key: the color icon, the gray one, or (when the list has
/// no gray icon, like a comparison) `gray:<icon>` decoded with `grayscale(100%)`.
fn icon_url(a: &Achievement, unlocked: bool) -> String {
    if unlocked {
        a.icon.clone()
    } else if !a.icon_gray.is_empty() && a.icon_gray != a.icon {
        a.icon_gray.clone()
    } else if a.icon.is_empty() {
        String::new()
    } else {
        format!("gray:{}", a.icon)
    }
}

/// The souvenir, only on unlocked rows.
fn souvenir_url(a: &Achievement) -> Option<String> {
    a.image_url.clone().filter(|u| a.unlocked && !u.is_empty())
}

/// useAchievementSetName
fn set_name(set: &Option<hydra_core::achievements::AchievementSet>) -> String {
    match set {
        None => shell::tr("achievement.achievement_set_other"),
        Some(set) => set
            .name
            .clone()
            .unwrap_or_else(|| shell::tr("achievement.achievement_set_base_game")),
    }
}

fn apply() {
    let Some(ui) = app() else { return };
    let data = ui.global::<AchievementsData>();
    let show_hidden = shell::preference("showHiddenAchievementsDescription");
    let language = language();
    let owner_name = ui.global::<Session>().get_display_name().to_string();
    let format_time = |t: i64| hydra_i18n::date::format_achievement_unlock(&language, t);
    let (rows, counts, comparison_counts, points, unlocked, total, loading) = with(|s| {
        let list = list(s);
        let comparing = s.comparing && s.compared.is_some();
        let concealed = |a: &Achievement| {
            achievement_list::is_concealed(
                &Achievement {
                    unlocked: viewer_unlocked(s, a),
                    hidden: a.hidden,
                    ..Achievement::default()
                },
                show_hidden,
            ) && !s.revealed.contains(achievement_list::key(a))
        };
        // the comparison filter applies before search and sort
        let filter = Filter::parse(&s.filter);
        let candidates: Vec<Achievement> = if comparing {
            list.iter()
                .filter(|a| filter.matches(viewer_unlocked(s, a), a.unlocked))
                .cloned()
                .collect()
        } else {
            list.to_vec()
        };
        let candidate_index: Vec<usize> = if comparing {
            (0..list.len())
                .filter(|&i| filter.matches(viewer_unlocked(s, &list[i]), list[i].unlocked))
                .collect()
        } else {
            (0..list.len()).collect()
        };
        let visible: Vec<usize> = achievement_list::filter_and_sort(
            &candidates,
            &s.search,
            if comparing {
                Status::All
            } else {
                Status::parse(&s.status)
            },
            Sort::parse(&s.sort),
            concealed,
        )
        .into_iter()
        .map(|i| candidate_index[i])
        .collect();
        let groups = achievement_list::group_by_set(list);
        let sets = groups
            .as_ref()
            .map(|g| achievement_list::visible_sets(g, &visible, list, |a| a.unlocked));
        let entries = achievement_list::list_entries(sets.as_deref(), &visible, &s.collapsed);
        let rows: Vec<AchievementRow> = entries
            .iter()
            .enumerate()
            .map(|(position, entry)| match *entry {
                Entry::Set { set, expanded } => {
                    let set = &sets.as_ref().unwrap()[set];
                    let progress = if set.total > 0 {
                        set.unlocked as f32 / set.total as f32
                    } else {
                        0.0
                    };
                    let owner_count = groups
                        .as_ref()
                        .and_then(|g| g.iter().find(|g| g.key == set.key))
                        .map(|g| {
                            g.members
                                .iter()
                                .filter(|&&i| viewer_unlocked(s, &list[i]))
                                .count()
                        })
                        .unwrap_or(0);
                    AchievementRow {
                        is_set: true,
                        key: set.key.clone().into(),
                        set_name: set_name(&set.set).into(),
                        set_count: format!("{} / {}", set.unlocked, set.total).into(),
                        set_progress: progress,
                        set_percent: percent(set.unlocked as i64, set.total as i64).into(),
                        set_completed: set.total > 0 && set.unlocked >= set.total,
                        set_expanded: expanded,
                        spaced: position > 0,
                        owner_set_count: format!("{owner_count} / {}", set.total).into(),
                        ..AchievementRow::default()
                    }
                }
                Entry::Achievement(i) => {
                    let a = &list[i];
                    let key = achievement_list::key(a).to_string();
                    let owner = viewer_unlocked(s, a);
                    let shown_unlocked = if comparing {
                        owner || a.unlocked
                    } else {
                        a.unlocked
                    };
                    let owner_time = s
                        .compared
                        .as_ref()
                        .and_then(|c| c.rows.get(a.name.parse::<usize>().ok()?))
                        .and_then(|r| r.owner.as_ref())
                        .filter(|o| o.unlocked)
                        .map(|o| format_time(o.unlock_time))
                        .unwrap_or_default();
                    let target_time = a.unlock_time.map(format_time).unwrap_or_default();
                    let target_name = s
                        .compared
                        .as_ref()
                        .map(|c| c.target_name.clone())
                        .unwrap_or_default();
                    let tip = |name: &str, unlocked: bool, time: &str| {
                        if unlocked {
                            shell::tr_with(
                                "achievement.compare_unlocked_by",
                                &[("name", name.into()), ("date", time.into())],
                            )
                        } else {
                            shell::tr_with(
                                "achievement.compare_locked_for",
                                &[("name", name.into())],
                            )
                        }
                    };
                    AchievementRow {
                        concealed: concealed(a),
                        hidden_marker: a.hidden && !owner,
                        revealed: s.last_revealed.as_deref() == Some(key.as_str()),
                        title: a.display_name.clone().into(),
                        description: a.description.clone().into(),
                        unlock_time: if comparing {
                            Default::default()
                        } else {
                            target_time.clone().into()
                        },
                        unlocked: if comparing {
                            shown_unlocked
                        } else {
                            a.unlocked
                        },
                        icon: s
                            .icons
                            .get(&icon_url(a, shown_unlocked))
                            .cloned()
                            .unwrap_or_default(),
                        percentage: a
                            .global_unlock_percentage
                            .map(|p| achievement_list::format_percentage(p, &language))
                            .unwrap_or_default()
                            .into(),
                        points: a.points.map(|p| p.to_string()).unwrap_or_default().into(),
                        hardcore: a
                            .hardcore_unlock_time
                            .filter(|_| !comparing)
                            .map(|t| {
                                shell::tr_with(
                                    "achievement.hardcore_unlocked_at",
                                    &[("date", format_time(t).into())],
                                )
                            })
                            .unwrap_or_default()
                            .into(),
                        has_souvenir: !comparing && souvenir_url(a).is_some(),
                        souvenir: souvenir_url(a)
                            .and_then(|u| s.icons.get(&u).cloned())
                            .unwrap_or_default(),
                        owner_unlocked: owner,
                        owner_time: owner_time.clone().into(),
                        owner_tip: tip(&owner_name, owner, &owner_time).into(),
                        target_unlocked: a.unlocked,
                        target_time: target_time.clone().into(),
                        target_tip: tip(&target_name, a.unlocked, &target_time).into(),
                        key: key.into(),
                        ..AchievementRow::default()
                    }
                }
            })
            .collect();
        let counts = achievement_list::status_counts(list);
        // getAchievementComparisonCounts
        let flags: Vec<(bool, bool)> = list
            .iter()
            .map(|a| (viewer_unlocked(s, a), a.unlocked))
            .collect();
        let count = |f: Filter| flags.iter().filter(|(o, t)| f.matches(*o, *t)).count();
        let comparison_counts = (
            count(Filter::Both),
            count(Filter::Neither),
            count(Filter::Owner),
            count(Filter::Target),
        );
        // pointsSummary: the other user's earned points out of the game's total
        let points = match (&s.compared, s.user_id.is_some()) {
            (Some(c), true) => format!("{} / {}", c.target.points.unwrap_or(0), c.points_total),
            _ => {
                let earned: i64 = list
                    .iter()
                    .filter(|a| a.unlocked)
                    .filter_map(|a| a.points)
                    .sum();
                let total_points: i64 = list.iter().filter_map(|a| a.points).sum();
                format!("{earned} / {total_points}")
            }
        };
        let own_unlocked = s.achievements.iter().filter(|a| a.unlocked).count();
        let loading = !s.own_loaded || (s.user_id.is_some() && s.compared.is_none());
        s.entries = entries;
        (
            rows,
            counts,
            comparison_counts,
            points,
            own_unlocked,
            s.achievements.len(),
            loading,
        )
    });
    data.set_loading(loading);
    data.set_status(with(|s| s.status.clone()).into());
    data.set_sort(with(|s| s.sort.clone()).into());
    data.set_filter(with(|s| s.filter.clone()).into());
    data.set_count_all(counts.0 as i32);
    data.set_count_unlocked(counts.1 as i32);
    data.set_count_locked(counts.2 as i32);
    data.set_count_both(comparison_counts.0 as i32);
    data.set_count_neither(comparison_counts.1 as i32);
    data.set_count_owner(comparison_counts.2 as i32);
    data.set_count_target(comparison_counts.3 as i32);
    data.set_points(points.into());
    data.set_unlocked(unlocked as i32);
    data.set_total(total as i32);
    data.set_percent(percent(unlocked as i64, total as i64).into());
    data.set_rows(ModelRc::new(VecModel::from(rows)));
    load_icons();
}

/// What a row needs to load: its icon (gray when locked for the viewer) and souvenir.
fn wanted_urls(s: &State, entry: &Entry) -> Vec<String> {
    let Entry::Achievement(i) = *entry else {
        return Vec::new();
    };
    let list = list(s);
    let Some(a) = list.get(i) else {
        return Vec::new();
    };
    let unlocked = if s.comparing {
        viewer_unlocked(s, a) || a.unlocked
    } else {
        a.unlocked
    };
    std::iter::once(icon_url(a, unlocked))
        .chain(souvenir_url(a).filter(|_| !s.comparing))
        .collect()
}

/// Icons and souvenirs for the rows on screen (and a few around them).
fn load_icons() {
    let Some((loader, scale)) = shell::loader() else {
        return;
    };
    let wanted: Vec<(String, bool)> = with(|s| {
        let (first, last) = s.range;
        let souvenirs: HashSet<String> = list(s).iter().filter_map(souvenir_url).collect();
        s.entries
            .iter()
            .skip(first)
            .take(last.saturating_sub(first) + 1)
            .flat_map(|e| wanted_urls(s, e))
            .filter(|url| !url.is_empty() && !s.icons.contains_key(url))
            .map(|url| {
                let souvenir = souvenirs.contains(&url);
                (url, souvenir)
            })
            .collect()
    });
    for (key, souvenir) in wanted {
        with(|s| s.icons.insert(key.clone(), Image::default()));
        // .achievements__item-image 64px; __item-souvenir-image 120x64 (cover)
        let width = if souvenir { 120.0 } else { 64.0 };
        let (url, op) = match key.strip_prefix("gray:") {
            Some(url) => (url.to_string(), Op::Grayscale),
            None => (key.clone(), Op::MaxWidth((width * scale).ceil() as u32)),
        };
        let key = key.clone();
        loader.load(url, op, move |img| {
            with(|s| s.icons.insert(key.clone(), img.clone()));
            set_image(&key, img);
        });
    }
}

/// Swap a loaded image into the rows that use it (no full rebuild).
fn set_image(url: &str, img: Image) {
    use slint::Model;
    let Some(ui) = app() else { return };
    let rows = ui.global::<AchievementsData>().get_rows();
    let per_row: Vec<Vec<String>> = with(|s| s.entries.iter().map(|e| wanted_urls(s, e)).collect());
    for (index, urls) in per_row.iter().enumerate() {
        if !urls.iter().any(|u| u == url) {
            continue;
        }
        let Some(mut row) = rows.row_data(index) else {
            continue;
        };
        if urls.first().is_some_and(|u| u == url) {
            row.icon = img.clone();
        }
        if urls.get(1).is_some_and(|u| u == url) {
            row.souvenir = img.clone();
        }
        rows.set_row_data(index, row);
    }
}

/// FullscreenMediaModal (upscale): the souvenir at up to 88% of the window.
fn open_souvenir(key: &str) {
    let found = with(|s| {
        list(s)
            .iter()
            .find(|a| achievement_list::key(a) == key)
            .and_then(|a| souvenir_url(a).map(|u| (u, a.display_name.clone(), s.generation)))
    });
    let Some((url, title, generation)) = found else {
        return;
    };
    let Some(ui) = app() else { return };
    let data = ui.global::<AchievementsData>();
    data.set_souvenir_alt(
        shell::tr_with("achievement.souvenir_alt", &[("achievement", title.into())]).into(),
    );
    data.set_souvenir(Image::default());
    data.set_souvenir_open(true);
    let Some((loader, _)) = shell::loader() else {
        return;
    };
    // VIEWPORT_FILL_RATIO of the window, in physical pixels
    let width = ui.window().size().width.max(1) as f32 * 0.88;
    loader.load(url, Op::MaxWidth(width.ceil() as u32), move |img| {
        if with(|s| s.generation) == generation
            && let Some(ui) = app()
        {
            let data = ui.global::<AchievementsData>();
            if data.get_souvenir_open() {
                data.set_souvenir(img);
            }
        }
    });
}
