pub const CUSTOM_PATH_PREFIX: &str = "<custom>";

const WINDOWS_MARKER: &str = "<windows>";
const LINUX_MARKER: &str = "<linux>";
const MAC_MARKER: &str = "<mac>";
const ABSOLUTE_MARKER: &str = "<absolute>";

const WINDOWS_TOKENS: [&str; 6] = [
    "<winAppData>",
    "<winLocalAppData>",
    "<winDocuments>",
    "<base>",
    "<root>",
    "<home>",
];
const UNIX_TOKENS: [&str; 5] = ["<xdgData>", "<xdgConfig>", "<base>", "<root>", "<home>"];

#[derive(Debug, PartialEq, Eq)]
pub struct DecodedCustomPath {
    pub platform: String,
    pub path: String,
}

fn validate_relative_segments(path: &str, windows: bool) -> Result<(), String> {
    let relative = path.strip_prefix('/').unwrap_or(path);
    if relative.is_empty() {
        return Ok(());
    }
    if relative.split('/').any(|segment| {
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

fn validate_common(path: &str) -> Result<(), String> {
    if path.contains(['\\', '\0', '*', '?', '[', ']', '{', '}'])
        || path.chars().any(char::is_control)
        || path.ends_with('/')
    {
        return Err("cloud_save_custom_path_invalid".to_string());
    }
    Ok(())
}

fn portable_token(path: &str, platform: &str) -> Option<&'static str> {
    let tokens: &[&'static str] = if platform == "windows" {
        &WINDOWS_TOKENS
    } else {
        &UNIX_TOKENS
    };
    tokens.iter().copied().find(|token| path.starts_with(token))
}

fn validate_portable_path(path: &str, platform: &str) -> Result<(), String> {
    validate_common(path)?;
    let Some(token) = portable_token(path, platform) else {
        return Err("cloud_save_custom_path_invalid".to_string());
    };
    let suffix = &path[token.len()..];
    if !suffix.is_empty() && !suffix.starts_with('/') {
        return Err("cloud_save_custom_path_invalid".to_string());
    }
    if suffix
        .split('/')
        .any(|segment| segment.contains(['<', '>']) && segment != "<storeUserId>")
    {
        return Err("cloud_save_custom_path_invalid".to_string());
    }
    validate_relative_segments(suffix, platform == "windows")
}

fn validate_absolute_path(path: &str, platform: &str) -> Result<(), String> {
    validate_common(path)?;
    if path.contains(['<', '>']) {
        return Err("cloud_save_custom_path_invalid".to_string());
    }

    let windows = platform == "windows";
    let absolute = if windows {
        let bytes = path.as_bytes();
        bytes.len() > 3 && bytes[0].is_ascii_uppercase() && bytes[1] == b':' && bytes[2] == b'/'
    } else {
        path.len() > 1 && path.starts_with('/') && !path.starts_with("//")
    };
    if !absolute {
        return Err("cloud_save_custom_path_must_be_local_absolute".to_string());
    }

    let without_root = if windows { &path[3..] } else { &path[1..] };
    validate_relative_segments(without_root, windows)
}

pub fn decode_custom_path(raw_path: &str) -> Option<Result<DecodedCustomPath, String>> {
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

    let (decoded_path, validation) = if let Some(absolute_path) = path.strip_prefix(ABSOLUTE_MARKER)
    {
        (
            absolute_path,
            validate_absolute_path(absolute_path, encoded_platform),
        )
    } else if path.starts_with('<') {
        (path, validate_portable_path(path, encoded_platform))
    } else {
        (path, Err("cloud_save_custom_path_legacy".to_string()))
    };
    Some(validation.map(|_| DecodedCustomPath {
        platform: encoded_platform.to_string(),
        path: decoded_path.to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_portable_and_absolute_paths_for_each_platform() {
        assert_eq!(
            decode_custom_path("<custom><windows><winAppData>/Hydra/Saves"),
            Some(Ok(DecodedCustomPath {
                platform: "windows".to_string(),
                path: "<winAppData>/Hydra/Saves".to_string()
            }))
        );
        assert_eq!(
            decode_custom_path("<custom><linux><xdgData>/game"),
            Some(Ok(DecodedCustomPath {
                platform: "linux".to_string(),
                path: "<xdgData>/game".to_string()
            }))
        );
        assert_eq!(
            decode_custom_path("<custom><mac><home>/Saves"),
            Some(Ok(DecodedCustomPath {
                platform: "mac".to_string(),
                path: "<home>/Saves".to_string()
            }))
        );
        assert_eq!(
            decode_custom_path("<custom><windows><base>/saves/<storeUserId>"),
            Some(Ok(DecodedCustomPath {
                platform: "windows".to_string(),
                path: "<base>/saves/<storeUserId>".to_string()
            }))
        );
        assert_eq!(
            decode_custom_path("<custom><windows><absolute>D:/Saves/Game"),
            Some(Ok(DecodedCustomPath {
                platform: "windows".to_string(),
                path: "D:/Saves/Game".to_string()
            }))
        );
    }

    #[test]
    fn rejects_relative_traversing_and_wrong_platform_tokens() {
        assert!(decode_custom_path("<custom><linux>relative/saves")
            .unwrap()
            .is_err());
        assert!(decode_custom_path("<custom><linux><home>/../etc")
            .unwrap()
            .is_err());
        assert!(decode_custom_path("<custom><windows><xdgData>/Saves")
            .unwrap()
            .is_err());
        assert!(decode_custom_path("<custom><windows>c:/Saves")
            .unwrap()
            .is_err());
        assert!(decode_custom_path("<custom><windows>C:/Users/Hydra/Saves")
            .unwrap()
            .is_err());
        assert!(decode_custom_path("<custom><linux>/home/hydra/Saves")
            .unwrap()
            .is_err());
    }
}
