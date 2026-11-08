//! The library page: src/renderer/src/pages/library/library.tsx with its
//! cards (library-game-card.tsx, library-game-card-large.tsx), toolbar and
//! menus (category-filter.tsx, library-filters-menu.tsx,
//! library-display-menu.tsx).
//!
//! Only the cards on screen (plus three rows of overscan, like the
//! virtualizer) get images. Covers come from the resized CDN copies in
//! `game.images` when the API sent them, with their ThumbHash shown until
//! the copy loads; badges draw a pre-blurred slice of the cover in place of
//! `backdrop-filter`.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use base64::Engine;
use hydra_core::library::{self, Category, Collection, Presentation, SortBy};
use hydra_media::images::{self, Loader, Op, Pixels, Source};
use image::DynamicImage;
use serde_json::Value;
use slint::{ComponentHandle, Image, Model, ModelRc, SharedString, VecModel};

use crate::{
    AppWindow, LibraryCard, LibraryData, LibraryMenuItem, LibrarySizeBar, Nav, Popup, nav, shell,
};

const FAVORITES_COLLECTION_ID: &str = "__favorites__";
const HIDDEN_COLLECTION_ID: &str = "__hidden__";
/// COVER_DISPLAY_WIDTH: `sizes="auto, 300px"` picks by the rendered width.
const LOGO_DISPLAY_WIDTH: f32 = 400.0;
/// Decoded covers kept around the viewport before older ones are dropped.
const MAX_DECODED: usize = 240;

#[derive(Clone, Copy, PartialEq, Eq)]
enum ViewMode {
    Grid,
    Compact,
    Large,
}

impl ViewMode {
    fn parse(value: &str) -> Self {
        match value {
            "grid" => ViewMode::Grid,
            "large" => ViewMode::Large,
            _ => ViewMode::Compact,
        }
    }
    fn as_str(self) -> &'static str {
        match self {
            ViewMode::Grid => "grid",
            ViewMode::Compact => "compact",
            ViewMode::Large => "large",
        }
    }
}

/// What a card shows and where its art comes from.
#[derive(Clone, Default)]
struct Plan {
    /// The URL actually fetched (a `w{width}.webp` copy or the original).
    load_url: String,
    /// The original artwork URL (`game.images` key).
    raw_url: String,
    has_variants: bool,
    thumb_hash: Option<String>,
    /// 0 cover, 1 contain, 2 classics, 3 no art
    mode: i32,
    /// Large view: the logo URL (copy or original).
    logo_url: Option<String>,
}

/// One decode: the cover at card size plus what the effects need.
#[derive(Clone)]
struct Decoded {
    cover: Image,
    frost: Image,
    backdrop: Image,
}

struct Logo {
    image: Image,
    shadow: Image,
    /// Shadow padding around the logo, in image pixels.
    pad: f32,
    /// The rendered width (CSS px).
    width: f32,
}

struct Page {
    ui: slint::Weak<AppWindow>,
    loader: Loader,
    scale: f32,
    /// groupedLibrary (selectGroupedLibrary), unsorted.
    groups: Rc<Vec<Rc<Presentation>>>,
    /// The ungrouped library length (`library.length`).
    library_len: usize,
    /// Classics platforms of the ungrouped library (getLibraryFilterOptions).
    platform_options: Vec<String>,
    loading: bool,
    hidden: Vec<Rc<Presentation>>,
    hidden_loading: bool,
    hidden_failed: bool,

    sort_by: SortBy,
    view: ViewMode,
    category: Category,
    sources: Vec<String>,
    platforms: Vec<String>,
    installed_only: bool,
    collection: Option<String>,
    query: String,
    search_timer: slint::Timer,

    /// The cards in the grid, in order.
    shown: Vec<Rc<Presentation>>,
    cards: Rc<VecModel<LibraryCard>>,
    card_px: (u32, u32),
    range: (usize, usize),

    decoded: HashMap<String, Decoded>,
    logos: HashMap<String, Logo>,
    pending: HashSet<String>,
    failed: HashSet<String>,
    /// Originals whose resized copy failed (`markFailed`).
    variant_failed: HashSet<String>,
    /// Fallback level per card (customCover -> cover -> library -> icon).
    fallback: HashMap<String, usize>,
    placeholders: HashMap<String, Image>,
    /// URLs still on screen; workers skip jobs that scrolled away.
    wanted: Arc<Mutex<HashSet<String>>>,
}

thread_local! {
    static PAGE: RefCell<Option<Page>> = const { RefCell::new(None) };
}

fn with_page<R>(f: impl FnOnce(&mut Page) -> R) -> Option<R> {
    PAGE.with(|p| p.borrow_mut().as_mut().map(f))
}

fn parse_list(value: Option<String>) -> Vec<String> {
    value
        .and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok())
        .unwrap_or_default()
}

pub fn init(ui: &AppWindow) {
    // readStoredLibraryFilters: the legacy "steam_library" category becomes PC + Steam.
    let stored_category = shell::storage_get("library-category");
    let (category, sources) = if stored_category.as_deref() == Some("steam_library") {
        shell::storage_set("library-category", "pc");
        shell::storage_set("library-sources", "[\"steam\"]");
        (Category::Pc, vec!["steam".to_string()])
    } else {
        let sources: Vec<String> = parse_list(shell::storage_get("library-sources"));
        // parseStoredLibrarySources: all three (or none) mean "no filter".
        let known: Vec<String> = ["hydra", "steam", "epic"]
            .iter()
            .filter(|s| sources.iter().any(|v| v == *s))
            .map(|s| s.to_string())
            .collect();
        let sources = if !known.is_empty() && known.len() < 3 {
            known
        } else {
            Vec::new()
        };
        (
            Category::parse(stored_category.as_deref().unwrap_or_default()),
            sources,
        )
    };
    let sort_by = shell::storage_get("library-sort-by")
        .map(|v| SortBy::parse(&v))
        .unwrap_or(SortBy::TitleAsc);
    let view = ViewMode::parse(&shell::storage_get("library-view-mode").unwrap_or_default());

    let cards = Rc::new(VecModel::from(Vec::<LibraryCard>::new()));
    let data = ui.global::<LibraryData>();
    data.set_cards(ModelRc::from(cards.clone()));
    data.set_scan_supported(cfg!(any(windows, target_os = "linux")));

    PAGE.with(|p| {
        *p.borrow_mut() = Some(Page {
            ui: ui.as_weak(),
            loader: Loader::new(6),
            scale: ui.window().scale_factor(),
            groups: Rc::new(Vec::new()),
            library_len: 0,
            platform_options: Vec::new(),
            loading: true,
            hidden: Vec::new(),
            hidden_loading: true,
            hidden_failed: false,
            sort_by,
            view,
            category,
            sources,
            platforms: parse_list(shell::storage_get("library-platforms")),
            installed_only: shell::storage_get("library-installed-only").as_deref() == Some("true"),
            collection: None,
            query: String::new(),
            search_timer: slint::Timer::default(),
            shown: Vec::new(),
            cards,
            card_px: (0, 0),
            range: (0, 0),
            decoded: HashMap::new(),
            logos: HashMap::new(),
            pending: HashSet::new(),
            failed: HashSet::new(),
            variant_failed: HashSet::new(),
            fallback: HashMap::new(),
            placeholders: HashMap::new(),
            wanted: Arc::new(Mutex::new(HashSet::new())),
        })
    });

    wire(ui);
    crate::collections::subscribe(|| {
        if on_library() {
            apply_filters(false);
        }
        crate::game_menu::on_collections_changed();
    });
    on_library_changed();
}

fn wire(ui: &AppWindow) {
    let data = ui.global::<LibraryData>();
    data.on_visible_range(|first, last| {
        with_page(|p| p.range = (first.max(0) as usize, last.max(0) as usize));
        load_visible();
    });
    data.on_card_width_changed(|w, h| {
        let changed = with_page(|p| {
            let next = (w.max(1) as u32, h.max(1) as u32);
            // Decode again only when the cards grow past what was decoded.
            let grew = next.0 > p.card_px.0;
            p.card_px = next;
            grew
        })
        .unwrap_or(false);
        if changed {
            with_page(|p| {
                p.decoded.clear();
                p.logos.clear();
                p.failed.clear();
            });
            refresh_cards();
        }
    });
    data.on_open_card(|index| {
        let path = with_page(|p| p.shown.get(index as usize).map(|g| game_path(g))).flatten();
        if let Some(path) = path {
            nav::navigate(&path);
        }
    });
    data.on_card_context_menu(|index, x, y| {
        let target = with_page(|p| {
            p.shown
                .get(index as usize)
                .cloned()
                .map(|g| (g, p.collection.clone()))
        })
        .flatten();
        if let Some((group, collection)) = target {
            crate::game_menu::show(group, x, y, collection);
        }
    });
    data.on_set_category(|value| {
        let category = Category::parse(&value);
        with_page(|p| {
            p.category = category;
            shell::storage_set("library-category", &value);
            if !category.shows_platforms() {
                p.platforms.clear();
                shell::storage_set("library-platforms", "[]");
            }
            if !category.shows_sources() {
                p.sources.clear();
                shell::storage_set("library-sources", "[]");
            }
        });
        apply_filters(true);
    });
    data.on_set_sort(|value| {
        with_page(|p| {
            p.sort_by = SortBy::parse(&value);
            shell::storage_set("library-sort-by", p.sort_by.as_str());
        });
        apply_filters(true);
    });
    data.on_set_view_mode(|value| {
        with_page(|p| {
            p.view = ViewMode::parse(&value);
            shell::storage_set("library-view-mode", p.view.as_str());
        });
        apply_filters(false);
    });
    data.on_select_collection(|id| {
        let id = id.to_string();
        with_page(|p| {
            if id.is_empty() {
                p.collection = None;
                shell::storage_remove("library-collection");
            } else {
                shell::storage_set("library-collection", &id);
                p.collection = Some(id);
            }
        });
        apply_filters(true);
    });
    data.on_toggle_source(|source| {
        with_page(|p| {
            let source = source.to_string();
            if p.sources.contains(&source) {
                p.sources.retain(|s| *s != source);
            } else {
                p.sources.push(source);
            }
            // onSourcesChange(sources.filter(item => next.includes(item))): keep the menu order.
            let order = ["hydra", "steam", "epic"];
            p.sources
                .sort_by_key(|s| order.iter().position(|o| o == s).unwrap_or(9));
            shell::storage_set(
                "library-sources",
                &serde_json::to_string(&p.sources).unwrap_or_default(),
            );
        });
        apply_filters(true);
    });
    data.on_toggle_platform(|platform| {
        with_page(|p| {
            let platform = platform.to_string();
            if p.platforms.contains(&platform) {
                p.platforms.retain(|s| *s != platform);
            } else {
                p.platforms.push(platform);
            }
            shell::storage_set(
                "library-platforms",
                &serde_json::to_string(&p.platforms).unwrap_or_default(),
            );
        });
        apply_filters(true);
    });
    data.on_set_installed_only(|value| {
        with_page(|p| {
            p.installed_only = value;
            shell::storage_set(
                "library-installed-only",
                if value { "true" } else { "false" },
            );
        });
        apply_filters(true);
    });
    data.on_clear_filters(|| {
        with_page(|p| {
            p.collection = None;
            shell::storage_remove("library-collection");
            p.sources.clear();
            shell::storage_set("library-sources", "[]");
            p.platforms.clear();
            shell::storage_set("library-platforms", "[]");
            p.installed_only = false;
            shell::storage_set("library-installed-only", "false");
        });
        apply_filters(true);
    });
    data.on_create_collection(|| {
        if !shell::signed_in() {
            crate::auth::open(crate::auth::Page::SignIn);
            return;
        }
        crate::dialogs::create_collection_modal(None);
    });
    data.on_collection_context_menu(|id, x, y| {
        eprintln!("TODO(collections): collection context menu for {id} at {x},{y}");
    });
    data.on_scan(|| eprintln!("TODO(scan): open the scan games modal"));
    data.on_add_game(|| eprintln!("TODO(custom games): SidebarAddingCustomGameModal"));
    data.on_retry_hidden(|| load_hidden());

    // The title bar search filters the library while on it (debounced 180ms).
    ui.on_search_changed(|text| {
        if !on_library() {
            // Everywhere else the title bar search edits the catalogue title (250ms debounce).
            let text: String = text.chars().take(255).collect();
            with_page(|p| {
                p.search_timer.start(
                    slint::TimerMode::SingleShot,
                    std::time::Duration::from_millis(250),
                    move || {
                        crate::catalogue_page::set_title(&text);
                    },
                );
            });
            return;
        }
        let text: String = text.chars().take(255).collect();
        with_page(|p| {
            p.search_timer.start(
                slint::TimerMode::SingleShot,
                std::time::Duration::from_millis(180),
                move || {
                    with_page(|p| p.query = text.clone());
                    apply_filters(false);
                },
            );
        });
    });
    ui.on_search_submitted(|text| {
        if !on_library() {
            // executeSearch: apply now and open the catalogue.
            let text: String = text.chars().take(255).collect();
            with_page(|p| p.search_timer.stop());
            crate::catalogue_page::set_title(&text);
            let on_catalogue = with_page(|p| {
                p.ui.upgrade()
                    .map(|ui| ui.global::<Nav>().get_route() == "catalogue")
            })
            .flatten()
            .unwrap_or(false);
            if !on_catalogue {
                nav::navigate("/catalogue");
            }
            return;
        }
        let text: String = text.chars().take(255).collect();
        with_page(|p| {
            p.search_timer.stop();
            p.query = text;
        });
        apply_filters(false);
    });
}

fn on_library() -> bool {
    with_page(|p| {
        p.ui.upgrade()
            .map(|ui| ui.global::<Nav>().get_route() == "library")
    })
    .flatten()
    .unwrap_or(false)
}

/// Entering the page (library.tsx's mount effect): hidden games and
/// collections load, and the stored collection comes back.
pub fn open() {
    with_page(|p| {
        if p.collection.is_none() {
            p.collection = shell::storage_get("library-collection").filter(|c| !c.is_empty());
        }
    });
    load_hidden();
    crate::collections::load();
    apply_filters(true);
}

pub fn close() {
    with_page(|p| {
        if let Some(ui) = p.ui.upgrade() {
            let popup = ui.global::<Popup>();
            if popup.get_open().starts_with("library-") {
                popup.set_open(SharedString::default());
            }
        }
        // Free the decoded art; the page decodes what it shows again.
        p.decoded.clear();
        p.logos.clear();
        p.pending.clear();
        p.wanted.lock().unwrap().clear();
    });
}

/// hydra:game-visibility-updated: hidden games and collections reload.
pub fn on_visibility_changed() {
    if on_library() {
        load_hidden();
        crate::collections::load();
    }
}

pub fn shutdown() {
    let page = PAGE.with(|p| p.borrow_mut().take());
    drop(page);
}

/// The shell reloaded the library (startup, library batch updates).
pub fn on_library_changed() {
    let Some((groups, len, loading)) = shell::library_snapshot() else {
        return;
    };
    with_page(|p| {
        p.platform_options = platform_options(&groups);
        p.groups = Rc::new(groups.into_iter().map(Rc::new).collect());
        p.library_len = len;
        p.loading = loading;
    });
    apply_filters(false);
}

fn platform_options(groups: &[Presentation]) -> Vec<String> {
    let mut set: Vec<String> = Vec::new();
    for group in groups {
        for member in &group.members {
            if member.shop() == "launchbox"
                && let Some(platform) = member.str("platform").filter(|p| !p.is_empty())
                && !set.iter().any(|s| s == platform)
            {
                set.push(platform.to_string());
            }
        }
    }
    set.sort_by(|a, b| library::compare_titles(a, b));
    set
}

fn load_hidden() {
    if !shell::signed_in() {
        with_page(|p| {
            p.hidden.clear();
            p.hidden_loading = false;
        });
        apply_filters(false);
        return;
    }
    let Some(db) = shell::db() else { return };
    with_page(|p| p.hidden_loading = true);
    std::thread::spawn(move || {
        let result = library::load_library(&db, Collection::Hidden, None);
        let _ = slint::invoke_from_event_loop(move || {
            with_page(|p| {
                match result {
                    Ok(games) => {
                        p.hidden = library::group_library_games(&games, &[])
                            .into_iter()
                            .map(Rc::new)
                            .collect();
                        p.hidden_failed = false;
                    }
                    Err(error) => {
                        eprintln!("hidden library: {error}");
                        p.hidden_failed = true;
                    }
                }
                p.hidden_loading = false;
            });
            apply_filters(false);
        });
    });
}

/// `buildGameDetailsPath({ ...game, ...game.catalogueGame })`
fn game_path(group: &Presentation) -> String {
    format!(
        "/game/{}/{}?title={}",
        group.catalogue_shop,
        group.catalogue_object_id,
        nav::encode(group.game.title())
    )
}

/// The library's fuzzy title search: every query character in order.
fn fuzzy_matches(title: &str, query: &str) -> bool {
    let mut query_chars = query.chars().peekable();
    for ch in title.chars() {
        match query_chars.peek() {
            Some(&q) if q == ch => {
                query_chars.next();
            }
            Some(_) => {}
            None => break,
        }
    }
    query_chars.peek().is_none()
}

/// library.tsx `filteredLibrary`, the empty states and the menus.
fn apply_filters(reset_scroll: bool) {
    let Some(ui) = with_page(|p| p.ui.upgrade()).flatten() else {
        return;
    };
    let signed_in = shell::signed_in();
    let collections_state = crate::collections::get();
    let state = with_page(|p| {
        let hidden_selected = p.collection.as_deref() == Some(HIDDEN_COLLECTION_ID);
        let favorites_selected = p.collection.as_deref() == Some(FAVORITES_COLLECTION_ID);
        // getLibraryFilterOptions(hidden ? hiddenGames : library)
        let option_source: Vec<Presentation> = if hidden_selected {
            p.hidden.iter().map(|g| (**g).clone()).collect()
        } else {
            Vec::new()
        };
        let (available_sources, has_imported) = if hidden_selected {
            library::available_sources(&option_source)
        } else {
            available_sources_rc(&p.groups)
        };
        let platform_options = if hidden_selected {
            platform_options(&option_source)
        } else {
            p.platform_options.clone()
        };
        let effective_sources: Vec<String> = if has_imported {
            p.sources
                .iter()
                .filter(|s| available_sources.contains(&s.as_str()))
                .cloned()
                .collect()
        } else {
            Vec::new()
        };
        // The stored platforms drop the ones no longer in the library.
        if !platform_options.is_empty() && !p.platforms.is_empty() {
            let before = p.platforms.len();
            p.platforms.retain(|pl| platform_options.contains(pl));
            if p.platforms.len() != before {
                shell::storage_set(
                    "library-platforms",
                    &serde_json::to_string(&p.platforms).unwrap_or_default(),
                );
            }
        }
        let has_platforms = !platform_options.is_empty();
        let show_sources = p.category.shows_sources() && has_imported;
        let show_platforms = p.category.shows_platforms() && has_platforms;

        let mut base: Vec<Rc<Presentation>> = if hidden_selected {
            if signed_in {
                p.hidden.clone()
            } else {
                Vec::new()
            }
        } else {
            p.groups.iter().cloned().collect()
        };
        sort_rc(&mut base, p.sort_by);
        if let Some(collection) = p.collection.as_deref() {
            if collection == FAVORITES_COLLECTION_ID {
                base.retain(|g| g.game.flag("favorite"));
            } else if collection != HIDDEN_COLLECTION_ID {
                base.retain(|g| g.game.collection_ids().iter().any(|id| id == collection));
            }
        }
        let platforms = if has_platforms {
            p.platforms.clone()
        } else {
            Vec::new()
        };
        let filtered = filter_rc(&base, p.category, &effective_sources, &platforms);
        let mut filtered: Vec<Rc<Presentation>> = filtered;
        if p.installed_only {
            filtered.retain(|g| g.game.is_installed());
        }
        let query = library::search_key(&p.query);
        if !query.trim().is_empty() {
            filtered.retain(|g| fuzzy_matches(&library::search_key(g.game.title()), &query));
        }

        let has_games = p.library_len > 0
            || (signed_in && !p.hidden.is_empty())
            || (hidden_selected && signed_in);
        let no_filtered = filtered.is_empty();
        let hidden_pending = hidden_selected && (p.hidden_failed || p.hidden_loading);
        let favorites_empty = has_games && !p.loading && favorites_selected && no_filtered;
        let collection_empty = has_games
            && !p.loading
            && !favorites_empty
            && !hidden_pending
            && p.collection.is_some()
            && !favorites_selected
            && no_filtered;
        let no_results = has_games
            && !p.loading
            && no_filtered
            && !favorites_empty
            && !collection_empty
            && !hidden_pending;
        let empty_state = if !has_games && !p.loading {
            "no-games"
        } else if favorites_empty {
            "favorites"
        } else if collection_empty {
            if hidden_selected {
                "hidden"
            } else {
                "collection"
            }
        } else if has_games && hidden_selected && p.hidden_loading {
            "hidden-loading"
        } else if has_games && hidden_selected && p.hidden_failed {
            "hidden-failed"
        } else if no_results {
            "no-results"
        } else {
            ""
        };

        // The Filters menu.
        let favorites_count = p.groups.iter().filter(|g| g.game.flag("favorite")).count();
        let mut collections = vec![LibraryMenuItem {
            id: FAVORITES_COLLECTION_ID.into(),
            label: shell::tr("library.favorites").into(),
            icon: 1,
            count: favorites_count.to_string().into(),
            checked: favorites_selected,
        }];
        if signed_in && (!p.hidden.is_empty() || hidden_selected) {
            collections.push(LibraryMenuItem {
                id: HIDDEN_COLLECTION_ID.into(),
                label: shell::tr("library.hidden_games").into(),
                icon: 2,
                count: p.hidden.len().to_string().into(),
                checked: hidden_selected,
            });
        }
        for (id, name) in &collections_state.items {
            let count = p
                .groups
                .iter()
                .filter(|g| g.game.collection_ids().iter().any(|c| c == id))
                .count();
            collections.push(LibraryMenuItem {
                id: id.clone().into(),
                label: name.clone().into(),
                icon: 0,
                count: count.to_string().into(),
                checked: p.collection.as_deref() == Some(id.as_str()),
            });
        }
        let sources: Vec<LibraryMenuItem> = available_sources
            .iter()
            .map(|s| LibraryMenuItem {
                id: (*s).into(),
                label: shell::tr(&format!("library.library_{s}")).into(),
                icon: match *s {
                    "steam" => 4,
                    "epic" => 5,
                    _ => 3,
                },
                count: SharedString::default(),
                checked: effective_sources.iter().any(|e| e == s),
            })
            .collect();
        let platform_items: Vec<LibraryMenuItem> = platform_options
            .iter()
            .map(|pl| LibraryMenuItem {
                id: pl.clone().into(),
                label: pl.clone().into(),
                icon: -1,
                count: SharedString::default(),
                checked: p.platforms.contains(pl),
            })
            .collect();
        let filters_active = p.collection.is_some()
            || (show_sources && !effective_sources.is_empty())
            || (show_platforms && !p.platforms.is_empty())
            || p.installed_only;

        // A collection that no longer exists falls back to every game.
        let stale_collection = match p.collection.as_deref() {
            Some(FAVORITES_COLLECTION_ID) | None => false,
            Some(HIDDEN_COLLECTION_ID) => !signed_in,
            Some(id) => {
                if collections_state.loaded {
                    !collections_state.items.iter().any(|(c, _)| c == id)
                } else if collections_state.failed && p.library_len > 0 {
                    !p.groups
                        .iter()
                        .any(|g| g.game.collection_ids().iter().any(|c| c == id))
                } else {
                    false
                }
            }
        };

        p.shown = filtered;

        (
            empty_state,
            has_games,
            signed_in || has_games,
            collections,
            show_sources,
            sources,
            show_platforms,
            platform_items,
            filters_active,
            stale_collection,
        )
    });
    let Some((
        empty_state,
        has_games,
        show_controls,
        collections,
        show_sources,
        sources,
        show_platforms,
        platforms,
        filters_active,
        stale,
    )) = state
    else {
        return;
    };
    if stale {
        with_page(|p| p.collection = None);
        shell::storage_remove("library-collection");
        apply_filters(reset_scroll);
        return;
    }

    let data = ui.global::<LibraryData>();
    with_page(|p| {
        data.set_loading(p.loading);
        data.set_view_mode(p.view.as_str().into());
        data.set_sort_by(p.sort_by.as_str().into());
        data.set_category(
            match p.category {
                Category::All => "all",
                Category::Pc => "pc",
                Category::Classics => "classics",
            }
            .into(),
        );
        data.set_installed_only(p.installed_only);
        data.set_collections_any_checked(p.collection.is_some());
    });
    data.set_empty_state(empty_state.into());
    data.set_has_games(has_games);
    data.set_show_controls(show_controls);
    data.set_collections(ModelRc::new(VecModel::from(collections)));
    data.set_show_sources(show_sources);
    data.set_sources(ModelRc::new(VecModel::from(sources)));
    data.set_show_platforms(show_platforms);
    data.set_platforms(ModelRc::new(VecModel::from(platforms)));
    data.set_filters_active(filters_active);
    if reset_scroll {
        data.set_scroll_reset(data.get_scroll_reset() + 1);
    }
    refresh_cards();
}

fn available_sources_rc(groups: &[Rc<Presentation>]) -> (Vec<&'static str>, bool) {
    let mut set = HashSet::from(["hydra"]);
    let mut imported = false;
    for group in groups {
        for member in &group.members {
            set.insert(library::game_source(member));
            if member.0.get("hasActiveSteamImport") == Some(&Value::Bool(true))
                || (member.shop() == "epic" && member.flag("hasActiveEpicImport"))
            {
                imported = true;
            }
        }
    }
    (
        ["hydra", "steam", "epic"]
            .into_iter()
            .filter(|s| set.contains(s))
            .collect(),
        imported,
    )
}

/// `sortLibraryGames` over shared rows (stable, like Array.prototype.sort).
fn sort_rc(games: &mut [Rc<Presentation>], sort_by: SortBy) {
    games.sort_by(|a, b| library::compare_presentations(a, b, sort_by));
}

fn filter_rc(
    games: &[Rc<Presentation>],
    category: Category,
    sources: &[String],
    platforms: &[String],
) -> Vec<Rc<Presentation>> {
    let classics = |p: &Presentation| p.game.shop() == "launchbox";
    let sources: HashSet<&str> = if category.shows_sources() {
        sources.iter().map(String::as_str).collect()
    } else {
        HashSet::new()
    };
    let platforms: HashSet<&str> = if category.shows_platforms() {
        platforms.iter().map(String::as_str).collect()
    } else {
        HashSet::new()
    };
    games
        .iter()
        .filter(|p| match category {
            Category::Pc => !classics(p),
            Category::Classics => classics(p),
            Category::All => true,
        })
        .filter(|p| {
            if sources.is_empty() && platforms.is_empty() {
                return true;
            }
            if classics(p) {
                return platforms.is_empty()
                    || p.game
                        .str("platform")
                        .is_some_and(|pl| platforms.contains(pl));
            }
            sources.is_empty()
                || p.members
                    .iter()
                    .any(|m| sources.contains(library::game_source(m)))
        })
        .cloned()
        .collect()
}

// ---- cards ------------------------------------------------------------------

fn prefs() -> Value {
    shell::db()
        .and_then(|db| db.get::<Value>(hydra_db::keys::USER_PREFERENCES))
        .unwrap_or(Value::Null)
}

fn pref(prefs: &Value, key: &str) -> bool {
    prefs.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// Rebuild the card rows (data only; art comes from the caches).
fn refresh_cards() {
    let prefs = prefs();
    let Some(i18n) = shell::i18n() else { return };
    with_page(|p| {
        let shown = p.shown.clone();
        let rows: Vec<LibraryCard> = shown
            .iter()
            .map(|g| card_for(p, g, &prefs, &i18n))
            .collect();
        p.cards.set_vec(rows);
    });
    load_visible();
}

/// useGameCard().formatPlayTime
fn format_play_time(i18n: &hydra_i18n::I18n, ms: f64, short: bool) -> String {
    let minutes = ms / 60000.0;
    if minutes < 120.0 {
        let key = if short {
            "library.amount_minutes_short"
        } else {
            "library.amount_minutes"
        };
        // toFixed(0): halves round up
        return i18n.t_with(
            key,
            &[("amount", format!("{}", minutes.round() as i64).into())],
        );
    }
    let hours = minutes / 60.0;
    if short {
        i18n.t_with(
            "library.amount_hours_short",
            &[("amount", format!("{}", hours.floor() as i64).into())],
        )
    } else {
        i18n.t_with(
            "library.amount_hours",
            &[("amount", i18n.format_number(hours.round()).into())],
        )
    }
}

/// resolveClassicsBadge: the platform label and the emulator icon.
pub(crate) fn classics_badge(shop: &str, platform: Option<&str>) -> (Option<&'static str>, i32) {
    if shop != "launchbox" {
        return (None, 0);
    }
    let Some(platform) = platform else {
        return (None, 0);
    };
    let p = platform.to_lowercase();
    let squashed: String = p.chars().filter(|c| !c.is_whitespace()).collect();
    let word = |w: &str| {
        p.split(|c: char| !c.is_alphanumeric() && c != '_')
            .any(|part| part == w)
    };
    let trimmed = p.trim();
    let wii = trimmed == "wii"
        || trimmed
            .strip_prefix("nintendo")
            .is_some_and(|rest| rest.starts_with(char::is_whitespace) && rest.trim() == "wii");
    let system = if squashed.contains("playstationportable") || word("psp") {
        Some(("PSP", 4))
    } else if squashed.contains("playstation3") || word("ps3") {
        Some(("PS3", 3))
    } else if squashed.contains("playstation2") || word("ps2") {
        Some(("PS2", 2))
    } else if p.contains("playstation") || word("ps1") || word("psx") {
        Some(("PS", 1))
    } else if squashed.contains("gamecube") {
        Some(("GC", 5))
    } else if wii {
        Some(("Wii", 5))
    } else {
        None
    };
    if let Some((label, emulator)) = system {
        return (Some(label), emulator);
    }
    let retro = if squashed.contains("gameboyadvance") || word("gba") {
        Some("GBA")
    } else if squashed.contains("gameboycolor") || word("gbc") {
        Some("GBC")
    } else if squashed.contains("gameboy") || word("gb") {
        Some("GB")
    } else if squashed.contains("nintendo64") || word("n64") {
        Some("N64")
    } else if squashed.contains("supernintendo") || word("snes") {
        Some("SNES")
    } else if squashed.contains("nintendoentertainmentsystem") || word("nes") || word("famicom") {
        Some("NES")
    } else {
        None
    };
    match retro {
        Some(label) => (Some(label), 6),
        None => (None, 0),
    }
}

fn image_variants<'a>(
    game: &'a library::LibraryGame,
    url: &str,
) -> Option<&'a serde_json::Map<String, Value>> {
    let variants = game.get("images")?.get(url.trim())?.as_object()?;
    let has_base = variants
        .get("base")
        .and_then(Value::as_str)
        .is_some_and(|b| !b.is_empty());
    let has_widths = variants
        .get("widths")
        .and_then(Value::as_array)
        .is_some_and(|w| !w.is_empty());
    (has_base && has_widths).then_some(variants)
}

/// pickCatalogueImageUrl: the smallest copy at least `target` wide, else the largest.
fn pick_variant(variants: &serde_json::Map<String, Value>, target: f32) -> Option<String> {
    let base = variants.get("base")?.as_str()?;
    let mut widths: Vec<u64> = variants
        .get("widths")?
        .as_array()?
        .iter()
        .filter_map(Value::as_u64)
        .collect();
    widths.sort_unstable();
    let width = widths
        .iter()
        .copied()
        .find(|w| *w as f32 >= target)
        .or_else(|| widths.last().copied())?;
    Some(format!("{base}/w{width}.webp"))
}

/// resolveImageSource: URLs pass through, Windows/Unix paths become `local:`.
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

/// The card's art: candidates in fallback order, the resized copy when the
/// API sent one, and how it is framed.
fn plan_for(p: &Page, group: &Presentation) -> Plan {
    let game = &group.game;
    let large = p.view == ViewMode::Large;
    let selected = |kind: &str| {
        game.get("selectedArtworkTypes")
            .and_then(Value::as_array)
            .is_some_and(|types| types.iter().any(|t| t.as_str() == Some(kind)))
    };
    let classics = game.shop() == "launchbox";
    let mut candidates: Vec<(Option<&str>, bool)> = Vec::new();
    if large {
        candidates.push((game.str("customHeroImageUrl"), true));
        candidates.push((game.str("libraryHeroImageUrl"), selected("hero")));
        if !classics {
            candidates.push((game.str("customCoverImageUrl"), true));
            candidates.push((game.str("coverImageUrl"), selected("grid")));
        }
    } else {
        candidates.push((game.str("customCoverImageUrl"), true));
        candidates.push((game.str("coverImageUrl"), selected("grid")));
    }
    candidates.push((game.str("libraryImageUrl"), false));
    candidates.push((game.str("iconUrl"), false));
    let candidates: Vec<(&str, bool)> = candidates
        .into_iter()
        .filter_map(|(url, chosen)| url.filter(|u| !u.trim().is_empty()).map(|u| (u, chosen)))
        .collect();

    let level = p.fallback.get(game.id()).copied().unwrap_or(0);
    let mut plan = Plan::default();
    if let Some(logo) = large
        .then(|| {
            game.str("customLogoImageUrl")
                .or_else(|| game.str("logoImageUrl"))
        })
        .flatten()
        && !logo.trim().is_empty()
    {
        plan.logo_url = Some(
            match image_variants(game, logo).filter(|_| !p.variant_failed.contains(logo.trim())) {
                Some(variants) => pick_variant(variants, LOGO_DISPLAY_WIDTH * p.scale)
                    .unwrap_or_else(|| resolve_source(logo)),
                None => resolve_source(logo),
            },
        );
    }
    let Some(&(raw, chosen)) = candidates.get(level) else {
        plan.mode = 3;
        return plan;
    };
    plan.raw_url = raw.trim().to_string();
    plan.mode = if classics && !chosen {
        2
    } else if chosen && !large {
        1
    } else {
        0
    };
    let variants = image_variants(game, raw).filter(|_| !p.variant_failed.contains(&plan.raw_url));
    match variants {
        Some(variants) => {
            plan.has_variants = true;
            plan.thumb_hash = variants
                .get("thumbHash")
                .and_then(Value::as_str)
                .map(str::to_string);
            // Large heroes follow the window width (useViewportCatalogueImageUrl);
            // covers follow the card's rendered width (sizes="auto").
            let target = if large {
                let window =
                    p.ui.upgrade()
                        .map(|ui| ui.window().size().width as f32)
                        .unwrap_or(1200.0);
                window
            } else {
                p.card_px.0 as f32
            };
            plan.load_url = pick_variant(variants, target).unwrap_or_else(|| resolve_source(raw));
        }
        None => plan.load_url = resolve_source(raw),
    }
    plan
}

fn card_for(
    p: &mut Page,
    group: &Presentation,
    prefs: &Value,
    i18n: &hydra_i18n::I18n,
) -> LibraryCard {
    let game = &group.game;
    let plan = plan_for(p, group);
    let active: Vec<&library::LibraryGame> = group
        .members
        .iter()
        .filter(|m| !m.flag("isDeleted"))
        .collect();
    let steam_import = active
        .iter()
        .any(|m| m.0.get("hasActiveSteamImport") == Some(&Value::Bool(true)));
    let epic_import = active
        .iter()
        .any(|m| m.0.get("hasActiveEpicImport") == Some(&Value::Bool(true)));
    let play_ms = [
        "playTimeInMilliseconds",
        "steamPlayTimeInMilliseconds",
        "epicPlayTimeInMilliseconds",
    ]
    .iter()
    .map(|k| game.number(k).unwrap_or(0.0).max(0.0))
    .sum::<f64>();
    let (label, emulator) = classics_badge(game.shop(), game.str("platform"));
    let ready = if game.shop() == "launchbox" {
        game.str("selectedDiscPath").is_some_and(|p| !p.is_empty())
    } else {
        game.is_installed()
    };
    let achievements = game.number("achievementCount").unwrap_or(0.0).max(0.0) as i32;
    let unlocked = game
        .number("unlockedAchievementCount")
        .unwrap_or(0.0)
        .max(0.0) as i32;

    let mut sizes: Vec<(i32, f64)> = Vec::new();
    if let Some(bytes) = game.number("installerSizeInBytes").filter(|b| *b > 0.0) {
        sizes.push((0, bytes));
    }
    if let Some(bytes) = game.number("installedSizeInBytes").filter(|b| *b > 0.0) {
        sizes.push((1, bytes));
    }
    sizes.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let max_bytes = sizes.first().map(|s| s.1).unwrap_or(1.0);
    let size_bars: Vec<LibrarySizeBar> = if pref(prefs, "hideLibraryReadySizeBadges") {
        Vec::new()
    } else {
        sizes
            .iter()
            .map(|(kind, bytes)| LibrarySizeBar {
                kind: *kind,
                label: format_bytes(*bytes).into(),
                width: ((bytes / max_bytes) * 80.0).round() as f32,
            })
            .collect()
    };

    let placeholder = plan
        .thumb_hash
        .as_deref()
        .map(|hash| placeholder(p, hash))
        .unwrap_or_default();
    let decoded = p.decoded.get(&plan.load_url);
    let logo = plan.logo_url.as_ref().and_then(|url| p.logos.get(url));
    let large = p.view == ViewMode::Large;
    LibraryCard {
        id: game.id().into(),
        title: game.title().into(),
        cover: decoded.map(|d| d.cover.clone()).unwrap_or_default(),
        placeholder: if large {
            Image::default()
        } else {
            placeholder.clone()
        },
        frost: decoded.map(|d| d.frost.clone()).unwrap_or_default(),
        backdrop: decoded.map(|d| d.backdrop.clone()).unwrap_or_default(),
        mode: plan.mode,
        show_playtime: !pref(prefs, "hideLibraryGameBadges"),
        playtime_long: format_play_time(i18n, play_ms, false).into(),
        playtime_short: format_play_time(i18n, play_ms, true).into(),
        manual_playtime: game.flag("hasManuallyUpdatedPlaytime"),
        hidden_from_others: game.flag("isHiddenFromOthers"),
        concealed: game.flag("isConcealed"),
        steam_badge: steam_import && !pref(prefs, "hideSteamLibraryBadges"),
        epic_badge: epic_import && !pref(prefs, "hideEpicLibraryBadges"),
        platform_label: if pref(prefs, "hideLibraryClassicsBadges") {
            ""
        } else {
            label.unwrap_or("")
        }
        .into(),
        ready: ready && !pref(prefs, "hideLibraryReadySizeBadges"),
        emulator,
        show_achievements: !pref(prefs, "hideLibraryAchievementProgress"),
        achievements: achievements.max(unlocked),
        unlocked,
        hero: if large {
            decoded.map(|d| d.cover.clone()).unwrap_or_default()
        } else {
            Image::default()
        },
        hero_placeholder: if large { placeholder } else { Image::default() },
        hero_frost: if large {
            decoded.map(|d| d.frost.clone()).unwrap_or_default()
        } else {
            Image::default()
        },
        logo: logo.map(|l| l.image.clone()).unwrap_or_default(),
        logo_shadow: logo.map(|l| l.shadow.clone()).unwrap_or_default(),
        logo_shadow_pad: logo.map(|l| l.pad).unwrap_or(0.0),
        logo_width: logo.map(|l| l.width).unwrap_or(0.0),
        sizes: ModelRc::new(VecModel::from(size_bars)),
    }
}

/// formatBytes (shared/index.ts): 1024-based, truncated to one decimal.
pub(crate) fn format_bytes(bytes: f64) -> String {
    const UNITS: [&str; 9] = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    if !bytes.is_finite() || bytes <= 0.0 {
        return "0 B".into();
    }
    let base = ((bytes.ln() / 1024f64.ln()).floor().max(0.0) as usize).min(UNITS.len() - 1);
    let value = (bytes / 1024f64.powi(base as i32) * 10.0).trunc() / 10.0;
    // JS prints integers without ".0".
    let text = if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    };
    format!("{text} {}", UNITS[base])
}

/// decodeCatalogueThumbHash: base64 -> ThumbHash -> a small RGBA image (cached).
fn placeholder(p: &mut Page, hash: &str) -> Image {
    if let Some(image) = p.placeholders.get(hash) {
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
    if p.placeholders.len() >= 1000
        && let Some(oldest) = p.placeholders.keys().next().cloned()
    {
        p.placeholders.remove(&oldest);
    }
    p.placeholders.insert(hash.to_string(), image.clone());
    image
}

/// Fetch and decode the art of the cards on screen (plus overscan).
fn load_visible() {
    let jobs = with_page(|p| {
        let (first, last) = p.range;
        let last = last.min(p.shown.len());
        let mut wanted = HashSet::new();
        let mut jobs = Vec::new();
        if p.card_px.0 == 0 {
            return (
                p.loader.clone(),
                jobs,
                p.wanted.clone(),
                p.card_px,
                p.scale,
                p.view,
            );
        }
        for index in first..last {
            let group = p.shown[index].clone();
            let plan = plan_for(p, &group);
            if !plan.load_url.is_empty() {
                wanted.insert(plan.load_url.clone());
                if !p.decoded.contains_key(&plan.load_url)
                    && !p.pending.contains(&plan.load_url)
                    && !p.failed.contains(&plan.load_url)
                {
                    p.pending.insert(plan.load_url.clone());
                    jobs.push((plan.load_url.clone(), plan.mode, false));
                }
            }
            if let Some(logo) = plan.logo_url {
                wanted.insert(logo.clone());
                if !p.logos.contains_key(&logo)
                    && !p.pending.contains(&logo)
                    && !p.failed.contains(&logo)
                {
                    p.pending.insert(logo.clone());
                    jobs.push((logo, 0, true));
                }
            }
        }
        // Drop decoded art far from the viewport once the cache grows.
        if p.decoded.len() > MAX_DECODED {
            p.decoded.retain(|url, _| wanted.contains(url));
        }
        if p.logos.len() > MAX_DECODED {
            p.logos.retain(|url, _| wanted.contains(url));
        }
        *p.wanted.lock().unwrap() = wanted;
        (
            p.loader.clone(),
            jobs,
            p.wanted.clone(),
            p.card_px,
            p.scale,
            p.view,
        )
    });
    let Some((loader, jobs, wanted, card_px, scale, view)) = jobs else {
        return;
    };
    for (url, mode, is_logo) in jobs {
        let wanted = wanted.clone();
        loader.run(move |http| {
            if !wanted.lock().unwrap().contains(&url) {
                let _ = slint::invoke_from_event_loop(move || {
                    with_page(|p| p.pending.remove(&url));
                });
                return;
            }
            let decoded =
                images::fetch(http, &source_of(&url)).and_then(|bytes| images::open_bytes(&bytes));
            let result = decoded.map(|img| {
                if is_logo {
                    LoadResult::Logo(logo_pixels(img, scale))
                } else {
                    LoadResult::Cover(cover_pixels(img, mode, card_px, scale, view))
                }
            });
            let _ = slint::invoke_from_event_loop(move || finish_load(url, result));
        });
    }
}

enum LoadResult {
    Cover((Pixels, Pixels, Option<Pixels>)),
    Logo((Pixels, Pixels, f32, f32)),
}

/// CSS `saturate(amount)` (the filter's color matrix).
pub fn saturate(img: &mut image::RgbImage, amount: f32) {
    let s = amount;
    let m = [
        [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    ];
    for pixel in img.pixels_mut() {
        let [r, g, b] = pixel.0.map(|c| c as f32);
        for (i, row) in m.iter().enumerate() {
            pixel.0[i] = (row[0] * r + row[1] * g + row[2] * b)
                .round()
                .clamp(0.0, 255.0) as u8;
        }
    }
}

/// The cover at card size, its frost (blur 8px) and, for classics, the
/// backdrop (blur 16px / 18px large, saturate 1.1).
fn cover_pixels(
    img: DynamicImage,
    mode: i32,
    card_px: (u32, u32),
    scale: f32,
    view: ViewMode,
) -> (Pixels, Pixels, Option<Pixels>) {
    use image::imageops::FilterType;
    // Keep about the displayed size (cover-fit: the short side matches the
    // card, with room for the 1.02 hover scale). Small copies stay as sent,
    // like the browser sampling the w200/w400 file directly.
    let (w, h) = (img.width().max(1), img.height().max(1));
    let fit = (card_px.0 as f32 * 1.02 / w as f32).max(card_px.1 as f32 * 1.02 / h as f32);
    let display = if fit < 1.0 / 1.5 {
        img.resize(
            (w as f32 * fit).ceil() as u32,
            (h as f32 * fit).ceil() as u32,
            FilterType::CatmullRom,
        )
    } else {
        img
    };
    // Effects run on a quarter-size copy. CSS blur(n) is a gaussian with
    // sigma n CSS px; convert to the copy's pixels.
    let shrink = 4.0;
    let small = display.resize(
        ((display.width() as f32 / shrink).ceil() as u32).max(1),
        ((display.height() as f32 / shrink).ceil() as u32).max(1),
        FilterType::Triangle,
    );
    // Physical pixels per display pixel under object-fit: cover.
    let phys_per_px =
        (card_px.0 as f32 / display.width() as f32).max(card_px.1 as f32 / display.height() as f32);
    let sigma = |css: f32| (css * scale / phys_per_px.max(1e-3) / shrink).max(0.5);
    let frost = images::to_pixels(
        DynamicImage::ImageRgb8(small.blur(sigma(8.0)).to_rgb8()),
        Op::Full,
    );
    let backdrop = (mode == 2).then(|| {
        let reach = if view == ViewMode::Large { 18.0 } else { 16.0 };
        let mut blurred = small.blur(sigma(reach)).to_rgb8();
        saturate(&mut blurred, 1.1);
        images::to_pixels(DynamicImage::ImageRgb8(blurred), Op::Full)
    });
    (images::to_pixels(display, Op::Full), frost, backdrop)
}

/// The logo at up to 400 CSS px wide, plus `drop-shadow(0 4px 12px rgba(0,0,0,.6))`
/// rendered from its alpha (sigma 6 CSS px), padded by the blur's reach.
/// Returns the logo, the shadow, the padding (image px) and the CSS width.
fn logo_pixels(img: DynamicImage, scale: f32) -> (Pixels, Pixels, f32, f32) {
    use image::imageops::FilterType;
    // max-height 120px / max-width 400px, never past the natural size.
    let (natural_w, natural_h) = (img.width() as f32, img.height().max(1) as f32);
    let css_width = LOGO_DISPLAY_WIDTH
        .min(natural_w)
        .min(120.0 * natural_w / natural_h)
        .max(1.0);
    let max = (css_width * scale).ceil() as u32;
    let logo = if img.width() > max {
        img.resize(max, u32::MAX, FilterType::Triangle)
    } else {
        img
    };
    let sigma = (6.0 * logo.width() as f32 / css_width).max(0.5);
    let pad = (sigma * 3.0).ceil() as u32;
    let rgba = logo.to_rgba8();
    let mut alpha = image::GrayImage::new(rgba.width() + 2 * pad, rgba.height() + 2 * pad);
    for (x, y, pixel) in rgba.enumerate_pixels() {
        alpha.put_pixel(x + pad, y + pad, image::Luma([pixel.0[3]]));
    }
    let blurred = image::imageops::blur(&alpha, sigma);
    let mut shadow = image::RgbaImage::new(blurred.width(), blurred.height());
    for (x, y, pixel) in blurred.enumerate_pixels() {
        shadow.put_pixel(
            x,
            y,
            image::Rgba([0, 0, 0, (pixel.0[0] as f32 * 0.6).round() as u8]),
        );
    }
    (
        images::to_pixels(DynamicImage::ImageRgba8(rgba), Op::Full),
        images::to_pixels(DynamicImage::ImageRgba8(shadow), Op::Full),
        pad as f32,
        css_width,
    )
}

fn finish_load(url: String, result: Option<LoadResult>) {
    let retry = with_page(|p| {
        p.pending.remove(&url);
        match result {
            Some(LoadResult::Cover((cover, frost, backdrop))) => {
                p.decoded.insert(
                    url.clone(),
                    Decoded {
                        cover: cover.into_image(),
                        frost: frost.into_image(),
                        backdrop: backdrop.map(Pixels::into_image).unwrap_or_default(),
                    },
                );
                false
            }
            Some(LoadResult::Logo((image, shadow, pad, width))) => {
                p.logos.insert(
                    url.clone(),
                    Logo {
                        image: image.into_image(),
                        shadow: shadow.into_image(),
                        pad,
                        width,
                    },
                );
                false
            }
            None => {
                p.failed.insert(url.clone());
                // markFailed: a broken resized copy falls back to the original;
                // a broken original moves to the next candidate.
                let mut changed = false;
                for group in p.shown.clone() {
                    let plan = plan_for(p, &group);
                    if plan.load_url == url {
                        if plan.has_variants {
                            p.variant_failed.insert(plan.raw_url.clone());
                        } else {
                            *p.fallback.entry(group.game.id().to_string()).or_insert(0) += 1;
                        }
                        changed = true;
                    } else if plan.logo_url.as_deref() == Some(url.as_str()) {
                        if let Some(raw) = group
                            .game
                            .str("customLogoImageUrl")
                            .or_else(|| group.game.str("logoImageUrl"))
                        {
                            p.variant_failed.insert(raw.trim().to_string());
                        }
                        changed = true;
                    }
                }
                changed
            }
        }
    })
    .unwrap_or(false);
    update_cards_for(&url);
    if retry {
        refresh_cards();
    }
}

/// Put freshly decoded art into the rows that show it.
fn update_cards_for(url: &str) {
    let prefs = prefs();
    let Some(i18n) = shell::i18n() else { return };
    with_page(|p| {
        let (first, last) = p.range;
        let last = last.min(p.shown.len());
        for index in first..last {
            let group = p.shown[index].clone();
            let plan = plan_for(p, &group);
            if plan.load_url == url || plan.logo_url.as_deref() == Some(url) {
                let card = card_for(p, &group, &prefs, &i18n);
                p.cards.set_row_data(index, card);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fuzzy_search_matches_characters_in_order() {
        assert!(fuzzy_matches("the witcher 3", "wtc3"));
        assert!(!fuzzy_matches("hades", "sd"));
        assert!(fuzzy_matches("anything", ""));
    }

    #[test]
    fn classics_badges() {
        assert_eq!(
            classics_badge("launchbox", Some("Sony Playstation 2")),
            (Some("PS2"), 2)
        );
        assert_eq!(
            classics_badge("launchbox", Some("Sony PSP")),
            (Some("PSP"), 4)
        );
        assert_eq!(
            classics_badge("launchbox", Some("Nintendo GameCube")),
            (Some("GC"), 5)
        );
        assert_eq!(
            classics_badge("launchbox", Some("Nintendo Wii")),
            (Some("Wii"), 5)
        );
        assert_eq!(
            classics_badge("launchbox", Some("Super Nintendo Entertainment System")),
            (Some("SNES"), 6)
        );
        assert_eq!(
            classics_badge("launchbox", Some("Nintendo Game Boy Advance")),
            (Some("GBA"), 6)
        );
        assert_eq!(
            classics_badge("launchbox", Some("Sony Playstation")),
            (Some("PS"), 1)
        );
        assert_eq!(classics_badge("steam", Some("Sony Playstation")), (None, 0));
    }

    #[test]
    fn picks_the_smallest_copy_that_covers_the_width() {
        let variants: serde_json::Map<String, Value> =
            serde_json::from_str(r#"{"base":"https://cdn/x","widths":[600,200,400]}"#).unwrap();
        assert_eq!(
            pick_variant(&variants, 164.0).unwrap(),
            "https://cdn/x/w200.webp"
        );
        assert_eq!(
            pick_variant(&variants, 300.0).unwrap(),
            "https://cdn/x/w400.webp"
        );
        assert_eq!(
            pick_variant(&variants, 900.0).unwrap(),
            "https://cdn/x/w600.webp"
        );
    }

    #[test]
    fn formats_bytes_like_the_renderer() {
        assert_eq!(format_bytes(1536.0), "1.5 KB");
        assert_eq!(format_bytes(53_687_091_200.0), "50 GB");
        // Math.trunc(x * 10) / 10
        assert_eq!(format_bytes(1_073_741_824.0 * 1.99), "1.9 GB");
    }
}
