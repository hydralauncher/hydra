//! The game page's Hydra API sections: stats (get-game-stats.ts, cached 30
//! minutes in `gameStatsAssets`), HowLongToBeat (sidebar.tsx) and "More like
//! this" (use-similar-games.ts, similar-games.tsx).

use std::cell::RefCell;
use std::rc::Rc;

use hydra_core::api::Options;
use hydra_db::keys;
use hydra_media::images::{self, Op};
use serde_json::{Value, json};
use slint::{ComponentHandle, Model, ModelRc, SharedString, VecModel};

use crate::{AppWindow, GameData, HltbCategory, SimilarGame, shell};

/// get-game-stats.ts LOCAL_CACHE_EXPIRATION
const STATS_CACHE_MS: i64 = 30 * 60 * 1000;
/// SIMILAR_GAMES_LIMIT
const SIMILAR_LIMIT: usize = 9;

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    generation: u64,
    similar: Vec<Similar>,
    similar_model: Rc<VecModel<SimilarGame>>,
}

#[derive(Clone)]
struct Similar {
    shop: String,
    object_id: String,
    title: String,
    covers: Vec<String>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn current(generation: u64) -> Option<AppWindow> {
    with(|s| {
        (s.generation == generation)
            .then(|| s.ui.upgrade())
            .flatten()
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

pub fn init(ui: &AppWindow) {
    let model = with(|s| {
        s.ui = ui.as_weak();
        s.similar_model.clone()
    });
    let g = ui.global::<GameData>();
    g.set_similar(ModelRc::from(model));
    g.on_similar_clicked(|index| {
        let game = with(|s| s.similar.get(index as usize).cloned());
        if let Some(game) = game {
            // buildGameDetailsPath
            crate::nav::navigate(&format!(
                "/game/{}/{}?title={}",
                game.shop,
                game.object_id,
                crate::nav::encode(&game.title)
            ));
        }
    });
}

/// The page opened another game: clear the sections and fetch them again.
pub fn open(shop: &str, object_id: &str) {
    let generation = with(|s| {
        s.generation += 1;
        s.similar.clear();
        s.similar_model.set_vec(Vec::new());
        s.generation
    });
    let Some(ui) = with(|s| s.ui.upgrade()) else {
        return;
    };
    let g = ui.global::<GameData>();
    g.set_has_stats(false);
    g.set_hltb(ModelRc::new(VecModel::from(Vec::<HltbCategory>::new())));
    g.set_hltb_loading(!object_id.is_empty());
    // useSimilarGames: only Steam and classics games are eligible.
    let eligible = !object_id.is_empty() && (shop == "steam" || shop == "launchbox");
    g.set_similar_state(if eligible { "loading" } else { "hidden" }.into());
    if shop != "custom" {
        fetch_stats(shop, object_id, generation);
    }
    if !object_id.is_empty() {
        fetch_hltb(shop, object_id, generation);
    }
    if eligible {
        fetch_similar(shop, object_id, generation);
    }
}

/// Leaving the page: drop the covers.
pub fn close() {
    with(|s| {
        s.generation += 1;
        s.similar.clear();
        s.similar_model.set_vec(Vec::new());
    });
}

fn fetch_stats(shop: &str, object_id: &str, generation: u64) {
    let (Some(api), Some(db)) = (shell::api(), shell::db()) else {
        return;
    };
    let key = keys::game(shop, object_id);
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    std::thread::spawn(move || {
        let cached: Option<Value> = db.get_in(keys::GAME_STATS_CACHE, &key);
        let fresh = cached.filter(|c| {
            c.get("updatedAt")
                .and_then(Value::as_i64)
                .is_some_and(|at| at + STATS_CACHE_MS > now_ms())
        });
        let stats = fresh.or_else(|| {
            let data = api
                .get(
                    &format!("/games/{shop}/{object_id}/stats"),
                    &[],
                    Options::public(),
                )
                .ok()
                .filter(Value::is_object)?;
            let mut stored = data.clone();
            if let Some(map) = stored.as_object_mut() {
                map.insert("updatedAt".into(), json!(now_ms()));
            }
            let _ = db.put_in(keys::GAME_STATS_CACHE, &key, &stored);
            Some(data)
        });
        let _ = slint::invoke_from_event_loop(move || {
            let Some(ui) = current(generation) else {
                return;
            };
            let Some(stats) = stats else { return };
            let number = |key: &str| stats.get(key).and_then(Value::as_f64).unwrap_or(0.0);
            let format = |v: f64| {
                shell::i18n()
                    .map(|i| i.format_number(v.round()))
                    .unwrap_or_else(|| v.round().to_string())
            };
            let g = ui.global::<GameData>();
            g.set_downloads(format(number("downloadCount")).into());
            g.set_players(format(number("playerCount")).into());
            // StarRating: "…" without a score, else one decimal.
            let score = stats.get("averageScore").and_then(Value::as_f64);
            g.set_rating(
                match score.filter(|s| *s != 0.0) {
                    Some(score) => format!("{score:.1}"),
                    None => "…".to_string(),
                }
                .into(),
            );
            g.set_has_stats(true);
        });
    });
}

/// how-long-to-beat-section.tsx getDuration: "27 Hours" -> "27 hours".
fn duration(text: &str) -> String {
    let mut parts = text.split(' ');
    let value = parts.next().unwrap_or_default();
    let unit = parts.next().unwrap_or_default();
    let unit = match unit {
        "Hours" => shell::tr("game_details.hours"),
        "Mins" => shell::tr("game_details.minutes"),
        other => other.to_string(),
    };
    format!("{value} {unit}")
}

fn fetch_hltb(shop: &str, object_id: &str, generation: u64) {
    let Some(api) = shell::api() else { return };
    let path = format!("/games/{shop}/{object_id}/how-long-to-beat");
    std::thread::spawn(move || {
        let result = api.get(&path, &[], Options::public());
        let _ = slint::invoke_from_event_loop(move || {
            let Some(ui) = current(generation) else {
                return;
            };
            let categories: Vec<HltbCategory> = result
                .ok()
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default()
                .iter()
                .map(|c| {
                    let field = |k: &str| {
                        c.get(k)
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string()
                    };
                    let accuracy = field("accuracy");
                    HltbCategory {
                        title: field("title").into(),
                        duration: duration(&field("duration")).into(),
                        accuracy: if accuracy == "00" {
                            SharedString::default()
                        } else {
                            accuracy.into()
                        },
                    }
                })
                .collect();
            let g = ui.global::<GameData>();
            g.set_hltb(ModelRc::new(VecModel::from(categories)));
            g.set_hltb_loading(false);
        });
    });
}

/// fetchSimilarGames + normalizeSimilarGamesResponse.
fn fetch_similar(shop: &str, object_id: &str, generation: u64) {
    let (Some(api), Some(db)) = (shell::api(), shell::db()) else {
        return;
    };
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    std::thread::spawn(move || {
        let mut sources: Vec<Value> = db.values(keys::DOWNLOAD_SOURCES).unwrap_or_default();
        sources.sort_by(|a, b| {
            let created = |v: &Value| {
                v.get("createdAt")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            };
            created(b).cmp(&created(a))
        });
        let mut query: Vec<(&str, String)> = vec![("take", SIMILAR_LIMIT.to_string())];
        for source in &sources {
            if let Some(id) = source.get("id").and_then(|v| {
                v.as_str()
                    .map(str::to_string)
                    .or_else(|| v.as_i64().map(|n| n.to_string()))
            }) {
                query.push(("downloadSourceIds[]", id));
            }
        }
        let path = format!(
            "/catalogue/{shop}/{}/similar",
            crate::nav::encode(&object_id)
        );
        let result = api.get(&path, &query, Options::public());
        let games = match result {
            Ok(Value::Array(list)) => normalize(&list, &shop, &object_id),
            Ok(_) => {
                eprintln!("Failed to fetch similar games: Invalid similar games response");
                Vec::new()
            }
            Err(error) => {
                eprintln!("Failed to fetch similar games: {error}");
                Vec::new()
            }
        };
        let _ = slint::invoke_from_event_loop(move || {
            if current(generation).is_none() {
                return;
            }
            apply_similar(games, generation);
        });
    });
}

fn normalize(list: &[Value], shop: &str, object_id: &str) -> Vec<Similar> {
    let mut seen = std::collections::HashSet::new();
    list.iter()
        .filter_map(|candidate| {
            let id = candidate.get("objectId")?.as_str()?.trim().to_string();
            let game_shop = candidate.get("shop")?.as_str()?;
            if game_shop != "steam" && game_shop != "launchbox" {
                return None;
            }
            let title = candidate.get("title")?.as_str()?.trim().to_string();
            if id.is_empty() || title.is_empty() {
                return None;
            }
            let url = |k: &str| {
                candidate
                    .get(k)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            };
            // getVerticalCoverCardImageSources: cover, library, icon (deduplicated)
            let mut covers = Vec::new();
            for source in [url("coverImageUrl"), url("libraryImageUrl"), url("iconUrl")]
                .into_iter()
                .flatten()
            {
                if !covers.contains(&source) {
                    covers.push(source);
                }
            }
            Some(Similar {
                shop: game_shop.to_string(),
                object_id: id,
                title,
                covers,
            })
        })
        .filter(|g| {
            g.shop == shop
                && g.object_id != object_id
                && seen.insert(format!("{}:{}", g.shop, g.object_id))
        })
        .take(SIMILAR_LIMIT)
        .collect()
}

fn apply_similar(games: Vec<Similar>, generation: u64) {
    let Some(ui) = current(generation) else {
        return;
    };
    let rows: Vec<SimilarGame> = games
        .iter()
        .map(|g| SimilarGame {
            title: g.title.clone().into(),
            cover: Default::default(),
            classics: g.shop == "launchbox",
            backdrop: Default::default(),
            missing: g.covers.is_empty(),
        })
        .collect();
    let model = with(|s| {
        s.similar = games.clone();
        s.similar_model.clone()
    });
    model.set_vec(rows);
    ui.global::<GameData>()
        .set_similar_state(if games.is_empty() { "empty" } else { "ready" }.into());
    // The cards are at most (800 + 16) / 3 - 16 = 256px wide.
    let Some((loader, scale)) = shell::loader() else {
        return;
    };
    let width = (256.0 * scale).ceil() as u32;
    for (index, game) in games.into_iter().enumerate() {
        let classics = game.shop == "launchbox";
        let covers = game.covers.clone();
        loader.run(move |http| {
            // onError: the next source; none left shows the placeholder.
            let mut found = None;
            for url in &covers {
                let source = images::Source::Url(url.clone());
                let Some(bytes) = images::fetch(http, &source) else {
                    continue;
                };
                let Some(img) = images::open_bytes(&bytes) else {
                    continue;
                };
                let source_width = img.width().max(1) as f32;
                let cover = images::to_pixels(img.clone(), Op::MaxWidth(width));
                // blur(16px) on the 1.25x backdrop (about 320px wide), in
                // source pixels after shrinking by 4.
                let backdrop = classics.then(|| {
                    images::to_pixels(
                        img,
                        Op::Blur {
                            shrink: 4,
                            sigma: (16.0 * source_width / 320.0 / 4.0).max(0.5),
                        },
                    )
                });
                found = Some((cover, backdrop));
                break;
            }
            let _ = slint::invoke_from_event_loop(move || {
                if current(generation).is_none() {
                    return;
                }
                let model = with(|s| s.similar_model.clone());
                let Some(mut row) = model.row_data(index) else {
                    return;
                };
                match found {
                    Some((cover, backdrop)) => {
                        row.cover = cover.into_image();
                        if let Some(backdrop) = backdrop {
                            row.backdrop = backdrop.into_image();
                        }
                    }
                    None => row.missing = true,
                }
                model.set_row_data(index, row);
            });
        });
    }
}
