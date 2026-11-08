//! Library writes behind the renderer's game actions:
//! src/main/events/library/{add-game-to-favorites, remove-game-from-favorites,
//! toggle-game-pin, set-game-visibility, assign-game-to-collection}.ts,
//! services/game-record-updater(-core).ts and library-sync/create-game.ts.
//!
//! Every local write goes through one lock (`libraryWriteQueue`) and reads
//! the record again before patching it, so concurrent actions never lose
//! each other's fields.

use std::sync::Mutex;

use hydra_db::{Db, keys};
use serde_json::{Map, Value, json};

use crate::api::{ApiError, HydraApi, Options};

type Obj = Map<String, Value>;

static WRITE_QUEUE: Mutex<()> = Mutex::new(());

fn auth() -> Options {
    Options {
        needs_auth: true,
        ..Default::default()
    }
}

/// `levelKeys.game(shop, objectId)`
pub fn game_key(shop: &str, object_id: &str) -> String {
    format!("{shop}:{object_id}")
}

fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `updateGameRecord(key, patch)`: patch the latest record; deleted or
/// missing games are left alone. Returns the updated record.
pub fn update_game_record(
    db: &Db,
    key: &str,
    patch: impl FnOnce(&mut Obj),
) -> Result<Option<Obj>, hydra_db::Error> {
    let _guard = WRITE_QUEUE.lock().unwrap_or_else(|e| e.into_inner());
    let Some(mut game) = db.get_in::<Obj>(keys::GAMES, key) else {
        return Ok(None);
    };
    if truthy(game.get("isDeleted")) {
        return Ok(None);
    }
    patch(&mut game);
    db.put_in(keys::GAMES, key, &game)?;
    Ok(Some(game))
}

#[derive(Debug)]
pub enum ActionError {
    NotFoundLocal,
    Api(ApiError),
    Db(hydra_db::Error),
}

impl std::fmt::Display for ActionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ActionError::NotFoundLocal => f.write_str("game/not-found-local"),
            ActionError::Api(error) => write!(f, "{error}"),
            ActionError::Db(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for ActionError {}

impl From<ApiError> for ActionError {
    fn from(error: ApiError) -> Self {
        ActionError::Api(error)
    }
}

impl From<hydra_db::Error> for ActionError {
    fn from(error: hydra_db::Error) -> Self {
        ActionError::Db(error)
    }
}

/// The API's `game/not-found` (the library entry was never created remotely).
fn is_game_not_found(error: &ApiError) -> bool {
    matches!(error, ApiError::Status { body: Some(body), .. }
        if body.get("message").and_then(Value::as_str) == Some("game/not-found"))
}

fn local_game(db: &Db, key: &str) -> Option<Obj> {
    db.get_in::<Obj>(keys::GAMES, key)
}

/// add-game-to-favorites.ts / remove-game-from-favorites.ts
pub fn set_favorite(
    db: &Db,
    api: &HydraApi,
    shop: &str,
    object_id: &str,
    favorite: bool,
) -> Result<(), ActionError> {
    let key = game_key(shop, object_id);
    if local_game(db, &key).is_none() {
        return Ok(());
    }
    if shop != "custom" {
        // Fire and forget, like `.catch(() => {})`.
        let path = format!(
            "/profile/games/{shop}/{object_id}/{}",
            if favorite { "favorite" } else { "unfavorite" }
        );
        let _ = api.put(&path, &Value::Null, auth());
    }
    update_game_record(db, &key, |game| {
        game.insert("favorite".into(), Value::Bool(favorite));
    })?;
    Ok(())
}

/// toggle-game-pin.ts
pub fn set_pinned(
    db: &Db,
    api: &HydraApi,
    shop: &str,
    object_id: &str,
    pin: bool,
) -> Result<(), ActionError> {
    let key = game_key(shop, object_id);
    if local_game(db, &key).is_none() {
        return Ok(());
    }
    if pin {
        let response = api.put(
            &format!("/profile/games/{shop}/{object_id}/pin"),
            &Value::Null,
            auth(),
        )?;
        let pinned_date = response.get("pinnedDate").cloned().unwrap_or(Value::Null);
        update_game_record(db, &key, |game| {
            game.insert("isPinned".into(), Value::Bool(true));
            game.insert("pinnedDate".into(), pinned_date);
        })?;
    } else {
        api.put(
            &format!("/profile/games/{shop}/{object_id}/unpin"),
            &Value::Null,
            auth(),
        )?;
        update_game_record(db, &key, |game| {
            game.insert("isPinned".into(), Value::Bool(false));
            game.insert("pinnedDate".into(), Value::Null);
        })?;
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Visibility {
    HiddenFromOthers,
    Concealed,
}

/// set-game-visibility.ts: returns (isHiddenFromOthers, isConcealed) as saved.
pub fn set_visibility(
    db: &Db,
    api: &HydraApi,
    shop: &str,
    object_id: &str,
    field: Visibility,
    value: bool,
) -> Result<(bool, bool), ActionError> {
    let key = game_key(shop, object_id);
    let game = local_game(db, &key)
        .filter(|g| !truthy(g.get("isDeleted")))
        .ok_or(ActionError::NotFoundLocal)?;
    if shop == "custom" {
        if field != Visibility::Concealed {
            return Err(ActionError::NotFoundLocal);
        }
        let _guard = WRITE_QUEUE.lock().unwrap_or_else(|e| e.into_inner());
        let mut game = game;
        game.insert("isHiddenFromOthers".into(), Value::Bool(false));
        game.insert("isConcealed".into(), Value::Bool(value));
        db.put_in(keys::GAMES, &key, &game)?;
        return Ok((false, value));
    }
    let path = format!(
        "/profile/games/{shop}/{object_id}/{}",
        if field == Visibility::HiddenFromOthers {
            "hide"
        } else {
            "conceal"
        }
    );
    let save = || {
        if value {
            api.put(&path, &Value::Null, auth())
        } else {
            api.delete(&path, auth())
        }
    };
    let saved = match save() {
        Ok(saved) => saved,
        Err(error) if is_game_not_found(&error) => {
            create_game(db, api, &game)?;
            save()?
        }
        Err(error) => return Err(error.into()),
    };
    let hidden = saved
        .get("isHiddenFromOthers")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let concealed = saved
        .get("isConcealed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    update_game_record(db, &key, |game| {
        game.insert("isHiddenFromOthers".into(), Value::Bool(hidden));
        game.insert("isConcealed".into(), Value::Bool(concealed));
    })?;
    Ok((hidden, concealed))
}

/// assign-game-to-collection.ts
pub fn assign_collections(
    db: &Db,
    api: &HydraApi,
    shop: &str,
    object_id: &str,
    collection_ids: &[String],
) -> Result<(), ActionError> {
    let key = game_key(shop, object_id);
    let game = local_game(db, &key).ok_or(ActionError::NotFoundLocal)?;
    if shop != "custom" {
        let path = format!("/profile/games/{shop}/{object_id}/collection");
        let body = json!({ "collectionIds": collection_ids });
        match api.put(&path, &body, auth()) {
            Ok(_) => {}
            Err(error) if is_game_not_found(&error) => {
                create_game(db, api, &game)?;
                api.put(&path, &body, auth())?;
            }
            Err(error) => return Err(error.into()),
        }
    }
    update_game_record(db, &key, |game| {
        game.insert("collectionIds".into(), json!(collection_ids));
    })?;
    Ok(())
}

/// getRemotePlayTimeParts (shared/playtime.ts): (hydra, steam, epic) in ms.
pub fn remote_play_time_parts(remote: &Value) -> (f64, f64, f64) {
    let to_ms = |seconds: f64| {
        if seconds.is_finite() && seconds >= 0.0 {
            seconds * 1000.0
        } else {
            0.0
        }
    };
    let by_platform = remote.get("runtimeByPlatform");
    let platform = |name: &str| {
        by_platform
            .and_then(|p| p.get(name))
            .and_then(Value::as_f64)
    };
    let combined = remote
        .get("runtime")
        .and_then(Value::as_f64)
        .or_else(|| remote.get("playTimeInSeconds").and_then(Value::as_f64))
        .or_else(|| {
            remote
                .get("playTimeInMilliseconds")
                .and_then(Value::as_f64)
                .map(|ms| ms / 1000.0)
        })
        .unwrap_or(0.0);
    let (hydra, steam, epic) = (platform("hydra"), platform("steam"), platform("epic"));
    if hydra.is_some() || steam.is_some() || epic.is_some() {
        let hydra_ms = match hydra {
            Some(seconds) => to_ms(seconds),
            None => (to_ms(combined) - to_ms(steam.unwrap_or(0.0)) - to_ms(epic.unwrap_or(0.0)))
                .max(0.0),
        };
        return (
            hydra_ms,
            to_ms(steam.unwrap_or(0.0)),
            to_ms(epic.unwrap_or(0.0)),
        );
    }
    (to_ms(combined), 0.0, 0.0)
}

/// mergeLocalAndRemotePlayTime (shared/playtime.ts)
pub fn merge_play_time(local: &Obj, remote: &Value) -> (f64, f64, f64) {
    let supports_epic = remote
        .get("runtimeByPlatform")
        .and_then(|p| p.get("epic"))
        .is_some_and(Value::is_number)
        || remote
            .get("hasActiveEpicImport")
            .is_some_and(Value::is_boolean);
    let local_epic = local
        .get("epicPlayTimeInMilliseconds")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let mut remote = remote.clone();
    if !supports_epic && local_epic != 0.0 {
        let platforms = remote
            .as_object_mut()
            .map(|r| r.entry("runtimeByPlatform").or_insert_with(|| json!({})))
            .filter(|p| p.is_object());
        if let Some(Value::Object(platforms)) = platforms {
            platforms.insert("epic".into(), json!(local_epic / 1000.0));
        }
    }
    let (hydra, steam, epic) = remote_play_time_parts(&remote);
    let local_hydra = local
        .get("playTimeInMilliseconds")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    (local_hydra.max(hydra), steam, epic)
}

/// library-sync/create-game.ts: register a local game with the API.
pub fn create_game(db: &Db, api: &HydraApi, game: &Obj) -> Result<(), ActionError> {
    let shop = game.get("shop").and_then(Value::as_str).unwrap_or_default();
    if shop == "custom" || game.get("source").and_then(Value::as_str) == Some("epic") {
        return Ok(());
    }
    let object_id = game
        .get("objectId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let key = game_key(shop, object_id);
    let Some(local) = local_game(db, &key) else {
        return Ok(());
    };
    if truthy(local.get("isDeleted")) || local.get("source").and_then(Value::as_str) == Some("epic")
    {
        return Ok(());
    }
    let body = json!({
        "objectId": object_id,
        "playTimeInMilliseconds": local.get("playTimeInMilliseconds").and_then(Value::as_f64).unwrap_or(0.0).trunc(),
        "shop": shop,
        "lastTimePlayed": local.get("lastTimePlayed").cloned().unwrap_or(Value::Null),
    });
    match api.post("/profile/games", &body, auth()) {
        Ok(response) => {
            let _guard = WRITE_QUEUE.lock().unwrap_or_else(|e| e.into_inner());
            let Some(mut latest) = local_game(db, &key) else {
                return Ok(());
            };
            let (hydra, steam, epic) = merge_play_time(&latest, &response);
            latest.insert(
                "remoteId".into(),
                response.get("id").cloned().unwrap_or(Value::Null),
            );
            latest.insert("source".into(), json!("hydra"));
            latest.insert("playTimeInMilliseconds".into(), json!(hydra));
            latest.insert("steamPlayTimeInMilliseconds".into(), json!(steam));
            latest.insert("epicPlayTimeInMilliseconds".into(), json!(epic));
            if latest.get("addedToLibraryAt").is_none_or(Value::is_null) {
                let added = response
                    .get("createdAt")
                    .cloned()
                    .unwrap_or_else(|| json!(now_iso()));
                latest.insert("addedToLibraryAt".into(), added);
            }
            if latest.get("lastTimePlayed").is_none_or(Value::is_null) {
                latest.insert(
                    "lastTimePlayed".into(),
                    response
                        .get("lastTimePlayed")
                        .cloned()
                        .unwrap_or(Value::Null),
                );
            }
            db.put_in(keys::GAMES, &key, &latest)?;
            Ok(())
        }
        Err(error) => {
            let _guard = WRITE_QUEUE.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(mut latest) = local_game(db, &key) {
                latest.insert("source".into(), json!("hydra"));
                latest.insert("remoteId".into(), Value::Null);
                db.put_in(keys::GAMES, &key, &latest)?;
            }
            Err(error.into())
        }
    }
}

/// `new Date().toISOString()`
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_play_time_prefers_per_platform_runtime() {
        let remote = json!({ "runtime": 100, "runtimeByPlatform": { "steam": 40 } });
        assert_eq!(remote_play_time_parts(&remote), (60_000.0, 40_000.0, 0.0));
        let remote = json!({ "playTimeInSeconds": 5 });
        assert_eq!(remote_play_time_parts(&remote), (5_000.0, 0.0, 0.0));
    }

    #[test]
    fn merge_keeps_the_larger_hydra_playtime_and_local_epic_on_old_apis() {
        let local: Obj = serde_json::from_value(
            json!({ "playTimeInMilliseconds": 90_000, "epicPlayTimeInMilliseconds": 7_000 }),
        )
        .unwrap();
        let remote = json!({ "runtime": 60 });
        // runtime 60s with epic 7s carried over: hydra = 60 - 7 = 53s < local 90s.
        assert_eq!(merge_play_time(&local, &remote), (90_000.0, 0.0, 7_000.0));
    }
}
