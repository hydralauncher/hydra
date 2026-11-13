//! The home page: src/renderer/src/pages/home/home.tsx, components/hero
//! (featured game) and components/game-card (catalogue cards with stats on
//! hover), plus the Steam250 randomizer (catalogue/get-random-game.ts).

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use hydra_core::api::Options;
use hydra_db::keys;
use hydra_media::images::{Loader, Op};
use serde_json::{Value, json};
use slint::{ComponentHandle, Image, Model, ModelRc, SharedString, VecModel};

use crate::{AppWindow, CatalogueCard, HomeData, nav, shell};

/// GET /games/{shop}/{id}/stats results stay fresh this long (get-game-stats.ts).
const STATS_CACHE_MS: i64 = 30 * 60 * 1000;

struct Featured {
    uri: String,
    hero: Option<String>,
    logo: Option<String>,
    description: String,
}

struct Page {
    ui: slint::Weak<AppWindow>,
    loader: Loader,
    scale: f32,
    /// Featured games per language, kept for the session (featuredCache).
    featured: HashMap<String, Option<Featured>>,
    category: String,
    /// The catalogue rows on screen: (shop, objectId, title).
    games: Vec<(String, String, String)>,
    cards: Rc<VecModel<CatalogueCard>>,
    /// Bumped per request so stale responses are dropped.
    request: u64,
    /// The randomizer's shuffled Steam250 list and position.
    random: Vec<(String, String)>,
    random_index: usize,
    random_loading: bool,
}

thread_local! {
    static PAGE: RefCell<Option<Page>> = const { RefCell::new(None) };
}

fn with_page<R>(f: impl FnOnce(&mut Page) -> R) -> Option<R> {
    PAGE.with(|p| p.borrow_mut().as_mut().map(f))
}

pub fn init(ui: &AppWindow, loader: &Loader) {
    let cards = Rc::new(VecModel::from(Vec::<CatalogueCard>::new()));
    ui.global::<HomeData>()
        .set_cards(ModelRc::from(cards.clone()));
    PAGE.with(|p| {
        *p.borrow_mut() = Some(Page {
            ui: ui.as_weak(),
            loader: loader.clone(),
            scale: ui.window().scale_factor(),
            featured: HashMap::new(),
            category: "hot".into(),
            games: Vec::new(),
            cards,
            request: 0,
            random: Vec::new(),
            random_index: 0,
            random_loading: false,
        })
    });
    let data = ui.global::<HomeData>();
    data.on_open_featured(|| {
        if let Some(uri) = with_page(|p| {
            let language = language();
            p.featured
                .get(&language)
                .and_then(|f| f.as_ref())
                .map(|f| f.uri.clone())
        })
        .flatten()
        {
            nav::navigate(&uri);
        }
    });
    data.on_select_category(|category| {
        let changed = with_page(|p| p.category != category.as_str()).unwrap_or(false);
        if changed {
            load_catalogue(category.as_str());
        }
    });
    data.on_open_card(|index| {
        if let Some((shop, object_id, title)) =
            with_page(|p| p.games.get(index as usize).cloned()).flatten()
        {
            nav::navigate(&format!(
                "/game/{shop}/{object_id}?title={}",
                nav::encode(&title)
            ));
        }
    });
    data.on_card_hovered(|index| load_stats(index as usize));
    data.on_surprise(surprise);
}

fn language() -> String {
    shell::i18n()
        .map(|i| i.language().split('-').next().unwrap_or("en").to_string())
        .unwrap_or_else(|| "en".into())
}

/// Entering the page (the component mounts): featured game, "Hot now" and a random game.
pub fn open() {
    crate::gifs::ensure_loaded();
    load_featured();
    load_catalogue("hot");
    if with_page(|p| p.random.is_empty() && !p.random_loading).unwrap_or(false) {
        load_random();
    }
}

pub fn shutdown() {
    let page = PAGE.with(|p| p.borrow_mut().take());
    drop(page);
}

fn load_featured() {
    let language = language();
    let cached = with_page(|p| p.featured.contains_key(&language)).unwrap_or(false);
    if cached {
        apply_featured(&language);
        // The hero paints from the cache at once; the request still refreshes it.
    } else if let Some(ui) = with_page(|p| p.ui.upgrade()).flatten() {
        ui.global::<HomeData>().set_featured_loading(true);
    }
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let result = api.get(
            "/catalogue/featured",
            &[("language", language.clone())],
            Options::default(),
        );
        let featured = match result {
            Ok(Value::Array(items)) => items.first().map(|game| Featured {
                uri: game
                    .get("uri")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                hero: game
                    .get("libraryHeroImageUrl")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                logo: game
                    .get("logoImageUrl")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                description: game
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            }),
            Ok(other) => {
                eprintln!("Expected an array from /catalogue/featured, received {other}");
                None
            }
            Err(error) => {
                eprintln!("featured: {error}");
                None
            }
        };
        let _ = slint::invoke_from_event_loop(move || {
            with_page(|p| p.featured.insert(language.clone(), featured));
            apply_featured(&language);
        });
    });
}

fn apply_featured(language: &str) {
    let Some((ui, loader, scale, featured)) = with_page(|p| {
        let f = p.featured.get(language).and_then(|f| f.as_ref());
        (
            p.ui.clone(),
            p.loader.clone(),
            p.scale,
            f.map(|f| (f.hero.clone(), f.logo.clone(), f.description.clone())),
        )
    }) else {
        return;
    };
    let Some(window) = ui.upgrade() else { return };
    let data = window.global::<HomeData>();
    data.set_featured_loading(false);
    data.set_featured_shown(featured.is_some());
    let Some((hero, logo, description)) = featured else {
        return;
    };
    data.set_featured_description(description.into());
    let width = window.window().size().width;
    if let Some(url) = hero {
        let ui = ui.clone();
        loader.load(url, Op::MaxWidth(width), move |img| {
            if let Some(ui) = ui.upgrade() {
                ui.global::<HomeData>().set_featured_hero(img);
            }
        });
    }
    if let Some(url) = logo {
        loader.load(
            url,
            Op::MaxWidth((250.0 * scale).ceil() as u32),
            move |img| {
                if let Some(ui) = ui.upgrade() {
                    ui.global::<HomeData>().set_featured_logo(img);
                }
            },
        );
    }
}

/// getCatalogue(category): `/catalogue/{category}?take=12&skip=0&downloadSourceIds[]=…`
fn load_catalogue(category: &str) {
    let Some((ui, request)) = with_page(|p| {
        p.category = category.to_string();
        p.request += 1;
        (p.ui.clone(), p.request)
    }) else {
        return;
    };
    if let Some(window) = ui.upgrade() {
        let data = window.global::<HomeData>();
        data.set_category(category.into());
        data.set_loading(true);
    }
    let (Some(api), Some(db)) = (shell::api(), shell::db()) else {
        return;
    };
    let category = category.to_string();
    std::thread::spawn(move || {
        // downloadSources ordered by createdAt, newest first.
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
        let mut query: Vec<(&str, String)> = vec![("take", "12".into()), ("skip", "0".into())];
        for source in &sources {
            if let Some(id) = source.get("id").and_then(|v| {
                v.as_str()
                    .map(str::to_string)
                    .or_else(|| v.as_i64().map(|n| n.to_string()))
            }) {
                query.push(("downloadSourceIds[]", id));
            }
        }
        let result = api.get(
            &format!("/catalogue/{category}"),
            &query,
            Options::default(),
        );
        let items = match result {
            Ok(Value::Array(items)) => items,
            Ok(other) => {
                eprintln!("Expected an array from /catalogue/{category}, received {other}");
                Vec::new()
            }
            Err(error) => {
                eprintln!("catalogue {category}: {error}");
                Vec::new()
            }
        };
        let _ = slint::invoke_from_event_loop(move || apply_catalogue(request, items));
    });
}

fn apply_catalogue(request: u64, items: Vec<Value>) {
    let Some(i18n) = shell::i18n() else { return };
    let Some((ui, loader, scale, cards)) = with_page(|p| {
        if p.request != request {
            return None;
        }
        p.games = items
            .iter()
            .map(|g| {
                let s = |k: &str| {
                    g.get(k)
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string()
                };
                (s("shop"), s("objectId"), s("title"))
            })
            .collect();
        Some((p.ui.clone(), p.loader.clone(), p.scale, p.cards.clone()))
    })
    .flatten() else {
        return;
    };
    let rows: Vec<CatalogueCard> = items
        .iter()
        .map(|game| {
            let sources: Vec<String> = game
                .get("downloadSources")
                .and_then(Value::as_array)
                .map(|s| {
                    s.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let more = sources.len().saturating_sub(3);
            CatalogueCard {
                title: game
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
                shop: match game.get("shop").and_then(Value::as_str) {
                    Some("steam") => "steam",
                    Some("epic") => "epic",
                    _ => "",
                }
                .into(),
                cover: Image::default(),
                sources: ModelRc::new(VecModel::from(
                    sources
                        .iter()
                        .take(3)
                        .map(|s| SharedString::from(s.as_str()))
                        .collect::<Vec<_>>(),
                )),
                more_sources: if more > 0 {
                    format!(
                        "+{more} {}",
                        i18n.t_count("game_card.available", more as f64, &[])
                    )
                    .into()
                } else {
                    SharedString::default()
                },
                stats_loaded: false,
                downloads: "…".into(),
                players: "…".into(),
                rating: "…".into(),
            }
        })
        .collect();
    cards.set_vec(rows);
    if let Some(window) = ui.upgrade() {
        window.global::<HomeData>().set_loading(false);
    }
    // loading="lazy": twelve cards are all near the viewport, so all load.
    let card_px = window_card_width(&ui, scale);
    for (index, game) in items.iter().enumerate() {
        let Some(url) = game
            .get("libraryImageUrl")
            .and_then(Value::as_str)
            .filter(|u| !u.is_empty())
        else {
            continue;
        };
        loader.load(url.to_string(), Op::MaxWidth(card_px), move |img| {
            with_page(|p| {
                if p.request == request
                    && let Some(mut row) = p.cards.row_data(index)
                {
                    row.cover = img;
                    p.cards.set_row_data(index, row);
                }
            });
        });
    }
}

/// The cards are about a third of the window wide; decode at that size.
fn window_card_width(ui: &slint::Weak<AppWindow>, scale: f32) -> u32 {
    let width = ui
        .upgrade()
        .map(|u| u.window().size().width as f32)
        .unwrap_or(1200.0 * scale);
    (width / 2.0).ceil() as u32
}

/// GameCard's onMouseEnter: getGameStats once per card.
fn load_stats(index: usize) {
    let Some((shop, object_id)) = with_page(|p| {
        let (shop, object_id, _) = p.games.get(index)?.clone();
        let mut row = p.cards.row_data(index)?;
        if row.stats_loaded {
            return None;
        }
        // Mark as requested so hovering again doesn't fetch twice.
        row.stats_loaded = true;
        p.cards.set_row_data(index, row);
        Some((shop, object_id))
    })
    .flatten() else {
        return;
    };
    if shop == "custom" {
        return;
    }
    let (Some(api), Some(db)) = (shell::api(), shell::db()) else {
        return;
    };
    let request = with_page(|p| p.request).unwrap_or(0);
    std::thread::spawn(move || {
        let stats = game_stats(&db, &api, &shop, &object_id);
        let _ = slint::invoke_from_event_loop(move || {
            let Some(stats) = stats else { return };
            let Some(i18n) = shell::i18n() else { return };
            let Some(cards) =
                with_page(|p| (p.request == request).then(|| p.cards.clone())).flatten()
            else {
                return;
            };
            if let Some(mut row) = cards.row_data(index) {
                let number = |key: &str| stats.get(key).and_then(Value::as_f64).unwrap_or(0.0);
                row.downloads = i18n.format_number(number("downloadCount").round()).into();
                row.players = i18n.format_number(number("playerCount").round()).into();
                row.rating = match stats.get("averageScore").and_then(Value::as_f64) {
                    Some(score) if score != 0.0 => format!("{score:.1}").into(),
                    _ => "…".into(),
                };
                cards.set_row_data(index, row);
            }
        });
    });
}

/// get-game-stats.ts: the local cache first (30 minutes), then the API.
pub fn game_stats(
    db: &hydra_db::Db,
    api: &hydra_core::api::HydraApi,
    shop: &str,
    object_id: &str,
) -> Option<Value> {
    let key = format!("{shop}:{object_id}");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    if let Some(cached) = db.get_in::<Value>(keys::GAME_STATS_CACHE, &key)
        && cached
            .get("updatedAt")
            .and_then(Value::as_i64)
            .is_some_and(|at| at + STATS_CACHE_MS > now)
    {
        return Some(cached);
    }
    let data = api
        .get(
            &format!("/games/{shop}/{object_id}/stats"),
            &[],
            Options::default(),
        )
        .ok()?;
    let mut stored = data.clone();
    if let Value::Object(map) = &mut stored {
        map.insert("updatedAt".into(), json!(now));
    }
    let _ = db.put_in(keys::GAME_STATS_CACHE, &key, &stored);
    Some(data)
}

fn load_random() {
    with_page(|p| p.random_loading = true);
    std::thread::spawn(|| {
        let list = steam250_list();
        let _ = slint::invoke_from_event_loop(move || {
            let ready = with_page(|p| {
                p.random_loading = false;
                p.random = shuffled(list);
                p.random_index = 0;
                !p.random.is_empty()
            })
            .unwrap_or(false);
            if let Some(ui) = with_page(|p| p.ui.upgrade()).flatten() {
                ui.global::<HomeData>().set_random_ready(ready);
            }
        });
    });
}

/// handleRandomizerClick: the next game of the shuffled list (getRandomGame
/// advances first and reshuffles at the end).
fn surprise() {
    let Some(game) = with_page(|p| {
        if p.random.is_empty() {
            return None;
        }
        p.random_index += 1;
        if p.random_index == p.random.len() {
            p.random_index = 0;
            p.random = shuffled(std::mem::take(&mut p.random));
        }
        p.random.get(p.random_index).cloned()
    })
    .flatten() else {
        return;
    };
    let (object_id, title) = game;
    nav::navigate(&format!(
        "/game/steam/{object_id}?title={}&fromRandomizer=1",
        nav::encode(&title)
    ));
}

fn shuffled<T>(mut items: Vec<T>) -> Vec<T> {
    // Fisher-Yates with a time-seeded xorshift (lodash shuffle uses Math.random).
    let mut seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E3779B97F4A7C15)
        | 1;
    for i in (1..items.len()).rev() {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        let j = (seed % (i as u64 + 1)) as usize;
        items.swap(i, j);
    }
    items
}

/// services/steam-250.ts: `a[data-title]` links of four steam250.com lists,
/// deduplicated by app id.
fn steam250_list() -> Vec<(String, String)> {
    let year = chrono_year();
    let paths = [
        "/hidden_gems".to_string(),
        format!("/{year}"),
        "/top250".into(),
        "/most_played".into(),
    ];
    let client = hydra_store::http_client();
    let mut seen = std::collections::HashSet::new();
    let mut games = Vec::new();
    for path in paths {
        let Ok(body) = client
            .get(format!("https://steam250.com{path}"))
            .send()
            .and_then(|r| r.text())
        else {
            continue;
        };
        for (object_id, title) in parse_steam250(&body) {
            if seen.insert(object_id.clone()) {
                games.push((object_id, title));
            }
        }
    }
    games
}

fn chrono_year() -> i64 {
    // Days since the epoch -> civil year (Howard Hinnant's algorithm).
    let days = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64 / 86400)
        .unwrap_or(0);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    yoe + era * 400 + i64::from(month <= 2)
}

/// Every `<a … data-title=… href=…>`: (last path segment of href, title).
/// Attribute values may be quoted or not (steam250 serves unquoted ones).
fn parse_steam250(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(start) = rest.find("<a ") {
        let tag_rest = &rest[start + 3..];
        let Some(end) = tag_rest.find('>') else { break };
        let attrs = parse_attributes(&tag_rest[..end]);
        rest = &tag_rest[end..];
        let get = |name: &str| {
            attrs
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.clone())
        };
        let (Some(title), Some(href)) = (get("data-title"), get("href")) else {
            continue;
        };
        if href.is_empty() {
            continue;
        }
        // new URL(href).pathname.split("/").pop()
        let path = href.split(['?', '#']).next().unwrap_or_default();
        let object_id = path.rsplit('/').next().unwrap_or_default().to_string();
        out.push((object_id, title));
    }
    out
}

fn parse_attributes(tag: &str) -> Vec<(String, String)> {
    let bytes = tag.as_bytes();
    let mut i = 0;
    let mut out = Vec::new();
    while i < bytes.len() {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        let name_start = i;
        while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'=' {
            i += 1;
        }
        let name = tag[name_start..i].to_ascii_lowercase();
        if name.is_empty() {
            i += 1;
            continue;
        }
        if i < bytes.len() && bytes[i] == b'=' {
            i += 1;
            let value = if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\x27') {
                let quote = bytes[i];
                let start = i + 1;
                let end = tag[start..]
                    .find(quote as char)
                    .map(|e| start + e)
                    .unwrap_or(tag.len());
                i = (end + 1).min(tag.len());
                &tag[start..end]
            } else {
                let start = i;
                while i < bytes.len() && !bytes[i].is_ascii_whitespace() {
                    i += 1;
                }
                &tag[start..i]
            };
            out.push((name, html_unescape(value)));
        } else {
            out.push((name, String::new()));
        }
    }
    out
}

/// Character references: numeric (`&#x20;`, `&#32;`) and the common named ones.
fn html_unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        let Some(semi) = tail.find(';').filter(|s| *s <= 10) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let entity = &tail[1..semi];
        let decoded = if let Some(hex) = entity
            .strip_prefix("#x")
            .or_else(|| entity.strip_prefix("#X"))
        {
            u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
        } else if let Some(dec) = entity.strip_prefix('#') {
            dec.parse::<u32>().ok().and_then(char::from_u32)
        } else {
            match entity {
                "amp" => Some('&'),
                "quot" => Some('"'),
                "apos" => Some('\x27'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "nbsp" => Some(' '),
                _ => None,
            }
        };
        match decoded {
            Some(ch) => {
                out.push(ch);
                rest = &tail[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_steam250_links() {
        let html = r#"<a href="https://store.steampowered.com/app/1091500" data-title="Cyberpunk 2077" class="x">x</a>
            <a data-title="Tom &amp; Jerry" href="https://store.steampowered.com/app/42">y</a><a href="/top">z</a>
            <a data-hx=1/2 data-title=Left&#x20;4&#x20;Dead&#x20;2 data-video=5952 href=https://club.steam250.com/app/550>"#;
        assert_eq!(
            parse_steam250(html),
            vec![
                ("1091500".into(), "Cyberpunk 2077".into()),
                ("42".into(), "Tom & Jerry".into()),
                ("550".into(), "Left 4 Dead 2".into())
            ]
        );
    }

    #[test]
    fn current_year_is_plausible() {
        assert!(chrono_year() >= 2026);
    }
}
