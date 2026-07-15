use super::context::normalize_separators;

const MISSING_TOKEN: &str = "<skip>";

pub struct TokenValues {
    pub root: String,
    pub base: String,
    pub home: String,
    pub os_username: String,
    pub app_data: String,
    pub local_app_data: String,
    pub documents: String,
    pub public: String,
    pub program_data: String,
    pub windows_dir: String,
    pub xdg_data: String,
    pub xdg_config: String,
}

pub fn literal(value: &str) -> String {
    globset::escape(&normalize_separators(value)).chars().fold(
        String::new(),
        |mut escaped, character| {
            match character {
                '{' => escaped.push_str("[{]"),
                '}' => escaped.push_str("[}]"),
                _ => escaped.push(character),
            }
            escaped
        },
    )
}

pub fn optional_literal(value: Option<&str>) -> String {
    value.map(|value| literal(value)).unwrap_or_else(missing)
}

pub fn missing() -> String {
    MISSING_TOKEN.to_string()
}

pub fn apply(path: &str, values: &TokenValues) -> String {
    path.replace("<root>", &values.root)
        .replace("<base>", &values.base)
        .replace("<home>", &values.home)
        .replace("<storeUserId>", "*")
        .replace("<osUserName>", &values.os_username)
        .replace("<winAppData>", &values.app_data)
        .replace("%APPDATA%", &values.app_data)
        .replace("<winLocalAppData>", &values.local_app_data)
        .replace("%LOCALAPPDATA%", &values.local_app_data)
        .replace("<winDocuments>", &values.documents)
        .replace("<winPublic>", &values.public)
        .replace("<winProgramData>", &values.program_data)
        .replace("<winDir>", &values.windows_dir)
        .replace("<xdgData>", &values.xdg_data)
        .replace("<xdgConfig>", &values.xdg_config)
}

pub fn has_unresolved_placeholder(path: &str) -> bool {
    path.contains('<') || !percent_tokens(path).is_empty()
}

fn percent_tokens(path: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let bytes = path.as_bytes();
    let mut start = 0;

    while start < bytes.len() {
        if bytes[start] != b'%' {
            start += 1;
            continue;
        }

        let mut end = start + 1;
        while end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_') {
            end += 1;
        }

        if end > start + 1 && end < bytes.len() && bytes[end] == b'%' {
            let token = path[start..=end].to_string();
            if !tokens.contains(&token) {
                tokens.push(token);
            }
            start = end + 1;
        } else {
            start += 1;
        }
    }

    tokens
}

pub fn tokens_in_path(path: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut rest = path;

    while let Some(start) = rest.find('<') {
        let after = &rest[start..];
        let Some(end) = after.find('>') else {
            break;
        };

        let token = &after[..=end];
        if !tokens.iter().any(|existing| existing == token) {
            tokens.push(token.to_string());
        }

        rest = &after[end + 1..];
    }

    for token in percent_tokens(path) {
        if !tokens.contains(&token) {
            tokens.push(token);
        }
    }

    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_and_reports_unknown_percent_tokens() {
        let path = "%UNKNOWN_HOME%/save/%UNKNOWN_HOME%";

        assert!(has_unresolved_placeholder(path));
        assert_eq!(tokens_in_path(path), vec!["%UNKNOWN_HOME%"]);
    }

    #[test]
    fn ignores_regular_percent_characters() {
        let path = "100%/save/%UNKNOWN%";

        assert!(has_unresolved_placeholder(path));
        assert_eq!(tokens_in_path(path), vec!["%UNKNOWN%"]);
    }

    #[test]
    fn escapes_braces_in_literal_paths() {
        assert_eq!(literal("/Games/{Deluxe}"), "/Games/[{]Deluxe[}]");
    }
}
