use super::context::normalize_separators;
use crate::cloud_save::identity::is_safe_capture;

pub const STORE_USER_CAPTURE_MARKER: &str = "__HYDRA_STORE_USER_CAPTURE__";

fn raw_segments(raw_rule: &str) -> Vec<String> {
    normalize_separators(raw_rule)
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn path_segments(path: &str) -> Vec<&str> {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .collect()
}

pub fn capture_template(raw_rule: &str, resolved_path: &str) -> Option<String> {
    if !raw_rule.contains("<storeUserId>") {
        return None;
    }

    let raw = normalize_separators(raw_rule);
    let raw_segments = raw_segments(&raw);
    let mut resolved_segments = path_segments(resolved_path)
        .into_iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    for (raw_index, raw_segment) in raw_segments.iter().enumerate() {
        if !raw_segment.contains("<storeUserId>") {
            continue;
        }
        let offset_from_end = raw_segments.len() - raw_index - 1;
        let resolved_index = resolved_segments.len().checked_sub(offset_from_end + 1)?;
        resolved_segments[resolved_index] = raw_segment
            .replace("*<storeUserId>", "<storeUserId>")
            .replace("<storeUserId>*", "<storeUserId>")
            .replace("<storeUserId>", STORE_USER_CAPTURE_MARKER);
    }

    let prefix = if resolved_path.starts_with('/') {
        "/"
    } else {
        ""
    };
    Some(format!("{prefix}{}", resolved_segments.join("/")))
}

fn segment_matches(pattern: &str, value: &str, case_sensitive: bool) -> bool {
    globset::GlobBuilder::new(pattern)
        .case_insensitive(!case_sensitive)
        .literal_separator(true)
        .build()
        .map(|pattern| pattern.compile_matcher().is_match(value))
        .unwrap_or(false)
}

fn equal(left: &str, right: &str, case_sensitive: bool) -> bool {
    if case_sensitive {
        left == right
    } else {
        left.to_lowercase() == right.to_lowercase()
    }
}

fn capture_segment(template: &str, value: &str, case_sensitive: bool) -> Option<String> {
    let literals = template
        .split(STORE_USER_CAPTURE_MARKER)
        .collect::<Vec<_>>();
    if literals.len() < 2
        || literals
            .iter()
            .any(|literal| literal.contains(['*', '?', '[', '{']))
    {
        return None;
    }
    let prefix = literals[0];
    if value.len() < prefix.len() || !equal(&value[..prefix.len()], prefix, case_sensitive) {
        return None;
    }

    let capture_start = prefix.len();
    let capture_end = if literals[1].is_empty() {
        if literals.len() == 2 {
            value.len()
        } else {
            return None;
        }
    } else {
        let haystack = if case_sensitive {
            value[capture_start..].to_string()
        } else {
            value[capture_start..].to_lowercase()
        };
        let needle = if case_sensitive {
            literals[1].to_string()
        } else {
            literals[1].to_lowercase()
        };
        capture_start + haystack.find(&needle)?
    };
    let captured = &value[capture_start..capture_end];
    if !is_safe_capture(captured) {
        return None;
    }

    let mut reconstructed = String::new();
    for (index, literal) in literals.iter().enumerate() {
        if index > 0 {
            reconstructed.push_str(captured);
        }
        reconstructed.push_str(literal);
    }
    equal(&reconstructed, value, case_sensitive).then(|| captured.to_string())
}

fn match_segments(
    templates: &[&str],
    values: &[&str],
    case_sensitive: bool,
    captured: Option<String>,
) -> Option<String> {
    if templates.is_empty() {
        return values.is_empty().then_some(captured).flatten();
    }
    if templates[0] == "**" {
        for consumed in 0..=values.len() {
            if let Some(result) = match_segments(
                &templates[1..],
                &values[consumed..],
                case_sensitive,
                captured.clone(),
            ) {
                return Some(result);
            }
        }
        return None;
    }
    let value = *values.first()?;
    let next_capture = if templates[0].contains(STORE_USER_CAPTURE_MARKER) {
        let value = capture_segment(templates[0], value, case_sensitive)?;
        if captured
            .as_ref()
            .is_some_and(|existing| !equal(existing, &value, case_sensitive))
        {
            return None;
        }
        Some(value)
    } else {
        if !segment_matches(templates[0], value, case_sensitive) {
            return None;
        }
        captured
    };
    match_segments(&templates[1..], &values[1..], case_sensitive, next_capture)
}

pub fn capture_store_user(
    template: &str,
    concrete_path: &str,
    case_sensitive: bool,
) -> Option<String> {
    let normalized_template = normalize_separators(template);
    let normalized_path = normalize_separators(concrete_path);
    match_segments(
        &path_segments(&normalized_template),
        &path_segments(&normalized_path),
        case_sensitive,
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_full_embedded_and_repeated_placeholders() {
        let full = capture_template(
            "<winAppData>/Sekiro/<storeUserId>",
            "C:/Users/A/AppData/Roaming/Sekiro/*",
        )
        .unwrap();
        assert_eq!(
            capture_store_user(&full, "C:/Users/A/AppData/Roaming/Sekiro/111111", false).as_deref(),
            Some("111111")
        );

        let embedded = capture_template(
            "<home>/Game/_steam_<storeUserId>/saves",
            "/prefix/drive_c/users/steamuser/Game/_steam_*/saves",
        )
        .unwrap();
        assert_eq!(
            capture_store_user(
                &embedded,
                "/prefix/drive_c/users/steamuser/Game/_steam_Goldberg/saves",
                true
            )
            .as_deref(),
            Some("Goldberg")
        );

        let repeated = capture_template(
            "<home>/Game/<storeUserId>/<storeUserId>/saves",
            "/home/a/Game/*/*/saves",
        )
        .unwrap();
        assert_eq!(
            capture_store_user(&repeated, "/home/a/Game/Rune/Rune/saves", true).as_deref(),
            Some("Rune")
        );
        assert!(capture_store_user(&repeated, "/home/a/Game/Rune/Goldberg/saves", true).is_none());
    }
}
