use serde::Serialize;

use super::types::BuildSnapshotAggregateHashInput;

#[derive(Serialize)]
struct CanonicalSnapshotFile<'a> {
    #[serde(rename = "rawPath")]
    raw_path: &'a str,
    #[serde(rename = "relativePath")]
    relative_path: &'a str,
    hash: &'a str,
    #[serde(rename = "sizeBytes")]
    size_bytes: u64,
}

#[derive(Serialize)]
struct CanonicalSnapshot<'a> {
    files: Vec<CanonicalSnapshotFile<'a>>,
}

fn canonical_size_bytes(size_bytes: f64) -> Result<u64, String> {
    if !size_bytes.is_finite()
        || size_bytes < 0.0
        || size_bytes.fract() != 0.0
        || size_bytes >= u64::MAX as f64
    {
        return Err("cloud_save_invalid_size_bytes".to_string());
    }

    Ok(size_bytes as u64)
}

pub fn build_hash(mut input: BuildSnapshotAggregateHashInput) -> Result<String, String> {
    input.files.sort_by(|left, right| {
        left.raw_path
            .cmp(&right.raw_path)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
            .then_with(|| left.hash.cmp(&right.hash))
            .then_with(|| left.size_bytes.total_cmp(&right.size_bytes))
    });

    let snapshot = CanonicalSnapshot {
        files: input
            .files
            .iter()
            .map(|file| {
                Ok(CanonicalSnapshotFile {
                    raw_path: &file.raw_path,
                    relative_path: &file.relative_path,
                    hash: &file.hash,
                    size_bytes: canonical_size_bytes(file.size_bytes)?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
    };
    let serialized = serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?;

    Ok(blake3::hash(&serialized).to_hex().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_save::hashing::types::SnapshotAggregateHashFile;

    fn file(
        raw_path: &str,
        relative_path: &str,
        hash: &str,
        size_bytes: f64,
    ) -> SnapshotAggregateHashFile {
        SnapshotAggregateHashFile {
            raw_path: raw_path.into(),
            relative_path: relative_path.into(),
            hash: hash.into(),
            size_bytes,
        }
    }

    fn hash(files: Vec<SnapshotAggregateHashFile>) -> String {
        build_hash(BuildSnapshotAggregateHashInput { files }).unwrap()
    }

    #[test]
    fn aggregate_hash_is_independent_of_input_order() {
        let first = file("<home>/game", "one.sav", "a", 10.0);
        let second = file("<home>/game", "two.sav", "b", 20.0);

        assert_eq!(
            hash(vec![first.clone(), second.clone()]),
            hash(vec![second, first])
        );
    }

    #[test]
    fn identity_changes_with_path_hash_or_size() {
        let baseline = hash(vec![file("<home>/game", "save.dat", "a", 10.0)]);

        assert_ne!(
            baseline,
            hash(vec![file("<home>/other", "save.dat", "a", 10.0)])
        );
        assert_ne!(
            baseline,
            hash(vec![file("<home>/game", "other.dat", "a", 10.0)])
        );
        assert_ne!(
            baseline,
            hash(vec![file("<home>/game", "save.dat", "b", 10.0)])
        );
        assert_ne!(
            baseline,
            hash(vec![file("<home>/game", "save.dat", "a", 11.0)])
        );
    }

    #[test]
    fn rejects_invalid_sizes() {
        for size_bytes in [f64::NAN, f64::INFINITY, -1.0, 1.5, u64::MAX as f64] {
            let error = build_hash(BuildSnapshotAggregateHashInput {
                files: vec![file("<home>/game", "save.dat", "a", size_bytes)],
            })
            .unwrap_err();

            assert_eq!(error, "cloud_save_invalid_size_bytes");
        }
    }
}
