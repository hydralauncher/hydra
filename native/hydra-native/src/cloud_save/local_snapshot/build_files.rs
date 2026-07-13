use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

use rayon::prelude::*;

use super::build_file::build_file;
use super::guardrails::{prepare_files, validate_built_files};
use super::types::{DiscoveredLocalSaveFile, LocalFileHashCacheEntry, LocalSaveSnapshotFile};

const MAX_CONCURRENT_HASHES: usize = 8;
static HASHING_POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();

pub struct LocalSnapshotFilesWithCache {
    pub files: Vec<LocalSaveSnapshotFile>,
    pub hash_cache: Vec<LocalFileHashCacheEntry>,
}

fn hashing_pool() -> &'static rayon::ThreadPool {
    HASHING_POOL.get_or_init(|| {
        rayon::ThreadPoolBuilder::new()
            .num_threads(MAX_CONCURRENT_HASHES)
            .thread_name(|index| format!("cloud-save-hash-{index}"))
            .build()
            .expect("failed to create cloud save hashing pool")
    })
}

pub fn build_files(
    files: Vec<DiscoveredLocalSaveFile>,
    hash_cache: Vec<LocalFileHashCacheEntry>,
) -> Result<LocalSnapshotFilesWithCache, String> {
    let prepared_files = prepare_files(files).map_err(|error| error.to_string())?;
    let cache_by_path = hash_cache
        .into_iter()
        .map(|entry| (entry.absolute_path.clone(), entry))
        .collect::<HashMap<_, _>>();

    let results = hashing_pool().install(|| {
        prepared_files
            .into_par_iter()
            .map(|prepared| {
                let cached = cache_by_path.get(&prepared.file.absolute_path);
                build_file(prepared, cached)
            })
            .collect::<Vec<_>>()
    });
    let mut snapshot_files = results.into_iter().collect::<Result<Vec<_>, _>>()?;
    validate_built_files(&snapshot_files).map_err(|error| error.to_string())?;

    snapshot_files.sort_by(|left, right| {
        let root_order = left.root_path.cmp(&right.root_path);
        if root_order == Ordering::Equal {
            left.relative_path.cmp(&right.relative_path)
        } else {
            root_order
        }
    });

    let hash_cache = snapshot_files
        .iter()
        .map(|file| {
            (
                file.absolute_path.clone(),
                LocalFileHashCacheEntry {
                    absolute_path: file.absolute_path.clone(),
                    size_bytes: file.size_bytes,
                    last_modified_at: file.last_modified_at.clone(),
                    hash: file.hash.clone(),
                },
            )
        })
        .collect::<BTreeMap<_, _>>()
        .into_values()
        .collect();

    Ok(LocalSnapshotFilesWithCache {
        files: snapshot_files,
        hash_cache,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use tempfile::tempdir;

    fn discovered_file(
        absolute_path: String,
        root_path: String,
        relative_path: &str,
    ) -> DiscoveredLocalSaveFile {
        DiscoveredLocalSaveFile {
            raw_path: format!("<root>/{relative_path}"),
            absolute_path,
            root_path,
            relative_path: relative_path.into(),
            source: "ludusavi".into(),
        }
    }

    #[test]
    fn builds_snapshot_files_and_reuses_valid_cache() {
        let temp = tempdir().unwrap();
        let root_path = temp.path().display().to_string();
        let first_path = temp.path().join("1.jkr");
        let second_path = temp.path().join("settings.jkr");
        let first_content = b"balatro save";
        let second_content = b"balatro settings";

        fs::write(&first_path, first_content).unwrap();
        fs::write(&second_path, second_content).unwrap();

        let discovered = vec![
            discovered_file(
                second_path.display().to_string(),
                root_path.clone(),
                "settings.jkr",
            ),
            discovered_file(first_path.display().to_string(), root_path.clone(), "1.jkr"),
        ];
        let first = build_files(discovered.clone(), vec![]).unwrap();
        let cached_hash = "a".repeat(64);
        let mut cache = first.hash_cache.clone();
        cache[0].hash = cached_hash.clone();
        let cached_path = cache[0].absolute_path.clone();
        let second = build_files(discovered, cache).unwrap();

        assert_eq!(second.files.len(), 2);
        assert_eq!(second.files[0].relative_path, "1.jkr");
        assert_eq!(second.files[1].relative_path, "settings.jkr");
        assert_eq!(
            second
                .files
                .iter()
                .find(|file| file.absolute_path == cached_path)
                .unwrap()
                .hash,
            cached_hash
        );
        assert_eq!(second.hash_cache.len(), 2);
        assert_eq!(hashing_pool().current_num_threads(), MAX_CONCURRENT_HASHES);
    }

    #[test]
    fn invalidates_changed_and_invalid_entries_and_drops_removed_files() {
        let temp = tempdir().unwrap();
        let root_path = temp.path().display().to_string();
        let kept_path = temp.path().join("kept.sav");
        let removed_path = temp.path().join("removed.sav");
        fs::write(&kept_path, b"first").unwrap();
        fs::write(&removed_path, b"removed").unwrap();

        let initial_files = vec![
            discovered_file(
                kept_path.display().to_string(),
                root_path.clone(),
                "kept.sav",
            ),
            discovered_file(
                removed_path.display().to_string(),
                root_path.clone(),
                "removed.sav",
            ),
        ];
        let initial = build_files(initial_files, vec![]).unwrap();
        fs::write(&kept_path, b"changed content").unwrap();

        let mut cache = initial.hash_cache;
        cache[0].hash = "invalid".into();
        let result = build_files(
            vec![discovered_file(
                kept_path.display().to_string(),
                root_path,
                "kept.sav",
            )],
            cache,
        )
        .unwrap();

        assert_eq!(result.files.len(), 1);
        assert_eq!(result.hash_cache.len(), 1);
        assert_eq!(
            result.files[0].hash,
            blake3::hash(b"changed content").to_hex().to_string()
        );
    }

    #[test]
    fn invalidates_cache_when_only_modified_time_changes() {
        let temp = tempdir().unwrap();
        let root_path = temp.path().display().to_string();
        let save_path = temp.path().join("save.dat");
        fs::write(&save_path, b"first").unwrap();
        let discovered = vec![discovered_file(
            save_path.display().to_string(),
            root_path,
            "save.dat",
        )];
        let initial = build_files(discovered.clone(), vec![]).unwrap();
        let mut cache = initial.hash_cache;
        cache[0].hash = "a".repeat(64);

        std::thread::sleep(std::time::Duration::from_millis(10));
        fs::write(&save_path, b"other").unwrap();
        let result = build_files(discovered, cache).unwrap();

        assert_eq!(
            result.files[0].hash,
            blake3::hash(b"other").to_hex().to_string()
        );
    }

    #[test]
    fn recalculates_structurally_invalid_cached_hash() {
        let temp = tempdir().unwrap();
        let root_path = temp.path().display().to_string();
        let save_path = temp.path().join("save.dat");
        fs::write(&save_path, b"save").unwrap();
        let discovered = vec![discovered_file(
            save_path.display().to_string(),
            root_path,
            "save.dat",
        )];
        let initial = build_files(discovered.clone(), vec![]).unwrap();
        let mut cache = initial.hash_cache;
        cache[0].hash = "invalid".into();

        let result = build_files(discovered, cache).unwrap();

        assert_eq!(
            result.files[0].hash,
            blake3::hash(b"save").to_hex().to_string()
        );
    }
}
