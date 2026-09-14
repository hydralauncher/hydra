use std::fs::File;
use std::io::Read;

use sha2::{Digest, Sha256};

pub fn hash_file(file_path: &str) -> Result<String, String> {
    let mut file = File::open(file_path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
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
            "e3cf52377baee611e9767b7bbe309f96fa9de20d50083050ef175256975b8bff"
        );
        assert_eq!(
            hash_file(&empty.display().to_string()).unwrap(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn missing_file_fails() {
        assert!(hash_file("/missing/hydra-cloud-save").is_err());
    }
}
