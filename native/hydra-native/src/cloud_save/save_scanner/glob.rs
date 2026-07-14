use super::scan_path::normalize_scanned_path;

pub fn has_glob_pattern(path: &str) -> bool {
    path.contains(['*', '?', '[', '{'])
}

fn dirname(path: &str) -> String {
    let path = path.trim_end_matches('/');
    match path.rsplit_once('/') {
        Some(("", _)) => "/".to_string(),
        Some((parent, _)) => parent.to_string(),
        None => ".".to_string(),
    }
}

pub fn glob_base_path(path: &str) -> String {
    let normalized = normalize_scanned_path(path);
    let parts = normalized.split('/').collect::<Vec<_>>();
    let first_glob = parts.iter().position(|part| has_glob_pattern(part));

    match first_glob {
        None => dirname(&normalized),
        Some(0) => ".".to_string(),
        Some(index) => normalize_scanned_path(&parts[..index].join("/")),
    }
}
