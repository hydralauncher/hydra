use std::collections::HashMap;

use super::scan_path::normalize_scanned_path;

pub fn has_glob_pattern(path: &str) -> bool {
    path.contains(['*', '?', '['])
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

fn relative_pattern(pattern: &str, base: &str) -> String {
    if base == "." {
        return pattern.to_string();
    }

    pattern
        .strip_prefix(base)
        .unwrap_or(pattern)
        .trim_start_matches('/')
        .to_string()
}

fn class_matches(content: &[char], candidate: char) -> bool {
    let mut index = 0;
    while index < content.len() {
        if index + 2 < content.len() && content[index + 1] == '-' {
            if content[index] <= candidate && candidate <= content[index + 2] {
                return true;
            }
            index += 3;
        } else {
            if content[index] == candidate {
                return true;
            }
            index += 1;
        }
    }
    false
}

fn matches_chars(
    pattern: &[char],
    candidate: &[char],
    pattern_index: usize,
    candidate_index: usize,
    memo: &mut HashMap<(usize, usize), bool>,
) -> bool {
    if let Some(result) = memo.get(&(pattern_index, candidate_index)) {
        return *result;
    }

    let result = if pattern_index == pattern.len() {
        candidate_index == candidate.len()
    } else {
        match pattern[pattern_index] {
            '*' => {
                matches_chars(pattern, candidate, pattern_index + 1, candidate_index, memo)
                    || (candidate_index < candidate.len()
                        && candidate[candidate_index] != '/'
                        && matches_chars(
                            pattern,
                            candidate,
                            pattern_index,
                            candidate_index + 1,
                            memo,
                        ))
            }
            '?' => {
                candidate_index < candidate.len()
                    && candidate[candidate_index] != '/'
                    && matches_chars(
                        pattern,
                        candidate,
                        pattern_index + 1,
                        candidate_index + 1,
                        memo,
                    )
            }
            '[' => {
                let closing = pattern[pattern_index + 1..]
                    .iter()
                    .position(|character| *character == ']')
                    .map(|offset| pattern_index + 1 + offset);

                if let Some(closing_index) = closing {
                    candidate_index < candidate.len()
                        && candidate[candidate_index] != '/'
                        && class_matches(
                            &pattern[pattern_index + 1..closing_index],
                            candidate[candidate_index],
                        )
                        && matches_chars(
                            pattern,
                            candidate,
                            closing_index + 1,
                            candidate_index + 1,
                            memo,
                        )
                } else {
                    candidate.get(candidate_index) == Some(&'[')
                        && matches_chars(
                            pattern,
                            candidate,
                            pattern_index + 1,
                            candidate_index + 1,
                            memo,
                        )
                }
            }
            literal => {
                candidate.get(candidate_index) == Some(&literal)
                    && matches_chars(
                        pattern,
                        candidate,
                        pattern_index + 1,
                        candidate_index + 1,
                        memo,
                    )
            }
        }
    };

    memo.insert((pattern_index, candidate_index), result);
    result
}

pub fn matches_glob_pattern(pattern: &str, candidate_relative_path: &str) -> bool {
    let normalized_pattern = normalize_scanned_path(pattern);
    let base = glob_base_path(&normalized_pattern);
    let pattern = relative_pattern(&normalized_pattern, &base)
        .chars()
        .collect::<Vec<_>>();
    let candidate = normalize_scanned_path(candidate_relative_path)
        .chars()
        .collect::<Vec<_>>();

    matches_chars(&pattern, &candidate, 0, 0, &mut HashMap::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_supported_glob_patterns() {
        let cases = [
            ("*.jkr", "1.jkr", true),
            ("*.jkr", "folder/1.jkr", false),
            ("save?.dat", "save1.dat", true),
            ("save?.dat", "save10.dat", false),
            ("save[0-9].dat", "save5.dat", true),
            ("save[0-9].dat", "savex.dat", false),
            ("save[abc].dat", "saveb.dat", true),
            ("save[abc].dat", "saved.dat", false),
            ("file[.txt", "file[.txt", true),
        ];

        for (pattern, candidate, expected) in cases {
            assert_eq!(
                matches_glob_pattern(pattern, candidate),
                expected,
                "{pattern} against {candidate}",
            );
        }

        assert_eq!(
            glob_base_path("/tmp/Balatro/*.jkr"),
            "/tmp/Balatro",
        );

        assert_eq!(
            glob_base_path("*.jkr"),
            ".",
        );
    }
}
