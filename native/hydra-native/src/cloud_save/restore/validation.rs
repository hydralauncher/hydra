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
        || normalized.contains('\0')
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

pub fn validate_windows_relative_path(value: &str) -> Result<(), String> {
    validate_relative_path(value)?;
    let normalized = value.replace('\\', "/");

    for segment in normalized.split('/') {
        if segment.is_empty()
            || segment.ends_with(['.', ' '])
            || segment.chars().any(|character| {
                character.is_control()
                    || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
            })
        {
            return Err("cloud_save_invalid_windows_restore_path".to_string());
        }

        let stem = segment
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || stem.strip_prefix("COM").is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
            || stem.strip_prefix("LPT").is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            });
        if reserved {
            return Err("cloud_save_invalid_windows_restore_path".to_string());
        }
    }

    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_windows_restore_paths() {
        for path in ["Profile/slot.sav", "COM10/save.dat", "console/save.dat"] {
            assert!(validate_windows_relative_path(path).is_ok(), "{path}");
        }

        for path in [
            "Profile/slot.sav:stream",
            "Profile/slot?.sav",
            "Profile/slot. ",
            "CON",
            "nul.txt",
            "COM1/save.dat",
            "LPT9.txt",
            "Profile/slot\0.sav",
        ] {
            assert!(validate_windows_relative_path(path).is_err(), "{path}");
        }
    }

    #[test]
    fn keeps_windows_only_rules_out_of_structural_validation() {
        assert!(validate_relative_path("Profile/slot.sav:stream").is_ok());
    }
}
