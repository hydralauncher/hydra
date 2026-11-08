//! Comparing a game's achievements with another user:
//! get-compared-unlocked-achievements.ts, compared-achievement-definitions.ts
//! and the comparison helpers of shared/achievement-list.ts.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use hydra_db::{Db, keys};
use serde_json::Value;

use crate::achievement_store::{self, Memory};
use crate::achievements::{Achievement, AchievementSet};
use crate::api::{ApiError, HydraApi, Options};

/// ACHIEVEMENT_DEFINITIONS_TIMEOUT_MS
const DEFINITIONS_TIMEOUT: Duration = Duration::from_secs(5);

/// ownerStat / targetStat
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Stat {
    pub unlocked: bool,
    pub unlock_time: i64,
    pub hardcore_unlock_time: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct ComparedRow {
    pub hidden: bool,
    pub icon: String,
    pub display_name: String,
    pub description: String,
    pub points: Option<i64>,
    pub global_unlock_percentage: Option<f64>,
    pub set: Option<AchievementSet>,
    pub owner: Option<Stat>,
    pub target: Stat,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Totals {
    pub total: i64,
    pub unlocked: i64,
    pub points: Option<i64>,
}

/// `ComparedAchievements`.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Compared {
    pub points_total: i64,
    pub owner: Totals,
    pub target: Totals,
    pub target_name: String,
    pub target_picture: Option<String>,
    pub rows: Vec<ComparedRow>,
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn int(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_f64).map(|v| v as i64)
}

fn stat(value: &Value) -> Stat {
    Stat {
        unlocked: value
            .get("unlocked")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        unlock_time: int(value, "unlockTime").unwrap_or(0),
        hardcore_unlock_time: int(value, "hardcoreUnlockTime"),
    }
}

fn totals(value: Option<&Value>) -> Totals {
    let Some(value) = value else {
        return Totals::default();
    };
    Totals {
        total: int(value, "totalAchievementCount").unwrap_or(0),
        unlocked: int(value, "unlockedAchievementCount").unwrap_or(0),
        points: int(value, "achievementsPointsEarnedSum"),
    }
}

impl Compared {
    pub fn from_json(value: &Value) -> Self {
        let rows = value
            .get("achievements")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .map(|a| ComparedRow {
                        hidden: a.get("hidden").and_then(Value::as_bool).unwrap_or(false),
                        icon: text(a, "icon"),
                        display_name: text(a, "displayName"),
                        description: text(a, "description"),
                        points: int(a, "points"),
                        global_unlock_percentage: a
                            .get("globalUnlockPercentage")
                            .and_then(Value::as_f64),
                        set: a.get("set").and_then(AchievementSet::from_json),
                        owner: a.get("ownerStat").filter(|s| s.is_object()).map(stat),
                        target: a.get("targetStat").map(stat).unwrap_or_default(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let target = value.get("target");
        Self {
            points_total: int(value, "achievementsPointsTotal").unwrap_or(0),
            owner: totals(value.get("owner")),
            target: totals(target),
            target_name: target.map(|t| text(t, "displayName")).unwrap_or_default(),
            target_picture: target
                .and_then(|t| t.get("profileImageUrl"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            rows,
        }
    }

    /// The sort in getComparedUnlockedAchievements: the target's unlocks,
    /// newest first, then the rest with hidden ones last.
    pub fn sort(&mut self) {
        self.rows
            .sort_by(|a, b| match (a.target.unlocked, b.target.unlocked) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                (true, true) => b.target.unlock_time.cmp(&a.target.unlock_time),
                (false, false) => a.hidden.cmp(&b.hidden),
            });
    }

    /// withComparedAchievementDefinitions: percentages and sets from the
    /// game's definitions, matched by icon (and display name when shared).
    pub fn with_definitions(&mut self, definitions: &[Value]) {
        let mut by_icon: HashMap<String, Vec<&Value>> = HashMap::new();
        for definition in definitions {
            by_icon
                .entry(text(definition, "icon"))
                .or_default()
                .push(definition);
        }
        for row in &mut self.rows {
            let candidates = by_icon.get(&row.icon).map(Vec::as_slice).unwrap_or(&[]);
            let definition = if candidates.len() == 1 {
                Some(candidates[0])
            } else {
                candidates
                    .iter()
                    .copied()
                    .find(|d| text(d, "displayName") == row.display_name)
            };
            if row.global_unlock_percentage.is_none() {
                row.global_unlock_percentage = definition
                    .and_then(|d| d.get("globalUnlockPercentage"))
                    .and_then(Value::as_f64);
            }
            if row.set.is_none() {
                row.set = definition
                    .and_then(|d| d.get("set"))
                    .and_then(AchievementSet::from_json);
            }
        }
    }

    /// Whether the viewer's own unlocks came with the comparison.
    pub fn has_owner_stats(&self) -> bool {
        self.rows.iter().any(|r| r.owner.is_some())
    }

    pub fn owner_unlocked(&self, index: usize) -> bool {
        self.rows
            .get(index)
            .and_then(|r| r.owner.as_ref())
            .is_some_and(|s| s.unlocked)
    }

    /// getComparedTargetAchievements: the target's list, named by index.
    pub fn target_achievements(&self) -> Vec<Achievement> {
        self.rows
            .iter()
            .enumerate()
            .map(|(index, row)| Achievement {
                name: index.to_string(),
                display_name: row.display_name.clone(),
                description: row.description.clone(),
                icon: row.icon.clone(),
                icon_gray: row.icon.clone(),
                hidden: row.hidden,
                unlocked: row.target.unlocked,
                unlock_time: row.target.unlocked.then_some(row.target.unlock_time),
                hardcore_unlock_time: row
                    .target
                    .unlocked
                    .then_some(row.target.hardcore_unlock_time)
                    .flatten(),
                points: row.points,
                global_unlock_percentage: row.global_unlock_percentage,
                set: row.set.clone(),
                ..Achievement::default()
            })
            .collect()
    }
}

/// AchievementComparisonFilter
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Filter {
    All,
    Both,
    Neither,
    Owner,
    Target,
}

impl Filter {
    pub fn parse(value: &str) -> Self {
        match value {
            "both" => Filter::Both,
            "neither" => Filter::Neither,
            "owner" => Filter::Owner,
            "target" => Filter::Target,
            _ => Filter::All,
        }
    }

    /// matchesAchievementComparisonFilter
    pub fn matches(self, owner: bool, target: bool) -> bool {
        match self {
            Filter::All => true,
            Filter::Both => owner && target,
            Filter::Neither => !owner && !target,
            Filter::Owner => owner,
            Filter::Target => target,
        }
    }
}

/// getComparedUnlockedAchievements (the first sync with remote is the caller's).
pub fn compared(
    api: &Arc<HydraApi>,
    db: &Arc<Db>,
    memory: &'static Memory,
    shop: &str,
    object_id: &str,
    user_id: &str,
) -> Result<Compared, ApiError> {
    let language = db
        .get::<Value>(keys::USER_PREFERENCES)
        .and_then(|p| {
            p.get("language")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| "en".into());
    // getAchievementDefinitions: in parallel, given up on after 5s
    let (sender, receiver) = std::sync::mpsc::channel();
    {
        let (api, db) = (api.clone(), db.clone());
        let (shop, object_id) = (shop.to_string(), object_id.to_string());
        std::thread::spawn(move || {
            let list = achievement_store::game_achievement_data(
                &api, &db, memory, &shop, &object_id, true,
            )
            .unwrap_or_default();
            let _ = sender.send(list);
        });
    }
    let comparison = api.get(
        &format!("/users/{user_id}/games/achievements/compare"),
        &[
            ("shop", shop.to_string()),
            ("objectId", object_id.to_string()),
            ("language", language),
        ],
        Options::default(),
    );
    let definitions = receiver
        .recv_timeout(DEFINITIONS_TIMEOUT)
        .unwrap_or_default();
    let comparison = comparison?;
    // Electron's sort throws on anything else, and the page keeps its skeleton
    if comparison
        .get("achievements")
        .and_then(Value::as_array)
        .is_none()
    {
        return Err(ApiError::Network(format!(
            "unexpected comparison response: {}",
            comparison.to_string().chars().take(120).collect::<String>()
        )));
    }
    let mut compared = Compared::from_json(&comparison);
    compared.sort();
    compared.with_definitions(&definitions);
    Ok(compared)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> Compared {
        Compared::from_json(&json!({
            "achievementsPointsTotal": 300,
            "owner": { "totalAchievementCount": 3, "unlockedAchievementCount": 1, "achievementsPointsEarnedSum": 50 },
            "target": { "displayName": "Ana", "profileImageUrl": "p.png", "totalAchievementCount": 3, "unlockedAchievementCount": 2, "achievementsPointsEarnedSum": 150 },
            "achievements": [
                { "hidden": true, "icon": "h.png", "displayName": "Hidden", "description": "", "targetStat": { "unlocked": false, "unlockTime": 0 } },
                { "hidden": false, "icon": "a.png", "displayName": "A", "description": "d", "points": 100,
                  "ownerStat": { "unlocked": true, "unlockTime": 5 }, "targetStat": { "unlocked": true, "unlockTime": 10, "hardcoreUnlockTime": 9 } },
                { "hidden": false, "icon": "s.png", "displayName": "Shared", "description": "", "targetStat": { "unlocked": true, "unlockTime": 20 } }
            ]
        }))
    }

    #[test]
    fn sorts_and_attaches_definitions() {
        let mut compared = sample();
        compared.sort();
        let names: Vec<&str> = compared
            .rows
            .iter()
            .map(|r| r.display_name.as_str())
            .collect();
        assert_eq!(names, ["Shared", "A", "Hidden"]);
        compared.with_definitions(&[
            json!({ "icon": "a.png", "displayName": "A", "globalUnlockPercentage": 40.0, "set": { "id": 1, "name": null, "order": 0 } }),
            json!({ "icon": "s.png", "displayName": "Other", "globalUnlockPercentage": 1.0 }),
            json!({ "icon": "s.png", "displayName": "Shared", "globalUnlockPercentage": 2.0 }),
        ]);
        assert_eq!(compared.rows[1].global_unlock_percentage, Some(40.0));
        assert_eq!(compared.rows[1].set.as_ref().map(|s| s.id), Some(1));
        // two definitions share the icon: matched by display name
        assert_eq!(compared.rows[0].global_unlock_percentage, Some(2.0));
        assert_eq!(compared.target_name, "Ana");
        assert_eq!(compared.owner.points, Some(50));
    }

    #[test]
    fn target_list_and_filters() {
        let compared = sample();
        assert!(compared.has_owner_stats());
        let list = compared.target_achievements();
        assert_eq!(list[1].name, "1");
        assert_eq!(list[1].hardcore_unlock_time, Some(9));
        assert_eq!(list[0].unlock_time, None);
        assert!(compared.owner_unlocked(1));
        assert!(!compared.owner_unlocked(2));
        assert!(Filter::parse("both").matches(true, true));
        assert!(!Filter::Both.matches(true, false));
        assert!(Filter::Neither.matches(false, false));
        assert!(Filter::Target.matches(false, true));
    }
}
