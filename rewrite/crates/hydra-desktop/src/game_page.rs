//! The game details page: Steam store data, artwork, gallery, trailers,
//! description, sidebar sections, reviews UI. Ported from
//! src/renderer/src/pages/game-details; the data it shows today comes from
//! Steam's `appdetails` and the Hydra API artwork endpoint.

use hydra_media::images::{self, Loader, Op};
use hydra_media::video;
use hydra_store::{html, steam};
use slint::{
    ComponentHandle, Image, Model, ModelRc, SharedString, StyledText, Timer, TimerMode, VecModel,
};
use std::{
    cell::RefCell,
    collections::HashSet,
    rc::Rc,
    time::{Duration, Instant},
};

use crate::format;
use crate::{AppWindow, DescBlock, FormatEdit, GameData, Language, Marks, MediaItem, Playback, ReviewEditor};

/// UI-thread state of the open game page.
struct App {
    ui: slint::Weak<AppWindow>,
    loader: Loader,
    app_id: u64,
    locale: String,
    /// The open game (`/game/:shop/:objectId`).
    shop: String,
    object_id: String,
    /// Bumped on every navigation, so late results from a previous game are dropped.
    generation: u64,
    media: Rc<VecModel<MediaItem>>,
    /// Full-size image per media index (screenshot, or trailer poster).
    full_sources: Vec<String>,
    /// Stream URL per media index (trailers only).
    stream_urls: Vec<Option<String>>,
    loaded: HashSet<usize>,
    pending: HashSet<usize>,
    wanted: HashSet<usize>,
    startup_pending: usize,
    started_at: Instant,
    video: Option<video::Session>,
    video_timer: Timer,
}

thread_local! {
    static APP: RefCell<Option<App>> = const { RefCell::new(None) };
}

fn with_app<R>(f: impl FnOnce(&mut App) -> R) -> Option<R> {
    APP.with(|app| app.borrow_mut().as_mut().map(f))
}

fn gd(ui: &AppWindow) -> GameData<'_> {
    ui.global::<GameData>()
}

/// Setter for one of the page's image properties.
type SetImage = fn(&AppWindow, Image);

/// The skeleton stays up at least this long, like the Electron page's loading state.
const MIN_SKELETON: Duration = Duration::from_millis(400);
/// Never wait longer than this for the hero/logo before showing the page.
const MAX_SKELETON: Duration = Duration::from_secs(4);

fn md(text: &str) -> StyledText {
    StyledText::from_markdown(text).unwrap_or_else(|err| {
        eprintln!("markdown error ({err}) in: {text}");
        StyledText::from_plain_text(text)
    })
}

/// Called once at startup.
pub fn init(ui: &AppWindow, loader: &Loader) {
    let media = Rc::new(VecModel::from(Vec::<MediaItem>::new()));
    gd(ui).set_media(ModelRc::from(media.clone()));
    gd(ui).set_description(ModelRc::new(VecModel::from(Vec::<DescBlock>::new())));
    gd(ui).set_reviews(ModelRc::new(VecModel::from(Vec::<crate::Review>::new())));
    APP.with(|app| {
        *app.borrow_mut() = Some(App {
            ui: ui.as_weak(),
            loader: loader.clone(),
            app_id: 0,
            locale: "en".into(),
            shop: String::new(),
            object_id: String::new(),
            generation: 0,
            media,
            full_sources: Vec::new(),
            stream_urls: Vec::new(),
            loaded: HashSet::new(),
            pending: HashSet::new(),
            wanted: HashSet::new(),
            startup_pending: 0,
            started_at: Instant::now(),
            video: None,
            video_timer: Timer::default(),
        })
    });
    wire_callbacks(ui, loader);
    gd(ui).on_fullscreen_changed({
        let weak = ui.as_weak();
        move |fullscreen| {
            if let Some(ui) = weak.upgrade() {
                ui.window().set_fullscreen(fullscreen);
            }
        }
    });
}

/// Navigating to `/game/:shop/:objectId`.
pub fn open(shop: &str, object_id: &str, title: &str, locale: &str) {
    let Some(ui) = with_app(|app| app.ui.upgrade()).flatten() else { return };
    // Leaving the previous game: stop its trailer, drop its images.
    with_app(|app| {
        app.generation += 1;
        app.video = None;
        app.video_timer.stop();
        app.media.set_vec(Vec::new());
        app.full_sources.clear();
        app.stream_urls.clear();
        app.loaded.clear();
        app.pending.clear();
        app.wanted.clear();
        app.locale = locale.to_string();
        app.shop = shop.to_string();
        app.object_id = object_id.to_string();
        app.app_id = if shop == "steam" { object_id.parse().unwrap_or(0) } else { 0 };
    });
    let g = gd(&ui);
    g.set_loaded(false);
    g.set_game_title(title.into());
    g.set_hero(Image::default());
    g.set_hero_blur(Image::default());
    g.set_logo(Image::default());
    g.set_description(ModelRc::new(VecModel::from(Vec::<DescBlock>::new())));
    g.set_languages(ModelRc::new(VecModel::from(Vec::<Language>::new())));
    g.set_release_date(SharedString::default());
    g.set_publisher(SharedString::default());
    g.set_controller_support("none".into());
    apply_library_state(&ui, shop, object_id);
    fetch_game();
}

/// The hero panel's library state (hero-panel-playtime.tsx, hero-panel-actions.tsx).
pub fn apply_library_state(ui: &AppWindow, shop: &str, object_id: &str) {
    let g = gd(ui);
    let Some(group) = crate::shell::find_library_game(shop, object_id) else {
        g.set_in_library(false);
        g.set_has_executable(false);
        g.set_favorite(false);
        g.set_pinned(false);
        g.set_playtime(SharedString::default());
        g.set_last_played(SharedString::default());
        return;
    };
    let game = &group.game;
    let operational = &group.members[group.operational];
    g.set_in_library(true);
    g.set_has_executable(operational.executable_path().is_some());
    g.set_favorite(game.flag("favorite"));
    g.set_pinned(game.flag("isPinned"));
    let Some(i18n) = crate::shell::i18n() else { return };
    let milliseconds = game.displayed_play_time();
    let last_played = game
        .str("lastTimePlayed")
        .and_then(hydra_core::library::parse_iso_millis);
    if last_played.is_none() && milliseconds <= 0.0 {
        g.set_playtime(SharedString::default());
        g.set_last_played(SharedString::default());
        return;
    }
    // MAX_MINUTES_TO_SHOW_IN_PLAYTIME = 120: minutes below two hours, hours after.
    let minutes = milliseconds / 1000.0 / 60.0;
    let amount = if minutes < 120.0 {
        i18n.t_with("game_details.amount_minutes", &[("amount", format!("{minutes:.0}").into())])
    } else {
        let hours = (minutes / 60.0).round();
        i18n.t_with("game_details.amount_hours", &[("amount", i18n.format_number(hours).into())])
    };
    g.set_playtime(i18n.t_with("game_details.play_time", &[("amount", amount.into())]).into());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default();
    g.set_last_played(
        last_played
            .map(|at| {
                let period = hydra_i18n::date::format_distance(i18n.language(), at, now, true);
                i18n.t_with("game_details.last_time_played", &[("period", period.into())])
            })
            .unwrap_or_default()
            .into(),
    );
}

/// App exit: stop the trailer threads while thread-locals are still alive.
pub fn shutdown() {
    let app = APP.with(|app| app.borrow_mut().take());
    if let Some(mut app) = app {
        app.video_timer.stop();
        drop(app.video.take());
    }
}

/// Navigating away from the game page.
pub fn close() {
    with_app(|app| {
        app.generation += 1;
        app.video = None;
        app.video_timer.stop();
        app.media.set_vec(Vec::new());
        app.loaded.clear();
        app.pending.clear();
        app.wanted.clear();
    });
}

/// Fetch shop details + artwork on a worker thread, then build the page.
pub fn fetch_game() {
    let Some((app_id, locale, generation)) =
        with_app(|app| (app.app_id, app.locale.clone(), app.generation))
    else {
        return;
    };
    if app_id == 0 {
        // TODO(game-details): Epic, custom and classics games (shop details from the Hydra API).
        eprintln!("TODO(game-details): non-Steam game pages");
        return;
    }
    let db = crate::shell::db();
    std::thread::spawn(move || {
        let client = hydra_store::http_client();
        let steam_language = steam::steam_language(&locale);
        let cache_key = hydra_db::keys::game_shop_cache_item("steam", &app_id.to_string(), steam_language);
        let game_key = hydra_db::keys::game("steam", &app_id.to_string());

        // get-game-shop-details.ts: cached details render at once; the request
        // still runs and refreshes the cache for next time.
        let cached: Option<serde_json::Value> =
            db.as_ref().and_then(|db| db.get_in(hydra_db::keys::GAME_SHOP_CACHE, &cache_key));
        let cached_assets: Option<serde_json::Value> =
            db.as_ref().and_then(|db| db.get_in(hydra_db::keys::GAME_SHOP_ASSETS, &game_key));
        let wrap = |data: &serde_json::Value| serde_json::json!({ app_id.to_string(): { "success": true, "data": data } });

        let assets_from = |value: &serde_json::Value| {
            let field = |key: &str| value.get(key).and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(str::to_string);
            steam::Assets {
                hero: field("libraryHeroImageUrl"),
                logo: field("logoImageUrl"),
                cover: field("coverImageUrl"),
                library: field("libraryImageUrl"),
                icon: field("iconUrl"),
            }
        };

        let details = match cached.as_ref().and_then(|data| steam::parse_app_details(&wrap(data), app_id)) {
            Some(details) => {
                let (client, db, key) = (client.clone(), db.clone(), cache_key.clone());
                std::thread::spawn(move || {
                    let _ = fetch_and_cache(&client, app_id, steam_language, &key, db.as_deref());
                });
                Ok(Some(details))
            }
            None => fetch_and_cache(&client, app_id, steam_language, &cache_key, db.as_deref()),
        };
        // Same source as get-game-assets.ts: stored assets, else the Hydra API, else Steam's CDN.
        let assets = cached_assets
            .as_ref()
            .map(assets_from)
            .filter(|a| a.hero.is_some() || a.logo.is_some())
            .or_else(|| {
                let api = hydra_core::config::api_url();
                Some(api)
                    .filter(|api| !api.is_empty())
                    .and_then(|api| steam::hydra_assets(&client, &api, "steam", &app_id.to_string()))
            })
            .unwrap_or_else(|| steam::steam_cdn_assets(app_id));
        let _ = slint::invoke_from_event_loop(move || {
            if with_app(|app| app.generation) == Some(generation) {
                apply_game(details, assets);
            }
        });
    });
}

fn apply_game(details: Result<Option<steam::AppDetails>, String>, assets: steam::Assets) {
    let Some((ui, loader)) =
        with_app(|app| app.ui.upgrade().map(|ui| (ui, app.loader.clone()))).flatten()
    else {
        return;
    };
    with_app(|app| app.started_at = Instant::now());

    let details = match details {
        Ok(Some(details)) => details,
        Ok(None) | Err(_) => {
            if let Err(err) = &details {
                eprintln!("shop details: {err}");
            }
            // game-details-content.tsx: t("no_shop_details")
            gd(&ui).set_description(ModelRc::new(VecModel::from(vec![DescBlock {
                kind: 1,
                text: md("Could not retrieve shop details."),
                plain: SharedString::default(),
                img: Image::default(),
            }])));
            gd(&ui).set_loaded(true);
            return;
        }
    };

    gd(&ui).set_game_title(details.name.clone().into());
    gd(&ui).set_release_date(details.release_date.clone().into());
    gd(&ui).set_publisher(
        details
            .publishers
            .first()
            .cloned()
            .unwrap_or_default()
            .into(),
    );
    gd(&ui).set_controller_support(
        match details.controller_support {
            steam::ControllerSupport::Full => "full",
            steam::ControllerSupport::Partial => "partial",
            steam::ControllerSupport::None => "none",
        }
        .into(),
    );
    gd(&ui).set_requirements_minimum(md(&details
        .pc_requirements
        .minimum
        .as_deref()
        .map(html::requirements_markdown)
        .unwrap_or_default()));
    gd(&ui).set_requirements_recommended(md(&details
        .pc_requirements
        .recommended
        .as_deref()
        .map(html::requirements_markdown)
        .unwrap_or_default()));
    gd(&ui).set_languages(ModelRc::new(VecModel::from(
        html::languages(&details.supported_languages)
            .into_iter()
            .map(|(name, audio)| Language {
                name: name.into(),
                audio,
            })
            .collect::<Vec<_>>(),
    )));

    // ---- gallery: trailers first, then screenshots (gallery-slider.tsx order)
    let mut items = Vec::new();
    let mut full_sources = Vec::new();
    let mut thumbs = Vec::new();
    let mut stream_urls = Vec::new();
    for (i, movie) in details.movies.iter().enumerate() {
        let title = if movie.name.is_empty() {
            format!("Video {}", i + 1)
        } else {
            movie.name.clone()
        };
        items.push(MediaItem {
            is_video: true,
            title: title.into(),
            thumb: Image::default(),
            full: Image::default(),
            aspect: 16.0 / 9.0,
            duration: 0.0,
        });
        full_sources.push(movie.thumbnail.clone());
        thumbs.push(movie.thumbnail.clone());
        stream_urls.push(movie.best_source().map(str::to_string));
    }
    for (i, shot) in details.screenshots.iter().enumerate() {
        items.push(MediaItem {
            is_video: false,
            title: format!("Screenshot {}", i + 1).into(),
            thumb: Image::default(),
            full: Image::default(),
            aspect: 16.0 / 9.0,
            duration: 0.0,
        });
        full_sources.push(shot.full.clone());
        thumbs.push(shot.thumbnail.clone());
        stream_urls.push(None);
    }
    with_app(|app| {
        app.media.set_vec(items);
        app.full_sources = full_sources;
        app.stream_urls = stream_urls;
        app.loaded.clear();
        app.pending.clear();
    });
    for (i, url) in thumbs.into_iter().enumerate() {
        loader.load(url, Op::MaxWidth(320), move |img| {
            with_app(|app| {
                if let Some(mut row) = app.media.row_data(i) {
                    row.thumb = img;
                    app.media.set_row_data(i, row);
                }
            });
        });
    }

    // ---- description: Steam HTML -> native blocks
    let blocks: Vec<(DescBlock, Option<String>)> = html::about_to_blocks(&details.about_the_game)
        .into_iter()
        .map(|block| {
            let empty = || DescBlock {
                kind: 4,
                text: StyledText::default(),
                plain: SharedString::default(),
                img: Image::default(),
            };
            match block {
                html::Block::Heading(text) => (
                    DescBlock {
                        kind: 0,
                        plain: text.into(),
                        ..empty()
                    },
                    None,
                ),
                html::Block::Paragraph(text) => (
                    DescBlock {
                        kind: 1,
                        text: md(&text),
                        ..empty()
                    },
                    None,
                ),
                html::Block::Bullet(text) => (
                    DescBlock {
                        kind: 2,
                        text: md(&text),
                        ..empty()
                    },
                    None,
                ),
                html::Block::Image(src) => (DescBlock { kind: 3, ..empty() }, Some(src)),
                html::Block::Spacer => (empty(), None),
            }
        })
        .collect();
    gd(&ui).set_description(ModelRc::new(VecModel::from(
        blocks.iter().map(|(b, _)| b.clone()).collect::<Vec<_>>(),
    )));
    for (i, (_, src)) in blocks.into_iter().enumerate() {
        let Some(src) = src else { continue };
        loader.load(src, Op::MaxWidth(1600), move |img| {
            if let Some(ui) = with_app(|app| app.ui.upgrade()).flatten() {
                let model = gd(&ui).get_description();
                if let Some(mut row) = model.row_data(i) {
                    row.img = img;
                    model.set_row_data(i, row);
                }
            }
        });
    }

    // ---- hero artwork (the skeleton stays until hero + logo arrive)
    let startup: Vec<(Option<String>, Op, SetImage)> = vec![
        (assets.hero.clone(), Op::Full, |ui, img| gd(&ui).set_hero(img)),
        // blur(10px) on a ~1280px-wide hero shown from a 1920px image ~= sigma 3.75 at 1/4 size
        (
            assets.hero.clone(),
            Op::Blur {
                shrink: 4,
                sigma: 3.75,
            },
            |ui, img| gd(&ui).set_hero_blur(img),
        ),
        (assets.logo.clone(), Op::Full, |ui, img| gd(&ui).set_logo(img)),
    ];
    with_app(|app| {
        app.startup_pending = startup.iter().filter(|(url, _, _)| url.is_some()).count()
    });
    for (url, op, set) in startup {
        let Some(url) = url else { continue };
        loader.load(url, op, move |img| {
            if let Some(ui) = with_app(|app| app.ui.upgrade()).flatten() {
                set(&ui, img);
            }
            startup_step();
        });
    }
    // Missing artwork must not keep the skeleton up forever.
    let weak = ui.as_weak();
    Timer::single_shot(MAX_SKELETON, move || {
        if let Some(ui) = weak.upgrade() {
            gd(&ui).set_loaded(true);
        }
    });
    if with_app(|app| app.startup_pending).unwrap_or(0) == 0 {
        gd(&ui).set_loaded(true);
    }

    update_media_window(0, -1);
}

fn startup_step() {
    let done = with_app(|app| {
        app.startup_pending = app.startup_pending.saturating_sub(1);
        (app.startup_pending == 0).then(|| (app.ui.clone(), app.started_at.elapsed()))
    })
    .flatten();
    if let Some((weak, elapsed)) = done {
        Timer::single_shot(MIN_SKELETON.saturating_sub(elapsed), move || {
            if let Some(ui) = weak.upgrade() {
                gd(&ui).set_loaded(true);
            }
        });
    }
}

fn wire_callbacks(ui: &AppWindow, loader: &Loader) {
    ui.global::<GameData>().on_media_window_changed(update_media_window);

    // ---- trailer playback (hydra_media::video)
    let playback = ui.global::<Playback>();
    playback.on_engine_load(|index| {
        let Some(ui) = with_app(|app| app.ui.upgrade()).flatten() else {
            return;
        };
        let pb = ui.global::<Playback>();
        let url = with_app(|app| app.stream_urls.get(index as usize).cloned().flatten()).flatten();
        let session = url.map(|url| {
            video::Session::open(
                index,
                url,
                quality_height(pb.get_quality()),
                pb.get_auto_height() as u32,
                pb.get_level(),
            )
        });
        with_app(|app| {
            app.video = session;
            let weak = app.ui.clone();
            app.video_timer
                .start(TimerMode::Repeated, Duration::from_millis(8), move || {
                    present_video(&weak)
                });
        });
    });
    playback.on_engine_play(|| {
        with_app(|app| app.video.as_mut().map(|v| v.play()));
    });
    playback.on_engine_pause(|| {
        with_app(|app| app.video.as_mut().map(|v| v.pause()));
    });
    playback.on_engine_seek(|t| {
        with_app(|app| app.video.as_mut().map(|v| v.seek(t as f64)));
    });
    playback.on_engine_volume(|level| {
        with_app(|app| app.video.as_ref().map(|v| v.set_volume(level)));
    });
    playback.on_engine_quality(|q| {
        let Some(ui) = with_app(|app| app.ui.upgrade()).flatten() else {
            return;
        };
        let auto = ui.global::<Playback>().get_auto_height() as u32;
        let height = if q == 0 { auto } else { quality_height(q) };
        with_app(|app| app.video.as_mut().map(|v| v.set_quality(height)));
    });

    // ---- review editor formatting (format.rs)
    let editor = ui.global::<ReviewEditor>();
    editor.on_toggle(|text, anchor, cursor, mark| {
        let Some(mark) = format::Mark::parse(&mark) else {
            return FormatEdit {
                text,
                anchor,
                cursor,
            };
        };
        let edit = format::toggle(&text, anchor, cursor, mark);
        FormatEdit {
            text: edit.text.into(),
            anchor: edit.anchor as i32,
            cursor: edit.cursor as i32,
        }
    });
    editor.on_marks_at(|text, cursor| {
        let (bold, italic, underline) = format::marks_at(&text, cursor);
        Marks {
            bold,
            italic,
            underline,
        }
    });
    editor.on_plain_length(|text| format::plain(&text).chars().count() as i32);
    editor.on_has_markup(|text| format::has_markup(&text));
    editor.on_render(|text| md(&text));

    // ---- modal backdrop: snapshot + blur stands in for backdrop-filter: blur(2px)
    ui.global::<GameData>().on_modal_opening({
        let weak = ui.as_weak();
        let loader = loader.clone();
        move || {
            let Some(ui) = weak.upgrade() else { return };
            gd(&ui).set_modal_backdrop(Image::default());
            let Ok(snapshot) = ui.window().take_snapshot() else {
                return;
            };
            let scale = ui.window().scale_factor();
            let (w, h) = (snapshot.width(), snapshot.height());
            let rgba = snapshot.as_bytes().to_vec();
            let weak = weak.clone();
            // 2 CSS px at the window's scale, measured after shrinking by 2.
            let sigma = 2.0 * scale / 2.0;
            loader.spawn(
                move || images::blur_rgba(w, h, rgba, 2, sigma),
                move |img| {
                    if let Some(ui) = weak.upgrade() {
                        gd(&ui).set_modal_backdrop(img);
                    }
                },
            );
        }
    });

    ui.global::<GameData>().on_reload(fetch_game);

    // ---- library (owned by Hydra's main process today; not ported yet)
    ui.global::<GameData>().on_add_to_library({
        let weak = ui.as_weak();
        move || {
            // TODO(library): persist like add-game-to-library.ts; in memory for now.
            if let Some(ui) = weak.upgrade() {
                gd(&ui).set_in_library(true);
            }
        }
    });
    ui.global::<GameData>().on_open_download_options(|| eprintln!("TODO(downloads): repacks modal / download sources"));
    ui.global::<GameData>().on_play(|| eprintln!("TODO(launcher): open-game.ts (launch executable, process watcher)"));
    ui.global::<GameData>().on_close_game(|| eprintln!("TODO(launcher): close-game.ts"));
    ui.global::<GameData>().on_cloud_sync(|| eprintln!("TODO(cloud-save): cloud save v2 sync"));

    // ---- reviews (Hydra API; not ported yet)
    ui.global::<GameData>().on_review_sort(|mode| eprintln!("TODO(reviews): fetch reviews sorted by {mode}"));
    ui.global::<GameData>().on_review_load_more(|| eprintln!("TODO(reviews): next page"));
    ui.global::<GameData>().on_review_vote(|id, up| eprintln!("TODO(reviews): vote {id} up={up}"));
    ui.global::<GameData>().on_review_delete(|id| eprintln!("TODO(reviews): delete {id}"));
    ui.global::<GameData>().on_review_toggle_original(|id| eprintln!("TODO(reviews): toggle original {id}"));
    ui.global::<GameData>().on_review_submit(|_, score| eprintln!("TODO(reviews): submit review (score {score})"));
}

/// Quality menu index -> rendition height (0 = Auto).
fn quality_height(q: i32) -> u32 {
    match q {
        1 => 1080,
        2 => 720,
        3 => 480,
        4 => 360,
        _ => 0,
    }
}

/// Presenter: runs on the UI thread every 8 ms while a trailer is open.
fn present_video(weak: &slint::Weak<AppWindow>) {
    let Some(ui) = weak.upgrade() else { return };
    let pb = ui.global::<Playback>();
    let Some(status) = with_app(|app| {
        app.video
            .as_mut()
            .filter(|v| v.index == pb.get_index())
            .map(|v| v.tick())
    })
    .flatten() else {
        return;
    };
    if let Some(pixels) = status.frame {
        pb.set_frame(Image::from_rgb8(pixels));
        pb.set_has_frame(true);
    }
    if status.duration > 0.0 {
        pb.set_duration(status.duration as f32);
    }
    if !pb.get_scrubbing() {
        pb.set_time(status.time as f32);
    }
    pb.set_buffered_to(status.buffered_to as f32);
    pb.set_waiting(status.waiting);
    if status.active_height > 0 {
        pb.set_active_height(status.active_height as i32);
    }
    if status.ended && pb.get_playing() {
        if pb.get_looping() {
            // The carousel loops (`loop={isInline}`); the viewer stops at the end.
            with_app(|app| app.video.as_mut().map(|v| v.seek(0.0)));
        } else {
            pb.set_ended(true);
            pb.set_playing(false);
            with_app(|app| app.video.as_mut().map(|v| v.pause()));
        }
    }
}

/// Keep full-size frames only around the carousel slide and the viewer slide.
fn update_media_window(carousel: i32, lightbox: i32) {
    let jobs = with_app(|app| {
        let count = app.full_sources.len() as i32;
        let mut wanted = HashSet::new();
        for center in [carousel, lightbox] {
            if center < 0 {
                continue;
            }
            for i in (center - 1)..=(center + 1) {
                if (0..count).contains(&i) {
                    wanted.insert(i as usize);
                }
            }
        }
        for i in app.loaded.clone() {
            if !wanted.contains(&i) {
                if let Some(mut row) = app.media.row_data(i) {
                    row.full = Image::default();
                    app.media.set_row_data(i, row);
                }
                app.loaded.remove(&i);
            }
        }
        let mut jobs = Vec::new();
        for &i in &wanted {
            if !app.loaded.contains(&i) && !app.pending.contains(&i) {
                app.pending.insert(i);
                jobs.push((i, app.full_sources[i].clone()));
            }
        }
        app.wanted = wanted;
        (app.loader.clone(), jobs)
    });
    let Some((loader, jobs)) = jobs else { return };
    for (i, url) in jobs {
        loader.load(url, Op::Full, move |img| {
            with_app(|app| {
                app.pending.remove(&i);
                if !app.wanted.contains(&i) {
                    return; // scrolled away while decoding: drop it
                }
                if let Some(mut row) = app.media.row_data(i) {
                    let size = img.size();
                    if size.height > 0 {
                        row.aspect = size.width as f32 / size.height as f32;
                    }
                    row.full = img;
                    app.media.set_row_data(i, row);
                    app.loaded.insert(i);
                }
            });
        });
    }
}

/// The library was (re)loaded: refresh the open game's hero panel.
pub fn on_library_changed() {
    let Some((ui, shop, object_id)) =
        with_app(|app| (app.ui.upgrade(), app.shop.clone(), app.object_id.clone()))
    else {
        return;
    };
    if let Some(ui) = ui
        && !shop.is_empty()
    {
        apply_library_state(&ui, &shop, &object_id);
    }
}

/// Steam `appdetails`, stored in `gameShopCache` like get-game-shop-details.ts.
fn fetch_and_cache(
    client: &reqwest::blocking::Client,
    app_id: u64,
    steam_language: &str,
    cache_key: &str,
    db: Option<&hydra_db::Db>,
) -> Result<Option<steam::AppDetails>, String> {
    let url = format!("https://store.steampowered.com/api/appdetails?appids={app_id}&l={steam_language}&cc=us");
    let body: serde_json::Value = client
        .get(&url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|e| format!("appdetails {app_id}: {e}"))?;
    if let (Some(db), Some(data)) = (db, body.get(app_id.to_string()).and_then(|e| e.get("data"))) {
        let _ = db.put_in(hydra_db::keys::GAME_SHOP_CACHE, cache_key, data);
    }
    Ok(steam::parse_app_details(&body, app_id))
}
