//! services/legendary.ts and the availability checks of services/epic/index.ts:
//! where the bundled Legendary lives, whether it can run, and the verified
//! managed-runtime command (`python -I -B managed.py managed-legendary.pyz`).
//!
//! The bundle is the one Electron ships (`resources/legendary`, built by
//! scripts/prepare-legendary.cjs into `legendary/<platform>/<arch>` for
//! development). The rewrite looks for it in this order:
//! `HYDRA_LEGENDARY_DIR`, `<exe dir>/legendary`, `<exe dir>/resources/legendary`,
//! then `legendary/<platform>/<arch>` in a parent of the executable (the
//! repository root of a development build).

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::{EpicError, Result, err};

/// src/shared/legendary-manifest.json: the pinned release and its hashes.
const MANIFEST: &str = include_str!("../../../../src/shared/legendary-manifest.json");

pub fn manifest() -> Value {
    serde_json::from_str(MANIFEST).unwrap_or(Value::Null)
}

/// `process.platform`
pub fn platform() -> &'static str {
    if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

/// `process.arch` (only the two Legendary ships for)
pub fn arch() -> Option<&'static str> {
    if cfg!(target_arch = "x86_64") {
        Some("x64")
    } else if cfg!(target_arch = "aarch64") {
        Some("arm64")
    } else {
        None
    }
}

fn binary_name() -> &'static str {
    if cfg!(windows) {
        "legendary.exe"
    } else {
        "legendary"
    }
}

/// The folder that holds `legendary(.exe)` and the managed runtime.
pub fn bundle_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("HYDRA_LEGENDARY_DIR") {
        return Some(PathBuf::from(dir));
    }
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    for candidate in [
        exe_dir.join("legendary"),
        exe_dir.join("resources").join("legendary"),
    ] {
        if candidate.join(binary_name()).is_file() {
            return Some(candidate);
        }
    }
    let arch = arch()?;
    exe_dir
        .ancestors()
        .map(|dir| dir.join("legendary").join(platform()).join(arch))
        .find(|dir| dir.join(binary_name()).is_file())
}

/// Legendary.getBinaryPath
pub fn binary_path() -> Option<PathBuf> {
    arch()?;
    bundle_dir().map(|dir| dir.join(binary_name()))
}

/// availability() (index.ts): `None` when Legendary can run.
pub fn availability() -> Option<&'static str> {
    if !(cfg!(windows) || cfg!(target_os = "linux") || cfg!(target_os = "macos")) {
        return Some("unsupported-platform");
    }
    if arch().is_none() {
        return Some("unsupported-architecture");
    }
    let Some(binary) = binary_path() else {
        return Some("legendary-missing");
    };
    match std::fs::metadata(&binary) {
        Ok(meta) if meta.is_file() => None,
        Ok(_) => Some("legendary-missing"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some("legendary-missing"),
        Err(_) => Some("legendary-unavailable"),
    }
}

/// checkBinary: the binary path, or the availability error.
pub fn check_binary() -> Result<PathBuf> {
    if let Some(reason) = availability() {
        return err(reason);
    }
    binary_path().ok_or_else(|| EpicError::new("legendary-missing"))
}

/// epicManagedInstallationSupport (managed-platform.ts)
pub fn managed_installation_support() -> Option<&'static str> {
    if !(cfg!(windows) || cfg!(target_os = "linux")) {
        return Some("unsupported-platform");
    }
    match arch() {
        Some("x64") => None,
        Some("arm64") if cfg!(windows) => None,
        _ => Some("unsupported-architecture"),
    }
}

/// EpicManagedCommand: the binary and the arguments before `--request`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManagedCommand {
    pub binary: PathBuf,
    pub prefix_args: Vec<OsString>,
    pub directory: PathBuf,
}

static MANAGED: Mutex<Option<ManagedCommand>> = Mutex::new(None);

fn sha256_file(path: &Path) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    Some(format!("{:x}", Sha256::digest(&bytes)))
}

/// Legendary.getManagedCommand: managed-runtime.json must match the pinned
/// protocol, version and capabilities, and managed.py / the pyz archive must
/// hash to the manifest. Cached once it resolves (a failure retries).
pub fn managed_command() -> Result<ManagedCommand> {
    if let Some(command) = MANAGED.lock().ok().and_then(|m| m.clone()) {
        return Ok(command);
    }
    let unavailable = || EpicError::new("legendary-unavailable");
    if !(cfg!(windows) || cfg!(target_os = "linux")) {
        return Err(unavailable());
    }
    let original = binary_path().ok_or_else(unavailable)?;
    let root = original.parent().ok_or_else(unavailable)?.to_path_buf();
    let manifest = manifest();
    let index: Value = std::fs::read_to_string(root.join("managed-runtime.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .ok_or_else(unavailable)?;
    let runtime = &manifest["managedRuntime"];
    let capabilities = index["capabilities"].as_array().ok_or_else(unavailable)?;
    let required = runtime["capabilities"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if index["protocolVersion"] != runtime["protocolVersion"]
        || index["legendaryVersion"] != manifest["version"]
        || !required.iter().all(|c| capabilities.contains(c))
    {
        return Err(unavailable());
    }
    let script = root.join("managed.py");
    let archive = root.join("managed-legendary.pyz");
    let expected_archive = arch()
        .and_then(|a| manifest["artifacts"]["linux"][a]["sha256"].as_str())
        .ok_or_else(unavailable)?;
    for (file, expected) in [
        (
            &script,
            runtime["adapterSha256"].as_str().unwrap_or_default(),
        ),
        (&archive, expected_archive),
    ] {
        if sha256_file(file).as_deref() != Some(expected) {
            return Err(unavailable());
        }
    }
    let binary = if cfg!(windows) {
        root.join("python").join("python.exe")
    } else {
        root.join("python-runner")
    };
    if !binary.is_file() {
        return Err(unavailable());
    }
    let mut prefix_args: Vec<OsString> = Vec::new();
    if cfg!(windows) {
        prefix_args.push("-I".into());
        prefix_args.push("-B".into());
    }
    prefix_args.push(script.into_os_string());
    prefix_args.push(archive.into_os_string());
    let command = ManagedCommand {
        binary,
        prefix_args,
        directory: root,
    };
    if let Ok(mut slot) = MANAGED.lock() {
        *slot = Some(command.clone());
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_embedded() {
        let manifest = manifest();
        assert_eq!(manifest["version"], "0.21.1");
        assert_eq!(manifest["managedRuntime"]["protocolVersion"], 1);
    }

    #[test]
    fn availability_reports_a_reason_or_a_binary() {
        match availability() {
            None => assert!(binary_path().is_some_and(|p| p.is_file())),
            Some(reason) => assert!(
                [
                    "legendary-missing",
                    "legendary-unavailable",
                    "unsupported-architecture"
                ]
                .contains(&reason)
            ),
        }
    }
}
