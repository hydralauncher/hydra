use std::collections::HashMap;

use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

use super::types::{ManifestGameEntry, ManifestIndex};

fn normalize_manifest_key(value: &str) -> String {
    value
        .nfkd()
        .filter(|character| !is_combining_mark(*character) && character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

pub struct ManifestLookupIndex {
    pub manifest: ManifestIndex,
    normalized_games: HashMap<String, String>,
}

impl ManifestLookupIndex {
    pub fn new(manifest: ManifestIndex) -> Self {
        let mut normalized_games = HashMap::new();
        for key in manifest.games.keys() {
            normalized_games
                .entry(normalize_manifest_key(key))
                .or_insert_with(|| key.clone());
        }

        Self {
            manifest,
            normalized_games,
        }
    }
}

pub fn find_manifest_entry<'a>(
    index: &'a ManifestLookupIndex,
    object_id: &str,
    remote_id: Option<&str>,
    title: Option<&str>,
) -> Option<&'a ManifestGameEntry> {
    let candidates = [Some(object_id), remote_id, title]
        .into_iter()
        .flatten()
        .filter(|candidate| !candidate.is_empty())
        .collect::<Vec<_>>();

    for candidate in &candidates {
        if let Some(entry) = index.manifest.games.get(*candidate) {
            return Some(entry);
        }
    }

    for candidate in candidates {
        let normalized_candidate = normalize_manifest_key(candidate);
        if let Some(entry) = index
            .normalized_games
            .get(&normalized_candidate)
            .and_then(|key| index.manifest.games.get(key))
        {
            return Some(entry);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_save::manifest::cache::get_manifest_index;
    use crate::cloud_save::manifest::source::resolve_source_url;
    use crate::cloud_save::manifest::types::ManifestGameEntry;
    use indexmap::IndexMap;
    use tempfile::tempdir;

    #[test]
    fn normalized_lookup_preserves_exact_matches_and_manifest_order() {
        let entry = |manifest_key: &str| ManifestGameEntry {
            manifest_key: manifest_key.to_string(),
            files: vec![],
        };
        let mut games = IndexMap::new();
        games.insert("Pokémon".to_string(), entry("Pokémon"));
        games.insert("Pokemon".to_string(), entry("Pokemon"));
        let index = ManifestLookupIndex::new(ManifestIndex {
            version: 1,
            fetched_at: 0,
            source_url: "test".to_string(),
            games,
        });

        assert_eq!(
            find_manifest_entry(&index, "missing", None, Some("Pokemon"))
                .unwrap()
                .manifest_key,
            "Pokemon"
        );
        assert_eq!(
            find_manifest_entry(&index, "missing", None, Some("POKEMON"))
                .unwrap()
                .manifest_key,
            "Pokémon"
        );
    }

    #[tokio::test]
    async fn finds_balatro_from_real_manifest() {
        let source_url = resolve_source_url(None);
        let cache_directory = tempdir().unwrap();

        let index = get_manifest_index(cache_directory.path(), &source_url)
            .await
            .unwrap();

        let result = find_manifest_entry(&index, "2379780", None, Some("Balatro"))
            .expect("Balatro should be found in the real manifest");

        println!("{}", serde_json::to_string_pretty(result).unwrap());

        assert_eq!(result.manifest_key, "2379780");
        assert!(!result.files.is_empty());
    }
}
