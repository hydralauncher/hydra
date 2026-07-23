use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::sync::OnceLock;

use rayon::prelude::*;
use time::OffsetDateTime;

use super::file::hash_file;
use super::types::{HashFilesResult, HashedLocalFile, LocalFileHashCacheEntry};

pub struct HashFilesBestEffortResult {
    pub result: HashFilesResult,
    pub failures: Vec<(String, String)>,
}

pub const MAX_CONCURRENT_HASHES: usize = 8;
const BLAKE3_HEX_HASH_LENGTH: usize = 64;
static HASHING_POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();

fn hashing_pool() -> &'static rayon::ThreadPool {
    HASHING_POOL.get_or_init(|| {
        rayon::ThreadPoolBuilder::new()
            .num_threads(MAX_CONCURRENT_HASHES)
            .thread_name(|index| format!("cloud-save-hash-{index}"))
            .build()
            .expect("failed to create cloud save hashing pool")
    })
}

pub(crate) fn format_modified_at(modified: std::time::SystemTime) -> String {
    let datetime = OffsetDateTime::from(modified);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:09}Z",
        datetime.year(),
        u8::from(datetime.month()),
        datetime.day(),
        datetime.hour(),
        datetime.minute(),
        datetime.second(),
        datetime.nanosecond()
    )
}

fn is_valid_hash(hash: &str) -> bool {
    hash.len() == BLAKE3_HEX_HASH_LENGTH
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn hash_file_with_cache(
    absolute_path: String,
    cached: Option<&LocalFileHashCacheEntry>,
) -> Result<HashedLocalFile, String> {
    let metadata = fs::metadata(&absolute_path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("cloud_save_hash_path_is_not_file".to_string());
    }

    let size_bytes = metadata.len() as f64;
    let last_modified_at = metadata
        .modified()
        .map(format_modified_at)
        .map_err(|error| error.to_string())?;
    let hash = cached
        .filter(|entry| {
            entry.absolute_path == absolute_path
                && entry.size_bytes == size_bytes
                && entry.last_modified_at == last_modified_at
                && is_valid_hash(&entry.hash)
        })
        .map(|entry| entry.hash.clone())
        .map_or_else(|| hash_file(&absolute_path), Ok)?;

    Ok(HashedLocalFile {
        absolute_path,
        size_bytes,
        last_modified_at,
        hash,
    })
}

pub fn hash_files(
    absolute_paths: Vec<String>,
    hash_cache: Vec<LocalFileHashCacheEntry>,
) -> Result<HashFilesResult, String> {
    let result = hash_files_best_effort(absolute_paths, hash_cache);
    if let Some((_, error)) = result.failures.into_iter().next() {
        return Err(error);
    }
    Ok(result.result)
}

pub fn hash_files_best_effort(
    absolute_paths: Vec<String>,
    hash_cache: Vec<LocalFileHashCacheEntry>,
) -> HashFilesBestEffortResult {
    let paths = absolute_paths
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let cache_by_path = hash_cache
        .into_iter()
        .map(|entry| (entry.absolute_path.clone(), entry))
        .collect::<HashMap<_, _>>();

    let results = hashing_pool().install(|| {
        paths
            .into_par_iter()
            .map(|absolute_path| {
                let cached = cache_by_path.get(&absolute_path);
                let path = absolute_path.clone();
                hash_file_with_cache(absolute_path, cached).map_err(|error| (path, error))
            })
            .collect::<Vec<_>>()
    });
    let mut files = Vec::new();
    let mut failures = Vec::new();
    for result in results {
        match result {
            Ok(file) => files.push(file),
            Err(failure) => failures.push(failure),
        }
    }
    let hash_cache = files
        .iter()
        .map(|file| LocalFileHashCacheEntry {
            absolute_path: file.absolute_path.clone(),
            size_bytes: file.size_bytes,
            last_modified_at: file.last_modified_at.clone(),
            hash: file.hash.clone(),
        })
        .collect();

    HashFilesBestEffortResult {
        result: HashFilesResult { files, hash_cache },
        failures,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn reuses_valid_cache_and_processes_duplicate_paths_once() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("save.dat").display().to_string();
        fs::write(&path, b"save").unwrap();
        let initial = hash_files(vec![path.clone()], vec![]).unwrap();
        let mut cache = initial.hash_cache;
        let cached_hash = "a".repeat(64);
        cache[0].hash = cached_hash.clone();

        let result = hash_files(vec![path.clone(), path], cache).unwrap();

        assert_eq!(result.files.len(), 1);
        assert_eq!(result.hash_cache.len(), 1);
        assert_eq!(result.files[0].hash, cached_hash);
        assert_eq!(hashing_pool().current_num_threads(), MAX_CONCURRENT_HASHES);
    }

    #[test]
    fn invalidates_cache_mismatches() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("save.dat").display().to_string();
        let expected = blake3::hash(b"save").to_hex().to_string();
        fs::write(&path, b"save").unwrap();
        let initial = hash_files(vec![path.clone()], vec![]).unwrap();

        for mutate in [
            |entry: &mut LocalFileHashCacheEntry| entry.hash = "invalid".into(),
            |entry: &mut LocalFileHashCacheEntry| entry.size_bytes += 1.0,
            |entry: &mut LocalFileHashCacheEntry| entry.last_modified_at = "changed".into(),
        ] {
            let mut cache = initial.hash_cache.clone();
            mutate(&mut cache[0]);
            assert_eq!(
                hash_files(vec![path.clone()], cache).unwrap().files[0].hash,
                expected
            );
        }
    }

    #[test]
    fn drops_removed_files_and_sorts_results() {
        let temp = tempdir().unwrap();
        let first = temp.path().join("a.dat").display().to_string();
        let removed = temp.path().join("removed.dat").display().to_string();
        let second = temp.path().join("z.dat").display().to_string();
        fs::write(&first, b"a").unwrap();
        fs::write(&removed, b"removed").unwrap();
        fs::write(&second, b"z").unwrap();
        let initial =
            hash_files(vec![removed.clone(), second.clone(), first.clone()], vec![]).unwrap();

        let result = hash_files(vec![second.clone(), first.clone()], initial.hash_cache).unwrap();

        assert_eq!(
            result
                .files
                .iter()
                .map(|file| file.absolute_path.as_str())
                .collect::<Vec<_>>(),
            vec![first.as_str(), second.as_str()]
        );
        assert_eq!(result.hash_cache.len(), 2);
        assert!(!result
            .hash_cache
            .iter()
            .any(|entry| entry.absolute_path == removed));
    }

    #[test]
    fn accepts_empty_files_and_rejects_non_files() {
        let temp = tempdir().unwrap();
        let empty = temp.path().join("empty.dat").display().to_string();
        fs::write(&empty, b"").unwrap();

        let result = hash_files(vec![empty], vec![]).unwrap();

        assert_eq!(result.files[0].size_bytes, 0.0);
        assert_eq!(result.files[0].hash, blake3::hash(b"").to_hex().to_string());
        assert_eq!(
            hash_files(vec![temp.path().display().to_string()], vec![]).unwrap_err(),
            "cloud_save_hash_path_is_not_file"
        );
    }
}
