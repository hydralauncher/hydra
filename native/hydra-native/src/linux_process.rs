//! Linux process evidence. Raw argv and environment never leave this module.
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

const MAX_PROCESS_FILE_BYTES: u64 = 256 * 1024;
const MAX_PROCESS_MAP_BYTES: u64 = 8 * 1024 * 1024;
const INVOCATION_ENV: &str = "HYDRA_EPIC_INVOCATION_ID";
const ENV_ALLOWLIST: &[&str] = &[
    INVOCATION_ENV,
    "WINEPREFIX",
    "STEAM_COMPAT_DATA_PATH",
    "APPIMAGE",
];

#[derive(Default)]
pub struct LinuxProcessInspection {
    pub start_time: Option<String>,
    pub invocation_id: Option<String>,
    pub wine_prefix_path: Option<String>,
    pub pe_executable_path: Option<String>,
    pub environment: HashMap<String, String>,
    pub complete: bool,
}

fn read_bounded(path: &Path, maximum: u64) -> io::Result<Vec<u8>> {
    let mut data = Vec::new();
    fs::File::open(path)?
        .take(maximum + 1)
        .read_to_end(&mut data)?;
    if data.len() as u64 > maximum {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "process file exceeds limit",
        ));
    }
    Ok(data)
}

fn start_ticks(stat: &[u8]) -> Option<String> {
    let value = std::str::from_utf8(stat).ok()?;
    // comm may itself contain spaces or ')'; fields after its final ')' start at state (3).
    let tail = value.rsplit_once(')')?.1;
    let ticks = tail.split_whitespace().nth(19)?;
    ticks.parse::<u64>().ok()?;
    Some(ticks.to_string())
}

fn safe_environment(bytes: &[u8]) -> HashMap<String, String> {
    bytes
        .split(|byte| *byte == 0)
        .filter_map(|entry| {
            let text = std::str::from_utf8(entry).ok()?;
            let (key, value) = text.split_once('=')?;
            ENV_ALLOWLIST
                .contains(&key)
                .then(|| (key.to_string(), value.to_string()))
        })
        .collect()
}

fn decode_proc_path(value: &str) -> String {
    let mut output = Vec::new();
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\\'
            && index + 3 < bytes.len()
            && bytes[index + 1..index + 4]
                .iter()
                .all(|byte| (b'0'..=b'7').contains(byte))
        {
            let decoded = u16::from(bytes[index + 1] - b'0') * 64
                + u16::from(bytes[index + 2] - b'0') * 8
                + u16::from(bytes[index + 3] - b'0');
            if let Ok(decoded) = u8::try_from(decoded) {
                output.push(decoded);
                index += 4;
            } else {
                output.push(bytes[index]);
                index += 1;
            }
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8_lossy(&output).into_owned()
}

fn mapped_filename(line: &str) -> Option<String> {
    let mut remainder = line;
    for _ in 0..5 {
        remainder = remainder.trim_start();
        let boundary = remainder.find(char::is_whitespace)?;
        remainder = &remainder[boundary..];
    }
    let name = remainder.trim_start();
    name.starts_with('/').then(|| decode_proc_path(name))
}

fn is_pe_path(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
}

fn canonical_pe(path: &Path) -> io::Result<Option<PathBuf>> {
    if !is_pe_path(path) {
        return Ok(None);
    }
    let canonical = path.canonicalize()?;
    let mut header = [0; 2];
    fs::File::open(&canonical)?.read_exact(&mut header)?;
    Ok((header == *b"MZ").then_some(canonical))
}

fn resolve_case_insensitive(base: &Path, remainder: &str) -> io::Result<PathBuf> {
    let mut current = base.to_path_buf();
    for segment in remainder
        .split(['/', '\\'])
        .filter(|segment| !segment.is_empty())
    {
        if segment == ".." {
            return Err(io::Error::from(io::ErrorKind::InvalidData));
        }
        if segment == "." {
            continue;
        }
        let exact = current.join(segment);
        if exact.exists() {
            current = exact;
            continue;
        }
        let mut matches = fs::read_dir(&current)?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(segment)
            });
        let first = matches.next().ok_or(io::ErrorKind::NotFound)?;
        if matches.next().is_some() {
            return Err(io::Error::from(io::ErrorKind::InvalidData));
        }
        current = first.path();
    }
    current.canonicalize()
}

fn windows_path_to_host(
    value: &str,
    prefix: Option<&str>,
    cwd: Option<&Path>,
) -> io::Result<PathBuf> {
    if value.starts_with('/') {
        return Path::new(value).canonicalize();
    }
    if value.len() > 2 && value.as_bytes()[0].is_ascii_alphabetic() && value.as_bytes()[1] == b':' {
        let prefix = prefix.ok_or(io::ErrorKind::NotFound)?;
        let drive = value[..2].to_ascii_lowercase();
        let base = Path::new(prefix)
            .join("dosdevices")
            .join(drive)
            .canonicalize()?;
        return resolve_case_insensitive(&base, &value[2..]);
    }
    let base = cwd.ok_or(io::ErrorKind::NotFound)?;
    resolve_case_insensitive(base, value)
}

fn wine_loader_name(value: &str) -> bool {
    matches!(
        value,
        "wine" | "wine64" | "wine-preloader" | "wine64-preloader"
    )
}

fn command_pe(command: &[u8], prefix: Option<&str>, cwd: Option<&Path>) -> Option<PathBuf> {
    let arguments: Vec<_> = command
        .split(|byte| *byte == 0)
        .filter(|value| !value.is_empty())
        .collect();
    let first = std::str::from_utf8(arguments.first()?).ok()?;
    // Only argv[0], or argv[1] following a recognized Wine loader, identifies the PE.
    // Searching arbitrary arguments could mistake a document or an auth value for an executable.
    let executable = if wine_loader_name(Path::new(first).file_name()?.to_str()?) {
        std::str::from_utf8(arguments.get(1)?).ok()?
    } else {
        first
    };
    let host = windows_path_to_host(executable, prefix, cwd).ok()?;
    canonical_pe(&host).ok().flatten()
}

pub fn inspect_process(
    pid: u32,
    host_executable: Option<&Path>,
    name: &str,
    cwd: Option<&Path>,
) -> LinuxProcessInspection {
    inspect_process_at(Path::new("/proc"), pid, host_executable, name, cwd)
}

fn revalidate_identity(directory: &Path, result: &mut LinuxProcessInspection) {
    let current = read_bounded(&directory.join("stat"), MAX_PROCESS_FILE_BYTES)
        .ok()
        .and_then(|stat| start_ticks(&stat));
    if current.is_none() || current != result.start_time {
        result.complete = false;
        result.pe_executable_path = None;
    }
}

fn inspect_process_at(
    proc_root: &Path,
    pid: u32,
    host_executable: Option<&Path>,
    name: &str,
    cwd: Option<&Path>,
) -> LinuxProcessInspection {
    let directory = proc_root.join(pid.to_string());
    let mut result = LinuxProcessInspection::default();
    let Ok(stat) = read_bounded(&directory.join("stat"), MAX_PROCESS_FILE_BYTES) else {
        return result;
    };
    result.start_time = start_ticks(&stat);
    let Ok(environment) = read_bounded(&directory.join("environ"), MAX_PROCESS_FILE_BYTES) else {
        return result;
    };
    result.environment = safe_environment(&environment);
    result.invocation_id = result.environment.get(INVOCATION_ENV).cloned();
    let prefix = result
        .environment
        .get("WINEPREFIX")
        .or_else(|| result.environment.get("STEAM_COMPAT_DATA_PATH"));
    result.wine_prefix_path = prefix
        .and_then(|value| Path::new(value).canonicalize().ok())
        .map(|value| value.to_string_lossy().into_owned());
    result.complete = result.start_time.is_some();
    let host_name = host_executable
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let is_wine = wine_loader_name(host_name) || name.to_ascii_lowercase().ends_with(".exe");
    if !is_wine {
        revalidate_identity(&directory, &mut result);
        return result;
    }
    let Ok(command) = read_bounded(&directory.join("cmdline"), MAX_PROCESS_FILE_BYTES) else {
        result.complete = false;
        return result;
    };
    let Ok(maps) = read_bounded(&directory.join("maps"), MAX_PROCESS_MAP_BYTES) else {
        result.complete = false;
        return result;
    };
    let expected = command_pe(&command, result.wine_prefix_path.as_deref(), cwd);
    let mut candidates = HashSet::new();
    for line in String::from_utf8_lossy(&maps).lines() {
        let Some(filename) = mapped_filename(line) else {
            continue;
        };
        if !is_pe_path(Path::new(filename.trim_end_matches(" (deleted)"))) {
            continue;
        }
        match canonical_pe(Path::new(&filename)) {
            Ok(Some(candidate)) => {
                candidates.insert(candidate);
            }
            Ok(None) => {}
            Err(_) => result.complete = false,
        }
    }
    let selected = expected
        .filter(|expected| candidates.contains(expected))
        .or_else(|| {
            if candidates.len() == 1 {
                candidates.into_iter().next()
            } else {
                None
            }
        });
    result.pe_executable_path = selected.map(|value| value.to_string_lossy().into_owned());
    // An inspected Wine loader without a proven PE is still an unknown writer.
    if result.pe_executable_path.is_none() {
        result.complete = false;
    }
    revalidate_identity(&directory, &mut result);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FixtureDirectory(PathBuf);

    impl FixtureDirectory {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
                "hydra-process-fixture-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
    }

    impl Drop for FixtureDirectory {
        fn drop(&mut self) {
            if self.0.parent() == std::env::temp_dir().canonicalize().ok().as_deref() {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn start_ticks_are_exact_and_comm_can_contain_parentheses() {
        let tail = (4..=21)
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join(" ");
        let stat = format!("42 (name ) with spaces) S {tail} 9007199254740993 0");
        assert_eq!(
            start_ticks(stat.as_bytes()).as_deref(),
            Some("9007199254740993")
        );
        assert_eq!(start_ticks(b"invalid"), None);
    }

    #[test]
    fn projection_drops_secrets_and_preserves_values_with_equals() {
        let env = safe_environment(b"AUTH_PASSWORD=secret\0WINEPREFIX=/prefix\0HYDRA_EPIC_INVOCATION_ID=id=part\0LD_PRELOAD=secret\0APPIMAGE=/image\0");
        assert_eq!(env.len(), 3);
        assert_eq!(env.get(INVOCATION_ENV).map(String::as_str), Some("id=part"));
        assert!(!env.contains_key("AUTH_PASSWORD"));
    }

    #[test]
    fn maps_paths_preserve_spaces_unicode_and_escaped_backslashes() {
        assert_eq!(
            mapped_filename("100-200 r-xp 0000 00:01 123    /Games/Jogo\\040ação\\134game.exe")
                .as_deref(),
            Some("/Games/Jogo ação\\game.exe")
        );
        assert_eq!(mapped_filename("100-200 rw-p 0000 00:00 0 [heap]"), None);
        assert_eq!(decode_proc_path("\\777"), "\\777");
    }

    #[test]
    fn failed_or_oversized_inspection_never_proves_an_empty_process() {
        let result = inspect_process_at(
            Path::new("missing-proc-fixture"),
            123,
            None,
            "game.exe",
            None,
        );
        assert!(!result.complete);
        assert!(result.pe_executable_path.is_none());
        let fixture = FixtureDirectory::new();
        let file = fixture.0.join("oversized");
        fs::write(&file, [0; 10]).unwrap();
        assert_eq!(
            read_bounded(&file, 9).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn identity_revalidation_rejects_a_reused_pid() {
        let fixture = FixtureDirectory::new();
        let tail = (4..=21)
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join(" ");
        fs::write(
            fixture.0.join("stat"),
            format!("42 (process) S {tail} 2000 0"),
        )
        .unwrap();
        let mut result = LinuxProcessInspection {
            start_time: Some("1000".to_string()),
            pe_executable_path: Some("old-game.exe".to_string()),
            complete: true,
            ..Default::default()
        };
        revalidate_identity(&fixture.0, &mut result);
        assert!(!result.complete);
        assert!(result.pe_executable_path.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn wine_projection_requires_mapped_pe_and_drops_auth_argv() {
        let fixture = FixtureDirectory::new();
        let prefix = fixture.0.join("prefix");
        let games = fixture.0.join("Games with spaces");
        fs::create_dir_all(prefix.join("dosdevices")).unwrap();
        fs::create_dir(&games).unwrap();
        let game = games.join("Jogo.exe");
        fs::write(&game, b"MZfixture").unwrap();
        std::os::unix::fs::symlink(&games, prefix.join("dosdevices/q:")).unwrap();
        let process = fixture.0.join("42");
        fs::create_dir(&process).unwrap();
        let tail = (4..=21)
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join(" ");
        fs::write(
            process.join("stat"),
            format!("42 (game.exe) S {tail} 1000 0"),
        )
        .unwrap();
        fs::write(
            process.join("environ"),
            format!(
                "WINEPREFIX={}\0HYDRA_EPIC_INVOCATION_ID=session-a\0AUTH_PASSWORD=secret\0",
                prefix.display()
            ),
        )
        .unwrap();
        fs::write(
            process.join("cmdline"),
            b"wine64\0Q:\\jogo.exe\0-AUTH_PASSWORD=secret\0",
        )
        .unwrap();
        fs::write(
            process.join("maps"),
            format!(
                "100-200 r-xp 0000 00:01 123 {}\n",
                game.to_string_lossy().replace(' ', "\\040")
            ),
        )
        .unwrap();
        let result = inspect_process_at(
            &fixture.0,
            42,
            Some(Path::new("/runtime/wine64-preloader")),
            "Jogo.exe",
            Some(&games),
        );
        assert!(result.complete);
        assert_eq!(result.pe_executable_path.as_deref(), game.to_str());
        assert_eq!(result.invocation_id.as_deref(), Some("session-a"));
        assert!(!result.environment.contains_key("AUTH_PASSWORD"));
        assert_eq!(result.start_time.as_deref(), Some("1000"));
        fs::write(process.join("maps"), b"100-200 rw-p 0000 00:00 0 [heap]\n").unwrap();
        let missing = inspect_process_at(
            &fixture.0,
            42,
            Some(Path::new("/runtime/wine64")),
            "Jogo.exe",
            Some(&games),
        );
        assert!(!missing.complete);
        assert!(missing.pe_executable_path.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn command_arguments_do_not_become_a_game_executable() {
        let fixture = FixtureDirectory::new();
        let game = fixture.0.join("game.exe");
        fs::write(&game, b"MZfixture").unwrap();
        let command = format!(
            "/usr/bin/python\0--document\0{}\0-AUTH_PASSWORD=secret\0",
            game.display()
        );
        assert!(command_pe(command.as_bytes(), None, Some(&fixture.0)).is_none());
        let first = format!("{}\0-AUTH_PASSWORD=secret\0", game.display());
        assert_eq!(
            command_pe(first.as_bytes(), None, Some(&fixture.0)).as_deref(),
            Some(game.as_path())
        );
    }
}
