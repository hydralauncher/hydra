//! services/umu.ts, umu-output-monitor.ts and umu-launch-monitor.ts: running
//! Windows games on Linux through umu-launcher (umu-run), which downloads the
//! Steam Linux Runtime and UMU-Proton on first use and runs the game in a
//! Proton prefix.
//!
//! The game launcher window (pages/game-launcher), which shows umu's setup
//! progress, isn't ported yet: progress lines are parsed but only failures
//! are reported (as the launch error and in the log).

use std::path::{Path, PathBuf};

pub use crate::umu_updater::BUNDLED_VERSION;

// ---- umu-output-monitor.ts ------------------------------------------------

/// UmuOutputEvent
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OutputEvent {
    Progress(String),
    Error(String),
    Fatal(String),
}

const PROGRESS_PREFIXES: [&str; 7] = [
    "Setting up Unified Launcher",
    "Downloading ",
    "Extracting ",
    "Verifying integrity of ",
    "Updating ",
    "Restoring Runtime Platform",
    "Found '",
];

/// ANSI_ESCAPE_PATTERN: \x1b[...m colors
fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(start) = rest.find('\u{1b}') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        if let Some(sequence) = after.strip_prefix('[') {
            let end = sequence
                .find(|c: char| !(c.is_ascii_digit() || c == ';'))
                .unwrap_or(sequence.len());
            if sequence[end..].starts_with('m') {
                rest = &sequence[end + 1..];
                continue;
            }
        }
        out.push('\u{1b}');
        rest = after;
    }
    out.push_str(rest);
    out
}

/// cleanProgressMessage: trailing dots and ", please wait" removed.
fn clean_progress(message: &str) -> String {
    let mut cleaned = message.trim_end_matches('.').to_string();
    if cleaned.to_lowercase().ends_with("please wait") {
        cleaned.truncate(cleaned.len() - "please wait".len());
        cleaned = cleaned.trim_end().to_string();
        if let Some(stripped) = cleaned.strip_suffix(',') {
            cleaned = stripped.to_string();
        }
    }
    cleaned.trim_end().to_string()
}

/// `^name:\s*(\S.*)$` with the message after the colon.
fn after_colon(line: &str) -> Option<(&str, &str)> {
    let (head, rest) = line.split_once(':')?;
    let message = rest.trim_start();
    (!message.is_empty()).then_some((head, message))
}

/// parseUmuOutputLine
pub fn parse_line(raw: &str) -> Option<OutputEvent> {
    let line = strip_ansi(raw);
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    // PRESSURE_VESSEL_ERROR_PATTERN: pv-<tool>[pid]: E: message
    if let Some(rest) = line.strip_prefix("pv-")
        && let Some(bracket) = rest.find('[')
        && rest[..bracket]
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
        && bracket > 0
        && let Some(close) = rest[bracket..].find("]:")
        && rest[bracket + 1..bracket + close]
            .chars()
            .all(|c| c.is_ascii_digit())
        && close > 1
    {
        let after = &rest[bracket + close + 2..];
        if after.starts_with(char::is_whitespace)
            && let Some(message) = after.trim_start().strip_prefix("E:")
        {
            let message = message.trim_start();
            if !message.is_empty() {
                return Some(OutputEvent::Fatal(message.to_string()));
            }
        }
    }
    let (head, message) = after_colon(line)?;
    // EXCEPTION_LINE_PATTERN: ([A-Z]\w*): message, named ...Error or ...Exception
    if head.starts_with(|c: char| c.is_ascii_uppercase())
        && head.chars().all(|c| c.is_alphanumeric() || c == '_')
        && (head.ends_with("Error") || head.ends_with("Exception"))
    {
        return Some(OutputEvent::Fatal(format!("{head}: {message}")));
    }
    // LOG_LINE_PATTERN
    match head {
        "ERROR" | "CRITICAL" => Some(OutputEvent::Error(message.to_string())),
        "INFO" if PROGRESS_PREFIXES.iter().any(|p| message.starts_with(p)) => {
            Some(OutputEvent::Progress(clean_progress(message)))
        }
        _ => None,
    }
}

/// UmuOutputMonitor: lines split across chunks, the last error, the fatal one.
#[derive(Default)]
pub struct OutputMonitor {
    buffer: String,
    last_error: Option<String>,
    fatal: Option<String>,
}

impl OutputMonitor {
    pub fn feed(&mut self, chunk: &str) -> Vec<OutputEvent> {
        self.buffer.push_str(chunk);
        let mut lines: Vec<String> = self
            .buffer
            .split('\n')
            .map(|l| l.trim_end_matches('\r').to_string())
            .collect();
        self.buffer = lines.pop().unwrap_or_default();
        self.parse(lines)
    }

    pub fn flush(&mut self) -> Vec<OutputEvent> {
        let remaining = std::mem::take(&mut self.buffer);
        self.parse(vec![remaining])
    }

    pub fn failure_message(&self) -> Option<&str> {
        self.fatal.as_deref().or(self.last_error.as_deref())
    }

    pub fn has_fatal_error(&self) -> bool {
        self.fatal.is_some()
    }

    fn parse(&mut self, lines: Vec<String>) -> Vec<OutputEvent> {
        let mut events = Vec::new();
        for line in lines {
            let Some(event) = parse_line(&line) else {
                continue;
            };
            match &event {
                OutputEvent::Error(m) => self.last_error = Some(m.clone()),
                OutputEvent::Fatal(m) => self.fatal = Some(m.clone()),
                OutputEvent::Progress(_) => {}
            }
            events.push(event);
        }
        events
    }
}

/// getUmuSetupFailureMessage
pub fn setup_failure_message(
    exit_code: Option<i32>,
    signal: Option<&str>,
    failure: Option<&str>,
    has_fatal_error: bool,
    game_detected: bool,
) -> Option<String> {
    if game_detected {
        return (exit_code != Some(0) && has_fatal_error)
            .then(|| failure.map(str::to_string))
            .flatten();
    }
    if has_fatal_error && let Some(failure) = failure {
        return Some(failure.to_string());
    }
    if exit_code == Some(0) {
        return None;
    }
    if let Some(failure) = failure {
        return Some(failure.to_string());
    }
    Some(match signal {
        Some(signal) => format!("umu-run was terminated by {signal}"),
        None => format!(
            "umu-run exited with code {}",
            exit_code.map_or("null".to_string(), |c| c.to_string())
        ),
    })
}

// ---- umu.ts ---------------------------------------------------------------

/// `<userData>/logs` (`logs-staging` against the staging API), like logsPath.
pub fn logs_dir() -> Option<PathBuf> {
    let user_data = hydra_db::paths::native_user_data()?;
    let staging = hydra_core::config::api_url().contains("staging");
    Some(user_data.join(if staging { "logs-staging" } else { "logs" }))
}

fn shared_log(logs: &Path) -> PathBuf {
    logs.join("umu.log")
}

/// getUmuLogPath: one log per game.
pub fn log_path(logs: &Path, game_id: Option<&str>) -> PathBuf {
    match game_id {
        Some(id) => {
            let safe: String = id
                .chars()
                .map(|c| {
                    if c.is_alphanumeric() || c == '_' || c == '.' || c == '-' {
                        c
                    } else {
                        '_'
                    }
                })
                .collect();
            logs.join(format!("umu-{safe}.log"))
        }
        None => shared_log(logs),
    }
}

#[cfg(unix)]
fn append(path: &Path, text: &str) {
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = file.write_all(text.as_bytes());
    }
}

/// appendUmuLogHeader: the game's log, plus a pointer in the shared one.
#[cfg(unix)]
fn append_header(logs: &Path, log: &Path, header: &str) {
    append(log, header);
    let shared = shared_log(logs);
    if log != shared {
        append(
            &shared,
            &format!(
                "{}\nOutput: {}\n",
                header.trim_end(),
                log.file_name().unwrap_or_default().to_string_lossy()
            ),
        );
    }
}

/// The umu-run Hydra ships: next to the executable in a package, else the
/// repository's `binaries/umu/umu-run` (getBundledUmuBinaryPath).
pub fn bundled_binary() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.join("umu-run")))
        .filter(|p| p.exists())
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../binaries/umu/umu-run")
        })
}

/// getUmuBinaryPath: a newer managed copy (umu updater), else the bundled one.
pub fn binary() -> PathBuf {
    crate::umu_updater::managed_binary().unwrap_or_else(bundled_binary)
}

/// getCompatiblePythonPath: umu-run is a Python zipapp that needs 3.10+.
pub fn compatible_python() -> Option<String> {
    let mut candidates: Vec<String> = Vec::new();
    for candidate in [
        std::env::var("HYDRA_UMU_PYTHON").ok(),
        Some("/usr/bin/python3".into()),
        Some("python3".into()),
    ]
    .into_iter()
    .flatten()
    {
        if !candidate.is_empty() && !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
    candidates.into_iter().find(|candidate| {
        let Ok(output) = std::process::Command::new(candidate)
            .args([
                "-c",
                "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')",
            ])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
        else {
            return false;
        };
        if !output.status.success() {
            return false;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let mut parts = text.trim().split('.');
        let (Some(major), Some(minor), None) = (parts.next(), parts.next(), parts.next()) else {
            return false;
        };
        match (major.parse::<u32>(), minor.parse::<u32>()) {
            (Ok(major), Ok(minor)) => major > 3 || (major == 3 && minor >= 10),
            _ => false,
        }
    })
}

/// ensureExecutablePermission for umu-run: 0755 when no execute bit is set.
#[cfg(unix)]
fn ensure_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(path)
        && meta.permissions().mode() & 0o111 == 0
    {
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
    }
}

/// isValidProtonDirectory
pub fn is_valid_proton_path(path: &Path) -> bool {
    path.join("proton").exists() && path.join("toolmanifest.vdf").exists()
}

/// shellQuote, for the command line written to the log.
#[cfg(unix)]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Umu.launchExecutable options
#[derive(Clone, Debug, Default)]
pub struct LaunchOptions {
    pub wine_prefix: Option<PathBuf>,
    pub proton_path: Option<PathBuf>,
    pub game_id: Option<String>,
    pub launch_options: Option<String>,
    pub use_mangohud: bool,
    pub use_gamemode: bool,
}

/// QUICK_EXIT_THRESHOLD_MS: umu-run exiting sooner than this failed to start.
pub const QUICK_EXIT_MS: u64 = 3000;

#[cfg(unix)]
fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// The output umu-run wrote to its log since `offset`, run through the monitor.
#[cfg(unix)]
fn monitor_from(log: &Path, offset: u64) -> OutputMonitor {
    use std::io::{Read, Seek, SeekFrom};
    let mut monitor = OutputMonitor::default();
    if let Ok(mut file) = std::fs::File::open(log)
        && file.seek(SeekFrom::Start(offset)).is_ok()
    {
        let mut bytes = Vec::new();
        let _ = file.take(8 * 1024 * 1024).read_to_end(&mut bytes);
        monitor.feed(&String::from_utf8_lossy(&bytes));
        monitor.flush();
    }
    monitor
}

#[cfg(unix)]
fn exit_parts(status: std::process::ExitStatus) -> (Option<i32>, Option<String>) {
    use std::os::unix::process::ExitStatusExt;
    (
        status.code(),
        status.signal().map(|s| match s {
            9 => "SIGKILL".to_string(),
            15 => "SIGTERM".to_string(),
            6 => "SIGABRT".to_string(),
            11 => "SIGSEGV".to_string(),
            2 => "SIGINT".to_string(),
            other => format!("signal {other}"),
        }),
    )
}

/// Umu.launchExecutable: start the game through umu-run with its output in
/// the game's umu log. Ok(pid) once umu-run has kept running for 3 seconds
/// (observeUmuLaunch); an earlier exit is the launch failure, with the
/// reason umu printed.
#[cfg(unix)]
pub fn launch_executable(executable: &str, options: &LaunchOptions) -> Result<u32, String> {
    use std::collections::BTreeMap;
    use std::process::{Command, Stdio};
    use std::time::Duration;

    let logs = logs_dir().ok_or("no user data folder")?;
    let log = log_path(&logs, options.game_id.as_deref());
    let umu = binary();
    let python = compatible_python();
    let umu_text = umu.to_string_lossy().to_string();
    let (base, base_args) = match &python {
        Some(python) => (
            python.clone(),
            vec![umu_text.clone(), executable.to_string()],
        ),
        None => (umu_text.clone(), vec![executable.to_string()]),
    };
    let wrappers: Vec<String> = if options.use_gamemode {
        vec!["gamemoderun".into()]
    } else {
        Vec::new()
    };
    let resolved = crate::args::resolve_launch_command(
        &base,
        &base_args,
        options.launch_options.as_deref(),
        &wrappers,
    );
    let _ = std::fs::create_dir_all(&logs);
    ensure_executable(&umu);

    let mut env: BTreeMap<String, String> = BTreeMap::new();
    env.insert("PROTON_LOG".into(), "1".into());
    if let Some(id) = &options.game_id {
        env.insert("GAMEID".into(), format!("umu-{id}"));
    }
    if let Some(prefix) = &options.wine_prefix {
        env.insert("WINEPREFIX".into(), prefix.to_string_lossy().into());
    }
    if let Some(proton) = &options.proton_path {
        env.insert("PROTONPATH".into(), proton.to_string_lossy().into());
    }
    if options.use_mangohud {
        env.insert("MANGOHUD".into(), "1".into());
    }
    env.extend(resolved.env.clone());

    let command_line = format!(
        "{} {}{}",
        env.iter()
            .map(|(k, v)| format!("{k}={}", shell_quote(v)))
            .collect::<Vec<_>>()
            .join(" "),
        shell_quote(&resolved.command),
        if resolved.args.is_empty() {
            String::new()
        } else {
            format!(
                " {}",
                resolved
                    .args
                    .iter()
                    .map(|a| shell_quote(a))
                    .collect::<Vec<_>>()
                    .join(" ")
            )
        }
    );
    append_header(
        &logs,
        &log,
        &format!(
            "\n[{}] Launching with umu-run\nCommand: {command_line}\n",
            hydra_core::library_actions::now_iso()
        ),
    );
    eprintln!(
        "Launching game with umu-run: {command_line} (log {})",
        log.display()
    );

    let offset = file_size(&log);
    let output = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log)
        .map_err(|e| format!("umu log: {e}"))?;
    let errors = output.try_clone().map_err(|e| format!("umu log: {e}"))?;
    let working_directory = Path::new(executable)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    let mut command = Command::new(&resolved.command);
    command
        .args(&resolved.args)
        .envs(&env)
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::from(output))
        .stderr(Stdio::from(errors));
    crate::detach(&mut command);
    let mut child = command.spawn().map_err(|e| {
        let message = format!("Failed to spawn umu-run ({}): {e}", resolved.command);
        append(
            &log,
            &format!("[{}] {message}\n", hydra_core::library_actions::now_iso()),
        );
        message
    })?;
    let pid = child.id();

    // observeUmuLaunch: an exit within the threshold is a failed launch.
    let deadline = std::time::Instant::now() + Duration::from_millis(QUICK_EXIT_MS);
    while std::time::Instant::now() < deadline {
        if let Ok(Some(status)) = child.try_wait() {
            let (code, signal) = exit_parts(status);
            let monitor = monitor_from(&log, offset);
            let message = format!(
                "umu-run exited early with code={} signal={}{}",
                code.map_or("null".into(), |c| c.to_string()),
                signal.as_deref().unwrap_or("null"),
                monitor
                    .failure_message()
                    .map(|m| format!(": {m}"))
                    .unwrap_or_default()
            );
            append(
                &log,
                &format!("[{}] {message}\n", hydra_core::library_actions::now_iso()),
            );
            return Err(message);
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    // Still running: watch for a late failure (setup that died after the
    // threshold) and reap the process when it ends.
    let log_for_exit = log.clone();
    std::thread::Builder::new()
        .name("umu-run".into())
        .spawn(move || {
            let Ok(status) = child.wait() else { return };
            let (code, signal) = exit_parts(status);
            let monitor = monitor_from(&log_for_exit, offset);
            // TODO(launch): the game launcher window's wasGameLauncherGameDetected.
            if let Some(message) = setup_failure_message(
                code,
                signal.as_deref(),
                monitor.failure_message(),
                monitor.has_fatal_error(),
                false,
            ) {
                eprintln!(
                    "umu-run failed after the game launch started: {message} (log {})",
                    log_for_exit.display()
                );
            }
        })
        .ok();
    Ok(pid)
}

// ---- getInstalledProtonVersions -------------------------------------------

/// ProtonVersion
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProtonVersion {
    pub name: String,
    pub path: PathBuf,
    /// "steam" | "compatibility_tools"
    pub source: &'static str,
}

/// STEAM_ROOT_SEGMENTS
fn steam_roots(home: &Path) -> Vec<PathBuf> {
    [
        ".steam/steam",
        ".local/share/Steam",
        ".var/app/com.valvesoftware.Steam/.local/share/Steam",
        ".var/app/com.valvesoftware.Steam/data/Steam",
        "snap/steam/common/.local/share/Steam",
    ]
    .iter()
    .map(|segments| home.join(segments))
    .collect()
}

/// parseLibraryFolderPaths: the "path" values of steamapps/libraryfolders.vdf.
pub fn library_folder_paths(vdf: &str) -> Vec<String> {
    vdf.lines()
        .filter_map(|line| {
            let line = line.trim();
            let rest = line.strip_prefix("\"path\"")?.trim();
            let value = rest.strip_prefix('"')?.strip_suffix('"')?;
            Some(value.replace("\\\\", "\\"))
        })
        .collect()
}

/// getSteamLibraryFolders on Linux: the first Steam root with a
/// libraryfolders.vdf, plus its libraries.
fn steam_library_folders(home: &Path) -> Vec<PathBuf> {
    for root in steam_roots(home) {
        if !root.exists() {
            continue;
        }
        for manifest in ["steamapps/libraryfolders.vdf", "config/libraryfolders.vdf"] {
            let Ok(text) = std::fs::read_to_string(root.join(manifest)) else {
                continue;
            };
            let mut folders = vec![root.clone()];
            for path in library_folder_paths(&text) {
                let path = PathBuf::from(path);
                if !folders.contains(&path) {
                    folders.push(path);
                }
            }
            return folders;
        }
        return vec![root];
    }
    Vec::new()
}

fn proton_dirs(parent: &Path, name_filter: impl Fn(&str) -> bool) -> Vec<(PathBuf, String)> {
    let Ok(entries) = std::fs::read_dir(parent) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            (name_filter(&name) && is_valid_proton_path(&e.path())).then(|| (e.path(), name))
        })
        .collect()
}

/// flatpak-compatibility-tools.ts: Steam compatibility tools installed as
/// Flatpak extensions (com.valvesoftware.Steam.CompatibilityTool.*).
fn flatpak_tools(home: &Path) -> Vec<(PathBuf, String)> {
    const PREFIX: &str = "com.valvesoftware.Steam.CompatibilityTool.";
    let dirs = |p: &Path| -> Vec<String> {
        std::fs::read_dir(p)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut tools = Vec::new();
    for installation in [
        PathBuf::from("/var/lib/flatpak"),
        home.join(".local/share/flatpak"),
    ] {
        let runtime = installation.join("runtime");
        for extension in dirs(&runtime).into_iter().filter(|e| e.starts_with(PREFIX)) {
            let extension_root = runtime.join(&extension);
            for arch in dirs(&extension_root) {
                for branch in dirs(&extension_root.join(&arch)) {
                    let tool = extension_root
                        .join(&arch)
                        .join(&branch)
                        .join("active/files");
                    if !is_valid_proton_path(&tool) {
                        continue;
                    }
                    let Ok(real) = tool.canonicalize() else {
                        continue;
                    };
                    let display = std::fs::read_to_string(real.join("compatibilitytool.vdf"))
                        .ok()
                        .and_then(|text| {
                            let at = text.find("\"display_name\"")?;
                            let rest = text[at + 14..].trim_start().strip_prefix('"')?;
                            Some(rest[..rest.find('"')?].trim().to_string())
                        })
                        .filter(|n| !n.is_empty());
                    let branch_label = if branch == "stable" {
                        String::new()
                    } else {
                        format!(" {branch}")
                    };
                    let name = display.unwrap_or_else(|| {
                        format!("{} (Flatpak{branch_label})", &extension[PREFIX.len()..])
                    });
                    tools.push((real, name));
                }
            }
        }
    }
    tools
}

/// Umu.getInstalledProtonVersions: Proton in Steam libraries, custom tools in
/// compatibilitytools.d, and Flatpak tools; unique by real path, by name.
pub fn installed_proton_versions(home: &Path) -> Vec<ProtonVersion> {
    let mut versions: Vec<ProtonVersion> = Vec::new();
    let mut commons: Vec<PathBuf> = Vec::new();
    for root in steam_roots(home)
        .into_iter()
        .chain(steam_library_folders(home))
    {
        let common = root.join("steamapps/common");
        if !commons.contains(&common) {
            commons.push(common);
        }
    }
    for common in commons {
        for (path, _) in proton_dirs(&common, |name| name.starts_with("Proton")) {
            if let Ok(real) = path.canonicalize() {
                versions.push(ProtonVersion {
                    name: real
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into(),
                    path: real,
                    source: "steam",
                });
            }
        }
    }
    let tool_dirs = steam_roots(home)
        .into_iter()
        .map(|root| root.join("compatibilitytools.d"))
        .chain(std::iter::once(PathBuf::from(
            "/usr/share/steam/compatibilitytools.d",
        )));
    for dir in tool_dirs {
        for (path, _) in proton_dirs(&dir, |_| true) {
            if let Ok(real) = path.canonicalize() {
                versions.push(ProtonVersion {
                    name: real
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into(),
                    path: real,
                    source: "compatibility_tools",
                });
            }
        }
    }
    for (path, name) in flatpak_tools(home) {
        versions.push(ProtonVersion {
            name,
            path,
            source: "compatibility_tools",
        });
    }
    // uniqueVersions by path (the last one wins), sorted by name
    let mut unique: Vec<ProtonVersion> = Vec::new();
    for version in versions {
        if let Some(existing) = unique.iter_mut().find(|v| v.path == version.path) {
            *existing = version;
        } else {
            unique.push(version);
        }
    }
    unique.sort_by(|a, b| a.name.cmp(&b.name));
    unique
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_without_the_wait_suffix() {
        assert_eq!(
            parse_line("INFO: Downloading steamrt3 (3.0.20260928.262393), please wait..."),
            Some(OutputEvent::Progress(
                "Downloading steamrt3 (3.0.20260928.262393)".into()
            ))
        );
        assert_eq!(
            parse_line("INFO: Extracting UMU-Proton-10.0-4.tar.gz..."),
            Some(OutputEvent::Progress(
                "Extracting UMU-Proton-10.0-4.tar.gz".into()
            ))
        );
    }

    #[test]
    fn strips_terminal_colors() {
        assert_eq!(
            parse_line(
                "\u{1b}[34m\u{1b}[1mINFO\u{1b}[0m: Verifying integrity of sniper_platform_3.0..."
            ),
            Some(OutputEvent::Progress(
                "Verifying integrity of sniper_platform_3.0".into()
            ))
        );
    }

    #[test]
    fn ignores_other_lines() {
        assert_eq!(parse_line("INFO: Using UMU-Proton-10.0-4"), None);
        assert_eq!(parse_line("fsync: up and running."), None);
        assert_eq!(parse_line("Note: shader cache is warm"), None);
        assert_eq!(parse_line("   "), None);
    }

    #[test]
    fn errors_and_fatal_failures() {
        assert_eq!(
            parse_line("ERROR: Digest mismatched: SteamLinuxRuntime_sniper.tar.xz"),
            Some(OutputEvent::Error(
                "Digest mismatched: SteamLinuxRuntime_sniper.tar.xz".into()
            ))
        );
        assert_eq!(
            parse_line(
                "FileNotFoundError: _v2-entry-point (umu) cannot be found in '/home/user/.local/share/umu/steamrt3'"
            ),
            Some(OutputEvent::Fatal(
                "FileNotFoundError: _v2-entry-point (umu) cannot be found in '/home/user/.local/share/umu/steamrt3'".into()
            ))
        );
        assert_eq!(
            parse_line(
                "pv-adverb[106667]: E: Failed to execute child process â€œ/home/user/.local/share/umu/steamrt4/umu-shimâ€ (No such file or directory)"
            ),
            Some(OutputEvent::Fatal(
                "Failed to execute child process â€œ/home/user/.local/share/umu/steamrt4/umu-shimâ€ (No such file or directory)".into()
            ))
        );
    }

    #[test]
    fn monitor_joins_chunks_and_prefers_fatal() {
        let mut monitor = OutputMonitor::default();
        assert!(monitor.feed("INFO: Downloading UMU-").is_empty());
        assert_eq!(
            monitor.feed("Proton-10.0-4.tar.gz...\nINFO: Using"),
            vec![OutputEvent::Progress(
                "Downloading UMU-Proton-10.0-4.tar.gz".into()
            )]
        );
        let mut monitor = OutputMonitor::default();
        monitor.feed(
            "ERROR: Digest mismatched: SteamLinuxRuntime_sniper.tar.xz\nTraceback (most recent call last):\nValueError: Digest mismatched: SteamLinuxRuntime_sniper.tar.xz\n",
        );
        assert_eq!(
            monitor.failure_message(),
            Some("ValueError: Digest mismatched: SteamLinuxRuntime_sniper.tar.xz")
        );
        let mut monitor = OutputMonitor::default();
        monitor.feed("ERROR: Aborting steamrt install due to network error");
        monitor.flush();
        assert!(!monitor.has_fatal_error());
        assert_eq!(
            monitor.failure_message(),
            Some("Aborting steamrt install due to network error")
        );
    }

    #[test]
    fn failure_messages() {
        let mut monitor = OutputMonitor::default();
        monitor.feed("INFO: Downloading steamrt3 (3.0.20260928.262393)...\n");
        monitor.feed("Traceback (most recent call last):\nRuntimeError: runtime setup failed\n");
        assert_eq!(
            setup_failure_message(
                Some(0),
                None,
                monitor.failure_message(),
                monitor.has_fatal_error(),
                false
            )
            .as_deref(),
            Some("RuntimeError: runtime setup failed")
        );
        assert_eq!(
            setup_failure_message(Some(1), None, Some("runtime setup failed"), false, false)
                .as_deref(),
            Some("runtime setup failed")
        );
        assert_eq!(
            setup_failure_message(Some(1), None, None, false, false).as_deref(),
            Some("umu-run exited with code 1")
        );
        assert_eq!(
            setup_failure_message(None, Some("SIGKILL"), None, false, false).as_deref(),
            Some("umu-run was terminated by SIGKILL")
        );
        // permissive once the game was detected
        assert_eq!(
            setup_failure_message(Some(1), None, Some("runtime setup failed"), false, true),
            None
        );
        assert_eq!(
            setup_failure_message(Some(0), None, Some("RuntimeError: boom"), true, true),
            None
        );
        assert_eq!(
            setup_failure_message(Some(1), None, Some("RuntimeError: boom"), true, true).as_deref(),
            Some("RuntimeError: boom")
        );
        assert_eq!(
            setup_failure_message(Some(0), None, None, false, false),
            None
        );
    }

    #[test]
    fn log_names_and_library_folders() {
        let logs = Path::new("/logs");
        assert_eq!(
            log_path(logs, Some("12/34 x")),
            Path::new("/logs/umu-12_34_x.log")
        );
        assert_eq!(log_path(logs, None), Path::new("/logs/umu.log"));
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"/home/u/.local/share/Steam\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"/mnt/games/SteamLibrary\"\n\t}\n}";
        assert_eq!(
            library_folder_paths(vdf),
            vec!["/home/u/.local/share/Steam", "/mnt/games/SteamLibrary"]
        );
    }

    #[test]
    fn finds_proton_versions() {
        let home = std::env::temp_dir().join(format!("hydra-proton-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let make = |dir: PathBuf| {
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("proton"), "").unwrap();
            std::fs::write(dir.join("toolmanifest.vdf"), "").unwrap();
        };
        make(home.join(".local/share/Steam/steamapps/common/Proton 9.0"));
        make(home.join(".local/share/Steam/compatibilitytools.d/GE-Proton10-1"));
        // not Proton, and an invalid tool
        std::fs::create_dir_all(home.join(".local/share/Steam/steamapps/common/Half-Life"))
            .unwrap();
        std::fs::create_dir_all(home.join(".local/share/Steam/compatibilitytools.d/broken"))
            .unwrap();
        let versions = installed_proton_versions(&home);
        let names: Vec<(&str, &str)> = versions
            .iter()
            .map(|v| (v.name.as_str(), v.source))
            .collect();
        assert_eq!(
            names,
            vec![
                ("GE-Proton10-1", "compatibility_tools"),
                ("Proton 9.0", "steam")
            ]
        );
        let _ = std::fs::remove_dir_all(&home);
    }
}
