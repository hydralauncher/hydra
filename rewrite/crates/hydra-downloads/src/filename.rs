//! download-filename.ts and the file name helpers of download-manager.ts.

/// decodeURIComponent; `None` when the escapes are invalid.
pub fn decode_uri_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = value.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// sanitizeFilename: characters Windows refuses become "_".
pub fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect()
}

fn basename(name: &str) -> &str {
    name.rsplit(['/', '\\']).next().unwrap_or(name)
}

fn decode_filename_value(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return None;
    }
    let sanitize = |name: &str| {
        sanitize_filename(basename(name))
            .chars()
            .filter(|c| (*c as u32) >= 32)
            .collect::<String>()
            .trim()
            .to_string()
    };
    let sanitized = match decode_uri_component(normalized) {
        Some(decoded) => sanitize(&decoded),
        None => sanitize(normalized),
    };
    (!sanitized.is_empty()).then_some(sanitized)
}

fn strip_quotes(value: &str) -> &str {
    let v = value.trim();
    let v = v.strip_prefix(['"', '\'']).unwrap_or(v);
    v.strip_suffix(['"', '\'']).unwrap_or(v)
}

/// Every `name\s*=\s*value` (value up to the next ";"), case-insensitive.
fn params<'a>(header: &'a str, name: &str) -> Vec<&'a str> {
    let lower = header.to_ascii_lowercase();
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(pos) = lower[from..].find(name) {
        let after = from + pos + name.len();
        let rest = &header[after..];
        let trimmed = rest.trim_start();
        if let Some(value) = trimmed.strip_prefix('=') {
            let value = value.trim_start();
            let end = value.find(';').unwrap_or(value.len());
            if !value[..end].is_empty() {
                found.push(&value[..end]);
            }
        }
        from = after;
    }
    found
}

/// getContentDispositionFilename
pub fn content_disposition_filename(header: Option<&str>) -> Option<String> {
    let header = header?;
    if let Some(raw) = params(header, "filename*").first() {
        let raw = strip_quotes(raw);
        let encoded = match raw.split_once("''") {
            Some((_, rest)) => rest,
            None => raw,
        };
        if let Some(decoded) = decode_filename_value(encoded) {
            return Some(decoded);
        }
    }
    // /filename\s*=/: the first "filename=" (not "filename*=").
    params(header, "filename")
        .first()
        .and_then(|raw| decode_filename_value(strip_quotes(raw)))
}

fn is_magnet(value: &str) -> bool {
    value.trim().to_lowercase().starts_with("magnet:")
}

fn hash_hint(value: Option<&str>) -> Option<String> {
    let value = value?;
    if is_magnet(value) || !value.contains('#') {
        return None;
    }
    let hash = value.split('#').nth(1)?;
    if hash.is_empty() || hash.starts_with("http") || !hash.contains('.') || hash.contains('=') {
        return None;
    }
    Some(hash.to_string())
}

/// The last path segment when it looks like a file name (has a dot).
pub fn filename_from_path(value: &str) -> Option<String> {
    if is_magnet(value) {
        return None;
    }
    let url = reqwest::Url::parse(value).ok()?;
    let name = url.path().rsplit('/').next()?;
    if name.contains('.') {
        decode_uri_component(name)
    } else {
        None
    }
}

/// extractDownloadFilename
pub fn extract_download_filename(url: &str, original_url: Option<&str>) -> Option<String> {
    hash_hint(original_url)
        .or_else(|| hash_hint(Some(url)))
        .or_else(|| filename_from_path(url))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_disposition() {
        assert_eq!(
            content_disposition_filename(Some("attachment; filename=\"a b.zip\"")).as_deref(),
            Some("a b.zip")
        );
        assert_eq!(
            content_disposition_filename(Some(
                "attachment; filename*=UTF-8''G%C3%A9.7z; filename=x"
            ))
            .as_deref(),
            Some("Gé.7z")
        );
        assert_eq!(content_disposition_filename(Some("inline")), None);
        assert_eq!(
            content_disposition_filename(Some("attachment; filename=\"../x:y.rar\"")).as_deref(),
            Some("x_y.rar")
        );
    }

    #[test]
    fn url_names() {
        assert_eq!(
            extract_download_filename(
                "https://archive.org/download/a/God%20of%20War%20%28USA%29.zip",
                None
            )
            .as_deref(),
            Some("God of War (USA).zip")
        );
        assert_eq!(
            extract_download_filename("https://x.y/file", Some("https://h/#game.rar")).as_deref(),
            Some("game.rar")
        );
        assert_eq!(extract_download_filename("https://x.y/dir/", None), None);
    }
}
