use std::fs;
use std::io;
use std::path::Path;

use super::scan_path::normalize_scanned_path;

fn walk_into(root: &Path, files: &mut Vec<String>) -> Result<(), String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;

        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            walk_into(&entry.path(), files)?;
        } else if file_type.is_file() {
            files.push(normalize_scanned_path(&entry.path().to_string_lossy()));
        }
    }

    Ok(())
}

pub fn walk_directory_files(root: &str) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    walk_into(Path::new(root), &mut files)?;
    Ok(files)
}
