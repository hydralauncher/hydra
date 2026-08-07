pub fn normalize_path(value: &str) -> String {
    value.replace('\\', "/")
}

pub fn has_glob_pattern(path: &str) -> bool {
    path.contains(['*', '?', '[', '{'])
}

fn is_escaped(value: &str, index: usize) -> bool {
    value[..index]
        .chars()
        .rev()
        .take_while(|character| *character == '\\')
        .count()
        % 2
        == 1
}

fn is_in_character_class(value: &str, index: usize) -> bool {
    let mut in_class = false;
    let mut class_has_member = false;

    for (character_index, character) in value.char_indices() {
        if character_index >= index {
            break;
        }
        if is_escaped(value, character_index) {
            continue;
        }

        if in_class {
            if character == ']' && class_has_member {
                in_class = false;
            } else {
                class_has_member = true;
            }
        } else if character == '[' {
            in_class = true;
            class_has_member = false;
        }
    }

    in_class
}

fn is_brace_syntax(value: &str, index: usize) -> bool {
    !is_escaped(value, index) && !is_in_character_class(value, index)
}

fn matching_brace(pattern: &str, opening: usize) -> Result<usize, String> {
    let mut depth = 0;

    for (offset, character) in pattern[opening..].char_indices() {
        let index = opening + offset;
        if !is_brace_syntax(pattern, index) {
            continue;
        }

        match character {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Ok(index);
                }
            }
            _ => {}
        }
    }

    Err("cloud_save_invalid_glob: unmatched opening brace".to_string())
}

fn brace_alternatives(value: &str) -> Vec<&str> {
    let mut alternatives = Vec::new();
    let mut start = 0;
    let mut depth = 0;

    for (index, character) in value.char_indices() {
        if !is_brace_syntax(value, index) {
            continue;
        }

        match character {
            '{' => depth += 1,
            '}' => depth -= 1,
            ',' if depth == 0 => {
                alternatives.push(&value[start..index]);
                start = index + 1;
            }
            _ => {}
        }
    }

    alternatives.push(&value[start..]);
    alternatives
}

pub fn expand_braces(pattern: &str) -> Result<Vec<String>, String> {
    let mut opening = None;
    let mut closing = None;
    let mut alternatives = Vec::new();
    for (index, character) in pattern.char_indices() {
        if character != '{' || !is_brace_syntax(pattern, index) {
            continue;
        }
        let Ok(candidate_closing) = matching_brace(pattern, index) else {
            continue;
        };
        let candidate_alternatives = brace_alternatives(&pattern[index + 1..candidate_closing]);
        if candidate_alternatives.len() >= 2 {
            opening = Some(index);
            closing = Some(candidate_closing);
            alternatives = candidate_alternatives;
            break;
        }
    }

    let (Some(opening), Some(closing)) = (opening, closing) else {
        return Ok(vec![pattern.to_string()]);
    };

    let mut expanded = Vec::new();
    for alternative in alternatives {
        let candidate = format!(
            "{}{}{}",
            &pattern[..opening],
            alternative,
            &pattern[closing + 1..]
        );
        expanded.extend(expand_braces(&candidate)?);
    }

    Ok(expanded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_nested_braces() {
        assert_eq!(
            expand_braces("save/{one,{two,three}}/*.{sav,dat}").unwrap(),
            vec![
                "save/one/*.sav",
                "save/one/*.dat",
                "save/two/*.sav",
                "save/two/*.dat",
                "save/three/*.sav",
                "save/three/*.dat",
            ]
        );
    }

    #[test]
    fn preserves_literal_braces_in_character_classes() {
        let pattern = "/Games/[{]Deluxe[}]/save.dat";

        assert_eq!(expand_braces(pattern).unwrap(), vec![pattern]);
    }

    #[test]
    fn preserves_literal_braces_and_expands_later_alternatives() {
        assert_eq!(
            expand_braces("save/{random}/*.{sav,dat}").unwrap(),
            vec!["save/{random}/*.sav", "save/{random}/*.dat"]
        );
        assert_eq!(
            expand_braces("save/{64bitSteamID}/slot.dat").unwrap(),
            vec!["save/{64bitSteamID}/slot.dat"]
        );
    }
}
