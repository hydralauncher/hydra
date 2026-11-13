//! legendary-auth.ts (LegendaryAuthRunner, executeLegendaryCommand,
//! cleanupEpicTemporarySessions) and legendary-sync.ts (LegendarySyncRunner):
//! the public Legendary CLI in a private, temporary `LEGENDARY_CONFIG_PATH`.
//!
//! Every run gets `<userData>/epic-temporary/operation-XXXXXX` with
//! Electron's `config.ini` (no update checks, no aliasing). Sessions are
//! written there only for the run, then read back (Legendary may rotate the
//! refresh token) and the folder is removed.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;

use crate::cancel::Cancel;
use crate::error::{EpicError, Result, err};
use crate::process::{self, Interruption, Spawn};
use crate::protocol::{validate_legendary_session, validate_legendary_version};
use crate::store::{Bundle, restrict_directory, restrict_file};
use crate::time::now_ms;

pub const EPIC_LEGENDARY_PROCESS_TIMEOUT: Duration = Duration::from_secs(60);
pub const EPIC_LEGENDARY_API_TIMEOUT_SECONDS: u32 = 15;
pub const EPIC_LEGENDARY_MAX_OUTPUT_BYTES: usize = 128 * 1024;
pub const EPIC_SESSION_MAX_FILE_BYTES: u64 = 1024 * 1024;
/// EPIC_SYNC_TIMEOUT_MS
pub const EPIC_SYNC_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// EPIC_SYNC_MAX_OUTPUT_BYTES
pub const EPIC_SYNC_MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;
pub const TEMPORARY_DIRECTORY: &str = "epic-temporary";

/// The config.ini every private Legendary folder starts with.
pub const LEGENDARY_CONFIG: &str = "[Legendary]\ndisable_update_check = true\ndisable_update_notice = true\ndisable_auto_aliasing = true\n";

/// Stored credentials Legendary rejected (it deletes them afterwards).
fn session_expired(stderr: &str) -> bool {
    let lower = stderr.to_ascii_lowercase();
    [
        "stored credentials are no longer valid",
        "invalid refresh token",
        "invalid_refresh_token",
        "invalid_grant",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

pub struct CommandOptions<'a> {
    pub timeout: Duration,
    pub max_output: usize,
    pub cancel: &'a Cancel,
    pub session_required: bool,
    pub config_path: &'a Path,
}

/// executeLegendaryCommand: stdout on exit code 0.
pub fn execute_legendary(
    binary: &Path,
    args: &[String],
    options: CommandOptions,
) -> Result<String> {
    options.cancel.check()?;
    let finished = process::run(Spawn {
        program: binary,
        args: args.iter().map(OsString::from).collect(),
        env: vec![(
            "LEGENDARY_CONFIG_PATH".into(),
            options.config_path.as_os_str().to_os_string(),
        )],
        timeout: Some(options.timeout),
        stall_timeout: None,
        max_output: options.max_output,
        cancel: options.cancel.clone(),
        on_line: None,
    });
    if finished.cleanup_failed {
        return err("cleanup-failed");
    }
    match finished.interrupted {
        Some(Interruption::Cancelled) => return Err(EpicError::cancelled()),
        Some(Interruption::Timeout) => return err("timeout"),
        Some(Interruption::Output) => return err("auth-failed"),
        None => {}
    }
    if finished.spawn_error.is_some() || finished.code != Some(0) {
        let tail: String = {
            let chars: Vec<char> = finished.stderr.chars().collect();
            let start = chars.len().saturating_sub(4096);
            chars[start..].iter().collect()
        };
        return err(if options.session_required && session_expired(&tail) {
            "session-expired"
        } else {
            "auth-failed"
        });
    }
    Ok(finished.stdout)
}

fn temporary_root(user_data: &Path) -> PathBuf {
    user_data.join(TEMPORARY_DIRECTORY)
}

/// cleanupEpicTemporarySessions: crash recovery of our own folders only.
pub fn cleanup_temporary_sessions(user_data: &Path) -> Result<()> {
    let root = temporary_root(user_data);
    let entries = match std::fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return err("cleanup-failed"),
    };
    let mut failed = false;
    for entry in entries.flatten() {
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with("operation-")
            && std::fs::remove_dir_all(entry.path()).is_err()
            && entry.path().exists()
        {
            failed = true;
        }
    }
    if failed {
        err("cleanup-failed")
    } else {
        Ok(())
    }
}

/// fs.mkdtemp(root/operation-)
fn make_operation_dir(user_data: &Path) -> std::io::Result<PathBuf> {
    let root = temporary_root(user_data);
    std::fs::create_dir_all(&root)?;
    restrict_directory(&root);
    for _ in 0..16 {
        let suffix: String = uuid::Uuid::new_v4()
            .simple()
            .to_string()
            .chars()
            .take(6)
            .collect();
        let dir = root.join(format!("operation-{suffix}"));
        match std::fs::create_dir(&dir) {
            Ok(()) => {
                restrict_directory(&dir);
                return Ok(dir);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::other("no unique operation folder"))
}

fn write_private(path: &Path, contents: &str) -> std::io::Result<()> {
    std::fs::write(path, contents)?;
    restrict_file(path);
    Ok(())
}

/// readJson: a small regular file (no symlinks), parsed.
fn read_private_json(path: &Path, max: u64) -> Option<Value> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > max {
        return None;
    }
    restrict_file(path);
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// A private Legendary folder, removed on drop.
pub struct OperationDir {
    path: PathBuf,
}

impl OperationDir {
    pub fn create(user_data: &Path) -> Result<Self> {
        let path =
            make_operation_dir(user_data).map_err(|_| EpicError::new("persistence-failed"))?;
        let dir = OperationDir { path };
        write_private(&dir.path.join("config.ini"), LEGENDARY_CONFIG)
            .map_err(|_| EpicError::new("persistence-failed"))?;
        Ok(dir)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// cleanup()
    pub fn remove(&self) -> Result<()> {
        match std::fs::remove_dir_all(&self.path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => err("cleanup-failed"),
        }
    }

    fn read_bundle(&self) -> Option<Bundle> {
        let user = read_private_json(&self.path.join("user.json"), EPIC_SESSION_MAX_FILE_BYTES)?;
        let version =
            read_private_json(&self.path.join("version.json"), EPIC_SESSION_MAX_FILE_BYTES)?;
        Some(Bundle { user, version })
    }
}

impl Drop for OperationDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn with_api_timeout(args: &[&str]) -> Vec<String> {
    let mut all = vec![
        "--api-timeout".to_string(),
        EPIC_LEGENDARY_API_TIMEOUT_SECONDS.to_string(),
    ];
    all.extend(args.iter().map(|a| a.to_string()));
    all
}

/// LegendaryAuthRunner: `legendary auth --code <code>` in a fresh folder.
pub struct AuthRunner {
    binary: PathBuf,
    dir: OperationDir,
}

impl AuthRunner {
    pub fn create(binary: &Path, user_data: &Path, cancel: &Cancel) -> Result<Self> {
        cancel.check()?;
        let dir = OperationDir::create(user_data).map_err(|e| {
            if cancel.is_cancelled() {
                EpicError::cancelled()
            } else {
                e
            }
        })?;
        cancel.check()?;
        Ok(AuthRunner {
            binary: binary.to_path_buf(),
            dir,
        })
    }

    /// authenticate(code): the Legendary session for the code.
    pub fn authenticate(&self, code: &str, cancel: &Cancel) -> Result<Bundle> {
        // Never restore an old user.json into an authentication attempt.
        if self.dir.path().join("user.json").exists() {
            return err("auth-failed");
        }
        cancel.check()?;
        execute_legendary(
            &self.binary,
            &with_api_timeout(&["auth", "--code", code]),
            CommandOptions {
                timeout: EPIC_LEGENDARY_PROCESS_TIMEOUT,
                max_output: EPIC_LEGENDARY_MAX_OUTPUT_BYTES,
                cancel,
                session_required: false,
                config_path: self.dir.path(),
            },
        )
        .map_err(|e| match e.code() {
            "operation-cancelled" | "timeout" | "cleanup-failed" | "auth-failed" => e,
            _ => EpicError::new("auth-failed"),
        })?;
        cancel.check()?;
        let bundle = self
            .dir
            .read_bundle()
            .ok_or_else(|| EpicError::new("auth-failed"))?;
        validate_legendary_session(&bundle.user)?;
        validate_legendary_version(&bundle.version)?;
        Ok(bundle)
    }

    pub fn cleanup(&self) -> Result<()> {
        self.dir.remove()
    }
}

/// LegendarySyncRunner: `list`/`status` with the stored session.
pub struct SyncRunner {
    binary: PathBuf,
    dir: OperationDir,
    account_id: String,
}

impl SyncRunner {
    pub fn create(
        binary: &Path,
        user_data: &Path,
        account_id: &str,
        bundle: &Bundle,
        cancel: &Cancel,
    ) -> Result<Self> {
        cancel.check()?;
        validate_legendary_session(&bundle.user)?;
        validate_legendary_version(&bundle.version)?;
        if bundle.account_id() != account_id {
            return err("different-account");
        }
        let dir = OperationDir::create(user_data)?;
        for (name, value) in [
            ("user.json", &bundle.user),
            ("version.json", &bundle.version),
        ] {
            let contents =
                serde_json::to_string(value).map_err(|_| EpicError::new("invalid-response"))?;
            if contents.len() as u64 > EPIC_SESSION_MAX_FILE_BYTES {
                return err("invalid-response");
            }
            write_private(&dir.path().join(name), &contents)
                .map_err(|_| EpicError::new("persistence-failed"))?;
        }
        Ok(SyncRunner {
            binary: binary.to_path_buf(),
            dir,
            account_id: account_id.to_string(),
        })
    }

    /// saveRotatedSession: the session Legendary left behind, when it is
    /// still valid (a synthetic expiry that forced a refresh is never kept).
    fn rotated_session(&self) -> Result<Option<Bundle>> {
        let bundle = self
            .dir
            .read_bundle()
            .ok_or_else(|| EpicError::new("invalid-response"))?;
        validate_legendary_session(&bundle.user)?;
        validate_legendary_version(&bundle.version)?;
        if bundle.account_id() != self.account_id {
            return err("different-account");
        }
        let now = now_ms();
        if bundle.expires_at().is_none_or(|at| at <= now)
            || bundle.refresh_expires_at().is_none_or(|at| at <= now)
        {
            return Ok(None);
        }
        Ok(Some(bundle))
    }

    /// run(args): JSON stdout, and the rotated session for the caller to save.
    fn run(
        &self,
        args: &[&str],
        cancel: &Cancel,
        on_session: &mut dyn FnMut(Bundle) -> Result<()>,
    ) -> Result<Value> {
        let result = execute_legendary(
            &self.binary,
            &with_api_timeout(args),
            CommandOptions {
                timeout: EPIC_SYNC_TIMEOUT,
                max_output: EPIC_SYNC_MAX_OUTPUT_BYTES,
                cancel,
                session_required: true,
                config_path: self.dir.path(),
            },
        );
        if let Err(error) = &result
            && (error.is("session-expired") || error.is("cleanup-failed"))
        {
            // Legendary deletes invalid credentials; reading them would hide the reconnect.
            return Err(error.clone());
        }
        // The tree is stopped; a cancelled run still keeps a rotated token.
        if let Some(bundle) = self.rotated_session()? {
            on_session(bundle)?;
        }
        let output = result?;
        cancel.check()?;
        serde_json::from_str(&output).map_err(|_| EpicError::new("invalid-response"))
    }

    /// library(): `list --json --include-non-installable` for Windows and Mac.
    pub fn library(
        &self,
        cancel: &Cancel,
        on_session: &mut dyn FnMut(Bundle) -> Result<()>,
    ) -> Result<Vec<Value>> {
        let mut results = Vec::new();
        for platform in ["Windows", "Mac"] {
            let result = self.run(
                &[
                    "list",
                    "--json",
                    "--include-non-installable",
                    "--platform",
                    platform,
                ],
                cancel,
                on_session,
            )?;
            if !result.is_array() {
                return err("invalid-response");
            }
            results.push(result);
        }
        Ok(results)
    }

    /// refresh(force): `status --json`, with a synthetic expiry when forced.
    pub fn refresh(
        &self,
        force: bool,
        cancel: &Cancel,
        on_session: &mut dyn FnMut(Bundle) -> Result<()>,
    ) -> Result<()> {
        if force {
            let file = self.dir.path().join("user.json");
            let mut user = read_private_json(&file, EPIC_SESSION_MAX_FILE_BYTES)
                .ok_or_else(|| EpicError::new("invalid-response"))?;
            validate_legendary_session(&user)?;
            user["expires_at"] = Value::String(crate::time::iso(0));
            write_private(&file, &user.to_string())
                .map_err(|_| EpicError::new("persistence-failed"))?;
        }
        self.run(&["status", "--json"], cancel, on_session)?;
        Ok(())
    }

    pub fn cleanup(&self) -> Result<()> {
        self.dir.remove()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_rejected_sessions() {
        assert!(session_expired(
            "[cli] ERROR: Stored credentials are no longer valid! Please login again."
        ));
        assert!(session_expired(
            "{'errorCode': 'errors.com.epicgames.account.auth_token.invalid_refresh_token'}"
        ));
        assert!(!session_expired("ConnectionError"));
    }

    #[test]
    fn operation_folders_are_private_and_cleaned() {
        let dir = tempfile::tempdir().unwrap();
        let operation = OperationDir::create(dir.path()).unwrap();
        let path = operation.path().to_path_buf();
        assert!(
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("operation-")
        );
        assert_eq!(
            std::fs::read_to_string(path.join("config.ini")).unwrap(),
            LEGENDARY_CONFIG
        );
        std::mem::forget(operation);
        assert!(path.exists());
        cleanup_temporary_sessions(dir.path()).unwrap();
        assert!(!path.exists());
        // folders we didn't create are left alone
        let other = dir.path().join(TEMPORARY_DIRECTORY).join("keep");
        std::fs::create_dir_all(&other).unwrap();
        cleanup_temporary_sessions(dir.path()).unwrap();
        assert!(other.exists());
    }

    #[test]
    fn sync_runner_rejects_other_accounts() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = crate::store::tests::bundle("a", "r");
        let result = SyncRunner::create(
            Path::new("legendary"),
            dir.path(),
            "ffffffffffffffffffffffffffffffff",
            &bundle,
            &Cancel::new(),
        );
        assert_eq!(result.err().unwrap().code(), "different-account");
    }
}
