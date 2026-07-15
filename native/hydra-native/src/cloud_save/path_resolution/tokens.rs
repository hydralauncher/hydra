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
    globset::escape(&normalize_separators(value))
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
    let mut rest = path;

    while let Some(start) = rest.find('%') {
        let after_start = &rest[start + 1..];
        let Some(end) = after_start.find('%') else {
            break;
        };

        let name = &after_start[..end];
        if !name.is_empty()
            && name
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_')
        {
            let token = format!("%{name}%");
            if !tokens.contains(&token) {
                tokens.push(token);
            }
        }

        rest = &after_start[end + 1..];
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
        let path = "100%/save";

        assert!(!has_unresolved_placeholder(path));
        assert!(tokens_in_path(path).is_empty());
    }
}
