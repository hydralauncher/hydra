//! services/umu-updater.ts, umu-release.ts and umu-update-schedule.ts: keep
//! umu-run current. Once a day (backing off after failures) the latest
//! umu-launcher release is checked on GitHub; a newer zipapp is downloaded,
//! checked against the digest GitHub publishes, and installed under
//! `<userData>/umu/<version>/umu-run`, which then wins over the bundled one.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

/// BUNDLED_UMU_VERSION (binaries/umu/umu-run)
pub const BUNDLED_VERSION: &str = "1.4.4";

const RELEASE_API_URL: &str =
    "https://api.github.com/repos/Open-Wine-Components/umu-launcher/releases/latest";
const RELEASE_TIMEOUT_SECS: u64 = 15;
const DOWNLOAD_TIMEOUT_SECS: u64 = 120;
const MAX_DOWNLOAD_BYTES: u64 = 20 * 1024 * 1024;
const ZIPAPP_ENTRY: &str = "umu/umu-run";
/// UMU_UPDATE_CHECK_INTERVAL_MS / UMU_UPDATE_RETRY_BASE_DELAY_MS
const CHECK_INTERVAL_MS: f64 = 24.0 * 60.0 * 60.0 * 1000.0;
const RETRY_BASE_DELAY_MS: f64 = 60.0 * 60.0 * 1000.0;

/// UmuUpdateState (state.json)
#[derive(Clone, Debug, PartialEq)]
pub struct State {
    pub version: Option<String>,
    pub checked_at: f64,
    pub failure_count: u32,
    pub retry_at: Option<f64>,
}

/// UmuRelease
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Release {
    pub version: String,
    pub download_url: String,
    pub sha256: String,
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_millis() as f64)
}

/// isValidUmuVersion: digits separated by dots.
pub fn is_valid_version(version: &str) -> bool {
    !version.is_empty()
        && version
            .split('.')
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

/// compareUmuVersions
pub fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    let parts = |v: &str| -> Vec<u64> { v.split('.').map(|p| p.parse().unwrap_or(0)).collect() };
    let (l, r) = (parts(left), parts(right));
    for i in 0..l.len().max(r.len()) {
        let ordering = l.get(i).unwrap_or(&0).cmp(r.get(i).unwrap_or(&0));
        if ordering.is_ne() {
            return ordering;
        }
    }
    std::cmp::Ordering::Equal
}

/// parseUmuRelease: the `umu-launcher-<version>-zipapp.tar` asset with its
/// sha256 digest, from a non-draft, non-prerelease release.
pub fn parse_release(payload: &Value) -> Option<Release> {
    let object = payload.as_object()?;
    if object.get("draft") == Some(&Value::Bool(true))
        || object
            .get("prerelease")
            .is_some_and(|v| v.as_bool() != Some(false) && !v.is_null())
    {
        return None;
    }
    for asset in object.get("assets")?.as_array()? {
        let Some(name) = asset.get("name").and_then(Value::as_str) else {
            continue;
        };
        let Some(version) = name
            .strip_prefix("umu-launcher-")
            .and_then(|rest| rest.strip_suffix("-zipapp.tar"))
            .filter(|v| is_valid_version(v))
        else {
            continue;
        };
        let digest = asset
            .get("digest")
            .and_then(Value::as_str)
            .and_then(|d| {
                d.strip_prefix("sha256:")
                    .or_else(|| d.strip_prefix("SHA256:"))
            })
            .filter(|d| d.len() == 64 && d.chars().all(|c| c.is_ascii_hexdigit()));
        let url = asset
            .get("browser_download_url")
            .and_then(Value::as_str)
            .filter(|u| u.starts_with("https://github.com/"));
        let (Some(digest), Some(url)) = (digest, url) else {
            return None;
        };
        return Some(Release {
            version: version.to_string(),
            download_url: url.to_string(),
            sha256: digest.to_lowercase(),
        });
    }
    None
}

/// parseUmuUpdateState
pub fn parse_state(value: &Value) -> Option<State> {
    let checked_at = value.get("checkedAt")?.as_f64()?;
    Some(State {
        version: value
            .get("version")
            .and_then(Value::as_str)
            .filter(|v| is_valid_version(v))
            .map(str::to_string),
        checked_at,
        failure_count: value
            .get("failureCount")
            .and_then(Value::as_f64)
            .filter(|n| *n > 0.0)
            .map_or(0, |n| n.floor() as u32),
        retry_at: value.get("retryAt").and_then(Value::as_f64),
    })
}

/// isUmuUpdateCheckDue
pub fn is_check_due(state: Option<&State>, now: f64) -> bool {
    match state {
        None => true,
        Some(State {
            retry_at: Some(retry_at),
            ..
        }) => now >= *retry_at,
        Some(state) => now - state.checked_at >= CHECK_INTERVAL_MS,
    }
}

/// getUmuUpdateRetryDelay: an hour, doubling, at most a day.
pub fn retry_delay(failure_count: u32) -> f64 {
    (RETRY_BASE_DELAY_MS * 2f64.powi(failure_count.saturating_sub(1) as i32)).min(CHECK_INTERVAL_MS)
}

fn success_state(version: Option<String>, now: f64) -> State {
    State {
        version,
        checked_at: now,
        failure_count: 0,
        retry_at: None,
    }
}

fn failure_state(state: Option<&State>, installed: Option<String>, now: f64) -> State {
    let failure_count = state.map_or(0, |s| s.failure_count) + 1;
    State {
        version: installed,
        checked_at: state.map_or(0.0, |s| s.checked_at),
        failure_count,
        retry_at: Some(now + retry_delay(failure_count)),
    }
}

fn managed_dir() -> Option<PathBuf> {
    Some(hydra_db::paths::native_user_data()?.join("umu"))
}

fn version_binary(dir: &Path, version: &str) -> PathBuf {
    dir.join(version).join("umu-run")
}

fn read_state(dir: &Path) -> Option<State> {
    let text = std::fs::read_to_string(dir.join("state.json")).ok()?;
    parse_state(&serde_json::from_str(&text).ok()?)
}

fn write_state(dir: &Path, state: &State) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let value = json!({
        "version": state.version,
        "checkedAt": state.checked_at,
        "failureCount": state.failure_count,
        "retryAt": state.retry_at,
    });
    let temporary = dir.join(format!("state.json.{}.tmp", std::process::id()));
    std::fs::write(&temporary, value.to_string())?;
    std::fs::rename(&temporary, dir.join("state.json"))
}

fn is_usable(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() > 0)
}

/// getInstalledManagedVersion: newer than the bundled one and on disk.
fn installed_version(dir: &Path, state: Option<&State>) -> Option<String> {
    let version = state?.version.clone()?;
    (compare_versions(&version, BUNDLED_VERSION).is_gt()
        && is_usable(&version_binary(dir, &version)))
    .then_some(version)
}

/// UmuUpdater.getManagedBinaryPath (Linux only)
pub fn managed_binary() -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    let dir = managed_dir()?;
    let version = installed_version(&dir, read_state(&dir).as_ref())?;
    Some(version_binary(&dir, &version))
}

fn client(timeout: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout))
        .user_agent("hydralauncher")
        .build()
        .map_err(|e| e.to_string())
}

/// The `umu/umu-run` entry of the release tarball.
fn extract_zipapp(archive: &[u8], target: &Path) -> Result<(), String> {
    let mut tar = tar::Archive::new(archive);
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        if path == Path::new(ZIPAPP_ENTRY) {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut file = std::fs::File::create(target).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut file).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err(format!("archive is missing {ZIPAPP_ENTRY}"))
}

/// installRelease: download, check the digest, extract into a scratch
/// folder, then move it into `<version>/umu-run` (0700).
fn install(dir: &Path, release: &Release) -> Result<(), String> {
    use sha2::Digest;
    use std::io::Read;
    let response = client(DOWNLOAD_TIMEOUT_SECS)?
        .get(&release.download_url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    let mut archive = Vec::new();
    response
        .take(MAX_DOWNLOAD_BYTES + 1)
        .read_to_end(&mut archive)
        .map_err(|e| e.to_string())?;
    if archive.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err("umu archive is too large".into());
    }
    let digest = hex(&sha2::Sha256::digest(&archive));
    if digest != release.sha256 {
        return Err(format!("umu {} archive digest mismatch", release.version));
    }
    let scratch = dir.join(format!(
        ".download-{}-{}",
        std::process::id(),
        now_ms() as u64
    ));
    let result = (|| {
        let extracted = scratch.join(ZIPAPP_ENTRY);
        extract_zipapp(&archive, &extracted)?;
        if !is_usable(&extracted) {
            return Err(format!(
                "umu {} archive is missing {ZIPAPP_ENTRY}",
                release.version
            ));
        }
        let target = version_binary(dir, &release.version);
        let version_dir = target.parent().unwrap_or(dir).to_path_buf();
        let _ = std::fs::remove_dir_all(&version_dir);
        std::fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;
        std::fs::rename(&extracted, &target).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    let _ = std::fs::remove_dir_all(&scratch);
    result
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// removeStaleVersions: every version folder except the kept ones.
fn remove_stale(dir: &Path, keep: &[&str]) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.file_type().is_ok_and(|t| t.is_dir()) && !keep.contains(&name.as_str()) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn run_check() {
    let Some(dir) = managed_dir() else { return };
    let state = read_state(&dir);
    let now = now_ms();
    if !is_check_due(state.as_ref(), now) {
        return;
    }
    let installed = installed_version(&dir, state.as_ref());
    let current = installed.clone().unwrap_or_else(|| BUNDLED_VERSION.into());
    let result = (|| -> Result<(), String> {
        let payload: Value = client(RELEASE_TIMEOUT_SECS)?
            .get(RELEASE_API_URL)
            .header("Accept", "application/vnd.github+json")
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.json())
            .map_err(|e| e.to_string())?;
        let release =
            parse_release(&payload).filter(|r| compare_versions(&r.version, &current).is_gt());
        let Some(release) = release else {
            let _ = write_state(&dir, &success_state(installed.clone(), now_ms()));
            return Ok(());
        };
        eprintln!(
            "Updating umu-launcher from {current} to {}",
            release.version
        );
        install(&dir, &release)?;
        let _ = write_state(
            &dir,
            &success_state(Some(release.version.clone()), now_ms()),
        );
        let previous = installed.clone().unwrap_or_else(|| release.version.clone());
        remove_stale(&dir, &[release.version.as_str(), previous.as_str()]);
        eprintln!("umu-launcher updated to {}", release.version);
        Ok(())
    })();
    if let Err(error) = result {
        let failed = failure_state(state.as_ref(), installed, now_ms());
        eprintln!(
            "Failed to update umu-launcher from {current} (failure {}): {error}",
            failed.failure_count
        );
        let _ = write_state(&dir, &failed);
    }
}

static RUNNING: Mutex<bool> = Mutex::new(false);

/// UmuUpdater.checkForUpdates: at most one check at a time, in the background.
pub fn check_for_updates() {
    if !cfg!(target_os = "linux") {
        return;
    }
    {
        let mut running = RUNNING.lock().unwrap_or_else(|e| e.into_inner());
        if *running {
            return;
        }
        *running = true;
    }
    std::thread::Builder::new()
        .name("umu-updater".into())
        .spawn(|| {
            // A failed check must never leave the updater stuck as running.
            if std::panic::catch_unwind(run_check).is_err() {
                eprintln!("umu-launcher update check panicked");
            }
            *RUNNING.lock().unwrap_or_else(|e| e.into_inner()) = false;
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        use std::cmp::Ordering::*;
        assert_eq!(compare_versions("1.4.4", "1.4.4"), Equal);
        assert_eq!(compare_versions("1.4.10", "1.4.4"), Greater);
        assert_eq!(compare_versions("1.4", "1.4.0"), Equal);
        assert_eq!(compare_versions("1.3.9", "1.4"), Less);
        assert!(is_valid_version("1.4.4"));
        assert!(!is_valid_version("1.4.4-rc1"));
        assert!(!is_valid_version(""));
    }

    #[test]
    fn releases() {
        let digest = "a".repeat(64);
        let payload = json!({
            "draft": false,
            "prerelease": false,
            "assets": [
                { "name": "umu-launcher-1.5.0-source.tar.gz", "browser_download_url": "https://github.com/x" },
                {
                    "name": "umu-launcher-1.5.0-zipapp.tar",
                    "digest": format!("sha256:{}", digest.to_uppercase()),
                    "browser_download_url": "https://github.com/Open-Wine-Components/umu-launcher/releases/download/1.5.0/umu-launcher-1.5.0-zipapp.tar"
                }
            ]
        });
        let release = parse_release(&payload).unwrap();
        assert_eq!(release.version, "1.5.0");
        assert_eq!(release.sha256, digest);
        let mut prerelease = payload.clone();
        prerelease["prerelease"] = json!(true);
        assert_eq!(parse_release(&prerelease), None);
        let mut foreign = payload.clone();
        foreign["assets"][1]["browser_download_url"] = json!("https://example.com/umu.tar");
        assert_eq!(parse_release(&foreign), None);
        let mut undigested = payload;
        undigested["assets"][1]["digest"] = Value::Null;
        assert_eq!(parse_release(&undigested), None);
    }

    #[test]
    fn schedule() {
        assert!(is_check_due(None, 0.0));
        let ok = success_state(None, 1000.0);
        assert!(!is_check_due(Some(&ok), 1000.0 + CHECK_INTERVAL_MS - 1.0));
        assert!(is_check_due(Some(&ok), 1000.0 + CHECK_INTERVAL_MS));
        let failed = failure_state(Some(&ok), None, 5000.0);
        assert_eq!(failed.failure_count, 1);
        assert_eq!(failed.retry_at, Some(5000.0 + RETRY_BASE_DELAY_MS));
        assert!(!is_check_due(
            Some(&failed),
            5000.0 + RETRY_BASE_DELAY_MS - 1.0
        ));
        let again = failure_state(Some(&failed), None, 0.0);
        assert_eq!(again.retry_at, Some(2.0 * RETRY_BASE_DELAY_MS));
        assert_eq!(retry_delay(30), CHECK_INTERVAL_MS);
        assert_eq!(
            parse_state(
                &json!({ "version": "1.5.0", "checkedAt": 3, "failureCount": 2.7, "retryAt": null })
            ),
            Some(State {
                version: Some("1.5.0".into()),
                checked_at: 3.0,
                failure_count: 2,
                retry_at: None
            })
        );
        assert_eq!(parse_state(&json!({ "version": "1.5.0" })), None);
    }

    /// Network: the real latest release, downloaded, digest-checked and
    /// installed into a scratch folder. `cargo test -p hydra-launch -- --ignored`
    #[test]
    #[ignore]
    fn installs_the_real_release() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let payload: Value = client(RELEASE_TIMEOUT_SECS)
            .unwrap()
            .get(RELEASE_API_URL)
            .header("Accept", "application/vnd.github+json")
            .send()
            .unwrap()
            .json()
            .unwrap();
        let release = parse_release(&payload).expect("a zipapp release");
        let dir = std::env::temp_dir().join(format!("hydra-umu-install-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        install(&dir, &release).unwrap();
        let binary = version_binary(&dir, &release.version);
        assert!(is_usable(&binary));
        let mut tampered = release.clone();
        tampered.sha256 = "0".repeat(64);
        assert!(
            install(&dir, &tampered)
                .unwrap_err()
                .contains("digest mismatch")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extracts_only_the_zipapp() {
        let mut builder = tar::Builder::new(Vec::new());
        for (path, data) in [
            ("umu/README", &b"readme"[..]),
            ("umu/umu-run", &b"#!zipapp"[..]),
        ] {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, path, data).unwrap();
        }
        let archive = builder.into_inner().unwrap();
        let dir = std::env::temp_dir().join(format!("hydra-umu-tar-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let target = dir.join("umu/umu-run");
        extract_zipapp(&archive, &target).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"#!zipapp");
        assert!(!dir.join("umu/README").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
