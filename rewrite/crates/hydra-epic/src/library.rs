//! library-normalizer.ts: Legendary's `list --json` output (Windows and Mac)
//! into the snapshot games the Hydra API accepts, and Epic's playtime rows.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

use serde::Serialize;
use serde_json::Value;

use crate::error::{EpicError, Result, err};
use crate::protocol::is_integer;

pub const EPIC_MAX_ARTIFACTS: usize = 16;
pub const EPIC_MAX_DLCS_PER_GAME: usize = 64;
pub const EPIC_ID_MAX_LENGTH: usize = 255;
pub const EPIC_GAME_NAME_MAX_LENGTH: usize = 256;
pub const EPIC_MAX_PLAYTIME_SECONDS: i64 = 2_147_483_647;
pub const EPIC_SNAPSHOT_MAX_GAMES: usize = 10_000;

/// EpicSnapshotDlc
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDlc {
    pub artifact_id: String,
    pub namespace: String,
    pub catalog_item_id: String,
    pub name: String,
}

/// EpicSnapshotAchievement
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotAchievement {
    pub external_set_id: String,
    pub external_id: String,
    pub unlock_time: String,
}

/// EpicSnapshotGame
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotGame {
    pub namespace: String,
    pub catalog_item_id: String,
    pub artifact_ids: Vec<String>,
    pub name: String,
    pub play_time_in_seconds: i64,
    /// `undefined` (never collected), `null` (pending) or the unlocks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub achievements: Option<Option<Vec<SnapshotAchievement>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dlcs: Option<Vec<SnapshotDlc>>,
}

impl SnapshotGame {
    pub fn object_id(&self) -> String {
        format!("{}:{}", self.namespace, self.catalog_item_id)
    }
}

fn collator() -> &'static icu_collator::CollatorBorrowed<'static> {
    static COLLATOR: OnceLock<icu_collator::CollatorBorrowed<'static>> = OnceLock::new();
    COLLATOR.get_or_init(|| {
        icu_collator::Collator::try_new(Default::default(), Default::default())
            .expect("root collation data is compiled in")
    })
}

/// compareEpicStrings: `localeCompare(…, "en")`, then code units for
/// distinct strings that collate equally.
pub fn compare_epic_strings(left: &str, right: &str) -> Ordering {
    match collator().compare(left, right) {
        Ordering::Equal if left != right => {
            let a: Vec<u16> = left.encode_utf16().collect();
            let b: Vec<u16> = right.encode_utf16().collect();
            a.cmp(&b)
        }
        other => other,
    }
}

/// validId: 1..=max UTF-16 units, no C0/C1 control characters.
pub fn valid_id(value: &str, max: usize) -> bool {
    let length = value.encode_utf16().count();
    length > 0
        && length <= max
        && !value.chars().any(|c| {
            let code = c as u32;
            code < 32 || (127..=159).contains(&code)
        })
}

fn valid_id_value(value: Option<&Value>, max: usize) -> Option<&str> {
    value.and_then(Value::as_str).filter(|v| valid_id(v, max))
}

/// isEpicObjectId: `namespace:catalogItemId`.
pub fn is_epic_object_id(value: &str) -> bool {
    valid_id(value, EPIC_ID_MAX_LENGTH) && {
        let parts: Vec<&str> = value.split(':').collect();
        parts.len() == 2 && parts.iter().all(|p| valid_id(p, EPIC_ID_MAX_LENGTH))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Classification {
    Include,
    Exclude,
    Unknown,
}

const EXCLUDED_CATEGORIES: [&str; 4] = ["addons", "addons/launchable", "mods", "software"];

/// classifyEpicItem: Legendary lists applications and add-ons too.
pub fn classify_item(metadata: Option<&Value>) -> Classification {
    let Some(metadata) = metadata.filter(|m| m.is_object()) else {
        return Classification::Unknown;
    };
    if metadata.get("namespace").and_then(Value::as_str) == Some("ue")
        || metadata.get("mainGameItem").is_some()
        || metadata
            .get("mainGameItemList")
            .and_then(Value::as_array)
            .is_some_and(|l| !l.is_empty())
    {
        return Classification::Exclude;
    }
    let Some(categories) = metadata
        .get("categories")
        .and_then(Value::as_array)
        .filter(|c| !c.is_empty())
    else {
        return Classification::Unknown;
    };
    let paths: Vec<Option<&str>> = categories
        .iter()
        .map(|row| {
            row.as_object()
                .and_then(|r| r.get("path"))
                .and_then(Value::as_str)
                .filter(|p| !p.is_empty())
        })
        .collect();
    if paths.iter().any(Option::is_none) {
        return Classification::Unknown;
    }
    if paths
        .iter()
        .flatten()
        .any(|p| EXCLUDED_CATEGORIES.contains(p))
    {
        return Classification::Exclude;
    }
    if paths.iter().flatten().any(|p| *p == "games") {
        Classification::Include
    } else {
        Classification::Exclude
    }
}

/// The owner a DLC list belongs to (EpicDlcOwner).
pub struct DlcOwner<'a> {
    pub namespace: &'a str,
    pub catalog_item_id: &'a str,
    pub artifact_ids: &'a [String],
}

/// mergeEpicDlcs: one entry per artifact (the last wins), sorted, capped.
fn merge_dlcs(current: &[SnapshotDlc], added: Vec<SnapshotDlc>) -> Vec<SnapshotDlc> {
    let mut order: Vec<String> = Vec::new();
    let mut by_artifact: HashMap<String, SnapshotDlc> = HashMap::new();
    for dlc in current.iter().cloned().chain(added) {
        if !by_artifact.contains_key(&dlc.artifact_id) {
            order.push(dlc.artifact_id.clone());
        }
        by_artifact.insert(dlc.artifact_id.clone(), dlc);
    }
    let mut merged: Vec<SnapshotDlc> = order
        .into_iter()
        .filter_map(|id| by_artifact.remove(&id))
        .collect();
    merged.sort_by(|a, b| compare_epic_strings(&a.artifact_id, &b.artifact_id));
    merged.truncate(EPIC_MAX_DLCS_PER_GAME);
    merged
}

/// parseEpicSnapshotDlcs
pub fn parse_snapshot_dlcs(value: Option<&Value>, game: &DlcOwner) -> Vec<SnapshotDlc> {
    let Some(rows) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut dlcs = Vec::new();
    for row in rows.iter().filter(|r| r.is_object()) {
        let id = |key: &str| valid_id_value(row.get(key), EPIC_ID_MAX_LENGTH);
        let name = row
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        let (Some(artifact_id), Some(namespace), Some(catalog_item_id)) =
            (id("artifactId"), id("namespace"), id("catalogItemId"))
        else {
            continue;
        };
        if namespace.contains(':')
            || catalog_item_id.contains(':')
            || !valid_id(name, EPIC_GAME_NAME_MAX_LENGTH)
            || game.artifact_ids.iter().any(|a| a == artifact_id)
            || (namespace == game.namespace && catalog_item_id == game.catalog_item_id)
        {
            continue;
        }
        dlcs.push(SnapshotDlc {
            artifact_id: artifact_id.into(),
            namespace: namespace.into(),
            catalog_item_id: catalog_item_id.into(),
            name: name.into(),
        });
    }
    merge_dlcs(&[], dlcs)
}

/// normalizeEpicDlcs: the `dlcs` of a Legendary list row.
pub fn normalize_dlcs(value: Option<&Value>, game: &DlcOwner) -> Vec<SnapshotDlc> {
    let Some(rows) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    let candidates: Vec<Value> = rows
        .iter()
        .filter_map(|row| {
            let metadata = row.get("metadata").filter(|m| m.is_object())?;
            let windows = row
                .get("asset_infos")
                .filter(|a| a.is_object())
                .and_then(|a| a.get("Windows"))
                .filter(|w| w.is_object())?;
            if windows.get("app_name") != row.get("app_name")
                || classify_item(Some(metadata)) != Classification::Exclude
            {
                return None;
            }
            Some(serde_json::json!({
                "artifactId": row.get("app_name"),
                "namespace": metadata.get("namespace"),
                "catalogItemId": metadata.get("id"),
                "name": row.get("app_title"),
            }))
        })
        .collect();
    parse_snapshot_dlcs(Some(&Value::Array(candidates)), game)
}

/// EpicLibraryDiagnostic (logged, never sent).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Diagnostic {
    pub reason: &'static str,
    pub platform_index: usize,
    pub entry_index: Option<usize>,
    pub artifact_id: Option<String>,
    pub name: Option<String>,
    pub namespace: Option<String>,
    pub catalog_item_id: Option<String>,
}

fn printable(value: Option<&Value>, max: usize) -> Option<String> {
    let text = value?.as_str()?;
    let units: Vec<u16> = text.encode_utf16().take(max).collect();
    Some(
        String::from_utf16_lossy(&units)
            .chars()
            .filter(|c| {
                let code = *c as u32;
                code >= 32 && !(127..=159).contains(&code)
            })
            .collect(),
    )
}

fn diagnostic(
    reason: &'static str,
    platform_index: usize,
    entry_index: Option<usize>,
    entry: Option<&Value>,
) -> Diagnostic {
    let row = entry.filter(|e| e.is_object());
    let metadata = row
        .and_then(|r| r.get("metadata"))
        .filter(|m| m.is_object());
    Diagnostic {
        reason,
        platform_index,
        entry_index,
        artifact_id: printable(row.and_then(|r| r.get("app_name")), EPIC_ID_MAX_LENGTH),
        name: printable(
            row.and_then(|r| r.get("app_title")),
            EPIC_GAME_NAME_MAX_LENGTH,
        ),
        namespace: printable(
            metadata.and_then(|m| m.get("namespace")),
            EPIC_ID_MAX_LENGTH,
        ),
        catalog_item_id: printable(metadata.and_then(|m| m.get("id")), EPIC_ID_MAX_LENGTH),
    }
}

/// normalizeEpicLibrary
pub fn normalize_library(
    platforms: &[Value],
    report: &mut dyn FnMut(&Diagnostic),
) -> Result<Vec<SnapshotGame>> {
    let mut invalid = |reason, platform, entry: Option<usize>, row: Option<&Value>| {
        report(&diagnostic(reason, platform, entry, row));
        EpicError::new("snapshot-invalid")
    };
    let mut games: BTreeMap<String, SnapshotGame> = BTreeMap::new();
    let mut artifacts: HashMap<String, String> = HashMap::new();
    for (platform_index, platform) in platforms.iter().enumerate() {
        let Some(entries) = platform.as_array() else {
            return Err(invalid("platform-not-array", platform_index, None, None));
        };
        for (entry_index, entry) in entries.iter().enumerate() {
            let at = Some(entry_index);
            if !entry.is_object() {
                return Err(invalid("item-not-object", platform_index, at, None));
            }
            let classification = classify_item(entry.get("metadata"));
            if classification == Classification::Exclude {
                continue;
            }
            let Some(metadata) = entry
                .get("metadata")
                .filter(|m| m.is_object() && classification == Classification::Include)
            else {
                return Err(invalid(
                    "classification-incomplete",
                    platform_index,
                    at,
                    Some(entry),
                ));
            };
            let namespace = valid_id_value(metadata.get("namespace"), EPIC_ID_MAX_LENGTH);
            let id = valid_id_value(metadata.get("id"), EPIC_ID_MAX_LENGTH);
            let artifact = valid_id_value(entry.get("app_name"), EPIC_ID_MAX_LENGTH);
            let (Some(namespace), Some(id), Some(artifact)) = (namespace, id, artifact) else {
                return Err(invalid(
                    "item-identity-invalid",
                    platform_index,
                    at,
                    Some(entry),
                ));
            };
            let object_id = format!("{namespace}:{id}");
            if namespace.contains(':') || id.contains(':') || !is_epic_object_id(&object_id) {
                return Err(invalid(
                    "item-identity-invalid",
                    platform_index,
                    at,
                    Some(entry),
                ));
            }
            if let Some(assets) = entry.get("asset_infos").and_then(Value::as_object) {
                for asset in assets.values() {
                    let mismatch = |key: &str, expected: &str| {
                        asset.get(key).is_some_and(|v| v.as_str() != Some(expected))
                    };
                    if !asset.is_object()
                        || mismatch("app_name", artifact)
                        || mismatch("namespace", namespace)
                        || mismatch("catalog_item_id", id)
                    {
                        return Err(invalid(
                            "asset-identity-mismatch",
                            platform_index,
                            at,
                            Some(entry),
                        ));
                    }
                }
            }
            if artifacts
                .get(artifact)
                .is_some_and(|previous| *previous != object_id)
            {
                return Err(invalid(
                    "artifact-identity-conflict",
                    platform_index,
                    at,
                    Some(entry),
                ));
            }
            artifacts.insert(artifact.to_string(), object_id.clone());
            let name = entry
                .get("app_title")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            if !valid_id(name, EPIC_GAME_NAME_MAX_LENGTH) {
                return Err(invalid("title-invalid", platform_index, at, Some(entry)));
            }
            let existing_artifacts: Vec<String> = games
                .get(&object_id)
                .map(|g| {
                    let mut ids = g.artifact_ids.clone();
                    ids.push(artifact.to_string());
                    ids
                })
                .unwrap_or_else(|| vec![artifact.to_string()]);
            let dlcs = normalize_dlcs(
                entry.get("dlcs"),
                &DlcOwner {
                    namespace,
                    catalog_item_id: id,
                    artifact_ids: &existing_artifacts,
                },
            );
            if let Some(existing) = games.get_mut(&object_id) {
                if !dlcs.is_empty() {
                    existing.dlcs = Some(merge_dlcs(
                        existing.dlcs.as_deref().unwrap_or_default(),
                        dlcs,
                    ));
                }
                let mut ids = existing.artifact_ids.clone();
                if !ids.iter().any(|a| a == artifact) {
                    ids.push(artifact.to_string());
                }
                ids.sort_by(|a, b| compare_epic_strings(a, b));
                existing.artifact_ids = ids;
                if existing.artifact_ids.len() > EPIC_MAX_ARTIFACTS {
                    return Err(invalid(
                        "artifact-limit-exceeded",
                        platform_index,
                        at,
                        Some(entry),
                    ));
                }
                // Stable across platforms and order, without titles as identity.
                if compare_epic_strings(name, &existing.name) == Ordering::Less {
                    existing.name = name.to_string();
                }
            } else {
                games.insert(
                    object_id,
                    SnapshotGame {
                        namespace: namespace.into(),
                        catalog_item_id: id.into(),
                        artifact_ids: vec![artifact.into()],
                        name: name.into(),
                        play_time_in_seconds: 0,
                        achievements: None,
                        dlcs: (!dlcs.is_empty()).then_some(dlcs),
                    },
                );
            }
        }
    }
    if games.len() > EPIC_SNAPSHOT_MAX_GAMES {
        return err("snapshot-too-large");
    }
    // Sorted by object id code units (BTreeMap orders bytes; for the BMP
    // UTF-8 and UTF-16 orders agree except around surrogates).
    let mut sorted: Vec<(String, SnapshotGame)> = games.into_iter().collect();
    sorted.sort_by(|(a, _), (b, _)| {
        a.encode_utf16()
            .collect::<Vec<_>>()
            .cmp(&b.encode_utf16().collect::<Vec<_>>())
    });
    Ok(sorted.into_iter().map(|(_, g)| g).collect())
}

/// normalizeEpicPlaytime: `/library/api/public/playtime/account/<id>/all`.
pub fn normalize_playtime(input: &Value, account_id: &str) -> Result<HashMap<String, i64>> {
    let rows = input
        .as_array()
        .ok_or_else(|| EpicError::new("invalid-response"))?;
    let mut times = HashMap::new();
    for row in rows {
        let artifact = valid_id_value(row.get("artifactId"), EPIC_ID_MAX_LENGTH);
        let total = row
            .get("totalTime")
            .filter(|t| is_integer(t))
            .and_then(Value::as_f64)
            .filter(|t| *t >= 0.0 && *t <= EPIC_MAX_PLAYTIME_SECONDS as f64);
        let (true, Some(artifact), Some(total)) = (
            row.is_object() && row.get("accountId").and_then(Value::as_str) == Some(account_id),
            artifact,
            total,
        ) else {
            return err("invalid-response");
        };
        let total = total as i64;
        let entry = times.entry(artifact.to_string()).or_insert(0);
        *entry = (*entry).max(total);
    }
    Ok(times)
}

/// getEpicGamePlaytime: the largest total among the game's artifacts.
pub fn game_playtime(artifact_ids: &[String], times: &HashMap<String, i64>) -> Option<i64> {
    artifact_ids
        .iter()
        .filter_map(|id| times.get(id))
        .copied()
        .max()
}

/// applyEpicPlaytime
pub fn apply_playtime(games: Vec<SnapshotGame>, times: &HashMap<String, i64>) -> Vec<SnapshotGame> {
    games
        .into_iter()
        .map(|mut game| {
            game.play_time_in_seconds = game_playtime(&game.artifact_ids, times).unwrap_or(0);
            game
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(app: &str, title: &str, namespace: &str, id: &str, category: &str) -> Value {
        json!({
            "app_name": app,
            "app_title": title,
            "metadata": {"namespace": namespace, "id": id, "categories": [{"path": category}]},
            "asset_infos": {"Windows": {"app_name": app, "namespace": namespace, "catalog_item_id": id}},
        })
    }

    #[test]
    fn classifies_items() {
        assert_eq!(classify_item(None), Classification::Unknown);
        assert_eq!(
            classify_item(Some(
                &json!({"categories": [{"path": "games"}, {"path": "applications"}]})
            )),
            Classification::Include
        );
        assert_eq!(
            classify_item(Some(
                &json!({"categories": [{"path": "games"}, {"path": "addons"}]})
            )),
            Classification::Exclude
        );
        assert_eq!(
            classify_item(Some(
                &json!({"namespace": "ue", "categories": [{"path": "games"}]})
            )),
            Classification::Exclude
        );
        assert_eq!(
            classify_item(Some(&json!({"mainGameItem": null}))),
            Classification::Exclude
        );
        assert_eq!(
            classify_item(Some(&json!({"categories": [{"path": ""}]}))),
            Classification::Unknown
        );
        assert_eq!(
            classify_item(Some(&json!({"categories": [{"path": "applications"}]}))),
            Classification::Exclude
        );
    }

    #[test]
    fn normalizes_and_merges_platforms() {
        let mut windows = row("Beta", "Game B", "ns", "id", "games");
        windows["dlcs"] = json!([
            {"app_name": "DlcA", "app_title": " Dlc ", "metadata": {"namespace": "ns", "id": "dlc", "mainGameItem": {}}, "asset_infos": {"Windows": {"app_name": "DlcA"}}},
            {"app_name": "Bad", "app_title": "x", "metadata": {"namespace": "ns", "id": "x", "categories": [{"path": "games"}]}, "asset_infos": {"Windows": {"app_name": "Bad"}}}
        ]);
        let mac = row("alpha", "Game A", "ns", "id", "games");
        let addon = row("Addon", "Addon", "ns2", "a", "addons");
        let other = row("Zed", "Zed", "aaa", "1", "games");
        let mut reports = Vec::new();
        let games = normalize_library(&[json!([windows, addon, other]), json!([mac])], &mut |d| {
            reports.push(d.clone())
        })
        .unwrap();
        assert!(reports.is_empty());
        assert_eq!(games.len(), 2);
        assert_eq!(games[0].object_id(), "aaa:1");
        let merged = &games[1];
        // localeCompare("alpha", "Beta") < 0 although "B" < "a" in bytes
        assert_eq!(merged.artifact_ids, ["alpha", "Beta"]);
        assert_eq!(merged.name, "Game A");
        let dlcs = merged.dlcs.as_ref().unwrap();
        assert_eq!(dlcs.len(), 1);
        assert_eq!(dlcs[0].name, "Dlc");
        let value = serde_json::to_value(merged).unwrap();
        assert_eq!(value["catalogItemId"], "id");
        assert!(value.get("achievements").is_none());
    }

    #[test]
    fn rejects_inconsistent_rows() {
        let mut reports = Vec::new();
        let mut bad = row("A", "T", "ns", "id", "games");
        bad["asset_infos"]["Mac"] = json!({"app_name": "Other"});
        assert_eq!(
            normalize_library(&[json!([bad])], &mut |d| reports.push(d.clone()))
                .unwrap_err()
                .code(),
            "snapshot-invalid"
        );
        assert_eq!(reports[0].reason, "asset-identity-mismatch");
        let unknown =
            json!({"app_name": "A", "app_title": "T", "metadata": {"namespace": "n", "id": "i"}});
        assert!(normalize_library(&[json!([unknown])], &mut |_| {}).is_err());
        let conflict = [
            row("A", "T", "ns", "one", "games"),
            row("A", "T", "ns", "two", "games"),
        ];
        assert!(normalize_library(&[json!(conflict)], &mut |_| {}).is_err());
        assert!(normalize_library(&[json!({})], &mut |_| {}).is_err());
    }

    #[test]
    fn playtime() {
        let account = "0123456789abcdef0123456789abcdef";
        let times = normalize_playtime(
            &json!([
                {"accountId": account, "artifactId": "A", "totalTime": 30},
                {"accountId": account, "artifactId": "A", "totalTime": 10},
                {"accountId": account, "artifactId": "B", "totalTime": 50},
            ]),
            account,
        )
        .unwrap();
        assert_eq!(times["A"], 30);
        assert_eq!(game_playtime(&["A".into(), "B".into()], &times), Some(50));
        assert_eq!(game_playtime(&["C".into()], &times), None);
        assert!(
            normalize_playtime(
                &json!([{"accountId": "x", "artifactId": "A", "totalTime": 1}]),
                account
            )
            .is_err()
        );
        assert!(
            normalize_playtime(
                &json!([{"accountId": account, "artifactId": "A", "totalTime": 1.5}]),
                account
            )
            .is_err()
        );
    }

    #[test]
    fn object_ids() {
        assert!(is_epic_object_id("ns:item"));
        assert!(!is_epic_object_id("ns:item:x"));
        assert!(!is_epic_object_id(":item"));
        assert!(!is_epic_object_id("ns:it\u{7}em"));
    }
}
