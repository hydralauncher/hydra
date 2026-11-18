//! The game options' Customization tab (game-assets-settings.tsx and
//! game-artwork-picker.tsx with use-game-artwork-grid.ts): the asset tabs,
//! the preview frame (pick a file, or restore the default), and SteamGridDB
//! artwork from the Hydra API, paged as the grid scrolls.
//!
//! Static images are applied as they are: Electron opens its crop modal
//! (components/image-crop-modal) first, which isn't ported. Custom games
//! (updateCustomGame) aren't either.

use std::cell::RefCell;
use std::path::PathBuf;

use hydra_core::artwork::{self, ArtworkItem, AssetChange};
use hydra_db::keys;
use hydra_media::images::{self, Op};
use serde_json::{Map, Value};
use slint::{ComponentHandle, Image, Model, ModelRc, Rgba8Pixel, SharedPixelBuffer, VecModel};
use std::rc::Rc;

use crate::{AppWindow, ArtworkTile, GameAssets, Session, shell, toast};

/// INITIAL_SKELETON_COUNT / MORE_SKELETON_COUNT
fn initial_skeletons(asset_type: &str) -> usize {
    match asset_type {
        "icon" => 28,
        "hero" => 8,
        _ => 12,
    }
}
const MORE_SKELETONS: usize = 4;

/// IMAGE_EXTENSIONS of the file picker
const IMAGE_EXTENSIONS: [&str; 7] = ["jpg", "jpeg", "jfif", "png", "apng", "gif", "webp"];

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    shop: String,
    object_id: String,
    tab: String,
    /// Bumped on open, tab change and reload: late pages are dropped.
    request: u64,
    items: Vec<ArtworkItem>,
    page: usize,
    loading: bool,
    has_more: bool,
    failed: bool,
    pending: Option<i64>,
    busy: bool,
    /// Shop defaults per asset type (icon, logo, hero, grid).
    defaults: [Option<String>; 4],
    tiles: Rc<VecModel<ArtworkTile>>,
    settled: std::collections::HashSet<i64>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn with_ui(f: impl FnOnce(&AppWindow)) {
    if let Some(ui) = with(|s| s.ui.upgrade()) {
        f(&ui);
    }
}

fn t(key: &str) -> String {
    shell::tr(key)
}

fn type_index(asset_type: &str) -> usize {
    artwork::ASSET_TYPES
        .iter()
        .position(|t| *t == asset_type)
        .unwrap_or(0)
}

/// The preview box's checkerboard: 8px squares of 10% white over #0d0d0d.
fn checker_tile() -> Image {
    let mut buffer = SharedPixelBuffer::<Rgba8Pixel>::new(16, 16);
    for (i, pixel) in buffer.make_mut_slice().iter_mut().enumerate() {
        let (x, y) = (i % 16, i / 16);
        let light = (x < 8) == (y < 8);
        let v = if light { 37 } else { 13 };
        *pixel = Rgba8Pixel {
            r: v,
            g: v,
            b: v,
            a: 255,
        };
    }
    Image::from_rgba8(buffer)
}

pub fn init(ui: &AppWindow) {
    let tiles = with(|s| {
        s.ui = ui.as_weak();
        s.tab = "icon".into();
        s.tiles.clone()
    });
    let assets = ui.global::<GameAssets>();
    assets.set_tiles(ModelRc::from(tiles));
    assets.set_checker(checker_tile());
    assets.on_tab_selected(|tab| {
        if with(|s| s.busy) {
            return;
        }
        with(|s| s.tab = tab.to_string());
        with_ui(|ui| ui.global::<GameAssets>().set_tab(tab.clone()));
        refresh_preview();
        reload();
    });
    assets.on_preview_clicked(preview_clicked);
    assets.on_tile_clicked(|index| tile_clicked(index as usize));
    assets.on_near_end(|| {
        let next = with(|s| (!s.loading && s.has_more && !s.items.is_empty()).then_some(s.page));
        if let Some(page) = next {
            load_page(page);
        }
    });
    assets.on_reload(reload);
    assets.on_subscription_clicked(|| {
        // TODO(cloud): showHydraCloudModal("customization")
        eprintln!("TODO(cloud): Hydra Cloud modal (customization)");
    });
    assets.on_open_classics_settings(|| {
        with_ui(|ui| ui.global::<crate::GameData>().set_options_open(false));
        crate::nav::navigate("/settings?tab=content_gameplay");
    });
}

fn game_record(shop: &str, object_id: &str) -> Map<String, Value> {
    shell::db()
        .and_then(|db| db.get_in(keys::GAMES, &keys::game(shop, object_id)))
        .unwrap_or_default()
}

/// The modal opened: defaults from the stored shop assets, then the API's.
pub fn opened(shop: &str, object_id: &str) {
    with(|s| {
        s.shop = shop.to_string();
        s.object_id = object_id.to_string();
        s.tab = "icon".into();
        s.busy = false;
        s.pending = None;
    });
    let custom = shop == "custom";
    let game = game_record(shop, object_id);
    let text = |m: &Map<String, Value>, k: &str| {
        m.get(k)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let stored: Map<String, Value> = shell::db()
        .and_then(|db| db.get_in(keys::GAME_SHOP_ASSETS, &keys::game(shop, object_id)))
        .unwrap_or_default();
    // setNonCustomGameAssets defaultUrls
    let pick = |fields: &[&str]| {
        fields
            .iter()
            .find_map(|f| text(&stored, f).or_else(|| text(&game, f)))
    };
    let defaults = [
        pick(&["iconUrl"]),
        pick(&["logoImageUrl"]),
        pick(&["libraryHeroImageUrl"]),
        pick(&["coverImageUrl", "libraryImageUrl", "iconUrl"]),
    ];
    with(|s| s.defaults = defaults);
    let launchbox_warning = shop == "launchbox" && !shell::preference("classicsUseHeroLayout");
    with_ui(|ui| {
        let a = ui.global::<GameAssets>();
        a.set_tab("icon".into());
        a.set_busy(false);
        a.set_show_picker(!custom);
        a.set_signed_in(shell::signed_in());
        a.set_subscription_notice(!custom && !ui.global::<Session>().get_has_subscription());
        a.set_classics_warning(false);
    });
    STATE.with(|_| ());
    CLASSICS_WARNING.with(|w| w.set(launchbox_warning));
    refresh_preview();
    reload();
    // getGameAssets(catalogue): fresher defaults from the API
    if !custom && let Some(api) = shell::api() {
        let (shop, object_id) = (shop.to_string(), object_id.to_string());
        std::thread::spawn(move || {
            let assets = api
                .get(
                    &format!("/games/{shop}/{object_id}/assets"),
                    &[],
                    hydra_core::api::Options::public(),
                )
                .ok();
            let _ = slint::invoke_from_event_loop(move || {
                let Some(assets) = assets else { return };
                let field = |k: &str| {
                    assets
                        .get(k)
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                        .map(str::to_string)
                };
                let same = with(|s| s.shop == shop && s.object_id == object_id);
                if !same {
                    return;
                }
                with(|s| {
                    let d = &mut s.defaults;
                    d[0] = field("iconUrl").or(d[0].take());
                    d[1] = field("logoImageUrl").or(d[1].take());
                    d[2] = field("libraryHeroImageUrl").or(d[2].take());
                    d[3] = field("coverImageUrl")
                        .or_else(|| field("libraryImageUrl"))
                        .or(d[3].take());
                });
                refresh_preview();
            });
        });
    }
}

thread_local! {
    static CLASSICS_WARNING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// getPreviewUrl + hasCustomAsset for the open tab.
fn refresh_preview() {
    let (shop, object_id, tab, defaults) = with(|s| {
        (
            s.shop.clone(),
            s.object_id.clone(),
            s.tab.clone(),
            s.defaults.clone(),
        )
    });
    if shop.is_empty() {
        return;
    }
    let game = game_record(&shop, &object_id);
    let (url_field, _) = artwork::manual_fields(&tab);
    let custom_url = game
        .get(url_field)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let selected = shell::db().and_then(|db| artwork::selected_id(&db, &shop, &object_id, &tab));
    let has_custom = custom_url.is_some() || selected.is_some();
    // The picked SteamGridDB artwork shows like the library composes it.
    let selection_url = shell::db().and_then(|db| {
        db.get_in::<Value>(keys::ARTWORK_SELECTION, &keys::game(&shop, &object_id))
            .and_then(|v| {
                v.get("selected")?
                    .get(&tab)?
                    .get("url")?
                    .as_str()
                    .map(str::to_string)
            })
    });
    let preview = custom_url
        .clone()
        .or(selection_url)
        .or_else(|| defaults[type_index(&tab)].clone());
    let warning = CLASSICS_WARNING.with(|w| w.get()) && (tab == "hero" || tab == "logo");
    with_ui(|ui| {
        let a = ui.global::<GameAssets>();
        a.set_has_custom(has_custom);
        a.set_has_preview(preview.is_some());
        a.set_preview(Image::default());
        a.set_classics_warning(warning);
    });
    let Some(url) = preview else { return };
    let Some((loader, _)) = shell::loader() else {
        return;
    };
    let source: images::Source = match url.strip_prefix("local:") {
        Some(path) => images::Source::Path(PathBuf::from(path)),
        None => images::Source::Url(url.clone()),
    };
    let request = with(|s| s.request);
    let tab_at_request = tab.clone();
    // The frame is at most 526px wide: decode at twice that for HiDPI.
    loader.load(source, Op::MaxWidth(1100), move |img| {
        let current = with(|s| s.tab == tab_at_request && s.request >= request);
        if current {
            with_ui(|ui| ui.global::<GameAssets>().set_preview(img));
        }
    });
}

/// reset + loadPage(0)
fn reload() {
    with(|s| {
        s.request += 1;
        s.items.clear();
        s.page = 0;
        s.has_more = true;
        s.failed = false;
        s.loading = false;
        s.settled.clear();
    });
    sync_tiles();
    if shell::signed_in() && with(|s| s.shop != "custom") {
        load_page(0);
    }
}

fn load_page(page: usize) {
    let Some(api) = shell::api() else { return };
    let (shop, object_id, tab, request) = with(|s| {
        s.loading = true;
        (
            s.shop.clone(),
            s.object_id.clone(),
            s.tab.clone(),
            s.request,
        )
    });
    sync_tiles();
    std::thread::spawn(move || {
        let result = artwork::fetch_page(&api, &shop, &object_id, &tab, page);
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.request) != request {
                return;
            }
            match result {
                Ok(page_data) => {
                    with(|s| {
                        for item in page_data.items {
                            if !s.items.iter().any(|i| i.id == item.id) {
                                s.items.push(item);
                            }
                        }
                        s.has_more = page_data.has_more;
                        s.failed = false;
                        s.page = page + 1;
                    });
                }
                Err(error) => {
                    eprintln!("Failed to fetch game artwork: {error}");
                    with(|s| {
                        s.failed = true;
                        s.has_more = false;
                    });
                    toast::error(&t("sidebar.steamgriddb_fetch_failed"));
                }
            }
            with(|s| s.loading = false);
            sync_tiles();
            load_tile_images(request);
        });
    });
}

/// The tiles: items, then skeletons while a page loads.
fn sync_tiles() {
    let (rows, empty, reload) = with(|s| {
        let selected =
            shell::db().and_then(|db| artwork::selected_id(&db, &s.shop, &s.object_id, &s.tab));
        let mut rows: Vec<ArtworkTile> = s
            .items
            .iter()
            .enumerate()
            .map(|(i, item)| {
                let previous = s.tiles.row_data(i).filter(|r| !r.skeleton);
                ArtworkTile {
                    image: previous
                        .as_ref()
                        .map(|r| r.image.clone())
                        .unwrap_or_default(),
                    skeleton: false,
                    active: selected == Some(item.id),
                    pending: s.pending == Some(item.id),
                    settled: s.settled.contains(&item.id),
                    failed: previous.is_some_and(|r| r.failed),
                }
            })
            .collect();
        if s.loading {
            let count = if s.items.is_empty() {
                initial_skeletons(&s.tab)
            } else {
                MORE_SKELETONS
            };
            rows.extend((0..count).map(|_| ArtworkTile {
                skeleton: true,
                ..Default::default()
            }));
        }
        (rows, !s.loading && s.items.is_empty(), s.failed)
    });
    let tiles = with(|s| s.tiles.clone());
    // In place when the item rows are the same (keeps their fade-in).
    if tiles.row_count() == rows.len() {
        for (i, row) in rows.into_iter().enumerate() {
            tiles.set_row_data(i, row);
        }
    } else {
        tiles.set_vec(rows);
    }
    with_ui(|ui| {
        let a = ui.global::<GameAssets>();
        a.set_empty(empty);
        a.set_show_reload(reload);
    });
}

/// Thumbnails for the items that don't have one yet, on threads of their
/// own: the shared image pool may be busy with the page's description images,
/// and the grid should fill in parallel like `<img>`s do.
fn load_tile_images(request: u64) {
    let Some((_, scale)) = shell::loader() else {
        return;
    };
    let jobs: Vec<(usize, i64, String)> = with(|s| {
        s.items
            .iter()
            .enumerate()
            .filter(|(_, item)| !s.settled.contains(&item.id))
            .map(|(i, item)| (i, item.id, item.display_source().to_string()))
            .collect()
    });
    let width = (260.0 * scale).ceil() as u32;
    let mut queue = Vec::new();
    for (index, id, url) in jobs {
        // Video thumbnails (animated artwork): no frame decoder for grids yet.
        if artwork::is_video(&url) {
            with(|s| s.settled.insert(id));
            if let Some(mut row) = with(|s| s.tiles.row_data(index)) {
                row.settled = true;
                row.failed = true;
                with(|s| s.tiles.set_row_data(index, row));
            }
            continue;
        }
        queue.push((index, id, url));
    }
    queue.reverse();
    let queue = std::sync::Arc::new(std::sync::Mutex::new(queue));
    // SteamGridDB's CDN answers slowly (several seconds per image), so the
    // grid fetches many at once over one HTTP/2 connection, like Chromium.
    let Ok(http) = reqwest::blocking::Client::builder()
        .user_agent(concat!("Hydra/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(60))
        .build()
    else {
        return;
    };
    for _ in 0..12 {
        let (queue, http) = (queue.clone(), http.clone());
        std::thread::spawn(move || {
            loop {
                let Some((index, id, url)) = queue.lock().ok().and_then(|mut q| q.pop()) else {
                    break;
                };
                let pixels = images::fetch(&http, &images::Source::Url(url.clone()))
                    .and_then(|bytes| images::decode_bytes(&bytes, Op::MaxWidth(width)));
                let _ = slint::invoke_from_event_loop(move || {
                    if with(|s| s.request) != request {
                        return;
                    }
                    with(|s| s.settled.insert(id));
                    let tiles = with(|s| s.tiles.clone());
                    if let Some(mut row) = tiles.row_data(index) {
                        match pixels {
                            Some(pixels) => row.image = pixels.into_image(),
                            None => row.failed = true,
                        }
                        row.settled = true;
                        tiles.set_row_data(index, row);
                    }
                });
            }
        });
    }
}

fn set_busy(busy: bool) {
    with(|s| s.busy = busy);
    with_ui(|ui| ui.global::<GameAssets>().set_busy(busy));
}

fn subscriber() -> bool {
    let mut active = false;
    with_ui(|ui| active = ui.global::<Session>().get_has_subscription());
    active && shell::signed_in()
}

/// The frame: restore the default when a custom asset is set, else pick a file.
fn preview_clicked() {
    if with(|s| s.busy) {
        return;
    }
    let has_custom = {
        let mut v = false;
        with_ui(|ui| v = ui.global::<GameAssets>().get_has_custom());
        v
    };
    if has_custom {
        restore_default();
    } else {
        select_file();
    }
}

/// handleRestoreDefault: the manual asset and the SteamGridDB pick go away.
fn restore_default() {
    let (shop, object_id, tab) = with(|s| (s.shop.clone(), s.object_id.clone(), s.tab.clone()));
    let Some(db) = shell::db() else { return };
    set_busy(true);
    artwork::update_custom_asset(
        &db,
        &shop,
        &object_id,
        &AssetChange {
            asset_type: &tab,
            url: None,
            original: None,
            artwork_id: None,
        },
    );
    artwork::set_selection(&db, &shop, &object_id, &tab, None);
    if subscriber()
        && let Some(api) = shell::api()
    {
        let (shop, object_id, tab) = (shop.clone(), object_id.clone(), tab.clone());
        std::thread::spawn(move || artwork::delete_cloud(&api, &shop, &object_id, &tab));
    }
    finish(&t("sidebar.steamgriddb_artwork_reset"));
}

/// handleSelectAsset: a local image, copied into the assets folder.
fn select_file() {
    let Some(picked) = rfd::FileDialog::new()
        .add_filter(t("sidebar.edit_game_modal_image_filter"), &IMAGE_EXTENSIONS)
        .pick_file()
    else {
        return;
    };
    let display = picked.to_string_lossy().to_string();
    apply_file(picked, display, None);
}

/// applyUncroppedAsset: copy, store, sync.
fn apply_file(source: PathBuf, original: String, artwork_id: Option<i64>) {
    let (shop, object_id, tab) = with(|s| (s.shop.clone(), s.object_id.clone(), s.tab.clone()));
    let Some(assets_dir) = hydra_db::paths::native_user_data().map(|d| d.join("Assets")) else {
        return;
    };
    let Some(db) = shell::db() else { return };
    set_busy(true);
    let copied = match artwork::copy_custom_asset(&assets_dir, &source, &tab) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("Failed to copy {tab}: {error}");
            toast::error(&t("user_profile.image_process_failure"));
            set_busy(false);
            return;
        }
    };
    let url = format!("local:{}", copied.display());
    artwork::update_custom_asset(
        &db,
        &shop,
        &object_id,
        &AssetChange {
            asset_type: &tab,
            url: Some(url.clone()),
            original: Some(original),
            artwork_id,
        },
    );
    if subscriber()
        && let Some(api) = shell::api()
    {
        std::thread::spawn(move || {
            let http = hydra_store::http_client();
            if let Err(error) = artwork::upload_cloud(&api, &http, &shop, &object_id, &tab, &url) {
                eprintln!("Failed to sync custom artwork upload: {error}");
            }
        });
    }
    finish(&t("sidebar.steamgriddb_artwork_updated"));
}

/// After a change: the preview, the grid's active tile, the library and the page.
fn finish(message: &str) {
    set_busy(false);
    with(|s| s.pending = None);
    refresh_preview();
    sync_tiles();
    toast::success(message);
    shell::load_library();
    crate::game_page::refresh_artwork();
}

/// handlePick: animated artwork is selected as is; static artwork is
/// downloaded and applied (Electron crops it first).
fn tile_clicked(index: usize) {
    let Some(item) = with(|s| s.items.get(index).cloned()) else {
        return;
    };
    if with(|s| s.busy) {
        return;
    }
    let (shop, object_id, tab) = with(|s| (s.shop.clone(), s.object_id.clone(), s.tab.clone()));
    let url = item.renderable_url(&tab).to_string();
    with(|s| s.pending = Some(item.id));
    set_busy(true);
    sync_tiles();
    if item.is_animated() {
        let Some(db) = shell::db() else { return };
        artwork::set_selection(&db, &shop, &object_id, &tab, Some((&url, item.id)));
        if subscriber()
            && let Some(api) = shell::api()
        {
            let (shop, object_id, tab, url) =
                (shop.clone(), object_id.clone(), tab.clone(), url.clone());
            std::thread::spawn(move || {
                artwork::sync_steamgriddb(&api, &shop, &object_id, &tab, &url);
            });
        }
        finish(&t("sidebar.steamgriddb_artwork_updated"));
        return;
    }
    // downloadGameArtwork: into a temp file, then like a picked file.
    let id = item.id;
    std::thread::spawn(move || {
        let http = hydra_store::http_client();
        let downloaded = http
            .get(&url)
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.bytes())
            .ok()
            .and_then(|bytes| {
                let ext = url
                    .split('?')
                    .next()
                    .and_then(|u| u.rsplit('.').next())
                    .filter(|e| e.len() <= 5)
                    .unwrap_or("png")
                    .to_string();
                let path = std::env::temp_dir().join(format!("hydra-artwork-{id}.{ext}"));
                std::fs::write(&path, &bytes).ok().map(|_| path)
            });
        let _ = slint::invoke_from_event_loop(move || match downloaded {
            Some(path) => {
                apply_file(path.clone(), url, Some(id));
                let _ = std::fs::remove_file(path);
            }
            None => {
                set_busy(false);
                with(|s| s.pending = None);
                sync_tiles();
                toast::error(&t("user_profile.image_process_failure"));
            }
        });
    });
}
