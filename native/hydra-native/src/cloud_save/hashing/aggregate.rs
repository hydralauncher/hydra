use serde::Serialize;
use sha2::{Digest, Sha256};

use super::types::BuildSnapshotAggregateHashInput;
use crate::cloud_save::identity::SnapshotVariant;

const SNAPSHOT_HASH_VERSION: u32 = 1;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalSnapshotVariant<'a> {
    variant_id: &'a str,
    kind: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    steam_id64: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    concrete_folder_id: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalSnapshotFile<'a> {
    variant_id: &'a str,
    raw_path: &'a str,
    relative_path: &'a str,
    hash: &'a str,
    size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalSnapshot<'a> {
    snapshot_hash_version: u32,
    variants: Vec<CanonicalSnapshotVariant<'a>>,
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

fn validate_variant(variant: &SnapshotVariant) -> Result<(), String> {
    let valid = match variant.kind.as_str() {
        "default" => variant.steam_id64.is_none() && variant.concrete_folder_id.is_none(),
        "steam-account" => {
            variant.steam_id64.as_deref().is_some_and(|value| {
                value.len() == 17 && value.bytes().all(|byte| byte.is_ascii_digit())
            }) && variant.concrete_folder_id.is_none()
        }
        "opaque-folder" => {
            variant.steam_id64.is_none()
                && variant
                    .concrete_folder_id
                    .as_deref()
                    .is_some_and(crate::cloud_save::identity::is_safe_capture)
        }
        _ => false,
    };
    valid
        .then_some(())
        .ok_or_else(|| "cloud_save_invalid_snapshot_variant".to_string())
}

pub fn build_hash(mut input: BuildSnapshotAggregateHashInput) -> Result<String, String> {
    input
        .variants
        .sort_by(|left, right| left.variant_id.cmp(&right.variant_id));
    input.files.sort_by(|left, right| {
        left.variant_id
            .cmp(&right.variant_id)
            .then_with(|| left.raw_path.cmp(&right.raw_path))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
            .then_with(|| left.hash.cmp(&right.hash))
            .then_with(|| left.size_bytes.total_cmp(&right.size_bytes))
    });

    for variant in &input.variants {
        validate_variant(variant)?;
    }

    let snapshot = CanonicalSnapshot {
        snapshot_hash_version: SNAPSHOT_HASH_VERSION,
        variants: input
            .variants
            .iter()
            .map(|variant| CanonicalSnapshotVariant {
                variant_id: &variant.variant_id,
                kind: &variant.kind,
                steam_id64: variant.steam_id64.as_deref(),
                concrete_folder_id: variant.concrete_folder_id.as_deref(),
            })
            .collect(),
        files: input
            .files
            .iter()
            .map(|file| {
                Ok(CanonicalSnapshotFile {
                    variant_id: &file.variant_id,
                    raw_path: &file.raw_path,
                    relative_path: &file.relative_path,
                    hash: &file.hash,
                    size_bytes: canonical_size_bytes(file.size_bytes)?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
    };
    let serialized = serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?;
    Ok(format!("{:x}", Sha256::digest(serialized)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_save::hashing::types::SnapshotAggregateHashFile;

    fn variant(id: &str) -> SnapshotVariant {
        SnapshotVariant {
            variant_id: id.into(),
            kind: "default".into(),
            steam_id64: None,
            concrete_folder_id: None,
        }
    }

    fn file(
        variant_id: &str,
        raw_path: &str,
        relative_path: &str,
        hash: &str,
        size_bytes: f64,
    ) -> SnapshotAggregateHashFile {
        SnapshotAggregateHashFile {
            variant_id: variant_id.into(),
            raw_path: raw_path.into(),
            relative_path: relative_path.into(),
            hash: hash.into(),
            size_bytes,
        }
    }

    fn hash(variants: Vec<SnapshotVariant>, files: Vec<SnapshotAggregateHashFile>) -> String {
        build_hash(BuildSnapshotAggregateHashInput { variants, files }).unwrap()
    }

    #[test]
    fn aggregate_hash_is_independent_of_input_order() {
        let first = file("v", "<home>/game", "one.sav", "a", 10.0);
        let second = file("v", "<home>/game", "two.sav", "b", 20.0);

        assert_eq!(
            hash(vec![variant("v")], vec![first.clone(), second.clone()]),
            hash(vec![variant("v")], vec![second, first])
        );
    }

    #[test]
    fn identity_changes_with_variant_path_hash_or_size() {
        let baseline = hash(
            vec![variant("v")],
            vec![file("v", "<home>/game", "save.dat", "a", 10.0)],
        );
        for changed in [
            file("other", "<home>/game", "save.dat", "a", 10.0),
            file("v", "<home>/other", "save.dat", "a", 10.0),
            file("v", "<home>/game", "other.dat", "a", 10.0),
            file("v", "<home>/game", "save.dat", "b", 10.0),
            file("v", "<home>/game", "save.dat", "a", 11.0),
        ] {
            assert_ne!(baseline, hash(vec![variant("v")], vec![changed]));
        }
    }

    #[test]
    fn rejects_invalid_sizes() {
        for size_bytes in [f64::NAN, f64::INFINITY, -1.0, 1.5, u64::MAX as f64] {
            let error = build_hash(BuildSnapshotAggregateHashInput {
                variants: vec![variant("v")],
                files: vec![file("v", "<home>/game", "save.dat", "a", size_bytes)],
            })
            .unwrap_err();
            assert_eq!(error, "cloud_save_invalid_size_bytes");
        }
    }
}
