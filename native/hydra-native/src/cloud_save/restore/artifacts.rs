use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

const ARTIFACT_PREFIX: &str = ".hydra-restore-";

pub(crate) struct RestoreArtifactPaths {
    pub stage: PathBuf,
    pub backup: PathBuf,
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
        stage: parent.join(format!("{ARTIFACT_PREFIX}{id}-stage")),
        backup: parent.join(format!("{ARTIFACT_PREFIX}{id}-backup")),
    })
}

pub(crate) fn is_restore_artifact_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(value) = name.strip_prefix(ARTIFACT_PREFIX) else {
        return false;
    };
    let Some((id, kind)) = value.rsplit_once('-') else {
        return false;
    };

    id.len() == 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        && matches!(kind, "stage" | "backup")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_only_exact_internal_artifact_names() {
        for name in [
            format!("{ARTIFACT_PREFIX}{}-stage", "a".repeat(64)),
            format!("{ARTIFACT_PREFIX}{}-backup", "1".repeat(64)),
        ] {
            assert!(is_restore_artifact_path(Path::new(&name)));
        }
        for name in [
            ".hydra-restore-save.dat".to_string(),
            ".hydra-restore-not-a-hash-stage".to_string(),
            format!("{ARTIFACT_PREFIX}{}-other", "a".repeat(64)),
            format!("{ARTIFACT_PREFIX}{}-stage", "A".repeat(64)),
        ] {
            assert!(!is_restore_artifact_path(Path::new(&name)));
        }
    }
}
