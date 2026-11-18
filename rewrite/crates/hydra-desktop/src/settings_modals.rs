//! Settings modals with their own layout (ui/pages/settings/modals.slint):
//! DownloadDirectoryReplacementModal and the RetroAchievements disconnect
//! modal. Plain confirmations go through `dialogs::confirm`.

use std::cell::RefCell;
use std::rc::Rc;

use hydra_core::download_directories::{self, Directory};
use hydra_media::images;
use slint::{ComponentHandle, Image, ModelRc, VecModel};

use crate::{AppWindow, SelectOption, SettingsModals, prefs, shell};

thread_local! {
    static UI: RefCell<slint::Weak<AppWindow>> = RefCell::new(slint::Weak::default());
    static ON_RA_CONFIRM: RefCell<Option<Rc<dyn Fn(bool)>>> = const { RefCell::new(None) };
    static ON_REPLACED: RefCell<Option<Rc<dyn Fn()>>> = const { RefCell::new(None) };
}

fn window() -> Option<AppWindow> {
    UI.with(|u| u.borrow().upgrade())
}

pub fn init(ui: &AppWindow) {
    UI.with(|u| *u.borrow_mut() = ui.as_weak());
    let modals = ui.global::<SettingsModals>();
    modals.on_replacement_selected(|path| {
        if let Some(ui) = window() {
            let modals = ui.global::<SettingsModals>();
            let label = option_label(&path);
            modals.set_replacement(path);
            modals.set_replacement_label(label.into());
        }
    });
    modals.on_confirm_replacement(confirm_replacement);
    modals.on_confirm_ra_disconnect(|| {
        let delete =
            window().is_some_and(|ui| ui.global::<SettingsModals>().get_delete_achievements());
        close();
        if let Some(action) = ON_RA_CONFIRM.with(|a| a.borrow().clone()) {
            action(delete);
        }
    });
    modals.on_cancelled(|| {});
}

/// backdrop-filter: blur(2px) from a snapshot of the window (dialogs.rs).
fn snapshot_backdrop(ui: &AppWindow) {
    let modals = ui.global::<SettingsModals>();
    modals.set_backdrop(Image::default());
    let Ok(snapshot) = ui.window().take_snapshot() else {
        return;
    };
    let scale = ui.window().scale_factor();
    let (w, h) = (snapshot.width(), snapshot.height());
    let rgba = snapshot.as_bytes().to_vec();
    let weak = ui.as_weak();
    std::thread::spawn(move || {
        let Some(pixels) = images::blur_rgba(w, h, rgba, 2, scale) else {
            return;
        };
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = weak.upgrade() {
                ui.global::<SettingsModals>()
                    .set_backdrop(pixels.into_image());
            }
        });
    });
}

pub fn close() {
    if let Some(ui) = window() {
        let modals = ui.global::<SettingsModals>();
        modals.set_busy(false);
        modals.set_close_request(modals.get_close_request() + 1);
    }
}

/// getDownloadDirectoryTitle: the last path segment.
pub fn directory_title(path: &str) -> String {
    path.split(['\\', '/'])
        .filter(|s| !s.is_empty())
        .next_back()
        .map_or_else(|| path.to_string(), str::to_string)
}

fn option_label(path: &str) -> String {
    format!("{} — {path}", directory_title(path))
}

/// The modal for a full saved-directory list (handleChooseDownloadsPath's
/// "replace-required" action). `on_replaced` runs after the new preferences
/// are saved.
pub fn open_replacement(
    next_path: &str,
    directories: &[Directory],
    recommended: &str,
    on_replaced: impl Fn() + 'static,
) {
    let Some(ui) = window() else { return };
    snapshot_backdrop(&ui);
    let options: Vec<SelectOption> = directories
        .iter()
        .map(|d| SelectOption {
            value: d.path.clone().into(),
            label: option_label(&d.path).into(),
        })
        .collect();
    let longest = options
        .iter()
        .map(|o| o.label.to_string())
        .max_by_key(|l| l.chars().count())
        .unwrap_or_default();
    let modals = ui.global::<SettingsModals>();
    modals.set_next_path(next_path.into());
    modals.set_directories(ModelRc::new(VecModel::from(options)));
    modals.set_replacement(recommended.into());
    modals.set_replacement_label(if recommended.is_empty() {
        Default::default()
    } else {
        option_label(recommended).into()
    });
    modals.set_replacement_longest(longest.into());
    modals.set_busy(false);
    ON_REPLACED.with(|r| *r.borrow_mut() = Some(Rc::new(on_replaced)));
    modals.set_kind("replace-directory".into());
}

/// handleConfirmDownloadDirectoryReplacement
fn confirm_replacement() {
    let Some(ui) = window() else { return };
    let modals = ui.global::<SettingsModals>();
    let next = modals.get_next_path().to_string();
    let to_replace = modals.get_replacement().to_string();
    let fallback = prefs::default_downloads_path();
    if to_replace.is_empty() || fallback.is_empty() {
        return;
    }
    let (preferences, _) =
        download_directories::replace_and_set_default(&prefs::get(), &next, &to_replace, &fallback);
    close();
    prefs::update(preferences);
    if let Some(action) = ON_REPLACED.with(|r| r.borrow().clone()) {
        action();
    }
}

/// The RetroAchievements disconnect modal; `on_confirm(delete_achievements)`.
pub fn open_ra_disconnect(on_confirm: impl Fn(bool) + 'static) {
    let Some(ui) = window() else { return };
    snapshot_backdrop(&ui);
    let modals = ui.global::<SettingsModals>();
    modals.set_delete_achievements(true);
    modals.set_busy(false);
    ON_RA_CONFIRM.with(|a| *a.borrow_mut() = Some(Rc::new(on_confirm)));
    modals.set_kind("ra-disconnect".into());
}

#[allow(dead_code)]
pub fn is_open() -> bool {
    window().is_some_and(|ui| !ui.global::<SettingsModals>().get_kind().is_empty())
}

#[allow(dead_code)]
fn tr(key: &str) -> String {
    shell::tr(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_title_is_the_last_segment() {
        assert_eq!(directory_title("C:\\Games\\Hydra"), "Hydra");
        assert_eq!(directory_title("/home/me/Games/"), "Games");
        assert_eq!(directory_title("D:\\"), "D:");
        assert_eq!(directory_title("/"), "/");
    }
}
