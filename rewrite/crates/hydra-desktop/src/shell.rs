//! The window around the pages: UI strings, session, sidebar, window chrome.
//!
//! Ports src/renderer/src/app.tsx (startup: preferences, library, user
//! details), components/sidebar/sidebar.tsx (library list, filter, sort,
//! resize) and components/app-title-bar (window controls).

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::Arc;

use hydra_core::api::{HydraApi, Options};
use hydra_core::library::{self, Category, Collection, Presentation, SortBy};
use hydra_db::{Db, keys};
use hydra_i18n::{Arg, Direction, I18n};
use hydra_media::images::{Loader, Op};
use serde_json::Value;
use slint::{ComponentHandle, Image, Model, ModelRc, SharedString, VecModel};

use crate::nav;
use crate::{AppWindow, Chrome, Session, SidebarGame, SidebarState, T};

struct Shell {
    ui: slint::Weak<AppWindow>,
    db: Arc<Db>,
    api: Arc<HydraApi>,
    i18n: Rc<I18n>,
    loader: Loader,
    scale: f32,
    /// Grouped library, in sidebar order (sort + favorites first + category filters).
    library: Vec<Presentation>,
    /// The grouped library before sorting (selectGroupedLibrary), for the library page.
    groups: Vec<Presentation>,
    /// The ungrouped library length.
    library_len: usize,
    library_loading: bool,
    /// `removeDiacritics(title).toLowerCase()` per row of `library`.
    search_keys: Vec<String>,
    /// Indexes into `library` currently shown.
    visible: Vec<usize>,
    rows: Rc<VecModel<SidebarGame>>,
    filter: String,
    playable_only: bool,
    sort_by: SortBy,
    favorites_first: bool,
    category: Category,
    sources: Vec<String>,
    platforms: Vec<String>,
    /// Decoded sidebar icons by URL (small: 20px at the window scale).
    icons: HashMap<String, Image>,
    icons_pending: HashSet<String>,
    icons_failed: HashSet<String>,
    hide_steam_badges: bool,
    hide_epic_badges: bool,
}

thread_local! {
    static SHELL: RefCell<Option<Shell>> = const { RefCell::new(None) };
}

fn with_shell<R>(f: impl FnOnce(&mut Shell) -> R) -> Option<R> {
    SHELL.with(|s| s.borrow_mut().as_mut().map(f))
}

/// The renderer's `localStorage`, imported from Electron (keys::LOCAL_STORAGE).
fn local_storage(db: &Db, key: &str) -> Option<String> {
    db.get_in::<String>(keys::LOCAL_STORAGE, key)
}

fn pref_flag(preferences: &Option<Value>, key: &str) -> bool {
    preferences
        .as_ref()
        .and_then(|p| p.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn set_local_storage(db: &Db, key: &str, value: &str) {
    let _ = db.put_in(keys::LOCAL_STORAGE, key, &value.to_string());
}

/// App exit: drop the HTTP clients (their runtime threads join) while the
/// process is still running normally.
pub fn shutdown() {
    let shell = SHELL.with(|s| s.borrow_mut().take());
    drop(shell);
}

/// `findLibraryGamePresentation`: the library row a game page belongs to.
pub fn find_library_game(shop: &str, object_id: &str) -> Option<Presentation> {
    with_shell(|s| {
        let key = format!("{shop}:{object_id}");
        if let Some(owned) = s
            .library
            .iter()
            .find(|g| g.members.iter().any(|m| m.identity_key() == key))
        {
            return Some(owned.clone());
        }
        let matching: Vec<&Presentation> = s
            .library
            .iter()
            .filter(|g| g.catalogue_shop == shop && g.catalogue_object_id == object_id)
            .collect();
        (matching.len() == 1).then(|| matching[0].clone())
    })
    .flatten()
}

/// The grouped library (unsorted), the ungrouped length and whether it is still loading.
pub fn library_snapshot() -> Option<(Vec<Presentation>, usize, bool)> {
    with_shell(|s| (s.groups.clone(), s.library_len, s.library_loading))
}

/// The renderer's `localStorage` (imported from Electron, kept in LevelDB).
pub fn storage_get(key: &str) -> Option<String> {
    with_shell(|s| local_storage(&s.db, key)).flatten()
}

pub fn storage_set(key: &str, value: &str) {
    with_shell(|s| set_local_storage(&s.db, key, value));
}

pub fn storage_remove(key: &str) {
    with_shell(|s| {
        let _ = s.db.delete_in(keys::LOCAL_STORAGE, key);
    });
}

/// Whether the signed-in user's details are known (userDetails.id).
pub fn signed_in() -> bool {
    with_shell(|s| {
        s.ui.upgrade()
            .map(|ui| ui.global::<Session>().get_signed_in())
    })
    .flatten()
    .unwrap_or(false)
}

/// The Hydra API client.
pub fn api() -> Option<Arc<HydraApi>> {
    with_shell(|s| s.api.clone())
}

/// A boolean user preference (userPreferences in LevelDB).
pub fn preference(key: &str) -> bool {
    with_shell(|s| pref_flag(&s.db.get::<Value>(keys::USER_PREFERENCES), key)).unwrap_or(false)
}

/// The local database (the rewrite's copy of Electron's).
pub fn db() -> Option<Arc<Db>> {
    with_shell(|s| s.db.clone())
}

/// The UI language and its strings, for code that formats text in Rust.
pub fn i18n() -> Option<Rc<I18n>> {
    with_shell(|s| s.i18n.clone())
}

/// i18next.changeLanguage: swap the strings and re-evaluate every T.tr binding.
pub fn set_language(code: &str) {
    let i18n = Rc::new(I18n::new(code));
    let ui = with_shell(|s| {
        s.i18n = i18n.clone();
        s.ui.upgrade()
    })
    .flatten();
    if let Some(ui) = ui {
        let t = ui.global::<T>();
        t.set_rtl(i18n.dir() == Direction::Rtl);
        t.set_rev(t.get_rev() + 1);
    }
    refresh_rows();
    crate::library_page::on_library_changed();
}

/// The language Steam store data is fetched in (steam.ts maps it further).
pub fn shop_language() -> String {
    with_shell(|s| s.i18n.language().to_string()).unwrap_or_else(|| "en".into())
}

pub fn init(
    ui: &AppWindow,
    db: Arc<Db>,
    api: Arc<HydraApi>,
    loader: Loader,
    locale: Option<&str>,
    headless: bool,
) {
    // i18n: userPreferences.language, else the system language (LanguageDetector).
    let preferences: Option<Value> = db.get(keys::USER_PREFERENCES);
    let language = locale
        .map(str::to_string)
        .or_else(|| {
            preferences
                .as_ref()
                .and_then(|p| p.get("language"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(sys_locale::get_locale)
        .unwrap_or_else(|| "en".into());
    let i18n = Rc::new(I18n::new(&language));

    let sidebar_width = local_storage(&db, "sidebarWidth")
        .and_then(|w| w.parse::<f32>().ok())
        .unwrap_or(250.0)
        .clamp(200.0, 450.0);
    let sort_by = SortBy::parse(&local_storage(&db, "sidebar-sort-by").unwrap_or_default());
    let sort_by = match sort_by {
        SortBy::TitleAsc | SortBy::RecentlyPlayed | SortBy::MostPlayed | SortBy::Achievements => {
            sort_by
        }
        _ => SortBy::TitleAsc,
    };
    let favorites_first = local_storage(&db, "sidebar-favorites-first").as_deref() != Some("false");
    let playable_only = local_storage(&db, "sidebar-playable-only").as_deref() == Some("true");
    let category = Category::parse(&local_storage(&db, "sidebar-category").unwrap_or_default());
    let parse_list = |key: &str| -> Vec<String> {
        local_storage(&db, key)
            .and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok())
            .unwrap_or_default()
    };
    let sources = parse_list("sidebar-sources");
    let platforms = parse_list("sidebar-platforms");

    let rows = Rc::new(VecModel::from(Vec::<SidebarGame>::new()));
    let sidebar = ui.global::<SidebarState>();
    sidebar.set_games(ModelRc::from(rows.clone()));
    sidebar.set_width(sidebar_width);
    sidebar.set_playable_only(playable_only);
    sidebar.set_loading(true);

    SHELL.with(|s| {
        *s.borrow_mut() = Some(Shell {
            ui: ui.as_weak(),
            db: db.clone(),
            api: api.clone(),
            i18n: i18n.clone(),
            loader,
            scale: ui.window().scale_factor(),
            library: Vec::new(),
            groups: Vec::new(),
            library_len: 0,
            library_loading: true,
            search_keys: Vec::new(),
            visible: Vec::new(),
            rows,
            filter: String::new(),
            playable_only,
            sort_by,
            favorites_first,
            category,
            sources,
            platforms,
            icons: HashMap::new(),
            icons_pending: HashSet::new(),
            icons_failed: HashSet::new(),
            hide_steam_badges: pref_flag(&preferences, "hideSteamLibraryBadges"),
            hide_epic_badges: pref_flag(&preferences, "hideEpicLibraryBadges"),
        })
    });

    wire_i18n(ui, &i18n);
    wire_session(ui);
    wire_sidebar(ui);
    wire_chrome(ui, headless);

    ui.global::<Session>()
        .set_version(hydra_core::config::app_version().into());
    load_library();
    load_user();
}

// ---- i18n ---------------------------------------------------------------

fn wire_i18n(ui: &AppWindow, i18n: &Rc<I18n>) {
    let t = ui.global::<T>();
    t.set_rtl(i18n.dir() == Direction::Rtl);
    let weak = ui.as_weak();
    // Reading T.rev inside each call makes bindings depend on it, so they
    // re-evaluate when the language changes.
    let touch = move || {
        if let Some(ui) = weak.upgrade() {
            let _ = ui.global::<T>().get_rev();
        }
    };
    let pairs = |args: &ModelRc<SharedString>| -> Vec<(String, String)> {
        let items: Vec<SharedString> = args.iter().collect();
        items
            .chunks(2)
            .map(|pair| {
                (
                    pair[0].to_string(),
                    pair.get(1).map(|v| v.to_string()).unwrap_or_default(),
                )
            })
            .collect()
    };
    t.on_tr({
        let touch = touch.clone();
        move |key| {
            touch();
            with_shell(|s| s.i18n.t(&key)).unwrap_or_default().into()
        }
    });
    t.on_tr_with({
        let touch = touch.clone();
        move |key, args| {
            touch();
            let args = pairs(&args);
            with_shell(|s| {
                let args: Vec<(&str, Arg)> = args
                    .iter()
                    .map(|(k, v)| (k.as_str(), Arg::from(v.as_str())))
                    .collect();
                s.i18n.t_with(&key, &args)
            })
            .unwrap_or_default()
            .into()
        }
    });
    t.on_tr_parts({
        let touch = touch.clone();
        move |key, part| {
            touch();
            let text = with_shell(|s| s.i18n.t(&key)).unwrap_or_default();
            trans_part(&text, part as usize).into()
        }
    });
    t.on_tr_count(move |key, count, args| {
        touch();
        let args = pairs(&args);
        with_shell(|s| {
            let args: Vec<(&str, Arg)> = args
                .iter()
                .map(|(k, v)| (k.as_str(), Arg::from(v.as_str())))
                .collect();
            s.i18n.t_count(&key, count as f64, &args)
        })
        .unwrap_or_default()
        .into()
    });
}

/// A react-i18next `<Trans>` string split at its `<0>…</0>` tag.
pub fn trans_part(text: &str, part: usize) -> String {
    let (before, rest) = text.split_once("<0>").unwrap_or((text, ""));
    let (inside, after) = rest.split_once("</0>").unwrap_or((rest, ""));
    [before, inside, after]
        .get(part)
        .copied()
        .unwrap_or_default()
        .to_string()
}

pub fn tr(key: &str) -> String {
    with_shell(|s| s.i18n.t(key)).unwrap_or_default()
}

pub fn tr_with(key: &str, args: &[(&str, Arg)]) -> String {
    with_shell(|s| s.i18n.t_with(key, args)).unwrap_or_default()
}

// ---- session ------------------------------------------------------------

fn wire_session(ui: &AppWindow) {
    let session = ui.global::<Session>();
    session.on_sign_in(|| eprintln!("TODO(auth): open the auth window (wry webview)"));
    session.on_sign_out(|| eprintln!("TODO(auth): sign out"));
    session.on_open_profile(|| eprintln!("TODO(profile): open profile"));
    session.on_open_notifications(|| nav::navigate("/notifications"));
    session.on_open_friends(|| eprintln!("TODO(friends): friends window"));
}

/// app.tsx setupExternalResources: cached `userDetails` first, then `getMe`.
fn load_user() {
    let Some((db, api, ui)) = with_shell(|s| (s.db.clone(), s.api.clone(), s.ui.clone())) else {
        return;
    };
    if let Some(cached) =
        local_storage(&db, "userDetails").and_then(|v| serde_json::from_str::<Value>(&v).ok())
    {
        apply_user(&cached);
    }
    if !api.is_logged_in() {
        if let Some(ui) = ui.upgrade() {
            ui.global::<Session>().set_loaded(true);
        }
        return;
    }
    std::thread::spawn(move || {
        let me = api.get("/profile/me", &[], Options::default());
        let _ = slint::invoke_from_event_loop(move || match me {
            Ok(me) => {
                if let Some(db) = with_shell(|s| s.db.clone()) {
                    set_local_storage(&db, "userDetails", &me.to_string());
                }
                apply_user(&me);
            }
            Err(error) => eprintln!("profile/me: {error}"),
        });
    });
}

fn apply_user(user: &Value) {
    let Some((ui, loader, scale)) = with_shell(|s| (s.ui.upgrade(), s.loader.clone(), s.scale))
    else {
        return;
    };
    let Some(ui) = ui else { return };
    let session = ui.global::<Session>();
    let name = user
        .get("displayName")
        .and_then(Value::as_str)
        .unwrap_or_default();
    session.set_signed_in(!name.is_empty());
    session.set_display_name(name.into());
    let subscription_active = user
        .get("subscription")
        .and_then(|s| s.get("expiresAt"))
        .and_then(Value::as_str)
        .and_then(hydra_core::library::parse_iso_millis)
        .is_some_and(|expires| expires > now_ms());
    session.set_has_subscription(subscription_active);
    session.set_loaded(true);
    if let Some(url) = user
        .get("profileImageUrl")
        .and_then(Value::as_str)
        .filter(|u| !u.is_empty())
    {
        let weak = ui.as_weak();
        loader.load(
            url.to_string(),
            Op::MaxWidth((35.0 * scale).ceil() as u32),
            move |img| {
                if let Some(ui) = weak.upgrade() {
                    ui.global::<Session>().set_avatar(img);
                }
            },
        );
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

// ---- sidebar ------------------------------------------------------------

fn wire_sidebar(ui: &AppWindow) {
    let sidebar = ui.global::<SidebarState>();
    sidebar.on_filter_changed(|text| {
        with_shell(|s| s.filter = text.to_string());
        refresh_rows();
    });
    sidebar.on_toggle_playable({
        let weak = ui.as_weak();
        move || {
            let next = with_shell(|s| {
                s.playable_only = !s.playable_only;
                set_local_storage(
                    &s.db,
                    "sidebar-playable-only",
                    if s.playable_only { "true" } else { "false" },
                );
                s.playable_only
            });
            if let (Some(ui), Some(next)) = (weak.upgrade(), next) {
                ui.global::<SidebarState>().set_playable_only(next);
            }
            refresh_rows();
        }
    });
    sidebar.on_game_clicked(|id| {
        if let Some(path) = game_path(&id) {
            nav::navigate(&path);
        }
    });
    sidebar.on_game_double_clicked(|id| {
        // TODO(launcher): useGameActions().handlePlayGame (or the no-executable toast).
        eprintln!("TODO(launcher): play {id}");
    });
    sidebar.on_game_context_menu(|id, x, y| {
        let group = with_shell(|s| {
            s.library
                .iter()
                .find(|g| g.game.id() == id.as_str())
                .cloned()
        })
        .flatten();
        if let Some(group) = group {
            crate::game_menu::show(std::rc::Rc::new(group), x, y, None);
        }
    });
    sidebar.on_visible_rows(|first, last| load_icons(first.max(0) as usize, last.max(0) as usize));
    sidebar.on_width_committed(|width| {
        with_shell(|s| set_local_storage(&s.db, "sidebarWidth", &format!("{}", width.round())));
    });
}

/// `buildGameDetailsPath` for a sidebar row.
fn game_path(id: &str) -> Option<String> {
    with_shell(|s| {
        let group = s.library.iter().find(|g| g.game.id() == id)?;
        Some(format!(
            "/game/{}/{}?title={}",
            group.catalogue_shop,
            group.catalogue_object_id,
            nav::encode(group.game.title())
        ))
    })
    .flatten()
}

/// `updateLibrary()`: read the library on a worker, then group and sort it.
pub fn load_library() {
    let Some(db) = with_shell(|s| s.db.clone()) else {
        return;
    };
    std::thread::spawn(move || {
        let started = std::time::Instant::now();
        let games = library::load_library(&db, Collection::Visible, None).unwrap_or_else(|e| {
            eprintln!("library: {e}");
            Vec::new()
        });
        let groups = library::group_library_games(&games, &[]);
        let games_len = games.len();
        eprintln!(
            "library: {} games, {} rows in {:?}",
            games.len(),
            groups.len(),
            started.elapsed()
        );
        let _ = slint::invoke_from_event_loop(move || {
            with_shell(|s| {
                s.groups = groups.clone();
                s.library_len = games_len;
                s.library_loading = false;
                let mut groups = groups;
                library::sort_games(&mut groups, s.sort_by);
                if s.favorites_first {
                    let (favorites, rest): (Vec<_>, Vec<_>) =
                        groups.into_iter().partition(|g| g.game.flag("favorite"));
                    groups = favorites.into_iter().chain(rest).collect();
                }
                s.search_keys = groups
                    .iter()
                    .map(|g| library::search_key(g.game.title()))
                    .collect();
                s.library = groups;
                if let Some(ui) = s.ui.upgrade() {
                    ui.global::<SidebarState>().set_loading(false);
                }
            });
            refresh_rows();
            crate::game_page::on_library_changed();
            crate::library_page::on_library_changed();
            crate::catalogue_page::on_library_changed();
            crate::downloads_page::refresh();
        });
    });
}

/// sidebar.tsx `visibleGames`: category/source/platform filters, then the
/// text filter (over the whole ordered library) or "playable only".
pub(crate) fn refresh_rows() {
    with_shell(|s| {
        let searching = !s.filter.trim().is_empty();
        let visible: Vec<usize> = if searching {
            let query = library::search_key(&s.filter);
            (0..s.library.len())
                .filter(|&i| s.search_keys[i].contains(&query))
                .collect()
        } else {
            let filtered = library::filter_games(&s.library, s.category, &s.sources, &s.platforms);
            let allowed: HashSet<*const Presentation> =
                filtered.into_iter().map(|p| p as *const _).collect();
            (0..s.library.len())
                .filter(|&i| allowed.contains(&(&s.library[i] as *const _)))
                .filter(|&i| !s.playable_only || s.library[i].game.is_playable())
                .collect()
        };
        let has_active_filter = !s.library.is_empty()
            && (s.category != Category::All
                || (s.category.shows_sources() && !s.sources.is_empty())
                || (s.category.shows_platforms() && !s.platforms.is_empty())
                || s.playable_only
                || searching);
        let rows: Vec<SidebarGame> = visible.iter().map(|&i| row_for(s, &s.library[i])).collect();
        s.visible = visible;
        s.rows.set_vec(rows);
        if let Some(ui) = s.ui.upgrade() {
            ui.global::<SidebarState>()
                .set_has_active_filter(has_active_filter);
        }
    });
    // The list only reports range changes; a new list starts at the top.
    load_icons(0, 40);
}

/// The icon URL a row shows (sidebar-game-item.tsx `sidebarIcon`).
fn icon_url(group: &Presentation) -> Option<String> {
    let game = &group.game;
    let url = if game.shop() == "custom" {
        game.str("libraryImageUrl")
            .filter(|u| !u.is_empty())
            .or_else(|| game.str("iconUrl"))
    } else {
        game.str("customIconUrl")
            .filter(|u| !u.is_empty())
            .or_else(|| game.str("iconUrl"))
    };
    url.filter(|u| !u.trim().is_empty())
        .map(|u| u.trim().to_string())
}

/// `getGameTitle` (sidebar.tsx).
/// sidebar.tsx getGameTitle (inside `with_shell`, so it uses `s.i18n`).
fn row_title(s: &Shell, group: &Presentation) -> String {
    let game = &group.game;
    let title = game.title();
    let status = game.download_status();
    if let Some(packet) = crate::downloads::last_packet()
        && packet.game_id == game.id()
    {
        let percentage = crate::downloads_page::format_progress(packet.progress, 2);
        return s.i18n.t_with(
            "sidebar.downloading",
            &[
                ("title", title.into()),
                ("percentage", percentage.as_str().into()),
            ],
        );
    }
    if game.download_queued() && !matches!(status, Some("removed" | "complete" | "seeding")) {
        return s.i18n.t_with("sidebar.queued", &[("title", title.into())]);
    }
    if status == Some("paused") {
        return s.i18n.t_with("sidebar.paused", &[("title", title.into())]);
    }
    title.to_string()
}

fn row_for(s: &Shell, group: &Presentation) -> SidebarGame {
    let game = &group.game;
    let icon = icon_url(group)
        .and_then(|url| s.icons.get(&url).cloned())
        .unwrap_or_default();
    let new_options = game.number("newDownloadOptionsCount").unwrap_or(0.0);
    SidebarGame {
        id: game.id().into(),
        title: row_title(s, group).into(),
        icon,
        fallback: match game.shop() {
            "custom" => 0,
            "epic" => 2,
            _ => 1,
        },
        favorite: game.flag("favorite"),
        muted: game.download_status() == Some("removed"),
        badge: if new_options > 0.0 {
            format!("+{new_options}").into()
        } else {
            SharedString::default()
        },
        // SteamLibraryBadge in sidebar-game-item.tsx, hidden by the user preferences.
        library_badge: match library::badge_source(group) {
            Some("steam") if !s.hide_steam_badges => 1,
            Some("epic") if !s.hide_epic_badges => 2,
            _ => 0,
        },
        badge_both: group
            .members
            .iter()
            .any(|m| m.0.get("hasActiveSteamImport") == Some(&Value::Bool(true)))
            && group
                .members
                .iter()
                .any(|m| m.0.get("hasActiveEpicImport") == Some(&Value::Bool(true))),
        path: format!(
            "/game/{}/{}",
            group.catalogue_shop, group.catalogue_object_id
        )
        .into(),
    }
}

/// `loading="lazy"`: fetch icons for rows on screen (plus overscan), and keep
/// at most a few hundred decoded.
fn load_icons(first: usize, last: usize) {
    let jobs = with_shell(|s| {
        let mut jobs = Vec::new();
        let mut wanted = HashSet::new();
        for row in first..last.min(s.visible.len()) {
            let group = &s.library[s.visible[row]];
            let Some(url) = icon_url(group) else { continue };
            wanted.insert(url.clone());
            if s.icons.contains_key(&url)
                || s.icons_pending.contains(&url)
                || s.icons_failed.contains(&url)
            {
                continue;
            }
            s.icons_pending.insert(url.clone());
            jobs.push(url);
        }
        // Evict decoded icons far from the viewport once the cache grows.
        if s.icons.len() > 400 {
            s.icons.retain(|url, _| wanted.contains(url));
        }
        (s.loader.clone(), s.scale, jobs)
    });
    let Some((loader, scale, jobs)) = jobs else {
        return;
    };
    for url in jobs {
        let source: hydra_media::images::Source = match url.strip_prefix("local:") {
            Some(path) => std::path::PathBuf::from(path).into(),
            None if url.starts_with("http") => url.clone().into(),
            None => std::path::PathBuf::from(&url).into(),
        };
        let key = url.clone();
        loader.load(
            source,
            Op::MaxWidth((20.0 * scale).ceil() as u32),
            move |img| {
                with_shell(|s| {
                    s.icons_pending.remove(&key);
                    s.icons.insert(key.clone(), img.clone());
                    for (row, &index) in s.visible.iter().enumerate() {
                        if icon_url(&s.library[index]).as_deref() == Some(key.as_str())
                            && let Some(mut data) = s.rows.row_data(row)
                        {
                            data.icon = img.clone();
                            s.rows.set_row_data(row, data);
                        }
                    }
                });
            },
        );
    }
}

// ---- window chrome --------------------------------------------------------

fn wire_chrome(ui: &AppWindow, headless: bool) {
    let chrome = ui.global::<Chrome>();
    chrome.set_platform(
        if cfg!(windows) {
            "windows"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else {
            "linux"
        }
        .into(),
    );
    if headless {
        return;
    }
    use slint::winit_030::WinitWindowAccessor;
    let weak = ui.as_weak();
    chrome.on_minimize({
        let weak = weak.clone();
        move || {
            if let Some(ui) = weak.upgrade() {
                ui.window().set_minimized(true);
            }
        }
    });
    chrome.on_toggle_maximize({
        let weak = weak.clone();
        move || {
            if let Some(ui) = weak.upgrade() {
                let maximized = !ui.window().is_maximized();
                ui.window().set_maximized(maximized);
                ui.global::<Chrome>().set_maximized(maximized);
            }
        }
    });
    chrome.on_close(|| {
        let _ = slint::quit_event_loop();
    });
    chrome.on_drag({
        let weak = weak.clone();
        move || {
            if let Some(ui) = weak.upgrade() {
                ui.window().with_winit_window(|window| {
                    let _ = window.drag_window();
                });
            }
        }
    });
}
