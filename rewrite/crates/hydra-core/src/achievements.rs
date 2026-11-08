//! A game's achievements for the signed-in user, as the game page shows them.
//!
//! Ports src/main/events/user/get-unlocked-achievements.ts
//! (`getUnlockedAchievements`) with get-game-achievement-data.ts,
//! get-achievement-souvenirs.ts (`fetchRemoteUserGameAchievements`) and
//! combined-achievement-presentation.ts. Unlocks the achievement watcher found
//! in local files (the memory store) are merged with the remote ones.
//!
//! Not ported: UnlockedAchievementsCache (every page load asks the API).

use std::collections::HashMap;
use std::time::Duration;

use hydra_db::{Db, keys};
use serde_json::Value;

use crate::achievement_store::{self, Memory, StoredUnlock, definition_key, merge_unlocked_lists};
use crate::api::{ApiError, HydraApi, Options};

/// `AchievementSet` (game.types.ts).
#[derive(Clone, Debug, PartialEq, Default)]
pub struct AchievementSet {
    pub id: i64,
    pub name: Option<String>,
    pub order: i64,
}

impl AchievementSet {
    pub fn from_json(value: &Value) -> Option<Self> {
        let value = value.as_object()?;
        Some(Self {
            id: value.get("id")?.as_f64()? as i64,
            name: value
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string),
            order: value.get("order").and_then(Value::as_f64).unwrap_or(0.0) as i64,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Achievement {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub icon: String,
    pub icon_gray: String,
    pub hidden: bool,
    pub unlocked: bool,
    /// Milliseconds since the epoch.
    pub unlock_time: Option<i64>,
    /// RetroAchievements hardcore unlocks (milliseconds since the epoch).
    pub hardcore_unlock_time: Option<i64>,
    /// Souvenir screenshot, when the user has one.
    pub image_url: Option<String>,
    pub global_unlock_percentage: Option<f64>,
    /// Hydra Cloud achievement points (from the game's achievement data).
    pub points: Option<i64>,
    /// The set this achievement belongs to (RetroAchievements subsets, DLC).
    pub set: Option<AchievementSet>,
    /// `canonicalAchievementId` of a combined Steam/Epic achievement.
    pub canonical_id: Option<String>,
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// The account-level language (userPreferences.language) used for remote requests.
fn preferences_language(db: &Db) -> String {
    db.get::<Value>(keys::USER_PREFERENCES)
        .and_then(|p| {
            p.get("language")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| "en".into())
}

fn icon_gray(icon: &str, icongray: &str) -> String {
    if icongray.ends_with('/') || icongray.is_empty() {
        icon.to_string()
    } else {
        icongray.to_string()
    }
}

fn hidden(value: &Value) -> bool {
    value
        .get("hidden")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || value.get("hidden").and_then(Value::as_i64) == Some(1)
}

fn set_of(value: &Value) -> Option<AchievementSet> {
    value.get("set").and_then(AchievementSet::from_json)
}

/// `getUnlockedAchievements(objectId, shop, useCachedData = false)` with the app's memory store.
pub fn unlocked_achievements(
    api: &HydraApi,
    db: &Db,
    shop: &str,
    object_id: &str,
) -> Result<Vec<Achievement>, ApiError> {
    unlocked_achievements_with(api, db, achievement_store::memory(), shop, object_id, false)
}

/// `getUnlockedAchievements(objectId, shop, useCachedData)`.
pub fn unlocked_achievements_with(
    api: &HydraApi,
    db: &Db,
    memory: &Memory,
    shop: &str,
    object_id: &str,
    use_cached: bool,
) -> Result<Vec<Achievement>, ApiError> {
    if shop == "custom" {
        return Ok(Vec::new());
    }
    let catalogue =
        achievement_store::game_achievement_data(api, db, memory, shop, object_id, use_cached)?;

    let remote_language = preferences_language(db);
    let user_id = db
        .get::<Value>(keys::USER)
        .map(|u| text(&u, "id"))
        .unwrap_or_default();
    // fetchRemoteUserGameAchievements: `unavailable` when the request failed
    let (remote, unavailable): (Vec<Value>, bool) = if user_id.is_empty() {
        (Vec::new(), false)
    } else {
        match api.get(
            &format!("/users/{user_id}/games/achievements"),
            &[
                ("shop", shop.to_string()),
                ("objectId", object_id.to_string()),
                ("language", remote_language.clone()),
            ],
            Options::default(),
        ) {
            Ok(v) => (v.as_array().cloned().unwrap_or_default(), false),
            Err(_) => (Vec::new(), true),
        }
    };
    let souvenirs: HashMap<String, String> = remote
        .iter()
        .filter_map(|a| {
            let url = a
                .get("imageUrl")
                .and_then(Value::as_str)
                .filter(|u| !u.is_empty())?;
            Some((text(a, "name").to_uppercase(), url.to_string()))
        })
        .collect();
    let remote_unlocked: Vec<StoredUnlock> = remote
        .iter()
        .filter_map(|a| {
            let name = text(a, "name");
            let time = a.get("unlockTime").and_then(Value::as_f64)?;
            (!name.is_empty() && time != 0.0).then(|| StoredUnlock::new(name, time as i64))
        })
        .collect();
    let unlocked_list = if shop == "epic" && !unavailable {
        remote_unlocked
    } else {
        merge_unlocked_lists(&remote_unlocked, &memory.unlocked(shop, object_id))
    };
    memory.update_unlocked(shop, object_id, unlocked_list.clone());

    if shop == "steam" || shop == "epic" {
        let combined = api.get(
            "/profile/achievements/combined",
            &[
                ("shop", shop.to_string()),
                ("objectId", object_id.to_string()),
                ("language", remote_language),
            ],
            Options {
                needs_auth: true,
                timeout: Some(Duration::from_secs(5)),
            },
        );
        if let Ok(combined) = combined
            && let Some(groups) = combined.get("achievements").and_then(Value::as_array)
        {
            let includes_copy = groups.iter().any(|g| {
                g.get("variants")
                    .and_then(Value::as_array)
                    .is_some_and(|vs| {
                        vs.iter()
                            .any(|v| text(v, "shop") == shop && text(v, "objectId") == object_id)
                    })
            });
            // emptyCopyInGroup: an empty copy whose canonical id matches the group's
            let canonical = combined
                .get("canonicalId")
                .and_then(Value::as_str)
                .filter(|c| !c.is_empty());
            let empty_copy_in_group = !includes_copy
                && catalogue.is_empty()
                && unlocked_list.is_empty()
                && canonical.is_some()
                && db
                    .get_in::<Value>(keys::GAMES, &keys::game(shop, object_id))
                    .and_then(|g| {
                        g.get("canonicalId")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .as_deref()
                    == canonical;
            if !groups.is_empty() && (includes_copy || empty_copy_in_group) {
                let local = |shop: &str, object_id: &str| memory.unlocked(shop, object_id);
                let definitions = |s: &str, id: &str| {
                    if s == shop && id == object_id {
                        catalogue.clone()
                    } else {
                        memory.get(s, id).map(|e| e.definitions).unwrap_or_default()
                    }
                };
                return Ok(present_combined(groups, &local, &definitions));
            }
        }
    }

    let catalogue_empty = catalogue.is_empty();
    let mut definitions: Vec<Value> = if !catalogue_empty {
        catalogue
    } else {
        // the remote rows as definitions: name, texts, icons and hidden only
        remote
            .iter()
            .map(|a| {
                let name = text(a, "name");
                let icon = text(a, "icon");
                serde_json::json!({
                    "displayName": Some(text(a, "displayName")).filter(|s| !s.is_empty()).unwrap_or_else(|| name.clone()),
                    "name": name,
                    "description": text(a, "description"),
                    "icongray": Some(text(a, "icongray")).filter(|s| !s.is_empty()).unwrap_or_else(|| icon.clone()),
                    "icon": icon,
                    "hidden": hidden(a),
                })
            })
            .collect()
    };
    // Epic copies without definitions borrow the catalogue Steam game's (display only)
    if shop == "epic" && catalogue_empty {
        let game: Option<Value> = db.get_in(keys::GAMES, &keys::game(shop, object_id));
        if let Some(catalogue_game) = game.as_ref().and_then(|g| g.get("catalogueGame"))
            && text(catalogue_game, "shop") == "steam"
        {
            let steam_id = text(catalogue_game, "objectId");
            let steam =
                achievement_store::game_achievement_data(api, db, memory, "steam", &steam_id, true)
                    .unwrap_or_default();
            if !steam.is_empty() {
                definitions = steam;
            }
        }
    }
    let unlocked: HashMap<String, i64> = unlocked_list.iter().fold(HashMap::new(), |mut map, a| {
        map.entry(a.name.to_uppercase()).or_insert(a.unlock_time);
        map
    });
    let mut list: Vec<Achievement> = definitions
        .iter()
        .map(|d| {
            let name = text(d, "name");
            let key = name.to_uppercase();
            let icon = text(d, "icon");
            let gray = icon_gray(&icon, &text(d, "icongray"));
            let display_name = Some(text(d, "displayName"))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| name.clone());
            let unlock_time = unlocked.get(&key).copied();
            Achievement {
                display_name,
                description: text(d, "description"),
                icon_gray: gray,
                icon,
                hidden: hidden(d),
                unlocked: unlock_time.is_some(),
                unlock_time,
                hardcore_unlock_time: None,
                image_url: unlock_time.and(souvenirs.get(&key).cloned()),
                global_unlock_percentage: d.get("globalUnlockPercentage").and_then(Value::as_f64),
                points: d.get("points").and_then(Value::as_f64).map(|p| p as i64),
                set: set_of(d),
                canonical_id: None,
                name,
            }
        })
        .collect();
    list.sort_by(|a, b| match (a.unlocked, b.unlocked) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        (true, true) => b.unlock_time.cmp(&a.unlock_time),
        (false, false) => a.hidden.cmp(&b.hidden),
    });
    Ok(list)
}

/// `presentCombinedAchievements`: one row per canonical achievement, the
/// unlocked (Steam-first) variant shown; a variant counts as unlocked when the
/// API says so or the watcher found it locally.
fn present_combined(
    groups: &[Value],
    local_unlocks: &dyn Fn(&str, &str) -> Vec<StoredUnlock>,
    definitions_of: &dyn Fn(&str, &str) -> Vec<Value>,
) -> Vec<Achievement> {
    let mut locals: HashMap<String, HashMap<String, i64>> = HashMap::new();
    let mut local_time = |shop: &str, object_id: &str, name: &str| -> Option<i64> {
        locals
            .entry(format!("{shop}:{object_id}"))
            .or_insert_with(|| {
                local_unlocks(shop, object_id)
                    .into_iter()
                    .fold(HashMap::new(), |mut map, u| {
                        map.entry(u.name.to_uppercase()).or_insert(u.unlock_time);
                        map
                    })
            })
            .get(&name.to_uppercase())
            .copied()
    };
    let mut definitions: HashMap<String, HashMap<String, Value>> = HashMap::new();
    let mut find_definition = |shop: &str, object_id: &str, name: &str| -> Option<Value> {
        definitions
            .entry(format!("{shop}:{object_id}"))
            .or_insert_with(|| {
                definitions_of(shop, object_id)
                    .into_iter()
                    .map(|d| (definition_key(&d), d))
                    .collect()
            })
            .get(&name.to_uppercase())
            .cloned()
    };
    let mut list: Vec<Achievement> = groups
        .iter()
        .filter_map(|group| {
            let variants = group.get("variants").and_then(Value::as_array)?;
            let states: Vec<(&Value, Option<i64>)> = variants
                .iter()
                .map(|v| {
                    let time = v
                        .get("unlockTime")
                        .and_then(Value::as_f64)
                        .map(|t| t as i64)
                        .or_else(|| {
                            local_time(&text(v, "shop"), &text(v, "objectId"), &text(v, "name"))
                        });
                    (v, time)
                })
                .collect();
            let unlocked: Vec<&(&Value, Option<i64>)> =
                states.iter().filter(|(_, t)| t.is_some()).collect();
            let choices: Vec<&(&Value, Option<i64>)> = if unlocked.is_empty() {
                states.iter().collect()
            } else {
                unlocked
            };
            let &&(selected, unlock_time) = choices
                .iter()
                .find(|(v, _)| text(v, "shop") == "steam")
                .or(choices.first())?;
            let ordered: Vec<&Value> = std::iter::once(selected)
                .chain(
                    states
                        .iter()
                        .map(|(v, _)| *v)
                        .filter(|v| !std::ptr::eq(*v, selected)),
                )
                .collect();
            let found: Vec<(String, Option<Value>)> = ordered
                .iter()
                .map(|v| {
                    (
                        text(v, "shop"),
                        find_definition(&text(v, "shop"), &text(v, "objectId"), &text(v, "name")),
                    )
                })
                .collect();
            let percentage = found.iter().find_map(|(_, d)| {
                d.as_ref()?
                    .get("globalUnlockPercentage")
                    .and_then(Value::as_f64)
            });
            let set = found
                .iter()
                .filter(|(shop, _)| shop == "steam")
                .find_map(|(_, d)| set_of(d.as_ref()?));
            let name = text(selected, "name");
            let icon = text(selected, "icon");
            Some(Achievement {
                display_name: Some(text(selected, "displayName"))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| name.clone()),
                description: text(selected, "description"),
                icon_gray: icon_gray(&icon, &text(selected, "icongray")),
                icon,
                hidden: hidden(selected),
                unlocked: unlock_time.is_some(),
                unlock_time,
                hardcore_unlock_time: None,
                image_url: selected
                    .get("imageUrl")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                global_unlock_percentage: percentage,
                points: selected
                    .get("points")
                    .and_then(Value::as_f64)
                    .or_else(|| {
                        found
                            .first()
                            .and_then(|(_, d)| d.as_ref()?.get("points")?.as_f64())
                    })
                    .map(|p| p as i64),
                set,
                canonical_id: group
                    .get("canonicalAchievementId")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                name,
            })
        })
        .collect();
    list.sort_by(|a, b| {
        b.unlocked
            .cmp(&a.unlocked)
            .then(b.unlock_time.unwrap_or(0).cmp(&a.unlock_time.unwrap_or(0)))
            .then(a.hidden.cmp(&b.hidden))
    });
    list
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn combined_uses_local_unlocks_and_prefers_steam() {
        let groups = vec![
            json!({
                "canonicalAchievementId": "c1",
                "variants": [
                    { "shop": "epic", "objectId": "e", "name": "A_EPIC", "displayName": "A", "icon": "ie", "icongray": "ge", "hidden": false, "unlockTime": 5 },
                    { "shop": "steam", "objectId": "s", "name": "A_STEAM", "displayName": "A", "icon": "is", "icongray": "gs/", "hidden": false, "unlockTime": null }
                ]
            }),
            json!({
                "canonicalAchievementId": "c2",
                "variants": [
                    { "shop": "steam", "objectId": "s", "name": "B", "displayName": "B", "icon": "ib", "icongray": "gb", "hidden": true, "unlockTime": null }
                ]
            }),
        ];
        let local = |shop: &str, id: &str| {
            if shop == "steam" && id == "s" {
                vec![StoredUnlock::new("a_steam", 9)]
            } else {
                Vec::new()
            }
        };
        let definitions = |shop: &str, _: &str| {
            if shop == "steam" {
                vec![
                    json!({ "name": "A_STEAM", "globalUnlockPercentage": 12.5, "set": { "id": 2, "name": "DLC", "order": 1 } }),
                ]
            } else {
                Vec::new()
            }
        };
        let list = present_combined(&groups, &local, &definitions);
        assert_eq!(list.len(), 2);
        // both variants unlocked: the Steam one is shown, with its local time
        assert_eq!(list[0].name, "A_STEAM");
        assert_eq!(list[0].unlock_time, Some(9));
        assert_eq!(list[0].icon_gray, "is");
        assert_eq!(list[0].global_unlock_percentage, Some(12.5));
        assert_eq!(list[0].set.as_ref().map(|s| s.id), Some(2));
        assert_eq!(list[0].canonical_id.as_deref(), Some("c1"));
        assert!(!list[1].unlocked);
        assert!(list[1].hidden);
    }
}
