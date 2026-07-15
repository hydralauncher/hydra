use std::path::{Component, Path};

pub fn validate_hash(hash: &str) -> Result<(), String> {
    if hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err("cloud_save_invalid_blob_hash".to_string())
    }
}

pub fn validate_size(size_bytes: f64) -> Result<(), String> {
    if size_bytes.is_finite()
        && size_bytes >= 0.0
        && size_bytes.fract() == 0.0
        && size_bytes <= u64::MAX as f64
    {
        Ok(())
    } else {
        Err("cloud_save_invalid_file_size".to_string())
    }
}

pub fn validate_relative_path(value: &str) -> Result<(), String> {
    let normalized = value.replace('\\', "/");
    let path = Path::new(&normalized);
    if normalized.is_empty()
        || path.is_absolute()
        || normalized.len() > 1 && normalized.as_bytes()[1] == b':'
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        Err("cloud_save_invalid_restore_relative_path".to_string())
    } else {
        Ok(())
    }
}

pub fn validate_path_component(value: &str) -> Result<(), String> {
    if !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        Ok(())
    } else {
        Err("cloud_save_invalid_restore_path_component".to_string())
    }
}
