//! The Epic branch of events/library/delete-game-folder.ts with
//! EpicDownloadService.forgetInstallation and forgetEpicInstalledEntries:
//! removing a managed Epic install from disk and from Legendary's
//! `installed.json` in the account's workspace.
//!
//! The install folder is removed only when it is a real directory inside
//! the download path (no symlinks, no escapes), like Electron.

use std::path::{Component, Path, PathBuf};

use hydra_db::{Db, keys};
use serde_json::{Map, Value};

use crate::error::{EpicError, Result, err};
use crate::managed::{Owner, workspace_path};
use crate::session::AuthContext;

/// Downloader.Epic
pub const EPIC_DOWNLOADER: i64 = 15;

fn text<'a>(map: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    map.get(key).and_then(Value::as_str)
}

/// isPathContained(root, file)
pub fn is_path_contained(root: &Path, file: &Path, allow_root: bool) -> bool {
    let Ok(relative) = file.strip_prefix(root) else {
        return false;
    };
    if relative.as_os_str().is_empty() {
        return allow_root;
    }
    !relative.components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    })
}

/// Two spellings of one folder (Windows: no `\\?\`, any case, no trailing separator).
fn same_path(canonical: &Path, given: &Path) -> bool {
    let normalize = |path: &Path| {
        let text = path.to_string_lossy().replace('/', "\\");
        let text = text
            .strip_prefix(r"\\?\")
            .unwrap_or(&text)
            .trim_end_matches(['\\', '/'])
            .to_string();
        if cfg!(windows) {
            text.to_lowercase()
        } else {
            text
        }
    };
    if cfg!(windows) {
        normalize(canonical) == normalize(given)
    } else {
        canonical == given || canonical == given.components().collect::<PathBuf>()
    }
}

fn canonical(path: &Path) -> Result<PathBuf> {
    std::fs::canonicalize(path).map_err(|_| EpicError::new("invalid-path"))
}

/// readManagedJson: a small regular file.
fn read_managed_json(file: &Path) -> Result<Option<Value>> {
    let meta = match std::fs::symlink_metadata(file) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return err("invalid-response"),
    };
    if !meta.is_file()
        || meta.file_type().is_symlink()
        || meta.len() as usize > crate::runner::EPIC_SYNC_MAX_OUTPUT_BYTES
    {
        return err("invalid-response");
    }
    let text = std::fs::read_to_string(file).map_err(|_| EpicError::new("invalid-response"))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|_| EpicError::new("invalid-response"))
}

/// writeManagedJson: a temporary file renamed over the target.
fn write_managed_json(file: &Path, value: &Value) -> Result<()> {
    let directory = file
        .parent()
        .ok_or_else(|| EpicError::new("invalid-path"))?;
    let meta = std::fs::symlink_metadata(directory).map_err(|_| EpicError::new("invalid-path"))?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return err("invalid-path");
    }
    let temporary = directory.join(format!(".hydra-{}.tmp", uuid::Uuid::new_v4()));
    let result = std::fs::write(&temporary, value.to_string())
        .and_then(|()| std::fs::rename(&temporary, file))
        .map_err(|_| EpicError::new("persistence-failed"));
    let _ = std::fs::remove_file(&temporary);
    result
}

/// forgetEpicInstalledEntries: the game and the DLCs installed with it.
pub fn forget_installed_entries(installed: &mut Map<String, Value>, artifact_id: &str) {
    let install_path = installed
        .get(artifact_id)
        .and_then(|g| g.get("install_path"))
        .and_then(Value::as_str)
        .map(PathBuf::from);
    installed.remove(artifact_id);
    let Some(install_path) = install_path else {
        return;
    };
    installed.retain(|_, entry| {
        !(entry.get("is_dlc").and_then(Value::as_bool) == Some(true)
            && entry
                .get("install_path")
                .and_then(Value::as_str)
                .is_some_and(|p| Path::new(p) == install_path))
    });
}

/// The `epic` metadata of a download (EpicDownloadMetadata), as far as removal needs it.
pub struct EpicDownload {
    pub owner: Owner,
    pub artifact_id: String,
    pub platform: String,
    pub connection_id: String,
    pub download_path: PathBuf,
    pub folder_name: String,
}

/// The Epic download of `key`, if it is one.
pub fn epic_download(db: &Db, key: &str) -> Option<Map<String, Value>> {
    db.get_in::<Value>(keys::DOWNLOADS, key)
        .and_then(|d| d.as_object().cloned())
        .filter(|d| d.get("downloader").and_then(Value::as_i64) == Some(EPIC_DOWNLOADER))
}

fn parse_download(download: &Map<String, Value>) -> Result<EpicDownload> {
    let epic = download
        .get("epic")
        .and_then(Value::as_object)
        .ok_or_else(|| EpicError::new("invalid-path"))?;
    let owner = epic
        .get("owner")
        .and_then(Value::as_object)
        .ok_or_else(|| EpicError::new("invalid-path"))?;
    let field = |map: &Map<String, Value>, key: &str| {
        text(map, key)
            .map(str::to_string)
            .ok_or_else(|| EpicError::new("invalid-path"))
    };
    let folder_name = text(download, "folderName")
        .filter(|f| !f.is_empty())
        .ok_or_else(|| EpicError::new("invalid-path"))?;
    Ok(EpicDownload {
        owner: Owner {
            environment: field(owner, "environment")?,
            user_id: field(owner, "userId")?,
            epic_account_id: field(owner, "epicAccountId")?,
        },
        artifact_id: field(epic, "artifactId")?,
        platform: field(epic, "platform")?,
        connection_id: text(epic, "connectionId").unwrap_or_default().to_string(),
        download_path: PathBuf::from(field(download, "downloadPath")?),
        folder_name: folder_name.to_string(),
    })
}

/// removeFiles: the install folder, when it is contained in the download path.
fn remove_install_folder(download: &EpicDownload) -> Result<()> {
    let base_meta = match std::fs::symlink_metadata(&download.download_path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return err("invalid-path"),
    };
    let base = canonical(&download.download_path)?;
    // path.relative(downloadPath, realpath) !== "": no symlinked ancestors
    if !base_meta.is_dir()
        || base_meta.file_type().is_symlink()
        || !same_path(&base, &download.download_path)
    {
        return err("invalid-path");
    }
    let candidate = base.join(&download.folder_name);
    if !is_path_contained(&base, &candidate, false) {
        return err("invalid-path");
    }
    let meta = match std::fs::symlink_metadata(&candidate) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return err("invalid-path"),
    };
    let directory = canonical(&candidate)?;
    if !meta.is_dir()
        || meta.file_type().is_symlink()
        || !is_path_contained(&base, &directory, false)
    {
        return err("invalid-path");
    }
    std::fs::remove_dir_all(&directory).map_err(|_| EpicError::new("process-failed"))
}

/// deleteGameFolder for an Epic download: the files, Legendary's
/// installed.json entry, the game's install fields and the download record.
/// `is_running` is isGameRunning || hasManagedEpicSession.
pub fn remove_epic_installation(
    db: &Db,
    user_data: &Path,
    key: &str,
    context: Option<&AuthContext>,
    is_running: &dyn Fn() -> bool,
) -> Result<()> {
    let Some(record) = epic_download(db, key) else {
        return Ok(());
    };
    let download = parse_download(&record)?;
    let Some(context) = context.filter(|c| {
        c.environment == download.owner.environment && c.user_id == download.owner.user_id
    }) else {
        return err("stale-connection");
    };
    let _ = context;
    if is_running() {
        return err("game-running");
    }
    // assertDownload: the record didn't change underneath us
    let unchanged = || {
        epic_download(db, key).is_some_and(|latest| {
            latest.get("timestamp") == record.get("timestamp")
                && latest.get("downloadPath") == record.get("downloadPath")
                && latest.get("folderName") == record.get("folderName")
                && latest.get("epic").and_then(|e| e.get("artifactId"))
                    == record.get("epic").and_then(|e| e.get("artifactId"))
        })
    };
    // forgetInstallation, under the workspace (single caller here)
    let workspace = workspace_path(
        user_data,
        &download.owner,
        &download.artifact_id,
        &download.platform,
    );
    let installed_file = workspace.join("installed.json");
    let installed = read_managed_json(&installed_file)?;
    if installed.as_ref().is_some_and(|v| !v.is_object()) {
        return err("invalid-response");
    }
    if !unchanged() {
        return Err(EpicError::cancelled());
    }
    if is_running() {
        return err("game-running");
    }
    remove_install_folder(&download)?;
    if let Some(Value::Object(mut installed)) = installed {
        forget_installed_entries(&mut installed, &download.artifact_id);
        write_managed_json(&installed_file, &Value::Object(installed))?;
    }
    if !unchanged() {
        return Err(EpicError::cancelled());
    }
    if let Some(Value::Object(mut game)) = db.get_in::<Value>(keys::GAMES, key) {
        if let Some(installation) = game.get("epicInstallation").and_then(Value::as_object) {
            let owner = installation.get("owner").and_then(Value::as_object);
            let owner_field = |k: &str| owner.and_then(|o| text(o, k));
            if text(installation, "artifactId") != Some(&download.artifact_id)
                || text(installation, "platform") != Some(&download.platform)
                || owner_field("environment") != Some(&download.owner.environment)
                || owner_field("userId") != Some(&download.owner.user_id)
                || owner_field("epicAccountId") != Some(&download.owner.epic_account_id)
            {
                return Err(EpicError::cancelled());
            }
        }
        game.insert("executablePath".into(), Value::Null);
        game.insert("installedSizeInBytes".into(), Value::Null);
        game.insert("installerSizeInBytes".into(), Value::Null);
        game.remove("epicInstallation");
        db.put_in(keys::GAMES, key, &Value::Object(game))
            .map_err(|_| EpicError::new("persistence-failed"))?;
    }
    db.delete_in(keys::DOWNLOADS, key)
        .map_err(|_| EpicError::new("persistence-failed"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn context() -> AuthContext {
        AuthContext {
            environment: "https://api".into(),
            user_id: "u".into(),
            generation: 1,
        }
    }

    fn owner() -> Value {
        json!({"environment": "https://api", "userId": "u", "epicAccountId": "0123456789abcdef0123456789abcdef"})
    }

    #[test]
    fn forgets_the_game_and_its_dlcs() {
        let mut installed = json!({
            "Game": {"install_path": "D:\\Games\\Game"},
            "Dlc": {"is_dlc": true, "install_path": "D:\\Games\\Game"},
            "Other": {"is_dlc": true, "install_path": "D:\\Games\\Other"},
        })
        .as_object()
        .cloned()
        .unwrap();
        forget_installed_entries(&mut installed, "Game");
        assert_eq!(installed.keys().collect::<Vec<_>>(), ["Other"]);
    }

    #[test]
    fn removes_an_epic_install() {
        let dir = tempfile::tempdir().unwrap();
        let user_data = dir.path().join("data");
        let games = dir.path().join("games");
        std::fs::create_dir_all(games.join("Sugar").join("bin")).unwrap();
        std::fs::write(games.join("Sugar").join("bin").join("game.exe"), b"x").unwrap();
        std::fs::write(games.join("keep.txt"), b"x").unwrap();
        let db = Db::open(dir.path().join("db")).unwrap();
        let key = "epic:ns:item";
        let download = json!({
            "shop": "epic", "objectId": "ns:item", "downloader": 15, "timestamp": 1,
            "downloadPath": games.to_string_lossy(), "folderName": "Sugar",
            "epic": {"owner": owner(), "artifactId": "Sugar", "platform": "Windows", "connectionId": "conn12345678"},
        });
        db.put_in(keys::DOWNLOADS, key, &download).unwrap();
        db.put_in(
            keys::GAMES,
            key,
            &json!({"objectId": "ns:item", "shop": "epic", "executablePath": "x",
                "epicInstallation": {"owner": owner(), "artifactId": "Sugar", "platform": "Windows"}}),
        )
        .unwrap();
        let workspace = workspace_path(
            &user_data,
            &Owner {
                environment: "https://api".into(),
                user_id: "u".into(),
                epic_account_id: "0123456789abcdef0123456789abcdef".into(),
            },
            "Sugar",
            "Windows",
        );
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::write(
            workspace.join("installed.json"),
            json!({"Sugar": {"install_path": games.join("Sugar").to_string_lossy()}}).to_string(),
        )
        .unwrap();
        // another account can't remove it
        let other = AuthContext {
            user_id: "x".into(),
            ..context()
        };
        assert_eq!(
            remove_epic_installation(&db, &user_data, key, Some(&other), &|| false)
                .unwrap_err()
                .code(),
            "stale-connection"
        );
        assert_eq!(
            remove_epic_installation(&db, &user_data, key, Some(&context()), &|| true)
                .unwrap_err()
                .code(),
            "game-running"
        );
        remove_epic_installation(&db, &user_data, key, Some(&context()), &|| false).unwrap();
        assert!(!games.join("Sugar").exists());
        assert!(games.join("keep.txt").exists());
        assert!(db.get_in::<Value>(keys::DOWNLOADS, key).is_none());
        let game: Value = db.get_in(keys::GAMES, key).unwrap();
        assert_eq!(game["executablePath"], Value::Null);
        assert!(game.get("epicInstallation").is_none());
        let installed: Value = serde_json::from_str(
            &std::fs::read_to_string(workspace.join("installed.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(installed, json!({}));
    }

    #[test]
    fn refuses_escaping_folders() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("games");
        std::fs::create_dir_all(&base).unwrap();
        assert!(is_path_contained(&base, &base.join("a"), false));
        assert!(!is_path_contained(&base, &base, false));
        assert!(!is_path_contained(&base, &dir.path().join("other"), false));
        let download = EpicDownload {
            owner: Owner {
                environment: "e".into(),
                user_id: "u".into(),
                epic_account_id: "a".into(),
            },
            artifact_id: "A".into(),
            platform: "Windows".into(),
            connection_id: String::new(),
            download_path: base.clone(),
            folder_name: "..".into(),
        };
        assert!(remove_install_folder(&download).is_err());
        assert!(dir.path().exists());
    }
}
