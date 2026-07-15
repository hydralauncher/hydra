use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

use super::types::{ManifestGameEntry, ManifestIndex};

fn normalize_manifest_key(value: &str) -> String {
    value
        .nfkd()
        .filter(|character| !is_combining_mark(*character) && character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

pub fn find_manifest_entry<'a>(
    index: &'a ManifestIndex,
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
        if let Some(entry) = index.games.get(*candidate) {
            return Some(entry);
        }
    }

    for candidate in candidates {
        let normalized_candidate = normalize_manifest_key(candidate);
        if let Some(entry) = index.games.iter().find_map(|(key, entry)| {
            (normalize_manifest_key(key) == normalized_candidate).then_some(entry)
        }) {
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
    use tempfile::tempdir;

    #[tokio::test]
    async fn finds_balatro_from_real_manifest() {
        let source_url = resolve_source_url(None);
        let cache_directory = tempdir().unwrap();

        let index = get_manifest_index(
            cache_directory.path(),
            &source_url,
        )
        .await
        .unwrap();

        let result = find_manifest_entry(
            &index,
            "2379780",
            None,
            Some("Balatro"),
        )
        .expect("Balatro should be found in the real manifest");

        println!(
            "{}",
            serde_json::to_string_pretty(result).unwrap()
        );

        assert_eq!(result.manifest_key, "2379780");
        assert!(!result.files.is_empty());
    }
}
