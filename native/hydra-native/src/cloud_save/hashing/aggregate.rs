use serde::Serialize;

use crate::cloud_save::identity::PortableLocator;

use super::types::BuildSnapshotAggregateHashInput;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalSnapshotFile<'a> {
    logical_file_id: &'a str,
    variant_id: &'a str,
    rule_id: &'a str,
    locator: &'a PortableLocator,
    relative_path: &'a str,
    content_hash: &'a str,
    size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalSnapshot<'a> {
    schema_version: u32,
    save_namespace_key: &'a str,
    files: Vec<CanonicalSnapshotFile<'a>>,
}

fn canonical_size_bytes(size_bytes: f64) -> Result<u64, String> {
    if !size_bytes.is_finite()
        || size_bytes < 0.0
        || size_bytes.fract() != 0.0
        || size_bytes >= u64::MAX as f64
    {
        return Err("cloud_save_invalid_size_bytes".to_string());
    }

    Ok(size_bytes as u64)
}

pub fn build_hash(mut input: BuildSnapshotAggregateHashInput) -> Result<String, String> {
    input
        .files
        .sort_by(|left, right| left.logical_file_id.cmp(&right.logical_file_id));
    if input
        .files
        .windows(2)
        .any(|files| files[0].logical_file_id == files[1].logical_file_id)
    {
        return Err("cloud_save_duplicate_logical_file_id".to_string());
    }

    let snapshot = CanonicalSnapshot {
        schema_version: input.schema_version,
        save_namespace_key: &input.save_namespace_key,
        files: input
            .files
            .iter()
            .map(|file| {
                Ok(CanonicalSnapshotFile {
                    logical_file_id: &file.logical_file_id,
                    variant_id: &file.variant_id,
                    rule_id: &file.rule_id,
                    locator: &file.locator,
                    relative_path: &file.relative_path,
                    content_hash: &file.content_hash,
                    size_bytes: canonical_size_bytes(file.size_bytes)?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
    };
    let serialized = serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?;

    Ok(blake3::hash(&serialized).to_hex().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_save::hashing::types::SnapshotAggregateHashFile;
    use crate::cloud_save::identity::{PortableBindings, PortableStoreUserIdentity};

    fn file(id: &str, content_hash: &str, size_bytes: f64) -> SnapshotAggregateHashFile {
        SnapshotAggregateHashFile {
            logical_file_id: id.into(),
            variant_id: "variant".into(),
            rule_id: "rule".into(),
            relative_path: format!("{id}.sav"),
            locator: PortableLocator {
                version: 1,
                rule_id: "rule".into(),
                raw_rule: "<home>/game".into(),
                rule_source: "test".into(),
                root_kind: "home".into(),
                bindings: PortableBindings {
                    store: "steam".into(),
                    store_game_id: "1".into(),
                    store_user: PortableStoreUserIdentity {
                        kind: "opaque-folder".into(),
                        store: "steam".into(),
                        steam_id64: None,
                        account_id32: None,
                        concrete_folder_id: "__unbound__".into(),
                    },
                },
                target_semantics: "directory-tree".into(),
            },
            content_hash: content_hash.into(),
            size_bytes,
        }
    }

    fn hash(files: Vec<SnapshotAggregateHashFile>) -> String {
        build_hash(BuildSnapshotAggregateHashInput {
            schema_version: 2,
            save_namespace_key: "steam:1".into(),
            files,
        })
        .unwrap()
    }

    #[test]
    fn aggregate_hash_is_independent_of_input_order() {
        let first = file("one", "a", 10.0);
        let second = file("two", "b", 20.0);
        assert_eq!(
            hash(vec![first.clone(), second.clone()]),
            hash(vec![second, first])
        );
    }

    #[test]
    fn identity_and_content_change_hash() {
        let baseline = hash(vec![file("one", "a", 10.0)]);
        assert_ne!(baseline, hash(vec![file("two", "a", 10.0)]));
        assert_ne!(baseline, hash(vec![file("one", "b", 10.0)]));
        assert_ne!(baseline, hash(vec![file("one", "a", 11.0)]));
    }

    #[test]
    fn rejects_invalid_sizes_and_duplicate_ids() {
        for size_bytes in [f64::NAN, f64::INFINITY, -1.0, 1.5, u64::MAX as f64] {
            assert_eq!(
                build_hash(BuildSnapshotAggregateHashInput {
                    schema_version: 2,
                    save_namespace_key: "steam:1".into(),
                    files: vec![file("one", "a", size_bytes)],
                })
                .unwrap_err(),
                "cloud_save_invalid_size_bytes"
            );
        }
        assert_eq!(
            build_hash(BuildSnapshotAggregateHashInput {
                schema_version: 2,
                save_namespace_key: "steam:1".into(),
                files: vec![file("one", "a", 1.0), file("one", "a", 1.0)],
            })
            .unwrap_err(),
            "cloud_save_duplicate_logical_file_id"
        );
    }
}
