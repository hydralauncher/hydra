//! native/hydra-native `list_processes` + the worker's `buildMaps`: running
//! processes keyed by lowercase name, valued by executable path.

use std::collections::{HashMap, HashSet};

use sysinfo::{ProcessesToUpdate, System};

#[derive(Clone, Debug)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub exe: Option<String>,
    pub cwd: Option<String>,
}

pub fn list() -> Vec<ProcessInfo> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    system
        .processes()
        .values()
        .map(|p| ProcessInfo {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().into_owned(),
            exe: p.exe().map(|e| e.to_string_lossy().into_owned()),
            cwd: p.cwd().map(|c| c.to_string_lossy().into_owned()),
        })
        .collect()
}

/// processMap: lowercase name -> paths (the exe on Windows, cwd + name elsewhere).
pub fn process_map(processes: &[ProcessInfo]) -> HashMap<String, HashSet<String>> {
    let mut map: HashMap<String, HashSet<String>> = HashMap::new();
    for p in processes {
        let key = p.name.to_lowercase();
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
        let Some(value) = value.filter(|v| !v.is_empty()) else {
            continue;
        };
        if key.is_empty() {
            continue;
        }
        map.entry(key).or_default().insert(value);
    }
    map
}

/// `taskkill /PID` / `kill -9`
pub fn kill(pid: u32) {
    #[cfg(windows)]
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string()])
        .output();
    #[cfg(not(windows))]
    let _ = std::process::Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output();
}
