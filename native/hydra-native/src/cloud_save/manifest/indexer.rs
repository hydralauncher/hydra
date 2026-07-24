use anyhow::{bail, Context, Result};
use indexmap::IndexMap;
use serde_yaml_ng::{Mapping, Value};

use super::types::{ManifestFileRule, ManifestGameEntry, ManifestIndex, ManifestRuleCondition};
use crate::constants::MANIFEST_INDEX_VERSION;

fn string_value(value: &Value) -> Option<String> {
    value.as_str().map(ToString::to_string)
}

fn mapping_value<'a>(mapping: &'a Mapping, key: &str) -> Option<&'a Value> {
    mapping.get(Value::String(key.to_string()))
}

fn read_tags(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_sequence)
        .map(|items| items.iter().filter_map(string_value).collect())
        .unwrap_or_default()
}

fn read_conditions(value: Option<&Value>) -> Vec<ManifestRuleCondition> {
    value
        .and_then(Value::as_sequence)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let mapping = item.as_mapping()?;
                    let os = mapping_value(mapping, "os").and_then(string_value);
                    let store = mapping_value(mapping, "store").and_then(string_value);
                    (os.is_some() || store.is_some()).then_some(ManifestRuleCondition { os, store })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn map_game_entry(manifest_key: &str, value: &Value) -> Option<ManifestGameEntry> {
    let game = value.as_mapping()?;
    let files = mapping_value(game, "files")?.as_mapping()?;
    let files = files
        .iter()
        .filter_map(|(raw_path, metadata)| {
            let raw_path = string_value(raw_path)?;
            let metadata = metadata.as_mapping();
            Some(ManifestFileRule {
                raw_path,
                tags: metadata
                    .map(|m| read_tags(mapping_value(m, "tags")))
                    .unwrap_or_default(),
                when: metadata
                    .map(|m| read_conditions(mapping_value(m, "when")))
                    .unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    (!files.is_empty()).then_some(ManifestGameEntry {
        manifest_key: manifest_key.to_string(),
        files,
    })
}

pub fn build_manifest_index(
    raw_yaml: &str,
    source_url: &str,
    fetched_at: i64,
) -> Result<ManifestIndex> {
    let root: Value = serde_yaml_ng::from_str(raw_yaml)
        .with_context(|| format!("Failed to parse cloud save manifest from {source_url}"))?;
    let Some(root) = root.as_mapping() else {
        bail!("Cloud save manifest root from {source_url} must be a YAML map");
    };
    let mut games = IndexMap::new();

    for (key, value) in root {
        let Some(manifest_key) = string_value(key) else {
            continue;
        };
        if let Some(entry) = map_game_entry(&manifest_key, value) {
            games.insert(manifest_key, entry);
        }
    }

    Ok(ManifestIndex {
        version: MANIFEST_INDEX_VERSION,
        fetched_at,
        source_url: source_url.to_string(),
        games,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_save::manifest::source::resolve_source_url;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[tokio::test]
    async fn builds_index_from_real_manifest() {
        let source_url = resolve_source_url(None);

        let raw_yaml = reqwest::get(&source_url)
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .text()
            .await
            .unwrap();

        let fetched_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        let index = build_manifest_index(&raw_yaml, &source_url, fetched_at).unwrap();

        let example = index
            .games
            .values()
            .flat_map(|game| game.files.iter().map(move |file| (game, file)))
            .find(|(_, file)| !file.tags.is_empty() || !file.when.is_empty())
            .expect("no file with tags or conditions found");

        println!("{}", serde_json::to_string_pretty(&example).unwrap());

        assert_eq!(index.version, 1);
        assert_eq!(index.source_url, source_url);
        assert_eq!(index.fetched_at, fetched_at);
        assert!(!index.games.is_empty());
    }
}
