//! react-router's HashRouter history: push, back, forward, and which page is
//! mounted for a path (src/renderer/src/main.tsx routes).

use std::cell::RefCell;

use slint::ComponentHandle;

use crate::{AppWindow, Nav, catalogue_page, game_page, home_page, library_page, shell};

struct History {
    ui: slint::Weak<AppWindow>,
    entries: Vec<String>,
    index: usize,
}

thread_local! {
    static HISTORY: RefCell<Option<History>> = const { RefCell::new(None) };
}

/// A parsed location.
pub struct Location {
    pub pathname: String,
    pub query: Vec<(String, String)>,
}

impl Location {
    pub fn parse(path: &str) -> Self {
        let (pathname, query) = path.split_once('?').unwrap_or((path, ""));
        let query = query
            .split('&')
            .filter(|p| !p.is_empty())
            .map(|pair| {
                let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
                (decode(k), decode(v))
            })
            .collect();
        Location {
            pathname: if pathname.is_empty() {
                "/".into()
            } else {
                pathname.to_string()
            },
            query,
        }
    }

    pub fn param(&self, name: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    /// The route name the window switches on (Nav.route).
    pub fn route(&self) -> &'static str {
        let mut parts = self.pathname.trim_start_matches('/').split('/');
        match parts.next().unwrap_or("") {
            "" => "home",
            "catalogue" => "catalogue",
            "library" => "library",
            "downloads" => "downloads",
            "game" => "game",
            "recompilation" => "recompilation",
            "settings" => "settings",
            "profile" => "profile",
            "achievements" => "achievements",
            "notifications" => "notifications",
            "shop" => "shop",
            "leaderboards" => "leaderboards",
            _ => "home",
        }
    }
}

/// `URLSearchParams` decoding: `+` is a space, `%XX` escapes.
fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(byte) => {
                        out.push(byte);
                        i += 2;
                    }
                    None => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `encodeURIComponent`-style encoding for URLSearchParams values.
pub fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'*' => {
                out.push(byte as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

pub fn init(ui: &AppWindow, start: &str) {
    HISTORY.with(|h| {
        *h.borrow_mut() = Some(History {
            ui: ui.as_weak(),
            entries: vec![start.to_string()],
            index: 0,
        })
    });
    let nav = ui.global::<Nav>();
    nav.on_navigate(|path| navigate(&path));
    nav.on_back(|| go(-1));
    nav.on_forward(|| go(1));
    apply(None);
}

/// A fresh history at `start` (a new main window after closing to the tray).
pub fn reset(start: &str) {
    let previous = current();
    HISTORY.with(|h| {
        if let Some(h) = h.borrow_mut().as_mut() {
            h.entries = vec![start.to_string()];
            h.index = 0;
        }
    });
    apply(previous);
}

/// `navigate(path)`: a new entry; whatever was ahead is dropped.
pub fn navigate(path: &str) {
    let previous = current();
    HISTORY.with(|h| {
        if let Some(h) = h.borrow_mut().as_mut() {
            if h.entries.get(h.index).map(String::as_str) == Some(path) {
                return;
            }
            h.entries.truncate(h.index + 1);
            h.entries.push(path.to_string());
            h.index = h.entries.len() - 1;
        }
    });
    apply(previous);
}

/// `navigate(-1)` / `navigate(1)`.
pub fn go(delta: i64) {
    let previous = current();
    let moved = HISTORY.with(|h| {
        let mut h = h.borrow_mut();
        let Some(h) = h.as_mut() else { return false };
        let target = h.index as i64 + delta;
        if target < 0 || target >= h.entries.len() as i64 {
            return false;
        }
        h.index = target as usize;
        true
    });
    if moved {
        apply(previous);
    }
}

pub fn current() -> Option<String> {
    HISTORY.with(|h| {
        h.borrow()
            .as_ref()
            .and_then(|h| h.entries.get(h.index).cloned())
    })
}

fn apply(previous: Option<String>) {
    let Some((ui, path, can_back, can_forward)) = HISTORY.with(|h| {
        let h = h.borrow();
        let h = h.as_ref()?;
        Some((
            h.ui.upgrade()?,
            h.entries[h.index].clone(),
            h.index > 0,
            h.index + 1 < h.entries.len(),
        ))
    }) else {
        return;
    };
    let location = Location::parse(&path);
    let previous_location = previous.as_deref().map(Location::parse);
    let nav = ui.global::<Nav>();
    nav.set_can_go_back(can_back);
    nav.set_can_go_forward(can_forward);

    if previous_location.as_ref().map(|l| l.route()) == Some("game") && location.route() != "game" {
        game_page::close();
    }
    if previous_location.as_ref().map(|l| l.route()) == Some("library")
        && location.route() != "library"
    {
        library_page::close();
    }
    if location.route() == "library"
        && previous_location.as_ref().map(|l| l.route()) != Some("library")
    {
        library_page::open();
    }
    if location.route() == "home" && previous_location.as_ref().map(|l| l.route()) != Some("home") {
        home_page::open();
    }
    if location.route() == "downloads" {
        crate::downloads_page::refresh();
    }
    if location.route() == "catalogue"
        && previous_location.as_ref().map(|l| l.route()) != Some("catalogue")
    {
        catalogue_page::open();
    }
    if location.route() == "achievements" {
        crate::achievements_page::open(
            location.param("shop").unwrap_or("steam"),
            location.param("objectId").unwrap_or_default(),
            location.param("title").unwrap_or_default(),
        );
    }
    if location.route() == "notifications" {
        crate::notifications_page::open_page();
    }
    if location.route() == "settings" {
        crate::settings_page::open(location.param("tab"), location.param("urls"));
    }
    if location.route() == "game" {
        let mut parts = location.pathname.trim_start_matches('/').split('/').skip(1);
        let shop = parts.next().unwrap_or("steam").to_string();
        let object_id = parts.next().unwrap_or("").to_string();
        let title = location.param("title").unwrap_or("").to_string();
        game_page::open(&shop, &object_id, &title, &shell::shop_language());
    }
    let route_changed = previous_location.as_ref().map(|l| l.route()) != Some(location.route());
    nav.set_route(location.route().into());
    nav.set_path(location.pathname.clone().into());
    if route_changed {
        crate::search::sync_text(location.route());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_game_paths() {
        let l = Location::parse("/game/steam/1091500?title=Cyberpunk+2077");
        assert_eq!(l.route(), "game");
        assert_eq!(l.pathname, "/game/steam/1091500");
        assert_eq!(l.param("title"), Some("Cyberpunk 2077"));
        assert_eq!(Location::parse("/").route(), "home");
        assert_eq!(encode("A & B"), "A+%26+B");
        assert_eq!(decode("%E4%BA%8B"), "事");
    }
}
