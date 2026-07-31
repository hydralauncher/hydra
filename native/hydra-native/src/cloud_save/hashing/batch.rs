use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use rayon::prelude::*;
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};

use super::file::hash_file;
use super::types::{HashFilesResult, HashedLocalFile, LocalFileHashCacheEntry};

pub struct HashFilesBestEffortResult {
    pub result: HashFilesResult,
    pub failures: Vec<(String, String)>,
}

pub const MAX_CONCURRENT_HASHES: usize = 8;
const SHA256_HEX_HASH_LENGTH: usize = 64;
const HASH_ALGORITHM: &str = "sha256";
const CACHE_RACY_TIMESTAMP_WINDOW: Duration = Duration::seconds(2);
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

fn offset_datetime(value: SystemTime) -> Result<OffsetDateTime, String> {
    let datetime = match value.duration_since(UNIX_EPOCH) {
        Ok(duration) => Duration::try_from(duration)
            .ok()
            .and_then(|duration| OffsetDateTime::UNIX_EPOCH.checked_add(duration)),
        Err(error) => Duration::try_from(error.duration())
            .ok()
            .and_then(|duration| OffsetDateTime::UNIX_EPOCH.checked_sub(duration)),
    }
    .ok_or_else(|| "cloud_save_invalid_file_timestamp".to_string())?;

    (0..=9999)
        .contains(&datetime.year())
        .then_some(datetime)
        .ok_or_else(|| "cloud_save_invalid_file_timestamp".to_string())
}

pub(crate) fn format_modified_at(modified: SystemTime) -> Result<String, String> {
    let datetime = offset_datetime(modified)?;
    Ok(format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:09}Z",
        datetime.year(),
        u8::from(datetime.month()),
        datetime.day(),
        datetime.hour(),
        datetime.minute(),
        datetime.second(),
        datetime.nanosecond()
    ))
}

#[cfg(unix)]
fn metadata_fingerprint(_path: &str, metadata: &fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;

    Some(format!(
        "unix:{}:{}:{}:{}",
        metadata.dev(),
        metadata.ino(),
        metadata.ctime(),
        metadata.ctime_nsec()
    ))
}

#[cfg(windows)]
fn metadata_fingerprint(path: &str, metadata: &fs::Metadata) -> Option<String> {
    use std::os::windows::fs::MetadataExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileBasicInfo, GetFileInformationByHandleEx, FILE_BASIC_INFO,
    };

    let file = fs::File::open(path).ok()?;
    let mut basic_info = FILE_BASIC_INFO::default();
    // SAFETY: `file` keeps the handle alive and `basic_info` provides the
    // correctly sized writable buffer required for `FileBasicInfo`.
    let succeeded = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileBasicInfo,
            std::ptr::from_mut(&mut basic_info).cast(),
            std::mem::size_of::<FILE_BASIC_INFO>() as u32,
        )
    };
    if succeeded == 0 {
        return None;
    }

    Some(format!(
        "windows:{}:{}:{}",
        metadata.creation_time(),
        metadata.file_attributes(),
        basic_info.ChangeTime
    ))
}

#[cfg(not(any(unix, windows)))]
fn metadata_fingerprint(_path: &str, _metadata: &fs::Metadata) -> Option<String> {
    None
}

fn cache_timestamp_is_stable(modified: SystemTime, hashed_at: &str) -> bool {
    let Ok(modified) = offset_datetime(modified) else {
        return false;
    };
    let Ok(hashed_at) = OffsetDateTime::parse(hashed_at, &Rfc3339) else {
        return false;
    };

    // Filesystems with coarse mtimes can report the same timestamp for two
    // adjacent writes. Rehash once after that window before trusting the cache.
    hashed_at
        .checked_sub(CACHE_RACY_TIMESTAMP_WINDOW)
        .is_some_and(|safe_before| modified <= safe_before)
}

fn is_valid_hash(hash: &str) -> bool {
    hash.len() == SHA256_HEX_HASH_LENGTH
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
    let modified = metadata.modified().map_err(|error| error.to_string())?;
    let last_modified_at = format_modified_at(modified)?;
    let metadata_fingerprint = metadata_fingerprint(&absolute_path, &metadata);
    let cached = cached.filter(|entry| {
        entry.absolute_path == absolute_path
            && entry.size_bytes == size_bytes
            && entry.last_modified_at == last_modified_at
            && entry.algorithm.as_deref() == Some(HASH_ALGORITHM)
            && is_valid_hash(&entry.hash)
            && metadata_fingerprint.is_some()
            && entry.metadata_fingerprint == metadata_fingerprint
            && entry
                .hashed_at
                .as_deref()
                .is_some_and(|hashed_at| cache_timestamp_is_stable(modified, hashed_at))
    });
    let cached =
        cached.and_then(|entry| entry.hashed_at.as_ref().map(|hashed_at| (entry, hashed_at)));
    let (hash, hashed_at) = match cached {
        Some((entry, hashed_at)) => (entry.hash.clone(), hashed_at.clone()),
        None => (
            hash_file(&absolute_path)?,
            format_modified_at(SystemTime::now())?,
        ),
    };

    Ok(HashedLocalFile {
        absolute_path,
        size_bytes,
        last_modified_at,
        hash,
        hashed_at,
        metadata_fingerprint,
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
            algorithm: Some(HASH_ALGORITHM.to_string()),
            hashed_at: Some(file.hashed_at.clone()),
            metadata_fingerprint: file.metadata_fingerprint.clone(),
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
    use std::fs::FileTimes;
    use std::time::{Duration as StdDuration, UNIX_EPOCH};

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
        let modified = fs::metadata(&path).unwrap().modified().unwrap();
        cache[0].hashed_at = Some(
            format_modified_at(modified.checked_add(StdDuration::from_secs(3)).unwrap()).unwrap(),
        );

        let result = hash_files(vec![path.clone(), path], cache).unwrap();

        assert_eq!(result.files.len(), 1);
        assert_eq!(result.hash_cache.len(), 1);
        assert_eq!(result.files[0].hash, cached_hash);
        assert_eq!(hashing_pool().current_num_threads(), MAX_CONCURRENT_HASHES);
    }

    #[test]
    fn distrusts_cache_entries_with_racy_timestamps() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("save.dat").display().to_string();
        fs::write(&path, b"save").unwrap();
        let initial = hash_files(vec![path.clone()], vec![]).unwrap();
        let mut cache = initial.hash_cache;
        cache[0].hash = "a".repeat(64);
        cache[0].hashed_at = Some(cache[0].last_modified_at.clone());

        let result = hash_files(vec![path], cache).unwrap();

        assert_eq!(
            result.files[0].hash,
            "157dca92e4250458339d4b835250d44c238f3355e1b7986195188ee434e9baff"
        );
    }

    #[test]
    fn invalidates_cache_when_contents_change_but_size_and_mtime_do_not() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("save.dat").display().to_string();
        fs::write(&path, b"AAAA").unwrap();
        let original_modified = fs::metadata(&path).unwrap().modified().unwrap();
        let initial = hash_files(vec![path.clone()], vec![]).unwrap();
        let initial_hash = initial.files[0].hash.clone();
        let mut cache = initial.hash_cache;
        cache[0].hashed_at = Some(
            format_modified_at(
                original_modified
                    .checked_add(StdDuration::from_secs(3))
                    .unwrap(),
            )
            .unwrap(),
        );

        fs::write(&path, b"BBBB").unwrap();
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(FileTimes::new().set_modified(original_modified))
            .unwrap();
        let result = hash_files(vec![path], cache).unwrap();

        assert_ne!(result.files[0].hash, initial_hash);
        assert_eq!(
            result.files[0].last_modified_at,
            initial.files[0].last_modified_at
        );
    }

    #[test]
    fn rejects_timestamps_outside_the_portable_date_range() {
        let year_ten_thousand = UNIX_EPOCH
            .checked_add(StdDuration::from_secs(253_402_300_800))
            .unwrap();

        assert_eq!(
            format_modified_at(year_ten_thousand).unwrap_err(),
            "cloud_save_invalid_file_timestamp"
        );
    }

    #[test]
    fn invalidates_cache_mismatches() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("save.dat").display().to_string();
        let expected = "157dca92e4250458339d4b835250d44c238f3355e1b7986195188ee434e9baff";
        fs::write(&path, b"save").unwrap();
        let initial = hash_files(vec![path.clone()], vec![]).unwrap();

        for mutate in [
            |entry: &mut LocalFileHashCacheEntry| entry.hash = "invalid".into(),
            |entry: &mut LocalFileHashCacheEntry| entry.size_bytes += 1.0,
            |entry: &mut LocalFileHashCacheEntry| entry.last_modified_at = "changed".into(),
            |entry: &mut LocalFileHashCacheEntry| entry.algorithm = None,
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
        assert_eq!(
            result.files[0].hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            hash_files(vec![temp.path().display().to_string()], vec![]).unwrap_err(),
            "cloud_save_hash_path_is_not_file"
        );
    }
}
