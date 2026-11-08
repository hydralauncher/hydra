//! The library, as the renderer sees it.
//!
//! Ports, in order of use:
//! - `src/main/events/library/get-library.ts` (`getLibrary`): stored games +
//!   downloads + shop assets + artwork selection -> `LibraryGame`
//! - `src/shared/library-catalogue.ts` (`groupLibraryGames`): Steam/Epic
//!   copies of one catalogue game shown as one row
//! - `src/renderer/src/helpers.ts` (`sortLibraryGames`)
//! - `src/renderer/src/pages/library/library-category.ts` (filters)
//!
//! Games stay JSON objects (like in the renderer), so fields this module
//! doesn't know about survive untouched; typed accessors cover what the UI reads.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use hydra_db::{Db, keys};
use serde_json::{Map, Value};

pub type Obj = Map<String, Value>;

/// One library row (`LibraryGame` in `src/types`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LibraryGame(pub Obj);

/// A grouped row (`LibraryGamePresentation`): the projected game plus its members.
#[derive(Clone, Debug, PartialEq)]
pub struct Presentation {
    pub game: LibraryGame,
    pub members: Vec<LibraryGame>,
    /// Index into `members`.
    pub operational: usize,
    pub catalogue_shop: String,
    pub catalogue_object_id: String,
}

impl LibraryGame {
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.0.get(key).filter(|v| !v.is_null())
    }
    pub fn str(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(Value::as_str)
    }
    /// JS truthiness for the boolean-ish fields Hydra stores.
    pub fn flag(&self, key: &str) -> bool {
        truthy(self.0.get(key))
    }
    pub fn number(&self, key: &str) -> Option<f64> {
        self.get(key).and_then(Value::as_f64)
    }

    pub fn id(&self) -> &str {
        self.str("id").unwrap_or_default()
    }
    pub fn shop(&self) -> &str {
        self.str("shop").unwrap_or_default()
    }
    pub fn object_id(&self) -> &str {
        self.str("objectId").unwrap_or_default()
    }
    pub fn title(&self) -> &str {
        self.str("title").unwrap_or_default()
    }
    pub fn identity_key(&self) -> String {
        format!("{}:{}", self.shop(), self.object_id())
    }
    /// `getGameCatalogueIdentity`.
    pub fn catalogue_identity(&self) -> (String, String) {
        match self.get("catalogueGame").and_then(Value::as_object) {
            Some(catalogue) => (
                catalogue.get("shop").and_then(Value::as_str).unwrap_or_default().to_string(),
                catalogue
                    .get("objectId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            ),
            None => (self.shop().to_string(), self.object_id().to_string()),
        }
    }
    pub fn download(&self) -> Option<&Obj> {
        self.get("download").and_then(Value::as_object)
    }
    pub fn download_status(&self) -> Option<&str> {
        self.download().and_then(|d| d.get("status")).and_then(Value::as_str)
    }
    pub fn download_queued(&self) -> bool {
        self.download().is_some_and(|d| truthy(d.get("queued")))
    }
    pub fn executable_path(&self) -> Option<&str> {
        self.str("executablePath").filter(|s| !s.is_empty())
    }
    /// `getDisplayedPlayTimeInMilliseconds` (shared/playtime.ts).
    pub fn displayed_play_time(&self) -> f64 {
        ["playTimeInMilliseconds", "steamPlayTimeInMilliseconds", "epicPlayTimeInMilliseconds"]
            .iter()
            .map(|k| self.number(k).unwrap_or(0.0).max(0.0))
            .sum()
    }
    /// `isGameInstalled` (helpers.ts).
    pub fn is_installed(&self) -> bool {
        self.executable_path().is_some()
            || self.get("installedSizeInBytes").is_some()
            || (self.shop() == "launchbox" && self.discs_len() > 0)
    }
    /// `isGamePlayable` (sidebar.tsx).
    pub fn is_playable(&self) -> bool {
        self.executable_path().is_some() || (self.shop() == "launchbox" && self.discs_len() > 0)
    }
    fn discs_len(&self) -> usize {
        self.get("discs").and_then(Value::as_array).map_or(0, Vec::len)
    }
    /// `getLibraryCollectionIds`.
    pub fn collection_ids(&self) -> Vec<String> {
        if let Some(ids) = self.0.get("collectionIds").and_then(Value::as_array) {
            return ids.iter().filter_map(|v| v.as_str().map(str::to_string)).collect();
        }
        self.str("collectionId").map(|id| vec![id.to_string()]).unwrap_or_default()
    }

    fn set(&mut self, key: &str, value: Value) {
        self.0.insert(key.to_string(), value);
    }
    /// `{ key: value }` in a spread where `undefined` drops the key in the IPC JSON.
    fn set_opt(&mut self, key: &str, value: Option<Value>) {
        match value {
            Some(value) => {
                self.0.insert(key.to_string(), value);
            }
            None => {
                self.0.remove(key);
            }
        }
    }
}

fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `HydraApi.getAuthContext()`: who the Epic imports in this database belong to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthContext {
    pub environment: String,
    pub user_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Collection {
    Visible,
    Hidden,
    All,
}

/// `belongsToLibraryCollection` (library-sync/game-visibility.ts).
fn belongs_to(game: &Obj, collection: Collection) -> bool {
    !truthy(game.get("isDeleted"))
        && match collection {
            Collection::All => true,
            Collection::Hidden => truthy(game.get("isConcealed")),
            Collection::Visible => !truthy(game.get("isConcealed")),
        }
}

/// `getContextualEpicGame` (epic/import-visibility.ts).
fn contextual_epic_game(mut game: Obj, context: Option<&AuthContext>) -> Obj {
    let has_epic = truthy(game.get("hasActiveEpicImport"))
        || truthy(game.get("epicPlayTimeInMilliseconds"))
        || truthy(game.get("epicImportScope"))
        || game.get("source").and_then(Value::as_str) == Some("epic");
    if !has_epic {
        return game;
    }
    let scope = game.get("epicImportScope").and_then(Value::as_object);
    if let (Some(context), Some(scope)) = (context, scope)
        && scope.get("environment").and_then(Value::as_str) == Some(context.environment.as_str())
        && scope.get("userId").and_then(Value::as_str) == Some(context.user_id.as_str())
    {
        return game;
    }
    game.insert("hasActiveEpicImport".into(), Value::Bool(false));
    game.insert("epicPlayTimeInMilliseconds".into(), Value::from(0));
    game.remove("epicImportScope");
    if game.get("source").and_then(Value::as_str) == Some("epic") {
        game.insert("isDeleted".into(), Value::Bool(true));
    }
    game
}

/// `composeAssetsWithArtwork` (shared/artwork-resolver.ts).
fn compose_assets_with_artwork(assets: Option<Obj>, selection: Option<&Obj>) -> Option<Obj> {
    let mut assets = assets?;
    let Some(selected) = selection.and_then(|s| s.get("selected")).and_then(Value::as_object) else {
        return Some(assets);
    };
    let pick = |kind: &str| {
        selected
            .get(kind)
            .and_then(Value::as_object)
            .and_then(|o| o.get("url"))
            .filter(|v| !v.is_null())
            .cloned()
    };
    for (kind, field) in [
        ("icon", "iconUrl"),
        ("logo", "logoImageUrl"),
        ("hero", "libraryHeroImageUrl"),
        ("grid", "coverImageUrl"),
    ] {
        if let Some(url) = pick(kind) {
            assets.insert(field.into(), url);
        }
    }
    assets.insert(
        "selectedArtworkTypes".into(),
        Value::Array(selected.keys().cloned().map(Value::String).collect()),
    );
    Some(assets)
}

/// `getLibrary(collection)`: the IPC result the renderer builds everything from.
pub fn load_library(
    db: &Db,
    collection: Collection,
    auth: Option<&AuthContext>,
) -> Result<Vec<LibraryGame>, hydra_db::Error> {
    let stored: Vec<(String, Obj)> = db.entries(keys::GAMES)?;
    let entries: Vec<(String, Obj)> = stored
        .into_iter()
        .filter(|(_, game)| belongs_to(game, collection))
        .map(|(key, game)| (key, contextual_epic_game(game, auth)))
        .filter(|(_, game)| !truthy(game.get("isDeleted")))
        .collect();

    // One scan per sublevel (like the batched getMany in get-library.ts):
    // point lookups in LevelDB cost far more than a sequential read.
    let downloads: HashMap<String, Obj> = db.entries(keys::DOWNLOADS)?.into_iter().collect();
    let assets: HashMap<String, Obj> = db.entries(keys::GAME_SHOP_ASSETS)?.into_iter().collect();
    let selections: HashMap<String, Obj> = db.entries(keys::ARTWORK_SELECTION)?.into_iter().collect();

    let mut shop_cache_platforms: Option<HashMap<String, String>> = None;
    let mut library = Vec::with_capacity(entries.len());
    for (key, game) in entries {
        let catalogue_key = match game.get("catalogueGame").and_then(Value::as_object) {
            Some(c) => keys::game(
                c.get("shop").and_then(Value::as_str).unwrap_or_default(),
                c.get("objectId").and_then(Value::as_str).unwrap_or_default(),
            ),
            None => key.clone(),
        };
        let download: Option<Obj> = downloads.get(&key).cloned();
        let shop_assets: Option<Obj> = assets.get(&catalogue_key).cloned();
        let selection: Option<Obj> = selections.get(&key).cloned();

        let shop = game.get("shop").and_then(Value::as_str).unwrap_or_default().to_string();
        let catalogue_is_steam = game
            .get("catalogueGame")
            .and_then(|c| c.get("shop"))
            .and_then(Value::as_str)
            == Some("steam");
        let epic_without_icon = shop == "epic"
            && !catalogue_is_steam
            && shop_assets.as_ref().is_some_and(|a| {
                !truthy(
                    a.get("epicArtworkUpdatedAtByType")
                        .and_then(|t| t.get("icon")),
                )
            });
        let shop_assets = shop_assets.map(|mut assets| {
            if epic_without_icon {
                assets.insert("iconUrl".into(), Value::Null);
            }
            assets
        });
        let composed = compose_assets_with_artwork(shop_assets, selection.as_ref());

        let installer_size = resolve_installer_size(&game, download.as_ref());
        let mut installed_size = game.get("installedSizeInBytes").filter(|v| !v.is_null()).cloned();
        if installed_size.as_ref().is_some_and(truthy_value)
            && let Some(exe) = game.get("executablePath").and_then(Value::as_str)
            && let Some(dir) = Path::new(exe).parent()
            && !dir.exists()
        {
            installed_size = None;
        }

        let mut platform = game.get("platform").filter(|v| !v.is_null()).cloned();
        if shop == "launchbox" && platform.is_none() {
            let cache = shop_cache_platforms.get_or_insert_with(|| platforms_from_shop_cache(db));
            if let Some(found) = cache.get(&key) {
                platform = Some(Value::String(found.clone()));
            }
        }

        let mut row = LibraryGame(Obj::new());
        row.set("id", Value::String(key.clone()));
        for (k, v) in &game {
            row.set(k, v.clone());
        }
        row.set_opt("installerSizeInBytes", installer_size);
        row.set_opt("installedSizeInBytes", installed_size.or(Some(Value::Null)));
        row.set("download", download.map(Value::Object).unwrap_or(Value::Null));
        if let Some(assets) = &composed {
            for (k, v) in assets {
                row.set(k, v.clone());
            }
        }
        row.set("shop", game.get("shop").cloned().unwrap_or(Value::Null));
        row.set("objectId", game.get("objectId").cloned().unwrap_or(Value::Null));
        row.set_opt("unlockedAchievementCount", game.get("unlockedAchievementCount").cloned());
        row.set_opt("achievementCount", game.get("achievementCount").cloned());
        if shop == "epic" && !catalogue_is_steam {
            row.set(
                "iconUrl",
                composed
                    .as_ref()
                    .and_then(|a| a.get("iconUrl"))
                    .cloned()
                    .unwrap_or(Value::Null),
            );
        }
        let composed_title = composed
            .as_ref()
            .and_then(|a| a.get("title"))
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty());
        row.set(
            "title",
            composed_title
                .map(|t| Value::String(t.to_string()))
                .or_else(|| game.get("title").cloned())
                .unwrap_or(Value::Null),
        );
        row.set("platform", platform.unwrap_or(Value::Null));
        for field in [
            "customIconUrl",
            "customLogoImageUrl",
            "customHeroImageUrl",
            "customCoverImageUrl",
        ] {
            row.set_opt(field, game.get(field).cloned());
        }
        library.push(row);
    }
    Ok(library)
}

fn truthy_value(value: &Value) -> bool {
    truthy(Some(value))
}

/// Clears the installer size when the installer was deleted outside Hydra.
fn resolve_installer_size(game: &Obj, download: Option<&Obj>) -> Option<Value> {
    let size = game.get("installerSizeInBytes").cloned();
    let (Some(size_value), Some(download)) = (size.as_ref(), download) else {
        return size;
    };
    if !truthy_value(size_value) {
        return size;
    }
    let folder = download.get("folderName").and_then(Value::as_str).filter(|f| !f.is_empty());
    let base = download.get("downloadPath").and_then(Value::as_str);
    match (folder, base) {
        (Some(folder), Some(base)) if !Path::new(base).join(folder).exists() => Some(Value::Null),
        _ => size,
    }
}

/// `lookupCachedPlatform`: the first cached shop details with a platform, per game key.
fn platforms_from_shop_cache(db: &Db) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if let Ok(entries) = db.entries::<Obj>(keys::GAME_SHOP_CACHE) {
        for (key, value) in entries {
            let Some(platform) = value.get("platform").and_then(Value::as_str) else {
                continue;
            };
            // `${shop}:${objectId}:${language}`
            if let Some((game_key, _language)) = key.rsplit_once(':') {
                out.entry(game_key.to_string()).or_insert_with(|| platform.to_string());
            }
        }
    }
    out
}

fn store_priority(shop: &str) -> u8 {
    if shop == "steam" { 0 } else { 1 }
}

/// `selectOperationalLibraryGame`: running first, then installed, then Steam.
fn select_operational(games: &[LibraryGame], running: &HashSet<String>) -> usize {
    let mut order: Vec<usize> = (0..games.len()).collect();
    order.sort_by(|&a, &b| {
        let (a, b) = (&games[a], &games[b]);
        let is_running = |g: &LibraryGame| running.contains(g.id()) || running.contains(&g.identity_key());
        is_running(b)
            .cmp(&is_running(a))
            .then(b.executable_path().is_some().cmp(&a.executable_path().is_some()))
            .then(store_priority(a.shop()).cmp(&store_priority(b.shop())))
            .then(a.identity_key().cmp(&b.identity_key()))
    });
    order[0]
}

/// `isLibraryGameDownloading`.
pub fn is_downloading(game: &LibraryGame) -> bool {
    matches!(game.download_status(), Some("active" | "extracting"))
        || game.download().is_some_and(|d| d.get("extracting") == Some(&Value::Bool(true)))
}

fn download_priority(game: &LibraryGame) -> u8 {
    if is_downloading(game) {
        3
    } else if game.download_queued() || game.download_status() == Some("waiting") {
        2
    } else if matches!(game.download_status(), Some("paused" | "error")) {
        1
    } else {
        0
    }
}

/// `selectDownloadLibraryGame`.
fn select_download(games: &[LibraryGame], operational: &LibraryGame) -> LibraryGame {
    let mut candidates: Vec<&LibraryGame> = games.iter().filter(|g| download_priority(g) > 0).collect();
    let operational_key = operational.identity_key();
    candidates.sort_by(|a, b| {
        download_priority(b)
            .cmp(&download_priority(a))
            .then((b.identity_key() == operational_key).cmp(&(a.identity_key() == operational_key)))
            .then(store_priority(a.shop()).cmp(&store_priority(b.shop())))
            .then(a.identity_key().cmp(&b.identity_key()))
    });
    candidates.first().map(|g| (*g).clone()).unwrap_or_else(|| operational.clone())
}

/// Latest/earliest of ISO date strings, ignoring invalid ones (`latestDate`, `earliestDate`).
fn pick_date<'a>(values: impl Iterator<Item = Option<&'a Value>>, latest: bool) -> Value {
    let mut best: Option<(i64, &Value)> = None;
    for value in values.flatten() {
        let Some(ms) = value.as_str().and_then(parse_iso_millis) else { continue };
        let better = match best {
            None => true,
            Some((current, _)) => if latest { ms > current } else { ms < current },
        };
        if better {
            best = Some((ms, value));
        }
    }
    best.map(|(_, v)| v.clone()).unwrap_or(Value::Null)
}

/// Milliseconds since the epoch for the ISO-8601 strings JSON.stringify(Date) writes.
pub fn parse_iso_millis(text: &str) -> Option<i64> {
    // YYYY-MM-DDTHH:MM:SS(.sss)?Z
    let bytes = text.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let num = |range: std::ops::Range<usize>| text.get(range)?.parse::<i64>().ok();
    let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hour, minute, second) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let mut millis = 0;
    if bytes.get(19) == Some(&b'.') {
        let digits: String = text[20..].chars().take_while(|c| c.is_ascii_digit()).collect();
        let padded = format!("{digits:0<3}");
        millis = padded[..3].parse::<i64>().ok()?;
    }
    // Days from civil (Howard Hinnant's algorithm).
    let (y, m) = if month <= 2 { (year - 1, month + 9) } else { (year, month - 3) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000 + millis)
}

fn project_group(members: Vec<LibraryGame>, running: &HashSet<String>) -> Presentation {
    let operational_index = select_operational(&members, running);
    let operational = members[operational_index].clone();
    let candidates: Vec<(String, String)> = members.iter().map(LibraryGame::catalogue_identity).collect();
    let catalogue = candidates
        .iter()
        .find(|(shop, _)| shop == "steam")
        .unwrap_or(&candidates[0])
        .clone();
    let catalogue_key = format!("{}:{}", catalogue.0, catalogue.1);
    let presentation = members
        .iter()
        .find(|m| m.identity_key() == catalogue_key)
        .or_else(|| {
            members.iter().find(|m| {
                let (s, o) = m.catalogue_identity();
                format!("{s}:{o}") == catalogue_key
            })
        })
        .unwrap_or(&operational)
        .clone();

    let mut shops: Vec<String> = Vec::new();
    for member in &members {
        let list: Vec<String> = match member.get("availableShops").and_then(Value::as_array) {
            Some(list) => list.iter().filter_map(|v| v.as_str().map(str::to_string)).collect(),
            None => vec![member.shop().to_string()],
        };
        for shop in list {
            if !shops.contains(&shop) {
                shops.push(shop);
            }
        }
    }
    shops.sort_by_key(|s| store_priority(s));

    let mut game = operational.clone();
    let canonical = presentation
        .get("canonicalId")
        .cloned()
        .or_else(|| members.iter().find_map(|m| m.get("canonicalId").cloned()));
    game.set_opt("canonicalId", canonical);
    for field in [
        "title",
        "iconUrl",
        "logoImageUrl",
        "libraryHeroImageUrl",
        "libraryImageUrl",
        "coverImageUrl",
        "logoPosition",
        "downloadSources",
        "selectedArtworkTypes",
        "images",
    ] {
        game.set_opt(field, presentation.0.get(field).cloned());
    }
    game.set_opt("achievementCount", operational.0.get("achievementCount").cloned());
    game.set_opt(
        "unlockedAchievementCount",
        operational.0.get("unlockedAchievementCount").cloned(),
    );
    let custom_candidates: Vec<&LibraryGame> =
        std::iter::once(&operational).chain(std::iter::once(&presentation)).chain(members.iter()).collect();
    for field in [
        "customIconUrl",
        "customLogoImageUrl",
        "customHeroImageUrl",
        "customCoverImageUrl",
    ] {
        let value = custom_candidates
            .iter()
            .find(|m| m.flag(field))
            .and_then(|m| m.get(field).cloned())
            .unwrap_or(Value::Null);
        game.set(field, value);
    }
    let download_game = select_download(&members, &operational);
    game.set("downloadGameId", Value::String(download_game.id().to_string()));
    let mut catalogue_obj = Obj::new();
    catalogue_obj.insert("shop".into(), Value::String(catalogue.0.clone()));
    catalogue_obj.insert("objectId".into(), Value::String(catalogue.1.clone()));
    game.set("catalogueGame", Value::Object(catalogue_obj));
    game.set("availableShops", Value::Array(shops.into_iter().map(Value::String).collect()));
    for field in [
        "playTimeInMilliseconds",
        "steamPlayTimeInMilliseconds",
        "epicPlayTimeInMilliseconds",
    ] {
        let total: f64 = members.iter().map(|m| m.number(field).unwrap_or(0.0).max(0.0)).sum();
        game.set(field, Value::from(total));
    }
    let any = |field: &str| Value::Bool(members.iter().any(|m| m.flag(field)));
    for field in [
        "hasActiveSteamImport",
        "hasActiveEpicImport",
        "favorite",
        "isPinned",
        "isHiddenFromOthers",
    ] {
        game.set(field, any(field));
    }
    game.set("isConcealed", Value::Bool(members.iter().all(|m| m.flag("isConcealed"))));
    game.set("pinnedDate", pick_date(members.iter().map(|m| m.0.get("pinnedDate")), true));
    let mut collection_ids: Vec<String> = Vec::new();
    for member in &members {
        for id in member.collection_ids() {
            if !collection_ids.contains(&id) {
                collection_ids.push(id);
            }
        }
    }
    game.set(
        "collectionIds",
        Value::Array(collection_ids.into_iter().map(Value::String).collect()),
    );
    game.set("lastTimePlayed", pick_date(members.iter().map(|m| m.0.get("lastTimePlayed")), true));
    game.set(
        "addedToLibraryAt",
        pick_date(members.iter().map(|m| m.0.get("addedToLibraryAt")), false),
    );

    Presentation {
        game,
        members,
        operational: operational_index,
        catalogue_shop: catalogue.0,
        catalogue_object_id: catalogue.1,
    }
}

/// `groupLibraryGames`: only confirmed catalogue links merge rows.
pub fn group_library_games(games: &[LibraryGame], running_ids: &[String]) -> Vec<Presentation> {
    let running: HashSet<String> = running_ids.iter().cloned().collect();
    let mut confirmed: HashMap<String, HashSet<String>> = HashMap::new();
    for game in games {
        let Some(canonical) = game.str("canonicalId").filter(|c| !c.is_empty()) else { continue };
        if game.flag("isDeleted") || !matches!(game.shop(), "steam" | "epic") {
            continue;
        }
        let (shop, object) = game.catalogue_identity();
        confirmed
            .entry(format!("{shop}:{object}"))
            .or_default()
            .insert(canonical.to_string());
    }
    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, Vec<LibraryGame>> = HashMap::new();
    let mut seen = HashSet::new();
    for game in games {
        let identity = game.identity_key();
        if game.flag("isDeleted") || !seen.insert(identity.clone()) {
            continue;
        }
        let canonical = game
            .str("canonicalId")
            .filter(|c| !c.is_empty())
            .map(str::to_string)
            .or_else(|| {
                confirmed
                    .get(&identity)
                    .filter(|set| set.len() == 1)
                    .and_then(|set| set.iter().next().cloned())
            });
        let key = match (matches!(game.shop(), "steam" | "epic"), canonical) {
            (true, Some(canonical)) => format!("catalogue:{canonical}"),
            _ => identity,
        };
        if !groups.contains_key(&key) {
            order.push(key.clone());
        }
        groups.entry(key).or_default().push(game.clone());
    }
    order
        .into_iter()
        .filter_map(|key| groups.remove(&key))
        .map(|members| project_group(members, &running))
        .collect()
}

/// Sort options of the library display menu and the sidebar filter menu.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SortBy {
    TitleAsc,
    TitleDesc,
    RecentlyPlayed,
    MostPlayed,
    Achievements,
    InstalledFirst,
}

impl SortBy {
    pub fn parse(value: &str) -> Self {
        match value {
            "title_desc" => SortBy::TitleDesc,
            "recently_played" => SortBy::RecentlyPlayed,
            "most_played" => SortBy::MostPlayed,
            "achievements" => SortBy::Achievements,
            "installed_first" => SortBy::InstalledFirst,
            _ => SortBy::TitleAsc,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            SortBy::TitleAsc => "title_asc",
            SortBy::TitleDesc => "title_desc",
            SortBy::RecentlyPlayed => "recently_played",
            SortBy::MostPlayed => "most_played",
            SortBy::Achievements => "achievements",
            SortBy::InstalledFirst => "installed_first",
        }
    }
}

fn title_collator() -> &'static icu_collator::CollatorBorrowed<'static> {
    use std::sync::OnceLock;
    static COLLATOR: OnceLock<icu_collator::CollatorBorrowed<'static>> = OnceLock::new();
    COLLATOR.get_or_init(|| {
        let mut options = icu_collator::options::CollatorOptions::default();
        // sensitivity: "base" = primary strength (ignore case and accents).
        options.strength = Some(icu_collator::options::Strength::Primary);
        icu_collator::Collator::try_new(Default::default(), options)
            .expect("root collation data is compiled in")
    })
}

/// `Intl.Collator(undefined, { sensitivity: "base" }).compare`.
pub fn compare_titles(a: &str, b: &str) -> Ordering {
    title_collator().compare(a, b)
}

/// `sortLibraryGames`.
pub fn sort_games(games: &mut [Presentation], sort_by: SortBy) {
    games.sort_by(|a, b| {
        let (a, b) = (&a.game, &b.game);
        let first = match sort_by {
            SortBy::RecentlyPlayed => recently_played(a, b),
            SortBy::MostPlayed => Some(
                b.displayed_play_time()
                    .partial_cmp(&a.displayed_play_time())
                    .unwrap_or(Ordering::Equal),
            ),
            SortBy::Achievements => Some(achievement_rate(a, b)),
            SortBy::InstalledFirst => Some(b.is_installed().cmp(&a.is_installed())),
            SortBy::TitleDesc => return compare_titles(b.title(), a.title()),
            SortBy::TitleAsc => Some(Ordering::Equal),
        };
        match first {
            // JS comparators returning NaN count as "equal" with no title fallback.
            None => Ordering::Equal,
            Some(Ordering::Equal) => compare_titles(a.title(), b.title()),
            Some(order) => order,
        }
    });
}

/// `getPlayTimeDifference`; `None` where the JS comparator returns NaN.
fn recently_played(a: &LibraryGame, b: &LibraryGame) -> Option<Ordering> {
    // `lastTimePlayed !== null`: an absent field counts as played (and NaN).
    let played = |g: &LibraryGame| g.0.get("lastTimePlayed") != Some(&Value::Null);
    let (a_played, b_played) = (played(a), played(b));
    if a_played && b_played {
        let time = |g: &LibraryGame| g.str("lastTimePlayed").and_then(parse_iso_millis);
        return match (time(a), time(b)) {
            (Some(a), Some(b)) => Some(b.cmp(&a)),
            _ => None,
        };
    }
    Some(b_played.cmp(&a_played))
}

/// `getAchievementRateDifference`.
fn achievement_rate(a: &LibraryGame, b: &LibraryGame) -> Ordering {
    let a_total = a.number("achievementCount").unwrap_or(0.0);
    let b_total = b.number("achievementCount").unwrap_or(0.0);
    if a_total == 0.0 || b_total == 0.0 {
        if a_total == b_total {
            return Ordering::Equal;
        }
        return if a_total == 0.0 { Ordering::Greater } else { Ordering::Less };
    }
    let a_unlocked = a.number("unlockedAchievementCount").unwrap_or(0.0);
    let b_unlocked = b.number("unlockedAchievementCount").unwrap_or(0.0);
    let rate = b_unlocked * a_total - a_unlocked * b_total;
    if rate != 0.0 {
        return if rate > 0.0 { Ordering::Greater } else { Ordering::Less };
    }
    (b_unlocked - a_unlocked).partial_cmp(&0.0).unwrap_or(Ordering::Equal)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
    All,
    Pc,
    Classics,
}

impl Category {
    pub fn parse(value: &str) -> Self {
        match value {
            "pc" | "steam_library" => Category::Pc,
            "classics" => Category::Classics,
            _ => Category::All,
        }
    }
    pub fn shows_sources(self) -> bool {
        matches!(self, Category::All | Category::Pc)
    }
    pub fn shows_platforms(self) -> bool {
        matches!(self, Category::All | Category::Classics)
    }
}

/// `getLibraryGameSource`.
pub fn game_source(game: &LibraryGame) -> &'static str {
    if game.shop() == "epic" && game.flag("hasActiveEpicImport") {
        "epic"
    } else if game.0.get("hasActiveSteamImport") == Some(&Value::Bool(true)) {
        "steam"
    } else {
        "hydra"
    }
}

/// `filterLibraryGames`.
pub fn filter_games<'a>(
    games: &'a [Presentation],
    category: Category,
    sources: &[String],
    platforms: &[String],
) -> Vec<&'a Presentation> {
    let classics = |p: &Presentation| p.game.shop() == "launchbox";
    let in_category: Vec<&Presentation> = games
        .iter()
        .filter(|p| match category {
            Category::Pc => !classics(p),
            Category::Classics => classics(p),
            Category::All => true,
        })
        .collect();
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
    if sources.is_empty() && platforms.is_empty() {
        return in_category;
    }
    in_category
        .into_iter()
        .filter(|p| {
            if classics(p) {
                return platforms.is_empty()
                    || p.game.str("platform").is_some_and(|pl| platforms.contains(pl));
            }
            sources.is_empty() || p.members.iter().any(|m| sources.contains(game_source(m)))
        })
        .collect()
}

/// `getAvailableLibrarySources` and `hasImportedLibraryGames`.
pub fn available_sources(games: &[Presentation]) -> (Vec<&'static str>, bool) {
    let mut set = HashSet::from(["hydra"]);
    let mut imported = false;
    for group in games {
        for member in &group.members {
            set.insert(game_source(member));
            if member.0.get("hasActiveSteamImport") == Some(&Value::Bool(true))
                || (member.shop() == "epic" && member.flag("hasActiveEpicImport"))
            {
                imported = true;
            }
        }
    }
    (
        ["hydra", "steam", "epic"].into_iter().filter(|s| set.contains(s)).collect(),
        imported,
    )
}

/// `getLibraryPresentationBadgeSource`.
pub fn badge_source(group: &Presentation) -> Option<&'static str> {
    let active: Vec<&LibraryGame> = group.members.iter().filter(|m| !m.flag("isDeleted")).collect();
    if active.iter().any(|m| m.0.get("hasActiveSteamImport") == Some(&Value::Bool(true))) {
        Some("steam")
    } else if active.iter().any(|m| m.0.get("hasActiveEpicImport") == Some(&Value::Bool(true))) {
        Some("epic")
    } else {
        None
    }
}

/// `removeDiacritics(title).toLowerCase()` for the sidebar filter.
pub fn search_key(text: &str) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        let base = fold_diacritic(ch);
        let _ = write!(out, "{}", base.to_lowercase());
    }
    out
}

/// Latin letters with diacritics -> base letter (`shared/char-map.ts` covers the same set).
fn fold_diacritic(ch: char) -> char {
    const MAP: &[(&str, char)] = &[
        ("ÀÁÂÃÄÅĀĂĄǍǺ", 'A'),
        ("àáâãäåāăąǎǻª", 'a'),
        ("ÇĆĈĊČ", 'C'),
        ("çćĉċč", 'c'),
        ("ÐĎĐ", 'D'),
        ("ðďđ", 'd'),
        ("ÈÉÊËĒĔĖĘĚ", 'E'),
        ("èéêëēĕėęě", 'e'),
        ("ĜĞĠĢ", 'G'),
        ("ĝğġģ", 'g'),
        ("ĤĦ", 'H'),
        ("ĥħ", 'h'),
        ("ÌÍÎÏĨĪĬĮİǏ", 'I'),
        ("ìíîïĩīĭįıǐ", 'i'),
        ("Ĵ", 'J'),
        ("ĵ", 'j'),
        ("Ķ", 'K'),
        ("ķ", 'k'),
        ("ĹĻĽĿŁ", 'L'),
        ("ĺļľŀł", 'l'),
        ("ÑŃŅŇ", 'N'),
        ("ñńņňŉ", 'n'),
        ("ÒÓÔÕÖØŌŎŐƠǑǾ", 'O'),
        ("òóôõöøōŏőơǒǿº", 'o'),
        ("ŔŖŘ", 'R'),
        ("ŕŗř", 'r'),
        ("ŚŜŞŠ", 'S'),
        ("śŝşšſ", 's'),
        ("ŢŤŦ", 'T'),
        ("ţťŧ", 't'),
        ("ÙÚÛÜŨŪŬŮŰŲƯǓǕǗǙǛ", 'U'),
        ("ùúûüũūŭůűųưǔǖǘǚǜ", 'u'),
        ("ÝŸŶ", 'Y'),
        ("ýÿŷ", 'y'),
        ("Ŵ", 'W'),
        ("ŵ", 'w'),
        ("ŹŻŽ", 'Z'),
        ("źżž", 'z'),
    ];
    if ch.is_ascii() {
        return ch;
    }
    for (set, base) in MAP {
        if set.contains(ch) {
            return *base;
        }
    }
    ch
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn game(value: Value) -> LibraryGame {
        LibraryGame(value.as_object().unwrap().clone())
    }

    #[test]
    fn iso_dates() {
        assert_eq!(parse_iso_millis("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_iso_millis("2024-03-01T12:30:15.250Z"), Some(1_709_296_215_250));
    }

    #[test]
    fn groups_confirmed_steam_and_epic_copies() {
        let games = vec![
            game(json!({ "id": "steam:1", "shop": "steam", "objectId": "1", "title": "Game", "canonicalId": "c1", "favorite": true })),
            game(json!({ "id": "epic:a", "shop": "epic", "objectId": "a", "title": "Game (Epic)", "canonicalId": "c1", "executablePath": "C:/g.exe", "catalogueGame": { "shop": "steam", "objectId": "1" } })),
            game(json!({ "id": "custom:x", "shop": "custom", "objectId": "x", "title": "Mine" })),
        ];
        let groups = group_library_games(&games, &[]);
        assert_eq!(groups.len(), 2);
        let merged = &groups[0];
        assert_eq!(merged.members.len(), 2);
        // Installed copy is the operational one; title and catalogue come from Steam.
        assert_eq!(merged.members[merged.operational].id(), "epic:a");
        assert_eq!(merged.game.title(), "Game");
        assert_eq!(merged.catalogue_shop, "steam");
        assert!(merged.game.flag("favorite"));
    }

    #[test]
    fn sorts_titles_like_intl_collator() {
        let mut groups = group_library_games(
            &[
                game(json!({ "id": "steam:2", "shop": "steam", "objectId": "2", "title": "zeta" })),
                game(json!({ "id": "steam:3", "shop": "steam", "objectId": "3", "title": "Élan" })),
                game(json!({ "id": "steam:1", "shop": "steam", "objectId": "1", "title": "Alpha" })),
                game(json!({ "id": "steam:4", "shop": "steam", "objectId": "4", "title": "#BLUD" })),
            ],
            &[],
        );
        sort_games(&mut groups, SortBy::TitleAsc);
        let titles: Vec<&str> = groups.iter().map(|g| g.game.title()).collect();
        assert_eq!(titles, ["#BLUD", "Alpha", "Élan", "zeta"]);
    }

    #[test]
    fn diacritics_fold_for_search() {
        assert_eq!(search_key("Pokémon ÉLAN"), "pokemon elan");
    }
}
