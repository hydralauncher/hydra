//! import-cleanup.ts and import-visibility.ts: dropping imported Epic data
//! from the local library when the link (or the Hydra account) changes.
//!
//! An imported game carries `hasActiveEpicImport`, `epicImportScope`
//! (`{ environment, userId, connectionId }`) and `epicPlayTimeInMilliseconds`.
//! Games that exist only because of the import (`source: "epic"`) are hidden.

use hydra_db::{Db, keys};
use serde_json::{Map, Value, json};

use crate::session::AuthContext;

fn has_import_fields(game: &Map<String, Value>) -> bool {
    game.get("hasActiveEpicImport").and_then(Value::as_bool) == Some(true)
        || game.get("epicImportScope").is_some_and(|s| !s.is_null())
        || game
            .get("epicPlayTimeInMilliseconds")
            .and_then(Value::as_f64)
            .is_some_and(|ms| ms != 0.0)
}

/// matchesEpicImportScope
pub fn matches_scope(
    game: &Map<String, Value>,
    environment: &str,
    user_id: &str,
    connection_id: Option<&str>,
) -> bool {
    let Some(scope) = game.get("epicImportScope").filter(|s| s.is_object()) else {
        return false;
    };
    let field = |key: &str| scope.get(key).and_then(Value::as_str);
    field("environment") == Some(environment)
        && field("userId") == Some(user_id)
        && connection_id.is_none_or(|id| field("connectionId") == Some(id))
}

fn cleared(game: &Map<String, Value>, clear_remote_id: bool, exclusive: bool) -> Value {
    let mut game = game.clone();
    game.insert("epicPlayTimeInMilliseconds".into(), json!(0));
    game.insert("hasActiveEpicImport".into(), json!(false));
    game.remove("epicImportScope");
    if clear_remote_id {
        game.insert("remoteId".into(), Value::Null);
    }
    if exclusive {
        game.insert("isDeleted".into(), json!(true));
    }
    Value::Object(game)
}

fn is_exclusive(game: &Map<String, Value>) -> bool {
    // hasPendingHydraClaim: the rewrite has no queued Hydra claims to wait for.
    game.get("source").and_then(Value::as_str) == Some("epic")
}

/// clearEpicImports: the imports of one account/link (all when `context`
/// is None). Returns how many games changed.
pub fn clear_imports(
    db: &Db,
    context: Option<(&str, &str)>,
    connection_id: Option<&str>,
    account_changed: bool,
    current: &dyn Fn() -> bool,
) -> usize {
    if !current() {
        return 0;
    }
    let mut updates = Vec::new();
    for (key, game) in db.entries::<Value>(keys::GAMES).unwrap_or_default() {
        let Some(game) = game.as_object() else {
            continue;
        };
        if !has_import_fields(game) {
            continue;
        }
        if let Some((environment, user_id)) = context
            && !matches_scope(game, environment, user_id, connection_id)
        {
            continue;
        }
        let exclusive = is_exclusive(game);
        updates.push((key, cleared(game, account_changed || exclusive, exclusive)));
    }
    if !current() {
        return 0;
    }
    for (key, value) in &updates {
        let _ = db.put_in(keys::GAMES, key, value);
    }
    updates.len()
}

/// The `connectionId` argument of clearStaleEpicImports.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LinkFilter<'a> {
    /// undefined: any link of the current account is kept.
    Any,
    /// null: no link is current; every import goes.
    None,
    /// Only this link's imports are kept.
    Only(&'a str),
}

/// clearStaleEpicImports: imports that don't belong to the current account
/// (and link). Returns how many games changed.
pub fn clear_stale_imports(
    db: &Db,
    context: Option<&AuthContext>,
    link: LinkFilter,
    current: &dyn Fn() -> bool,
) -> usize {
    if !current() {
        return 0;
    }
    let mut updates = Vec::new();
    for (key, game) in db.entries::<Value>(keys::GAMES).unwrap_or_default() {
        let Some(game) = game.as_object() else {
            continue;
        };
        if !has_import_fields(game) {
            continue;
        }
        let in_account =
            context.is_some_and(|c| matches_scope(game, &c.environment, &c.user_id, None));
        let keep = in_account
            && match link {
                LinkFilter::Any => true,
                LinkFilter::None => false,
                LinkFilter::Only(id) => {
                    game.get("epicImportScope")
                        .and_then(|s| s.get("connectionId"))
                        .and_then(Value::as_str)
                        == Some(id)
                }
            };
        if keep {
            continue;
        }
        let exclusive = is_exclusive(game);
        updates.push((key, cleared(game, !(in_account && !exclusive), exclusive)));
    }
    if !current() {
        return 0;
    }
    for (key, value) in &updates {
        let _ = db.put_in(keys::GAMES, key, value);
    }
    updates.len()
}

/// getContextualEpicGame: a game as the current account may see it.
pub fn contextual_game(game: &Value, context: Option<(&str, &str)>) -> Value {
    let Some(map) = game.as_object() else {
        return game.clone();
    };
    if !has_import_fields(map) && map.get("source").and_then(Value::as_str) != Some("epic") {
        return game.clone();
    }
    if let Some((environment, user_id)) = context
        && matches_scope(map, environment, user_id, None)
    {
        return game.clone();
    }
    let mut hidden = map.clone();
    hidden.insert("hasActiveEpicImport".into(), json!(false));
    hidden.insert("epicPlayTimeInMilliseconds".into(), json!(0));
    hidden.remove("epicImportScope");
    if map.get("source").and_then(Value::as_str) == Some("epic") {
        hidden.insert("isDeleted".into(), json!(true));
    }
    Value::Object(hidden)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(source: &str, connection: &str, user: &str) -> Value {
        json!({
            "objectId": "x", "shop": "epic", "source": source, "remoteId": "r",
            "isDeleted": false, "hasActiveEpicImport": true,
            "epicPlayTimeInMilliseconds": 5000,
            "epicImportScope": {"environment": "https://api", "userId": user, "connectionId": connection},
        })
    }

    fn setup() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("db")).unwrap();
        db.put_in(keys::GAMES, "epic:a", &game("epic", "conn1", "u1"))
            .unwrap();
        db.put_in(keys::GAMES, "epic:b", &game("hydra", "conn1", "u1"))
            .unwrap();
        db.put_in(keys::GAMES, "epic:c", &game("epic", "conn2", "u2"))
            .unwrap();
        db.put_in(
            keys::GAMES,
            "steam:d",
            &json!({"objectId": "d", "shop": "steam"}),
        )
        .unwrap();
        (dir, db)
    }

    #[test]
    fn clears_one_link() {
        let (_dir, db) = setup();
        let changed = clear_imports(
            &db,
            Some(("https://api", "u1")),
            Some("conn1"),
            false,
            &|| true,
        );
        assert_eq!(changed, 2);
        let a: Value = db.get_in(keys::GAMES, "epic:a").unwrap();
        assert_eq!(a["isDeleted"], true);
        assert_eq!(a["remoteId"], Value::Null);
        assert!(a.get("epicImportScope").is_none());
        let b: Value = db.get_in(keys::GAMES, "epic:b").unwrap();
        assert_eq!(b["isDeleted"], false);
        assert_eq!(b["remoteId"], "r");
        assert_eq!(b["hasActiveEpicImport"], false);
        let c: Value = db.get_in(keys::GAMES, "epic:c").unwrap();
        assert_eq!(c["hasActiveEpicImport"], true);
    }

    #[test]
    fn clears_stale_accounts() {
        let (_dir, db) = setup();
        let context = AuthContext {
            environment: "https://api".into(),
            user_id: "u1".into(),
            generation: 1,
        };
        assert_eq!(
            clear_stale_imports(&db, Some(&context), LinkFilter::Any, &|| true),
            1
        );
        let c: Value = db.get_in(keys::GAMES, "epic:c").unwrap();
        assert_eq!(c["isDeleted"], true);
        assert_eq!(c["remoteId"], Value::Null);
        let a: Value = db.get_in(keys::GAMES, "epic:a").unwrap();
        assert_eq!(a["hasActiveEpicImport"], true);
        // the account's link changed: its non-exclusive games keep their remote id
        assert_eq!(
            clear_stale_imports(&db, Some(&context), LinkFilter::Only("conn9"), &|| true),
            2
        );
        let b: Value = db.get_in(keys::GAMES, "epic:b").unwrap();
        assert_eq!(b["remoteId"], "r");
        assert_eq!(b["hasActiveEpicImport"], false);
        assert_eq!(
            clear_stale_imports(&db, None, LinkFilter::Any, &|| false),
            0
        );
    }

    #[test]
    fn hides_other_accounts_games() {
        let other = contextual_game(&game("epic", "c", "u2"), Some(("https://api", "u1")));
        assert_eq!(other["isDeleted"], true);
        let own = contextual_game(&game("epic", "c", "u1"), Some(("https://api", "u1")));
        assert_eq!(own["isDeleted"], false);
    }
}
