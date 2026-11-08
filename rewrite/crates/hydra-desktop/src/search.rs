//! title-bar-search.tsx + search-dropdown.tsx: recent searches (LevelDB
//! `searchHistory`, useSearchHistory) and suggestions (useSearchSuggestions:
//! the library on the library page, GET /catalogue/search/suggestions
//! elsewhere).

use std::cell::RefCell;
use std::collections::HashMap;
use std::time::Duration;

use hydra_core::api::Options;
use hydra_media::images::Op;
use serde_json::{Value, json};
use slint::{ComponentHandle, Image, ModelRc, SharedString, VecModel};

use crate::{AppWindow, Nav, SearchData, SearchPart, SearchSuggestionRow, nav, shell};

const HISTORY_KEY: &str = "searchHistory";
const MAX_HISTORY_ENTRIES: usize = 15;
const MAX_QUERY_LENGTH: usize = 255;

#[derive(Clone)]
struct HistoryEntry {
    query: String,
    timestamp: i64,
    context: String,
}

#[derive(Clone)]
struct Suggestion {
    title: String,
    object_id: String,
    shop: String,
    icon_url: Option<String>,
}

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    history: Vec<HistoryEntry>,
    suggestions: Vec<Suggestion>,
    /// the query the suggestions are for (HighlightText's currentQuery)
    suggestions_query: String,
    cache: HashMap<String, Vec<Suggestion>>,
    icons: HashMap<String, Image>,
    debounce: Option<slint::Timer>,
    /// bumped per request: older responses are dropped (AbortController)
    generation: u64,
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

fn route() -> String {
    ui().map(|ui| ui.global::<Nav>().get_route().to_string())
        .unwrap_or_default()
}

fn context() -> &'static str {
    if route() == "library" {
        "library"
    } else {
        "catalogue"
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

pub fn init(ui: &AppWindow) {
    let history: Vec<HistoryEntry> = shell::db()
        .and_then(|db| db.get::<Vec<Value>>(HISTORY_KEY))
        .unwrap_or_default()
        .iter()
        .map(|e| HistoryEntry {
            query: e
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            timestamp: e
                .get("timestamp")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            context: e
                .get("context")
                .and_then(Value::as_str)
                .unwrap_or("catalogue")
                .to_string(),
        })
        .filter(|e| !e.query.is_empty())
        .collect();
    with(|s| {
        s.ui = ui.as_weak();
        s.history = history;
        s.debounce = Some(slint::Timer::default());
    });
    let data = ui.global::<SearchData>();
    data.on_text_edited(|_| refresh());
    data.on_select_history(|query| execute(&query));
    data.on_remove_history(|query| {
        with(|s| s.history.retain(|e| e.query != query.as_str()));
        save_history();
        apply();
    });
    data.on_clear_history(|| {
        with(|s| s.history.clear());
        if let Some(db) = shell::db() {
            let _ = db.delete(HISTORY_KEY);
        }
        apply();
    });
    data.on_select_suggestion(|index| {
        let Some(suggestion) = with(|s| s.suggestions.get(index as usize).cloned()) else {
            return;
        };
        close_and_blur();
        nav::navigate(&format!(
            "/game/{}/{}?title={}",
            suggestion.shop,
            suggestion.object_id,
            nav::encode(&suggestion.title)
        ));
    });
    data.on_set_shop(|shop| {
        if let Some(window) = self::ui() {
            window.global::<SearchData>().set_shop(shop);
        }
        refresh();
    });
    data.on_state_changed(refresh);
    apply();
}

fn save_history() {
    let history: Vec<Value> = with(|s| {
        s.history
            .iter()
            .map(|e| json!({ "query": e.query, "timestamp": e.timestamp, "context": e.context }))
            .collect()
    });
    if let Some(db) = shell::db() {
        let _ = db.put(HISTORY_KEY, &history);
    }
}

/// useSearchHistory.addToHistory
fn add_to_history(query: &str, context: &str) {
    let query = query.trim();
    if query.is_empty() {
        return;
    }
    with(|s| {
        let lower = query.to_lowercase();
        s.history.retain(|e| e.query.to_lowercase() != lower);
        s.history.insert(
            0,
            HistoryEntry {
                query: query.to_string(),
                timestamp: now_ms(),
                context: context.to_string(),
            },
        );
        s.history.truncate(MAX_HISTORY_ENTRIES);
    });
    save_history();
}

/// executeSearch: a history pick or Enter.
pub fn execute(query: &str) {
    let query: String = query.chars().take(MAX_QUERY_LENGTH).collect();
    if let Some(ui) = ui() {
        ui.global::<SearchData>().set_text(query.clone().into());
    }
    if !query.trim().is_empty() {
        add_to_history(&query, context());
    }
    crate::library_page::submit_search(&query);
    close_and_blur();
    apply();
}

fn close_and_blur() {
    if let Some(ui) = ui() {
        let data = ui.global::<SearchData>();
        data.set_open(false);
        data.set_active_index(-1);
        data.set_blur_request(data.get_blur_request() + 1);
    }
}

/// localSearchValue follows the library query or the catalogue title when
/// the page changes.
pub fn sync_text(route: &str) {
    let text = if route == "library" {
        crate::library_page::query()
    } else {
        crate::catalogue_page::title()
    };
    if let Some(ui) = ui() {
        ui.global::<SearchData>().set_text(text.into());
    }
    refresh();
}

/// useSearchSuggestions: runs while the dropdown is open and focused, never
/// on the catalogue page.
fn refresh() {
    let Some(ui) = ui() else { return };
    let data = ui.global::<SearchData>();
    let query = data.get_text().to_string();
    let enabled = data.get_open() && data.get_focused() && route() != "catalogue";
    let generation = with(|s| {
        s.generation += 1;
        if let Some(timer) = &s.debounce {
            timer.stop();
        }
        s.generation
    });
    if !enabled || query.chars().count() < 2 {
        with(|s| s.suggestions.clear());
        data.set_loading(false);
        apply();
        return;
    }
    if route() == "library" {
        let found = library_suggestions(&query, 3);
        with(|s| {
            s.suggestions = found;
            s.suggestions_query = query;
        });
        data.set_loading(false);
        apply();
        return;
    }
    let shop = data.get_shop().to_string();
    let key = format!("{}_3_{shop}", query.to_lowercase());
    if let Some(cached) = with(|s| s.cache.get(&key).cloned()) {
        with(|s| {
            s.suggestions = cached;
            s.suggestions_query = query;
        });
        data.set_loading(false);
        apply();
        return;
    }
    // debounce(fetchCatalogueSuggestions, 300)
    with(|s| {
        if let Some(timer) = &s.debounce {
            timer.start(
                slint::TimerMode::SingleShot,
                Duration::from_millis(300),
                move || fetch_catalogue(query.clone(), shop.clone(), key.clone(), generation),
            );
        }
    });
}

fn fetch_catalogue(query: String, shop: String, key: String, generation: u64) {
    let Some(api) = shell::api() else { return };
    if let Some(ui) = ui() {
        ui.global::<SearchData>().set_loading(true);
    }
    apply();
    std::thread::spawn(move || {
        let response = api.get(
            "/catalogue/search/suggestions",
            &[
                ("query", query.clone()),
                ("limit", "3".into()),
                ("shop", shop),
            ],
            Options::public(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation {
                return;
            }
            let list: Vec<Suggestion> = match response {
                Ok(Value::Array(items)) => items
                    .iter()
                    .map(|item| {
                        let text = |k: &str| {
                            item.get(k)
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string()
                        };
                        Suggestion {
                            title: text("title"),
                            object_id: text("objectId"),
                            shop: text("shop"),
                            icon_url: Some(text("iconUrl")).filter(|u| !u.is_empty()),
                        }
                    })
                    .collect(),
                Ok(_) => Vec::new(),
                Err(error) => {
                    eprintln!("Failed to fetch catalogue suggestions: {error}");
                    Vec::new()
                }
            };
            with(|s| {
                s.cache.insert(key, list.clone());
                s.suggestions = list;
                s.suggestions_query = query;
            });
            if let Some(ui) = ui() {
                ui.global::<SearchData>().set_loading(false);
            }
            apply();
        });
    });
}

/// getLibrarySuggestions: a substring match, or the query's letters in order.
fn library_suggestions(query: &str, limit: usize) -> Vec<Suggestion> {
    let normalized = query.trim().to_lowercase();
    if normalized.chars().count() < 2 {
        return Vec::new();
    }
    let games = shell::library_games();
    let mut matches = Vec::new();
    for (title, object_id, shop, icon_url) in games {
        if matches.len() >= limit {
            break;
        }
        let lower = title.to_lowercase();
        let found = lower.contains(&normalized) || {
            let mut wanted = normalized.chars().peekable();
            for c in lower.chars() {
                if wanted.peek() == Some(&c) {
                    wanted.next();
                }
            }
            wanted.peek().is_none()
        };
        if found {
            matches.push(Suggestion {
                title,
                object_id,
                shop,
                icon_url,
            });
        }
    }
    matches
}

/// HighlightText: whole words of the query, merged, in order.
fn highlight(text: &str, query: &str) -> Vec<SearchPart> {
    let plain = |t: &str| SearchPart {
        text: t.into(),
        highlight: false,
    };
    let words: Vec<String> = query
        .to_lowercase()
        .split_whitespace()
        .map(str::to_string)
        .collect();
    if words.is_empty() {
        return vec![plain(text)];
    }
    let lower = text.to_lowercase();
    // byte offsets line up only while lowercasing keeps lengths; otherwise skip
    if lower.len() != text.len() {
        return vec![plain(text)];
    }
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for word in &words {
        let mut from = 0;
        while let Some(found) = lower[from..].find(word.as_str()) {
            let start = from + found;
            let end = start + word.len();
            let before_ok = start == 0 || lower[..start].ends_with(char::is_whitespace);
            let after_ok = end == lower.len() || lower[end..].starts_with(char::is_whitespace);
            if before_ok && after_ok {
                ranges.push((start, end));
            }
            from = start + word.len().max(1);
            if from >= lower.len() {
                break;
            }
        }
    }
    if ranges.is_empty() {
        return vec![plain(text)];
    }
    ranges.sort();
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (start, end) in ranges {
        match merged.last_mut() {
            Some(last) if start <= last.1 => last.1 = last.1.max(end),
            _ => merged.push((start, end)),
        }
    }
    let mut parts = Vec::new();
    let mut last = 0;
    for (start, end) in merged {
        if start > last {
            parts.push(plain(&text[last..start]));
        }
        parts.push(SearchPart {
            text: text[start..end].into(),
            highlight: true,
        });
        last = end;
    }
    if last < text.len() {
        parts.push(plain(&text[last..]));
    }
    parts
}

fn apply() {
    let Some(ui) = ui() else { return };
    let data = ui.global::<SearchData>();
    let context = context();
    let history: Vec<SharedString> = with(|s| {
        s.history
            .iter()
            .filter(|e| e.context == context)
            .take(3)
            .map(|e| e.query.clone().into())
            .collect()
    });
    let (suggestions, query) = with(|s| (s.suggestions.clone(), s.suggestions_query.clone()));
    let mut wanted = Vec::new();
    let rows: Vec<SearchSuggestionRow> = suggestions
        .iter()
        .map(|item| {
            let icon = item.icon_url.as_ref().and_then(|url| {
                wanted.push(url.clone());
                with(|s| s.icons.get(url).cloned())
            });
            SearchSuggestionRow {
                parts: ModelRc::new(VecModel::from(highlight(&item.title, &query))),
                title: item.title.clone().into(),
                has_icon: item.icon_url.is_some(),
                icon: icon.unwrap_or_default(),
            }
        })
        .collect();
    data.set_history(ModelRc::new(VecModel::from(history)));
    data.set_suggestions(ModelRc::new(VecModel::from(rows)));
    data.set_show_shop_switch(route() != "library");
    load_icons(wanted);
}

fn load_icons(urls: Vec<String>) {
    let Some((loader, scale)) = shell::loader() else {
        return;
    };
    for url in urls {
        if with(|s| s.icons.contains_key(&url)) {
            continue;
        }
        with(|s| s.icons.insert(url.clone(), Image::default()));
        let key = url.clone();
        loader.load(
            url,
            Op::MaxWidth((16.0 * scale).ceil() as u32),
            move |img| {
                with(|s| s.icons.insert(key, img));
                apply();
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::highlight;

    fn render(text: &str, query: &str) -> String {
        highlight(text, query)
            .iter()
            .map(|p| {
                if p.highlight {
                    format!("[{}]", p.text)
                } else {
                    p.text.to_string()
                }
            })
            .collect()
    }

    #[test]
    fn highlights_whole_words_only() {
        assert_eq!(render("God of War", "war"), "God of [War]");
        assert_eq!(render("Warframe", "war"), "Warframe");
        assert_eq!(render("God of War", "god war"), "[God] of [War]");
        assert_eq!(render("Hades", ""), "Hades");
    }
}
