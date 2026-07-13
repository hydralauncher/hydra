use std::cmp::Ordering;

use super::types::{BuildLocalGameSnapshotInput, LocalGameSnapshot, LocalGameSnapshotFile};

pub fn build_snapshot(input: BuildLocalGameSnapshotInput) -> LocalGameSnapshot {
    let mut files = input
        .files
        .into_iter()
        .map(|file| LocalGameSnapshotFile {
            raw_path: file.raw_path,
            relative_path: file.relative_path,
            hash: file.hash,
            size_bytes: file.size_bytes,
            last_modified_at: file.last_modified_at,
        })
        .collect::<Vec<_>>();

    files.sort_by(|left, right| {
        let raw_path_order = left.raw_path.cmp(&right.raw_path);
        if raw_path_order == Ordering::Equal {
            left.relative_path.cmp(&right.relative_path)
        } else {
            raw_path_order
        }
    });

    LocalGameSnapshot {
        game_id: input.game_id,
        manifest_key: input.manifest_key,
        file_count: files.len() as u32,
        total_size_bytes: files.iter().map(|file| file.size_bytes).sum(),
        files,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::cloud_save::local_snapshot::build_files::build_files;
    use crate::cloud_save::local_snapshot::types::DiscoveredLocalSaveFile;
    use crate::cloud_save::manifest::types::CloudSaveGameId;

    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn builds_and_serializes_local_game_snapshot() {
        let temp = tempdir().unwrap();
        let root_path = temp.path().display().to_string();

        let save_path = temp.path().join("1.jkr");
        let settings_path = temp.path().join("settings.jkr");

        fs::write(&save_path, b"balatro save").unwrap();
        fs::write(&settings_path, b"balatro settings").unwrap();

        let files = build_files(
            vec![
                DiscoveredLocalSaveFile {
                    raw_path: "<winAppData>/Balatro/settings.jkr".into(),
                    absolute_path: settings_path.display().to_string(),
                    root_path: root_path.clone(),
                    relative_path: "settings.jkr".into(),
                    source: "ludusavi".into(),
                },
                DiscoveredLocalSaveFile {
                    raw_path: "<winAppData>/Balatro".into(),
                    absolute_path: save_path.display().to_string(),
                    root_path,
                    relative_path: "1.jkr".into(),
                    source: "ludusavi".into(),
                },
            ],
            vec![],
        )
        .unwrap()
        .files;

        let snapshot = build_snapshot(BuildLocalGameSnapshotInput {
            game_id: CloudSaveGameId {
                shop: "steam".into(),
                object_id: "2379780".into(),
            },
            manifest_key: Some("2379780".into()),
            files,
        });

        let output = serde_json::json!({
            "gameId": {
                "shop": snapshot.game_id.shop,
                "objectId": snapshot.game_id.object_id,
            },
            "manifestKey": snapshot.manifest_key,
            "fileCount": snapshot.file_count,
            "totalSizeBytes": snapshot.total_size_bytes,
            "files": snapshot.files.iter().map(|file| {
                serde_json::json!({
                    "rawPath": file.raw_path,
                    "relativePath": file.relative_path,
                    "hash": file.hash,
                    "sizeBytes": file.size_bytes,
                    "lastModifiedAt": file.last_modified_at,
                })
            }).collect::<Vec<_>>(),
        });

        println!("{}", serde_json::to_string_pretty(&output).unwrap(),);

        assert_eq!(snapshot.game_id.shop, "steam");
        assert_eq!(snapshot.game_id.object_id, "2379780");
        assert_eq!(snapshot.manifest_key.as_deref(), Some("2379780"));
        assert_eq!(snapshot.file_count, 2);
        assert_eq!(snapshot.total_size_bytes, 28.0);

        assert_eq!(snapshot.files[0].raw_path, "<winAppData>/Balatro",);

        assert_eq!(
            snapshot.files[1].raw_path,
            "<winAppData>/Balatro/settings.jkr",
        );

        assert_eq!(snapshot.files[0].relative_path, "1.jkr");
        assert_eq!(snapshot.files[1].relative_path, "settings.jkr",);
    }
}
