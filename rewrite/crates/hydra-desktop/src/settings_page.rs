//! pages/settings: the category list and the General tab
//! (settings-context-general.tsx). Other tabs are still TODO.

use std::cell::RefCell;

use hydra_core::download_directories::{self, Prepared};
use serde_json::{Map, Value, json};
use slint::{ComponentHandle, ModelRc, VecModel};

use crate::{AppWindow, SelectOption, SettingsCategory, SettingsData, prefs, shell, toast};

thread_local! {
    static UI: RefCell<slint::Weak<AppWindow>> = RefCell::new(slint::Weak::default());
    static TRACKERS_TIMER: RefCell<Option<slint::Timer>> = const { RefCell::new(None) };
    static VOLUME_TIMER: RefCell<Option<slint::Timer>> = const { RefCell::new(None) };
}

/// Preferences whose checkbox defaults to on (buildForm's `?? true`).
fn pref_bool(p: &Map<String, Value>, key: &str) -> bool {
    let default = matches!(
        key,
        "extractFilesByDefault"
            | "deleteArchiveFilesAfterExtractionByDefault"
            | "createStartMenuShortcut"
            | "friendStartGameNotificationsEnabled"
            | "chatMessageNotificationsEnabled"
            | "leaderboardSlamEnabled"
            | "leaderboardDropNotificationsEnabled"
            | "achievementNotificationsEnabled"
            | "achievementCustomNotificationsEnabled"
    );
    p.get(key).and_then(Value::as_bool).unwrap_or(default)
}

/// formatLimitInputValue
fn format_limit(bytes: f64, megabytes: bool) -> String {
    let value = if megabytes {
        bytes / (1024.0 * 1024.0)
    } else {
        bytes * 8.0 / 1e6
    };
    if value.fract() == 0.0 {
        format!("{value}")
    } else {
        let rounded = (value * 100.0).round() / 100.0;
        format!("{rounded}")
    }
}

/// parseLimitInputToBytesPerSecond: Ok(None) clears the limit, Err for garbage.
fn parse_limit(text: &str, megabytes: bool) -> Result<Option<u64>, ()> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    // Number.parseFloat reads the leading number
    let end = trimmed
        .char_indices()
        .take_while(|(i, c)| {
            c.is_ascii_digit() || *c == '.' || (*i == 0 && (*c == '-' || *c == '+'))
        })
        .count();
    let parsed: f64 = trimmed[..end].parse().map_err(|_| ())?;
    if parsed <= 0.0 {
        return Ok(None);
    }
    Ok(Some(if megabytes {
        (parsed * 1024.0 * 1024.0).floor()
    } else {
        (parsed * 1e6 / 8.0).floor()
    } as u64))
}

/// getNetworkInterfaces: non-internal interfaces, IPv4 first.
fn network_interfaces() -> Vec<(String, Vec<String>)> {
    let mut list: Vec<(String, Vec<String>)> = Vec::new();
    for iface in if_addrs::get_if_addrs().unwrap_or_default() {
        if iface.is_loopback() {
            continue;
        }
        let address = iface.ip().to_string();
        match list.iter_mut().find(|(name, _)| *name == iface.name) {
            Some((_, addresses)) => addresses.push(address),
            None => list.push((iface.name.clone(), vec![address])),
        }
    }
    for (_, addresses) in &mut list {
        addresses.sort_by_key(|a| a.contains(':'));
    }
    list
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
    data.on_max_speed_committed(commit_max_speed);
    data.on_position_selected(|value| {
        prefs::update(Map::from_iter([(
            "achievementCustomNotificationPosition".to_string(),
            json!(value.to_string()),
        )]));
        // TODO(notifications): updateAchievementCustomNotificationWindow
        refresh();
    });
    data.on_test_notification(|| eprintln!("TODO(notifications): showAchievementTestNotification"));
    data.on_volume_changed(|value| {
        // 300ms debounce, stored as 0..1
        let timer = slint::Timer::default();
        timer.start(
            slint::TimerMode::SingleShot,
            std::time::Duration::from_millis(300),
            move || {
                prefs::update(Map::from_iter([(
                    "achievementSoundVolume".to_string(),
                    json!(value as f64 / 100.0),
                )]));
            },
        );
        VOLUME_TIMER.with(|t| *t.borrow_mut() = Some(timer));
    });
    data.on_network_selected(|value| {
        prefs::update(Map::from_iter([(
            "torrentNetworkInterface".to_string(),
            json!(value.to_string()),
        )]));
        // TODO(torrent): bind the torrent session to the adapter.
        refresh();
    });
    data.on_trackers_edited(|| {
        // debounce(save, 1000)
        let timer = slint::Timer::default();
        timer.start(
            slint::TimerMode::SingleShot,
            std::time::Duration::from_millis(1000),
            save_trackers_from_form,
        );
        TRACKERS_TIMER.with(|t| *t.borrow_mut() = Some(timer));
    });
    data.on_trackers_url_committed(|| {
        TRACKERS_TIMER.with(|t| *t.borrow_mut() = None);
        save_trackers_from_form();
    });
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
    if id == "download_sources" {
        crate::settings_sources::refresh();
    } else {
        crate::settings_sources::leave();
    }
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
    refresh_downloads(&p);
    refresh_notifications(&p);
}

/// userDetails.allowLeaderboardNotifications ?? true
fn leaderboard_notifications() -> bool {
    shell::user_details()
        .and_then(|u| {
            u.get("allowLeaderboardNotifications")
                .and_then(Value::as_bool)
        })
        .unwrap_or(true)
}

fn refresh_notifications(p: &Map<String, Value>) {
    let position = p
        .get("achievementCustomNotificationPosition")
        .and_then(Value::as_str)
        .unwrap_or("top-left")
        .to_string();
    let options: Vec<SelectOption> = [
        "top-left",
        "top-center",
        "top-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
    ]
    .iter()
    .map(|p| SelectOption {
        value: (*p).into(),
        label: t(&format!("settings.{p}")).into(),
    })
    .collect();
    let position_label = options
        .iter()
        .find(|o| o.value == position.as_str())
        .map(|o| o.label.clone())
        .unwrap_or_default();
    let volume = (p
        .get("achievementSoundVolume")
        .and_then(Value::as_f64)
        .unwrap_or(0.15)
        * 100.0)
        .round() as i32;
    with_ui(|ui| {
        let data = ui.global::<SettingsData>();
        data.set_notify_download(pref_bool(p, "downloadNotificationsEnabled"));
        data.set_notify_repack(pref_bool(p, "repackUpdatesNotificationsEnabled"));
        data.set_notify_friend_request(pref_bool(p, "friendRequestNotificationsEnabled"));
        data.set_notify_friend_game(pref_bool(p, "friendStartGameNotificationsEnabled"));
        data.set_notify_chat(pref_bool(p, "chatMessageNotificationsEnabled"));
        data.set_show_leaderboard(
            shell::signed_in() && crate::features::enabled("GLOBAL_LEADERBOARDS"),
        );
        data.set_leaderboard_notifications(leaderboard_notifications());
        data.set_leaderboard_slam(pref_bool(p, "leaderboardSlamEnabled"));
        data.set_leaderboard_drop(pref_bool(p, "leaderboardDropNotificationsEnabled"));
        data.set_notify_achievements(pref_bool(p, "achievementNotificationsEnabled"));
        data.set_notify_achievements_custom(pref_bool(p, "achievementCustomNotificationsEnabled"));
        data.set_position_options(ModelRc::new(VecModel::from(options)));
        data.set_position(position.into());
        data.set_position_label(position_label);
        data.set_volume(volume);
    });
}

/// toggleLeaderboardNotifications: PATCH /profile, reverted on failure.
fn toggle_leaderboard_notifications() {
    let next = !leaderboard_notifications();
    with_ui(|ui| {
        ui.global::<SettingsData>()
            .set_leaderboard_notifications(next)
    });
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let result = api.patch(
            "/profile",
            &json!({ "allowLeaderboardNotifications": next }),
            hydra_core::api::Options::default(),
        );
        let _ = slint::invoke_from_event_loop(move || match result {
            Ok(_) => shell::patch_user_details(&Map::from_iter([(
                "allowLeaderboardNotifications".to_string(),
                json!(next),
            )])),
            Err(error) => {
                eprintln!("Failed to update leaderboard notifications: {error}");
                with_ui(|ui| {
                    ui.global::<SettingsData>()
                        .set_leaderboard_notifications(!next)
                });
            }
        });
    });
}

fn refresh_downloads(p: &Map<String, Value>) {
    let megabytes = prefs::flag(p, "showDownloadSpeedInMegabytes");
    let limit = p
        .get("maxDownloadSpeedBytesPerSecond")
        .and_then(Value::as_f64)
        .filter(|v| *v > 0.0);
    let unit = if megabytes { "MB/s" } else { "Mbps" };
    let hint_unit = if megabytes {
        t("settings.max_download_speed_unit_megabytes")
    } else {
        t("settings.max_download_speed_unit_megabits")
    };
    let selected = p
        .get("torrentNetworkInterface")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut options = vec![SelectOption {
        value: "".into(),
        label: t("settings.network_interface_default").into(),
    }];
    for (name, addresses) in network_interfaces() {
        let label = match addresses.iter().find(|a| !a.contains(':')) {
            Some(ipv4) => format!("{name} ({ipv4})"),
            None => name.clone(),
        };
        options.push(SelectOption {
            value: name.into(),
            label: label.into(),
        });
    }
    if !selected.is_empty() && !options.iter().any(|o| o.value == selected.as_str()) {
        let label = format!(
            "{selected} ({})",
            t("settings.network_interface_unavailable")
        );
        options.push(SelectOption {
            value: selected.clone().into(),
            label: label.into(),
        });
    }
    let network_label = options
        .iter()
        .find(|o| o.value == selected.as_str())
        .map(|o| o.label.clone())
        .unwrap_or_default();
    let longest = options
        .iter()
        .map(|o| o.label.to_string())
        .max_by_key(|l| l.chars().count())
        .unwrap_or_default();
    let manual = p
        .get("globalTrackers")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    with_ui(|ui| {
        let data = ui.global::<SettingsData>();
        data.set_max_speed(
            limit
                .map(|b| format_limit(b, megabytes))
                .unwrap_or_default()
                .into(),
        );
        data.set_max_speed_label(
            shell::tr_with("settings.max_download_speed", &[("unit", unit.into())]).into(),
        );
        data.set_max_speed_hint(
            shell::tr_with(
                "settings.max_download_speed_hint",
                &[("unit", hint_unit.into())],
            )
            .into(),
        );
        data.set_network_options(ModelRc::new(VecModel::from(options)));
        data.set_network_interface(selected.into());
        data.set_network_label(network_label);
        data.set_network_longest(longest.into());
        data.set_seed_after(pref_bool(p, "seedAfterDownloadComplete"));
        data.set_extract_by_default(pref_bool(p, "extractFilesByDefault"));
        data.set_speed_in_megabytes(megabytes);
        data.set_delete_archives(pref_bool(p, "deleteArchiveFilesAfterExtractionByDefault"));
        data.set_show_shortcuts(cfg!(any(windows, target_os = "linux")));
        data.set_create_shortcuts(pref_bool(p, "createStartMenuShortcut"));
        data.set_append_trackers(prefs::flag(p, "appendGlobalTrackers"));
        data.set_append_trackers_url(prefs::flag(p, "appendGlobalTrackersUrl"));
        data.set_manual_trackers(manual.into());
        data.set_trackers_url(
            p.get("globalTrackersUrl")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into(),
        );
        data.set_trackers_error("".into());
    });
}

/// handleMaxDownloadSpeedBlur
fn commit_max_speed() {
    let p = prefs::get();
    let megabytes = prefs::flag(&p, "showDownloadSpeedInMegabytes");
    let mut text = String::new();
    with_ui(|ui| text = ui.global::<SettingsData>().get_max_speed().to_string());
    let bytes = parse_limit(&text, megabytes).unwrap_or(None);
    prefs::update(Map::from_iter([(
        "maxDownloadSpeedBytesPerSecond".to_string(),
        bytes.map_or(Value::Null, |b| json!(b)),
    )]));
    // TODO(downloads): applyDownloadManagerPreferences (live speed limit).
    with_ui(|ui| {
        ui.global::<SettingsData>().set_max_speed(
            bytes
                .map(|b| format_limit(b as f64, megabytes))
                .unwrap_or_default()
                .into(),
        );
    });
}

/// isValidTrackerUrl: http(s)/udp/ws(s) with a host
fn valid_tracker(url: &str) -> bool {
    if url.contains(":///") {
        return false;
    }
    let Some((scheme, rest)) = url.split_once("://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let host = host.rsplit('@').next().unwrap_or_default();
    let host = host.split(':').next().unwrap_or_default();
    matches!(
        scheme.to_ascii_lowercase().as_str(),
        "http" | "https" | "udp" | "ws" | "wss"
    ) && !host.is_empty()
}

/// parseTrackerList
fn parse_trackers(text: &str) -> Vec<String> {
    let mut list: Vec<String> = Vec::new();
    for line in text.split(['\r', '\n']).map(str::trim) {
        if !line.is_empty() && !line.starts_with('#') && !list.iter().any(|l| l == line) {
            list.push(line.to_string());
        }
    }
    list
}

/// saveGlobalTrackers with the form's current values
fn save_trackers_from_form() {
    let (mut manual, mut url) = (String::new(), String::new());
    with_ui(|ui| {
        let data = ui.global::<SettingsData>();
        manual = data.get_manual_trackers().to_string();
        url = data.get_trackers_url().to_string();
    });
    let p = prefs::get();
    save_trackers(
        &manual,
        &url,
        prefs::flag(&p, "appendGlobalTrackers"),
        prefs::flag(&p, "appendGlobalTrackersUrl"),
    );
}

fn save_trackers(manual: &str, url: &str, append_manual: bool, append_url: bool) {
    let Some(db) = shell::db() else { return };
    let mut p = prefs::get();
    let previous_url = p
        .get("globalTrackersUrl")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let trimmed = url.trim().to_string();
    let valid: Vec<Value> = parse_trackers(manual)
        .into_iter()
        .filter(|t| valid_tracker(t))
        .map(Value::from)
        .collect();
    p.insert("globalTrackers".into(), Value::Array(valid));
    p.insert("appendGlobalTrackers".into(), json!(append_manual));
    p.insert("globalTrackersUrl".into(), json!(trimmed));
    p.insert("appendGlobalTrackersUrl".into(), json!(append_url));
    if db.put(hydra_db::keys::USER_PREFERENCES, &p).is_err() {
        with_ui(|ui| {
            ui.global::<SettingsData>()
                .set_trackers_error(t("settings.global_trackers_save_error").into())
        });
        return;
    }
    if !append_url || trimmed.is_empty() || trimmed != previous_url {
        let _ = db.delete(hydra_db::keys::GLOBAL_TRACKERS_URL_CACHE);
    }
}

fn toggle(key: &str) {
    if key == "allowLeaderboardNotifications" {
        toggle_leaderboard_notifications();
        return;
    }
    let p = prefs::get();
    if (key == "leaderboardSlamEnabled" || key == "leaderboardDropNotificationsEnabled")
        && !leaderboard_notifications()
    {
        return;
    }
    if key == "achievementCustomNotificationsEnabled"
        && !pref_bool(&p, "achievementNotificationsEnabled")
    {
        return;
    }
    if key == "appendGlobalTrackers" || key == "appendGlobalTrackersUrl" {
        // handleToggleManual / handleToggleUrl save right away
        TRACKERS_TIMER.with(|t| *t.borrow_mut() = None);
        let (mut manual, mut url) = (String::new(), String::new());
        with_ui(|ui| {
            let data = ui.global::<SettingsData>();
            manual = data.get_manual_trackers().to_string();
            url = data.get_trackers_url().to_string();
        });
        let mut append_manual = prefs::flag(&p, "appendGlobalTrackers");
        let mut append_url = prefs::flag(&p, "appendGlobalTrackersUrl");
        if key == "appendGlobalTrackers" {
            append_manual = !append_manual;
        } else {
            append_url = !append_url;
        }
        save_trackers(&manual, &url, append_manual, append_url);
        with_ui(|ui| {
            let data = ui.global::<SettingsData>();
            data.set_append_trackers(append_manual);
            data.set_append_trackers_url(append_url);
        });
        return;
    }
    if key == "startMinimized" && !prefs::flag(&p, "runAtStartup") {
        return;
    }
    let value = !pref_bool(&p, key);
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
