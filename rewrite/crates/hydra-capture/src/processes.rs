//! NativeAddon.listProcesses (native/hydra-native `list_processes`), with the
//! fields the screenshot foreground match reads: parent pids everywhere, and
//! cwd + the allow-listed environment (WINEPREFIX, STEAM_COMPAT_DATA_PATH,
//! APPIMAGE) on Linux.

use std::collections::HashMap;

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[derive(Clone, Debug, Default)]
pub struct ProcessEntry {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub name: String,
    pub exe: Option<String>,
    pub cwd: Option<String>,
    pub environ: Option<HashMap<String, String>>,
}

pub fn list() -> Vec<ProcessEntry> {
    let linux = cfg!(target_os = "linux");
    let mut kind = ProcessRefreshKind::nothing().with_exe(UpdateKind::Always);
    if linux {
        kind = kind.with_cwd(UpdateKind::Always);
    }
    let mut system = System::new();
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);

    let mut processes: Vec<ProcessEntry> = system
        .processes()
        .values()
        .map(|process| {
            let pid = process.pid().as_u32();
            let name = process.name().to_string_lossy().into_owned();
            #[cfg(target_os = "linux")]
            let environ = {
                let inspection =
                    crate::linux_process::inspect_process(pid, process.exe(), &name, process.cwd());
                (!inspection.environment.is_empty()).then_some(inspection.environment)
            };
            #[cfg(not(target_os = "linux"))]
            let environ = None;
            ProcessEntry {
                pid,
                parent_pid: process.parent().map(|pid| pid.as_u32()),
                name,
                exe: process
                    .exe()
                    .map(|value| value.to_string_lossy().into_owned()),
                cwd: if linux {
                    process
                        .cwd()
                        .map(|value| value.to_string_lossy().into_owned())
                } else {
                    None
                },
                environ,
            }
        })
        .collect();
    processes.sort_by(|a, b| a.pid.cmp(&b.pid).then_with(|| a.name.cmp(&b.name)));
    processes
}
