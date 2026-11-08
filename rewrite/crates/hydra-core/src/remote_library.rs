//! library-sync/merge-with-remote-games.ts (and its helpers in
//! fetch-remote-profile-games.ts, merge-imported-profile-game.ts,
//! resolve-library-source.ts, shared/playtime.ts, shared/library-catalogue.ts
//! and shared/artwork-resolver.ts `preserveEpicDefaultArtwork`): pull the
//! account's library from the Hydra API into the local games and shop assets.
//!
//! Records stay JSON like Electron's LevelDB values. A field Electron sets to
//! `undefined` is removed (JSON.stringify drops it).
//!
//! TODO(library-sync): the custom artwork *selection* reconciliation
//! (gamesArtworkSelection + SteamGridDB uploads) and the achievement caches
//! (trackAchievementBatchGame, UnlockedAchievementsCache) are not ported.

use std::collections::HashSet;

use hydra_db::{Db, keys};
use serde_json::{Map, Value, json};

use crate::api::{ApiError, HydraApi, Options};

const PAGE_SIZE: usize = 100;
const PAGE_FETCH_CONCURRENCY: usize = 3;
const TARGETED_MERGE_CONCURRENCY: usize = 10;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// A JS value that `??` treats as present.
fn present(value: Option<&Value>) -> Option<&Value> {
    value.filter(|v| !v.is_null())
}

fn text<'a>(value: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn is_true(value: &Map<String, Value>, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool) == Some(true)
}

/// Sets `key` to `value`, or removes it for `undefined`.
fn assign(map: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    match value {
        Some(value) => {
            map.insert(key.to_string(), value);
        }
        None => {
            map.remove(key);
        }
    }
}

/// `new Date(x).getTime()` for the dates the API and LevelDB hold.
fn date_ms(value: Option<&Value>) -> Option<i64> {
    match present(value)? {
        Value::String(text) => chrono::DateTime::parse_from_rfc3339(text)
            .map(|d| d.timestamp_millis())
            .ok()
            .or_else(|| crate::library::parse_iso_millis(text)),
        Value::Number(n) => n.as_f64().map(|f| f as i64),
        _ => None,
    }
}

// ---- resolve-library-source.ts -------------------------------------------

fn is_library_source(value: Option<&str>) -> bool {
    matches!(value, Some("hydra" | "steam" | "epic"))
}

/// resolveLibrarySource
pub fn resolve_library_source(local: Option<&str>, remote: Option<&str>) -> &'static str {
    if local == Some("hydra") || remote == Some("hydra") {
        return "hydra";
    }
    if local == Some("steam") || remote == Some("steam") {
        return "steam";
    }
    for source in [local, remote] {
        if is_library_source(source) {
            return match source {
                Some("epic") => "epic",
                Some("steam") => "steam",
                _ => "hydra",
            };
        }
    }
    "hydra"
}

/// resolveLibraryIsDeleted
pub fn resolve_library_is_deleted(
    local_is_deleted: bool,
    remote_source: Option<&str>,
    has_active_steam_import: bool,
    has_active_epic_import: bool,
) -> bool {
    if matches!(remote_source, Some("steam" | "epic"))
        || has_active_steam_import
        || has_active_epic_import
    {
        false
    } else {
        local_is_deleted
    }
}

// ---- shared/playtime.ts ----------------------------------------------------

fn seconds_to_ms(seconds: f64) -> f64 {
    if !seconds.is_finite() || seconds < 0.0 {
        0.0
    } else {
        seconds * 1000.0
    }
}

fn number(value: Option<&Value>) -> Option<f64> {
    present(value).and_then(Value::as_f64)
}

/// getRemotePlayTimeParts: (hydra, steam, epic) milliseconds.
fn remote_playtime_parts(remote: &Map<String, Value>, epic_override: Option<f64>) -> (f64, f64, f64) {
    let by_platform = remote.get("runtimeByPlatform").filter(|v| v.is_object());
    let platform = |key: &str| by_platform.and_then(|p| number(p.get(key)));
    let hydra = platform("hydra");
    let steam = platform("steam");
    let epic = epic_override.or_else(|| platform("epic"));
    let combined = number(remote.get("runtime"))
        .or_else(|| number(remote.get("playTimeInSeconds")))
        .or_else(|| number(remote.get("playTimeInMilliseconds")).map(|ms| ms / 1000.0))
        .unwrap_or(0.0);
    if hydra.is_some() || steam.is_some() || epic.is_some() {
        let hydra_ms = match hydra {
            Some(seconds) => seconds_to_ms(seconds),
            None => (seconds_to_ms(combined)
                - seconds_to_ms(steam.unwrap_or(0.0))
                - seconds_to_ms(epic.unwrap_or(0.0)))
            .max(0.0),
        };
        return (
            hydra_ms,
            seconds_to_ms(steam.unwrap_or(0.0)),
            seconds_to_ms(epic.unwrap_or(0.0)),
        );
    }
    (seconds_to_ms(combined), 0.0, 0.0)
}

/// mergeLocalAndRemotePlayTime
pub fn merge_playtime(local: &Map<String, Value>, remote: &Map<String, Value>) -> (f64, f64, f64) {
    // An older API lacks Epic fields entirely; absence is not a zero snapshot.
    let supports_epic = remote
        .get("runtimeByPlatform")
        .and_then(|p| p.get("epic"))
        .is_some_and(Value::is_number)
        || remote.get("hasActiveEpicImport").is_some_and(Value::is_boolean);
    let local_epic = number(local.get("epicPlayTimeInMilliseconds")).unwrap_or(0.0);
    let epic_override = (!supports_epic && local_epic != 0.0).then_some(local_epic / 1000.0);
    let (hydra, steam, epic) = remote_playtime_parts(remote, epic_override);
    let local_hydra = number(local.get("playTimeInMilliseconds")).unwrap_or(0.0);
    (local_hydra.max(hydra), steam, epic)
}

fn ms_value(ms: f64) -> Value {
    if ms.fract() == 0.0 && ms.abs() < 9e15 {
        json!(ms as i64)
    } else {
        json!(ms)
    }
}

fn apply_playtime(target: &mut Map<String, Value>, (hydra, steam, epic): (f64, f64, f64)) {
    target.insert("playTimeInMilliseconds".into(), ms_value(hydra));
    target.insert("steamPlayTimeInMilliseconds".into(), ms_value(steam));
    target.insert("epicPlayTimeInMilliseconds".into(), ms_value(epic));
}

// ---- shared/library-catalogue.ts -------------------------------------------

/// mergeLibraryCatalogueMetadata
fn apply_catalogue_metadata(target: &mut Map<String, Value>, local: Option<&Map<String, Value>>, remote: &Map<String, Value>) {
    for key in ["canonicalId", "catalogueGame", "availableShops"] {
        let value = present(remote.get(key))
            .or_else(|| local.and_then(|l| present(l.get(key))))
            .cloned();
        assign(target, key, value);
    }
}

/// mergePersistedAchievementTotals (without the in-memory achievement store).
fn apply_achievement_totals(target: &mut Map<String, Value>, shop: &str, local: Option<&Map<String, Value>>, remote: &Map<String, Value>) {
    for key in ["achievementCount", "unlockedAchievementCount"] {
        let local_value = local.and_then(|l| number(l.get(key)));
        let remote_value = number(remote.get(key));
        let value = if shop == "epic" {
            remote_value.or(local_value).unwrap_or(0.0)
        } else {
            local_value.unwrap_or(0.0).max(remote_value.unwrap_or(0.0))
        };
        target.insert(key.into(), ms_value(value));
    }
}

fn collection_ids(source: Option<&Map<String, Value>>) -> Value {
    let Some(source) = source else {
        return json!([]);
    };
    if let Some(ids) = source.get("collectionIds").filter(|v| v.is_array()) {
        return ids.clone();
    }
    match source.get("collectionId").and_then(Value::as_str) {
        Some(id) if !id.is_empty() => json!([id]),
        _ => json!([]),
    }
}

/// reconcileCustomAsset: a `local:` file always wins.
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

fn latest_last_played(local: &Map<String, Value>, remote: &Map<String, Value>) -> Value {
    let local_value = present(local.get("lastTimePlayed"));
    let remote_value = present(remote.get("lastTimePlayed"));
    let Some(local_value) = local_value else {
        return remote.get("lastTimePlayed").cloned().unwrap_or(Value::Null);
    };
    match (date_ms(Some(local_value)), remote_value.and_then(|r| date_ms(Some(r)))) {
        (Some(l), Some(r)) if r > l => remote_value.cloned().unwrap_or(Value::Null),
        (None, Some(_)) => remote_value.cloned().unwrap_or(Value::Null),
        _ => local_value.clone(),
    }
}

fn remote_added_at(remote: &Map<String, Value>) -> Value {
    match present(remote.get("createdAt")) {
        Some(created) if date_ms(Some(created)).is_some() => created.clone(),
        _ => Value::Null,
    }
}

/// mergeExistingGame
fn merge_existing_game(
    local: &Map<String, Value>,
    remote: &Map<String, Value>,
    collection_ids: Value,
    can_reconcile_custom_artwork: bool,
) -> Map<String, Value> {
    let mut merged = local.clone();
    apply_catalogue_metadata(&mut merged, Some(local), remote);
    if present(remote.get("catalogueGame")).is_some() {
        for key in ["title", "iconUrl", "libraryHeroImageUrl", "logoImageUrl"] {
            assign(&mut merged, key, remote.get(key).cloned());
        }
    }
    let keep_null = text(local, "source") == Some("hydra")
        && local.get("remoteId") == Some(&Value::Null)
        && text(remote, "source") == Some("epic");
    merged.insert(
        "remoteId".into(),
        if keep_null {
            Value::Null
        } else {
            remote.get("id").cloned().unwrap_or(Value::Null)
        },
    );
    if present(local.get("addedToLibraryAt")).is_none() {
        merged.insert("addedToLibraryAt".into(), remote_added_at(remote));
    }
    merged.insert("lastTimePlayed".into(), latest_last_played(local, remote));
    apply_playtime(&mut merged, merge_playtime(local, remote));
    if let Some(favorite) = present(remote.get("isFavorite")) {
        merged.insert("favorite".into(), favorite.clone());
    }
    if let Some(hidden) = present(remote.get("isHiddenFromOthers")) {
        merged.insert("isHiddenFromOthers".into(), hidden.clone());
    }
    let concealed = present(remote.get("isConcealed"))
        .or_else(|| present(local.get("isConcealed")))
        .cloned()
        .unwrap_or(json!(false));
    merged.insert("isConcealed".into(), concealed);
    if let Some(pinned) = present(remote.get("isPinned")) {
        merged.insert("isPinned".into(), pinned.clone());
    }
    merged.insert("collectionIds".into(), collection_ids);
    let shop = text(remote, "shop").unwrap_or_default().to_string();
    apply_achievement_totals(&mut merged, &shop, Some(local), remote);
    if let Some(platform) = present(remote.get("platform")) {
        merged.insert("platform".into(), platform.clone());
    }
    merged.insert(
        "source".into(),
        json!(resolve_library_source(text(local, "source"), text(remote, "source"))),
    );
    merged.insert(
        "hasActiveSteamImport".into(),
        json!(is_true(remote, "hasActiveSteamImport")),
    );
    let epic_import = present(remote.get("hasActiveEpicImport"))
        .or_else(|| present(local.get("hasActiveEpicImport")))
        .cloned()
        .unwrap_or(json!(false));
    merged.insert("hasActiveEpicImport".into(), epic_import);
    merged.insert(
        "isDeleted".into(),
        json!(resolve_library_is_deleted(
            is_true(local, "isDeleted"),
            text(remote, "source"),
            is_true(remote, "hasActiveSteamImport"),
            is_true(remote, "hasActiveEpicImport"),
        )),
    );
    if can_reconcile_custom_artwork {
        for (local_key, remote_key) in [
            ("customIconUrl", "customIconUrl"),
            ("customLogoImageUrl", "customLogoImageUrl"),
            ("customHeroImageUrl", "customLibraryHeroImageUrl"),
            ("customCoverImageUrl", "customLibraryImageUrl"),
        ] {
            let value = reconcile_custom_asset(local.get(local_key), remote.get(remote_key));
            assign(&mut merged, local_key, value);
        }
    }
    merged
}

/// createLocalGame
fn create_local_game(remote: &Map<String, Value>, collection_ids: Value) -> Map<String, Value> {
    let mut game = Map::new();
    apply_catalogue_metadata(&mut game, None, remote);
    for (key, from) in [
        ("objectId", "objectId"),
        ("title", "title"),
        ("remoteId", "id"),
        ("shop", "shop"),
        ("iconUrl", "iconUrl"),
        ("libraryHeroImageUrl", "libraryHeroImageUrl"),
        ("logoImageUrl", "logoImageUrl"),
    ] {
        assign(&mut game, key, remote.get(from).cloned());
    }
    game.insert("addedToLibraryAt".into(), remote_added_at(remote));
    assign(&mut game, "lastTimePlayed", remote.get("lastTimePlayed").cloned());
    let zero: Map<String, Value> = [("playTimeInMilliseconds".to_string(), json!(0))]
        .into_iter()
        .collect();
    apply_playtime(&mut game, merge_playtime(&zero, remote));
    assign(
        &mut game,
        "hasManuallyUpdatedPlaytime",
        remote.get("hasManuallyUpdatedPlaytime").cloned(),
    );
    game.insert("isDeleted".into(), json!(false));
    let flag = |key: &str| present(remote.get(key)).cloned().unwrap_or(json!(false));
    game.insert("favorite".into(), flag("isFavorite"));
    game.insert("isHiddenFromOthers".into(), flag("isHiddenFromOthers"));
    game.insert("isConcealed".into(), flag("isConcealed"));
    game.insert("isPinned".into(), flag("isPinned"));
    game.insert("collectionIds".into(), collection_ids);
    let shop = text(remote, "shop").unwrap_or_default().to_string();
    apply_achievement_totals(&mut game, &shop, None, remote);
    game.insert(
        "platform".into(),
        present(remote.get("platform")).cloned().unwrap_or(Value::Null),
    );
    game.insert(
        "source".into(),
        json!(resolve_library_source(None, text(remote, "source"))),
    );
    game.insert(
        "hasActiveSteamImport".into(),
        json!(is_true(remote, "hasActiveSteamImport")),
    );
    game.insert(
        "hasActiveEpicImport".into(),
        json!(is_true(remote, "hasActiveEpicImport")),
    );
    for (local_key, remote_key) in [
        ("customIconUrl", "customIconUrl"),
        ("customLogoImageUrl", "customLogoImageUrl"),
        ("customHeroImageUrl", "customLibraryHeroImageUrl"),
        ("customCoverImageUrl", "customLibraryImageUrl"),
    ] {
        game.insert(
            local_key.into(),
            present(remote.get(remote_key)).cloned().unwrap_or(Value::Null),
        );
    }
    game
}

/// buildMergedGame
pub fn build_merged_game(
    remote: &Map<String, Value>,
    local: Option<&Map<String, Value>>,
    can_reconcile_custom_artwork: bool,
) -> Map<String, Value> {
    let has_remote_collections = remote.get("collectionIds").is_some_and(Value::is_array)
        || remote.contains_key("collectionId");
    let ids = if has_remote_collections {
        collection_ids(Some(remote))
    } else {
        collection_ids(local)
    };
    match local {
        Some(local) => merge_existing_game(local, remote, ids, can_reconcile_custom_artwork),
        None => create_local_game(remote, ids),
    }
}

/// getRemoteCoverImageUrl
fn remote_cover_image(remote: &Map<String, Value>) -> Value {
    if let Some(url) = remote
        .get("coverImageUrl")
        .and_then(Value::as_str)
        .filter(|u| !u.is_empty())
    {
        return json!(url);
    }
    let identity = present(remote.get("catalogueGame"))
        .and_then(Value::as_object)
        .unwrap_or(remote);
    if text(identity, "shop") != Some("steam") {
        return Value::Null;
    }
    json!(format!(
        "https://shared.steamstatic.com/store_item_assets/steam/apps/{}/library_600x900_2x.jpg",
        text(identity, "objectId").unwrap_or_default()
    ))
}

/// preserveEpicDefaultArtwork
pub fn preserve_epic_default_artwork(assets: &mut Map<String, Value>, cached: Option<&Map<String, Value>>) {
    if text(assets, "shop") != Some("epic") {
        return;
    }
    let timestamps = cached
        .and_then(|c| c.get("epicArtworkUpdatedAtByType"))
        .filter(|t| t.is_object())
        .cloned();
    let stamp = |key: &str| {
        timestamps
            .as_ref()
            .and_then(|t| t.get(key))
            .is_some_and(|v| v.as_f64().is_some_and(|n| n != 0.0))
    };
    let cached_value = |key: &str| cached.and_then(|c| present(c.get(key))).cloned();
    let icon = if stamp("icon") {
        cached_value("iconUrl").unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    assets.insert("iconUrl".into(), icon);
    if stamp("portrait") {
        for key in ["coverImageUrl", "libraryImageUrl"] {
            let value = cached_value(key).or_else(|| assets.get(key).cloned());
            assign(assets, key, value);
        }
    }
    if stamp("landscape") {
        let value = cached_value("libraryHeroImageUrl").or_else(|| assets.get("libraryHeroImageUrl").cloned());
        assign(assets, "libraryHeroImageUrl", value);
    }
    assign(assets, "epicArtworkUpdatedAtByType", timestamps);
}

/// buildRemoteGameShopAssets
pub fn build_shop_assets(
    remote: &Map<String, Value>,
    local: Option<&Map<String, Value>>,
    local_assets: Option<&Map<String, Value>>,
) -> Map<String, Value> {
    let mut assets = Map::new();
    assets.insert("updatedAt".into(), json!(now_ms()));
    if let Some(local_assets) = local_assets {
        for (key, value) in local_assets {
            assets.insert(key.clone(), value.clone());
        }
    }
    assign(&mut assets, "shop", remote.get("shop").cloned());
    assign(&mut assets, "objectId", remote.get("objectId").cloned());
    let title = if present(remote.get("catalogueGame")).is_some() {
        remote.get("title").cloned()
    } else {
        local
            .and_then(|l| l.get("title"))
            .filter(|t| t.as_str().is_some_and(|s| !s.is_empty()))
            .cloned()
            .or_else(|| remote.get("title").cloned())
    };
    assign(&mut assets, "title", title);
    assets.insert("coverImageUrl".into(), remote_cover_image(remote));
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
    let mut images = local_assets
        .and_then(|a| a.get("images"))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if let Some(remote_images) = remote.get("images").and_then(Value::as_object) {
        for (key, value) in remote_images {
            images.insert(key.clone(), value.clone());
        }
    }
    assets.insert("images".into(), Value::Object(images));
    let catalogue_shop = present(remote.get("catalogueGame"))
        .or_else(|| local.and_then(|l| present(l.get("catalogueGame"))))
        .and_then(|c| c.get("shop"))
        .and_then(Value::as_str);
    if catalogue_shop != Some("steam") {
        preserve_epic_default_artwork(&mut assets, local_assets);
    }
    assets
}

/// The scope a merge stamps on imported Epic games.
#[derive(Clone, Debug)]
pub struct EpicScope {
    pub environment: String,
    pub user_id: String,
}

/// Options of mergeWithRemoteGames.
pub struct MergeOptions<'a> {
    pub can_reconcile_custom_artwork: bool,
    pub context: Option<EpicScope>,
    /// The link the caller already confirmed (else GET /profile/integrations/epic).
    pub epic_connection_id: Option<String>,
    pub current: &'a (dyn Fn() -> bool + Sync),
    pub progress: Option<&'a (dyn Fn(usize, usize) + Sync)>,
    pub api_options: Options,
}

fn as_list(value: Value) -> Vec<Value> {
    match value {
        Value::Array(list) => list,
        _ => Vec::new(),
    }
}

/// fetchRemoteProfileGames: every page of /profile/games and
/// /profile/games/hidden, for PC and classics (launchbox).
pub fn fetch_remote_profile_games(api: &HydraApi, options: Options) -> Result<Vec<Value>, ApiError> {
    let fetch_all = |path: &str, shop: Option<&str>| -> Result<Vec<Value>, ApiError> {
        let page = |index: usize| {
            let mut query: Vec<(&str, String)> = Vec::new();
            if let Some(shop) = shop {
                query.push(("shop", shop.to_string()));
            }
            query.push(("take", PAGE_SIZE.to_string()));
            query.push(("skip", (index * PAGE_SIZE).to_string()));
            api.get(path, &query, options).map(as_list)
        };
        let first = page(0)?;
        if first.len() < PAGE_SIZE {
            return Ok(first);
        }
        let mut all = first;
        let mut next = 1;
        loop {
            let pages: Vec<Result<Vec<Value>, ApiError>> = std::thread::scope(|scope| {
                let handles: Vec<_> = (0..PAGE_FETCH_CONCURRENCY)
                    .map(|offset| {
                        let page = &page;
                        scope.spawn(move || page(next + offset))
                    })
                    .collect();
                handles
                    .into_iter()
                    .map(|h| h.join().unwrap_or_else(|_| Err(ApiError::Network("panic".into()))))
                    .collect()
            });
            let mut short = false;
            for page in pages {
                let page = page?;
                short |= page.len() < PAGE_SIZE;
                all.extend(page);
            }
            if short {
                return Ok(all);
            }
            next += PAGE_FETCH_CONCURRENCY;
        }
    };
    let hidden = |shop: Option<&str>| match fetch_all("/profile/games/hidden", shop) {
        Err(ApiError::Status { status: 404, .. }) => Ok(Vec::new()),
        other => other,
    };
    let (default, classics, hidden_default, hidden_classics) = std::thread::scope(|scope| {
        let a = scope.spawn(|| fetch_all("/profile/games", None));
        let b = scope.spawn(|| fetch_all("/profile/games", Some("launchbox")).unwrap_or_default());
        let c = scope.spawn(|| hidden(None));
        let d = scope.spawn(|| hidden(Some("launchbox")));
        (
            a.join().unwrap_or_else(|_| Err(ApiError::Network("panic".into()))),
            b.join().unwrap_or_default(),
            c.join().unwrap_or_else(|_| Err(ApiError::Network("panic".into()))),
            d.join().unwrap_or_else(|_| Err(ApiError::Network("panic".into()))),
        )
    });
    let mut all = default?;
    all.extend(classics);
    all.extend(hidden_default?);
    all.extend(hidden_classics?);
    Ok(all)
}

fn game_key(game: &Map<String, Value>) -> Option<String> {
    Some(keys::game(text(game, "shop")?, text(game, "objectId")?))
}

/// One merged chunk (mergeRemoteGamesChunk).
fn merge_chunk(db: &Db, remote_games: &[&Map<String, Value>], options: &MergeOptions, epic_connection_id: Option<&str>) {
    for remote in remote_games {
        let Some(key) = game_key(remote) else { continue };
        let local: Option<Map<String, Value>> = db
            .get_in::<Value>(keys::GAMES, &key)
            .and_then(|v| v.as_object().cloned());
        let local_assets: Option<Map<String, Value>> = db
            .get_in::<Value>(keys::GAME_SHOP_ASSETS, &key)
            .and_then(|v| v.as_object().cloned());
        let mut merged = build_merged_game(remote, local.as_ref(), options.can_reconcile_custom_artwork);
        if is_true(remote, "hasActiveEpicImport")
            && let (Some(context), Some(connection_id)) = (&options.context, epic_connection_id)
        {
            merged.insert(
                "epicImportScope".into(),
                json!({
                    "environment": context.environment,
                    "userId": context.user_id,
                    "connectionId": connection_id,
                }),
            );
        } else if remote.get("hasActiveEpicImport") == Some(&json!(false)) {
            merged.remove("epicImportScope");
        }
        let _ = db.put_in(keys::GAMES, &key, &Value::Object(merged));
        let assets = build_shop_assets(remote, local.as_ref(), local_assets.as_ref());
        if let Some(catalogue) = present(remote.get("catalogueGame")).and_then(Value::as_object)
            && let Some(catalogue_key) = game_key(catalogue)
            && catalogue_key != key
        {
            let mut entry = catalogue.clone();
            for field in [
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
                assign(&mut entry, field, assets.get(field).cloned());
            }
            let _ = db.put_in(keys::GAME_SHOP_ASSETS, &catalogue_key, &Value::Object(entry));
        }
        let _ = db.put_in(keys::GAME_SHOP_ASSETS, &key, &Value::Object(assets));
    }
}

/// hasCompletedEpicRemoval
fn has_completed_epic_removal(game: &Map<String, Value>) -> bool {
    is_true(game, "isDeleted")
        && game.get("hasActiveEpicImport") == Some(&json!(false))
        && !game.contains_key("epicImportScope")
        && number(game.get("epicPlayTimeInMilliseconds")) == Some(0.0)
}

/// needsEpicOwnerProbe
fn needs_epic_owner_probe(key: &str, game: &Map<String, Value>, remote_keys: &HashSet<String>) -> bool {
    text(game, "shop") == Some("epic")
        && game
            .get("remoteId")
            .is_some_and(|r| r.as_str().is_some_and(|s| !s.is_empty()))
        && !remote_keys.contains(key)
        && number(game.get("unsyncedDeltaPlayTimeInMilliseconds")).unwrap_or(0.0) <= 0.0
        && !has_completed_epic_removal(game)
}

/// mergeWithRemoteGamesOnce: false when it couldn't finish (the local
/// library stays usable either way).
pub fn merge_with_remote_games(api: &HydraApi, db: &Db, options: &MergeOptions) -> bool {
    let current = options.current;
    if !current() {
        return false;
    }
    let Ok(remote_games) = fetch_remote_profile_games(api, options.api_options) else {
        return false;
    };
    if !current() {
        return false;
    }
    let remote: Vec<Map<String, Value>> = remote_games
        .into_iter()
        .filter_map(|g| match g {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .collect();
    let mut epic_connection_id = options.epic_connection_id.clone();
    if epic_connection_id.is_none() && remote.iter().any(|g| is_true(g, "hasActiveEpicImport")) {
        let Ok(connection) = api.get("/profile/integrations/epic", &[], options.api_options) else {
            return false;
        };
        if connection.get("connected").and_then(Value::as_bool) != Some(true) {
            return false;
        }
        epic_connection_id = connection
            .get("connectionId")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    if !current() {
        return false;
    }
    let remote_keys: HashSet<String> = remote.iter().filter_map(game_key).collect();
    let candidates: Vec<(String, Map<String, Value>)> = db
        .entries::<Value>(keys::GAMES)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(key, game)| {
            let game = game.as_object()?.clone();
            needs_epic_owner_probe(&key, &game, &remote_keys).then_some((key, game))
        })
        .collect();
    let total = remote.len() + candidates.len();
    let mut processed = 0;
    if let Some(progress) = options.progress {
        progress(processed, total);
    }
    for chunk in remote.chunks(250) {
        if !current() {
            return false;
        }
        let refs: Vec<&Map<String, Value>> = chunk.iter().collect();
        merge_chunk(db, &refs, options, epic_connection_id.as_deref());
        processed += chunk.len();
        if let Some(progress) = options.progress {
            progress(processed, total);
        }
    }
    // Keep installations, but hide games removed by destructive Steam cleanup.
    for (key, game) in db.entries::<Value>(keys::GAMES).unwrap_or_default() {
        let Some(mut game) = game.as_object().cloned() else { continue };
        if text(&game, "shop") == Some("steam")
            && is_true(&game, "hasActiveSteamImport")
            && !remote_keys.contains(&key)
        {
            game.insert("hasActiveSteamImport".into(), json!(false));
            game.insert("isDeleted".into(), json!(true));
            let _ = db.put_in(keys::GAMES, &key, &Value::Object(game));
        }
    }
    if !current() {
        return false;
    }
    // reconcileMissingEpicGame: probe imports the full list no longer has.
    for batch in candidates.chunks(TARGETED_MERGE_CONCURRENCY) {
        if !current() {
            return false;
        }
        let results: Vec<bool> = std::thread::scope(|scope| {
            let handles: Vec<_> = batch
                .iter()
                .map(|(key, game)| {
                    let remote_keys = &remote_keys;
                    scope.spawn(move || reconcile_missing_epic_game(api, db, key, game, remote_keys, options))
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap_or(false)).collect()
        });
        if !current() || results.iter().any(|ok| !ok) {
            return false;
        }
        processed += batch.len();
        if let Some(progress) = options.progress {
            progress(processed, total);
        }
    }
    current()
}

fn reconcile_missing_epic_game(
    api: &HydraApi,
    db: &Db,
    key: &str,
    game: &Map<String, Value>,
    remote_keys: &HashSet<String>,
    options: &MergeOptions,
) -> bool {
    let current = options.current;
    let still = |latest: &Option<Map<String, Value>>| {
        latest.as_ref().is_some_and(|l| {
            l.get("remoteId") == game.get("remoteId") && needs_epic_owner_probe(key, l, remote_keys)
        })
    };
    let local = db.get_in::<Value>(keys::GAMES, key).and_then(|v| v.as_object().cloned());
    if !still(&local) {
        return current();
    }
    let object_id = text(game, "objectId").unwrap_or_default();
    let encoded: String = object_id
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    match api.get(&format!("/profile/games/epic/{encoded}"), &[], options.api_options) {
        Err(ApiError::Status { status: 404, .. }) => {
            if !current() {
                return false;
            }
            let latest = db.get_in::<Value>(keys::GAMES, key).and_then(|v| v.as_object().cloned());
            if let Some(mut latest) = latest.filter(|_| still(&db.get_in::<Value>(keys::GAMES, key).and_then(|v| v.as_object().cloned()))) {
                latest.insert("remoteId".into(), Value::Null);
                latest.insert("epicPlayTimeInMilliseconds".into(), json!(0));
                latest.insert("hasActiveEpicImport".into(), json!(false));
                latest.remove("epicImportScope");
                latest.insert("isDeleted".into(), json!(true));
                let _ = db.put_in(keys::GAMES, key, &Value::Object(latest));
            }
            current()
        }
        _ => current(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap()
    }

    #[test]
    fn sources_and_deletion() {
        assert_eq!(resolve_library_source(Some("epic"), Some("hydra")), "hydra");
        assert_eq!(resolve_library_source(Some("epic"), Some("steam")), "steam");
        assert_eq!(resolve_library_source(None, Some("epic")), "epic");
        assert_eq!(resolve_library_source(Some("x"), None), "hydra");
        assert!(!resolve_library_is_deleted(true, Some("epic"), false, false));
        assert!(resolve_library_is_deleted(true, Some("hydra"), false, false));
    }

    #[test]
    fn playtime_parts() {
        let remote = obj(json!({"playTimeInSeconds": 100, "runtimeByPlatform": {"steam": 20, "epic": 30}}));
        assert_eq!(merge_playtime(&Map::new(), &remote), (50_000.0, 20_000.0, 30_000.0));
        // an older API without Epic fields keeps the local Epic time
        let old = obj(json!({"playTimeInSeconds": 100}));
        let local = obj(json!({"playTimeInMilliseconds": 10, "epicPlayTimeInMilliseconds": 40_000}));
        assert_eq!(merge_playtime(&local, &old), (60_000.0, 0.0, 40_000.0));
        let local = obj(json!({"playTimeInMilliseconds": 90_000}));
        assert_eq!(merge_playtime(&local, &old).0, 100_000.0);
    }

    #[test]
    fn creates_and_merges_games() {
        let remote = obj(json!({
            "id": "remote-1", "objectId": "ns:id", "shop": "epic", "title": "Game",
            "source": "epic", "hasActiveEpicImport": true, "playTimeInSeconds": 5,
            "runtimeByPlatform": {"epic": 5}, "lastTimePlayed": "2026-01-02T00:00:00.000Z",
            "createdAt": "2026-01-01T00:00:00.000Z", "achievementCount": 3,
            "collectionIds": ["c1"],
        }));
        let created = build_merged_game(&remote, None, false);
        assert_eq!(created["remoteId"], "remote-1");
        assert_eq!(created["source"], "epic");
        assert_eq!(created["epicPlayTimeInMilliseconds"], 5000);
        assert_eq!(created["playTimeInMilliseconds"], 0);
        assert_eq!(created["isDeleted"], false);
        assert_eq!(created["collectionIds"], json!(["c1"]));
        assert_eq!(created["addedToLibraryAt"], "2026-01-01T00:00:00.000Z");
        let local = obj(json!({
            "objectId": "ns:id", "shop": "epic", "title": "Local", "remoteId": null,
            "source": "hydra", "isDeleted": true, "lastTimePlayed": "2026-03-01T00:00:00.000Z",
            "playTimeInMilliseconds": 1000, "favorite": true, "executablePath": "C:\\g.exe",
            "collectionIds": ["mine"], "customIconUrl": "local:icon.png",
        }));
        let merged = build_merged_game(&remote, Some(&local), true);
        assert_eq!(merged["remoteId"], Value::Null, "a Hydra game keeps its null remote id");
        assert_eq!(merged["source"], "hydra");
        assert_eq!(merged["isDeleted"], false, "an Epic import shows the game");
        assert_eq!(merged["lastTimePlayed"], "2026-03-01T00:00:00.000Z");
        assert_eq!(merged["favorite"], true);
        assert_eq!(merged["executablePath"], "C:\\g.exe");
        assert_eq!(merged["collectionIds"], json!(["c1"]));
        assert_eq!(merged["customIconUrl"], "local:icon.png");
        assert_eq!(merged["title"], "Local");
    }

    #[test]
    fn shop_assets_keep_epic_defaults() {
        let remote = obj(json!({
            "shop": "epic", "objectId": "ns:id", "title": "Game",
            "iconUrl": "https://remote/icon.png", "libraryHeroImageUrl": "https://remote/hero.png",
            "images": {"a": {"thumbHash": "x"}},
        }));
        let cached = obj(json!({
            "shop": "epic", "objectId": "ns:id", "iconUrl": "https://resolved/icon.png",
            "coverImageUrl": "https://resolved/cover.png",
            "epicArtworkUpdatedAtByType": {"icon": 1, "portrait": 2},
            "images": {"b": {}}, "updatedAt": 5,
        }));
        let assets = build_shop_assets(&remote, None, Some(&cached));
        assert_eq!(assets["iconUrl"], "https://resolved/icon.png");
        assert_eq!(assets["coverImageUrl"], "https://resolved/cover.png");
        assert_eq!(assets["libraryHeroImageUrl"], "https://remote/hero.png");
        assert_eq!(assets["updatedAt"], 5);
        assert!(assets["images"].get("a").is_some() && assets["images"].get("b").is_some());
        let fresh = build_shop_assets(&remote, None, None);
        assert_eq!(fresh["iconUrl"], Value::Null, "Epic icons wait for the artwork resolver");
        let steam = obj(json!({"shop": "steam", "objectId": "10", "title": "S"}));
        let assets = build_shop_assets(&steam, None, None);
        assert_eq!(
            assets["coverImageUrl"],
            "https://shared.steamstatic.com/store_item_assets/steam/apps/10/library_600x900_2x.jpg"
        );
    }

    #[test]
    fn epic_owner_probes() {
        let keys: HashSet<String> = HashSet::new();
        let game = obj(json!({"shop": "epic", "remoteId": "r", "isDeleted": false}));
        assert!(needs_epic_owner_probe("epic:x", &game, &keys));
        let removed = obj(json!({
            "shop": "epic", "remoteId": "r", "isDeleted": true,
            "hasActiveEpicImport": false, "epicPlayTimeInMilliseconds": 0,
        }));
        assert!(!needs_epic_owner_probe("epic:x", &removed, &keys));
        assert!(date_ms(Some(&json!("2026-01-01T02:00:00+02:00"))) == date_ms(Some(&json!("2026-01-01T00:00:00.000Z"))));
    }
}
