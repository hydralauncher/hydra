//! Which running game owns the foreground window:
//! screenshots/foreground-game-match.ts, windows-game-window-match.ts and
//! linux-process-match.ts (isLinuxGameWindowProcess).

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;

use super::paths::normalize;

/// ScreenshotGameTarget
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GameTarget {
    /// levelKeys.game(shop, objectId)
    pub game_key: String,
    pub shop: String,
    pub object_id: String,
    pub title: String,
    /// launchedGamePids
    pub process_id: Option<u32>,
    /// executablePath + trackingExecutablePaths
    pub executable_paths: Vec<String>,
    pub wine_prefix_path: Option<String>,
    pub is_emulator: bool,
}

/// The foreground window's owners (ForegroundWindowInfo).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Foreground {
    pub process_id: Option<u32>,
    pub client_process_id: Option<u32>,
}

/// ForegroundProcess
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Process {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub exe: Option<String>,
    pub cwd: Option<String>,
    pub environ: Option<HashMap<String, String>>,
}

impl Process {
    fn app_image_path(&self) -> Option<&str> {
        self.environ
            .as_ref()
            .and_then(|env| env.get("APPIMAGE"))
            .map(String::as_str)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Windows,
    Linux,
}

impl Platform {
    pub fn current() -> Platform {
        if cfg!(windows) {
            Platform::Windows
        } else {
            Platform::Linux
        }
    }
}

/// ForegroundGameMatchInput
pub struct MatchInput<'a> {
    pub platform: Platform,
    pub targets: &'a [GameTarget],
    pub foreground: Foreground,
    pub processes: &'a [Process],
    /// The NSpid chain of a host pid (/proc/<pid>/status), for sandboxed games.
    pub namespaced_pids: Option<&'a dyn Fn(u32) -> Option<Vec<u32>>>,
}

fn collect_descendants(processes: &[Process], root: u32) -> HashSet<u32> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for process in processes {
        if let Some(parent) = process.parent_pid {
            children.entry(parent).or_default().push(process.pid);
        }
    }
    let mut descendants = HashSet::from([root]);
    let mut queue = VecDeque::from([root]);
    while let Some(current) = queue.pop_front() {
        for child in children.get(&current).into_iter().flatten() {
            if descendants.insert(*child) {
                queue.push_back(*child);
            }
        }
    }
    descendants
}

fn innermost_namespaced_pid(pids: Option<Vec<u32>>) -> Option<u32> {
    pids.filter(|pids| pids.len() > 1)
        .and_then(|pids| pids.last().copied())
}

/// matchesSandboxedWindowProcess: exactly one host process whose innermost
/// namespaced pid is the window's pid, inside the launched process tree.
pub fn matches_sandboxed_window_process(
    processes: &[Process],
    window_process_id: u32,
    launched_process_id: Option<u32>,
    namespaced_pids: &dyn Fn(u32) -> Option<Vec<u32>>,
) -> bool {
    let Some(launched) = launched_process_id else {
        return false;
    };
    let descendants = collect_descendants(processes, launched);
    let owners: Vec<u32> = processes
        .iter()
        .filter(|p| innermost_namespaced_pid(namespaced_pids(p.pid)) == Some(window_process_id))
        .map(|p| p.pid)
        .collect();
    owners.len() == 1 && descendants.contains(&owners[0])
}

/// normalizeWindowsExecutablePath
fn normalize_windows_path(value: &str) -> String {
    let trimmed = value.trim();
    let trimmed = trimmed.strip_prefix("\\\\?\\").unwrap_or(trimmed);
    let mut out = String::with_capacity(trimmed.len());
    let mut last_slash = false;
    for character in trimmed.chars() {
        let character = if character == '\\' { '/' } else { character };
        if character == '/' {
            if last_slash {
                continue;
            }
            last_slash = true;
        } else {
            last_slash = false;
        }
        out.push(character);
    }
    out.to_lowercase()
}

/// isWindowsGameForegroundProcess: walk up from the foreground process to
/// the launched process or a process running one of the game's executables.
pub fn is_windows_game_foreground_process(
    processes: &[Process],
    foreground_process_id: u32,
    launched_process_id: Option<u32>,
    executable_paths: &[String],
) -> bool {
    let by_pid: HashMap<u32, &Process> = processes.iter().map(|p| (p.pid, p)).collect();
    let executables: HashSet<String> = executable_paths
        .iter()
        .map(|path| normalize_windows_path(path))
        .collect();
    let mut visited = HashSet::new();
    let mut current = Some(foreground_process_id);
    while let Some(pid) = current {
        if !visited.insert(pid) {
            break;
        }
        if Some(pid) == launched_process_id {
            return true;
        }
        let Some(process) = by_pid.get(&pid) else {
            return false;
        };
        if process.exe.as_deref().is_some_and(|exe| {
            !exe.is_empty() && executables.contains(&normalize_windows_path(exe))
        }) {
            return true;
        }
        current = process.parent_pid;
    }
    false
}

fn lower(value: Option<&str>) -> String {
    value.unwrap_or_default().to_lowercase()
}

/// processReferencesExecutable: the process runs from the game's folder or
/// is the executable (or its AppImage).
pub fn process_references_executable(process: &Process, executable_path: &str) -> bool {
    let target = executable_path.to_lowercase();
    // path.dirname: "." for a bare file name
    let directory = Path::new(executable_path)
        .parent()
        .map(|p| p.to_string_lossy().to_lowercase())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| ".".into());
    lower(process.cwd.as_deref()) == directory
        || lower(process.exe.as_deref()) == target
        || lower(process.app_image_path()) == target
}

fn normalized_lower(path: &str) -> String {
    normalize(Path::new(path)).to_string_lossy().to_lowercase()
}

/// doesSteamCompatDataPathMatchWinePrefix
fn steam_compat_matches_prefix(compat: Option<&str>, prefix: Option<&str>) -> bool {
    let (Some(compat), Some(prefix)) = (
        compat.filter(|c| !c.is_empty()),
        prefix.filter(|p| !p.is_empty()),
    ) else {
        return false;
    };
    let compat = normalized_lower(compat);
    let prefix = normalized_lower(prefix);
    compat == prefix || Path::new(&compat).join("pfx").to_string_lossy() == prefix
}

fn process_matches_wine_prefix(process: &Process, prefix: Option<&str>) -> bool {
    let Some(prefix) = prefix.filter(|p| !p.is_empty()) else {
        return false;
    };
    let env = process.environ.as_ref();
    let wine_prefix = env
        .and_then(|e| e.get("WINEPREFIX"))
        .filter(|v| !v.is_empty());
    let compat = env.and_then(|e| e.get("STEAM_COMPAT_DATA_PATH"));
    wine_prefix.is_some_and(|value| normalized_lower(value) == normalized_lower(prefix))
        || steam_compat_matches_prefix(compat.map(String::as_str), Some(prefix))
}

/// isLinuxGameWindowProcess
pub fn is_linux_game_window_process(
    processes: &[Process],
    active_process_id: u32,
    launched_process_id: Option<u32>,
    executable_paths: &[String],
    wine_prefix_path: Option<&str>,
) -> bool {
    let by_pid: HashMap<u32, &Process> = processes.iter().map(|p| (p.pid, p)).collect();
    let mut visited = HashSet::new();
    let mut current = Some(active_process_id).filter(|pid| *pid != 0);
    while let Some(pid) = current {
        if !visited.insert(pid) {
            break;
        }
        if Some(pid) == launched_process_id {
            return true;
        }
        let Some(process) = by_pid.get(&pid) else {
            return false;
        };
        if executable_paths
            .iter()
            .any(|path| process_references_executable(process, path))
            || process_matches_wine_prefix(process, wine_prefix_path)
        {
            return true;
        }
        current = process.parent_pid.filter(|pid| *pid != 0);
    }
    false
}

fn matches_windows_target(input: &MatchInput, target: &GameTarget) -> bool {
    input.foreground.process_id.is_some_and(|pid| {
        is_windows_game_foreground_process(
            input.processes,
            pid,
            target.process_id,
            &target.executable_paths,
        )
    })
}

fn matches_linux_pid(input: &MatchInput, target: &GameTarget, pid: Option<u32>) -> bool {
    pid.is_some_and(|pid| {
        is_linux_game_window_process(
            input.processes,
            pid,
            target.process_id,
            &target.executable_paths,
            target.wine_prefix_path.as_deref(),
        )
    })
}

fn matches_linux_target(input: &MatchInput, target: &GameTarget) -> bool {
    let foreground = input.foreground;
    if matches_linux_pid(input, target, foreground.process_id)
        || matches_linux_pid(input, target, foreground.client_process_id)
    {
        return true;
    }
    if foreground.client_process_id.is_none() {
        if let (Some(pid), Some(lookup)) = (foreground.process_id, input.namespaced_pids) {
            return matches_sandboxed_window_process(
                input.processes,
                pid,
                target.process_id,
                lookup,
            );
        }
    }
    false
}

fn owns_foreground_process(input: &MatchInput, target: &GameTarget) -> bool {
    let owner = input
        .foreground
        .client_process_id
        .or(input.foreground.process_id);
    match (owner, target.process_id) {
        (Some(owner), Some(launched)) => {
            collect_descendants(input.processes, launched).contains(&owner)
        }
        _ => false,
    }
}

/// findSoleLaunchedTarget: the only target, or the only one Hydra launched.
pub fn find_sole_launched_target(targets: &[GameTarget]) -> Option<usize> {
    if targets.len() == 1 {
        return Some(0);
    }
    let launched: Vec<usize> = targets
        .iter()
        .enumerate()
        .filter(|(_, t)| t.process_id.is_some())
        .map(|(i, _)| i)
        .collect();
    (launched.len() == 1).then(|| launched[0])
}

/// isLaunchedForegroundProcess
pub fn is_launched_foreground_process(target: &GameTarget, foreground: Foreground) -> bool {
    target.process_id.is_some_and(|pid| {
        foreground.process_id == Some(pid) || foreground.client_process_id == Some(pid)
    })
}

/// findForegroundGameTarget: the index of the matching target.
pub fn find_foreground_target(input: &MatchInput) -> Option<usize> {
    let matches = |target: &GameTarget| match input.platform {
        Platform::Windows => matches_windows_target(input, target),
        Platform::Linux => matches_linux_target(input, target),
    };
    let candidates: Vec<usize> = input
        .targets
        .iter()
        .enumerate()
        .filter(|(_, target)| matches(target))
        .map(|(i, _)| i)
        .collect();
    if candidates.len() <= 1 {
        return candidates.first().copied();
    }
    let owners: Vec<usize> = candidates
        .iter()
        .copied()
        .filter(|i| owns_foreground_process(input, &input.targets[*i]))
        .collect();
    if !owners.is_empty() {
        return (owners.len() == 1).then(|| owners[0]);
    }
    let subset: Vec<GameTarget> = candidates
        .iter()
        .map(|i| input.targets[*i].clone())
        .collect();
    find_sole_launched_target(&subset).map(|i| candidates[i])
}

/// parseNamespacedPids: the NSpid line of /proc/<pid>/status.
pub fn parse_namespaced_pids(status: &str) -> Option<Vec<u32>> {
    let line = status.lines().find(|line| line.starts_with("NSpid:"))?;
    let pids: Vec<u32> = line["NSpid:".len()..]
        .split_whitespace()
        .filter_map(|value| value.parse::<u32>().ok())
        .filter(|pid| *pid > 0)
        .collect();
    (!pids.is_empty()).then_some(pids)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(key: &str, process_id: Option<u32>, executables: &[&str]) -> GameTarget {
        GameTarget {
            game_key: key.into(),
            shop: "steam".into(),
            object_id: key.into(),
            title: key.into(),
            process_id,
            executable_paths: executables.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }
    }

    fn process(pid: u32, parent: Option<u32>, exe: Option<&str>) -> Process {
        Process {
            pid,
            parent_pid: parent,
            exe: exe.map(str::to_string),
            ..Default::default()
        }
    }

    fn processes() -> Vec<Process> {
        vec![
            process(1, None, None),
            process(100, Some(1), None),
            process(101, Some(100), None),
            process(200, Some(1), None),
            process(300, Some(200), None),
            process(400, Some(1), Some("/games/other/other.x86_64")),
            process(500, Some(1), None),
        ]
    }

    fn namespaced(pid: u32) -> Option<Vec<u32>> {
        match pid {
            300 => Some(vec![300, 5]),
            500 => Some(vec![500, 9]),
            _ => None,
        }
    }

    fn fg(process_id: Option<u32>, client: Option<u32>) -> Foreground {
        Foreground {
            process_id,
            client_process_id: client,
        }
    }

    fn linux(
        targets: &[GameTarget],
        processes: &[Process],
        foreground: Foreground,
        lookup: bool,
    ) -> Option<String> {
        let input = MatchInput {
            platform: Platform::Linux,
            targets,
            foreground,
            processes,
            namespaced_pids: lookup.then_some(&namespaced as &dyn Fn(u32) -> Option<Vec<u32>>),
        };
        find_foreground_target(&input).map(|i| targets[i].game_key.clone())
    }

    fn ab() -> Vec<GameTarget> {
        vec![target("a", Some(100), &[]), target("b", Some(200), &[])]
    }

    // foreground-game-match.test.ts
    #[test]
    fn linux_matches() {
        let p = processes();
        assert_eq!(
            linux(&ab(), &p, fg(Some(101), None), false).as_deref(),
            Some("a")
        );
        assert_eq!(
            linux(&ab(), &p, fg(Some(999), Some(300)), false).as_deref(),
            Some("b")
        );
        let other = vec![
            target("a", Some(100), &[]),
            target("other", None, &["/games/other/other.x86_64"]),
        ];
        assert_eq!(
            linux(&other, &p, fg(Some(400), None), false).as_deref(),
            Some("other")
        );
        assert_eq!(linux(&ab(), &p, fg(Some(5), None), false), None);
        assert_eq!(
            linux(&ab(), &p, fg(Some(5), None), true).as_deref(),
            Some("b")
        );
        assert_eq!(linux(&ab(), &p, fg(Some(5), Some(999)), true), None);
        assert_eq!(linux(&ab(), &p, fg(Some(500), None), true), None);
    }

    #[test]
    fn linux_prefers_the_owning_tree_then_the_launched_target() {
        let shared = "/games/shared/game.x86_64";
        let mut p = processes();
        p.push(process(301, Some(200), Some(shared)));
        let targets = vec![
            target("a", Some(100), &[shared]),
            target("b", Some(200), &[shared]),
        ];
        assert_eq!(
            linux(&targets, &p, fg(Some(301), None), false).as_deref(),
            Some("b")
        );

        let mut p = processes();
        p.push(process(600, Some(1), Some(shared)));
        let targets = vec![
            target("launched", Some(100), &[shared]),
            target("detected", None, &[shared]),
        ];
        assert_eq!(
            linux(&targets, &p, fg(Some(600), None), false).as_deref(),
            Some("launched")
        );
    }

    #[test]
    fn sandboxed_window_process() {
        let p = processes();
        assert!(matches_sandboxed_window_process(
            &p,
            5,
            Some(200),
            &namespaced
        ));
        assert!(!matches_sandboxed_window_process(
            &p,
            9,
            Some(200),
            &namespaced
        ));
        let ambiguous = |pid: u32| {
            if pid == 101 {
                Some(vec![101, 5])
            } else {
                namespaced(pid)
            }
        };
        assert!(!matches_sandboxed_window_process(
            &p,
            5,
            Some(200),
            &ambiguous
        ));
        assert!(!matches_sandboxed_window_process(
            &p,
            300,
            Some(200),
            &namespaced
        ));
        assert!(!matches_sandboxed_window_process(&p, 5, None, &namespaced));
    }

    #[test]
    fn windows_matches_by_ancestry_or_executable() {
        let mut p = processes();
        p.push(process(700, Some(1), Some("c:/games/detected/game.exe")));
        let targets = vec![
            target("launched", Some(100), &[]),
            target("detected", None, &["C:\\Games\\Detected\\Game.exe"]),
        ];
        let run = |foreground| {
            let input = MatchInput {
                platform: Platform::Windows,
                targets: &targets,
                foreground,
                processes: &p,
                namespaced_pids: None,
            };
            find_foreground_target(&input).map(|i| targets[i].game_key.clone())
        };
        assert_eq!(run(fg(Some(101), None)).as_deref(), Some("launched"));
        assert_eq!(run(fg(Some(700), None)).as_deref(), Some("detected"));
        assert_eq!(run(fg(None, None)), None);
        assert!(is_windows_game_foreground_process(
            &[process(9, None, Some("\\\\?\\C:\\\\Games\\Game.EXE"))],
            9,
            None,
            &["c:/games/game.exe".into()]
        ));
    }

    #[test]
    fn helpers() {
        let launched = target("launched", Some(100), &[]);
        let detected = target("detected", None, &[]);
        assert_eq!(find_sole_launched_target(&[detected.clone()]), Some(0));
        assert_eq!(
            find_sole_launched_target(&[launched.clone(), detected.clone()]),
            Some(0)
        );
        assert_eq!(
            find_sole_launched_target(&[launched.clone(), target("b", Some(200), &[])]),
            None
        );
        assert_eq!(
            find_sole_launched_target(&[detected.clone(), target("c", None, &[])]),
            None
        );

        assert!(is_launched_foreground_process(
            &launched,
            fg(Some(100), None)
        ));
        assert!(is_launched_foreground_process(
            &launched,
            fg(Some(1), Some(100))
        ));
        assert!(!is_launched_foreground_process(
            &launched,
            fg(Some(101), None)
        ));
        assert!(!is_launched_foreground_process(
            &detected,
            fg(Some(100), None)
        ));

        assert_eq!(
            parse_namespaced_pids("Name:\tgame\nNSpid:\t4321\t12\t2\nVmRSS:\t1 kB\n"),
            Some(vec![4321, 12, 2])
        );
        assert_eq!(parse_namespaced_pids("NSpid:\t4321\n"), Some(vec![4321]));
        assert_eq!(parse_namespaced_pids("Name:\tgame\n"), None);
        assert_eq!(parse_namespaced_pids("NSpid:\t\n"), None);
    }

    #[test]
    fn wine_prefix_matches() {
        let mut env = HashMap::new();
        env.insert(
            "STEAM_COMPAT_DATA_PATH".to_string(),
            "/compat/123".to_string(),
        );
        let p = vec![Process {
            pid: 50,
            environ: Some(env),
            ..Default::default()
        }];
        assert!(is_linux_game_window_process(
            &p,
            50,
            None,
            &[],
            Some("/compat/123/pfx")
        ));
        assert!(!is_linux_game_window_process(
            &p,
            50,
            None,
            &[],
            Some("/compat/999")
        ));
    }
}
