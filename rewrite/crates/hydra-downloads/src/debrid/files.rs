//! debrid-files.ts, real-debrid-files.ts, real-debrid-links.ts (the pure
//! parts), torbox-files.ts, download-parts.ts and the bits of parse-torrent
//! the debrid clients use.

use std::collections::HashSet;

use serde::Deserialize;
use unicode_normalization::UnicodeNormalization;

use crate::errors::{DlError, DlResult};

// ---- magnets (parse-torrent)

fn magnet_params(uri: &str) -> Vec<(String, String)> {
    let Some(query) = uri.strip_prefix("magnet:?") else {
        return Vec::new();
    };
    form_urlencoded::parse(query.as_bytes())
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

/// parseTorrent(uri).infoHash: the v1 hash as lowercase hex (base32 hashes
/// are converted), `None` for anything else.
pub fn info_hash(uri: &str) -> Option<String> {
    magnet_params(uri).into_iter().find_map(|(key, value)| {
        if key != "xt" {
            return None;
        }
        let hash = value.strip_prefix("urn:btih:")?;
        if hash.len() == 40 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(hash.to_lowercase());
        }
        if hash.len() == 32 {
            let bytes = data_encoding::BASE32_NOPAD
                .decode(hash.to_uppercase().as_bytes())
                .ok()?;
            return Some(bytes.iter().map(|b| format!("{b:02x}")).collect());
        }
        None
    })
}

/// parseTorrent(uri).name (the first `dn`).
pub fn display_name(uri: &str) -> Option<String> {
    magnet_params(uri)
        .into_iter()
        .find(|(k, _)| k == "dn")
        .map(|(_, v)| v)
        .filter(|v| !v.is_empty())
}

/// The `xt=urn:btih:` fallback AllDebrid and Premiumize use when
/// parse-torrent can't read the link.
pub fn loose_info_hash(uri: &str) -> Option<String> {
    if let Some(hash) = info_hash(uri) {
        return Some(hash);
    }
    let find = |text: &str| {
        let lower = text.to_lowercase();
        let start = lower.find("xt=urn:btih:")? + "xt=urn:btih:".len();
        let hash: String = lower[start..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect();
        (!hash.is_empty()).then_some(hash)
    };
    find(uri).or_else(|| find(&crate::filename::decode_uri_component(uri)?))
}

// ---- debrid-files.ts

/// A file a debrid service offers for a torrent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DebridFile {
    pub index: i64,
    pub path: String,
    pub size: u64,
}

/// getDebridRootFolderName
pub fn root_folder_name(paths: &[String]) -> Option<String> {
    if paths.len() < 2 {
        return None;
    }
    let components: Vec<Vec<&str>> = paths
        .iter()
        .map(|p| p.split(['/', '\\']).filter(|s| !s.is_empty()).collect())
        .collect();
    let root = *components[0].first()?;
    (root != "."
        && root != ".."
        && components
            .iter()
            .all(|parts| parts.len() > 1 && parts[0] == root))
    .then(|| root.to_string())
}

/// isZipDownloadUrl
pub fn is_zip_download_url(url: &str, filename: Option<&str>) -> bool {
    if filename.is_some_and(|f| f.to_lowercase().ends_with(".zip")) {
        return true;
    }
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| crate::filename::decode_uri_component(u.path()))
        .is_some_and(|p| p.to_lowercase().ends_with(".zip"))
}

fn last_segment_nfc_lower(path: &str) -> Option<String> {
    path.rsplit(['/', '\\'])
        .next()
        .map(|s| s.nfc().collect::<String>().to_lowercase())
}

/// assertRealDebridFileLink
pub fn assert_real_debrid_file_link(
    expected_path: &str,
    expected_size: u64,
    actual_name: &str,
    actual_size: u64,
) -> DlResult<()> {
    let expected = last_segment_nfc_lower(expected_path).filter(|s| !s.is_empty());
    let actual = last_segment_nfc_lower(actual_name).filter(|s| !s.is_empty());
    let names_differ = matches!((&expected, &actual), (Some(e), Some(a)) if e != a);
    if (expected_size > 0 && actual_size != expected_size) || names_differ {
        return Err(DlError::msg(
            "Real-Debrid returned a link for a different torrent file.",
        ));
    }
    Ok(())
}

/// selectDebridFiles
pub fn select_debrid_files<T: Clone>(
    files: &[T],
    index_of: impl Fn(&T) -> i64,
    indices: Option<&[i64]>,
) -> DlResult<Vec<T>> {
    let unique: HashSet<i64> = files.iter().map(&index_of).collect();
    if unique.len() != files.len() {
        return Err(DlError::msg(
            "Debrid returned files with duplicate identities.",
        ));
    }
    let Some(indices) = indices else {
        return Ok(files.to_vec());
    };
    let requested: HashSet<i64> = indices.iter().copied().collect();
    let selected: Vec<T> = files
        .iter()
        .filter(|f| requested.contains(&index_of(f)))
        .cloned()
        .collect();
    if requested.is_empty() || selected.len() != requested.len() {
        return Err(DlError::msg(
            "The selected debrid files are no longer available.",
        ));
    }
    Ok(selected)
}

// ---- torbox-files.ts

#[derive(Clone, Debug, Default, Deserialize)]
pub struct TorBoxFile {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub short_name: Option<String>,
    #[serde(default)]
    pub size: Option<f64>,
    #[serde(default)]
    pub zipped: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct TorBoxTorrent {
    #[serde(default)]
    pub id: Option<f64>,
    #[serde(default)]
    pub hash: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub download_state: Option<String>,
    #[serde(default)]
    pub download_finished: Option<bool>,
    #[serde(default)]
    pub download_present: Option<bool>,
    #[serde(default)]
    pub files: Option<Vec<TorBoxFile>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TorBoxDownloadFile {
    pub id: i64,
    pub path: String,
    pub size: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TorBoxManifest {
    pub torrent_id: i64,
    pub name: String,
    pub files: Vec<TorBoxDownloadFile>,
    pub total_size: u64,
    pub archive_only: bool,
}

fn decode_html_entities(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        let decoded = tail.find(';').and_then(|end| {
            let code = &tail[1..end];
            let lower = code.to_lowercase();
            let text = if let Some(num) = lower.strip_prefix('#') {
                let (digits, radix) = match num.strip_prefix('x') {
                    Some(hex) => (hex, 16),
                    None => (num, 10),
                };
                if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
                    return None;
                }
                let point = u32::from_str_radix(digits, radix).ok()?;
                let valid = point > 0 && point <= 0x10ffff && !(0xd800..=0xdfff).contains(&point);
                if valid {
                    char::from_u32(point)?.to_string()
                } else {
                    tail[..=end].to_string()
                }
            } else {
                match lower.as_str() {
                    "amp" => "&",
                    "lt" => "<",
                    "gt" => ">",
                    "quot" => "\"",
                    "apos" => "'",
                    "nbsp" => "\u{a0}",
                    _ => return None,
                }
                .to_string()
            };
            Some((text, end + 1))
        });
        match decoded {
            Some((text, consumed)) => {
                out.push_str(&text);
                rest = &tail[consumed..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// sanitizeSegment
fn sanitize_segment(segment: &str) -> String {
    let replaced: String = decode_html_entities(segment)
        .nfc()
        .map(|c| {
            if (c as u32) < 32 || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            {
                '_'
            } else {
                c
            }
        })
        .collect();
    // JS String.prototype.trim (whitespace + line terminators)
    let trimmed = replaced.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    let without_dots = trimmed.trim_end_matches('.');
    let cleaned = if without_dots.len() == trimmed.len() {
        trimmed.to_string()
    } else {
        format!("{without_dots}_")
    };
    let lower = cleaned.to_lowercase();
    let reserved = ["con", "prn", "aux", "nul"]
        .iter()
        .map(|s| s.to_string())
        .chain((1..=9).flat_map(|n| [format!("com{n}"), format!("lpt{n}")]))
        .any(|name| {
            lower == name
                || lower
                    .strip_prefix(&name)
                    .is_some_and(|rest| rest.starts_with('.'))
        });
    if reserved {
        format!("_{cleaned}")
    } else {
        cleaned
    }
}

fn split_path(path: &str) -> Vec<&str> {
    // `split(/[\\/]+/)`: empty parts only at the ends.
    let mut parts: Vec<&str> = Vec::new();
    let mut current_start = 0;
    let bytes = path.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'/' || bytes[i] == b'\\' {
            parts.push(&path[current_start..i]);
            while i < bytes.len() && (bytes[i] == b'/' || bytes[i] == b'\\') {
                i += 1;
            }
            current_start = i;
        } else {
            i += 1;
        }
    }
    parts.push(&path[current_start..]);
    parts
}

fn is_opaque_name(value: Option<&str>) -> bool {
    let Some(v) = value else { return false };
    let base = v
        .strip_suffix(".zip")
        .or_else(|| {
            v.len()
                .checked_sub(4)
                .filter(|&n| v.is_char_boundary(n) && v[n..].eq_ignore_ascii_case(".zip"))
                .map(|n| &v[..n])
        })
        .unwrap_or(v);
    (32..=64).contains(&base.len()) && base.chars().all(|c| c.is_ascii_hexdigit())
}

fn safe_integer(value: f64) -> bool {
    value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_991.0
}

/// buildTorBoxDownloadManifest
pub fn build_torbox_manifest(
    torrent: &TorBoxTorrent,
    magnet_name: Option<&str>,
) -> DlResult<TorBoxManifest> {
    let id = torrent.id.unwrap_or(-1.0);
    if !safe_integer(id) || id < 0.0 {
        return Err(DlError::msg("TorBox returned an invalid torrent ID."));
    }
    let files_in = torrent.files.clone().unwrap_or_default();
    let shared_root = files_in
        .first()
        .and_then(|f| f.name.as_deref())
        .map(|n| split_path(n)[0].to_string());
    let has_shared_root = shared_root.as_ref().is_some_and(|root| {
        !root.is_empty()
            && files_in.iter().all(|file| {
                let parts = file.name.as_deref().map(split_path).unwrap_or_default();
                parts.len() > 1
                    && sanitize_segment(parts[0]).to_lowercase()
                        == sanitize_segment(root).to_lowercase()
            })
    });
    let provider_name = if has_shared_root {
        shared_root.clone().unwrap_or_default()
    } else {
        torrent.name.clone().unwrap_or_default()
    };
    let chosen = if is_opaque_name(Some(&provider_name))
        && magnet_name.is_some()
        && !is_opaque_name(magnet_name)
    {
        magnet_name.unwrap_or_default().to_string()
    } else {
        provider_name.clone()
    };
    let name = sanitize_segment(&chosen);
    if name.is_empty() || name == "." || name == ".." || files_in.is_empty() {
        return Err(DlError::msg("TorBox did not provide downloadable files."));
    }

    let mut seen_ids = HashSet::new();
    let mut seen_paths = HashSet::new();
    let mut seen_directories = HashSet::new();
    let mut files = Vec::with_capacity(files_in.len());
    for file in &files_in {
        let id = file.id.unwrap_or(-1);
        if id < 0 || !seen_ids.insert(id) {
            return Err(DlError::msg("TorBox returned an invalid file ID."));
        }
        let raw_path = file
            .name
            .as_deref()
            .filter(|s| !s.is_empty())
            .or(file.short_name.as_deref())
            .unwrap_or_default();
        let drive = raw_path.len() >= 2
            && raw_path.as_bytes()[0].is_ascii_alphabetic()
            && raw_path.as_bytes()[1] == b':';
        if raw_path.is_empty() || raw_path.starts_with(['/', '\\']) || drive {
            return Err(DlError::msg("TorBox returned an unsafe file path."));
        }
        let parts = split_path(raw_path);
        let size = file.size.unwrap_or(-1.0);
        if parts
            .iter()
            .any(|p| p.is_empty() || *p == "." || *p == "..")
            || !safe_integer(size)
            || size < 0.0
        {
            return Err(DlError::msg("TorBox returned an unsafe file path or size."));
        }
        let relative: &[&str] = if parts.len() > 1
            && sanitize_segment(parts[0]).to_lowercase()
                == sanitize_segment(&provider_name).to_lowercase()
        {
            &parts[1..]
        } else {
            &parts
        };
        let safe: Vec<String> = relative.iter().map(|p| sanitize_segment(p)).collect();
        if safe.is_empty() || safe.iter().any(|p| p.is_empty() || p == "." || p == "..") {
            return Err(DlError::msg("TorBox returned an unsafe file path."));
        }
        let mut all = vec![name.clone()];
        all.extend(safe.iter().cloned());
        let file_path = all.join("/");
        let collision = file_path.to_lowercase();
        let directories: Vec<String> = (0..safe.len().saturating_sub(1))
            .map(|i| {
                let mut d = vec![name.clone()];
                d.extend(safe[..=i].iter().cloned());
                d.join("/").to_lowercase()
            })
            .collect();
        if seen_paths.contains(&collision)
            || seen_directories.contains(&collision)
            || directories.iter().any(|d| seen_paths.contains(d))
        {
            return Err(DlError::msg(
                "TorBox returned files with the same local path.",
            ));
        }
        seen_paths.insert(collision);
        seen_directories.extend(directories);
        files.push(TorBoxDownloadFile {
            id,
            path: file_path,
            size: size as u64,
        });
    }
    let total_size = files.iter().map(|f| f.size).sum();
    Ok(TorBoxManifest {
        torrent_id: id as i64,
        name,
        archive_only: files.len() == 1 && files_in[0].zipped == Some(true),
        files,
        total_size,
    })
}

/// selectTorBoxFiles
pub fn select_torbox_files(
    manifest: &TorBoxManifest,
    file_ids: Option<&[i64]>,
) -> DlResult<Vec<TorBoxDownloadFile>> {
    let Some(ids) = file_ids else {
        return Ok(manifest.files.clone());
    };
    let requested: HashSet<i64> = ids.iter().copied().collect();
    let selected: Vec<TorBoxDownloadFile> = manifest
        .files
        .iter()
        .filter(|f| requested.contains(&f.id))
        .cloned()
        .collect();
    if selected.is_empty() || selected.len() != requested.len() {
        return Err(DlError::msg(
            "The selected TorBox files are no longer available.",
        ));
    }
    Ok(selected)
}

// ---- Real-Debrid torrents

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct RdFile {
    pub id: i64,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub bytes: u64,
    #[serde(default)]
    pub selected: i64,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct RdTorrentInfo {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub original_filename: String,
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub bytes: f64,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub files: Vec<RdFile>,
    #[serde(default)]
    pub links: Vec<String>,
    #[serde(default)]
    pub ended: Option<String>,
}

/// A selected Real-Debrid file, at its local path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RdLocalFile {
    pub index: i64,
    pub path: String,
    pub size: u64,
    /// The path as Real-Debrid reports it (with the leading slash).
    pub source_path: String,
}

/// getRealDebridFiles: RD paths start with a slash; local paths include the
/// torrent's folder.
pub fn real_debrid_files(info: &RdTorrentInfo) -> DlResult<Vec<RdLocalFile>> {
    let result = (|| -> DlResult<Vec<RdLocalFile>> {
        let name = if info.original_filename.is_empty() {
            info.filename.clone()
        } else {
            info.original_filename.clone()
        };
        if name.contains(['/', '\\']) {
            return Err(DlError::msg("Real-Debrid returned an unsafe torrent name."));
        }
        let mut files = Vec::with_capacity(info.files.len());
        for file in &info.files {
            let relative = file.path.strip_prefix('/').unwrap_or(&file.path);
            if relative.starts_with(['/', '\\']) {
                return Err(DlError::msg("Real-Debrid returned an unsafe file path."));
            }
            let first = relative.split(['/', '\\']).next().unwrap_or_default();
            let name_path = if info.files.len() > 1 && first != name {
                format!("{name}/{relative}")
            } else {
                relative.to_string()
            };
            files.push(TorBoxFile {
                id: Some(file.id),
                name: Some(name_path),
                short_name: None,
                size: Some(file.bytes as f64),
                zipped: None,
            });
        }
        let manifest = build_torbox_manifest(
            &TorBoxTorrent {
                id: Some(0.0),
                name: Some(name),
                files: Some(files),
                ..TorBoxTorrent::default()
            },
            None,
        )?;
        Ok(manifest
            .files
            .iter()
            .enumerate()
            .map(|(index, file)| {
                let source = &info.files[index].path;
                let flat = !source
                    .strip_prefix('/')
                    .unwrap_or(source)
                    .contains(['/', '\\']);
                RdLocalFile {
                    index: file.id,
                    path: if info.files.len() == 1 && flat {
                        file.path.split('/').skip(1).collect::<Vec<_>>().join("/")
                    } else {
                        file.path.clone()
                    },
                    size: file.size,
                    source_path: source.clone(),
                }
            })
            .collect())
    })();
    result.map_err(|e| DlError::msg(e.message().replace("TorBox", "Real-Debrid")))
}

/// throwIfRealDebridTorrentFailed
pub fn real_debrid_failed(info: &RdTorrentInfo) -> DlResult<()> {
    if ["error", "dead", "virus", "magnet_error"].contains(&info.status.as_str()) {
        return Err(DlError::msg(format!(
            "Real-Debrid torrent failed ({}).",
            info.status
        )));
    }
    Ok(())
}

fn parses_as_date(value: Option<&str>) -> bool {
    let Some(v) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return false;
    };
    chrono::DateTime::parse_from_rfc3339(v).is_ok()
        || chrono::NaiveDateTime::parse_from_str(v, "%Y-%m-%dT%H:%M:%S%.f").is_ok()
        || chrono::NaiveDateTime::parse_from_str(v, "%Y-%m-%d %H:%M:%S").is_ok()
        || chrono::NaiveDate::parse_from_str(v, "%Y-%m-%d").is_ok()
}

/// isRealDebridArchiveCandidate
pub fn is_real_debrid_archive_candidate(
    info: &RdTorrentInfo,
    selected_indices: Option<&[i64]>,
) -> bool {
    let selected: Vec<&RdFile> = info.files.iter().filter(|f| f.selected != 0).collect();
    if info.status != "downloaded"
        || info.links.len() != 1
        || selected.len() < 2
        || !parses_as_date(info.ended.as_deref())
    {
        return false;
    }
    if let Some(indices) = selected_indices {
        let requested: HashSet<i64> = indices.iter().copied().collect();
        if requested.len() != selected.len() || selected.iter().any(|f| !requested.contains(&f.id))
        {
            return false;
        }
    }
    true
}

/// canUseRealDebridArchiveLink
pub fn can_use_real_debrid_archive_link(
    info: &RdTorrentInfo,
    filename: &str,
    selected_indices: Option<&[i64]>,
) -> bool {
    if !is_real_debrid_archive_candidate(info, selected_indices) {
        return false;
    }
    let Some(normalized) = filename.rsplit(['/', '\\']).next().map(str::to_lowercase) else {
        return false;
    };
    let archive = [".zip", ".rar", ".7z"]
        .iter()
        .any(|ext| normalized.ends_with(ext) && normalized.len() > ext.len());
    if !archive {
        return false;
    }
    !info.files.iter().any(|f| {
        f.selected != 0
            && f.path
                .rsplit(['/', '\\'])
                .next()
                .map(str::to_lowercase)
                .as_deref()
                == Some(normalized.as_str())
    })
}

/// hasRealDebridSelection
pub fn has_real_debrid_selection(info: &RdTorrentInfo, selected_indices: Option<&[i64]>) -> bool {
    let selected: Vec<&RdFile> = info.files.iter().filter(|f| f.selected != 0).collect();
    let requested: HashSet<i64> = match selected_indices {
        Some(indices) => indices.iter().copied().collect(),
        None => info.files.iter().map(|f| f.id).collect(),
    };
    requested.len() == selected.len() && selected.iter().all(|f| requested.contains(&f.id))
}

// ---- download-parts.ts

/// getDownloadParts: the ordered part links, `None` for a single link.
pub fn download_parts(uri: &str, parts: Option<&[String]>) -> DlResult<Option<Vec<String>>> {
    let Some(parts) = parts else {
        return Ok(None);
    };
    let unique: HashSet<&String> = parts.iter().collect();
    if parts.len() < 2
        || parts[0] != uri
        || parts.iter().any(|p| p.is_empty())
        || unique.len() != parts.len()
    {
        return Err(DlError::msg("The multi-part download links are invalid."));
    }
    Ok(Some(parts.to_vec()))
}

/// getMultipartFolderName: the folder that holds every part.
pub fn multipart_folder_name(first_part_filename: &str) -> String {
    let filename = first_part_filename
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default();
    let lower = filename.to_lowercase();
    let strip = |base: &str| -> Option<String> {
        // /\.part0*1\.rar$/i
        if let Some(stem) = lower.strip_suffix(".rar")
            && let Some(pos) = stem.rfind(".part")
        {
            let digits = &stem[pos + 5..];
            if !digits.is_empty()
                && digits.chars().all(|c| c.is_ascii_digit())
                && digits.trim_start_matches('0') == "1"
            {
                return Some(base[..pos].to_string());
            }
        }
        // /\.(?:7z|zip|rar)\.0*1$/i
        if let Some(pos) = lower.rfind('.') {
            let digits = &lower[pos + 1..];
            if !digits.is_empty()
                && digits.chars().all(|c| c.is_ascii_digit())
                && digits.trim_start_matches('0') == "1"
            {
                let stem = &lower[..pos];
                for ext in [".7z", ".zip", ".rar"] {
                    if stem.ends_with(ext) {
                        return Some(base[..pos - ext.len()].to_string());
                    }
                }
            }
        }
        None
    };
    let base = strip(filename).unwrap_or_else(|| match filename.rfind('.') {
        Some(pos) if pos + 1 < filename.len() => filename[..pos].to_string(),
        _ => filename.to_string(),
    });
    let trimmed =
        base.trim_end_matches(|c: char| c.is_whitespace() || matches!(c, '.' | '_' | '-'));
    if trimmed.is_empty() {
        "download".into()
    } else {
        trimmed.to_string()
    }
}

/// estimateMultipartTotalBytes: unknown parts count as the largest known one.
pub fn estimate_multipart_total_bytes(sizes: &[Option<u64>], fallback: Option<u64>) -> u64 {
    let known: Vec<u64> = sizes.iter().flatten().copied().filter(|s| *s > 0).collect();
    let known_bytes: u64 = known.iter().sum();
    if known.len() == sizes.len() {
        return known_bytes;
    }
    if known.is_empty() {
        return fallback.unwrap_or(0);
    }
    known_bytes + (sizes.len() - known.len()) as u64 * known.iter().copied().max().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn magnet_hashes() {
        let hex = "magnet:?xt=urn:btih:C9E15763F722F23E98A29DECDFAE341B98D53056&dn=Game%20Name";
        assert_eq!(
            info_hash(hex).as_deref(),
            Some("c9e15763f722f23e98a29decdfae341b98d53056")
        );
        assert_eq!(display_name(hex).as_deref(), Some("Game Name"));
        let base32 = "magnet:?xt=urn:btih:ZHQVOY7XELZD5GFCTXWN7LRUDOMNKMCW";
        assert_eq!(
            info_hash(base32).as_deref(),
            Some("c9e15763f722f23e98a29decdfae341b98d53056")
        );
        assert_eq!(info_hash("https://example.com"), None);
    }

    #[test]
    fn root_folder_and_zip() {
        let paths = |p: &[&str]| p.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            root_folder_name(&paths(&["Game/a.bin", "Game/sub/b.bin"])).as_deref(),
            Some("Game")
        );
        assert_eq!(
            root_folder_name(&paths(&["Game/a.bin", "Other/b.bin"])),
            None
        );
        assert_eq!(root_folder_name(&paths(&["Game/a.bin"])), None);
        assert!(is_zip_download_url("https://x/dl/Game%20Name.ZIP", None));
        assert!(is_zip_download_url("https://x/dl/abc", Some("a.zip")));
        assert!(!is_zip_download_url("https://x/dl/a.rar", None));
    }

    #[test]
    fn real_debrid_link_checks() {
        assert!(assert_real_debrid_file_link("/Game/setup.exe", 10, "setup.exe", 10).is_ok());
        assert!(assert_real_debrid_file_link("/Game/setup.exe", 10, "other.exe", 10).is_err());
        assert!(assert_real_debrid_file_link("/Game/setup.exe", 10, "setup.exe", 11).is_err());
        assert!(assert_real_debrid_file_link("/Game/a.zip", 0, "a.zip", 5).is_ok());
    }

    #[test]
    fn select_files() {
        let files = vec![(0, "a"), (1, "b"), (2, "c")];
        let selected = select_debrid_files(&files, |f| f.0, Some(&[2, 0])).unwrap();
        assert_eq!(selected, vec![(0, "a"), (2, "c")]);
        assert!(select_debrid_files(&files, |f| f.0, Some(&[3])).is_err());
        assert!(select_debrid_files(&files, |f| f.0, Some(&[])).is_err());
        assert_eq!(select_debrid_files(&files, |f| f.0, None).unwrap().len(), 3);
        let dupes = vec![(0, "a"), (0, "b")];
        assert!(select_debrid_files(&dupes, |f| f.0, None).is_err());
    }

    fn torrent(value: serde_json::Value) -> TorBoxTorrent {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn torbox_manifest_shared_root() {
        let manifest = build_torbox_manifest(
            &torrent(json!({
                "id": 7, "name": "ignored",
                "files": [
                    { "id": 0, "name": "My Game/setup.exe", "size": 10 },
                    { "id": 1, "name": "My Game/data/a&amp;b.bin", "size": 20 }
                ]
            })),
            None,
        )
        .unwrap();
        assert_eq!(manifest.torrent_id, 7);
        assert_eq!(manifest.name, "My Game");
        assert_eq!(manifest.total_size, 30);
        assert_eq!(manifest.files[0].path, "My Game/setup.exe");
        assert_eq!(manifest.files[1].path, "My Game/data/a&b.bin");
        assert!(!manifest.archive_only);
    }

    #[test]
    fn torbox_manifest_names_and_safety() {
        // An opaque hash name takes the magnet's name.
        let manifest = build_torbox_manifest(
            &torrent(json!({
                "id": 1, "name": "c9e15763f722f23e98a29decdfae341b98d53056.zip",
                "files": [{ "id": 3, "name": "pack.zip", "size": 5, "zipped": true }]
            })),
            Some("Game: Deluxe."),
        )
        .unwrap();
        assert_eq!(manifest.name, "Game_ Deluxe_");
        assert_eq!(manifest.files[0].path, "Game_ Deluxe_/pack.zip");
        assert!(manifest.archive_only);
        // Reserved device names get a prefix.
        let manifest = build_torbox_manifest(
            &torrent(json!({ "id": 1, "name": "con", "files": [{ "id": 0, "name": "aux.txt", "size": 1 }] })),
            None,
        )
        .unwrap();
        assert_eq!(manifest.files[0].path, "_con/_aux.txt");
        for bad in [
            json!({ "id": 1, "name": "x", "files": [{ "id": 0, "name": "/etc/passwd", "size": 1 }] }),
            json!({ "id": 1, "name": "x", "files": [{ "id": 0, "name": "a/../b", "size": 1 }] }),
            json!({ "id": 1, "name": "x", "files": [{ "id": 0, "name": "C:evil", "size": 1 }] }),
            json!({ "id": 1, "name": "x", "files": [{ "id": 0, "name": "a", "size": 1 }, { "id": 0, "name": "b", "size": 1 }] }),
            json!({ "id": 1, "name": "x", "files": [{ "id": 0, "name": "A", "size": 1 }, { "id": 1, "name": "a", "size": 1 }] }),
            json!({ "id": -1, "name": "x", "files": [{ "id": 0, "name": "a", "size": 1 }] }),
            json!({ "id": 1, "name": "x", "files": [] }),
        ] {
            assert!(
                build_torbox_manifest(&torrent(bad.clone()), None).is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn torbox_selection() {
        let manifest = build_torbox_manifest(
            &torrent(json!({ "id": 1, "name": "G", "files": [
                { "id": 4, "name": "a", "size": 1 }, { "id": 5, "name": "b", "size": 2 }
            ] })),
            None,
        )
        .unwrap();
        assert_eq!(select_torbox_files(&manifest, Some(&[5])).unwrap()[0].id, 5);
        assert!(select_torbox_files(&manifest, Some(&[9])).is_err());
        assert_eq!(select_torbox_files(&manifest, None).unwrap().len(), 2);
    }

    fn rd(value: serde_json::Value) -> RdTorrentInfo {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn real_debrid_paths() {
        let info = rd(json!({
            "id": "X", "filename": "Game", "original_filename": "Game", "status": "downloaded",
            "files": [
                { "id": 1, "path": "/setup.exe", "bytes": 10, "selected": 1 },
                { "id": 2, "path": "/data/a.bin", "bytes": 20, "selected": 1 }
            ],
            "links": ["l1", "l2"]
        }));
        let files = real_debrid_files(&info).unwrap();
        assert_eq!(files[0].path, "Game/setup.exe");
        assert_eq!(files[1].path, "Game/data/a.bin");
        assert_eq!(files[1].source_path, "/data/a.bin");
        // One flat file: no wrapper folder.
        let single = rd(json!({
            "filename": "Game.zip", "files": [{ "id": 1, "path": "/Game.zip", "bytes": 5, "selected": 1 }]
        }));
        assert_eq!(real_debrid_files(&single).unwrap()[0].path, "Game.zip");
        let unsafe_name =
            rd(json!({ "filename": "a/b", "files": [{ "id": 1, "path": "/x", "bytes": 1 }] }));
        assert!(
            real_debrid_files(&unsafe_name)
                .unwrap_err()
                .message()
                .contains("Real-Debrid")
        );
    }

    #[test]
    fn real_debrid_archives() {
        let info = rd(json!({
            "status": "downloaded", "ended": "2026-01-02T03:04:05.000Z",
            "files": [
                { "id": 1, "path": "/a.bin", "bytes": 1, "selected": 1 },
                { "id": 2, "path": "/b.bin", "bytes": 1, "selected": 1 }
            ],
            "links": ["one"]
        }));
        assert!(is_real_debrid_archive_candidate(&info, None));
        assert!(is_real_debrid_archive_candidate(&info, Some(&[1, 2])));
        assert!(!is_real_debrid_archive_candidate(&info, Some(&[1])));
        assert!(can_use_real_debrid_archive_link(&info, "Game.rar", None));
        assert!(!can_use_real_debrid_archive_link(&info, "a.bin", None));
        assert!(has_real_debrid_selection(&info, None));
        assert!(!has_real_debrid_selection(&info, Some(&[1])));
        assert!(real_debrid_failed(&rd(json!({ "status": "dead" }))).is_err());
    }

    #[test]
    fn multipart_names_and_sizes() {
        assert_eq!(multipart_folder_name("Game.part01.rar"), "Game");
        assert_eq!(multipart_folder_name("Game.Deluxe.7z.001"), "Game.Deluxe");
        assert_eq!(multipart_folder_name("Game_v1.2-.zip"), "Game_v1.2");
        assert_eq!(multipart_folder_name("dir/Game.part1.rar"), "Game");
        assert_eq!(multipart_folder_name("..."), "download");
        assert_eq!(
            estimate_multipart_total_bytes(&[Some(10), None, Some(4)], None),
            24
        );
        assert_eq!(estimate_multipart_total_bytes(&[None, None], Some(7)), 7);
        assert_eq!(estimate_multipart_total_bytes(&[Some(1), Some(2)], None), 3);
        let parts = vec!["a".to_string(), "b".to_string()];
        assert_eq!(
            download_parts("a", Some(&parts)).unwrap(),
            Some(parts.clone())
        );
        assert!(download_parts("b", Some(&parts)).is_err());
        assert!(download_parts("a", Some(&parts[..1])).is_err());
        assert_eq!(download_parts("a", None).unwrap(), None);
    }
}
