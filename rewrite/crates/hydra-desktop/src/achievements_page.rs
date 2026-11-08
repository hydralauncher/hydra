//! pages/achievements: the signed-in user's achievements for one game, with
//! the banner, summary, search, status filter and sorting
//! (achievements.tsx, achievements-content.tsx, achievement-list.tsx).
//!
//! Not ported yet: comparing with another user, achievement sets
//! (RetroAchievements), souvenir screenshots and hardcore badges.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use hydra_core::achievement_list::{self, Sort, Status};
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
    achievements: Vec<Achievement>,
    search: String,
    status: String,
    sort: String,
    revealed: HashSet<String>,
    last_revealed: Option<String>,
    /// the rows on screen (visible-rows), in display order
    visible: Vec<usize>,
    range: (usize, usize),
    icons: HashMap<String, Image>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn ui() -> Option<AppWindow> {
    with(|s| s.ui.upgrade())
}

fn language() -> String {
    shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into())
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
    data.on_reveal(|key| {
        with(|s| {
            s.revealed.insert(key.to_string());
            s.last_revealed = Some(key.to_string());
        });
        apply();
    });
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
}

/// The /achievements route (title, shop, objectId).
pub fn open(shop: &str, object_id: &str, title: &str) {
    let generation = with(|s| {
        s.generation += 1;
        s.shop = shop.to_string();
        s.object_id = object_id.to_string();
        s.title = title.to_string();
        s.achievements.clear();
        s.search.clear();
        s.status = "all".into();
        s.sort = "most_common".into();
        s.revealed.clear();
        s.last_revealed = None;
        s.range = (0, 12);
        s.generation
    });
    let Some(app) = ui() else { return };
    let data = app.global::<AchievementsData>();
    data.set_loading(true);
    data.set_search("".into());
    data.set_game_title(title.into());
    data.set_hero(Image::default());
    data.set_logo(Image::default());
    data.set_has_logo(false);
    data.set_rows(ModelRc::default());
    let session = app.global::<Session>();
    data.set_signed_in(session.get_signed_in());
    data.set_subscriber(session.get_has_subscription());
    apply();
    load_artwork(shop, object_id, generation);
    let (Some(api), Some(db)) = (shell::api(), shell::db()) else {
        return;
    };
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    std::thread::spawn(move || {
        let result = hydra_core::achievements::unlocked_achievements(&api, &db, &shop, &object_id);
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation {
                return;
            }
            match result {
                Ok(list) => with(|s| s.achievements = list),
                Err(error) => eprintln!("achievements: {error}"),
            }
            if let Some(ui) = ui() {
                ui.global::<AchievementsData>().set_loading(false);
            }
            apply();
        });
    });
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
                            && let Some(ui) = ui()
                        {
                            ui.global::<AchievementsData>().set_hero(img);
                        }
                    },
                );
            }
            if let Some(url) = logo {
                if let Some(ui) = ui() {
                    ui.global::<AchievementsData>().set_has_logo(true);
                }
                loader.load(
                    url,
                    Op::MaxWidth((200.0 * scale).ceil() as u32),
                    move |img| {
                        if with(|s| s.generation) == generation
                            && let Some(ui) = ui()
                        {
                            ui.global::<AchievementsData>().set_logo(img);
                        }
                    },
                );
            }
        });
    });
}

fn icon_url(a: &Achievement) -> String {
    if a.unlocked {
        a.icon.clone()
    } else {
        a.icon_gray.clone()
    }
}

fn apply() {
    let Some(ui) = ui() else { return };
    let data = ui.global::<AchievementsData>();
    let show_hidden = shell::preference("showHiddenAchievementsDescription");
    let language = language();
    let (rows, counts, points, unlocked, total) = with(|s| {
        let revealed = s.revealed.clone();
        let concealed = |a: &Achievement| {
            achievement_list::is_concealed(a, show_hidden)
                && !revealed.contains(achievement_list::key(a))
        };
        let visible = achievement_list::filter_and_sort(
            &s.achievements,
            &s.search,
            Status::parse(&s.status),
            Sort::parse(&s.sort),
            concealed,
        );
        let rows: Vec<AchievementRow> = visible
            .iter()
            .map(|&i| {
                let a = &s.achievements[i];
                let key = achievement_list::key(a).to_string();
                AchievementRow {
                    concealed: concealed(a),
                    hidden_marker: a.hidden && !a.unlocked,
                    revealed: s.last_revealed.as_deref() == Some(key.as_str()),
                    title: a.display_name.clone().into(),
                    description: a.description.clone().into(),
                    unlock_time: a
                        .unlock_time
                        .map(|t| hydra_i18n::date::format_achievement_unlock(&language, t))
                        .unwrap_or_default()
                        .into(),
                    unlocked: a.unlocked,
                    icon: s.icons.get(&icon_url(a)).cloned().unwrap_or_default(),
                    percentage: a
                        .global_unlock_percentage
                        .map(|p| achievement_list::format_percentage(p, &language))
                        .unwrap_or_default()
                        .into(),
                    points: a.points.map(|p| p.to_string()).unwrap_or_default().into(),
                    key: key.into(),
                }
            })
            .collect();
        s.visible = visible;
        let counts = achievement_list::status_counts(&s.achievements);
        let earned: i64 = s
            .achievements
            .iter()
            .filter(|a| a.unlocked)
            .filter_map(|a| a.points)
            .sum();
        let total_points: i64 = s.achievements.iter().filter_map(|a| a.points).sum();
        let unlocked = s.achievements.iter().filter(|a| a.unlocked).count();
        (
            rows,
            counts,
            format!("{earned} / {total_points}"),
            unlocked,
            s.achievements.len(),
        )
    });
    data.set_status(with(|s| s.status.clone()).into());
    data.set_sort(with(|s| s.sort.clone()).into());
    data.set_count_all(counts.0 as i32);
    data.set_count_unlocked(counts.1 as i32);
    data.set_count_locked(counts.2 as i32);
    data.set_points(points.into());
    data.set_unlocked(unlocked as i32);
    data.set_total(total as i32);
    data.set_percent(
        if total > 0 {
            crate::downloads_page::format_progress(unlocked as f64 / total as f64, 2)
        } else {
            "0%".into()
        }
        .into(),
    );
    data.set_rows(ModelRc::new(VecModel::from(rows)));
    load_icons();
}

/// Icons for the rows on screen (and a few around them).
fn load_icons() {
    let Some((loader, scale)) = shell::loader() else {
        return;
    };
    let wanted: Vec<String> = with(|s| {
        let (first, last) = s.range;
        s.visible
            .iter()
            .skip(first)
            .take(last.saturating_sub(first) + 1)
            .map(|&i| icon_url(&s.achievements[i]))
            .filter(|url| !url.is_empty() && !s.icons.contains_key(url))
            .collect()
    });
    for url in wanted {
        with(|s| s.icons.insert(url.clone(), Image::default()));
        let key = url.clone();
        loader.load(
            url,
            Op::MaxWidth((64.0 * scale).ceil() as u32),
            move |img| {
                with(|s| s.icons.insert(key.clone(), img.clone()));
                set_icon(&key, img);
            },
        );
    }
}

/// Swap a loaded icon into the rows that use it (no full rebuild).
fn set_icon(url: &str, img: Image) {
    use slint::Model;
    let Some(ui) = ui() else { return };
    let rows = ui.global::<AchievementsData>().get_rows();
    let urls: Vec<String> = with(|s| {
        s.visible
            .iter()
            .map(|&i| icon_url(&s.achievements[i]))
            .collect()
    });
    for (index, row_url) in urls.iter().enumerate() {
        if row_url == url
            && let Some(mut row) = rows.row_data(index)
        {
            row.icon = img.clone();
            rows.set_row_data(index, row);
        }
    }
}
