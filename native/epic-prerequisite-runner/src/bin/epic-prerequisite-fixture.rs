use std::{path::PathBuf, time::Duration};
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("--exit") => std::process::exit(args[1].parse::<u32>().unwrap() as i32),
        Some("--record") => {
            let env = [
                "HYDRA_EPIC_SMOKE_SENTINEL",
                "WINEPREFIX",
                "PROTONPATH",
                "HYDRA_EPIC_INVOCATION_ID",
            ]
            .into_iter()
            .filter_map(|name| std::env::var(name).ok().map(|value| (name, value)))
            .collect::<std::collections::BTreeMap<_, _>>();
            let value = serde_json::json!({
                "args": &args[2..],
                "cwd": std::env::current_dir().unwrap(),
                "env": env,
            });
            std::fs::write(&args[1], serde_json::to_vec(&value).unwrap()).unwrap();
        }
        Some("--spawn-child") => {
            std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--child", &args[1], &args[2]])
                .spawn()
                .unwrap();
        }
        Some("--child") => {
            std::fs::write(
                PathBuf::from(&args[2]).with_extension("started"),
                b"started",
            )
            .unwrap();
            std::thread::sleep(Duration::from_millis(args[1].parse().unwrap()));
            std::fs::write(PathBuf::from(&args[2]), b"child-complete").unwrap();
        }
        #[cfg(windows)]
        Some("--schedule-reboot") => schedule_reboot(&args[1]),
        _ => std::process::exit(2),
    }
}

#[cfg(windows)]
fn schedule_reboot(directory: &str) {
    use epic_prerequisite_runner::quote_argument;
    use windows_sys::Win32::System::Registry::*;
    let dir = PathBuf::from(directory);
    let source = dir.join("rename-source.txt");
    let destination = dir.join("rename-destination.txt");
    let deleted = dir.join("delete-on-reboot.txt");
    std::fs::write(&source, b"rename-applied").unwrap();
    std::fs::write(&deleted, b"delete-applied").unwrap();
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let set = |root, key: &str, name: &str, kind, value: &[u16]| unsafe {
        let mut opened = std::ptr::null_mut();
        assert_eq!(
            RegCreateKeyExW(
                root,
                wide(key).as_ptr(),
                0,
                std::ptr::null(),
                0,
                KEY_SET_VALUE,
                std::ptr::null(),
                &mut opened,
                std::ptr::null_mut()
            ),
            0
        );
        assert_eq!(
            RegSetValueExW(
                opened,
                wide(name).as_ptr(),
                0,
                kind,
                value.as_ptr() as *const u8,
                (value.len() * 2) as u32
            ),
            0
        );
        RegCloseKey(opened);
    };
    let mut pending = Vec::new();
    for file in [&source, &destination, &deleted] {
        pending.extend(wide(&format!("\\??\\{}", file.display())));
    }
    pending.extend([0, 0]);
    set(
        HKEY_LOCAL_MACHINE,
        "System\\CurrentControlSet\\Control\\Session Manager",
        "PendingFileRenameOperations",
        REG_MULTI_SZ,
        &pending,
    );
    let command = [
        std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned(),
        "--record".into(),
        dir.join("runonce.json").to_string_lossy().into_owned(),
        "runonce-executed".into(),
    ]
    .iter()
    .map(|arg| quote_argument(arg))
    .collect::<Vec<_>>()
    .join(" ");
    set(
        HKEY_LOCAL_MACHINE,
        "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce",
        "HydraEpicFixture",
        REG_SZ,
        &wide(&command),
    );
}
