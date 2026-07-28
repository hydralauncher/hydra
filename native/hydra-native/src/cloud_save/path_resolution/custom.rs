pub const CUSTOM_PATH_PREFIX: &str = "<custom>";

const WINDOWS_MARKER: &str = "<windows>";
const LINUX_MARKER: &str = "<linux>";
const MAC_MARKER: &str = "<mac>";

fn validate_segments(path: &str, windows: bool) -> Result<(), String> {
    if path.contains(['\\', '\0', '<', '>', '*', '?', '[', ']', '{', '}']) {
        return Err("cloud_save_custom_path_invalid".to_string());
    }

    let without_root = if windows { &path[3..] } else { &path[1..] };
    if without_root.split('/').any(|segment| {
        segment.is_empty()
            || segment == "."
            || segment == ".."
            || (windows && segment.contains(':'))
            || segment.chars().any(char::is_control)
    }) {
        return Err("cloud_save_custom_path_invalid".to_string());
    }
    Ok(())
}

pub fn decode_custom_path(raw_path: &str, platform: &str) -> Option<Result<String, String>> {
    let encoded = raw_path.strip_prefix(CUSTOM_PATH_PREFIX)?;
    let (encoded_platform, path) = if let Some(path) = encoded.strip_prefix(WINDOWS_MARKER) {
        ("windows", path)
    } else if let Some(path) = encoded.strip_prefix(LINUX_MARKER) {
        ("linux", path)
    } else if let Some(path) = encoded.strip_prefix(MAC_MARKER) {
        ("mac", path)
    } else {
        return Some(Err("cloud_save_custom_path_invalid_platform".to_string()));
    };

    if encoded_platform != platform {
        return Some(Err("cloud_save_custom_path_foreign_platform".to_string()));
    }
    if path.ends_with('/') {
        return Some(Err("cloud_save_custom_path_not_canonical".to_string()));
    }

    let windows = platform == "windows";
    let absolute = if windows {
        let bytes = path.as_bytes();
        bytes.len() > 3 && bytes[0].is_ascii_uppercase() && bytes[1] == b':' && bytes[2] == b'/'
    } else {
        path.len() > 1 && path.starts_with('/') && !path.starts_with("//")
    };
    if !absolute {
        return Some(Err(
            "cloud_save_custom_path_must_be_local_absolute".to_string()
        ));
    }
    if let Err(error) = validate_segments(path, windows) {
        return Some(Err(error));
    }

    Some(Ok(path.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_canonical_paths_for_each_platform() {
        assert_eq!(
            decode_custom_path("<custom><windows>C:/Users/Hydra/Saves", "windows"),
            Some(Ok("C:/Users/Hydra/Saves".to_string()))
        );
        assert_eq!(
            decode_custom_path("<custom><linux>/home/hydra/saves", "linux"),
            Some(Ok("/home/hydra/saves".to_string()))
        );
        assert_eq!(
            decode_custom_path("<custom><mac>/Users/hydra/Saves", "mac"),
            Some(Ok("/Users/hydra/Saves".to_string()))
        );
    }

    #[test]
    fn rejects_foreign_relative_and_traversing_paths() {
        assert!(decode_custom_path("<custom><windows>C:/Saves", "linux")
            .unwrap()
            .is_err());
        assert!(decode_custom_path("<custom><linux>relative/saves", "linux")
            .unwrap()
            .is_err());
        assert!(decode_custom_path("<custom><linux>/home/../etc", "linux")
            .unwrap()
            .is_err());
        assert!(decode_custom_path("<custom><windows>c:/Saves", "windows")
            .unwrap()
            .is_err());
    }
}
