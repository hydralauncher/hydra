//! services/7zip.ts: the bundled 7-Zip (`binaries/7z.exe`, `7zzs`, `7zz`)
//! run like node-7z's `extractFull(file, ".", { $progress, yes,
//! noWildcards, password })` from the output folder, trying each password.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

static BINARY: OnceLock<PathBuf> = OnceLock::new();

fn binary_name() -> &'static str {
    if cfg!(windows) {
        "7z.exe"
    } else if cfg!(target_os = "macos") {
        "7zz"
    } else {
        "7zzs"
    }
}

/// Where the 7-Zip binary is: next to the executable when packaged, else the
/// repository's `binaries/` folder.
pub fn binary() -> PathBuf {
    BINARY
        .get_or_init(|| {
            let beside = std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|d| d.join(binary_name())));
            beside.filter(|p| p.exists()).unwrap_or_else(|| {
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../../../binaries")
                    .join(binary_name())
            })
        })
        .clone()
}

/// isPasswordRelatedError
fn password_error(output: &str) -> bool {
    let text = output.to_lowercase();
    text.contains("wrong password")
        || text.contains("can not open encrypted archive")
        || text.contains("encrypted")
}

/// extractFile: Ok(true) when 7-Zip finished, Err after every password failed.
/// `on_progress` gets the percentage (0..100).
pub fn extract(
    file: &Path,
    output: &Path,
    passwords: &[String],
    on_progress: &dyn Fn(f64),
) -> Result<bool, String> {
    std::fs::create_dir_all(output).map_err(|e| e.to_string())?;
    let attempts: Vec<String> = if passwords.is_empty() {
        vec![String::new()]
    } else {
        passwords.to_vec()
    };
    for (index, password) in attempts.iter().enumerate() {
        eprintln!(
            "Trying password \"{}\" on {}",
            if password.is_empty() {
                "(empty)"
            } else {
                password
            },
            file.display()
        );
        let mut command = Command::new(binary());
        // node-7z: x <archive> -o. -y -bsp1 -bb3 -spd [-p<password>]
        command
            .arg("x")
            .arg(file)
            .arg("-o.")
            .arg("-y")
            .arg("-bsp1")
            .arg("-bb3")
            .arg("-spd");
        // 7-Zip asks for a password on stdin otherwise; an empty -p never prompts.
        command.arg(format!("-p{password}"));
        command
            .current_dir(output)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to start 7-Zip: {e}"))?;
        let mut stdout = child.stdout.take().expect("stdout");
        let mut stderr = child.stderr.take().expect("stderr");
        let errors = std::thread::spawn(move || {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            text
        });
        // -bsp1 progress: "  42% 13 - path" separated by backspaces / CRs.
        let mut buffer = [0u8; 4096];
        let mut pending = String::new();
        let mut files = 0usize;
        loop {
            let read = stdout.read(&mut buffer).unwrap_or(0);
            if read == 0 {
                break;
            }
            pending.push_str(&String::from_utf8_lossy(&buffer[..read]));
            let mut parts: Vec<String> = pending
                .split(['\r', '\n', '\u{8}'])
                .map(str::to_string)
                .collect();
            pending = parts.pop().unwrap_or_default();
            for part in parts {
                let line = part.trim();
                let percent = line
                    .split_once('%')
                    .and_then(|(p, _)| p.trim().parse::<f64>().ok());
                if let Some(value) = percent {
                    on_progress(value);
                } else if line.starts_with("- ") {
                    files += 1;
                }
            }
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        let error_text = errors.join().unwrap_or_default();
        if status.success() {
            eprintln!("Successfully extracted {} ({files} files)", file.display());
            return Ok(true);
        }
        eprintln!(
            "Extraction error for {}: {}",
            file.display(),
            error_text.trim()
        );
        if index < attempts.len() - 1 && password_error(&error_text) {
            eprintln!(
                "Failed to extract file: {} with password: \"{password}\". Trying next password...",
                file.display()
            );
            continue;
        }
        eprintln!(
            "Failed to extract file: {} after trying all passwords",
            file.display()
        );
        return Err(format!("Failed to extract file: {}", file.display()));
    }
    Err(format!("Failed to extract file: {}", file.display()))
}
