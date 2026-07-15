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

pub fn expand_store_user_ids(path: String, steam_user_ids: &[String]) -> Vec<String> {
    if !path.contains("<storeUserId>") {
        return vec![path];
    }

    steam_user_ids
        .iter()
        .map(|user_id| path.replace("<storeUserId>", &globset::escape(user_id)))
        .collect()
}

pub fn has_unresolved_placeholder(path: &str) -> bool {
    path.contains('<')
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

    for token in ["%APPDATA%", "%LOCALAPPDATA%"] {
        if path.contains(token) && !tokens.iter().any(|existing| existing == token) {
            tokens.push(token.to_string());
        }
    }

    tokens
}
