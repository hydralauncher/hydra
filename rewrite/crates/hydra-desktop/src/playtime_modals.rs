//! ChangeGamePlaytimeModal and ResetPlaytimeModal, opened from the game
//! options modal's danger zone.

use std::cell::RefCell;

use hydra_core::library_actions;
use hydra_db::keys;
use serde_json::{Map, Value};
use slint::{ComponentHandle, ModelRc, VecModel};

use crate::{AppWindow, GameData, PlaytimeColumn, PlaytimeModals, shell, toast};

/// MAX_TOTAL_HOURS
const MAX_TOTAL_HOURS: u64 = 10_000;

#[derive(Default, Clone)]
struct Target {
    shop: String,
    object_id: String,
    /// playTimeInMilliseconds when the modal opened
    hydra: u64,
    steam: u64,
    epic: u64,
}

thread_local! {
    static UI: RefCell<slint::Weak<AppWindow>> = RefCell::new(slint::Weak::default());
    static TARGET: RefCell<Target> = RefCell::new(Target::default());
}

fn with_ui(f: impl FnOnce(&AppWindow)) {
    if let Some(ui) = UI.with(|u| u.borrow().upgrade()) {
        f(&ui);
    }
}

fn t(key: &str) -> String {
    shell::tr(key)
}

fn millis(game: &Map<String, Value>, key: &str) -> u64 {
    game.get(key)
        .and_then(Value::as_f64)
        .map_or(0, |v| v.max(0.0) as u64)
}

/// t("playtime_short", getPlayTimeHoursAndMinutes(ms))
fn short(ms: u64) -> String {
    let total = ms / 60_000;
    shell::tr_with(
        "game_details.playtime_short",
        &[
            ("hours", (total / 60).to_string().into()),
            ("minutes", (total % 60).to_string().into()),
        ],
    )
}

pub fn init(ui: &AppWindow) {
    UI.with(|u| *u.borrow_mut() = ui.as_weak());
    let modals = ui.global::<PlaytimeModals>();
    modals.on_hours_edited(|value| edited(value.as_str(), true));
    modals.on_minutes_edited(|value| edited(value.as_str(), false));
    modals.on_update(submit_update);
    modals.on_reset(submit_reset);
}

fn load(shop: &str, object_id: &str) -> Option<Map<String, Value>> {
    let game =
        shell::db()?.get_in::<Map<String, Value>>(keys::GAMES, &format!("{shop}:{object_id}"))?;
    TARGET.with(|t| {
        *t.borrow_mut() = Target {
            shop: shop.to_string(),
            object_id: object_id.to_string(),
            hydra: millis(&game, "playTimeInMilliseconds"),
            steam: millis(&game, "steamPlayTimeInMilliseconds"),
            epic: millis(&game, "epicPlayTimeInMilliseconds"),
        }
    });
    Some(game)
}

fn description(key: &str, game: &Map<String, Value>) -> String {
    let title = game
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    shell::tr_with(key, &[("game", title.into())])
}

/// The breakdown columns for a new Hydra playtime.
fn columns(next_hydra: u64) -> (Vec<PlaytimeColumn>, bool) {
    let target = TARGET.with(|t| t.borrow().clone());
    // TODO(library): presentation members (other Hydra members' playtime).
    let other = 0;
    let column = |key: &str, label: String, current: u64, next: u64| {
        let (next, current) = (short(next), short(current));
        PlaytimeColumn {
            key: key.into(),
            label: label.into(),
            previous: if next == current {
                "".into()
            } else {
                current.into()
            },
            next: next.into(),
        }
    };
    let list = vec![
        column(
            "hydra",
            t("library.library_hydra"),
            target.hydra,
            next_hydra,
        ),
        column(
            "steam",
            t("library.library_steam"),
            target.steam,
            target.steam,
        ),
        column("epic", t("library.library_epic"), target.epic, target.epic),
        column(
            "total",
            t("game_details.playtime_breakdown_total"),
            target.hydra + target.steam + target.epic,
            next_hydra + target.steam + target.epic,
        ),
    ];
    (list, target.steam > 0 || target.epic > 0 || other > 0)
}

/// Danger zone > Update game playtime
pub fn open_update(shop: &str, object_id: &str) {
    let Some(game) = load(shop, object_id) else {
        return;
    };
    let hydra = millis(&game, "playTimeInMilliseconds");
    let total_minutes = hydra / 60_000;
    with_ui(|ui| {
        let m = ui.global::<PlaytimeModals>();
        m.set_description(description("game_details.update_playtime_description", &game).into());
        m.set_show_warning(
            game.get("hasManuallyUpdatedPlaytime")
                .and_then(Value::as_bool)
                != Some(true),
        );
        if hydra > 0 {
            m.set_hours((total_minutes / 60).to_string().into());
            m.set_minutes((total_minutes % 60).to_string().into());
        } else {
            m.set_hours("".into());
            m.set_minutes("".into());
        }
        m.set_busy(false);
        ui.global::<GameData>().invoke_stacked_modal_opening();
    });
    refresh_update();
    with_ui(|ui| ui.global::<PlaytimeModals>().set_update_open(true));
}

/// Danger zone > Reset playtime
pub fn open_reset(shop: &str, object_id: &str) {
    let Some(game) = load(shop, object_id) else {
        return;
    };
    let (list, show) = columns(0);
    let no_playtime = millis(&game, "playTimeInMilliseconds") == 0
        && game
            .get("hasManuallyUpdatedPlaytime")
            .and_then(Value::as_bool)
            != Some(true);
    with_ui(|ui| {
        let m = ui.global::<PlaytimeModals>();
        m.set_description(description("game_details.reset_playtime_description", &game).into());
        m.set_columns(ModelRc::new(VecModel::from(list)));
        m.set_show_breakdown(show);
        m.set_can_reset(!no_playtime);
        m.set_busy(false);
        ui.global::<GameData>().invoke_stacked_modal_opening();
        m.set_reset_open(true);
    });
}

fn parse(value: &str) -> u64 {
    value.trim().parse::<u64>().unwrap_or(0)
}

/// handleHoursChange / handleMinutesChange: digits only, leading zeros
/// dropped, values over the allowed maximum refused.
fn edited(value: &str, hours: bool) {
    with_ui(|ui| {
        let m = ui.global::<PlaytimeModals>();
        let (previous_hours, previous_minutes) =
            (m.get_hours().to_string(), m.get_minutes().to_string());
        let mut value: String = value.chars().filter(char::is_ascii_digit).collect();
        if value.len() > 1 && value.starts_with('0') {
            value = value.trim_start_matches('0').to_string();
            if value.is_empty() {
                value = "0".into();
            }
        }
        let number = parse(&value);
        if hours {
            let minutes = parse(&previous_minutes);
            let max_hours = MAX_TOTAL_HOURS
                .min((MAX_TOTAL_HOURS as f64 - minutes as f64 / 60.0).floor() as u64);
            m.set_hours(
                if number <= max_hours {
                    value
                } else {
                    previous_hours
                }
                .into(),
            );
        } else {
            let hours = parse(&previous_hours);
            let max_minutes = if hours >= MAX_TOTAL_HOURS {
                0
            } else {
                59.min((MAX_TOTAL_HOURS - hours) * 60)
            };
            m.set_minutes(
                if number <= max_minutes {
                    value
                } else {
                    previous_minutes
                }
                .into(),
            );
        }
    });
    refresh_update();
}

fn entered_seconds(m: &PlaytimeModals) -> u64 {
    parse(&m.get_hours()) * 3600 + parse(&m.get_minutes()) * 60
}

fn refresh_update() {
    let hydra = TARGET.with(|t| t.borrow().hydra);
    with_ui(|ui| {
        let m = ui.global::<PlaytimeModals>();
        let seconds = entered_seconds(&m);
        let (list, show) = columns(seconds * 1000);
        m.set_columns(ModelRc::new(VecModel::from(list)));
        m.set_show_breakdown(show);
        let valid = !m.get_hours().is_empty() || !m.get_minutes().is_empty();
        let unchanged = seconds / 60 == hydra / 60_000;
        m.set_unchanged(unchanged);
        m.set_can_update(valid && !unchanged && !m.get_busy());
    });
}

fn after(
    success: &str,
    failure: &str,
    result: Result<(), library_actions::ActionError>,
    close: impl FnOnce(&PlaytimeModals),
) {
    with_ui(|ui| {
        let m = ui.global::<PlaytimeModals>();
        m.set_busy(false);
        match result {
            Ok(()) => {
                toast::success(&t(success));
                close(&m);
            }
            Err(error) => {
                eprintln!("{failure}: {error}");
                toast::error(&t(failure));
            }
        }
    });
    crate::game_options::refresh_open();
    shell::load_library();
}

fn submit_update() {
    let target = TARGET.with(|t| t.borrow().clone());
    let mut seconds = 0;
    with_ui(|ui| {
        let m = ui.global::<PlaytimeModals>();
        seconds = entered_seconds(&m);
        m.set_busy(true);
        m.set_can_update(false);
    });
    let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
        return;
    };
    std::thread::spawn(move || {
        let result =
            library_actions::change_playtime(&db, &api, &target.shop, &target.object_id, seconds);
        let _ = slint::invoke_from_event_loop(move || {
            // onError keeps the modal open in Electron; onSuccess closes it.
            let ok = result.is_ok();
            after(
                "game_details.update_playtime_success",
                "game_details.update_playtime_error",
                result,
                |m| {
                    if ok {
                        m.set_update_open(false);
                    }
                },
            );
        });
    });
}

fn submit_reset() {
    let target = TARGET.with(|t| t.borrow().clone());
    with_ui(|ui| ui.global::<PlaytimeModals>().set_busy(true));
    let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
        return;
    };
    std::thread::spawn(move || {
        let result = library_actions::reset_playtime(&db, &api, &target.shop, &target.object_id);
        let _ = slint::invoke_from_event_loop(move || {
            // handleResetPlaytime closes the modal either way.
            with_ui(|ui| ui.global::<PlaytimeModals>().set_reset_open(false));
            after(
                "game_details.reset_playtime_success",
                "game_details.reset_playtime_error",
                result,
                |_| {},
            );
        });
    });
}
