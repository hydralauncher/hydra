use super::ffi::Result;
use serde_json::Value;
use std::collections::HashSet;

pub fn additional_trackers(
    existing: &[(String, i32)],
    custom: &[String],
    fallback: &[String],
) -> Vec<(String, i32)> {
    let mut known: HashSet<String> = existing.iter().map(|(url, _)| url.clone()).collect();
    let mut tiers: Vec<i32> = existing.iter().map(|(_, tier)| *tier).collect();
    let mut result = Vec::new();
    for tracker in custom {
        if known.insert(tracker.clone()) {
            result.push((tracker.clone(), 0));
            tiers.push(0);
        }
    }
    let fallback_tier = tiers.iter().max().map(|t| t + 1).unwrap_or(0);
    for tracker in fallback {
        if known.insert(tracker.clone()) {
            result.push((tracker.clone(), fallback_tier));
        }
    }
    result
}
pub fn trackers(value: &Value) -> Result<Vec<String>> {
    if value.is_null() {
        return Ok(vec![]);
    }
    value
        .as_array()
        .ok_or("invalid_trackers")?
        .iter()
        .map(|v| {
            let s = v.as_str().ok_or("invalid_trackers")?;
            let (scheme, rest) = s.split_once("://").ok_or("invalid_trackers")?;
            if !["http", "https", "udp", "ws", "wss"]
                .contains(&scheme.to_ascii_lowercase().as_str())
                || rest
                    .split(['/', '?', '#'])
                    .next()
                    .unwrap_or_default()
                    .is_empty()
                || s.contains('\0')
            {
                return Err("invalid_trackers".into());
            }
            Ok(s.to_string())
        })
        .collect()
}
pub fn indices(value: &Value) -> Result<Option<Vec<i64>>> {
    if value.is_null() {
        return Ok(None);
    }
    let mut result = value
        .as_array()
        .ok_or("invalid_file_indices")?
        .iter()
        .map(|v| v.as_i64().ok_or_else(|| "invalid_file_indices".into()))
        .collect::<Result<Vec<_>>>()?;
    result.sort_unstable();
    result.dedup();
    Ok(Some(result))
}
// Python int() compatibility for configuration inputs (not file indices).
pub fn integer(v: &Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_bool().map(i64::from))
        .or_else(|| v.as_f64().filter(|n| n.is_finite()).map(|n| n as i64))
        .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
}
pub fn timeout(v: &Value) -> u64 {
    integer(v).unwrap_or(30_000).clamp(5_000, 120_000) as u64
}
pub fn magnet(value: &Value) -> Result<(String, String)> {
    let s = value.as_str().ok_or("invalid_magnet")?.trim();
    if !s.starts_with("magnet:") || s.chars().count() > 8192 {
        return Err("invalid_magnet".into());
    }
    let parsed = reqwest::Url::parse(s).map_err(|_| "invalid_magnet")?;
    for (key, value) in parsed.query_pairs() {
        if key != "xt" {
            continue;
        }
        if let Some(hash) = value.strip_prefix("urn:btih:") {
            let hash = hash.trim();
            if (hash.len() == 40 && hash.bytes().all(|b| b.is_ascii_hexdigit()))
                || (hash.len() == 32
                    && hash
                        .bytes()
                        .all(|b| b.is_ascii_alphabetic() || (b'2'..=b'7').contains(&b)))
            {
                return Ok((s.into(), hash.to_ascii_lowercase()));
            }
        }
    }
    Err("invalid_magnet".into())
}
pub fn binding(value: &Value, port: u16) -> (String, String) {
    let interface = value.as_str().unwrap_or_default().trim();
    if interface.is_empty() {
        return (format!("0.0.0.0:{port}"), String::new());
    }
    let tokens: Vec<_> = interface
        .split(',')
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .collect();
    let listen = tokens
        .iter()
        .map(|t| {
            if t.contains(':') {
                format!("[{t}]:{port}")
            } else {
                format!("{t}:{port}")
            }
        })
        .collect::<Vec<_>>()
        .join(",");
    (listen, tokens.join(","))
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn custom_trackers_precede_deduplicated_fallback_tier() {
        assert_eq!(
            additional_trackers(
                &[("magnet".into(), 4)],
                &["custom".into(), "magnet".into()],
                &["custom".into(), "fallback".into(), "fallback".into()]
            ),
            vec![("custom".into(), 0), ("fallback".into(), 5)]
        );
        assert_eq!(
            additional_trackers(&[], &[], &["fallback".into()]),
            vec![("fallback".into(), 0)]
        );
    }
    #[test]
    fn selection_rejects_bool_and_float() {
        assert!(indices(&json!([true])).is_err());
        assert!(indices(&json!([1.5])).is_err());
        assert_eq!(indices(&json!([3, 1, 3])).unwrap(), Some(vec![1, 3]));
    }
    #[test]
    fn binding_supports_ipv6_and_multiple_interfaces() {
        assert_eq!(
            binding(&json!(" 10.0.0.1,::1 "), 5881),
            ("10.0.0.1:5881,[::1]:5881".into(), "10.0.0.1,::1".into())
        );
    }
    #[test]
    fn metadata_validation_preserves_hash_representation() {
        let hash = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        assert_eq!(
            magnet(&json!(format!("magnet:?xt=urn:btih:{hash}")))
                .unwrap()
                .1,
            hash.to_lowercase()
        );
        assert!(magnet(&json!("magnet:?xt=urn:btmh:1234")).is_err());
    }
    #[test]
    fn configuration_coercion_and_limits() {
        assert_eq!(timeout(&json!("200000")), 120000);
        assert_eq!(timeout(&json!(true)), 5000);
        assert_eq!(timeout(&json!(null)), 30000);
        assert!(trackers(&json!(["ftp://host"])).is_err());
    }
}
