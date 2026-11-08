//! settings-download-sources.tsx, add-download-source-modal.tsx and the
//! download-sources events (sync, add, remove).

use std::cell::RefCell;
use std::time::Duration;

use hydra_core::api::Options;
use hydra_db::keys;
use serde_json::{Value, json};
use slint::{ComponentHandle, ModelRc, VecModel};

use crate::{AppWindow, Session, SettingsData, SourceCard, shell, toast};

thread_local! {
    static UI: RefCell<slint::Weak<AppWindow>> = RefCell::new(slint::Weak::default());
    /// Polls every 5s while a source is still being matched.
    static POLL: RefCell<Option<slint::Timer>> = const { RefCell::new(None) };
}

fn with_ui(f: impl FnOnce(&AppWindow)) {
    if let Some(ui) = UI.with(|u| u.borrow().upgrade()) {
        f(&ui);
    }
}

fn t(key: &str) -> String {
    shell::tr(key)
}

/// HydraApi.isLoggedIn() && hasActiveSubscription()
fn subscribed() -> bool {
    let mut active = false;
    with_ui(|ui| active = ui.global::<Session>().get_has_subscription());
    shell::signed_in() && active
}

fn pending(source: &Value) -> bool {
    matches!(
        source.get("status").and_then(Value::as_str),
        Some("PENDING_MATCHING") | Some("MATCHING")
    )
}

/// orderBy(downloadSources, "createdAt", "desc")
fn sources() -> Vec<Value> {
    let mut list: Vec<Value> = shell::db()
        .and_then(|db| db.values(keys::DOWNLOAD_SOURCES).ok())
        .unwrap_or_default();
    list.sort_by(|a, b| {
        let at = |v: &Value| {
            v.get("createdAt")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        at(b).cmp(&at(a))
    });
    list
}

pub fn init(ui: &AppWindow) {
    UI.with(|u| *u.borrow_mut() = ui.as_weak());
    let data = ui.global::<SettingsData>();
    data.on_sync_sources(|| sync(true));
    data.on_remove_source(|id| remove(Some(id.to_string())));
    data.on_remove_all_sources(confirm_remove_all);
    data.on_add_source(|| open_add_modal(""));
    data.on_open_source_in_catalogue(|fingerprint| {
        crate::catalogue_page::show_download_source(&fingerprint);
        crate::nav::navigate("/catalogue");
    });
}

/// Fill the list (and start or stop polling while sources are matching).
pub fn refresh() {
    let list = sources();
    let language = shell::i18n();
    let cards: Vec<SourceCard> = list
        .iter()
        .map(|s| {
            let text = |k: &str| {
                s.get(k)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            };
            let status = match text("status").as_str() {
                "PENDING_MATCHING" => t("settings.download_source_pending_matching"),
                "MATCHED" => t("settings.download_source_matched"),
                "MATCHING" => t("settings.download_source_matching"),
                "FAILED" => t("settings.download_source_failed"),
                "DEAD" => t("settings.download_source_dead"),
                _ => String::new(),
            };
            let count = s
                .get("downloadCount")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            let count_label = if pending(s) {
                t("settings.download_source_no_information")
            } else {
                let formatted = language
                    .as_ref()
                    .map(|i| i.format_number(count))
                    .unwrap_or_else(|| count.to_string());
                language
                    .as_ref()
                    .map(|i| {
                        i.t_count(
                            "settings.download_count",
                            count,
                            &[("countFormatted", formatted.into())],
                        )
                    })
                    .unwrap_or_default()
            };
            SourceCard {
                id: s
                    .get("id")
                    .map(|v| {
                        v.as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| v.to_string())
                    })
                    .unwrap_or_default()
                    .into(),
                name: text("name").into(),
                url: text("url").into(),
                status_label: status.into(),
                pending: pending(s),
                count_label: count_label.into(),
                fingerprint: text("fingerprint").into(),
            }
        })
        .collect();
    let any_pending = list.iter().any(pending);
    with_ui(|ui| {
        let data = ui.global::<SettingsData>();
        data.set_sources(ModelRc::new(VecModel::from(cards)));
        data.set_sources_loaded(true);
    });
    let polling = POLL.with(|p| p.borrow().is_some());
    if any_pending && !polling {
        let timer = slint::Timer::default();
        timer.start(slint::TimerMode::Repeated, Duration::from_secs(5), || {
            sync(false)
        });
        POLL.with(|p| *p.borrow_mut() = Some(timer));
    } else if !any_pending && polling {
        POLL.with(|p| *p.borrow_mut() = None);
    }
}

/// Leaving the tab stops the 5s polling.
pub fn leave() {
    POLL.with(|p| *p.borrow_mut() = None);
}

/// syncDownloadSources: POST /download-sources/sync { ids }, merged into the stored ones.
fn sync(manual: bool) {
    let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
        return;
    };
    if manual {
        with_ui(|ui| ui.global::<SettingsData>().set_sources_syncing(true));
    }
    std::thread::spawn(move || {
        let stored: Vec<Value> = db.values(keys::DOWNLOAD_SOURCES).unwrap_or_default();
        let ids: Vec<Value> = stored.iter().filter_map(|s| s.get("id").cloned()).collect();
        let result = api.post(
            "/download-sources/sync",
            &json!({ "ids": ids }),
            Options::public(),
        );
        if let Ok(Value::Array(updated)) = &result {
            for source in updated {
                let Some(id) = source.get("id") else { continue };
                let key = id
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| id.to_string());
                let mut merged = stored
                    .iter()
                    .find(|s| s.get("id") == Some(id))
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                if let (Some(merged), Some(source)) = (merged.as_object_mut(), source.as_object()) {
                    for (k, v) in source {
                        merged.insert(k.clone(), v.clone());
                    }
                }
                let _ = db.put_in(keys::DOWNLOAD_SOURCES, &key, &merged);
            }
        }
        let ok = result.is_ok();
        let _ = slint::invoke_from_event_loop(move || {
            if manual {
                with_ui(|ui| ui.global::<SettingsData>().set_sources_syncing(false));
                if ok {
                    toast::success(&t("settings.download_sources_synced_successfully"));
                }
            }
            if !ok {
                eprintln!("Failed to sync download sources");
            }
            refresh();
        });
    });
}

/// removeDownloadSource(all, id)
fn remove(id: Option<String>) {
    let all = id.is_none();
    let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
        return;
    };
    with_ui(|ui| ui.global::<SettingsData>().set_sources_removing(true));
    let subscribed = subscribed();
    std::thread::spawn(move || {
        if subscribed {
            let mut query: Vec<(&str, String)> = vec![("all", all.to_string())];
            if let Some(id) = &id {
                query.push(("downloadSourceId", id.clone()));
            }
            let path = format!(
                "/profile/download-sources?{}",
                query
                    .iter()
                    .map(|(k, v)| format!("{k}={v}"))
                    .collect::<Vec<_>>()
                    .join("&")
            );
            let _ = api.delete(&path, Options::default());
        }
        match &id {
            Some(id) => {
                let _ = db.delete_in(keys::DOWNLOAD_SOURCES, id);
            }
            None => {
                for (key, _) in db
                    .entries::<Value>(keys::DOWNLOAD_SOURCES)
                    .unwrap_or_default()
                {
                    let _ = db.delete_in(keys::DOWNLOAD_SOURCES, &key);
                }
            }
        }
        let _ = slint::invoke_from_event_loop(move || {
            with_ui(|ui| ui.global::<SettingsData>().set_sources_removing(false));
            toast::success(&t(if all {
                "settings.removed_all_download_sources"
            } else {
                "settings.removed_download_source"
            }));
            if all {
                crate::dialogs::close();
            }
            refresh();
        });
    });
}

fn confirm_remove_all() {
    crate::dialogs::confirm(
        crate::dialogs::Confirm {
            title: &t("settings.title_confirmation_delete_all_sources"),
            description: &t("settings.description_confirmation_delete_all_sources"),
            body: "",
            confirm_label: &t("settings.confirm_button_confirmation_delete_all_sources"),
            cancel_label: &t("settings.cancel_button_confirmation_delete_all_sources"),
            danger: false,
        },
        || remove(None),
    );
}

/// AddDownloadSourceModal (`url` prefilled from a hydralauncher:// link).
pub fn open_add_modal(url: &str) {
    crate::dialogs::field(
        crate::dialogs::Field {
            title: &t("settings.add_download_source"),
            description: &t("settings.add_download_source_description"),
            label: &t("settings.download_source_url"),
            placeholder: &t("settings.insert_valid_json_url"),
            text: url,
            confirm_label: &t("settings.add_download_source"),
            cancel_label: &t("settings.cancel"),
        },
        |text| add(text.trim().to_string()),
    );
}

/// yup's url(): an absolute http(s)/ftp URL with a host.
fn valid_url(url: &str) -> bool {
    let Some((scheme, rest)) = url.split_once("://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    matches!(
        scheme.to_ascii_lowercase().as_str(),
        "http" | "https" | "ftp"
    ) && host.contains('.')
        && !url.contains(' ')
}

/// addDownloadSource
fn add(url: String) {
    if url.is_empty() {
        crate::dialogs::set_field_error(&t("settings.required_field"));
        return;
    }
    if !valid_url(&url) {
        crate::dialogs::set_field_error(&t("settings.must_be_valid_url"));
        return;
    }
    let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
        return;
    };
    crate::dialogs::set_field_busy(true, &t("settings.adding"));
    let subscribed = subscribed();
    std::thread::spawn(move || {
        let stored: Vec<Value> = db.values(keys::DOWNLOAD_SOURCES).unwrap_or_default();
        let result = if stored
            .iter()
            .any(|s| s.get("url").and_then(Value::as_str) == Some(url.as_str()))
        {
            Err(true)
        } else {
            match api.post(
                "/download-sources",
                &json!({ "url": url }),
                Options::public(),
            ) {
                Ok(source) => {
                    if subscribed {
                        if let Err(error) = api.post(
                            "/profile/download-sources",
                            &json!({ "urls": [url] }),
                            Options::default(),
                        ) {
                            eprintln!("Failed to add download source to profile: {error}");
                        }
                    }
                    let mut stored = source.clone();
                    if let Some(map) = stored.as_object_mut() {
                        map.insert("isRemote".into(), json!(true));
                        map.insert(
                            "createdAt".into(),
                            json!(hydra_core::library_actions::now_iso()),
                        );
                    }
                    let id = source
                        .get("id")
                        .map(|v| {
                            v.as_str()
                                .map(str::to_string)
                                .unwrap_or_else(|| v.to_string())
                        })
                        .unwrap_or_default();
                    let _ = db.put_in(keys::DOWNLOAD_SOURCES, &id, &stored);
                    Ok(())
                }
                Err(error) => {
                    eprintln!("Failed to add download source: {error}");
                    Err(false)
                }
            }
        };
        let _ = slint::invoke_from_event_loop(move || {
            crate::dialogs::set_field_busy(false, &t("settings.add_download_source"));
            match result {
                Ok(()) => {
                    crate::dialogs::close();
                    refresh();
                }
                Err(exists) => crate::dialogs::set_field_error(&t(if exists {
                    "settings.download_source_already_exists"
                } else {
                    "settings.failed_add_download_source"
                })),
            }
        });
    });
}
