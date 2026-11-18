//! pages/settings Emulation tab: settings-context-emulation.tsx's console
//! grid (console-card.tsx) from the saved emulator and RetroArch configs
//! (the `emulators` and `retroarch` sublevels, getEmulatorConfigs /
//! getRetroArchConfig).
//!
//! TODO(emulators): detectEmulators / detectRetroArch when nothing was
//! detected yet, the BIOS and PS3 firmware checks (bios-detection.ts,
//! firmware-detection.ts; until then the requirement counts as met, the
//! cards' state before Electron's check resolves), the emulator detail and
//! RetroArch detail views, the setup modals and the classics onboarding
//! modal.

use std::cell::RefCell;

use hydra_db::keys;
use serde_json::Value;
use slint::{ComponentHandle, ModelRc, VecModel};

use crate::{AppWindow, ConsoleCard, ConsoleRow, EmulationData, shell};

/// SYSTEMS + RetroArch, in the grid's order
const SYSTEMS: [&str; 5] = ["ps1", "ps2", "ps3", "psp", "dolphin"];

/// RETROARCH_CORE_LIST (platforms - label)
const RETROARCH_CORES: [(&str, &str); 5] = [
    ("NES", "FCEUmm"),
    ("SNES", "Snes9x"),
    ("N64", "Mupen64Plus-Next"),
    ("GB / GBC", "Gambatte"),
    ("GBA", "mGBA"),
];

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    cards: Vec<ConsoleCard>,
    columns: usize,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn t(key: &str) -> String {
    shell::tr(&format!("settings.{key}"))
}

fn tw(key: &str, args: &[(&str, hydra_i18n::Arg)]) -> String {
    shell::tr_with(&format!("settings.{key}"), args)
}

pub fn init(ui: &AppWindow) {
    with(|s| {
        s.ui = ui.as_weak();
        s.columns = 2;
    });
    let data = ui.global::<EmulationData>();
    data.on_grid_resized(|width| {
        // repeat(auto-fill, minmax(260px, 1fr)) with a 16px column gap
        let columns = (((width + 16.0) / (260.0 + 16.0)).floor() as usize).max(1);
        if with(|s| std::mem::replace(&mut s.columns, columns)) != columns {
            // not while Slint lays out the row that reported it
            slint::Timer::single_shot(std::time::Duration::ZERO, layout_rows);
        }
    });
    data.on_configure(|system| {
        eprintln!("TODO(emulators): the {system} emulator detail view");
    });
    data.on_start_setup(|system| {
        eprintln!("TODO(emulators): the {system} setup modal");
    });
}

/// KNOWN_BINARY_LABELS by system
fn emulator_name(system: &str) -> &'static str {
    match system {
        "ps1" => "DuckStation",
        "ps2" => "PCSX2",
        "ps3" => "RPCS3",
        "psp" => "PPSSPP",
        _ => "Dolphin",
    }
}

fn system_title(system: &str) -> &'static str {
    match system {
        "ps1" => "PlayStation 1",
        "ps2" => "PlayStation 2",
        "ps3" => "PlayStation 3",
        "psp" => "PlayStation Portable",
        "dolphin" => "GameCube & Wii",
        _ => "RetroArch",
    }
}

/// formatRelativeShort: Intl.RelativeTimeFormat(language, { numeric:
/// "auto", style: "short" }) for minutes, hours and days.
/// TODO(i18n): only English and Portuguese patterns; others use English.
pub fn relative_short(ts_ms: i64, now_ms: i64, language: &str) -> String {
    let minutes = (now_ms - ts_ms).div_euclid(60_000);
    let pt = language.starts_with("pt");
    if minutes < 1 {
        return if pt { "agora" } else { "now" }.to_string();
    }
    if minutes < 60 {
        return if pt {
            format!("há {minutes} min.")
        } else {
            format!("{minutes} min. ago")
        };
    }
    if minutes < 60 * 24 {
        let hours = minutes / 60;
        return if pt {
            format!("há {hours} h")
        } else {
            format!("{hours} hr. ago")
        };
    }
    let days = minutes / (60 * 24);
    match (days, pt) {
        (1, true) => "ontem".into(),
        (1, false) => "yesterday".into(),
        (_, true) => format!("há {days} dias"),
        (_, false) => format!("{days} days ago"),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

fn text(value: Option<&Value>, key: &str) -> Option<String> {
    value
        .and_then(|v| v.get(key))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn number(value: Option<&Value>, key: &str) -> Option<f64> {
    value.and_then(|v| v.get(key)).and_then(Value::as_f64)
}

fn rom_folders(value: Option<&Value>) -> usize {
    value
        .and_then(|v| v.get("romFolders"))
        .and_then(Value::as_array)
        .map_or(0, Vec::len)
}

/// ConsoleCard's derived state for one config.
#[allow(clippy::too_many_arguments)]
fn card(
    id: &str,
    title: &str,
    emulator: String,
    emulator_tip: String,
    config: Option<&Value>,
    requirement: Option<&str>,
    requirement_met: bool,
    language: &str,
) -> ConsoleCard {
    let executable = text(config, "executablePath");
    let configured = executable.is_some();
    // checkEmulatorExecutable / checkRetroArchExecutable
    let exists = executable
        .as_deref()
        .is_some_and(|p| std::path::Path::new(p).exists());
    let requirement_missing = requirement.is_some() && !requirement_met;
    let ready = configured && exists && !requirement_missing;
    let total = number(config, "totalFiles").unwrap_or(0.0);
    let total_label = shell::tr_with("settings.games_found_other", &[("count", total.into())]);
    let total_text = format!("{}", total as i64);
    let files_label = total_label.replacen(&total_text, "", 1).trim().to_string();
    let last_scan = match number(config, "lastScanAt") {
        Some(ts) if rom_folders(config) > 0 => tw(
            "last_scan_relative",
            &[(
                "value",
                relative_short(ts as i64, now_ms(), language)
                    .as_str()
                    .into(),
            )],
        ),
        _ => tw("no_rom_folder_hint", &[("system", title.into())]),
    };
    let (body, hint_title, hint_text) = if ready {
        ("stats", String::new(), String::new())
    } else if configured && exists {
        let requirement = requirement.unwrap_or("bios");
        (
            "hint",
            t(&format!("{requirement}_missing")),
            tw(
                &format!("{requirement}_missing_hint"),
                &[("name", emulator.as_str().into())],
            ),
        )
    } else if configured {
        (
            "hint",
            t("executable_missing"),
            tw(
                "executable_missing_hint",
                &[("name", emulator.as_str().into())],
            ),
        )
    } else {
        (
            "hint",
            t("setup_required"),
            tw("setup_required_hint", &[("system", title.into())]),
        )
    };
    ConsoleCard {
        id: id.into(),
        title: title.into(),
        emulator: emulator.into(),
        emulator_tip: emulator_tip.into(),
        version: text(config, "detectedVersion").unwrap_or_default().into(),
        configured,
        ready,
        body: body.into(),
        // {totalFiles}, unformatted
        total_files: total_text.clone().into(),
        files_label: files_label.into(),
        last_scan: last_scan.into(),
        hint_title: hint_title.into(),
        hint_text: hint_text.into(),
    }
}

/// The Emulation tab opened: read the saved configs off the UI thread.
pub fn refresh() {
    let Some(db) = shell::db() else { return };
    let language = shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into());
    std::thread::spawn(move || {
        let configs: Vec<(String, Option<Value>)> = SYSTEMS
            .iter()
            .map(|s| (s.to_string(), db.get_in::<Value>(keys::EMULATORS, s)))
            .collect();
        let retroarch = db.get_in::<Value>(keys::RETROARCH, "config");
        let _ = slint::invoke_from_event_loop(move || {
            let mut cards: Vec<ConsoleCard> = configs
                .iter()
                .map(|(system, config)| {
                    card(
                        system,
                        system_title(system),
                        emulator_name(system).to_string(),
                        String::new(),
                        config.as_ref(),
                        match system.as_str() {
                            "ps1" | "ps2" => Some("bios"),
                            "ps3" => Some("firmware"),
                            _ => None,
                        },
                        // TODO(emulators): checkEmulatorBios / checkPs3Firmware
                        true,
                        &language,
                    )
                })
                .collect();
            // RetroArch: the requirement is at least one installed core
            let cores_installed = retroarch
                .as_ref()
                .and_then(|r| r.get("cores"))
                .and_then(Value::as_object)
                .is_some_and(|cores| {
                    cores
                        .values()
                        .any(|c| c.get("installed").and_then(Value::as_bool) == Some(true))
                });
            cards.push(card(
                "retroarch",
                "RetroArch",
                shell::tr_with(
                    "settings.retroarch_supported_cores_other",
                    &[("count", (RETROARCH_CORES.len() as f64).into())],
                ),
                RETROARCH_CORES
                    .iter()
                    .map(|(platforms, label)| format!("{platforms} - {label}"))
                    .collect::<Vec<_>>()
                    .join("\n"),
                retroarch.as_ref(),
                Some("cores"),
                cores_installed,
                &language,
            ));
            with(|s| s.cards = cards);
            layout_rows();
            if let Some(ui) = with(|s| s.ui.upgrade()) {
                ui.global::<EmulationData>().set_loaded(true);
            }
        });
    });
}

/// Dev hook: PS2 configured with no ROM folders (the reference's state)
/// and a PS3 whose executable is gone, without touching the database.
pub fn dev_demo() {
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let language = shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into());
    let ps2 = serde_json::json!({
        "system": "ps2", "binary": "pcsx2", "executablePath": exe,
        "detectedVersion": "2.2.0", "romFolders": [], "totalFiles": 0, "lastScanAt": null
    });
    let ps3 = serde_json::json!({
        "system": "ps3", "binary": "rpcs3", "executablePath": "C:\\missing\\rpcs3.exe",
        "romFolders": [], "totalFiles": 0
    });
    let psp = serde_json::json!({
        "system": "psp", "binary": "ppsspp", "executablePath": exe,
        "romFolders": [{ "path": "D:\\Roms" }], "totalFiles": 42,
        "lastScanAt": now_ms() - 3 * 3_600_000
    });
    with(|s| {
        for card in s.cards.iter_mut() {
            let config = match card.id.as_str() {
                "ps2" => &ps2,
                "ps3" => &ps3,
                "psp" => &psp,
                _ => continue,
            };
            let requirement = match card.id.as_str() {
                "ps2" => Some("bios"),
                "ps3" => Some("firmware"),
                _ => None,
            };
            let id = card.id.to_string();
            *card = self::card(
                &id,
                system_title(&id),
                emulator_name(&id).to_string(),
                String::new(),
                Some(config),
                requirement,
                true,
                &language,
            );
        }
    });
    layout_rows();
}

/// Chunk the cards into grid rows of the current column count.
fn layout_rows() {
    let (cards, columns, ui) = with(|s| (s.cards.clone(), s.columns.max(1), s.ui.upgrade()));
    let Some(ui) = ui else { return };
    let rows: Vec<ConsoleRow> = cards
        .chunks(columns)
        .map(|chunk| ConsoleRow {
            cards: ModelRc::new(VecModel::from(chunk.to_vec())),
            fillers: (columns - chunk.len()) as i32,
        })
        .collect();
    let data = ui.global::<EmulationData>();
    data.set_columns(columns as i32);
    data.set_rows(ModelRc::new(VecModel::from(rows)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_times_like_intl() {
        let now = 1_000_000_000_000;
        assert_eq!(relative_short(now - 30_000, now, "en"), "now");
        assert_eq!(relative_short(now - 5 * 60_000, now, "en"), "5 min. ago");
        assert_eq!(
            relative_short(now - 3 * 3_600_000, now, "en-US"),
            "3 hr. ago"
        );
        assert_eq!(relative_short(now - 26 * 3_600_000, now, "en"), "yesterday");
        assert_eq!(
            relative_short(now - 3 * 86_400_000, now, "en"),
            "3 days ago"
        );
        assert_eq!(
            relative_short(now - 3 * 86_400_000, now, "pt-BR"),
            "há 3 dias"
        );
    }
}
