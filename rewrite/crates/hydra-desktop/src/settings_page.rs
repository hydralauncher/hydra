//! pages/settings: the category list and the General tab
//! (settings-context-general.tsx). Other tabs are still TODO.

use std::cell::RefCell;

use hydra_core::download_directories::{self, Prepared};
use serde_json::{Map, Value, json};
use slint::{ComponentHandle, ModelRc, VecModel};

use crate::{AppWindow, SelectOption, SettingsCategory, SettingsData, prefs, shell, toast};

thread_local! {
    static UI: RefCell<slint::Weak<AppWindow>> = RefCell::new(slint::Weak::default());
}

fn with_ui(f: impl FnOnce(&AppWindow)) {
    if let Some(ui) = UI.with(|u| u.borrow().upgrade()) {
        f(&ui);
    }
}

fn t(key: &str) -> String {
    shell::tr(key)
}

/// The categories in settings.tsx order (Big Picture is not part of the rewrite).
fn categories() -> Vec<(String, String, String)> {
    let mut list = vec![
        ("general", t("settings.general"), ""),
        ("downloads", t("settings.downloads"), ""),
        ("download_sources", t("settings.download_sources"), ""),
        ("notifications", t("settings.notifications"), ""),
        ("content_gameplay", t("settings.content_gameplay"), ""),
    ]
    .into_iter()
    .map(|(a, b, c)| (a.to_string(), b, c.to_string()))
    .collect::<Vec<_>>();
    if crate::features::enabled("SCREENSHOTS") {
        list.push((
            "screenshots".into(),
            t("settings.screenshots_category"),
            "".into(),
        ));
    }
    list.push(("integrations".into(), t("settings.integrations"), "".into()));
    list.push((
        "compatibility".into(),
        t("settings.compatibility"),
        "".into(),
    ));
    if shell::signed_in() {
        list.push((
            "account_privacy".into(),
            format!("{} & {}", t("settings.account"), t("settings.privacy")),
            "".into(),
        ));
    }
    list.push((
        "emulation".into(),
        t("settings.emulation"),
        "classics".into(),
    ));
    list
}

pub fn init(ui: &AppWindow) {
    UI.with(|u| *u.borrow_mut() = ui.as_weak());
    let data = ui.global::<SettingsData>();
    data.on_select_category(|id| select(&id));
    data.on_toggle(|key| toggle(&key));
    data.on_language_selected(|code| {
        prefs::update(Map::from_iter([(
            "language".to_string(),
            json!(code.to_string()),
        )]));
        refresh();
    });
    data.on_change_downloads_path(change_downloads_path);
}

/// The /settings route opened (`?tab=` picks the category).
pub fn open(tab: Option<&str>) {
    refresh();
    let category = tab
        .filter(|tab| categories().iter().any(|(id, _, _)| id == tab))
        .unwrap_or("general")
        .to_string();
    select(&category);
}

fn select(id: &str) {
    let label = categories()
        .into_iter()
        .find(|(c, _, _)| c == id)
        .map(|(_, l, _)| l)
        .unwrap_or_default();
    with_ui(|ui| {
        let data = ui.global::<SettingsData>();
        data.set_category(id.into());
        data.set_category_label(label.into());
    });
}

/// resolveLanguage
fn resolve_language(language: Option<&str>) -> String {
    let languages: Vec<&str> = hydra_i18n::languages().collect();
    let language = language.unwrap_or("en");
    if let Some(exact) = languages.iter().find(|l| **l == language) {
        return exact.to_string();
    }
    let base = language.split('-').next().unwrap_or("en");
    languages
        .iter()
        .find(|l| l.starts_with(base))
        .map_or_else(|| "en".to_string(), |l| l.to_string())
}

pub fn refresh() {
    let p = prefs::get();
    let fallback = prefs::default_downloads_path();
    let downloads_path = p
        .get("downloadsPath")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map_or(fallback, str::to_string);
    let language = resolve_language(p.get("language").and_then(Value::as_str));
    // LANGUAGE_OPTIONS: ordered by native name
    let mut options: Vec<SelectOption> = hydra_i18n::languages()
        .map(|code| SelectOption {
            value: code.into(),
            label: hydra_i18n::language_name(code)
                .unwrap_or_else(|| code.to_string())
                .into(),
        })
        .collect();
    options.sort_by(|a, b| a.label.as_str().cmp(b.label.as_str()));
    let language_label = options
        .iter()
        .find(|o| o.value == language.as_str())
        .map(|o| o.label.clone())
        .unwrap_or_default();
    let list: Vec<SettingsCategory> = {
        let mut previous = String::new();
        categories()
            .into_iter()
            .map(|(id, label, group)| {
                let start = !group.is_empty() && group != previous;
                previous = group.clone();
                SettingsCategory {
                    id: id.into(),
                    label: label.into(),
                    group: group.into(),
                    group_start: start,
                }
            })
            .collect()
    };
    with_ui(|ui| {
        let data = ui.global::<SettingsData>();
        data.set_categories(ModelRc::new(VecModel::from(list)));
        data.set_downloads_path(downloads_path.into());
        data.set_language(language.into());
        data.set_language_label(language_label);
        data.set_language_options(ModelRc::new(VecModel::from(options)));
        // window.electron.isPortableVersion
        data.set_show_run_at_startup(std::env::var_os("PORTABLE_EXECUTABLE_FILE").is_none());
        data.set_linux(cfg!(target_os = "linux"));
        data.set_prefer_quit(prefs::flag(&p, "preferQuitInsteadOfHiding"));
        data.set_hide_to_tray(prefs::flag(&p, "hideToTrayOnGameStart"));
        data.set_run_at_startup(prefs::flag(&p, "runAtStartup"));
        data.set_start_minimized(prefs::flag(&p, "startMinimized"));
        data.set_launch_to_library(prefs::flag(&p, "launchToLibraryPage"));
        data.set_open_friends(prefs::flag(&p, "openFriendsWindowOnStartup"));
        data.set_enable_auto_install(prefs::flag(&p, "enableAutoInstall"));
        data.set_native_decorations(prefs::flag(&p, "useNativeWindowDecorations"));
    });
}

fn toggle(key: &str) {
    let p = prefs::get();
    if key == "startMinimized" && !prefs::flag(&p, "runAtStartup") {
        return;
    }
    let value = !prefs::flag(&p, key);
    prefs::update(Map::from_iter([(key.to_string(), json!(value))]));
    if key == "runAtStartup" || key == "startMinimized" {
        // TODO(settings): window.electron.autoLaunch (the OS login item).
        eprintln!(
            "TODO(settings): autoLaunch enabled={} minimized={}",
            prefs::flag(&prefs::get(), "runAtStartup"),
            prefs::flag(&prefs::get(), "startMinimized")
        );
    }
    refresh();
}

/// handleChooseDownloadsPath
fn change_downloads_path() {
    let p = prefs::get();
    let fallback = prefs::default_downloads_path();
    let current = p
        .get("downloadsPath")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map_or(fallback.clone(), str::to_string);
    let Some(picked) = rfd::FileDialog::new().set_directory(&current).pick_folder() else {
        return;
    };
    if fallback.is_empty() {
        return;
    }
    match download_directories::prepare_default_path_sync(&p, &picked.to_string_lossy(), &fallback)
    {
        Prepared::Noop => {}
        Prepared::Set { preferences, .. } => {
            prefs::update(preferences);
            refresh();
        }
        Prepared::ReplaceRequired { .. } => {
            // TODO(settings): DownloadDirectoryReplacementModal (all four saved slots are used).
            toast::error(&t("settings.replace_download_directory"));
        }
    }
}
