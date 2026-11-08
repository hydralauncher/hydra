//! settings-debrid.tsx and settings-{real-debrid,premiumize,all-debrid,
//! torbox}.tsx: collapsible provider sections, the enable checkbox and the
//! API token checked against the provider before it is saved.

use std::cell::RefCell;

use hydra_core::debrid::{self, AuthError, Provider};
use serde_json::{Map, Value, json};
use slint::{ComponentHandle, ModelRc, VecModel};

use crate::toast::Kind;
use crate::{AppWindow, DebridRow, SettingsData, prefs, shell, toast};

/// collapsed-sections.ts
const COLLAPSED_KEY: &str = "settings-collapsed-sections";

struct Spec {
    key: &'static str,
    feature: Option<&'static str>,
    /// translation key stem: real_debrid / premiumize / alldebrid / torbox
    stem: &'static str,
    title: &'static str,
    url: &'static str,
    token_url: &'static str,
}

const SPECS: &[Spec] = &[
    Spec {
        key: "realDebrid",
        feature: None,
        stem: "real_debrid",
        title: "debrid_provider_real_debrid",
        url: "https://real-debrid.com",
        token_url: "https://real-debrid.com/apitoken",
    },
    Spec {
        key: "premiumize",
        feature: Some("PREMIUMIZE"),
        stem: "premiumize",
        title: "debrid_provider_premiumize",
        url: "https://www.premiumize.me",
        token_url: "https://www.premiumize.me/account",
    },
    Spec {
        key: "allDebrid",
        feature: Some("ALLDEBRID"),
        stem: "alldebrid",
        title: "debrid_provider_alldebrid",
        url: "https://alldebrid.com",
        token_url: "https://alldebrid.com/apikeys/",
    },
    Spec {
        key: "torbox",
        feature: Some("TORBOX"),
        stem: "torbox",
        title: "debrid_provider_torbox",
        url: "https://torbox.app",
        token_url: "https://torbox.app/settings",
    },
];

/// The form state that isn't stored yet: enabled without a saved token,
/// tokens being typed, a check in flight.
#[derive(Default, Clone)]
struct Form {
    enabled: Option<bool>,
    token: Option<String>,
    busy: bool,
}

thread_local! {
    static UI: RefCell<slint::Weak<AppWindow>> = RefCell::new(slint::Weak::default());
    static FORMS: RefCell<std::collections::HashMap<&'static str, Form>> = RefCell::new(Default::default());
}

fn t(key: &str) -> String {
    shell::tr(key)
}

fn spec(key: &str) -> Option<&'static Spec> {
    SPECS.iter().find(|s| s.key == key)
}

fn collapsed_sections() -> Map<String, Value> {
    shell::storage_get(COLLAPSED_KEY)
        .and_then(|v| serde_json::from_str::<Value>(&v).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

pub fn init(ui: &AppWindow) {
    UI.with(|u| *u.borrow_mut() = ui.as_weak());
    let data = ui.global::<SettingsData>();
    data.on_debrid_collapse(|key| {
        let Some(spec) = spec(&key) else { return };
        let token = token_of(spec);
        let mut stored = collapsed_sections();
        let current = stored
            .get(spec.key)
            .and_then(Value::as_bool)
            .unwrap_or(token.is_empty());
        stored.insert(spec.key.into(), json!(!current));
        shell::storage_set(COLLAPSED_KEY, &Value::Object(stored).to_string());
        refresh();
    });
    data.on_debrid_enable(|key| {
        let Some(spec) = spec(&key) else { return };
        let enabled = enabled_of(spec);
        FORMS.with(|f| f.borrow_mut().entry(spec.key).or_default().enabled = Some(!enabled));
        if enabled {
            // toggling off clears the saved token right away
            prefs::update(Map::from_iter([(token_key(spec).to_string(), Value::Null)]));
            FORMS.with(|f| f.borrow_mut().entry(spec.key).or_default().token = None);
        }
        refresh();
    });
    data.on_debrid_token_edited(|key, value| {
        if let Some(spec) = spec(&key) {
            FORMS.with(|f| {
                f.borrow_mut().entry(spec.key).or_default().token = Some(value.to_string())
            });
        }
    });
    data.on_debrid_save(|key| save(&key));
    data.on_open_url(|url| open_url(&url));
}

pub fn open_url(url: &str) {
    #[cfg(windows)]
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn();
    #[cfg(not(windows))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

fn token_key(spec: &Spec) -> &'static str {
    debrid::Provider::parse(spec.key)
        .map(Provider::token_key)
        .unwrap_or_default()
}

fn token_of(spec: &Spec) -> String {
    prefs::get()
        .get(token_key(spec))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn enabled_of(spec: &Spec) -> bool {
    FORMS
        .with(|f| f.borrow().get(spec.key).and_then(|f| f.enabled))
        .unwrap_or_else(|| !token_of(spec).is_empty())
}

/// "You can get your API token <0>here</0>" split around the link.
fn hint_parts() -> (String, String, String) {
    let text = t("settings.debrid_api_token_hint");
    match (text.find("<0>"), text.find("</0>")) {
        (Some(open), Some(close)) if close > open => (
            text[..open].to_string(),
            text[open + 3..close].to_string(),
            text[close + 4..].to_string(),
        ),
        _ => (text, String::new(), String::new()),
    }
}

pub fn refresh() {
    let collapsed = collapsed_sections();
    let (before, link, after) = hint_parts();
    let rows: Vec<DebridRow> = SPECS
        .iter()
        .filter(|s| s.feature.is_none_or(crate::features::enabled))
        .map(|s| {
            let saved = token_of(s);
            let form = FORMS
                .with(|f| f.borrow().get(s.key).cloned())
                .unwrap_or_default();
            DebridRow {
                key: s.key.into(),
                title: t(&format!("settings.{}", s.title)).into(),
                description: t(&format!("settings.{}_description", s.stem)).into(),
                create_label: t(&format!("settings.create_{}_account", s.stem)).into(),
                create_url: s.url.into(),
                enable_label: t(&format!("settings.enable_{}", s.stem)).into(),
                hint_before: before.clone().into(),
                hint_link: link.clone().into(),
                hint_after: after.clone().into(),
                token_url: s.token_url.into(),
                collapsed: collapsed
                    .get(s.key)
                    .and_then(Value::as_bool)
                    .unwrap_or(saved.is_empty()),
                enabled: enabled_of(s),
                token: form.token.unwrap_or_else(|| saved.clone()).into(),
                linked: !saved.is_empty(),
                busy: form.busy,
            }
        })
        .collect();
    if let Some(ui) = UI.with(|u| u.borrow().upgrade()) {
        ui.global::<SettingsData>()
            .set_debrid(ModelRc::new(VecModel::from(rows)));
    }
}

/// handleFormSubmit: check the token with the provider, then save it.
fn save(key: &str) {
    let (Some(spec), Some(provider)) = (spec(key), Provider::parse(key)) else {
        return;
    };
    let token = FORMS
        .with(|f| f.borrow().get(spec.key).and_then(|f| f.token.clone()))
        .unwrap_or_else(|| token_of(spec));
    if token.is_empty() {
        return;
    }
    FORMS.with(|f| f.borrow_mut().entry(spec.key).or_default().busy = true);
    refresh();
    let stem = spec.stem;
    let spec_key = spec.key;
    std::thread::spawn(move || {
        let client = hydra_store::http_client();
        let result =
            debrid::authenticate(&client, provider, &token, hydra_core::config::app_version());
        let _ = slint::invoke_from_event_loop(move || {
            FORMS.with(|f| f.borrow_mut().entry(spec_key).or_default().busy = false);
            match result {
                Ok(name) => {
                    toast::show(
                        Kind::Success,
                        &t(&format!("settings.{stem}_account_linked")),
                        Some(&shell::tr_with(
                            "settings.debrid_linked_message",
                            &[("username", name.into())],
                        )),
                    );
                    prefs::update(Map::from_iter([(
                        provider.token_key().to_string(),
                        json!(token),
                    )]));
                    FORMS.with(|f| f.borrow_mut().remove(spec_key));
                }
                Err(AuthError::FreeAccount(username)) => {
                    toast::error(&shell::tr_with(
                        "settings.real_debrid_free_account_error",
                        &[("username", username.into())],
                    ));
                }
                Err(AuthError::Invalid) => toast::error(&t("settings.debrid_invalid_token")),
            }
            refresh();
        });
    });
}
