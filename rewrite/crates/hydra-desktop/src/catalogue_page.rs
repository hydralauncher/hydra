//! The catalogue: src/renderer/src/pages/catalogue/catalogue.tsx with
//! game-item.tsx, filter-section.tsx, release-year-section.tsx and
//! pagination.tsx; useCatalogue (developers/publishers/download sources,
//! Steam genres and tags) and the catalogueSearch slice, which keeps the
//! filters, page and mode for the session.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use hydra_core::api::Options;
use hydra_db::keys;
use hydra_media::images::{Loader, Op};
use serde_json::{Map, Value, json};
use slint::{Color, ComponentHandle, Image, Model, ModelRc, SharedString, VecModel};

use crate::{
    AppWindow, CatalogueData, CatalogueItem, FilterChip, FilterOption, FilterSectionData,
    SelectOption, nav, shell,
};

const PAGE_SIZE: usize = 30;
const MIN_RELEASE_YEAR: i32 = 1970;
/// get-catalogue-names.ts keeps the lists for a day.
const NAMES_CACHE_MS: i64 = 24 * 60 * 60 * 1000;
const STEAM_METADATA_LANGUAGES: [&str; 5] = ["en", "es", "pt", "ru", "fr"];

/// filterCategoryColors
fn category_color(key: &str) -> Color {
    let hsl = |h: f32, s: f32, l: f32| {
        let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
        let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
        let m = l - c / 2.0;
        let (r, g, b) = match (h / 60.0) as i32 {
            0 => (c, x, 0.0),
            1 => (x, c, 0.0),
            2 => (0.0, c, x),
            3 => (0.0, x, c),
            4 => (x, 0.0, c),
            _ => (c, 0.0, x),
        };
        Color::from_rgb_f32(r + m, g + m, b + m)
    };
    match key {
        "genres" => hsl(262.0, 0.5, 0.47),
        "tags" => hsl(95.0, 0.5, 0.20),
        "downloadSourceFingerprints" => hsl(27.0, 0.5, 0.40),
        "developers" => hsl(340.0, 0.5, 0.46),
        "publishers" => hsl(200.0, 0.5, 0.30),
        "releaseYear" => hsl(38.0, 0.5, 0.40),
        "platforms" => hsl(170.0, 0.5, 0.36),
        _ => Color::from_rgb_u8(0xF5, 0x00, 0x57),
    }
}

#[derive(Clone, Default)]
struct Filters {
    title: String,
    sort_by: String,
    sort_order: String,
    genres: Vec<String>,
    /// Steam tag ids
    tags: Vec<i64>,
    download_source_fingerprints: Vec<String>,
    developers: Vec<String>,
    publishers: Vec<String>,
    protondb: Vec<String>,
    deck: Vec<String>,
    release_year: Option<(Option<i32>, Option<i32>)>,
    platforms: Vec<String>,
    recompilation: Option<String>,
}

impl Filters {
    fn initial() -> Self {
        Filters {
            sort_by: "popularity".into(),
            sort_order: "desc".into(),
            ..Default::default()
        }
    }
}

struct Page {
    ui: slint::Weak<AppWindow>,
    loader: Loader,
    filters: Filters,
    page: usize,
    mode: String,
    request: u64,
    search_timer: slint::Timer,
    results: Vec<Value>,
    count: u64,
    loading: bool,
    has_results: bool,
    /// Steam genres per language (index-aligned with "en").
    genres: HashMap<String, Vec<String>>,
    /// Steam tags per language: name -> id.
    tags: HashMap<String, Vec<(String, i64)>>,
    developers: Option<Vec<String>>,
    publishers: Option<Vec<String>>,
    download_sources: Option<Vec<Value>>,
    /// Each filter section's search box.
    section_search: HashMap<String, String>,
    adding: HashSet<String>,
    items: Rc<VecModel<CatalogueItem>>,
}

thread_local! {
    static PAGE: RefCell<Option<Page>> = const { RefCell::new(None) };
}

fn with_page<R>(f: impl FnOnce(&mut Page) -> R) -> Option<R> {
    PAGE.with(|p| p.borrow_mut().as_mut().map(f))
}

fn language() -> String {
    shell::i18n()
        .map(|i| i.language().split('-').next().unwrap_or("en").to_string())
        .unwrap_or_else(|| "en".into())
}

fn format_number(value: f64) -> String {
    shell::i18n()
        .map(|i| i.format_number(value))
        .unwrap_or_else(|| value.to_string())
}

pub fn init(ui: &AppWindow, loader: &Loader) {
    let items = Rc::new(VecModel::from(Vec::<CatalogueItem>::new()));
    let data = ui.global::<CatalogueData>();
    data.set_items(ModelRc::from(items.clone()));
    let year = current_year();
    data.set_year_max(year);
    data.set_year_lte(year);
    PAGE.with(|p| {
        *p.borrow_mut() = Some(Page {
            ui: ui.as_weak(),
            loader: loader.clone(),
            filters: Filters::initial(),
            page: 1,
            mode: "modern".into(),
            request: 0,
            search_timer: slint::Timer::default(),
            results: Vec::new(),
            count: 0,
            loading: true,
            has_results: false,
            genres: HashMap::new(),
            tags: HashMap::new(),
            developers: None,
            publishers: None,
            download_sources: None,
            section_search: HashMap::new(),
            adding: HashSet::new(),
            items,
        })
    });

    data.on_format_page(|n| format_number(n as f64).into());
    data.on_open_item(|index| {
        let game = with_page(|p| p.results.get(index as usize).cloned()).flatten();
        if let Some(game) = game {
            let s = |k: &str| {
                game.get(k)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            };
            nav::navigate(&format!(
                "/game/{}/{}?title={}",
                s("shop"),
                s("objectId"),
                nav::encode(&s("title"))
            ));
        }
    });
    data.on_add_item(|index| add_item(index as usize));
    data.on_set_sort(|value| set_sort(&value));
    data.on_set_mode(|mode| {
        // setMode: page 1 and the category filters cleared.
        let changed = with_page(|p| {
            if p.mode == mode.as_str() {
                return false;
            }
            p.mode = mode.to_string();
            p.page = 1;
            let f = &mut p.filters;
            f.tags.clear();
            f.genres.clear();
            f.developers.clear();
            f.publishers.clear();
            f.download_source_fingerprints.clear();
            f.protondb.clear();
            f.deck.clear();
            f.release_year = None;
            f.platforms.clear();
            f.recompilation = None;
            true
        })
        .unwrap_or(false);
        if changed {
            refresh(true);
        }
    });
    data.on_set_page(|page| {
        with_page(|p| p.page = page.max(1) as usize);
        if let Some(ui) = with_page(|p| p.ui.upgrade()).flatten() {
            let data = ui.global::<CatalogueData>();
            data.set_scroll_reset(data.get_scroll_reset() + 1);
        }
        refresh(true);
    });
    data.on_remove_chip(|key, value| {
        with_page(|p| {
            let f = &mut p.filters;
            match key.as_str() {
                "releaseYear" => f.release_year = None,
                "recompilation" => f.recompilation = None,
                "protondbSupportBadges" => f.protondb.clear(),
                "deckCompatibility" => f.deck.clear(),
                "tags" => f.tags.retain(|t| t.to_string() != value.as_str()),
                other => {
                    if let Some(list) = string_list(f, other) {
                        list.retain(|v| v != value.as_str());
                    }
                }
            }
            p.page = 1;
        });
        refresh(true);
    });
    data.on_clear_all(|| {
        with_page(|p| {
            let f = &mut p.filters;
            f.genres.clear();
            f.tags.clear();
            f.download_source_fingerprints.clear();
            f.developers.clear();
            f.publishers.clear();
            f.protondb.clear();
            f.deck.clear();
            f.release_year = None;
            f.platforms.clear();
            f.recompilation = None;
            p.page = 1;
        });
        refresh(true);
    });
    data.on_toggle_option(|key, value| {
        with_page(|p| {
            let f = &mut p.filters;
            if key.as_str() == "tags" {
                if let Ok(id) = value.parse::<i64>() {
                    if f.tags.contains(&id) {
                        f.tags.retain(|t| *t != id);
                    } else {
                        f.tags.push(id);
                    }
                }
            } else if let Some(list) = string_list(f, &key) {
                if list.iter().any(|v| v == value.as_str()) {
                    list.retain(|v| v != value.as_str());
                } else {
                    list.push(value.to_string());
                }
            }
            p.page = 1;
        });
        refresh(true);
    });
    data.on_clear_section(|key| {
        with_page(|p| {
            if key.as_str() == "tags" {
                p.filters.tags.clear();
            } else if let Some(list) = string_list(&mut p.filters, &key) {
                list.clear();
            }
            p.page = 1;
        });
        refresh(true);
    });
    data.on_search_section(|key, text| {
        with_page(|p| p.section_search.insert(key.to_string(), text.to_string()));
        apply_sections();
    });
    data.on_set_years(move |gte, lte| {
        with_page(|p| {
            // emit(): the ends of the range mean "no bound".
            let gte = (gte != MIN_RELEASE_YEAR).then_some(gte);
            let lte = (lte != year).then_some(lte);
            p.filters.release_year = if gte.is_none() && lte.is_none() {
                None
            } else {
                Some((gte, lte))
            };
            p.page = 1;
        });
        refresh(true);
    });
    data.on_clear_years(|| {
        with_page(|p| {
            p.filters.release_year = None;
            p.page = 1;
        });
        refresh(true);
    });
    data.set_sort_options(ModelRc::new(VecModel::from(sort_options())));
}

fn string_list<'a>(f: &'a mut Filters, key: &str) -> Option<&'a mut Vec<String>> {
    Some(match key {
        "genres" => &mut f.genres,
        "downloadSourceFingerprints" => &mut f.download_source_fingerprints,
        "developers" => &mut f.developers,
        "publishers" => &mut f.publishers,
        "platforms" => &mut f.platforms,
        _ => return None,
    })
}

fn sort_options() -> Vec<SelectOption> {
    [
        ("popularity:desc", "catalogue.sort_popularity"),
        ("releaseDate:desc", "catalogue.sort_newest"),
        ("releaseDate:asc", "catalogue.sort_oldest"),
        ("alphabetical:asc", "catalogue.sort_title_asc"),
        ("alphabetical:desc", "catalogue.sort_title_desc"),
        ("hydraScore:desc", "catalogue.sort_highest_rating"),
        ("hydraScore:asc", "catalogue.sort_lowest_rating"),
    ]
    .iter()
    .map(|(value, key)| SelectOption {
        value: (*value).into(),
        label: shell::tr(key).into(),
    })
    .collect()
}

/// The <select> popup picked a sort.
pub fn set_sort(value: &str) {
    let Some((by, order)) = value.split_once(':') else {
        return;
    };
    with_page(|p| {
        p.filters.sort_by = by.to_string();
        p.filters.sort_order = order.to_string();
        p.page = 1;
    });
    refresh(true);
}

/// The title bar search on the catalogue (setFilters({ title }), debounced 250ms there).
pub fn set_title(title: &str) {
    let changed = with_page(|p| {
        if p.filters.title == title {
            return false;
        }
        p.filters.title = title.to_string();
        p.page = 1;
        true
    })
    .unwrap_or(false);
    if changed {
        refresh(true);
    }
}

pub fn title() -> String {
    with_page(|p| p.filters.title.clone()).unwrap_or_default()
}

/// Entering the page (useCatalogue mounts): lists and a search.
pub fn open() {
    load_lists();
    refresh(true);
}

pub fn shutdown() {
    let page = PAGE.with(|p| p.borrow_mut().take());
    drop(page);
}

fn current_year() -> i32 {
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
    (yoe + era * 400 + i64::from(month <= 2)) as i32
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// useCatalogue: genres/tags per language, developers/publishers (24h
/// cache), download sources. Each kept for the session.
fn load_lists() {
    let (Some(api), Some(db)) = (shell::api(), shell::db()) else {
        return;
    };
    let ui_language = language();
    let request_language = if STEAM_METADATA_LANGUAGES.contains(&ui_language.as_str()) {
        ui_language.clone()
    } else {
        "en".to_string()
    };
    let languages: Vec<String> = if request_language == "en" {
        vec!["en".into()]
    } else {
        vec!["en".into(), request_language.clone()]
    };
    let have_metadata = with_page(|p| p.genres.contains_key(&ui_language)).unwrap_or(false);
    if !have_metadata {
        let api = api.clone();
        std::thread::spawn(move || {
            let mut genres = HashMap::new();
            let mut tags = HashMap::new();
            for language in &languages {
                if let Ok(Value::Array(list)) = api.get(
                    "/catalogue/steam/genres",
                    &[("language", language.clone())],
                    Options::default(),
                ) {
                    genres.insert(
                        language.clone(),
                        list.iter()
                            .filter_map(|v| v.as_str().map(str::to_string))
                            .collect::<Vec<_>>(),
                    );
                }
                if let Ok(Value::Object(map)) = api.get(
                    "/catalogue/steam/tags",
                    &[("language", language.clone())],
                    Options::default(),
                ) {
                    tags.insert(
                        language.clone(),
                        map.iter()
                            .filter_map(|(k, v)| Some((k.clone(), v.as_i64()?)))
                            .collect::<Vec<_>>(),
                    );
                }
            }
            // metadata[language] ??= metadata[requestLanguage]
            if let Some(g) = genres.get(&request_language).cloned() {
                genres.entry(ui_language.clone()).or_insert(g);
            }
            if let Some(t) = tags.get(&request_language).cloned() {
                tags.entry(ui_language.clone()).or_insert(t);
            }
            let _ = slint::invoke_from_event_loop(move || {
                with_page(|p| {
                    p.genres.extend(genres);
                    p.tags.extend(tags);
                });
                apply_sections();
                apply_results();
            });
        });
    }
    for list in ["developers", "publishers"] {
        let loaded = with_page(|p| {
            if list == "developers" {
                p.developers.is_some()
            } else {
                p.publishers.is_some()
            }
        })
        .unwrap_or(false);
        if loaded {
            continue;
        }
        let (api, db) = (api.clone(), db.clone());
        std::thread::spawn(move || {
            let names = catalogue_names(&db, &api, list).unwrap_or_default();
            let _ = slint::invoke_from_event_loop(move || {
                with_page(|p| {
                    if list == "developers" {
                        p.developers = Some(names);
                    } else {
                        p.publishers = Some(names);
                    }
                });
                apply_sections();
            });
        });
    }
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
    with_page(|p| p.download_sources = Some(sources));
    apply_sections();
}

/// get-catalogue-names.ts
fn catalogue_names(
    db: &hydra_db::Db,
    api: &hydra_core::api::HydraApi,
    list: &str,
) -> Option<Vec<String>> {
    let key = format!("steam:{list}");
    let cached: Option<Value> = db.get_in(keys::CATALOGUE_NAMES_CACHE, &key);
    let cached_names = |c: &Value| -> Vec<String> {
        c.get("names")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };
    if let Some(c) = &cached
        && c.get("updatedAt")
            .and_then(Value::as_i64)
            .is_some_and(|at| at + NAMES_CACHE_MS > now_ms())
    {
        return Some(cached_names(c));
    }
    match api.get(&format!("/catalogue/steam/{list}"), &[], Options::default()) {
        Ok(Value::Array(items)) => {
            let names: Vec<String> = items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect();
            let _ = db.put_in(
                keys::CATALOGUE_NAMES_CACHE,
                &key,
                &json!({ "names": names, "updatedAt": now_ms() }),
            );
            Some(names)
        }
        _ => cached.as_ref().map(cached_names),
    }
}

fn decode_html(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

/// Rebuild the filter rail (sections, counts, chips) from the state.
fn apply_sections() {
    let Some(ui) = with_page(|p| p.ui.upgrade()).flatten() else {
        return;
    };
    let language = language();
    let t = |k: &str| shell::tr(k);
    let sections_state = with_page(|p| {
        let f = &p.filters;
        let genre_names: Vec<(String, String)> = {
            // steamGenresMapping: localized -> English, sorted by localized name
            let en = p.genres.get("en").cloned().unwrap_or_default();
            let local = p.genres.get(&language).cloned().unwrap_or_default();
            let mut pairs: Vec<(String, String)> = local
                .iter()
                .enumerate()
                .filter_map(|(i, name)| Some((name.clone(), en.get(i)?.clone())))
                .collect();
            pairs.sort_by(|a, b| a.0.cmp(&b.0));
            pairs.dedup_by(|a, b| a.0 == b.0);
            pairs
        };
        let mut tag_names: Vec<(String, i64)> = p.tags.get(&language).cloned().unwrap_or_default();
        tag_names.sort_by(|a, b| a.0.cmp(&b.0));
        let sources: Vec<(String, String)> = p
            .download_sources
            .as_ref()
            .map(|s| {
                s.iter()
                    .filter_map(|v| {
                        let fp = v
                            .get("fingerprint")
                            .and_then(Value::as_str)
                            .filter(|f| !f.is_empty())?;
                        Some((
                            v.get("name")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                            fp.to_string(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let developers = p.developers.clone();
        let publishers = p.publishers.clone();

        type Section = (&'static str, String, Vec<(String, String, bool)>, bool);
        let sections: Vec<Section> = vec![
            (
                "genres",
                t("catalogue.genres"),
                genre_names
                    .iter()
                    .map(|(label, value)| (label.clone(), value.clone(), f.genres.contains(value)))
                    .collect(),
                !p.genres.contains_key(&language),
            ),
            (
                "tags",
                t("catalogue.tags"),
                tag_names
                    .iter()
                    .map(|(label, id)| (label.clone(), id.to_string(), f.tags.contains(id)))
                    .collect(),
                !p.tags.contains_key(&language),
            ),
            (
                "downloadSourceFingerprints",
                t("catalogue.download_sources"),
                sources
                    .iter()
                    .map(|(name, fp)| {
                        (
                            name.clone(),
                            fp.clone(),
                            f.download_source_fingerprints.contains(fp),
                        )
                    })
                    .collect(),
                p.download_sources.is_none(),
            ),
            (
                "developers",
                t("catalogue.developers"),
                developers
                    .as_ref()
                    .map(|d| {
                        d.iter()
                            .map(|n| (n.clone(), n.clone(), f.developers.contains(n)))
                            .collect()
                    })
                    .unwrap_or_default(),
                developers.is_none(),
            ),
            (
                "publishers",
                t("catalogue.publishers"),
                publishers
                    .as_ref()
                    .map(|d| {
                        d.iter()
                            .map(|n| (decode_html(n), n.clone(), f.publishers.contains(n)))
                            .collect()
                    })
                    .unwrap_or_default(),
                publishers.is_none(),
            ),
        ];

        // Active chips (groupedFilters), in the renderer's order.
        let mut chips: Vec<FilterChip> = Vec::new();
        let chip = |label: String, kind: String, key: &str, value: String| FilterChip {
            label: label.into(),
            kind: kind.into(),
            color: category_color(key),
            key: key.into(),
            value: value.into(),
        };
        for genre in &f.genres {
            let label = genre_names
                .iter()
                .find(|(_, v)| v == genre)
                .map(|(l, _)| l.clone())
                .unwrap_or_default();
            chips.push(chip(label, t("catalogue.genres"), "genres", genre.clone()));
        }
        for tag in &f.tags {
            let label = tag_names
                .iter()
                .find(|(_, id)| id == tag)
                .map(|(l, _)| l.clone())
                .unwrap_or_default();
            chips.push(chip(label, t("catalogue.tags"), "tags", tag.to_string()));
        }
        for fp in &f.download_source_fingerprints {
            let label = sources
                .iter()
                .find(|(_, v)| v == fp)
                .map(|(l, _)| l.clone())
                .unwrap_or_default();
            chips.push(chip(
                label,
                t("catalogue.download_sources"),
                "downloadSourceFingerprints",
                fp.clone(),
            ));
        }
        for developer in &f.developers {
            chips.push(chip(
                developer.clone(),
                t("catalogue.developers"),
                "developers",
                developer.clone(),
            ));
        }
        for publisher in &f.publishers {
            chips.push(chip(
                decode_html(publisher),
                t("catalogue.publishers"),
                "publishers",
                publisher.clone(),
            ));
        }
        if let Some((gte, lte)) = f.release_year {
            chips.push(chip(
                format!(
                    "{} – {}",
                    gte.unwrap_or(MIN_RELEASE_YEAR),
                    lte.unwrap_or_else(current_year)
                ),
                t("catalogue.release_year"),
                "releaseYear",
                "range".into(),
            ));
        }
        (sections, chips, p.section_search.clone(), f.release_year)
    });
    let Some((sections, chips, search, release_year)) = sections_state else {
        return;
    };
    let models: Vec<FilterSectionData> = sections
        .into_iter()
        .map(|(key, title, items, loading)| {
            let selected = items.iter().filter(|i| i.2).count();
            let query = search
                .get(key)
                .map(|s| s.to_lowercase())
                .unwrap_or_default();
            let shown: Vec<FilterOption> = items
                .iter()
                .filter(|(label, _, _)| query.is_empty() || label.to_lowercase().contains(&query))
                .map(|(label, value, checked)| FilterOption {
                    label: label.into(),
                    value: value.into(),
                    checked: *checked,
                })
                .collect();
            let hint = if selected > 0 {
                shell::tr_with(
                    "catalogue.clear_filters",
                    &[("filterCount", format_number(selected as f64).into())],
                )
            } else {
                shell::tr_with(
                    "catalogue.filter_count",
                    &[("filterCount", format_number(items.len() as f64).into())],
                )
            };
            FilterSectionData {
                key: key.into(),
                title: title.into(),
                color: category_color(key),
                count: format_number(if selected > 0 { selected } else { items.len() } as f64)
                    .into(),
                selected: selected as i32,
                hint: hint.into(),
                loading,
                total: items.len() as i32,
                items: ModelRc::new(VecModel::from(shown)),
            }
        })
        .collect();
    let data = ui.global::<CatalogueData>();
    let chip_count = chips.len();
    data.set_sections(ModelRc::new(VecModel::from(models)));
    data.set_chips(ModelRc::new(VecModel::from(chips)));
    data.set_show_hint(chip_count == 0);
    data.set_clear_all_label(
        shell::tr_with(
            "catalogue.clear_filters",
            &[("filterCount", format_number(chip_count as f64).into())],
        )
        .into(),
    );
    data.set_active_filters_label(shell::tr("catalogue.active_filters").to_uppercase().into());
    let year = current_year();
    data.set_year_gte(
        release_year
            .and_then(|(g, _)| g)
            .unwrap_or(MIN_RELEASE_YEAR),
    );
    data.set_year_lte(release_year.and_then(|(_, l)| l).unwrap_or(year));
    data.set_year_active(release_year.is_some());
    with_page(|p| {
        data.set_mode(p.mode.clone().into());
        let sort = format!("{}:{}", p.filters.sort_by, p.filters.sort_order);
        let label = sort_options()
            .into_iter()
            .find(|o| o.value == sort.as_str())
            .map(|o| o.label)
            .unwrap_or_default();
        data.set_sort(sort.into());
        data.set_sort_label(label);
        data.set_page(p.page as i32);
    });
}

/// Filters changed: rebuild the rail at once and search after 500ms.
fn refresh(_reset: bool) {
    apply_sections();
    let Some(request) = with_page(|p| {
        p.request += 1;
        // Keep the old results on screen while a new search runs.
        if !p.has_results {
            p.loading = true;
        }
        p.request
    }) else {
        return;
    };
    if let Some(ui) = with_page(|p| p.ui.upgrade()).flatten() {
        let loading = with_page(|p| p.loading).unwrap_or(true);
        ui.global::<CatalogueData>().set_loading(loading);
    }
    with_page(|p| {
        p.search_timer.start(
            slint::TimerMode::SingleShot,
            std::time::Duration::from_millis(500),
            move || search(request),
        );
    });
}

/// POST /catalogue/search
fn search(request: u64) {
    let Some((body, current)) = with_page(|p| {
        let f = &p.filters;
        let mut body = Map::new();
        body.insert("title".into(), json!(f.title));
        body.insert("sortBy".into(), json!(f.sort_by));
        body.insert("sortOrder".into(), json!(f.sort_order));
        body.insert(
            "downloadSourceFingerprints".into(),
            json!(f.download_source_fingerprints),
        );
        body.insert("tags".into(), json!(f.tags));
        body.insert("publishers".into(), json!(f.publishers));
        body.insert("genres".into(), json!(f.genres));
        body.insert("developers".into(), json!(f.developers));
        body.insert("protondbSupportBadges".into(), json!(f.protondb));
        body.insert("deckCompatibility".into(), json!(f.deck));
        if let Some((gte, lte)) = f.release_year {
            let mut range = Map::new();
            if let Some(gte) = gte {
                range.insert("gte".into(), json!(gte));
            }
            if let Some(lte) = lte {
                range.insert("lte".into(), json!(lte));
            }
            body.insert("releaseYear".into(), Value::Object(range));
        }
        if let Some(r) = &f.recompilation {
            body.insert("recompilation".into(), json!(r));
        }
        body.insert("take".into(), json!(PAGE_SIZE));
        body.insert("skip".into(), json!((p.page - 1) * PAGE_SIZE));
        let ids: Vec<Value> = p
            .download_sources
            .as_ref()
            .map(|s| s.iter().filter_map(|v| v.get("id").cloned()).collect())
            .unwrap_or_default();
        body.insert("downloadSourceIds".into(), Value::Array(ids));
        if p.mode == "classics" {
            body.insert("shops".into(), json!(["launchbox"]));
            body.insert("platforms".into(), json!(f.platforms));
        }
        (Value::Object(body), p.request)
    }) else {
        return;
    };
    if current != request {
        return;
    }
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let response = api.post("/catalogue/search", &body, Options::default());
        let _ = slint::invoke_from_event_loop(move || {
            let stale = with_page(|p| p.request != request).unwrap_or(true);
            if stale {
                return;
            }
            match response {
                Ok(response) => {
                    let edges = response
                        .get("edges")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    let count = response.get("count").and_then(Value::as_u64).unwrap_or(0);
                    with_page(|p| {
                        p.results = edges;
                        p.count = count;
                        p.loading = false;
                        p.has_results = !p.results.is_empty();
                    });
                    apply_results();
                }
                Err(error) => eprintln!("catalogue search: {error}"),
            }
        });
    });
}

fn library_keys() -> HashSet<String> {
    shell::library_snapshot()
        .map(|(groups, _, _)| {
            groups
                .iter()
                .flat_map(|g| g.members.iter().map(|m| m.identity_key()))
                .collect()
        })
        .unwrap_or_default()
}

/// Results -> rows (localized genres, covers lazy-loaded).
fn apply_results() {
    let language = language();
    let library = library_keys();
    let Some((ui, loader, items, rows, count, page, request, loading)) = with_page(|p| {
        let en = p.genres.get("en").cloned().unwrap_or_default();
        let local = p.genres.get(&language).cloned();
        let rows: Vec<CatalogueItem> = p
            .results
            .iter()
            .map(|game| {
                let s = |k: &str| {
                    game.get(k)
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string()
                };
                let genres: Vec<String> = game
                    .get("genres")
                    .and_then(Value::as_array)
                    .map(|g| {
                        g.iter()
                            .filter_map(Value::as_str)
                            .map(|genre| {
                                en.iter()
                                    .position(|e| e == genre)
                                    .and_then(|i| local.as_ref()?.get(i).cloned())
                                    .unwrap_or_else(|| genre.to_string())
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                let key = format!("{}:{}", s("shop"), s("objectId"));
                CatalogueItem {
                    title: s("title").into(),
                    genres: genres.join(", ").into(),
                    cover: Image::default(),
                    has_cover: game
                        .get("libraryImageUrl")
                        .and_then(Value::as_str)
                        .is_some_and(|u| !u.is_empty()),
                    sources: ModelRc::new(VecModel::from(
                        game.get("downloadSources")
                            .and_then(Value::as_array)
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(SharedString::from))
                                    .collect::<Vec<_>>()
                            })
                            .unwrap_or_default(),
                    )),
                    added: library.contains(&key),
                    adding: p.adding.contains(&key),
                }
            })
            .collect();
        (
            p.ui.clone(),
            p.loader.clone(),
            p.items.clone(),
            rows,
            p.count,
            p.page,
            p.request,
            p.loading,
        )
    }) else {
        return;
    };
    let covers: Vec<Option<String>> = with_page(|p| {
        p.results
            .iter()
            .map(|g| {
                g.get("libraryImageUrl")
                    .and_then(Value::as_str)
                    .filter(|u| !u.is_empty())
                    .map(str::to_string)
            })
            .collect()
    })
    .unwrap_or_default();
    items.set_vec(rows);
    if let Some(window) = ui.upgrade() {
        let data = window.global::<CatalogueData>();
        data.set_loading(loading);
        data.set_result_count(
            shell::tr_with(
                "catalogue.result_count",
                &[("resultCount", format_number(count as f64).into())],
            )
            .into(),
        );
        data.set_total_pages(count.div_ceil(PAGE_SIZE as u64) as i32);
        data.set_page(page as i32);
        let scale = window.window().scale_factor();
        for (index, url) in covers.into_iter().enumerate() {
            let Some(url) = url else { continue };
            loader.load(
                url,
                Op::MaxWidth((200.0 * scale).ceil() as u32),
                move |img| {
                    with_page(|p| {
                        if p.request == request
                            && let Some(mut row) = p.items.row_data(index)
                        {
                            row.cover = img;
                            p.items.set_row_data(index, row);
                        }
                    });
                },
            );
        }
    }
}

/// addGameToLibrary from the "+" on a result.
fn add_item(index: usize) {
    let Some(game) = with_page(|p| p.results.get(index).cloned()).flatten() else {
        return;
    };
    let s = |k: &str| {
        game.get(k)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let (shop, object_id, title) = (s("shop"), s("objectId"), s("title"));
    let platform = game
        .get("platform")
        .and_then(Value::as_str)
        .map(str::to_string);
    let key = format!("{shop}:{object_id}");
    with_page(|p| p.adding.insert(key.clone()));
    apply_results();
    let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
        return;
    };
    std::thread::spawn(move || {
        let result = hydra_core::library_actions::add_to_library(
            &db,
            &api,
            &shop,
            &object_id,
            &title,
            platform.as_deref(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            if let Err(error) = result {
                eprintln!("addGameToLibrary: {error}");
            }
            with_page(|p| p.adding.remove(&key));
            shell::load_library();
        });
    });
}

/// The library reloaded: the check marks follow it.
pub fn on_library_changed() {
    if with_page(|p| !p.results.is_empty()).unwrap_or(false) {
        apply_results();
    }
}
