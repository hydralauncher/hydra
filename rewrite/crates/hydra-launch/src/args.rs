//! parse-launch-options.ts (string-argv) and resolve-launch-command.ts.

use std::collections::BTreeMap;

const COMMAND_PLACEHOLDER: &str = "%command%";

/// string-argv's `parseArgsStringToArgv`: whitespace separated tokens; a
/// quoted string on its own loses its quotes, quotes inside a word stay.
pub fn parse_launch_options(value: Option<&str>) -> Vec<String> {
    let Some(value) = value.filter(|v| !v.is_empty()) else {
        return Vec::new();
    };
    let chars: Vec<char> = value.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;
    let is_quote = |c: char| c == '"' || c == '\'';
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if is_quote(c) {
            // (['"])([^\5]*?)\5: the text between the quotes
            match chars[i + 1..].iter().position(|x| *x == c) {
                Some(end) => {
                    tokens.push(chars[i + 1..i + 1 + end].iter().collect());
                    i += end + 2;
                }
                None => i += 1,
            }
            continue;
        }
        // A word, keeping quoted parts (with their quotes) when they close.
        let start = i;
        while i < chars.len() && !chars[i].is_whitespace() {
            if is_quote(chars[i]) {
                match chars[i + 1..].iter().position(|x| *x == chars[i]) {
                    Some(end) => i += end + 2,
                    None => break,
                }
            } else {
                i += 1;
            }
        }
        if i > start {
            tokens.push(chars[start..i].iter().collect());
        } else {
            i += 1;
        }
    }
    tokens
}

/// ResolvedLaunchCommand
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LaunchCommand {
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

fn is_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn basename(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// resolveLaunchCommand
pub fn resolve_launch_command(
    base_command: &str,
    base_args: &[String],
    launch_options: Option<&str>,
    wrappers: &[String],
) -> LaunchCommand {
    let apply_wrappers = |resolved: LaunchCommand| {
        wrappers
            .iter()
            .filter(|w| !w.is_empty())
            .rev()
            .fold(resolved, |current, wrapper| {
                if basename(&current.command).eq_ignore_ascii_case(wrapper) {
                    return current;
                }
                let mut args = vec![current.command];
                args.extend(current.args);
                LaunchCommand {
                    command: wrapper.clone(),
                    args,
                    env: current.env,
                }
            })
    };
    let tokens = parse_launch_options(launch_options);
    if tokens.is_empty() || !tokens.iter().any(|t| t == COMMAND_PLACEHOLDER) {
        let mut args = base_args.to_vec();
        args.extend(tokens);
        return apply_wrappers(LaunchCommand {
            command: base_command.to_string(),
            args,
            env: BTreeMap::new(),
        });
    }
    let expanded: Vec<String> = tokens
        .into_iter()
        .flat_map(|t| {
            if t == COMMAND_PLACEHOLDER {
                std::iter::once(base_command.to_string())
                    .chain(base_args.iter().cloned())
                    .collect::<Vec<_>>()
            } else {
                vec![t]
            }
        })
        .collect();
    // extractLeadingEnvAssignments
    let mut env = BTreeMap::new();
    let mut index = 0;
    while index < expanded.len() {
        let token = &expanded[index];
        match token.find('=') {
            Some(sep) if sep > 0 && is_env_name(&token[..sep]) => {
                env.insert(token[..sep].to_string(), token[sep + 1..].to_string());
                index += 1;
            }
            _ => break,
        }
    }
    let rest = &expanded[index..];
    if rest.is_empty() {
        return apply_wrappers(LaunchCommand {
            command: base_command.to_string(),
            args: base_args.to_vec(),
            env,
        });
    }
    apply_wrappers(LaunchCommand {
        command: rest[0].clone(),
        args: rest[1..].to_vec(),
        env,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argv() {
        assert_eq!(
            parse_launch_options(Some(r#"-windowed "-name Foo" a"b c"d"#)),
            vec!["-windowed", "-name Foo", r#"a"b c"d"#]
        );
        assert!(parse_launch_options(None).is_empty());
    }

    #[test]
    fn command_placeholder() {
        let r = resolve_launch_command("game.exe", &[], Some("DXVK_HUD=1 %command% -dx11"), &[]);
        assert_eq!(r.command, "game.exe");
        assert_eq!(r.args, vec!["-dx11"]);
        assert_eq!(r.env.get("DXVK_HUD").map(String::as_str), Some("1"));
        let r = resolve_launch_command(
            "game.exe",
            &[],
            Some("-fullscreen"),
            &["gamemoderun".into()],
        );
        assert_eq!(r.command, "gamemoderun");
        assert_eq!(r.args, vec!["game.exe", "-fullscreen"]);
    }
}
