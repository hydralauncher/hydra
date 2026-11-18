//! delete-game-folder.ts (non-Epic) and has-source-archive.ts: removing a
//! download's files, optionally with the archive it was extracted from.

use std::path::{Path, PathBuf};

use hydra_db::{Db, keys};
use serde_json::{Map, Value, json};

use crate::layout;

fn text(download: &Map<String, Value>, key: &str) -> Option<String> {
    download
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// getDownloadFolderPath
pub fn folder_path(download: &Map<String, Value>) -> Option<PathBuf> {
    let folder = text(download, "folderName")?;
    Some(Path::new(&text(download, "downloadPath").unwrap_or_default()).join(folder))
}

/// getSourceArchivePath: `sourceArchiveName` inside the download path, never
/// the folder itself or anything outside it.
fn source_archive_path(download: &Map<String, Value>) -> Option<PathBuf> {
    let name = text(download, "sourceArchiveName")?;
    let base = PathBuf::from(text(download, "downloadPath").unwrap_or_default());
    let archive = base.join(&name);
    if Some(&archive) == folder_path(download).as_ref() {
        return None;
    }
    let relative = Path::new(&name);
    if relative.is_absolute()
        || relative
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return None;
    }
    Some(archive)
}

/// findSourceArchiveFile
pub fn source_archive(download: &Map<String, Value>) -> Option<PathBuf> {
    source_archive_path(download).filter(|p| p.is_file())
}

/// hasSourceArchive
pub fn has_source_archive(db: &Db, id: &str) -> bool {
    db.get_in::<Map<String, Value>>(keys::DOWNLOADS, id)
        .as_ref()
        .and_then(source_archive)
        .is_some()
}

/// readArchiveVolume: (pattern index, base name) for multi-volume names.
fn archive_volume(name: &str) -> Option<(usize, String)> {
    let lower = name.to_lowercase();
    let key = |base: &str| {
        if cfg!(windows) {
            base.to_lowercase()
        } else {
            base.to_string()
        }
    };
    // /^(.*)\.part\d+\.rar$/i
    if let Some(stem) = lower.strip_suffix(".rar")
        && let Some(index) = stem.rfind(".part")
        && stem.len() > index + 5
        && stem[index + 5..].chars().all(|c| c.is_ascii_digit())
    {
        return Some((0, key(&name[..index])));
    }
    // /^(.*\.(?:7z|zip|rar))\.\d{3}$/i
    if lower.len() > 4 {
        let (head, tail) = lower.split_at(lower.len() - 4);
        if tail.starts_with('.')
            && tail[1..].chars().all(|c| c.is_ascii_digit())
            && (head.ends_with(".7z") || head.ends_with(".zip") || head.ends_with(".rar"))
        {
            return Some((1, key(&name[..name.len() - 4])));
        }
    }
    // /^(.*)\.(?:rar|r\d{2})$/i
    if let Some(stem) = lower.strip_suffix(".rar") {
        return Some((2, key(&name[..stem.len()])));
    }
    if lower.len() > 4 {
        let (head, tail) = lower.split_at(lower.len() - 4);
        if tail.starts_with(".r") && tail[2..].chars().all(|c| c.is_ascii_digit()) {
            return Some((2, key(&name[..head.len()])));
        }
    }
    None
}

/// listArchiveVolumes: every volume of the same multi-part set.
pub fn archive_volumes(archive: &Path) -> Vec<PathBuf> {
    let Some(name) = archive
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
    else {
        return vec![archive.to_path_buf()];
    };
    let Some(volume) = archive_volume(&name) else {
        return vec![archive.to_path_buf()];
    };
    let directory = archive.parent().unwrap_or(Path::new("."));
    let volumes: Vec<PathBuf> = std::fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter(|e| archive_volume(&e.file_name().to_string_lossy()).as_ref() == Some(&volume))
        .map(|e| e.path())
        .collect();
    if volumes.is_empty() {
        vec![archive.to_path_buf()]
    } else {
        volumes
    }
}

/// isWithin
fn is_within(path: &str, folder: &Path) -> bool {
    let (path, folder) = (Path::new(path), folder);
    if cfg!(windows) {
        let p = path.to_string_lossy().to_lowercase().replace('/', "\\");
        let f = folder.to_string_lossy().to_lowercase().replace('/', "\\");
        p == f || p.starts_with(&format!("{}\\", f.trim_end_matches('\\')))
    } else {
        path.starts_with(folder)
    }
}

fn remove(path: &Path, directory: bool) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    // fs.rm with maxRetries 5, retryDelay 200
    let mut last = None;
    for _ in 0..6 {
        let result = if directory {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_file(path)
        };
        match result {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => last = Some(error),
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    Err(format!(
        "{}: {}",
        path.display(),
        last.map(|e| e.to_string()).unwrap_or_default()
    ))
}

/// deleteGameFolder for Hydra downloads (Epic installs are a TODO).
pub fn delete_game_folder(db: &Db, id: &str, delete_source_archive: bool) -> Result<(), String> {
    let Some(download) = db.get_in::<Map<String, Value>>(keys::DOWNLOADS, id) else {
        return Ok(());
    };
    if download.get("downloader").and_then(Value::as_i64)
        == Some(hydra_core::repacks::Downloader::Epic as i64)
    {
        return Err("TODO(downloads): removing Epic installations".into());
    }
    let folder = folder_path(&download);
    if let Some(folder) = &folder {
        remove(folder, true)?;
        remove(Path::new(&format!("{}.meta", folder.display())), false)?;
    }
    let volumes = if delete_source_archive {
        source_archive(&download)
            .map(|a| archive_volumes(&a))
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    for volume in volumes {
        if let Err(error) = remove(&volume, false) {
            eprintln!("[deleteGameFolder] Failed to delete source archive {error}");
        }
    }
    let _ = db.delete_in(keys::DOWNLOADS, id);
    // syncAfterDownloadRemoved
    let downloads = layout::all(db);
    layout::remove(db, id, &downloads);

    let _ = hydra_core::library_actions::update_game_record(db, id, |game| {
        game.insert("installerSizeInBytes".into(), Value::Null);
        let executable = game
            .get("executablePath")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let removed =
            executable.is_empty() || folder.as_ref().is_none_or(|f| is_within(&executable, f));
        if removed {
            game.insert("executablePath".into(), Value::Null);
            game.insert("installedSizeInBytes".into(), Value::Null);
            game.insert("automaticCloudSync".into(), json!(false));
        }
        if let (Some(folder), Some(discs)) = (
            &folder,
            game.get("discs").and_then(Value::as_array).cloned(),
        ) {
            let remaining: Vec<Value> = discs
                .iter()
                .filter(|d| {
                    !d.get("path")
                        .and_then(Value::as_str)
                        .is_some_and(|p| is_within(p, folder))
                })
                .cloned()
                .collect();
            if remaining.len() != discs.len() {
                let selected = game
                    .get("selectedDiscPath")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let keeps = remaining
                    .iter()
                    .any(|d| d.get("path").and_then(Value::as_str) == selected.as_deref());
                game.insert("discs".into(), Value::Array(remaining));
                if !keeps {
                    game.insert("selectedDiscPath".into(), Value::Null);
                }
                // TODO(classics): refreshRetroArchLibraryStats
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volumes() {
        assert_eq!(archive_volume("Game.part01.rar").map(|v| v.0), Some(0));
        assert_eq!(archive_volume("Game.7z.001").map(|v| v.0), Some(1));
        assert_eq!(archive_volume("Game.r00").map(|v| v.0), Some(2));
        assert_eq!(archive_volume("Game.rar").map(|v| v.0), Some(2));
        assert_eq!(archive_volume("Game.zip"), None);
        assert!(is_within("C:\\Games\\X\\bin\\x.exe", Path::new("C:\\Games\\X")) || !cfg!(windows));
    }
}

#[cfg(test)]
mod delete_tests {
    use super::*;

    #[test]
    fn deletes_folder_meta_and_source_archive_volumes() {
        let root = std::env::temp_dir().join(format!("hydra-removal-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let downloads = root.join("Downloads");
        std::fs::create_dir_all(downloads.join("Game").join("bin")).unwrap();
        std::fs::write(downloads.join("Game").join("bin").join("game.exe"), b"x").unwrap();
        std::fs::write(downloads.join("Game.meta"), b"m").unwrap();
        for part in ["Game.part1.rar", "Game.part2.rar", "Other.part1.rar"] {
            std::fs::write(downloads.join(part), b"r").unwrap();
        }
        let db = Db::open(root.join("db")).unwrap();
        let id = "steam:1";
        db.put_in(
            keys::DOWNLOADS,
            id,
            &json!({ "shop": "steam", "objectId": "1", "downloadPath": downloads.to_string_lossy(), "folderName": "Game",
                     "sourceArchiveName": "Game.part1.rar", "status": "complete", "downloader": 1 }),
        )
        .unwrap();
        let exe = downloads.join("Game").join("bin").join("game.exe");
        db.put_in(keys::GAMES, id, &json!({ "shop": "steam", "objectId": "1", "title": "Game", "isDeleted": false,
                                             "executablePath": exe.to_string_lossy(), "installedSizeInBytes": 10 }))
            .unwrap();
        assert!(has_source_archive(&db, id));
        delete_game_folder(&db, id, true).unwrap();
        assert!(!downloads.join("Game").exists());
        assert!(!downloads.join("Game.meta").exists());
        assert!(!downloads.join("Game.part1.rar").exists());
        assert!(!downloads.join("Game.part2.rar").exists());
        assert!(downloads.join("Other.part1.rar").exists());
        assert!(db.get_in::<Value>(keys::DOWNLOADS, id).is_none());
        let game: Value = db.get_in(keys::GAMES, id).unwrap();
        assert!(game["executablePath"].is_null());
        assert!(game["installedSizeInBytes"].is_null());
        drop(db);
        let _ = std::fs::remove_dir_all(&root);
    }
}
