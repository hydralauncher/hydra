//! native/hydra-native `list_processes` + the worker's `buildMaps`: running
//! processes keyed by lowercase name, valued by executable path, plus the
//! Linux details the watcher matches on (cwd, AppImage, Wine prefix).

use std::collections::{HashMap, HashSet};

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use crate::linux_match::LinuxProcess;

/// native/hydra-native's Linux process evidence (bounded /proc reads, an
/// allowlisted environment), shared with the Node addon rather than copied.
#[cfg(target_os = "linux")]
#[path = "../../../../native/hydra-native/src/linux_process.rs"]
#[allow(dead_code, unused_imports)]
mod linux_process;

#[derive(Clone, Debug, Default)]
pub struct ProcessInfo {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub name: String,
    pub exe: Option<String>,
    pub cwd: Option<String>,
    /// Linux: WINEPREFIX, STEAM_COMPAT_DATA_PATH, APPIMAGE and
    /// HYDRA_EPIC_INVOCATION_ID only (linux_process.rs ENV_ALLOWLIST).
    pub environ: HashMap<String, String>,
}

impl ProcessInfo {
    pub fn env(&self, key: &str) -> Option<&str> {
        self.environ
            .get(key)
            .map(String::as_str)
            .filter(|v| !v.is_empty())
    }
}

pub fn list() -> Vec<ProcessInfo> {
    let mut system = System::new();
    // Windows matches on the exe; elsewhere the watcher also needs the cwd.
    let mut kind = ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet);
    if !cfg!(windows) {
        kind = kind.with_cwd(UpdateKind::Always);
    }
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
    let mut processes: Vec<ProcessInfo> = system
        .processes()
        .values()
        .map(|p| {
            let name = p.name().to_string_lossy().into_owned();
            #[cfg(target_os = "linux")]
            let environ = linux_process::inspect_process(p.pid().as_u32(), p.exe(), &name, p.cwd())
                .environment;
            #[cfg(not(target_os = "linux"))]
            let environ = HashMap::new();
            ProcessInfo {
                pid: p.pid().as_u32(),
                parent_pid: p.parent().map(|pid| pid.as_u32()),
                exe: p.exe().map(|e| e.to_string_lossy().into_owned()),
                cwd: p.cwd().map(|c| c.to_string_lossy().into_owned()),
                name,
                environ,
            }
        })
        .collect();
    processes.sort_by(|a, b| a.pid.cmp(&b.pid).then_with(|| a.name.cmp(&b.name)));
    processes
}

/// The value buildMaps keys a process under: the exe on Windows, cwd + name
/// elsewhere (`path.join(proc.cwd || '', proc.name || '')`).
fn map_value(p: &ProcessInfo) -> Option<String> {
    let value = if cfg!(windows) {
        p.exe.clone()
    } else {
        Some(
            std::path::Path::new(p.cwd.as_deref().unwrap_or_default())
                .join(&p.name)
                .to_string_lossy()
                .into_owned(),
        )
    };
    value.filter(|v| !v.is_empty())
}

/// processMap: lowercase name -> paths.
pub fn process_map(processes: &[ProcessInfo]) -> HashMap<String, HashSet<String>> {
    let mut map: HashMap<String, HashSet<String>> = HashMap::new();
    for p in processes {
        let key = p.name.to_lowercase();
        let Some(value) = map_value(p) else {
            continue;
        };
        if key.is_empty() {
            continue;
        }
        map.entry(key).or_default().insert(value);
    }
    map
}

/// winePrefixMap: process path -> STEAM_COMPAT_DATA_PATH (Proton games).
pub fn wine_prefix_map(processes: &[ProcessInfo]) -> HashMap<String, String> {
    processes
        .iter()
        .filter(|p| !p.name.is_empty())
        .filter_map(|p| {
            let prefix = p.env("STEAM_COMPAT_DATA_PATH")?;
            Some((map_value(p)?, prefix.to_string()))
        })
        .collect()
}

/// linuxProcesses: the Linux matching view, lowercased.
pub fn linux_processes(processes: &[ProcessInfo]) -> Vec<LinuxProcess> {
    if !cfg!(target_os = "linux") {
        return Vec::new();
    }
    processes
        .iter()
        .filter(|p| !p.name.is_empty() && map_value(p).is_some())
        .map(|p| LinuxProcess {
            name: p.name.to_lowercase(),
            cwd: p.cwd.as_deref().unwrap_or_default().to_lowercase(),
            exe: p.exe.as_deref().unwrap_or_default().to_lowercase(),
            pid: p.pid,
            app_image_path: p.env("APPIMAGE").map(str::to_lowercase),
            steam_compat_data_path: p.env("STEAM_COMPAT_DATA_PATH").map(str::to_lowercase),
        })
        .collect()
}

/// process.kill(pid): `taskkill /PID` on Windows, SIGTERM elsewhere (Node's
/// default signal). Electron falls back to an elevated `kill -9` through
/// sudo-prompt when that fails; the rewrite logs it instead.
pub fn kill(pid: u32) {
    #[cfg(windows)]
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string()])
        .output();
    #[cfg(unix)]
    {
        // SAFETY: kill(2) with a plain pid and signal.
        if unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) } != 0 {
            eprintln!(
                "Failed to close process {pid}: {}",
                std::io::Error::last_os_error()
            );
        }
    }
}

/// SIGKILL, for stale Wine processes before a launch.
#[cfg(unix)]
pub fn kill_hard(pid: u32) {
    // SAFETY: kill(2) with a plain pid and signal.
    unsafe {
        libc::kill(pid as libc::pid_t, libc::SIGKILL);
    }
}
