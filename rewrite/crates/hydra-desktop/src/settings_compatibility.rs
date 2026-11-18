//! pages/settings Compatibility tab (settings-context-compatibility.tsx) and
//! the common redistributables check/installer (common-redist-manager.ts).

use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::{Map, Value, json};
use slint::{ComponentHandle, ModelRc, VecModel};

use crate::{AppWindow, CompatibilityData, ProtonOption, prefs, shell};

/// CommonRedistManager.redistributables
const REDISTRIBUTABLES: [&str; 6] = [
    "dotNetFx40_Full_setup.exe",
    "directx_Jun2010_redist.exe",
    "oalinst.exe",
    "install.bat",
    "xnafx40_redist.msi",
    "VisualCppRedist_AIO_x86_x64.exe",
];
/// installationTimeout (5 minutes)
const INSTALL_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const INSTALL_COMPLETE: &str = "Installation complete";

thread_local! {
    static UI: RefCell<slint::Weak<AppWindow>> = RefCell::new(slint::Weak::default());
    static POLL: RefCell<Option<slint::Timer>> = const { RefCell::new(None) };
    /// lastKnownCanInstallCommonRedist (survives leaving the tab)
    static LAST_CAN_INSTALL: Cell<bool> = const { Cell::new(false) };
}

fn with_ui(f: impl FnOnce(&AppWindow)) {
    if let Some(ui) = UI.with(|u| u.borrow().upgrade()) {
        f(&ui);
    }
}

/// commonRedistPath: <userData>/CommonRedist
fn common_redist_dir() -> Option<PathBuf> {
    hydra_db::paths::native_user_data().map(|d| d.join("CommonRedist"))
}

/// canInstallCommonRedist: every installer file is present
pub fn can_install_common_redist() -> bool {
    common_redist_dir().is_some_and(|dir| REDISTRIBUTABLES.iter().all(|f| dir.join(f).exists()))
}

fn install_log() -> PathBuf {
    std::env::temp_dir().join("common_redist_install.log")
}

pub fn init(ui: &AppWindow) {
    UI.with(|u| *u.borrow_mut() = ui.as_weak());
    let data = ui.global::<CompatibilityData>();
    data.set_linux(cfg!(target_os = "linux"));
    data.set_windows(cfg!(windows));
    data.on_install(install);
    data.on_change_wine_prefix(|| {
        let current = wine_prefix(&prefs::get());
        let mut dialog = rfd::FileDialog::new();
        if !current.is_empty() {
            dialog = dialog.set_directory(&current);
        }
        if let Some(picked) = dialog.pick_folder() {
            prefs::update(Map::from_iter([(
                "defaultWinePrefixPath".to_string(),
                json!(picked.to_string_lossy()),
            )]));
            refresh();
        }
    });
    data.on_clear_wine_prefix(|| {
        prefs::update(Map::from_iter([(
            "defaultWinePrefixPath".to_string(),
            Value::Null,
        )]));
        refresh();
    });
    data.on_proton_selected(|path| {
        prefs::update(Map::from_iter([(
            "defaultProtonPath".to_string(),
            if path.is_empty() {
                Value::Null
            } else {
                json!(path.to_string())
            },
        )]));
        refresh();
    });
    data.on_toggle(|key| {
        if key != "autoRunGamemode" && key != "autoRunMangohud" {
            return;
        }
        let current = prefs::flag(&prefs::get(), &key);
        prefs::update(Map::from_iter([(key.to_string(), json!(!current))]));
        refresh();
    });
    data.on_open_url(|url| crate::settings_debrid::open_url(&url));
}

/// Wine.getDefaultPrefixPath: the preference, else <userData>/wine-prefixes
fn wine_prefix(p: &Map<String, Value>) -> String {
    if !cfg!(target_os = "linux") {
        return String::new();
    }
    p.get("defaultWinePrefixPath")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            hydra_db::paths::native_user_data()
                .map(|d| d.join("wine-prefixes").to_string_lossy().into_owned())
        })
        .unwrap_or_default()
}

/// isGamemodeAvailable / isMangohudAvailable: the command is in PATH.
/// TODO(linux): Electron also checks ldconfig for the GameMode libraries.
fn in_path(command: &str) -> bool {
    if !cfg!(target_os = "linux") {
        return false;
    }
    std::process::Command::new("/bin/sh")
        .args(["-c", &format!("command -v {command}")])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// The Compatibility tab opened.
pub fn refresh() {
    let p = prefs::get();
    let linux = cfg!(target_os = "linux");
    // TODO(linux): getInstalledProtonVersions (Steam and compatibilitytools.d)
    let versions: Vec<ProtonOption> = Vec::new();
    let proton_path = p
        .get("defaultProtonPath")
        .and_then(Value::as_str)
        .filter(|path| versions.iter().any(|v| v.path == *path))
        .unwrap_or_default()
        .to_string();
    let (gamemode, mangohud) = if linux {
        (in_path("gamemoderun"), in_path("mangohud"))
    } else {
        (false, false)
    };
    with_ui(|ui| {
        let data = ui.global::<CompatibilityData>();
        data.set_wine_prefix(wine_prefix(&p).into());
        data.set_custom_wine_prefix(p.get("defaultWinePrefixPath").is_some_and(|v| !v.is_null()));
        data.set_proton_versions(ModelRc::new(VecModel::from(versions)));
        data.set_proton_path(proton_path.into());
        data.set_gamemode_available(gamemode);
        data.set_mangohud_available(mangohud);
        data.set_gamemode(prefs::flag(&p, "autoRunGamemode"));
        data.set_mangohud(prefs::flag(&p, "autoRunMangohud"));
        data.set_can_install(LAST_CAN_INSTALL.with(Cell::get));
    });
    if cfg!(windows) {
        poll_can_install();
        let timer = slint::Timer::default();
        // canInstallCommonRedist every 5 seconds while the tab is open
        timer.start(
            slint::TimerMode::Repeated,
            Duration::from_secs(5),
            poll_can_install,
        );
        POLL.with(|p| *p.borrow_mut() = Some(timer));
    }
}

/// Leaving the tab stops the polling.
pub fn leave() {
    POLL.with(|p| *p.borrow_mut() = None);
}

fn poll_can_install() {
    std::thread::spawn(|| {
        let can = can_install_common_redist();
        let _ = slint::invoke_from_event_loop(move || {
            LAST_CAN_INSTALL.with(|c| c.set(can));
            with_ui(|ui| ui.global::<CompatibilityData>().set_can_install(can));
        });
    });
}

/// installCommonRedist: reset the preflight flag, run install.bat hidden and
/// follow its log until "Installation complete" (or the 5 minute timeout).
fn install() {
    if !can_install_common_redist() {
        return;
    }
    with_ui(|ui| ui.global::<CompatibilityData>().set_installing(true));
    if let Some(db) = shell::db() {
        let _ = db.delete(hydra_db::keys::COMMON_REDIST_PASSED);
    }
    let Some(dir) = common_redist_dir() else {
        return;
    };
    std::thread::spawn(move || {
        let log = install_log();
        if !log.exists() {
            let _ = std::fs::write(&log, "");
        }
        let mut command = std::process::Command::new("cmd");
        command.arg("/C").arg(dir.join("install.bat"));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        if let Err(error) = command.spawn() {
            eprintln!("Failed to run install.bat: {error}");
        }
        let started = Instant::now();
        let mut last = String::new();
        loop {
            std::thread::sleep(Duration::from_millis(500));
            let text = std::fs::read_to_string(&log).unwrap_or_default();
            if text != last {
                last = text.clone();
                // data.split("\n").at(-2): the last complete line
                let tail = text.split('\n').rev().nth(1).unwrap_or_default().trim();
                if tail.contains(INSTALL_COMPLETE) {
                    break;
                }
            }
            if started.elapsed() > INSTALL_TIMEOUT {
                eprintln!("Installation timed out");
                break;
            }
        }
        let _ = slint::invoke_from_event_loop(|| {
            with_ui(|ui| ui.global::<CompatibilityData>().set_installing(false));
        });
    });
}
