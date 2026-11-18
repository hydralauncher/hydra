//! What the achievement watcher knows about each game while the app runs:
//! achievement-memory-store.ts (definitions and merged unlocks, never
//! persisted), get-game-achievement-data.ts (definitions from the API with
//! their ETag) and merge-unlocked-achievements.ts.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use hydra_db::{Db, keys};
use serde_json::{Value, json};

use crate::api::{ApiError, Conditional, HydraApi, Options};

/// `UnlockedAchievement` (game.types.ts).
#[derive(Clone, Debug, PartialEq)]
pub struct StoredUnlock {
    pub name: String,
    /// Milliseconds since the epoch.
    pub unlock_time: i64,
    pub hardcore_unlock_time: Option<i64>,
}

impl StoredUnlock {
    pub fn new(name: impl Into<String>, unlock_time: i64) -> Self {
        Self {
            name: name.into(),
            unlock_time,
            hardcore_unlock_time: None,
        }
    }

    pub fn from_json(value: &Value) -> Option<Self> {
        let name = value.get("name")?.as_str()?.to_string();
        Some(Self {
            name,
            unlock_time: value
                .get("unlockTime")
                .and_then(Value::as_f64)
                .unwrap_or(0.0) as i64,
            hardcore_unlock_time: value
                .get("hardcoreUnlockTime")
                .and_then(Value::as_f64)
                .map(|t| t as i64),
        })
    }

    pub fn to_json(&self) -> Value {
        let mut value = json!({ "name": self.name, "unlockTime": self.unlock_time });
        if let Some(hardcore) = self.hardcore_unlock_time {
            value["hardcoreUnlockTime"] = json!(hardcore);
        }
        value
    }
}

/// `AchievementMemoryEntry`.
#[derive(Clone, Debug, Default)]
pub struct Entry {
    /// `SteamAchievement[]` as the API sends them.
    pub definitions: Vec<Value>,
    pub unlocked: Vec<StoredUnlock>,
    /// The language the definitions were fetched in (None: not fetched).
    pub language: Option<String>,
    /// `catalogueValidator`: the definitions' ETag.
    pub etag: Option<String>,
}

/// `AchievementMemoryStore`, keyed `shop:objectId`.
#[derive(Default)]
pub struct Memory {
    entries: Mutex<HashMap<String, Entry>>,
}

fn key(shop: &str, object_id: &str) -> String {
    format!("{shop}:{object_id}")
}

impl Memory {
    pub fn get(&self, shop: &str, object_id: &str) -> Option<Entry> {
        self.entries
            .lock()
            .ok()?
            .get(&key(shop, object_id))
            .cloned()
    }

    pub fn set(&self, shop: &str, object_id: &str, entry: Entry) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(key(shop, object_id), entry);
        }
    }

    /// saveAchievementsInMemory: new unlocks, the definitions kept.
    pub fn set_unlocked(&self, shop: &str, object_id: &str, unlocked: Vec<StoredUnlock>) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.entry(key(shop, object_id)).or_default().unlocked = unlocked;
        }
    }

    /// The unlocks only when the game already has an entry
    /// (getUnlockedAchievements updates `stored` only).
    pub fn update_unlocked(&self, shop: &str, object_id: &str, unlocked: Vec<StoredUnlock>) {
        if let Ok(mut entries) = self.entries.lock()
            && let Some(entry) = entries.get_mut(&key(shop, object_id))
        {
            entry.unlocked = unlocked;
        }
    }

    pub fn unlocked(&self, shop: &str, object_id: &str) -> Vec<StoredUnlock> {
        self.get(shop, object_id)
            .map(|e| e.unlocked)
            .unwrap_or_default()
    }

    pub fn clear(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.clear();
        }
    }
}

/// The app's memory store.
pub fn memory() -> &'static Memory {
    static MEMORY: OnceLock<Memory> = OnceLock::new();
    MEMORY.get_or_init(Memory::default)
}

/// mergeUnlockedAchievementLists: remote first, then the local-only unlocks.
pub fn merge_unlocked_lists(remote: &[StoredUnlock], local: &[StoredUnlock]) -> Vec<StoredUnlock> {
    let remote_names: HashSet<String> = remote.iter().map(|a| a.name.to_uppercase()).collect();
    remote
        .iter()
        .cloned()
        .chain(
            local
                .iter()
                .filter(|a| !remote_names.contains(&a.name.to_uppercase()))
                .cloned(),
        )
        .collect()
}

/// `levelKeys.language` (utf8), "en" when empty.
pub fn language(db: &Db) -> String {
    db.get_utf8(keys::LANGUAGE)
        .filter(|l| !l.is_empty())
        .unwrap_or_else(|| "en".into())
}

/// getGameAchievementData: the definitions, from memory when `use_cached` and
/// the language matches, else from the API (a 304 keeps the stored ones).
/// Only a signed-out user is an error; other failures give the stored list.
pub fn game_achievement_data(
    api: &HydraApi,
    db: &Db,
    memory: &Memory,
    shop: &str,
    object_id: &str,
    use_cached: bool,
) -> Result<Vec<Value>, ApiError> {
    if shop == "custom" {
        return Ok(Vec::new());
    }
    let cached = memory.get(shop, object_id);
    let language = language(db);
    let cached_language = cached.as_ref().and_then(|c| c.language.clone());
    if use_cached
        && let Some(cached) = &cached
        && cached_language.as_deref() == Some(language.as_str())
    {
        return Ok(cached.definitions.clone());
    }
    let stored = || {
        cached
            .as_ref()
            .map(|c| c.definitions.clone())
            .unwrap_or_default()
    };
    let etag = cached
        .as_ref()
        .filter(|_| cached_language.as_deref() == Some(language.as_str()))
        .and_then(|c| c.etag.clone());
    match api.get_conditional(
        &format!("/games/{shop}/{object_id}/achievements"),
        &[("language", language.clone())],
        etag.as_deref(),
        Options::default(),
    ) {
        Ok(Conditional::NotModified) => Ok(stored()),
        Ok(Conditional::Fresh { body, etag }) => {
            let fetched = body.as_array().cloned().unwrap_or_default();
            let definitions = if !fetched.is_empty() || shop == "epic" {
                fetched
            } else {
                stored()
            };
            memory.set(
                shop,
                object_id,
                Entry {
                    unlocked: memory.unlocked(shop, object_id),
                    definitions: definitions.clone(),
                    language: Some(language),
                    etag,
                },
            );
            Ok(definitions)
        }
        Err(ApiError::NotLoggedIn) => Err(ApiError::NotLoggedIn),
        Err(error) => {
            eprintln!("Failed to get game achievements for {object_id}: {error}");
            Ok(stored())
        }
    }
}

/// `SteamAchievement.name`, uppercased for lookups.
pub fn definition_key(definition: &Value) -> String {
    definition
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_uppercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_remote_first_then_local_only() {
        let remote = vec![StoredUnlock::new("a", 1), StoredUnlock::new("B", 2)];
        let local = vec![StoredUnlock::new("b", 9), StoredUnlock::new("c", 3)];
        let merged = merge_unlocked_lists(&remote, &local);
        let names: Vec<_> = merged
            .iter()
            .map(|a| (a.name.as_str(), a.unlock_time))
            .collect();
        assert_eq!(names, [("a", 1), ("B", 2), ("c", 3)]);
    }

    #[test]
    fn set_unlocked_keeps_definitions() {
        let memory = Memory::default();
        memory.set(
            "steam",
            "1",
            Entry {
                definitions: vec![json!({ "name": "A" })],
                language: Some("en".into()),
                ..Entry::default()
            },
        );
        memory.set_unlocked("steam", "1", vec![StoredUnlock::new("A", 5)]);
        let entry = memory.get("steam", "1").unwrap();
        assert_eq!(entry.definitions.len(), 1);
        assert_eq!(entry.unlocked[0].unlock_time, 5);
        // update_unlocked leaves unknown games alone
        memory.update_unlocked("steam", "2", vec![StoredUnlock::new("A", 5)]);
        assert!(memory.get("steam", "2").is_none());
    }

    #[test]
    fn unlock_json_round_trip() {
        let unlock = StoredUnlock {
            name: "X".into(),
            unlock_time: 10,
            hardcore_unlock_time: Some(7),
        };
        assert_eq!(StoredUnlock::from_json(&unlock.to_json()), Some(unlock));
        assert_eq!(
            StoredUnlock::new("Y", 3).to_json(),
            json!({ "name": "Y", "unlockTime": 3 })
        );
    }
}
