//! legendary-managed-runtime.ts and target-runtime.ts: the managed adapter
//! (`managed.py`, protocol 1) in private workspaces under `epic-managed` and
//! `epic-managed-previews`.
//!
//! A request is `managed-request.json` (`{ protocolVersion: 1, operation, … }`)
//! inside the workspace that `LEGENDARY_CONFIG_PATH` names; the adapter reads
//! nothing else. Credentials (`user.json`, `version.json`) exist in the
//! workspace only while a request runs.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::cancel::Cancel;
use crate::error::{EpicError, Result, err};
use crate::legendary::ManagedCommand;
use crate::process::{self, Interruption, Spawn};
use crate::protocol::{validate_legendary_session, validate_legendary_version};
use crate::runner::{EPIC_SYNC_MAX_OUTPUT_BYTES, EPIC_SYNC_TIMEOUT, LEGENDARY_CONFIG};
use crate::store::{Bundle, restrict_directory, restrict_file};
use crate::time::now_ms;

pub const MANAGED_DIRECTORY: &str = "epic-managed";
pub const PREVIEWS_DIRECTORY: &str = "epic-managed-previews";
/// EPIC_DOWNLOAD_STALL_TIMEOUT_MS
pub const DOWNLOAD_STALL_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// EpicLocalOwner
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Owner {
    pub environment: String,
    pub user_id: String,
    pub epic_account_id: String,
}

impl Owner {
    pub fn to_json(&self) -> Value {
        json!({
            "environment": self.environment,
            "userId": self.user_id,
            "epicAccountId": self.epic_account_id,
        })
    }
}

fn hash_json(value: &Value) -> String {
    format!("{:x}", Sha256::digest(value.to_string().as_bytes()))
}

/// managedWorkspacePath: `epic-managed/<sha(owner)>/<sha([artifact, platform])>`.
pub fn workspace_path(
    user_data: &Path,
    owner: &Owner,
    artifact_id: &str,
    platform: &str,
) -> PathBuf {
    user_data
        .join(MANAGED_DIRECTORY)
        .join(hash_json(&json!([
            owner.environment,
            owner.user_id,
            owner.epic_account_id
        ])))
        .join(hash_json(&json!([artifact_id, platform])))
}

/// The preview workspace of target-runtime.ts `directory(target)`.
pub fn preview_path(
    user_data: &Path,
    owner: &Owner,
    generation: u64,
    connection_id: &str,
    artifact_id: &str,
    platform: &str,
) -> PathBuf {
    // JSON.stringify keeps the owner's insertion order (serde_json sorts keys).
    let text = |value: &str| Value::String(value.to_string()).to_string();
    let scope = format!(
        r#"[{{"environment":{},"userId":{},"epicAccountId":{}}},{generation},{}]"#,
        text(&owner.environment),
        text(&owner.user_id),
        text(&owner.epic_account_id),
        text(connection_id),
    );
    user_data
        .join(PREVIEWS_DIRECTORY)
        .join(format!("{:x}", Sha256::digest(scope.as_bytes())))
        .join(hash_json(&json!([artifact_id, platform])))
}

/// prepare / prepareDirectory: the folder chain (no symlinks) and a fresh config.ini.
pub fn prepare_workspace(root: &Path, directory: &Path) -> Result<()> {
    let invalid = || EpicError::new("invalid-path");
    let mut chain = vec![root.to_path_buf()];
    if let Some(parent) = directory.parent()
        && parent != root
    {
        chain.push(parent.to_path_buf());
    }
    chain.push(directory.to_path_buf());
    for item in &chain {
        std::fs::create_dir_all(item).map_err(|_| invalid())?;
        let meta = std::fs::symlink_metadata(item).map_err(|_| invalid())?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(invalid());
        }
        restrict_directory(item);
    }
    let config = directory.join("config.ini");
    if let Ok(meta) = std::fs::symlink_metadata(&config)
        && (!meta.is_file() || meta.file_type().is_symlink())
    {
        return Err(invalid());
    }
    let _ = std::fs::remove_file(&config);
    std::fs::write(&config, LEGENDARY_CONFIG).map_err(|_| invalid())?;
    restrict_file(&config);
    Ok(())
}

/// privateJson: a new private file (removing what was there).
fn private_json(file: &Path, value: &Value) -> Result<()> {
    let data = value.to_string();
    if data.len() > EPIC_SYNC_MAX_OUTPUT_BYTES {
        return err("invalid-response");
    }
    let _ = std::fs::remove_file(file);
    std::fs::write(file, data).map_err(|_| EpicError::new("persistence-failed"))?;
    restrict_file(file);
    Ok(())
}

/// clearCredentials
pub fn clear_credentials(directory: &Path) -> Result<()> {
    let mut failed = false;
    for name in ["user.json", "version.json", "managed-request.json"] {
        let file = directory.join(name);
        if let Err(error) = std::fs::remove_file(&file)
            && error.kind() != std::io::ErrorKind::NotFound
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

/// cleanupCredentials: every workspace of both roots (startup and stop).
pub fn cleanup_all_credentials(user_data: &Path) -> Result<()> {
    let hex64 = |name: &str| name.len() == 64 && name.chars().all(|c| c.is_ascii_hexdigit());
    for name in [MANAGED_DIRECTORY, PREVIEWS_DIRECTORY] {
        let root = user_data.join(name);
        let meta = match std::fs::symlink_metadata(&root) {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return err("invalid-path"),
        };
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return err("invalid-path");
        }
        for scope in std::fs::read_dir(&root)
            .map_err(|_| EpicError::new("invalid-path"))?
            .flatten()
        {
            let scope_name = scope.file_name().to_string_lossy().into_owned();
            if !scope.file_type().is_ok_and(|t| t.is_dir()) || !hex64(&scope_name) {
                continue;
            }
            for game in std::fs::read_dir(scope.path())
                .into_iter()
                .flatten()
                .flatten()
            {
                let game_name = game.file_name().to_string_lossy().into_owned();
                if game.file_type().is_ok_and(|t| t.is_dir()) && hex64(&game_name) {
                    clear_credentials(&game.path())?;
                }
            }
        }
    }
    Ok(())
}

/// classifyLegendaryFailure
pub fn classify_failure(stderr: &str) -> &'static str {
    const MANAGED: [&str; 9] = [
        "session-expired",
        "invalid-artifact",
        "not-installable",
        "external-launcher-required",
        "invalid-response",
        "network",
        "operation-cancelled",
        "update-required",
        "installation-missing",
    ];
    for line in stderr.lines() {
        if let Some(code) = line
            .trim_end_matches('\r')
            .strip_prefix("HYDRA_MANAGED_ERROR:")
            && let Some(known) = MANAGED.iter().find(|known| **known == code)
        {
            return known;
        }
    }
    let lower = stderr.to_ascii_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| lower.contains(n));
    if has(&[
        "game is out of date",
        "please update the game",
        "please update before launching",
    ]) {
        "update-required"
    } else if has(&[
        "log in failed",
        "login failed",
        "failed to login",
        "authentication failed",
        "invalid refresh token",
    ]) {
        "session-expired"
    } else if has(&[
        "connectionerror",
        "readtimeout",
        "failed to establish a new connection",
    ]) {
        "network"
    } else if has(&[
        "not enough free space",
        "not enough disk space",
        "not enough space",
        "insufficient disk space",
    ]) {
        "insufficient-space"
    } else {
        "process-failed"
    }
}

/// LEGENDARY_CONFIG_PATH: `path.toNamespacedPath(directory)` on Windows.
fn config_path(directory: &Path) -> OsString {
    if cfg!(windows) {
        let text = directory.to_string_lossy();
        if text.starts_with(r"\\?\") {
            directory.as_os_str().to_os_string()
        } else if let Some(unc) = text.strip_prefix(r"\\") {
            OsString::from(format!(r"\\?\UNC\{unc}"))
        } else {
            OsString::from(format!(r"\\?\{text}"))
        }
    } else {
        directory.as_os_str().to_os_string()
    }
}

pub struct ExecuteOptions<'a> {
    pub cancel: &'a Cancel,
    pub timeout: Option<Duration>,
    /// Streaming commands (install) report lines and use the stall timeout.
    pub on_line: Option<&'a mut dyn FnMut(&str)>,
    pub success_codes: &'a [i32],
}

pub struct Executed {
    pub stdout: String,
    pub stderr: String,
}

/// executeManagedLegendary: returns once the whole tree has stopped.
pub fn execute(
    binary: &Path,
    args: Vec<OsString>,
    directory: &Path,
    options: ExecuteOptions,
) -> Result<Executed> {
    options.cancel.check()?;
    let streaming = options.on_line.is_some();
    let finished = process::run(Spawn {
        program: binary,
        args,
        env: vec![("LEGENDARY_CONFIG_PATH".into(), config_path(directory))],
        timeout: options.timeout,
        stall_timeout: streaming.then_some(DOWNLOAD_STALL_TIMEOUT),
        max_output: EPIC_SYNC_MAX_OUTPUT_BYTES,
        cancel: options.cancel.clone(),
        on_line: options.on_line,
    });
    if finished.cleanup_failed {
        return err("cleanup-failed");
    }
    match finished.interrupted {
        Some(Interruption::Cancelled) => return Err(EpicError::cancelled()),
        Some(Interruption::Timeout) => return err("timeout"),
        Some(Interruption::Output) => return err("invalid-response"),
        None => {}
    }
    if finished.spawn_error.is_some() {
        return err("process-failed");
    }
    match finished.code {
        Some(code) if options.success_codes.contains(&code) => Ok(Executed {
            stdout: finished.stdout,
            stderr: finished.stderr,
        }),
        _ => err(classify_failure(&finished.stderr)),
    }
}

/// invoke(): write the request, run the adapter on it.
pub fn invoke(
    command: &ManagedCommand,
    directory: &Path,
    request: Value,
    options: ExecuteOptions,
) -> Result<Executed> {
    options.cancel.check()?;
    let mut request = request;
    if let Some(map) = request.as_object_mut() {
        map.insert("protocolVersion".into(), json!(1));
    }
    let file = directory.join("managed-request.json");
    private_json(&file, &request)?;
    options.cancel.check()?;
    let mut args = command.prefix_args.clone();
    args.push("--request".into());
    args.push(file.into_os_string());
    let timeout = if options.on_line.is_some() {
        None
    } else {
        Some(options.timeout.unwrap_or(EPIC_SYNC_TIMEOUT))
    };
    execute(
        &command.binary,
        args,
        directory,
        ExecuteOptions { timeout, ..options },
    )
}

/// The credentials Legendary left in the workspace (`save`): kept only when
/// they belong to the owner and the access token is still valid.
pub fn read_rotated(directory: &Path, epic_account_id: &str) -> Result<Option<Bundle>> {
    let read = |name: &str| -> Result<Value> {
        let file = directory.join(name);
        let meta =
            std::fs::symlink_metadata(&file).map_err(|_| EpicError::new("invalid-response"))?;
        if !meta.is_file()
            || meta.file_type().is_symlink()
            || meta.len() as usize > EPIC_SYNC_MAX_OUTPUT_BYTES
        {
            return err("invalid-response");
        }
        serde_json::from_str(
            &std::fs::read_to_string(&file).map_err(|_| EpicError::new("invalid-response"))?,
        )
        .map_err(|_| EpicError::new("invalid-response"))
    };
    let user = read("user.json")?;
    let version = read("version.json")?;
    validate_legendary_session(&user)?;
    validate_legendary_version(&version)?;
    let bundle = Bundle { user, version };
    if bundle.account_id() != epic_account_id {
        return err("different-account");
    }
    Ok(bundle
        .expires_at()
        .is_some_and(|at| at > now_ms())
        .then_some(bundle))
}

/// Write the session into a workspace for one request.
pub fn write_credentials(directory: &Path, bundle: &Bundle) -> Result<()> {
    validate_legendary_session(&bundle.user)?;
    validate_legendary_version(&bundle.version)?;
    private_json(&directory.join("user.json"), &bundle.user)?;
    private_json(&directory.join("version.json"), &bundle.version)
}

/// EpicTargetRuntime.refresh: the adapter's `refresh` operation (OAuth
/// rotation without listing anything), in the `session-refresh` preview.
#[allow(clippy::too_many_arguments)]
pub fn refresh_session(
    command: &ManagedCommand,
    user_data: &Path,
    owner: &Owner,
    generation: u64,
    connection_id: &str,
    bundle: &Bundle,
    cancel: &Cancel,
    is_current: &dyn Fn() -> bool,
) -> Result<Bundle> {
    let directory = preview_path(
        user_data,
        owner,
        generation,
        connection_id,
        "session-refresh",
        "Windows",
    );
    if cancel.is_cancelled() || !is_current() {
        return Err(EpicError::cancelled());
    }
    prepare_workspace(&user_data.join(PREVIEWS_DIRECTORY), &directory)?;
    let result = (|| {
        write_credentials(&directory, bundle)?;
        let failure = match invoke(
            command,
            &directory,
            json!({ "operation": "refresh" }),
            ExecuteOptions {
                cancel,
                timeout: None,
                on_line: None,
                success_codes: &[0],
            },
        ) {
            Ok(output) => match serde_json::from_str::<Value>(&output.stdout) {
                Ok(value) if value.get("protocolVersion") == Some(&json!(1)) => None,
                _ => Some(EpicError::new("invalid-response")),
            },
            Err(error) => Some(error),
        };
        // Keep an OAuth rotation that finished before the last consumer left.
        if !is_current() {
            return Err(EpicError::cancelled());
        }
        let rotated = read_rotated(&directory, &owner.epic_account_id)?;
        if let Some(failure) = &failure
            && !failure.is("operation-cancelled")
        {
            return Err(failure.clone());
        }
        match (rotated, failure) {
            (Some(bundle), _) => Ok(bundle),
            (None, Some(failure)) => Err(failure),
            (None, None) => err("session-expired"),
        }
    })();
    let cleaned = clear_credentials(&directory);
    let bundle = result?;
    cleaned?;
    Ok(bundle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_paths_match_electron() {
        let owner = Owner {
            environment: "https://api.example.com".into(),
            user_id: "u".into(),
            epic_account_id: "0123456789abcdef0123456789abcdef".into(),
        };
        let path = workspace_path(Path::new("/data"), &owner, "Fortnite", "Windows");
        let scope = format!(
            "{:x}",
            Sha256::digest(
                br#"["https://api.example.com","u","0123456789abcdef0123456789abcdef"]"#
            )
        );
        let artifact = format!("{:x}", Sha256::digest(br#"["Fortnite","Windows"]"#));
        assert_eq!(
            path,
            Path::new("/data")
                .join("epic-managed")
                .join(scope)
                .join(artifact)
        );
        let preview = preview_path(Path::new("/d"), &owner, 3, "conn12345678", "a", "Windows");
        let scope = format!(
            "{:x}",
            Sha256::digest(
                br#"[{"environment":"https://api.example.com","userId":"u","epicAccountId":"0123456789abcdef0123456789abcdef"},3,"conn12345678"]"#
            )
        );
        assert!(preview.to_string_lossy().contains(&scope));
    }

    #[test]
    fn failures_are_classified() {
        assert_eq!(
            classify_failure("noise\nHYDRA_MANAGED_ERROR:not-installable\n"),
            "not-installable"
        );
        assert_eq!(
            classify_failure("HYDRA_MANAGED_ERROR:other"),
            "process-failed"
        );
        assert_eq!(
            classify_failure("[cli] ERROR: Game is out of date, please update"),
            "update-required"
        );
        assert_eq!(
            classify_failure("requests.exceptions.ConnectionError: x"),
            "network"
        );
        assert_eq!(
            classify_failure("Not enough available disk space!"),
            "process-failed"
        );
        assert_eq!(
            classify_failure("not enough free space"),
            "insufficient-space"
        );
    }

    #[test]
    fn workspaces_are_prepared_and_cleaned() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join(MANAGED_DIRECTORY);
        let workspace = root.join("a".repeat(64)).join("b".repeat(64));
        prepare_workspace(&root, &workspace).unwrap();
        assert!(workspace.join("config.ini").is_file());
        write_credentials(&workspace, &crate::store::tests::bundle("a", "r")).unwrap();
        assert!(workspace.join("user.json").is_file());
        cleanup_all_credentials(dir.path()).unwrap();
        assert!(!workspace.join("user.json").exists());
        assert!(workspace.join("config.ini").exists());
        if cfg!(windows) {
            assert!(
                config_path(Path::new(r"C:\x"))
                    .to_string_lossy()
                    .starts_with(r"\\?\C:\")
            );
        }
    }
}
