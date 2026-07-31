use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use uuid::Uuid;

const RESTORE_ARTIFACT_PREFIX: &str = ".hydra-restore-";
const DELETE_ARTIFACT_PREFIX: &str = ".hydra-delete-";

pub(crate) struct RestoreArtifactPaths {
    pub stage: PathBuf,
    pub backup: PathBuf,
}

pub(crate) fn delete_backup_path(target: &Path, target_key: &str) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "cloud_save_delete_target_without_parent".to_string())?;
    let id = format!("{:x}", Sha256::digest(target_key.as_bytes()));
    Ok(parent.join(format!("{DELETE_ARTIFACT_PREFIX}{id}-backup")))
}

pub(crate) fn restore_artifact_paths(
    target: &Path,
    target_key: &str,
) -> Result<RestoreArtifactPaths, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "cloud_save_restore_target_without_parent".to_string())?;
    let id = format!("{:x}", Sha256::digest(target_key.as_bytes()));
    Ok(RestoreArtifactPaths {
        stage: parent.join(format!("{RESTORE_ARTIFACT_PREFIX}{id}-stage")),
        backup: parent.join(format!("{RESTORE_ARTIFACT_PREFIX}{id}-backup")),
    })
}

pub(crate) fn is_cloud_save_artifact_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };

    if let Some(value) = name.strip_prefix(RESTORE_ARTIFACT_PREFIX) {
        let Some((id, kind)) = value.rsplit_once('-') else {
            return false;
        };
        return id.len() == 64
            && id
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            && matches!(kind, "stage" | "backup");
    }

    name.strip_prefix(DELETE_ARTIFACT_PREFIX)
        .and_then(|value| value.strip_suffix("-backup"))
        .is_some_and(|id| {
            (id.len() == 64
                && id
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
                || Uuid::parse_str(id).is_ok()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_only_exact_internal_artifact_names() {
        for name in [
            format!("{RESTORE_ARTIFACT_PREFIX}{}-stage", "a".repeat(64)),
            format!("{RESTORE_ARTIFACT_PREFIX}{}-backup", "1".repeat(64)),
            format!("{DELETE_ARTIFACT_PREFIX}{}-backup", "b".repeat(64)),
            format!("{DELETE_ARTIFACT_PREFIX}{}-backup", Uuid::new_v4()),
        ] {
            assert!(is_cloud_save_artifact_path(Path::new(&name)));
        }
        for name in [
            ".hydra-restore-save.dat".to_string(),
            ".hydra-restore-not-a-hash-stage".to_string(),
            format!("{RESTORE_ARTIFACT_PREFIX}{}-other", "a".repeat(64)),
            format!("{RESTORE_ARTIFACT_PREFIX}{}-stage", "A".repeat(64)),
            ".hydra-delete-not-a-uuid-backup".to_string(),
            format!("{DELETE_ARTIFACT_PREFIX}{}-stage", Uuid::new_v4()),
            format!("{DELETE_ARTIFACT_PREFIX}{}-backup", "B".repeat(64)),
        ] {
            assert!(!is_cloud_save_artifact_path(Path::new(&name)));
        }
    }

    #[test]
    fn delete_backup_names_are_stable_and_target_specific() {
        let root = Path::new("/game");
        let first = delete_backup_path(&root.join("first.sav"), "/game/first.sav").unwrap();
        let repeated = delete_backup_path(&root.join("first.sav"), "/game/first.sav").unwrap();
        let second = delete_backup_path(&root.join("second.sav"), "/game/second.sav").unwrap();

        assert_eq!(first, repeated);
        assert_ne!(first, second);
        assert!(is_cloud_save_artifact_path(&first));
    }
}
