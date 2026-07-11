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
    use super::*;

    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn hashes_real_file() {
        let temp = tempdir().unwrap();
        let file_path = temp.path().join("save.dat");
        let content = b"hydra cloud save";

        fs::write(&file_path, content).unwrap();

        let result = hash_file(
            &file_path.display().to_string(),
        )
        .unwrap();

        let expected = blake3::hash(content)
            .to_hex()
            .to_string();

        println!("save.dat | {result}");

        assert_eq!(result, expected);
    }
}
