//! The library's sync with the account (src/main/services/library-sync):
//! - upload-games-batch.ts (`uploadGamesBatch`: games without a remote id
//!   go up in chunks of 30, then the remote library merges in)
//! - fetch-remote-profile-games.ts (the paged `/profile/games` reads)
//! - merge-with-remote-games.ts (`mergeWithRemoteGames`), with
//!   resolve-library-source.ts, reconcile-remote-artwork-selection.ts,
//!   shared/library-catalogue.ts `mergeLibraryCatalogueMetadata` and
//!   shared/artwork-resolver.ts `preserveEpicDefaultArtwork`
//! - merge-imported-profile-game.ts (one game read back after a targeted write)
//! - clear-games-remote-id.ts + game-visibility.ts (a new account signed in)
//!
//! Games stay JSON objects. The merge keeps JavaScript's object-spread rules:
//! `a ?? b` falls through `null` and missing values, and a key set to
//! `undefined` disappears when Electron stores the record as JSON, so
//! [`assign`] removes the key for `None`.
//!
//! `HYDRA_LIBRARY_SYNC_DRY_RUN=1` logs the upload bodies instead of sending
//! them (merges only read from the API, so they run as usual).

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use hydra_db::{Batch, Db, keys};
use serde_json::{Map, Value, json};

use crate::api::{ApiError, HydraApi, Options};
use crate::library::AuthContext;
use crate::library_actions;

type Obj = Map<String, Value>;

const PAGE_SIZE: usize = 100;
const PAGE_FETCH_CONCURRENCY: usize = 3;
const MERGE_WRITE_CHUNK_SIZE: usize = 250;
const TARGETED_MERGE_CONCURRENCY: usize = 10;
const UPLOAD_CHUNK_SIZE: usize = 30;
/// HYDRA_GAME_REQUEST_TIMEOUT_MS
pub const GAME_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// HYDRA_LIBRARY_SYNC_DRY_RUN: print the write requests instead of sending them.
pub fn dry_run() -> bool {
    std::env::var_os("HYDRA_LIBRARY_SYNC_DRY_RUN").is_some_and(|v| !v.is_empty() && v != "0")
}

// ---- JavaScript value rules -------------------------------------------------

/// JS truthiness.
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `obj.key ?? undefined`: the value unless it is null or missing.
fn nn<'a>(obj: &'a Obj, key: &str) -> Option<&'a Value> {
    obj.get(key).filter(|v| !v.is_null())
}

/// `{ ...target, [key]: value }`, where `undefined` (None) drops the key.
fn assign(target: &mut Obj, key: &str, value: Option<Value>) {
    match value {
        Some(value) => {
            target.insert(key.to_string(), value);
        }
        None => {
            target.remove(key);
        }
    }
}

/// `primary[key] ?? fallback` (the fallback as stored: null stays null,
/// a missing key stays missing).
fn coalesce(primary: &Obj, key: &str, fallback: Option<&Value>) -> Option<Value> {
    nn(primary, key).or(fallback).cloned()
}

fn is_true(obj: &Obj, key: &str) -> bool {
    obj.get(key) == Some(&Value::Bool(true))
}

fn str_of<'a>(obj: &'a Obj, key: &str) -> Option<&'a str> {
    obj.get(key).and_then(Value::as_str)
}

/// A JS number as JSON writes it: integers without a fraction.
fn num(value: f64) -> Value {
    if value.is_finite() && value.fract() == 0.0 && value.abs() < 9.0e15 {
        Value::from(value as i64)
    } else {
        serde_json::Number::from_f64(value)
            .map(Value::Number)
            .unwrap_or(Value::Null)
    }
}

/// `new Date(text).getTime()`, for the ISO strings the API and
/// `JSON.stringify(date)` write.
pub fn date_ms(value: &Value) -> Option<i64> {
    let text = value.as_str()?;
    if let Ok(date) = chrono::DateTime::parse_from_rfc3339(text) {
        return Some(date.timestamp_millis());
    }
    // A date without an offset (JS reads date-only strings as UTC).
    if let Ok(date) = chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d") {
        return date
            .and_hms_opt(0, 0, 0)
            .map(|d| d.and_utc().timestamp_millis());
    }
    crate::library::parse_iso_millis(text)
}

/// `new Date(text)` as JSON stores it: the ISO string, or null when invalid.
fn js_date(value: &Value) -> Value {
    match date_ms(value).and_then(chrono::DateTime::from_timestamp_millis) {
        Some(date) => Value::String(date.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        None => Value::Null,
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

// ---- resolve-library-source.ts ----------------------------------------------

/// `resolveLibrarySource`
pub fn resolve_library_source(local: Option<&Value>, remote: Option<&Value>) -> &'static str {
    let local = local.and_then(Value::as_str);
    let remote = remote.and_then(Value::as_str);
    if local == Some("hydra") || remote == Some("hydra") {
        return "hydra";
    }
    if local == Some("steam") || remote == Some("steam") {
        return "steam";
    }
    for source in [local, remote].into_iter().flatten() {
        if let Some(found) = ["hydra", "steam", "epic"]
            .into_iter()
            .find(|s| *s == source)
        {
            return found;
        }
    }
    "hydra"
}

/// `resolveLibraryIsDeleted`: imported rows are never deleted locally.
pub fn resolve_library_is_deleted(
    local_is_deleted: Option<&Value>,
    remote_source: Option<&Value>,
    has_active_steam_import: bool,
    has_active_epic_import: bool,
) -> Option<Value> {
    let source = remote_source.and_then(Value::as_str);
    if matches!(source, Some("steam" | "epic")) || has_active_steam_import || has_active_epic_import
    {
        Some(Value::Bool(false))
    } else {
        local_is_deleted.cloned()
    }
}

/// `resolveMissingSteamImport`: a game the remote Steam import dropped.
pub fn resolve_missing_steam_import(game: &Obj, exists_remotely: bool) -> bool {
    str_of(game, "shop") == Some("steam")
        && is_true(game, "hasActiveSteamImport")
        && !exists_remotely
}

// ---- shared helpers -----------------------------------------------------------

/// `mergeLibraryCatalogueMetadata(local, remote)` spread over `target`.
fn merge_catalogue_metadata(target: &mut Obj, local: Option<&Obj>, remote: &Obj) {
    for key in ["canonicalId", "catalogueGame", "availableShops"] {
        let fallback = local.and_then(|l| l.get(key));
        // `remote.x ?? local?.x`: with no local game a null becomes undefined.
        let value = match local {
            Some(_) => coalesce(remote, key, fallback),
            None => nn(remote, key).cloned(),
        };
        assign(target, key, value);
    }
}

/// `mergeLocalAndRemotePlayTime` spread over `target`.
fn merge_play_time(target: &mut Obj, local: &Obj, remote: &Obj) {
    let (hydra, steam, epic) =
        library_actions::merge_play_time(local, &Value::Object(remote.clone()));
    target.insert("playTimeInMilliseconds".into(), num(hydra));
    target.insert("steamPlayTimeInMilliseconds".into(), num(steam));
    target.insert("epicPlayTimeInMilliseconds".into(), num(epic));
}

/// `mergePersistedAchievementTotals` (the in-memory achievement store isn't
/// ported, so its catalogue adds nothing to the persisted totals).
fn merge_achievement_totals(target: &mut Obj, shop: Option<&str>, local: &Obj, remote: &Obj) {
    for key in ["achievementCount", "unlockedAchievementCount"] {
        let value = if shop == Some("epic") {
            nn(remote, key)
                .or_else(|| nn(local, key))
                .cloned()
                .unwrap_or_else(|| Value::from(0))
        } else {
            let read = |o: &Obj| nn(o, key).and_then(Value::as_f64).unwrap_or(0.0);
            num(read(local).max(read(remote)))
        };
        target.insert(key.into(), value);
    }
}

/// `getCollectionIds`
fn collection_ids_of(source: Option<&Obj>) -> Value {
    let Some(source) = source else {
        return json!([]);
    };
    if let Some(ids @ Value::Array(_)) = source.get("collectionIds") {
        return ids.clone();
    }
    match source.get("collectionId") {
        Some(id) if truthy(Some(id)) => json!([id]),
        _ => json!([]),
    }
}

/// `getLatestLastTimePlayed`
fn latest_last_time_played(local: &Obj, remote: &Obj) -> Option<Value> {
    let local_value = local.get("lastTimePlayed");
    if local_value.is_none_or(Value::is_null) {
        return remote.get("lastTimePlayed").cloned();
    }
    if let Some(remote_value) = remote.get("lastTimePlayed").filter(|v| truthy(Some(v)))
        && let (Some(r), Some(l)) = (date_ms(remote_value), local_value.and_then(date_ms))
        && r > l
    {
        return Some(remote_value.clone());
    }
    local_value.cloned()
}

/// `reconcileCustomAsset`: a `local:` file wins; a missing remote field
/// keeps the local value.
fn reconcile_custom_asset(local: Option<&Value>, remote: Option<&Value>) -> Option<Value> {
    let Some(remote) = remote else {
        return local.cloned();
    };
    if local
        .and_then(Value::as_str)
        .is_some_and(|l| l.starts_with("local:"))
    {
        return local.cloned();
    }
    Some(remote.clone())
}

/// (local field, remote field) for the custom artwork.
const CUSTOM_ASSETS: [(&str, &str); 4] = [
    ("customIconUrl", "customIconUrl"),
    ("customLogoImageUrl", "customLogoImageUrl"),
    ("customHeroImageUrl", "customLibraryHeroImageUrl"),
    ("customCoverImageUrl", "customLibraryImageUrl"),
];

// ---- merge-with-remote-games.ts ---------------------------------------------

/// `mergeExistingGame`
fn merge_existing_game(
    local: &Obj,
    remote: &Obj,
    collection_ids: Value,
    remote_added: Value,
    can_reconcile_custom_artwork: bool,
) -> Obj {
    let mut game = local.clone();
    merge_catalogue_metadata(&mut game, Some(local), remote);
    if truthy(remote.get("catalogueGame")) {
        for key in ["title", "iconUrl", "libraryHeroImageUrl", "logoImageUrl"] {
            assign(&mut game, key, remote.get(key).cloned());
        }
    }
    let keep_null = str_of(local, "source") == Some("hydra")
        && local.get("remoteId") == Some(&Value::Null)
        && str_of(remote, "source") == Some("epic");
    assign(
        &mut game,
        "remoteId",
        if keep_null {
            Some(Value::Null)
        } else {
            remote.get("id").cloned()
        },
    );
    assign(
        &mut game,
        "addedToLibraryAt",
        Some(
            nn(local, "addedToLibraryAt")
                .cloned()
                .unwrap_or(remote_added),
        ),
    );
    assign(
        &mut game,
        "lastTimePlayed",
        latest_last_time_played(local, remote),
    );
    merge_play_time(&mut game, local, remote);
    assign(
        &mut game,
        "favorite",
        coalesce(remote, "isFavorite", local.get("favorite")),
    );
    assign(
        &mut game,
        "isHiddenFromOthers",
        coalesce(
            remote,
            "isHiddenFromOthers",
            local.get("isHiddenFromOthers"),
        ),
    );
    assign(
        &mut game,
        "isConcealed",
        Some(
            nn(remote, "isConcealed")
                .or_else(|| nn(local, "isConcealed"))
                .cloned()
                .unwrap_or(Value::Bool(false)),
        ),
    );
    assign(
        &mut game,
        "isPinned",
        coalesce(remote, "isPinned", local.get("isPinned")),
    );
    game.insert("collectionIds".into(), collection_ids);
    merge_achievement_totals(&mut game, str_of(remote, "shop"), local, remote);
    assign(
        &mut game,
        "platform",
        coalesce(remote, "platform", local.get("platform")),
    );
    game.insert(
        "source".into(),
        json!(resolve_library_source(
            local.get("source"),
            remote.get("source")
        )),
    );
    let steam_import = is_true(remote, "hasActiveSteamImport");
    let epic_import_flag = is_true(remote, "hasActiveEpicImport");
    game.insert("hasActiveSteamImport".into(), Value::Bool(steam_import));
    game.insert(
        "hasActiveEpicImport".into(),
        nn(remote, "hasActiveEpicImport")
            .or_else(|| nn(local, "hasActiveEpicImport"))
            .cloned()
            .unwrap_or(Value::Bool(false)),
    );
    assign(
        &mut game,
        "isDeleted",
        resolve_library_is_deleted(
            local.get("isDeleted"),
            remote.get("source"),
            steam_import,
            epic_import_flag,
        ),
    );
    if can_reconcile_custom_artwork {
        for (local_key, remote_key) in CUSTOM_ASSETS {
            assign(
                &mut game,
                local_key,
                reconcile_custom_asset(local.get(local_key), remote.get(remote_key)),
            );
        }
    }
    game
}

/// `createLocalGame`
fn create_local_game(remote: &Obj, collection_ids: Value, added: Value) -> Obj {
    let mut game = Obj::new();
    merge_catalogue_metadata(&mut game, None, remote);
    assign(&mut game, "objectId", remote.get("objectId").cloned());
    assign(&mut game, "title", remote.get("title").cloned());
    assign(&mut game, "remoteId", remote.get("id").cloned());
    assign(&mut game, "shop", remote.get("shop").cloned());
    assign(&mut game, "iconUrl", remote.get("iconUrl").cloned());
    assign(
        &mut game,
        "libraryHeroImageUrl",
        remote.get("libraryHeroImageUrl").cloned(),
    );
    assign(
        &mut game,
        "logoImageUrl",
        remote.get("logoImageUrl").cloned(),
    );
    game.insert("addedToLibraryAt".into(), added);
    assign(
        &mut game,
        "lastTimePlayed",
        remote.get("lastTimePlayed").cloned(),
    );
    let mut zero = Obj::new();
    zero.insert("playTimeInMilliseconds".into(), json!(0));
    merge_play_time(&mut game, &zero, remote);
    assign(
        &mut game,
        "hasManuallyUpdatedPlaytime",
        remote.get("hasManuallyUpdatedPlaytime").cloned(),
    );
    game.insert("isDeleted".into(), Value::Bool(false));
    for (local_key, remote_key) in [
        ("favorite", "isFavorite"),
        ("isHiddenFromOthers", "isHiddenFromOthers"),
        ("isConcealed", "isConcealed"),
        ("isPinned", "isPinned"),
    ] {
        game.insert(
            local_key.into(),
            nn(remote, remote_key)
                .cloned()
                .unwrap_or(Value::Bool(false)),
        );
    }
    game.insert("collectionIds".into(), collection_ids);
    merge_achievement_totals(&mut game, str_of(remote, "shop"), &Obj::new(), remote);
    game.insert(
        "platform".into(),
        nn(remote, "platform").cloned().unwrap_or(Value::Null),
    );
    game.insert(
        "source".into(),
        json!(resolve_library_source(None, remote.get("source"))),
    );
    game.insert(
        "hasActiveSteamImport".into(),
        Value::Bool(is_true(remote, "hasActiveSteamImport")),
    );
    game.insert(
        "hasActiveEpicImport".into(),
        Value::Bool(is_true(remote, "hasActiveEpicImport")),
    );
    for (local_key, remote_key) in CUSTOM_ASSETS {
        game.insert(
            local_key.into(),
            nn(remote, remote_key).cloned().unwrap_or(Value::Null),
        );
    }
    game
}

/// `buildMergedGame`
pub fn build_merged_game(remote: &Obj, local: Option<&Obj>, can_reconcile: bool) -> Obj {
    let has_remote_collection_field = remote.get("collectionIds").is_some_and(Value::is_array)
        || remote.contains_key("collectionId");
    let collection_ids = if has_remote_collection_field {
        collection_ids_of(Some(remote))
    } else {
        collection_ids_of(local)
    };
    let remote_added = match remote.get("createdAt") {
        Some(created) if truthy(Some(created)) => js_date(created),
        _ => Value::Null,
    };
    match local {
        Some(local) => {
            merge_existing_game(local, remote, collection_ids, remote_added, can_reconcile)
        }
        None => create_local_game(remote, collection_ids, remote_added),
    }
}

/// `getRemoteCoverImageUrl`
fn remote_cover_image_url(remote: &Obj) -> Value {
    if let Some(url) = remote.get("coverImageUrl").filter(|v| truthy(Some(v))) {
        return url.clone();
    }
    let identity = nn(remote, "catalogueGame")
        .and_then(Value::as_object)
        .unwrap_or(remote);
    if str_of(identity, "shop") != Some("steam") {
        return Value::Null;
    }
    let object_id = match identity.get("objectId") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => "undefined".into(),
    };
    Value::String(format!(
        "https://shared.steamstatic.com/store_item_assets/steam/apps/{object_id}/library_600x900_2x.jpg"
    ))
}

/// `preserveEpicDefaultArtwork`
fn preserve_epic_default_artwork(mut assets: Obj, cached: Option<&Obj>) -> Obj {
    if str_of(&assets, "shop") != Some("epic") {
        return assets;
    }
    let timestamps = cached
        .and_then(|c| c.get("epicArtworkUpdatedAtByType"))
        .cloned();
    let stamp = |kind: &str| truthy(timestamps.as_ref().and_then(|t| t.get(kind)));
    let cached_field = |key: &str| cached.and_then(|c| nn(c, key)).cloned();
    let icon = if stamp("icon") {
        cached_field("iconUrl").unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    assets.insert("iconUrl".into(), icon);
    if stamp("portrait") {
        for key in ["coverImageUrl", "libraryImageUrl"] {
            let value = cached_field(key).or_else(|| assets.get(key).cloned());
            assign(&mut assets, key, value);
        }
    }
    if stamp("landscape") {
        let value = cached_field("libraryHeroImageUrl")
            .or_else(|| assets.get("libraryHeroImageUrl").cloned());
        assign(&mut assets, "libraryHeroImageUrl", value);
    }
    assign(&mut assets, "epicArtworkUpdatedAtByType", timestamps);
    assets
}

/// `buildRemoteGameShopAssets`
pub fn build_remote_shop_assets(
    remote: &Obj,
    local_game: Option<&Obj>,
    local_assets: Option<&Obj>,
    now: i64,
) -> Obj {
    let mut assets = Obj::new();
    assets.insert("updatedAt".into(), Value::from(now));
    if let Some(local) = local_assets {
        for (key, value) in local {
            assets.insert(key.clone(), value.clone());
        }
    }
    assign(&mut assets, "shop", remote.get("shop").cloned());
    assign(&mut assets, "objectId", remote.get("objectId").cloned());
    let title = if truthy(remote.get("catalogueGame")) {
        remote.get("title").cloned()
    } else {
        local_game
            .and_then(|g| g.get("title"))
            .filter(|t| truthy(Some(t)))
            .or_else(|| remote.get("title"))
            .cloned()
    };
    assign(&mut assets, "title", title);
    assets.insert("coverImageUrl".into(), remote_cover_image_url(remote));
    for key in [
        "libraryHeroImageUrl",
        "libraryImageUrl",
        "logoImageUrl",
        "iconUrl",
        "logoPosition",
        "downloadSources",
    ] {
        assign(&mut assets, key, remote.get(key).cloned());
    }
    let mut images = Obj::new();
    for source in [
        local_assets.and_then(|a| a.get("images")),
        remote.get("images"),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(map) = source.as_object() {
            for (key, value) in map {
                images.insert(key.clone(), value.clone());
            }
        }
    }
    assets.insert("images".into(), Value::Object(images));
    let catalogue_shop = nn(remote, "catalogueGame")
        .or_else(|| local_game.and_then(|g| nn(g, "catalogueGame")))
        .and_then(|c| c.get("shop"))
        .and_then(Value::as_str);
    if catalogue_shop == Some("steam") {
        assets
    } else {
        preserve_epic_default_artwork(assets, local_assets)
    }
}

/// The shop-assets record the catalogue game gets from a remote row.
fn catalogue_assets(catalogue: &Obj, assets: &Obj) -> Obj {
    let mut entry = catalogue.clone();
    for key in [
        "updatedAt",
        "title",
        "iconUrl",
        "libraryHeroImageUrl",
        "libraryImageUrl",
        "coverImageUrl",
        "logoImageUrl",
        "logoPosition",
        "downloadSources",
        "images",
    ] {
        assign(&mut entry, key, assets.get(key).cloned());
    }
    entry
}

/// `CUSTOM_ASSET_FIELD_BY_TYPE`
const SELECTION_TYPES: [(&str, &str); 4] = [
    ("icon", "customIconUrl"),
    ("logo", "customLogoImageUrl"),
    ("hero", "customHeroImageUrl"),
    ("grid", "customCoverImageUrl"),
];

/// `reconcileRemoteArtworkSelection`: drop synced selections the account
/// replaced. `remote_assets` uses the local field names.
pub fn reconcile_remote_artwork_selection(
    current: &Obj,
    local_assets: &Obj,
    remote_assets: &Obj,
) -> (Obj, bool) {
    let mut selected = current.clone();
    let mut changed = false;
    for (kind, field) in SELECTION_TYPES {
        let Some(remote_value) = remote_assets.get(field) else {
            continue;
        };
        if str_of(local_assets, field).is_some_and(|l| l.starts_with("local:")) {
            continue;
        }
        let Some(selection) = selected.get(kind).filter(|s| truthy(Some(s))) else {
            continue;
        };
        if selection.get("url") == Some(remote_value) {
            continue;
        }
        if !truthy(selection.get("syncedAt")) {
            continue;
        }
        selected.remove(kind);
        changed = true;
    }
    (selected, changed)
}

/// `getRemoteCustomAssets`, under the local field names.
fn remote_custom_assets(remote: &Obj) -> Obj {
    let mut out = Obj::new();
    for (local_key, remote_key) in CUSTOM_ASSETS {
        if let Some(value) = remote.get(remote_key) {
            out.insert(local_key.into(), value.clone());
        }
    }
    out
}

/// `hasCompletedEpicRemoval`
fn has_completed_epic_removal(game: &Obj) -> bool {
    is_true(game, "isDeleted")
        && game.get("hasActiveEpicImport") == Some(&Value::Bool(false))
        && !game.contains_key("epicImportScope")
        && game
            .get("epicPlayTimeInMilliseconds")
            .and_then(Value::as_f64)
            == Some(0.0)
}

/// `needsEpicOwnerProbe`
fn needs_epic_owner_probe(key: &str, game: &Obj, remote_keys: &HashSet<String>) -> bool {
    str_of(game, "shop") == Some("epic")
        && truthy(game.get("remoteId"))
        && !remote_keys.contains(key)
        && !library_actions::has_pending_hydra_claim(key)
        && game
            .get("unsyncedDeltaPlayTimeInMilliseconds")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            <= 0.0
        && !has_completed_epic_removal(game)
}

fn game_key_of(game: &Obj) -> String {
    let part = |key: &str| match game.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Null) => "null".into(),
        _ => "undefined".into(),
    };
    keys::game(&part("shop"), &part("objectId"))
}

// ---- fetch-remote-profile-games.ts --------------------------------------------

/// `fetchAllGamesForShop`: the first page, then three pages at a time until
/// one comes back short.
fn fetch_all_pages(
    api: &HydraApi,
    path: &str,
    params: &[(&'static str, String)],
) -> Result<Vec<Value>, ApiError> {
    let fetch_page = |page: usize| -> Result<Vec<Value>, ApiError> {
        let mut query: Vec<(&str, String)> = params.to_vec();
        query.push(("take", PAGE_SIZE.to_string()));
        query.push(("skip", (page * PAGE_SIZE).to_string()));
        match api.get(path, &query, Options::default())? {
            Value::Array(games) => Ok(games),
            other => Err(ApiError::Network(format!(
                "Expected an array from {path}, received {}",
                match other {
                    Value::Null => "null",
                    Value::Object(_) => "an object",
                    _ => "a value",
                }
            ))),
        }
    };
    let first = fetch_page(0)?;
    if first.len() < PAGE_SIZE {
        return Ok(first);
    }
    let mut all = first;
    let mut next = 1;
    loop {
        let pages: Vec<Result<Vec<Value>, ApiError>> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..PAGE_FETCH_CONCURRENCY)
                .map(|offset| scope.spawn(move || fetch_page(next + offset)))
                .collect();
            handles
                .into_iter()
                .map(|h| {
                    h.join()
                        .unwrap_or_else(|_| Err(ApiError::Network("page fetch panicked".into())))
                })
                .collect()
        });
        let mut short = false;
        for page in pages {
            let page = page?;
            short |= page.len() < PAGE_SIZE;
            all.extend(page);
        }
        if short {
            break;
        }
        next += PAGE_FETCH_CONCURRENCY;
    }
    Ok(all)
}

/// `fetchRemoteProfileGames`: the account library, classics, and both hidden
/// lists (older APIs answer 404 for the hidden ones).
pub fn fetch_remote_profile_games(api: &HydraApi) -> Result<Vec<Value>, ApiError> {
    let launchbox = || vec![("shop", "launchbox".to_string())];
    let hidden = |params: Vec<(&'static str, String)>| {
        fetch_all_pages(api, "/profile/games/hidden", &params).or_else(|error| match error {
            ApiError::Status { status: 404, .. } => Ok(Vec::new()),
            other => Err(other),
        })
    };
    let (default, classics, hidden_games, hidden_classics) = std::thread::scope(|scope| {
        let default = scope.spawn(|| fetch_all_pages(api, "/profile/games", &[]));
        let classics = scope
            .spawn(|| fetch_all_pages(api, "/profile/games", &launchbox()).unwrap_or_default());
        let hidden_games = scope.spawn(|| hidden(Vec::new()));
        let hidden_classics = scope.spawn(|| hidden(launchbox()));
        let join = |h: std::thread::ScopedJoinHandle<'_, Result<Vec<Value>, ApiError>>| {
            h.join()
                .unwrap_or_else(|_| Err(ApiError::Network("fetch panicked".into())))
        };
        (
            join(default),
            classics.join().unwrap_or_default(),
            join(hidden_games),
            join(hidden_classics),
        )
    });
    let mut all = default?;
    all.extend(classics);
    all.extend(hidden_games?);
    all.extend(hidden_classics?);
    Ok(all)
}

// ---- the merge ----------------------------------------------------------------

/// What a merge needs to know about the session.
pub struct MergeContext<'a> {
    /// `HydraApi.isLoggedIn() && HydraApi.hasActiveSubscription()`
    pub can_reconcile_custom_artwork: bool,
    /// `HydraApi.getAuthContext()` (environment + userId)
    pub auth: Option<AuthContext>,
    /// `current()`: the account (and the caller's run) is still the same.
    pub current: &'a (dyn Fn() -> bool + Sync),
    /// `onProgress(processed, total)`
    pub progress: Option<&'a (dyn Fn(usize, usize) + Sync)>,
    /// The Epic link the caller already confirmed (the Epic sync); `None`
    /// reads GET /profile/integrations/epic when a row has an Epic import.
    pub epic_connection_id: Option<&'a str>,
}

/// `HydraApi.getAuthContext()`: the API URL and the token's `userId`.
pub fn auth_context(db: &Db) -> Option<AuthContext> {
    let token = db
        .get::<Value>(keys::AUTH)?
        .get("accessToken")?
        .as_str()?
        .to_string();
    let user_id = crate::screenshots::user_id_from_token(&token)?;
    Some(AuthContext {
        environment: crate::config::api_url().trim_end_matches('/').to_string(),
        user_id,
    })
}

/// Why a merge stopped early.
#[derive(Debug)]
pub enum MergeStop {
    /// The account changed (or the caller cancelled).
    Stale,
    Api(ApiError),
    Db(hydra_db::Error),
    /// The remote rows have Epic imports but Epic isn't connected anymore.
    EpicDisconnected,
}

impl std::fmt::Display for MergeStop {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MergeStop::Stale => f.write_str("library-context-changed"),
            MergeStop::Api(error) => write!(f, "{error}"),
            MergeStop::Db(error) => write!(f, "{error}"),
            MergeStop::EpicDisconnected => f.write_str("epic-not-connected"),
        }
    }
}

impl From<hydra_db::Error> for MergeStop {
    fn from(error: hydra_db::Error) -> Self {
        MergeStop::Db(error)
    }
}

/// What a merge wrote, for logs and checks.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MergeReport {
    pub remote_games: usize,
    pub created: usize,
    pub updated: usize,
    pub hidden_steam_imports: usize,
    pub epic_probes: usize,
    pub epic_removed: usize,
    pub artwork_selections_changed: usize,
}

/// `mergeRemoteGamesChunk`: read the local rows, write the merged rows and
/// their shop assets in one batch, under the library write lock.
fn merge_chunk(
    db: &Db,
    remote_games: &[&Obj],
    ctx: &MergeContext<'_>,
    epic_connection_id: Option<&str>,
    hydra_revision: u64,
    report: &mut MergeReport,
) -> Result<(), MergeStop> {
    let artwork: Vec<(String, Obj, Option<Obj>, Obj)> = library_actions::with_write_lock(|| {
        let mut batch = Batch::default();
        let mut artwork = Vec::new();
        let now = now_ms();
        for remote in remote_games {
            let key = game_key_of(remote);
            let local: Option<Obj> = db.get_in(keys::GAMES, &key);
            let local_assets: Option<Obj> = db.get_in(keys::GAME_SHOP_ASSETS, &key);
            let mut merged =
                build_merged_game(remote, local.as_ref(), ctx.can_reconcile_custom_artwork);
            if let Some(local) = &local
                && library_actions::hydra_playtime_revision(Some(&key)) > hydra_revision
            {
                for field in [
                    "playTimeInMilliseconds",
                    "hasManuallyUpdatedPlaytime",
                    "lastTimePlayed",
                ] {
                    assign(&mut merged, field, local.get(field).cloned());
                }
            }
            if truthy(remote.get("hasActiveEpicImport"))
                && let (Some(auth), Some(connection)) = (&ctx.auth, epic_connection_id)
            {
                merged.insert(
                    "epicImportScope".into(),
                    json!({
                        "environment": auth.environment,
                        "userId": auth.user_id,
                        "connectionId": connection,
                    }),
                );
            } else if remote.get("hasActiveEpicImport") == Some(&Value::Bool(false)) {
                merged.remove("epicImportScope");
            }
            if local.is_some() {
                report.updated += 1;
            } else {
                report.created += 1;
            }
            batch.put_in(keys::GAMES, &key, &merged)?;
            let assets =
                build_remote_shop_assets(remote, local.as_ref(), local_assets.as_ref(), now);
            batch.put_in(keys::GAME_SHOP_ASSETS, &key, &assets)?;
            if let Some(catalogue) = nn(remote, "catalogueGame").and_then(Value::as_object) {
                let catalogue_key = game_key_of(catalogue);
                if catalogue_key != key {
                    batch.put_in(
                        keys::GAME_SHOP_ASSETS,
                        &catalogue_key,
                        &catalogue_assets(catalogue, &assets),
                    )?;
                }
            }
            if ctx.can_reconcile_custom_artwork
                && let Some(selection) = db.get_in::<Obj>(keys::ARTWORK_SELECTION, &key)
            {
                artwork.push((key, selection, local, (*remote).clone()));
            }
        }
        if !(ctx.current)() {
            return Err(MergeStop::Stale);
        }
        db.write(batch)?;
        Ok(artwork)
    })?;
    for (key, selection, local, remote) in artwork {
        if sync_artwork_selection(db, &key, &selection, local.as_ref(), &remote)? {
            report.artwork_selections_changed += 1;
        }
    }
    Ok(())
}

/// `syncArtworkSelectionWithRemote`: drop synced selections the account
/// replaced. TODO(customization): uploadUnsyncedArtworkSelection
/// (saveSteamGridDbArtwork) comes with the artwork picker.
fn sync_artwork_selection(
    db: &Db,
    key: &str,
    selection: &Obj,
    local: Option<&Obj>,
    remote: &Obj,
) -> Result<bool, MergeStop> {
    let current = selection
        .get("selected")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let empty = Obj::new();
    let (selected, changed) = reconcile_remote_artwork_selection(
        &current,
        local.unwrap_or(&empty),
        &remote_custom_assets(remote),
    );
    if !changed {
        return Ok(false);
    }
    if selected.is_empty() {
        db.delete_in(keys::ARTWORK_SELECTION, key)?;
        return Ok(true);
    }
    let mut next = selection.clone();
    next.insert("selected".into(), Value::Object(selected));
    next.insert("updatedAt".into(), Value::from(now_ms()));
    db.put_in(keys::ARTWORK_SELECTION, key, &next)?;
    Ok(true)
}

/// `hideGamesRemovedFromSteamImport`: keep installations, but hide games a
/// destructive Steam cleanup removed from the account.
fn hide_games_removed_from_steam_import(
    db: &Db,
    remote_keys: &HashSet<String>,
) -> Result<usize, hydra_db::Error> {
    let updates: Vec<(String, Obj)> = db
        .entries::<Obj>(keys::GAMES)?
        .into_iter()
        .filter(|(key, game)| resolve_missing_steam_import(game, remote_keys.contains(key)))
        .map(|(key, mut game)| {
            game.insert("hasActiveSteamImport".into(), Value::Bool(false));
            game.insert("isDeleted".into(), Value::Bool(true));
            (key, game)
        })
        .collect();
    let count = updates.len();
    for chunk in updates.chunks(MERGE_WRITE_CHUNK_SIZE) {
        let mut batch = Batch::default();
        for (key, game) in chunk {
            batch.put_in(keys::GAMES, key, game)?;
        }
        db.write(batch)?;
    }
    Ok(count)
}

/// `reconcileMissingEpicGame`: an Epic row missing from the snapshot is
/// asked for directly; a 404 marks the import removed.
fn reconcile_missing_epic_game(
    db: &Db,
    api: &HydraApi,
    key: &str,
    remote_id: &Value,
    object_id: &str,
    remote_keys: &HashSet<String>,
    ctx: &MergeContext<'_>,
) -> Result<bool, MergeStop> {
    if !(ctx.current)() {
        return Err(MergeStop::Stale);
    }
    let still_needed = |game: &Obj| {
        game.get("remoteId") == Some(remote_id) && needs_epic_owner_probe(key, game, remote_keys)
    };
    if !db
        .get_in::<Obj>(keys::GAMES, key)
        .is_some_and(|g| still_needed(&g))
    {
        return Ok(false);
    }
    let result = api.get(
        &format!("/profile/games/epic/{}", encode_component(object_id)),
        &[],
        Options::default(),
    );
    if !(ctx.current)() {
        return Err(MergeStop::Stale);
    }
    match result {
        Err(ApiError::Status { status: 404, .. }) => {}
        _ => return Ok(false),
    }
    let removed = library_actions::with_write_lock(|| -> Result<bool, MergeStop> {
        let Some(mut latest) = db.get_in::<Obj>(keys::GAMES, key) else {
            return Ok(false);
        };
        if !(ctx.current)() || !still_needed(&latest) {
            return Ok(false);
        }
        latest.insert("remoteId".into(), Value::Null);
        latest.insert("epicPlayTimeInMilliseconds".into(), json!(0));
        latest.insert("hasActiveEpicImport".into(), Value::Bool(false));
        latest.remove("epicImportScope");
        latest.insert("isDeleted".into(), Value::Bool(true));
        db.put_in(keys::GAMES, key, &latest)?;
        Ok(true)
    })?;
    if !(ctx.current)() {
        return Err(MergeStop::Stale);
    }
    Ok(removed)
}

/// `mergeWithRemoteGamesOnce`: the remote library into the local one.
/// `Ok` means the whole merge ran for the same account.
pub fn merge_with_remote_games(
    db: &Db,
    api: &HydraApi,
    ctx: &MergeContext<'_>,
) -> Result<MergeReport, MergeStop> {
    if !(ctx.current)() {
        return Err(MergeStop::Stale);
    }
    let hydra_revision = library_actions::hydra_playtime_revision(None);
    let remote_games = fetch_remote_profile_games(api).map_err(MergeStop::Api)?;
    if !(ctx.current)() {
        return Err(MergeStop::Stale);
    }
    merge_fetched_games(db, api, &remote_games, ctx, hydra_revision)
}

/// The merge over rows already fetched (tests and dry runs reuse it).
pub fn merge_fetched_games(
    db: &Db,
    api: &HydraApi,
    remote_games: &[Value],
    ctx: &MergeContext<'_>,
    hydra_revision: u64,
) -> Result<MergeReport, MergeStop> {
    let remote: Vec<&Obj> = remote_games.iter().filter_map(Value::as_object).collect();
    let mut epic_connection_id: Option<String> = ctx.epic_connection_id.map(str::to_string);
    if epic_connection_id.is_none() && remote.iter().any(|g| truthy(g.get("hasActiveEpicImport"))) {
        let connection = api
            .get("/profile/integrations/epic", &[], Options::default())
            .map_err(MergeStop::Api)?;
        if !truthy(connection.get("connected")) {
            return Err(MergeStop::EpicDisconnected);
        }
        epic_connection_id = connection
            .get("connectionId")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    if !(ctx.current)() {
        return Err(MergeStop::Stale);
    }
    let remote_keys: HashSet<String> = remote.iter().map(|g| game_key_of(g)).collect();
    let candidates: Vec<(String, Obj)> = db
        .entries::<Obj>(keys::GAMES)?
        .into_iter()
        .filter(|(key, game)| needs_epic_owner_probe(key, game, &remote_keys))
        .collect();
    if !(ctx.current)() {
        return Err(MergeStop::Stale);
    }
    let total = remote.len() + candidates.len();
    let mut processed = 0;
    let mut report = MergeReport {
        remote_games: remote.len(),
        ..Default::default()
    };
    if let Some(progress) = ctx.progress {
        progress(processed, total);
    }
    for chunk in remote.chunks(MERGE_WRITE_CHUNK_SIZE) {
        if !(ctx.current)() {
            return Err(MergeStop::Stale);
        }
        merge_chunk(
            db,
            chunk,
            ctx,
            epic_connection_id.as_deref(),
            hydra_revision,
            &mut report,
        )?;
        if !(ctx.current)() {
            return Err(MergeStop::Stale);
        }
        processed += chunk.len();
        if let Some(progress) = ctx.progress {
            progress(processed, total);
        }
    }
    report.hidden_steam_imports = library_actions::with_write_lock(|| {
        if !(ctx.current)() {
            return Err(MergeStop::Stale);
        }
        hide_games_removed_from_steam_import(db, &remote_keys).map_err(MergeStop::Db)
    })?;
    report.epic_probes = candidates.len();
    for batch in candidates.chunks(TARGETED_MERGE_CONCURRENCY) {
        if !(ctx.current)() {
            return Err(MergeStop::Stale);
        }
        let results: Vec<Result<bool, MergeStop>> = std::thread::scope(|scope| {
            let handles: Vec<_> = batch
                .iter()
                .map(|(key, game)| {
                    let remote_keys = &remote_keys;
                    scope.spawn(move || {
                        let remote_id = game.get("remoteId").cloned().unwrap_or(Value::Null);
                        let object_id = str_of(game, "objectId").unwrap_or_default();
                        reconcile_missing_epic_game(
                            db,
                            api,
                            key,
                            &remote_id,
                            object_id,
                            remote_keys,
                            ctx,
                        )
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().unwrap_or(Err(MergeStop::Stale)))
                .collect()
        });
        for result in results {
            if result? {
                report.epic_removed += 1;
            }
            processed += 1;
            if let Some(progress) = ctx.progress {
                progress(processed, total);
            }
        }
    }
    if !(ctx.current)() {
        return Err(MergeStop::Stale);
    }
    Ok(report)
}

/// `encodeURIComponent`
pub fn encode_component(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

// ---- upload-games-batch.ts ------------------------------------------------------

/// The games `uploadGamesBatch` sends: not deleted, never synced, not custom
/// and not Epic imports.
pub fn upload_candidates(games: &[(String, Obj)]) -> Vec<(String, Obj)> {
    games
        .iter()
        .filter(|(_, game)| {
            !truthy(game.get("isDeleted"))
                && game.get("remoteId") == Some(&Value::Null)
                && str_of(game, "shop") != Some("custom")
                && str_of(game, "source") != Some("epic")
        })
        .cloned()
        .collect()
}

/// One `/profile/games/batch` item.
pub fn upload_item(game: &Obj) -> Value {
    // Math.trunc: null is 0; undefined (and anything else) is NaN, which
    // JSON writes as null.
    let play_time = match game.get("playTimeInMilliseconds") {
        Some(Value::Null) => json!(0),
        Some(Value::Bool(b)) => json!(i64::from(*b)),
        Some(Value::Number(n)) => n.as_f64().map_or(Value::Null, |ms| num(ms.trunc())),
        Some(Value::String(s)) if s.trim().is_empty() => json!(0),
        Some(Value::String(s)) => s
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|f| f.is_finite())
            .map_or(Value::Null, |ms| num(ms.trunc())),
        _ => Value::Null,
    };
    let mut item = Obj::new();
    assign(&mut item, "objectId", game.get("objectId").cloned());
    item.insert("playTimeInMilliseconds".into(), play_time);
    assign(&mut item, "shop", game.get("shop").cloned());
    assign(
        &mut item,
        "lastTimePlayed",
        game.get("lastTimePlayed").cloned(),
    );
    assign(&mut item, "isFavorite", game.get("favorite").cloned());
    item.insert(
        "isPinned".into(),
        nn(game, "isPinned").cloned().unwrap_or(Value::Bool(false)),
    );
    Value::Object(item)
}

static DRY_RUN_LOGGED: AtomicBool = AtomicBool::new(false);

/// The upload half of `uploadLocalGamesAndMerge`: each chunk is read again
/// right before it goes up, so games synced meanwhile are skipped. Returns
/// how many games were sent (or would be, in a dry run).
pub fn upload_local_games(
    db: &Db,
    api: &HydraApi,
    current: &(dyn Fn() -> bool + Sync),
) -> Result<usize, hydra_db::Error> {
    if !current() {
        return Ok(0);
    }
    let games: Vec<(String, Obj)> = db.entries(keys::GAMES)?;
    let candidates = upload_candidates(&games);
    let dry = dry_run();
    let mut sent = 0;
    for chunk in candidates.chunks(UPLOAD_CHUNK_SIZE) {
        if !current() {
            return Ok(sent);
        }
        let latest: Vec<Obj> = chunk
            .iter()
            .filter_map(|(key, _)| db.get_in::<Obj>(keys::GAMES, key))
            .filter(|game| {
                !truthy(game.get("isDeleted"))
                    && game.get("remoteId") == Some(&Value::Null)
                    && str_of(game, "source") != Some("epic")
            })
            .collect();
        if latest.is_empty() || !api.is_logged_in() {
            continue;
        }
        let body = Value::Array(latest.iter().map(upload_item).collect());
        sent += latest.len();
        if dry {
            if !DRY_RUN_LOGGED.swap(true, Ordering::SeqCst) {
                eprintln!("[library-sync] dry run: uploads are printed, not sent");
            }
            eprintln!("[library-sync] dry run: POST /profile/games/batch {body}");
            continue;
        }
        // `.catch(() => {})`: a failed chunk doesn't stop the others. Signed
        // out, validateOptions refuses before any request.
        match api.post(
            "/profile/games/batch",
            &body,
            Options {
                needs_auth: true,
                timeout: Some(GAME_REQUEST_TIMEOUT),
            },
        ) {
            Ok(_) => {}
            Err(ApiError::NotLoggedIn) => sent -= latest.len(),
            Err(error) => eprintln!("[library-sync] games batch failed: {error}"),
        }
    }
    Ok(sent)
}

// ---- merge-imported-profile-game.ts ---------------------------------------------

/// `mergeImportedProfileGame`: one game the API returned after a targeted
/// write (Steam game exit sync, emulator imports).
pub fn merge_imported_profile_game(local: &Obj, remote: &Obj) -> Obj {
    let mut game = local.clone();
    merge_catalogue_metadata(&mut game, Some(local), remote);
    let keep_null = str_of(local, "source") == Some("hydra")
        && local.get("remoteId") == Some(&Value::Null)
        && str_of(remote, "source") == Some("epic");
    assign(
        &mut game,
        "remoteId",
        if keep_null {
            Some(Value::Null)
        } else {
            remote.get("id").cloned()
        },
    );
    // addedToLibraryAt: local ?? parseDate(remote.createdAt)
    let added = nn(local, "addedToLibraryAt").cloned().unwrap_or_else(|| {
        remote
            .get("createdAt")
            .filter(|v| truthy(Some(v)))
            .map(js_date)
            .unwrap_or(Value::Null)
    });
    game.insert("addedToLibraryAt".into(), added);
    // latestDate(local, remote). The stored local value is a string, and
    // `Date > string` compares against NaN, so a local date always wins.
    let remote_last = remote
        .get("lastTimePlayed")
        .filter(|v| truthy(Some(v)))
        .and_then(date_ms);
    let last = match remote_last {
        Some(remote_ms) if !truthy(local.get("lastTimePlayed")) => Some(json!(ms_iso(remote_ms))),
        _ => local.get("lastTimePlayed").cloned(),
    };
    assign(&mut game, "lastTimePlayed", last);
    merge_play_time(&mut game, local, remote);
    let steam_import = is_true(remote, "hasActiveSteamImport");
    game.insert("hasActiveSteamImport".into(), Value::Bool(steam_import));
    game.insert(
        "hasActiveEpicImport".into(),
        nn(remote, "hasActiveEpicImport")
            .or_else(|| nn(local, "hasActiveEpicImport"))
            .cloned()
            .unwrap_or(Value::Bool(false)),
    );
    assign(
        &mut game,
        "isDeleted",
        resolve_library_is_deleted(
            local.get("isDeleted"),
            None,
            steam_import,
            is_true(remote, "hasActiveEpicImport"),
        ),
    );
    for (local_key, remote_key) in [
        ("hasManuallyUpdatedPlaytime", "hasManuallyUpdatedPlaytime"),
        ("favorite", "isFavorite"),
        ("isPinned", "isPinned"),
        ("collectionIds", "collectionIds"),
    ] {
        assign(
            &mut game,
            local_key,
            coalesce(remote, remote_key, local.get(local_key)),
        );
    }
    game
}

fn ms_iso(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_default()
}

// ---- clear-games-remote-id.ts ----------------------------------------------------

/// `resetAccountScopedGameState`
pub fn reset_account_scoped_game_state(game: &Obj) -> Obj {
    let mut game = game.clone();
    game.insert("remoteId".into(), Value::Null);
    game.insert("isHiddenFromOthers".into(), Value::Bool(false));
    let custom = str_of(&game, "shop") == Some("custom");
    let concealed = custom && truthy(game.get("isConcealed"));
    game.insert("isConcealed".into(), Value::Bool(concealed));
    game
}

/// `clearGamesRemoteIds`: a new account signed in; the previous account's
/// remote ids and visibility no longer apply.
pub fn clear_games_remote_ids(db: &Db) -> Result<usize, hydra_db::Error> {
    library_actions::with_write_lock(|| {
        let games: Vec<(String, Obj)> = db.entries(keys::GAMES)?;
        let mut batch = Batch::default();
        for (key, game) in &games {
            batch.put_in(keys::GAMES, key, &reset_account_scoped_game_state(game))?;
        }
        db.write(batch)?;
        Ok(games.len())
    })
}

/// Counts of the local library against the remote one (dry-run report).
pub fn summarize(db: &Db) -> HashMap<&'static str, usize> {
    let games: Vec<(String, Obj)> = db.entries(keys::GAMES).unwrap_or_default();
    let mut out = HashMap::new();
    out.insert("games", games.len());
    out.insert(
        "deleted",
        games
            .iter()
            .filter(|(_, g)| truthy(g.get("isDeleted")))
            .count(),
    );
    out.insert(
        "with remoteId",
        games
            .iter()
            .filter(|(_, g)| truthy(g.get("remoteId")))
            .count(),
    );
    out.insert("upload candidates", upload_candidates(&games).len());
    out.insert(
        "steam imports",
        games
            .iter()
            .filter(|(_, g)| is_true(g, "hasActiveSteamImport"))
            .count(),
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(value: Value) -> Obj {
        value.as_object().unwrap().clone()
    }

    /// A signed-out client: requests fail before reaching the network.
    fn test_api(db: &std::sync::Arc<Db>) -> HydraApi {
        let _ = rustls::crypto::ring::default_provider().install_default();
        HydraApi::new(db.clone(), reqwest::blocking::Client::new())
    }

    #[test]
    fn library_source_prefers_hydra_then_steam() {
        assert_eq!(
            resolve_library_source(Some(&json!("epic")), Some(&json!("hydra"))),
            "hydra"
        );
        assert_eq!(
            resolve_library_source(Some(&json!("epic")), Some(&json!("steam"))),
            "steam"
        );
        assert_eq!(resolve_library_source(None, Some(&json!("epic"))), "epic");
        assert_eq!(resolve_library_source(Some(&json!("x")), None), "hydra");
    }

    #[test]
    fn imports_are_never_deleted_locally() {
        assert_eq!(
            resolve_library_is_deleted(Some(&json!(true)), Some(&json!("steam")), false, false),
            Some(json!(false))
        );
        assert_eq!(
            resolve_library_is_deleted(Some(&json!(true)), Some(&json!("hydra")), false, false),
            Some(json!(true))
        );
        assert_eq!(resolve_library_is_deleted(None, None, false, false), None);
    }

    #[test]
    fn new_remote_game_is_created_like_electron() {
        let remote = obj(json!({
            "id": "r1",
            "objectId": "10",
            "shop": "steam",
            "title": "Counter-Strike",
            "iconUrl": "icon",
            "libraryHeroImageUrl": null,
            "logoImageUrl": "logo",
            "createdAt": "2024-05-01T10:00:00.000Z",
            "lastTimePlayed": "2024-06-01T10:00:00.000Z",
            "playTimeInSeconds": 120,
            "hasManuallyUpdatedPlaytime": false,
            "isFavorite": true,
            "collectionIds": ["c1"],
            "achievementCount": 4,
            "unlockedAchievementCount": 2,
            "source": "steam",
            "hasActiveSteamImport": true,
            "canonicalId": null,
        }));
        let game = build_merged_game(&remote, None, false);
        assert_eq!(game["remoteId"], "r1");
        assert_eq!(game["addedToLibraryAt"], "2024-05-01T10:00:00.000Z");
        assert_eq!(game["playTimeInMilliseconds"], 120_000);
        assert_eq!(game["steamPlayTimeInMilliseconds"], 0);
        assert_eq!(game["favorite"], true);
        assert_eq!(game["isPinned"], false);
        assert_eq!(game["collectionIds"], json!(["c1"]));
        assert_eq!(game["source"], "steam");
        assert_eq!(game["hasActiveSteamImport"], true);
        assert_eq!(game["platform"], Value::Null);
        assert_eq!(game["customCoverImageUrl"], Value::Null);
        // `null ?? undefined` drops the key.
        assert!(!game.contains_key("canonicalId"));
        assert_eq!(game["libraryHeroImageUrl"], Value::Null);
        assert_eq!(game["isDeleted"], false);
    }

    #[test]
    fn existing_game_keeps_local_progress() {
        let local = obj(json!({
            "objectId": "10",
            "shop": "steam",
            "title": "Local",
            "remoteId": null,
            "playTimeInMilliseconds": 500_000,
            "lastTimePlayed": "2024-07-01T00:00:00.000Z",
            "addedToLibraryAt": "2023-01-01T00:00:00.000Z",
            "favorite": false,
            "isDeleted": false,
            "executablePath": "C:/game.exe",
            "collectionId": "old",
            "source": "hydra",
            "pinnedDate": "2024-01-01T00:00:00.000Z",
        }));
        let remote = obj(json!({
            "id": "r1",
            "objectId": "10",
            "shop": "steam",
            "title": "Remote",
            "runtime": 100,
            "lastTimePlayed": "2024-06-01T00:00:00.000Z",
            "isFavorite": true,
            "isPinned": true,
            "source": "steam",
            "achievementCount": 3,
            "unlockedAchievementCount": 1,
        }));
        let game = build_merged_game(&remote, Some(&local), false);
        assert_eq!(game["remoteId"], "r1");
        assert_eq!(game["title"], "Local", "no catalogueGame: the title stays");
        assert_eq!(game["playTimeInMilliseconds"], 500_000);
        assert_eq!(game["lastTimePlayed"], "2024-07-01T00:00:00.000Z");
        assert_eq!(game["addedToLibraryAt"], "2023-01-01T00:00:00.000Z");
        assert_eq!(game["favorite"], true);
        assert_eq!(game["isPinned"], true);
        assert_eq!(game["pinnedDate"], "2024-01-01T00:00:00.000Z");
        assert_eq!(
            game["collectionIds"],
            json!(["old"]),
            "no remote collection field"
        );
        assert_eq!(game["executablePath"], "C:/game.exe");
        assert_eq!(game["source"], "hydra");
        assert_eq!(game["hasActiveSteamImport"], false);
        assert_eq!(game["hasActiveEpicImport"], false);
        assert_eq!(game["isConcealed"], false);
        assert!(!game.contains_key("isHiddenFromOthers"));
    }

    #[test]
    fn catalogue_rows_take_the_remote_title_and_art() {
        let local = obj(json!({ "objectId": "a", "shop": "epic", "title": "Old", "iconUrl": "x" }));
        let remote = obj(json!({
            "id": "r",
            "objectId": "a",
            "shop": "epic",
            "title": "New",
            "catalogueGame": { "shop": "steam", "objectId": "1" },
            "logoImageUrl": "logo",
        }));
        let game = build_merged_game(&remote, Some(&local), false);
        assert_eq!(game["title"], "New");
        assert!(
            !game.contains_key("iconUrl"),
            "undefined from the remote drops it"
        );
        assert_eq!(
            game["catalogueGame"],
            json!({ "shop": "steam", "objectId": "1" })
        );
    }

    #[test]
    fn custom_art_keeps_local_files() {
        let local = obj(json!({ "customIconUrl": "local:C:/icon.png", "customLogoImageUrl": "a" }));
        let remote = obj(json!({
            "customIconUrl": "https://remote/icon",
            "customLogoImageUrl": null,
        }));
        let game = build_merged_game(&remote, Some(&local), true);
        assert_eq!(game["customIconUrl"], "local:C:/icon.png");
        assert_eq!(game["customLogoImageUrl"], Value::Null);
        assert!(!game.contains_key("customHeroImageUrl"));
        let game = build_merged_game(&remote, Some(&local), false);
        assert_eq!(game["customLogoImageUrl"], "a");
    }

    #[test]
    fn shop_assets_follow_the_remote_row() {
        let local_assets = obj(json!({
            "updatedAt": 5,
            "title": "Cached",
            "images": { "a": 1, "b": 2 },
            "extra": true,
        }));
        let remote = obj(json!({
            "objectId": "620",
            "shop": "steam",
            "title": "Portal 2",
            "iconUrl": "i",
            "images": { "b": 3 },
        }));
        let assets = build_remote_shop_assets(&remote, None, Some(&local_assets), 99);
        assert_eq!(assets["updatedAt"], 5, "the cached updatedAt wins");
        assert_eq!(assets["title"], "Portal 2");
        assert_eq!(
            assets["coverImageUrl"],
            "https://shared.steamstatic.com/store_item_assets/steam/apps/620/library_600x900_2x.jpg"
        );
        assert_eq!(assets["images"], json!({ "a": 1, "b": 3 }));
        assert_eq!(assets["extra"], true);
        assert!(!assets.contains_key("logoImageUrl"));
    }

    #[test]
    fn epic_assets_keep_resolved_defaults() {
        let cached = obj(json!({
            "iconUrl": "cached-icon",
            "coverImageUrl": "cached-cover",
            "epicArtworkUpdatedAtByType": { "icon": 1, "portrait": 2 },
        }));
        let remote = obj(json!({
            "objectId": "e",
            "shop": "epic",
            "title": "Epic",
            "iconUrl": "remote-icon",
            "coverImageUrl": "remote-cover",
            "libraryHeroImageUrl": "hero",
        }));
        let assets = build_remote_shop_assets(&remote, None, Some(&cached), 1);
        assert_eq!(assets["iconUrl"], "cached-icon");
        assert_eq!(assets["coverImageUrl"], "cached-cover");
        assert_eq!(assets["libraryHeroImageUrl"], "hero");
        let assets = build_remote_shop_assets(&remote, None, None, 1);
        assert_eq!(assets["iconUrl"], Value::Null);
        assert!(!assets.contains_key("epicArtworkUpdatedAtByType"));
    }

    #[test]
    fn synced_selections_the_account_replaced_are_dropped() {
        let current = obj(json!({
            "icon": { "url": "a", "syncedAt": 1 },
            "logo": { "url": "b" },
            "hero": { "url": "c", "syncedAt": 1 },
        }));
        let remote = obj(json!({
            "customIconUrl": "z",
            "customLogoImageUrl": "y",
            "customHeroImageUrl": "c",
        }));
        let (selected, changed) =
            reconcile_remote_artwork_selection(&current, &Obj::new(), &remote);
        assert!(changed);
        assert!(!selected.contains_key("icon"));
        assert!(selected.contains_key("logo"), "unsynced stays");
        assert!(selected.contains_key("hero"), "same url stays");
    }

    #[test]
    fn upload_items_match_electron() {
        let games = vec![
            (
                "steam:1".to_string(),
                obj(
                    json!({ "objectId": "1", "shop": "steam", "remoteId": null, "playTimeInMilliseconds": 1234.9, "lastTimePlayed": null, "favorite": true }),
                ),
            ),
            (
                "steam:2".to_string(),
                obj(json!({ "objectId": "2", "shop": "steam", "remoteId": "x" })),
            ),
            (
                "custom:3".to_string(),
                obj(json!({ "objectId": "3", "shop": "custom", "remoteId": null })),
            ),
            (
                "epic:4".to_string(),
                obj(json!({ "objectId": "4", "shop": "epic", "remoteId": null, "source": "epic" })),
            ),
            (
                "steam:5".to_string(),
                obj(
                    json!({ "objectId": "5", "shop": "steam", "isDeleted": true, "remoteId": null }),
                ),
            ),
            (
                "steam:6".to_string(),
                obj(json!({ "objectId": "6", "shop": "steam" })),
            ),
        ];
        let candidates = upload_candidates(&games);
        assert_eq!(candidates.len(), 1, "remoteId must be null, not missing");
        assert_eq!(
            upload_item(&candidates[0].1),
            json!({
                "objectId": "1",
                "playTimeInMilliseconds": 1234,
                "shop": "steam",
                "lastTimePlayed": null,
                "isFavorite": true,
                "isPinned": false,
            })
        );
        // `favorite` undefined drops `isFavorite`; no playtime is NaN -> null.
        assert_eq!(
            upload_item(&obj(json!({ "objectId": "7", "shop": "steam" }))),
            json!({ "objectId": "7", "playTimeInMilliseconds": null, "shop": "steam", "isPinned": false })
        );
    }

    #[test]
    fn imported_profile_game_merges_one_row() {
        let local = obj(json!({
            "objectId": "1",
            "shop": "steam",
            "remoteId": null,
            "source": "hydra",
            "playTimeInMilliseconds": 10_000,
            "lastTimePlayed": "2024-01-01T00:00:00.000Z",
            "favorite": true,
            "isDeleted": true,
        }));
        let remote = obj(json!({
            "id": "r",
            "objectId": "1",
            "shop": "steam",
            "runtimeByPlatform": { "steam": 50 },
            "lastTimePlayed": "2024-02-01T00:00:00Z",
            "hasActiveSteamImport": true,
        }));
        let game = merge_imported_profile_game(&local, &remote);
        assert_eq!(game["remoteId"], "r");
        // Electron compares a Date with the stored string (NaN): local wins.
        assert_eq!(game["lastTimePlayed"], "2024-01-01T00:00:00.000Z");
        let mut unplayed = local.clone();
        unplayed.insert("lastTimePlayed".into(), Value::Null);
        assert_eq!(
            merge_imported_profile_game(&unplayed, &remote)["lastTimePlayed"],
            "2024-02-01T00:00:00.000Z"
        );
        assert_eq!(game["steamPlayTimeInMilliseconds"], 50_000);
        assert_eq!(game["playTimeInMilliseconds"], 10_000);
        assert_eq!(game["isDeleted"], false);
        assert_eq!(game["favorite"], true);
        assert_eq!(game["addedToLibraryAt"], Value::Null);
    }

    #[test]
    fn account_switch_resets_visibility() {
        let game = obj(
            json!({ "shop": "steam", "remoteId": "x", "isConcealed": true, "isHiddenFromOthers": true }),
        );
        let reset = reset_account_scoped_game_state(&game);
        assert_eq!(reset["remoteId"], Value::Null);
        assert_eq!(reset["isConcealed"], false);
        assert_eq!(reset["isHiddenFromOthers"], false);
        let custom = obj(json!({ "shop": "custom", "isConcealed": true }));
        assert_eq!(
            reset_account_scoped_game_state(&custom)["isConcealed"],
            true
        );
    }

    #[test]
    fn merge_writes_games_assets_and_hides_dropped_imports() {
        let dir = tempfile::tempdir().unwrap();
        let db = std::sync::Arc::new(Db::open(dir.path().join("db")).unwrap());
        db.put_in(
            keys::GAMES,
            "steam:1",
            &json!({ "objectId": "1", "shop": "steam", "title": "Kept", "remoteId": null, "playTimeInMilliseconds": 0, "isDeleted": false }),
        )
        .unwrap();
        db.put_in(
            keys::GAMES,
            "steam:2",
            &json!({ "objectId": "2", "shop": "steam", "title": "Dropped import", "hasActiveSteamImport": true, "isDeleted": false }),
        )
        .unwrap();
        let api = test_api(&db);
        let remote = vec![
            json!({ "id": "a", "objectId": "1", "shop": "steam", "title": "Kept", "runtime": 30, "catalogueGame": { "shop": "steam", "objectId": "1" } }),
            json!({ "id": "b", "objectId": "x", "shop": "epic", "title": "Epic copy", "catalogueGame": { "shop": "steam", "objectId": "1" }, "iconUrl": "e" }),
        ];
        let current = || true;
        let ctx = MergeContext {
            can_reconcile_custom_artwork: false,
            auth: None,
            current: &current,
            progress: None,
            epic_connection_id: None,
        };
        let report = merge_fetched_games(&db, &api, &remote, &ctx, 0).unwrap();
        assert_eq!(report.created, 1);
        assert_eq!(report.updated, 1);
        assert_eq!(report.hidden_steam_imports, 1);
        let kept: Obj = db.get_in(keys::GAMES, "steam:1").unwrap();
        assert_eq!(kept["remoteId"], "a");
        assert_eq!(kept["playTimeInMilliseconds"], 30_000);
        let dropped: Obj = db.get_in(keys::GAMES, "steam:2").unwrap();
        assert_eq!(dropped["isDeleted"], true);
        assert_eq!(dropped["hasActiveSteamImport"], false);
        let epic: Obj = db.get_in(keys::GAMES, "epic:x").unwrap();
        assert_eq!(epic["remoteId"], "b");
        // The Epic row's catalogue entry lands on the Steam key.
        let catalogue: Obj = db.get_in(keys::GAME_SHOP_ASSETS, "steam:1").unwrap();
        assert_eq!(catalogue["title"], "Epic copy");
        assert_eq!(catalogue["iconUrl"], "e");
    }

    #[test]
    fn stale_context_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let db = std::sync::Arc::new(Db::open(dir.path().join("db")).unwrap());
        let api = test_api(&db);
        let remote = vec![json!({ "id": "a", "objectId": "1", "shop": "steam", "title": "A" })];
        let current = || false;
        let ctx = MergeContext {
            can_reconcile_custom_artwork: false,
            auth: None,
            current: &current,
            progress: None,
            epic_connection_id: None,
        };
        assert!(matches!(
            merge_fetched_games(&db, &api, &remote, &ctx, 0),
            Err(MergeStop::Stale)
        ));
        assert!(db.get_in::<Obj>(keys::GAMES, "steam:1").is_none());
    }
}
