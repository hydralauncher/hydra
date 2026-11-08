//! A game's achievements for the signed-in user, as the game page shows them.
//!
//! Ports src/main/events/user/get-unlocked-achievements.ts
//! (`getUnlockedAchievements`) with get-game-achievement-data.ts,
//! get-achievement-souvenirs.ts (`fetchRemoteUserGameAchievements`) and
//! combined-achievement-presentation.ts.
//!
//! Not ported yet: unlocks found by the local achievement watcher
//! (AchievementMemoryStore); only the user's remote unlocks are merged.

use std::collections::HashMap;
use std::time::Duration;

use hydra_db::{Db, keys};
use serde_json::Value;

use crate::api::{ApiError, HydraApi, Options};

#[derive(Clone, Debug, PartialEq)]
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
    /// Souvenir screenshot, when the user has one.
    pub image_url: Option<String>,
    pub global_unlock_percentage: Option<f64>,
}

fn text(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

/// `levelKeys.language` is stored as plain UTF-8, not JSON.
fn achievement_language(db: &Db) -> String {
    db.get_utf8(keys::LANGUAGE).filter(|l| !l.is_empty()).unwrap_or_else(|| "en".into())
}

/// The account-level language (userPreferences.language) used for remote requests.
fn preferences_language(db: &Db) -> String {
    db.get::<Value>(keys::USER_PREFERENCES)
        .and_then(|p| p.get("language").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| "en".into())
}

fn icon_gray(icon: &str, icongray: &str) -> String {
    if icongray.ends_with('/') || icongray.is_empty() { icon.to_string() } else { icongray.to_string() }
}

/// `getUnlockedAchievements(objectId, shop)`.
pub fn unlocked_achievements(api: &HydraApi, db: &Db, shop: &str, object_id: &str) -> Result<Vec<Achievement>, ApiError> {
    if shop == "custom" {
        return Ok(Vec::new());
    }
    let language = achievement_language(db);
    let catalogue = api
        .get(
            &format!("/games/{shop}/{object_id}/achievements"),
            &[("language", language.clone())],
            Options::default(),
        )
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();

    let remote_language = preferences_language(db);
    let user_id = db.get::<Value>(keys::USER).map(|u| text(&u, "id")).unwrap_or_default();
    let remote: Vec<Value> = if user_id.is_empty() {
        Vec::new()
    } else {
        api.get(
            &format!("/users/{user_id}/games/achievements"),
            &[
                ("shop", shop.to_string()),
                ("objectId", object_id.to_string()),
                ("language", remote_language.clone()),
            ],
            Options::default(),
        )
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
    };
    let souvenirs: HashMap<String, String> = remote
        .iter()
        .filter_map(|a| {
            let url = a.get("imageUrl").and_then(Value::as_str).filter(|u| !u.is_empty())?;
            Some((text(a, "name").to_uppercase(), url.to_string()))
        })
        .collect();
    let unlocked: HashMap<String, i64> = remote
        .iter()
        .filter_map(|a| {
            let name = text(a, "name");
            let time = a.get("unlockTime").and_then(Value::as_f64)?;
            (!name.is_empty() && time > 0.0).then(|| (name.to_uppercase(), time as i64))
        })
        .collect();

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
                g.get("variants").and_then(Value::as_array).is_some_and(|vs| {
                    vs.iter().any(|v| text(v, "shop") == shop && text(v, "objectId") == object_id)
                })
            });
            if !groups.is_empty() && includes_copy {
                return Ok(present_combined(groups, &catalogue));
            }
        }
    }

    let definitions: Vec<Value> = if !catalogue.is_empty() { catalogue } else { remote.clone() };
    let mut list: Vec<Achievement> = definitions
        .iter()
        .map(|d| {
            let name = text(d, "name");
            let key = name.to_uppercase();
            let icon = text(d, "icon");
            let gray = icon_gray(&icon, &text(d, "icongray"));
            let display_name = Some(text(d, "displayName")).filter(|s| !s.is_empty()).unwrap_or_else(|| name.clone());
            let unlock_time = unlocked.get(&key).copied();
            Achievement {
                display_name,
                description: text(d, "description"),
                icon_gray: gray,
                icon,
                hidden: d.get("hidden").and_then(Value::as_bool).unwrap_or(false)
                    || d.get("hidden").and_then(Value::as_i64) == Some(1),
                unlocked: unlock_time.is_some(),
                unlock_time,
                image_url: unlock_time.and(souvenirs.get(&key).cloned()),
                global_unlock_percentage: d.get("globalUnlockPercentage").and_then(Value::as_f64),
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
/// unlocked (Steam-first) variant shown.
fn present_combined(groups: &[Value], catalogue: &[Value]) -> Vec<Achievement> {
    let definitions: HashMap<String, &Value> =
        catalogue.iter().map(|d| (text(d, "name").to_uppercase(), d)).collect();
    let mut list: Vec<Achievement> = groups
        .iter()
        .filter_map(|group| {
            let variants = group.get("variants").and_then(Value::as_array)?;
            let unlocked: Vec<&Value> = variants
                .iter()
                .filter(|v| v.get("unlockTime").and_then(Value::as_f64).is_some())
                .collect();
            let choices: Vec<&Value> = if unlocked.is_empty() { variants.iter().collect() } else { unlocked };
            let selected = choices.iter().find(|v| text(v, "shop") == "steam").or(choices.first())?;
            let name = text(selected, "name");
            let icon = text(selected, "icon");
            let unlock_time = selected.get("unlockTime").and_then(Value::as_f64).map(|t| t as i64);
            let percentage = std::iter::once(*selected)
                .chain(variants.iter())
                .find_map(|v| {
                    definitions
                        .get(&text(v, "name").to_uppercase())
                        .and_then(|d| d.get("globalUnlockPercentage"))
                        .and_then(Value::as_f64)
                });
            Some(Achievement {
                display_name: Some(text(selected, "displayName")).filter(|s| !s.is_empty()).unwrap_or_else(|| name.clone()),
                description: text(selected, "description"),
                icon_gray: icon_gray(&icon, &text(selected, "icongray")),
                icon,
                hidden: selected.get("hidden").and_then(Value::as_bool).unwrap_or(false),
                unlocked: unlock_time.is_some(),
                unlock_time,
                image_url: selected.get("imageUrl").and_then(Value::as_str).map(str::to_string),
                global_unlock_percentage: percentage,
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
