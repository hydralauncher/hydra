//! settings-account.tsx: privacy selects, the account's username and email,
//! Hydra Cloud subscription, cloud gifts and blocked users.

use std::cell::RefCell;

use hydra_core::api::Options;
use hydra_db::keys;
use hydra_media::images::Op;
use serde_json::{Map, Value, json};
use slint::{ComponentHandle, Model, ModelRc, SharedString, VecModel};

use crate::{AppWindow, BlockedUser, SelectOption, SettingsData, shell, toast};

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

fn text(user: &Value, key: &str) -> String {
    user.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

pub fn init(ui: &AppWindow) {
    UI.with(|u| *u.borrow_mut() = ui.as_weak());
    let data = ui.global::<SettingsData>();
    data.on_account_select(|key, value| save(key.as_str(), value.as_str()));
    data.on_update_email(|| crate::auth::open(crate::auth::Page::UpdateEmail));
    data.on_update_password(|| crate::auth::open(crate::auth::Page::UpdatePassword));
    data.on_open_checkout(open_checkout);
    data.on_unblock(|id| unblock(id.to_string()));
}

fn option(value: &str, label: String) -> SelectOption {
    SelectOption {
        value: value.into(),
        label: label.into(),
    }
}

/// The tab opened: fill from the cached userDetails and fetch blocked users.
pub fn refresh() {
    let Some(user) = shell::user_details() else {
        with_ui(|ui| ui.global::<SettingsData>().set_account_loaded(false));
        return;
    };
    let visibility = vec![
        option("PUBLIC", t("settings.public")),
        option("FRIENDS", t("settings.friends_only")),
        option("PRIVATE", t("settings.private")),
    ];
    let comments = vec![
        option("EVERYONE", t("screenshots.comments_policy_everyone")),
        option("FRIENDS", t("screenshots.comments_policy_friends")),
        option("NOBODY", t("screenshots.comments_policy_nobody")),
    ];
    let label = |options: &[SelectOption], value: &str| -> SharedString {
        options
            .iter()
            .find(|o| o.value == value)
            .map(|o| o.label.clone())
            .unwrap_or_default()
    };
    let profile = Some(text(&user, "profileVisibility"))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "PUBLIC".into());
    let souvenirs = Some(text(&user, "souvenirsVisibility"))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "PRIVATE".into());
    let screenshots = text(&user, "screenshotsVisibility");
    let policy = text(&user, "screenshotCommentsPolicy");
    let screenshots_feature = crate::features::enabled("SCREENSHOTS");
    let (lines, action) = cloud_section(&user);
    with_ui(|ui| {
        let data = ui.global::<SettingsData>();
        data.set_visibility_options(ModelRc::new(VecModel::from(visibility.clone())));
        data.set_comments_options(ModelRc::new(VecModel::from(comments.clone())));
        data.set_profile_visibility_label(label(&visibility, &profile));
        data.set_profile_visibility(profile.into());
        data.set_souvenirs_visibility_label(label(&visibility, &souvenirs));
        data.set_souvenirs_visibility(souvenirs.into());
        data.set_show_screenshot_privacy(screenshots_feature && !screenshots.is_empty());
        data.set_screenshots_visibility_label(label(&visibility, &screenshots));
        data.set_screenshots_visibility(screenshots.into());
        data.set_show_comments_policy(
            screenshots_feature
                && crate::features::enabled("SCREENSHOT_COMMENTS")
                && !policy.is_empty(),
        );
        data.set_comments_policy_label(label(&comments, &policy));
        data.set_comments_policy(policy.into());
        data.set_username(text(&user, "username").into());
        data.set_email(text(&user, "email").into());
        data.set_cloud_lines(ModelRc::new(VecModel::from(
            lines
                .into_iter()
                .map(SharedString::from)
                .collect::<Vec<_>>(),
        )));
        data.set_cloud_action(action.into());
        data.set_allow_gifts(
            user.get("allowCloudGifts")
                .and_then(Value::as_bool)
                .unwrap_or(true),
        );
        data.set_account_busy(false);
        data.set_account_loaded(true);
    });
    fetch_blocked();
}

/// getHydraCloudSectionContent: the small lines and the button label.
fn cloud_section(user: &Value) -> (Vec<String>, String) {
    let subscription = user.get("subscription");
    let expires = subscription
        .and_then(|s| s.get("expiresAt"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(expires_ms) = hydra_core::library::parse_iso_millis(expires) else {
        return (
            vec![t("settings.no_subscription")],
            t("settings.become_subscriber"),
        );
    };
    let language = shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into());
    let date = hydra_i18n::date::format_date(&language, expires_ms);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64);
    if expires_ms > now {
        let renewing = subscription
            .and_then(|s| s.get("status"))
            .and_then(Value::as_str)
            == Some("active");
        let lines = if renewing {
            vec![
                shell::tr_with("settings.subscription_renews_on", &[("date", date.into())]),
                t("settings.bill_sent_until"),
            ]
        } else {
            vec![
                t("settings.subscription_renew_cancelled"),
                shell::tr_with(
                    "settings.subscription_active_until",
                    &[("date", date.into())],
                ),
            ]
        };
        return (lines, t("settings.manage_subscription"));
    }
    (
        vec![shell::tr_with(
            "settings.subscription_expired_at",
            &[("date", date.into())],
        )],
        t("settings.renew_subscription"),
    )
}

/// onSubmit (patchUser with the form values) for the visibility selects and
/// cloud gifts; the screenshot privacy selects patch only their own field.
fn save(key: &str, value: &str) {
    let Some(api) = shell::api() else { return };
    let mut body = Map::new();
    let screenshot_field = key == "screenshotsVisibility" || key == "screenshotCommentsPolicy";
    if screenshot_field {
        body.insert(key.into(), json!(value));
    } else {
        let mut profile = String::new();
        let mut souvenirs = String::new();
        let mut gifts = true;
        with_ui(|ui| {
            let data = ui.global::<SettingsData>();
            profile = data.get_profile_visibility().to_string();
            souvenirs = data.get_souvenirs_visibility().to_string();
            gifts = data.get_allow_gifts();
        });
        match key {
            "profileVisibility" => profile = value.to_string(),
            "souvenirsVisibility" => souvenirs = value.to_string(),
            "allowCloudGifts" => gifts = value == "true",
            _ => {}
        }
        body.insert("profileVisibility".into(), json!(profile));
        body.insert("allowCloudGifts".into(), json!(gifts));
        body.insert("souvenirsVisibility".into(), json!(souvenirs));
    }
    with_ui(|ui| ui.global::<SettingsData>().set_account_busy(true));
    std::thread::spawn(move || {
        let result = api.patch("/profile", &Value::Object(body.clone()), Options::default());
        let _ = slint::invoke_from_event_loop(move || {
            match result {
                Ok(_) => {
                    shell::patch_user_details(&body);
                    toast::success(&t("settings.changes_saved"));
                }
                Err(error) => {
                    eprintln!("Failed to update the profile: {error}");
                    if screenshot_field {
                        toast::error(&t("screenshots.update_failed"));
                    }
                }
            }
            refresh();
        });
    });
}

/// fetchBlockedUsers: GET /profile/blocks (take 12), avatars in grayscale.
fn fetch_blocked() {
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let blocks: Vec<Value> = api
            .get(
                "/profile/blocks",
                &[("take", "12".into()), ("skip", "0".into())],
                Options::default(),
            )
            .ok()
            .and_then(|v| v.get("blocks").and_then(Value::as_array).cloned())
            .unwrap_or_default();
        let _ = slint::invoke_from_event_loop(move || {
            let users: Vec<BlockedUser> = blocks
                .iter()
                .map(|b| BlockedUser {
                    id: text(b, "id").into(),
                    name: text(b, "displayName").into(),
                    avatar: Default::default(),
                })
                .collect();
            let model = std::rc::Rc::new(VecModel::from(users));
            with_ui(|ui| {
                ui.global::<SettingsData>()
                    .set_blocked(ModelRc::from(model.clone()))
            });
            let Some((loader, _)) = shell::loader() else {
                return;
            };
            for (index, block) in blocks.iter().enumerate() {
                let url = text(block, "profileImageUrl");
                if url.is_empty() {
                    continue;
                }
                let weak = UI.with(|u| u.borrow().clone());
                loader.load(url, Op::Grayscale, move |img| {
                    let Some(ui) = weak.upgrade() else { return };
                    let model = ui.global::<SettingsData>().get_blocked();
                    if let Some(mut row) = model.row_data(index) {
                        row.avatar = img;
                        model.set_row_data(index, row);
                    }
                });
            }
        });
    });
}

/// unblockUser + fetchBlockedUsers
fn unblock(id: String) {
    let Some(api) = shell::api() else { return };
    with_ui(|ui| ui.global::<SettingsData>().set_unblocking(true));
    std::thread::spawn(move || {
        let result = api.post(
            &format!("/users/{id}/unblock"),
            &Value::Null,
            Options::default(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            with_ui(|ui| ui.global::<SettingsData>().set_unblocking(false));
            if result.is_ok() {
                toast::success(&t("settings.user_unblocked"));
            }
            fetch_blocked();
        });
    });
}

/// openCheckout: POST /auth/payment for a payment token, then the checkout
/// page in the browser.
fn open_checkout() {
    let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
        return;
    };
    let refresh_token = db.get::<Value>(keys::AUTH).and_then(|a| {
        a.get("refreshToken")
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let Some(refresh_token) = refresh_token else {
        return;
    };
    std::thread::spawn(move || {
        let token = api
            .post(
                "/auth/payment",
                &json!({ "refreshToken": refresh_token }),
                Options::default(),
            )
            .ok()
            .and_then(|v| {
                v.get("accessToken")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
        let Some(token) = token else {
            eprintln!("openCheckout: no payment token");
            return;
        };
        let Ok(mut url) = reqwest::Url::parse(&hydra_core::config::checkout_url()) else {
            return;
        };
        url.query_pairs_mut().append_pair("token", &token);
        #[cfg(windows)]
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", url.as_str()])
            .spawn();
        #[cfg(not(windows))]
        let _ = std::process::Command::new("xdg-open")
            .arg(url.as_str())
            .spawn();
    });
}

/// on-account-updated (the auth site's update-account redirect): refetch the
/// user and say so.
pub fn on_account_updated() {
    shell::reload_user(Some(Box::new(|| {
        toast::success(&t("settings.account_data_updated_successfully"));
        refresh();
    })));
}
