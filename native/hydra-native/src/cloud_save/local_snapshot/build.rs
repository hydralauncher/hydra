use std::collections::{HashMap, HashSet};

use crate::cloud_save::hashing::{
    batch::{format_modified_at, hash_files_best_effort},
    build_aggregate_hash, BuildSnapshotAggregateHashInput, SnapshotAggregateHashFile,
};
use crate::cloud_save::identity::{
    local_id, normalize_rule_path, normalize_text, UserLocationCoverage,
};

use super::guardrails::{prepare_snapshot_files_best_effort, validate_built_files};
use super::types::{
    BuildLocalGameSnapshotInput, BuiltLocalSaveFile, DiscoveredLocalSaveFile,
    LocalGameSnapshotFile, LocalGameSnapshotSourceFile, LocalGameSnapshotWithHash,
};

pub fn build_snapshot(
    mut input: BuildLocalGameSnapshotInput,
) -> Result<LocalGameSnapshotWithHash, String> {
    for file in &mut input.files {
        file.raw_path = normalize_rule_path(&file.raw_path);
        file.relative_path = normalize_text(&file.relative_path);
    }
    for coverage in &mut input.coverage {
        if let Some(raw_path) = &mut coverage.raw_path {
            *raw_path = normalize_rule_path(raw_path);
        }
        if let Some(relative_path) = &mut coverage.relative_path {
            *relative_path = normalize_text(relative_path);
        }
    }

    let prepared =
        prepare_snapshot_files_best_effort(&input.files).map_err(|error| error.to_string())?;
    let unavailable = prepared
        .unavailable_paths
        .into_iter()
        .collect::<HashSet<_>>();
    let hashed = hash_files_best_effort(
        input
            .files
            .iter()
            .filter(|file| !unavailable.contains(&file.absolute_path))
            .map(|file| file.absolute_path.clone())
            .collect(),
        input.hash_cache,
    );
    let hash_failures = hashed
        .failures
        .into_iter()
        .map(|(path, _)| path)
        .collect::<HashSet<_>>();
    let hashed_by_path = hashed
        .result
        .files
        .into_iter()
        .map(|file| (file.absolute_path.clone(), file))
        .collect::<HashMap<_, _>>();
    let warning = |file: &DiscoveredLocalSaveFile, code: &str| UserLocationCoverage {
        candidate_id: local_id(&[code, &file.variant_id, &file.raw_path, &file.relative_path]),
        rule_id: file.rule_id.clone(),
        variant_id: Some(file.variant_id.clone()),
        raw_path: Some(file.raw_path.clone()),
        relative_path: Some(file.relative_path.clone()),
        selected_root: true,
        authority: file.confidence.clone(),
        outcome: "partial".to_string(),
        enumerated_completely: false,
        warning_codes: vec![code.to_string()],
    };
    let mut built_files = input
        .files
        .into_iter()
        .filter_map(|file| {
            if unavailable.contains(&file.absolute_path) {
                input
                    .coverage
                    .push(warning(&file, "file-metadata-unavailable"));
                return None;
            }
            if hash_failures.contains(&file.absolute_path) {
                input.coverage.push(warning(&file, "file-hash-failed"));
                return None;
            }
            let hashed = hashed_by_path.get(&file.absolute_path)?;
            let initial = prepared.metadata_by_path.get(&file.absolute_path)?;
            let current = std::fs::metadata(&file.absolute_path)
                .ok()
                .filter(|metadata| metadata.is_file())
                .and_then(|metadata| {
                    let modified = metadata.modified().ok()?;
                    let last_modified_at = format_modified_at(modified).ok()?;
                    Some((metadata.len() as f64, last_modified_at))
                });
            if initial.size_bytes != hashed.size_bytes
                || initial.last_modified_at != hashed.last_modified_at
                || current.as_ref() != Some(&(hashed.size_bytes, hashed.last_modified_at.clone()))
            {
                input
                    .coverage
                    .push(warning(&file, "file-changed-during-snapshot"));
                return None;
            }
            Some(BuiltLocalSaveFile {
                variant_id: file.variant_id,
                rule_id: file.rule_id,
                raw_path: file.raw_path,
                relative_path: file.relative_path,
                absolute_path: file.absolute_path,
                hash: hashed.hash.clone(),
                size_bytes: hashed.size_bytes,
                last_modified_at: hashed.last_modified_at.clone(),
                local_bindings: file.local_bindings,
                confidence: file.confidence,
                provenance: file.provenance,
            })
        })
        .collect::<Vec<_>>();
    let accepted_paths = built_files
        .iter()
        .map(|file| file.absolute_path.as_str())
        .collect::<HashSet<_>>();
    let hash_cache = hashed
        .result
        .hash_cache
        .into_iter()
        .filter(|entry| accepted_paths.contains(entry.absolute_path.as_str()))
        .collect();
    let total_size_bytes = validate_built_files(&built_files).map_err(|error| error.to_string())?;

    built_files.sort_by(|left, right| {
        left.variant_id
            .cmp(&right.variant_id)
            .then_with(|| left.raw_path.cmp(&right.raw_path))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });

    let files = built_files
        .iter()
        .map(|file| LocalGameSnapshotFile {
            variant_id: file.variant_id.clone(),
            raw_path: file.raw_path.clone(),
            relative_path: file.relative_path.clone(),
            hash: file.hash.clone(),
            size_bytes: file.size_bytes,
            last_modified_at: file.last_modified_at.clone(),
        })
        .collect::<Vec<_>>();
    let source_files = built_files
        .iter()
        .map(|file| LocalGameSnapshotSourceFile {
            variant_id: file.variant_id.clone(),
            rule_id: file.rule_id.clone(),
            raw_path: file.raw_path.clone(),
            relative_path: file.relative_path.clone(),
            absolute_path: file.absolute_path.clone(),
            hash: file.hash.clone(),
            size_bytes: file.size_bytes,
            last_modified_at: file.last_modified_at.clone(),
            local_bindings: file.local_bindings.clone(),
            confidence: file.confidence.clone(),
            provenance: file.provenance.clone(),
        })
        .collect();

    let used_variant_ids = files
        .iter()
        .map(|file| file.variant_id.as_str())
        .collect::<HashSet<_>>();
    let mut variants = input
        .variants
        .into_iter()
        .filter(|variant| used_variant_ids.contains(variant.variant_id.as_str()))
        .collect::<Vec<_>>();
    variants.sort_by(|left, right| left.variant_id.cmp(&right.variant_id));
    variants.dedup_by(|left, right| left.variant_id == right.variant_id);
    if variants.len() != used_variant_ids.len() {
        return Err("cloud_save_snapshot_variant_missing".to_string());
    }

    let aggregate_hash = build_aggregate_hash(BuildSnapshotAggregateHashInput {
        variants: variants.clone(),
        files: files
            .iter()
            .map(|file| SnapshotAggregateHashFile {
                variant_id: file.variant_id.clone(),
                raw_path: file.raw_path.clone(),
                relative_path: file.relative_path.clone(),
                hash: file.hash.clone(),
                size_bytes: file.size_bytes,
            })
            .collect(),
    })?;

    Ok(LocalGameSnapshotWithHash {
        game_id: input.game_id,
        manifest_key: input.manifest_key,
        rule_source_revision: input.rule_source_revision,
        discovery_engine_version: input.discovery_engine_version,
        coverage: input.coverage,
        variants,
        file_count: files.len() as u32,
        total_size_bytes: total_size_bytes as f64,
        files,
        aggregate_hash,
        source_files,
        hash_cache,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;
    use crate::cloud_save::identity::{LocalResolutionBindings, SnapshotVariant};
    use crate::cloud_save::manifest::types::CloudSaveGameId;

    fn input(files: Vec<DiscoveredLocalSaveFile>) -> BuildLocalGameSnapshotInput {
        BuildLocalGameSnapshotInput {
            game_id: CloudSaveGameId {
                shop: "steam".into(),
                object_id: "2379780".into(),
            },
            manifest_key: Some("2379780".into()),
            rule_source_revision: "test-v1".into(),
            discovery_engine_version: 2,
            coverage: vec![],
            variants: vec![SnapshotVariant {
                variant_id: "variant".into(),
                kind: "default".into(),
                steam_id64: None,
                concrete_folder_id: None,
            }],
            files,
            hash_cache: vec![],
        }
    }

    fn discovered(path: &std::path::Path, relative_path: &str) -> DiscoveredLocalSaveFile {
        DiscoveredLocalSaveFile {
            variant_id: "variant".into(),
            rule_id: "rule".into(),
            raw_path: "<home>/game".into(),
            absolute_path: path.display().to_string(),
            relative_path: relative_path.into(),
            local_bindings: LocalResolutionBindings {
                environment_id: "environment".into(),
                root_id: "root".into(),
                prefix_generation_id: None,
                concrete_user_segment: "__default__".into(),
                concrete_path: path.display().to_string(),
            },
            confidence: "inferred".into(),
            provenance: vec!["test".into()],
        }
    }

    #[test]
    fn builds_deterministic_snapshot_with_source_files() {
        let temp = tempdir().unwrap();
        let empty = temp.path().join("empty.dat");
        let save = temp.path().join("save.dat");
        fs::write(&empty, b"").unwrap();
        fs::write(&save, b"save").unwrap();

        let first = build_snapshot(input(vec![
            discovered(&save, "save.dat"),
            discovered(&empty, "empty.dat"),
        ]))
        .unwrap();
        let second = build_snapshot(input(vec![
            discovered(&empty, "empty.dat"),
            discovered(&save, "save.dat"),
        ]))
        .unwrap();

        assert_eq!(first.file_count, 2);
        assert_eq!(first.total_size_bytes, 4.0);
        assert_eq!(first.files[0].relative_path, "empty.dat");
        assert_eq!(first.source_files.len(), 2);
        assert_eq!(first.aggregate_hash, second.aggregate_hash);
        assert_eq!(first.files[0].size_bytes, 0.0);
    }

    #[test]
    fn skips_unavailable_file_and_marks_partial_coverage() {
        let temp = tempdir().unwrap();
        let save = temp.path().join("save.dat");
        let missing = temp.path().join("missing.dat");
        fs::write(&save, b"save").unwrap();

        let snapshot = build_snapshot(input(vec![
            discovered(&save, "save.dat"),
            discovered(&missing, "missing.dat"),
        ]))
        .unwrap();

        assert_eq!(snapshot.files.len(), 1);
        assert_eq!(snapshot.files[0].relative_path, "save.dat");
        assert_eq!(snapshot.coverage.len(), 1);
        assert_eq!(
            snapshot.coverage[0].warning_codes,
            vec!["file-metadata-unavailable"]
        );
    }

    #[test]
    fn normalizes_portable_paths_but_preserves_absolute_paths() {
        let temp = tempdir().unwrap();
        let save = temp.path().join("save.dat");
        fs::write(&save, b"save").unwrap();
        let mut input = input(vec![discovered(&save, "Cafe\u{301}/save.dat")]);
        input.files[0].raw_path = "<home>/Cafe\u{301}".into();
        input.coverage.push(UserLocationCoverage {
            candidate_id: "candidate".into(),
            rule_id: "rule".into(),
            variant_id: Some("variant".into()),
            raw_path: Some("<home>/Cafe\u{301}".into()),
            relative_path: Some("Cafe\u{301}/save.dat".into()),
            selected_root: true,
            authority: "inferred".into(),
            outcome: "scanned".into(),
            enumerated_completely: true,
            warning_codes: vec![],
        });

        let snapshot = build_snapshot(input).unwrap();

        assert_eq!(snapshot.files[0].raw_path, "<home>/Café");
        assert_eq!(snapshot.files[0].relative_path, "Café/save.dat");
        assert_eq!(
            snapshot.source_files[0].absolute_path,
            save.display().to_string()
        );
        assert_eq!(
            snapshot.coverage[0].raw_path.as_deref(),
            Some("<home>/Café")
        );
        assert_eq!(
            snapshot.coverage[0].relative_path.as_deref(),
            Some("Café/save.dat")
        );
    }

    #[test]
    fn preserves_literal_backslashes_in_relative_paths() {
        let temp = tempdir().unwrap();
        let backslash = temp.path().join("backslash.dat");
        let slash = temp.path().join("slash.dat");
        fs::write(&backslash, b"backslash").unwrap();
        fs::write(&slash, b"slash").unwrap();

        let snapshot = build_snapshot(input(vec![
            discovered(&backslash, r"save\slot1.dat"),
            discovered(&slash, "save/slot1.dat"),
        ]))
        .unwrap();

        assert_eq!(snapshot.files.len(), 2);
        assert!(snapshot
            .files
            .iter()
            .any(|file| file.relative_path == r"save\slot1.dat"));
        assert!(snapshot
            .files
            .iter()
            .any(|file| file.relative_path == "save/slot1.dat"));
    }
}
