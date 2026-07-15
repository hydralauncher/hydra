use std::fs::File;

pub fn hash_file(file_path: &str) -> Result<String, String> {
    let file = File::open(file_path).map_err(|error| error.to_string())?;
    let mut hasher = blake3::Hasher::new();
    hasher
        .update_reader(file)
        .map_err(|error| error.to_string())?;

    Ok(hasher.finalize().to_hex().to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn hashes_regular_and_empty_files() {
        let temp = tempdir().unwrap();
        let regular = temp.path().join("save.dat");
        let empty = temp.path().join("empty.dat");
        fs::write(&regular, b"hydra cloud save").unwrap();
        fs::write(&empty, b"").unwrap();

        assert_eq!(
            hash_file(&regular.display().to_string()).unwrap(),
            blake3::hash(b"hydra cloud save").to_hex().to_string()
        );
        assert_eq!(
            hash_file(&empty.display().to_string()).unwrap(),
            blake3::hash(b"").to_hex().to_string()
        );
    }

    #[test]
    fn missing_file_fails() {
        assert!(hash_file("/missing/hydra-cloud-save").is_err());
    }
}
