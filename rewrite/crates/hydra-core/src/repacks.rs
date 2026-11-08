//! Download options of a game: shared/index.ts (getDownloadersForUri,
//! filterDownloadableRepacks, hoster availability), shared/repack-uri-groups.ts
//! and shared/archive-org.ts.

use std::collections::HashSet;

use serde_json::{Map, Value};

/// shared/constants.ts `Downloader`
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Downloader {
    RealDebrid = 0,
    Torrent = 1,
    Gofile = 2,
    PixelDrain = 3,
    Datanodes = 4,
    Mediafire = 5,
    TorBox = 6,
    Hydra = 7,
    FuckingFast = 9,
    VikingFile = 10,
    Rootz = 11,
    Premiumize = 12,
    AllDebrid = 13,
    ArchiveOrg = 14,
    Epic = 15,
    FileKeeper = 16,
}

impl Downloader {
    /// `Object.values(Downloader)` order (numeric).
    pub const ALL: [Downloader; 16] = [
        Downloader::RealDebrid,
        Downloader::Torrent,
        Downloader::Gofile,
        Downloader::PixelDrain,
        Downloader::Datanodes,
        Downloader::Mediafire,
        Downloader::TorBox,
        Downloader::Hydra,
        Downloader::FuckingFast,
        Downloader::VikingFile,
        Downloader::Rootz,
        Downloader::Premiumize,
        Downloader::AllDebrid,
        Downloader::ArchiveOrg,
        Downloader::Epic,
        Downloader::FileKeeper,
    ];

    pub fn from_i64(value: i64) -> Option<Self> {
        Self::ALL.into_iter().find(|d| *d as i64 == value)
    }

    /// renderer/src/constants.ts DOWNLOADER_NAME
    pub fn name(self) -> &'static str {
        match self {
            Downloader::RealDebrid => "Real-Debrid",
            Downloader::Torrent => "Torrent",
            Downloader::Gofile => "Gofile",
            Downloader::PixelDrain => "PixelDrain",
            Downloader::Datanodes => "Datanodes",
            Downloader::Mediafire => "Mediafire",
            Downloader::TorBox => "TorBox",
            Downloader::Hydra => "Nimbus",
            Downloader::FuckingFast => "FuckingFast",
            Downloader::VikingFile => "VikingFile",
            Downloader::Rootz => "Rootz",
            Downloader::Premiumize => "Premiumize",
            Downloader::AllDebrid => "AllDebrid",
            Downloader::ArchiveOrg => "Archive.org",
            Downloader::Epic => "Epic Games",
            Downloader::FileKeeper => "FileKeeper",
        }
    }
}

const REAL_DEBRID_HOSTS: [&str; 2] = ["https://1fichier.com", "https://mediafire.com"];

/// getDownloadersForUri
pub fn downloaders_for_uri(uri: &str) -> Vec<Downloader> {
    use Downloader::*;
    if uri.starts_with("https://gofile.io") {
        return vec![Gofile];
    }
    if uri.starts_with("https://pixeldrain.com") {
        return vec![PixelDrain];
    }
    if uri.starts_with("https://datanodes.to") {
        return vec![Datanodes];
    }
    if uri.starts_with("https://www.mediafire.com") {
        return vec![Mediafire];
    }
    if uri.starts_with("https://fuckingfast.co") || uri.starts_with("https://fuckingfast.net") {
        return vec![FuckingFast];
    }
    if uri.starts_with("https://vikingfile.com") || uri.starts_with("https://vik1ngfile.site") {
        return vec![VikingFile];
    }
    if uri.starts_with("https://www.rootz.so") {
        return vec![Rootz];
    }
    if uri.starts_with("https://filekeeper.net/") {
        return vec![FileKeeper];
    }
    if is_archive_org_file_uri(uri) {
        return vec![ArchiveOrg];
    }
    if REAL_DEBRID_HOSTS.iter().any(|host| uri.starts_with(host)) {
        return vec![RealDebrid];
    }
    if uri.starts_with("magnet:") {
        return vec![Torrent, Hydra, TorBox, RealDebrid, Premiumize, AllDebrid];
    }
    Vec::new()
}

/// getDownloadersForUris (first-seen order)
pub fn downloaders_for_uris<'a>(uris: impl IntoIterator<Item = &'a str>) -> Vec<Downloader> {
    let mut seen = Vec::new();
    for uri in uris {
        for downloader in downloaders_for_uri(uri) {
            if !seen.contains(&downloader) {
                seen.push(downloader);
            }
        }
    }
    seen
}

// ---- archive.org --------------------------------------------------------

fn decode_segment(segment: &str) -> String {
    let bytes = segment.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&segment[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
            // decodeURIComponent throws: keep the segment as is.
            return segment.to_string();
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| segment.to_string())
}

fn valid_identifier(s: &str) -> bool {
    let bytes = s.as_bytes();
    (2..=100).contains(&bytes.len())
        && bytes[0].is_ascii_alphanumeric()
        && bytes[1..]
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

fn has_file_extension(path: &str) -> bool {
    match path.rsplit_once('.') {
        Some((_, ext)) => {
            (1..=10).contains(&ext.len()) && ext.bytes().all(|b| b.is_ascii_alphanumeric())
        }
        None => false,
    }
}

/// parseArchiveOrgFileUri: (identifier, path)
pub fn parse_archive_org_file_uri(uri: &str) -> Option<(String, String)> {
    let parsed = reqwest::Url::parse(uri.trim()).ok()?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return None;
    }
    let host = parsed.host_str()?.to_lowercase();
    let pathname = parsed.path();
    let segments: Vec<&str> = pathname.split('/').filter(|s| !s.is_empty()).collect();
    let identifier_index = if host == "archive.org" || host == "www.archive.org" {
        if segments.first() != Some(&"download") {
            return None;
        }
        1
    } else if host.ends_with(".archive.org") {
        segments.iter().position(|s| *s == "items")? + 1
    } else {
        return None;
    };
    if pathname.ends_with('/') {
        return None;
    }
    let identifier = segments.get(identifier_index)?;
    if !valid_identifier(identifier) {
        return None;
    }
    let path: Vec<String> = segments[identifier_index + 1..]
        .iter()
        .map(|s| decode_segment(s))
        .filter(|s| s != "." && s != "..")
        .collect();
    let path = path.join("/");
    has_file_extension(&path).then(|| (identifier.to_string(), path))
}

pub fn is_archive_org_file_uri(uri: &str) -> bool {
    parse_archive_org_file_uri(uri).is_some()
}

// ---- repacks -------------------------------------------------------------

/// Hoster downloaders that can fetch every part of a URI group in order.
const MULTIPART_DOWNLOADERS: [Downloader; 8] = [
    Downloader::Gofile,
    Downloader::PixelDrain,
    Downloader::Datanodes,
    Downloader::Mediafire,
    Downloader::FuckingFast,
    Downloader::VikingFile,
    Downloader::Rootz,
    Downloader::FileKeeper,
];
const MULTIPART_FEATURE_URI_PREFIXES: [&str; 2] =
    ["https://fuckingfast.net", "https://filekeeper.net/"];

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn group_downloaders(group: &[String]) -> Vec<Downloader> {
    let per_part: Vec<Vec<Downloader>> = group
        .iter()
        .map(|uri| {
            downloaders_for_uri(uri)
                .into_iter()
                .filter(|d| MULTIPART_DOWNLOADERS.contains(d))
                .collect()
        })
        .collect();
    let Some((first, rest)) = per_part.split_first() else {
        return Vec::new();
    };
    first
        .iter()
        .copied()
        .filter(|d| rest.iter().all(|r| r.contains(d)))
        .collect()
}

/// normalizeUriGroups / withoutMultipartHosterDownloads, then keep repacks
/// with at least one downloadable URI (filterDownloadableRepacks).
pub fn filter_downloadable(repacks: Vec<Value>, multipart: bool) -> Vec<Value> {
    repacks
        .into_iter()
        .filter_map(|repack| {
            let Value::Object(mut repack) = repack else {
                return None;
            };
            let uris_valid = repack.get("uris").is_some_and(Value::is_array);
            let mut uris = strings(repack.get("uris"));
            if multipart {
                if repack.contains_key("uriGroups") {
                    let groups: Vec<Vec<String>> = repack
                        .get("uriGroups")
                        .and_then(Value::as_array)
                        .map(|a| {
                            a.iter()
                                .filter_map(|g| {
                                    let parts: Vec<String> = g
                                        .as_array()?
                                        .iter()
                                        .map(|p| p.as_str().map(str::to_string))
                                        .collect::<Option<_>>()?;
                                    let unique: HashSet<&String> = parts.iter().collect();
                                    (parts.len() > 1
                                        && parts.iter().all(|p| !p.is_empty())
                                        && unique.len() == parts.len())
                                    .then_some(parts)
                                })
                                .filter(|g| {
                                    !uris.contains(&g[0]) && !group_downloaders(g).is_empty()
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    uris.extend(groups.iter().map(|g| g[0].clone()));
                    repack.insert("uris".into(), Value::from(uris.clone()));
                    repack.insert("uriGroups".into(), Value::from(groups));
                }
            } else {
                if uris_valid {
                    uris.retain(|uri| {
                        !MULTIPART_FEATURE_URI_PREFIXES
                            .iter()
                            .any(|p| uri.starts_with(p))
                    });
                    repack.insert("uris".into(), Value::from(uris.clone()));
                }
                repack.remove("uriGroups");
            }
            let downloadable = repack.get("uris").is_some_and(Value::is_array)
                && !downloaders_for_uris(uris.iter().map(String::as_str)).is_empty();
            downloadable.then_some(Value::Object(repack))
        })
        .collect()
}

pub const HOSTER_AVAILABILITY_MAX_URLS: usize = 50;

/// collectHosterAvailabilityUris: VikingFile links, deduplicated, at most 50.
pub fn hoster_availability_uris(repacks: &[Value]) -> Vec<String> {
    let mut uris: Vec<String> = Vec::new();
    for repack in repacks {
        for uri in strings(repack.get("uris")) {
            if downloaders_for_uri(&uri).contains(&Downloader::VikingFile) && !uris.contains(&uri) {
                uris.push(uri);
            }
        }
    }
    uris.truncate(HOSTER_AVAILABILITY_MAX_URLS);
    uris
}

/// applyHosterAvailability: add links the hosters reported offline to `unavailableUris`.
pub fn apply_hoster_availability(repacks: &mut [Value], results: &[(String, bool)]) {
    let unavailable: HashSet<&str> = results
        .iter()
        .filter(|(_, ok)| !ok)
        .map(|(u, _)| u.as_str())
        .collect();
    if unavailable.is_empty() {
        return;
    }
    for repack in repacks.iter_mut() {
        let Value::Object(map) = repack else { continue };
        let known = strings(map.get("unavailableUris"));
        let extra: Vec<String> = strings(map.get("uris"))
            .into_iter()
            .filter(|uri| unavailable.contains(uri.as_str()) && !known.contains(uri))
            .collect();
        if extra.is_empty() {
            continue;
        }
        let mut all = known;
        all.extend(extra);
        map.insert("unavailableUris".into(), Value::from(all));
    }
}

/// getRepackAvailabilityStatus: "online" | "partial" | "offline"
pub fn availability(repack: &Map<String, Value>) -> &'static str {
    let uris = strings(repack.get("uris"));
    let unavailable: HashSet<String> = strings(repack.get("unavailableUris")).into_iter().collect();
    let available = uris.iter().filter(|u| !unavailable.contains(*u)).count();
    if uris.is_empty() || available == 0 {
        "offline"
    } else if available == uris.len() {
        "online"
    } else {
        "partial"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn classifies_uris() {
        assert_eq!(
            downloaders_for_uri("https://gofile.io/d/x"),
            vec![Downloader::Gofile]
        );
        assert_eq!(downloaders_for_uri("magnet:?xt=urn:btih:abc").len(), 6);
        assert_eq!(
            downloaders_for_uri("https://1fichier.com/?x"),
            vec![Downloader::RealDebrid]
        );
        assert_eq!(
            downloaders_for_uri("https://archive.org/download/some-item/game.zip"),
            vec![Downloader::ArchiveOrg]
        );
        assert!(downloaders_for_uri("https://archive.org/details/some-item").is_empty());
        assert!(downloaders_for_uri("https://example.com/file.zip").is_empty());
    }

    #[test]
    fn drops_multipart_hosts_without_the_feature() {
        let repacks = vec![
            json!({ "uris": ["https://fuckingfast.net/a"], "uriGroups": [] }),
            json!({ "uris": ["magnet:?xt=urn:btih:1", "https://fuckingfast.net/b"] }),
        ];
        let kept = filter_downloadable(repacks, false);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0]["uris"], json!(["magnet:?xt=urn:btih:1"]));
    }

    #[test]
    fn groups_become_one_option_with_the_feature() {
        let repacks = vec![json!({
            "uris": [],
            "uriGroups": [["https://gofile.io/d/1", "https://gofile.io/d/2"], ["https://gofile.io/d/3"]]
        })];
        let kept = filter_downloadable(repacks, true);
        assert_eq!(kept[0]["uris"], json!(["https://gofile.io/d/1"]));
        assert_eq!(kept[0]["uriGroups"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn availability_status() {
        let repack = json!({ "uris": ["a", "b"], "unavailableUris": ["b"] });
        assert_eq!(availability(repack.as_object().unwrap()), "partial");
    }
}
