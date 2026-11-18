//! The parts of download.ts that don't depend on the download queue:
//! Legendary's install arguments and its progress output.
//!
//! TODO(epic): the managed install itself (installation.ts prepare/inspect,
//! the install modal, the Downloads queue, prerequisites, binding the
//! executable from installed.json, updates, DLCs, launch and cloud saves)
//! is not wired into the rewrite yet.

const MIB_BYTES: f64 = 1024.0 * 1024.0;

/// epicInstallArgs
pub fn install_args(
    artifact_id: &str,
    platform: &str,
    base_path: &str,
    folder_name: &str,
    install_tags: &[String],
) -> Vec<String> {
    let mut args: Vec<String> = [
        "-y",
        "install",
        artifact_id,
        "--platform",
        platform,
        "--base-path",
        base_path,
        "--game-folder",
        folder_name,
        "--skip-dlcs",
        "--skip-sdl",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.extend(
        install_tags
            .iter()
            .map(|tag| format!("--install-tag={tag}")),
    );
    args
}

/// EpicDownloadTelemetry
#[derive(Clone, Debug, PartialEq)]
pub struct Telemetry {
    pub progress: f64,
    pub bytes_downloaded: f64,
    pub file_size: f64,
    pub download_speed: f64,
    /// milliseconds, -1 when unknown
    pub time_remaining: i64,
    pub preparing: bool,
    pub failed: bool,
}

/// EpicDownloadProgressParser: Legendary 0.21.1 reports the current run's
/// chunks; bytes reused from an earlier run are carried separately.
pub struct ProgressParser {
    reused_bytes: f64,
    pub state: Telemetry,
}

fn number_after(line: &str, label: &str, unit: &str) -> Option<f64> {
    let lower = line.to_ascii_lowercase();
    let start = lower.find(&label.to_ascii_lowercase())? + label.len();
    let rest = line[start..].trim_start();
    let digits: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    if digits.is_empty() {
        return None;
    }
    let tail = rest[digits.len()..].trim_start();
    if !tail
        .to_ascii_lowercase()
        .starts_with(&unit.to_ascii_lowercase())
    {
        return None;
    }
    digits.parse().ok()
}

impl ProgressParser {
    pub fn new(file_size: f64, previous_bytes: f64, previous_progress: f64) -> Self {
        let persisted = if previous_progress.is_finite() {
            previous_progress.clamp(0.0, 1.0)
        } else {
            0.0
        };
        let from_bytes = if file_size > 0.0 {
            (previous_bytes / file_size).min(1.0)
        } else {
            0.0
        };
        ProgressParser {
            reused_bytes: 0.0,
            state: Telemetry {
                progress: persisted.max(from_bytes),
                bytes_downloaded: previous_bytes.max(0.0),
                file_size,
                download_speed: 0.0,
                time_remaining: -1,
                preparing: true,
                failed: false,
            },
        }
    }

    pub fn line(&mut self, line: &str) {
        let lower = line.to_ascii_lowercase();
        if lower.contains("installation failed")
            || lower.contains("[cli] error:")
            || lower.contains("[cli] critical:")
            || lower.contains("[dlmanager] critical:")
        {
            self.state.failed = true;
        }
        if let Some(mib) = number_after(line, "Download size:", "MiB") {
            let remaining = mib * MIB_BYTES;
            if self.state.file_size <= 0.0 {
                self.state.file_size = remaining.round();
            }
            self.reused_bytes = (self.state.file_size - remaining).max(0.0);
            self.state.bytes_downloaded = self.state.bytes_downloaded.max(self.reused_bytes);
            self.state.preparing = false;
        } else if line.contains("Download size is 0") {
            self.state.preparing = false;
        }
        if let Some(mib) = number_after(line, "Downloaded:", "MiB") {
            let value = self.reused_bytes + mib * MIB_BYTES;
            self.state.bytes_downloaded = self
                .state
                .file_size
                .min(self.state.bytes_downloaded.max(value));
        }
        if let Some(percent) = number_after(line, "Progress:", "%") {
            let partial = (percent / 100.0).clamp(0.0, 1.0);
            let full = if self.state.file_size > 0.0 {
                (self.reused_bytes + partial * (self.state.file_size - self.reused_bytes))
                    / self.state.file_size
            } else {
                partial
            };
            if full.is_finite() {
                self.state.progress = self.state.progress.max(full);
            }
            if let Some(eta) = lower.find("eta:") {
                let parts: Vec<i64> = line[eta + 4..]
                    .trim_start()
                    .split(|c: char| !c.is_ascii_digit())
                    .take(3)
                    .filter_map(|p| p.parse().ok())
                    .collect();
                if let [h, m, s] = parts[..] {
                    let seconds = h * 3600 + m * 60 + s;
                    self.state.time_remaining = if seconds > 0 || full == 1.0 {
                        seconds * 1000
                    } else {
                        -1
                    };
                }
            }
        }
        if let Some(start) = lower.find("+ download") {
            let rest = line[start + "+ download".len()..].trim_start();
            if let Some(rest) = rest.strip_prefix('-')
                && let Some(mib) = number_after(&format!("x{rest}"), "x", "MiB/s")
                && rest.to_ascii_lowercase().contains("(raw)")
            {
                self.state.download_speed = mib * MIB_BYTES;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_arguments() {
        assert_eq!(
            install_args(
                "Sugar",
                "Windows",
                "D:\\Games",
                "Sugar",
                &["".into(), "voice".into()]
            ),
            [
                "-y",
                "install",
                "Sugar",
                "--platform",
                "Windows",
                "--base-path",
                "D:\\Games",
                "--game-folder",
                "Sugar",
                "--skip-dlcs",
                "--skip-sdl",
                "--install-tag=",
                "--install-tag=voice"
            ]
        );
    }

    #[test]
    fn parses_legendary_progress() {
        let mut parser = ProgressParser::new(0.0, 0.0, 0.0);
        assert!(parser.state.preparing);
        parser.line("[cli] INFO: Download size: 100.00 MiB (Compression savings: 1.0%)");
        assert!(!parser.state.preparing);
        assert_eq!(parser.state.file_size, (100.0 * MIB_BYTES).round());
        parser.line(
            "[DLManager] INFO: = Progress: 50.00% (10/20), Running for 00:00:10, ETA: 00:00:10",
        );
        assert!((parser.state.progress - 0.5).abs() < 1e-9);
        assert_eq!(parser.state.time_remaining, 10_000);
        parser.line("[DLManager] INFO:  - Downloaded: 40.00 MiB, Written: 80.00 MiB");
        assert_eq!(parser.state.bytes_downloaded, 40.0 * MIB_BYTES);
        parser.line(
            "[DLManager] INFO:  + Download\t- 12.50 MiB/s (raw) / 25.00 MiB/s (decompressed)",
        );
        assert_eq!(parser.state.download_speed, 12.5 * MIB_BYTES);
        parser.line("[cli] ERROR: something broke");
        assert!(parser.state.failed);
    }

    #[test]
    fn resumed_runs_keep_reused_bytes() {
        let total = 200.0 * MIB_BYTES;
        let mut parser = ProgressParser::new(total, 0.0, 0.4);
        parser.line("Download size: 100.00 MiB");
        assert_eq!(parser.state.bytes_downloaded, 100.0 * MIB_BYTES);
        parser.line("Progress: 0.00% (0/10), ETA: 00:00:00");
        assert!(
            (parser.state.progress - 0.5).abs() < 1e-9,
            "never goes backwards"
        );
        assert_eq!(parser.state.time_remaining, -1);
    }
}
