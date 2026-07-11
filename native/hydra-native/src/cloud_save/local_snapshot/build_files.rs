use std::cmp::Ordering;

use super::build_file::build_file;
use super::types::{DiscoveredLocalSaveFile, LocalSaveSnapshotFile};

pub fn build_files(
    files: Vec<DiscoveredLocalSaveFile>,
) -> Result<Vec<LocalSaveSnapshotFile>, String> {
    let mut snapshot_files = files
        .into_iter()
        .map(build_file)
        .collect::<Result<Vec<_>, _>>()?;

    snapshot_files.sort_by(|left, right| {
        let root_order = left.root_path.cmp(&right.root_path);
        if root_order == Ordering::Equal {
            left.relative_path.cmp(&right.relative_path)
        } else {
            root_order
        }
    });

    Ok(snapshot_files)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn builds_snapshot_files_from_real_files() {
        let temp = tempdir().unwrap();
        let root_path = temp.path().display().to_string();

        let first_path = temp.path().join("1.jkr");
        let second_path = temp.path().join("settings.jkr");

        let first_content = b"balatro save";
        let second_content = b"balatro settings";

        fs::write(&first_path, first_content).unwrap();
        fs::write(&second_path, second_content).unwrap();

        let result = build_files(vec![
            DiscoveredLocalSaveFile {
                raw_path: "<winAppData>/Balatro/settings.jkr".into(),
                absolute_path: second_path.display().to_string(),
                root_path: root_path.clone(),
                relative_path: "settings.jkr".into(),
                source: "ludusavi".into(),
            },
            DiscoveredLocalSaveFile {
                raw_path: "<winAppData>/Balatro".into(),
                absolute_path: first_path.display().to_string(),
                root_path: root_path.clone(),
                relative_path: "1.jkr".into(),
                source: "ludusavi".into(),
            },
        ])
        .unwrap();

        let output = result
            .iter()
            .map(|file| {
                serde_json::json!({
                    "rawPath": file.raw_path,
                    "absolutePath": file.absolute_path,
                    "rootPath": file.root_path,
                    "relativePath": file.relative_path,
                    "source": file.source,
                    "hash": file.hash,
                    "sizeBytes": file.size_bytes,
                    "lastModifiedAt": file.last_modified_at,
                })
            })
            .collect::<Vec<_>>();

        println!("{}", serde_json::to_string_pretty(&output).unwrap(),);

        assert_eq!(result.len(), 2);

        assert_eq!(result[0].relative_path, "1.jkr");
        assert_eq!(result[1].relative_path, "settings.jkr");

        assert_eq!(
            result[0].hash,
            blake3::hash(first_content).to_hex().to_string(),
        );

        assert_eq!(
            result[1].hash,
            blake3::hash(second_content).to_hex().to_string(),
        );

        assert_eq!(result[0].size_bytes, first_content.len() as f64,);

        assert_eq!(result[1].size_bytes, second_content.len() as f64,);

        assert!(result[0].last_modified_at.ends_with('Z'));
        assert!(result[1].last_modified_at.ends_with('Z'));
    }
}
