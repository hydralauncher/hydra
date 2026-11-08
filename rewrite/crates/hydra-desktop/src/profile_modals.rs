//! The modals the profile opens (ui/pages/profile/modals.slint):
//! all-badges-modal, all-friends-modal, add-friend-modal, report-profile,
//! edit-profile-modal + profile-image-crop-modal, the banner button's menu,
//! crop and removal (upload-background-image-button), and the avatar's
//! FullscreenMediaModal.

use std::cell::RefCell;
use std::path::PathBuf;

use hydra_core::api::Options;
use hydra_core::profile::{self, ImageChange};
use hydra_core::profile_image::{self, Crop};
use hydra_media::images::{self, Op};
use image::DynamicImage;
use serde_json::{Map, Value, json};
use slint::{ComponentHandle, Image, ModelRc, VecModel};

use crate::{
    AppWindow, Popup, ProfileData, ProfileFriend, ProfileModals, SelectOption, Session, nav,
    profile_page, shell, toast,
};

#[derive(Clone, Copy, PartialEq, Eq, Default)]
enum Variant {
    #[default]
    Avatar,
    Banner,
}

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    // all-friends-modal
    friends: Vec<Value>,
    friends_page: usize,
    friends_loading: bool,
    friends_request: u64,
    // add-friend-modal
    sent: Vec<Value>,
    // report-profile: errors show after the first submit (react-hook-form)
    report_submitted: bool,
    // edit-profile-modal
    edit_image: Option<PathBuf>,
    edit_submitted: bool,
    // image-crop-modal
    crop_variant: Variant,
    crop_source: Option<PathBuf>,
    crop_image: Option<DynamicImage>,
    crop_rotation: i32,
    crop_generation: i32,
    // the banner just picked (selectedBackgroundImage), shown until reload
    selected_banner: Option<PathBuf>,
    banner_url: Option<String>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn window() -> Option<AppWindow> {
    with(|s| s.ui.upgrade())
}

fn t(key: &str) -> String {
    shell::tr(key)
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

const REPORT_REASONS: [&str; 5] = ["hate", "sexual_content", "violence", "spam", "other"];

pub fn init(ui: &AppWindow) {
    with(|s| s.ui = ui.as_weak());
    let m = ui.global::<ProfileModals>();
    m.on_friend_clicked(|id| {
        close();
        nav::navigate(&format!("/profile/{id}"));
    });
    m.on_friends_load_more(|| {
        let page = with(|s| s.friends_page);
        fetch_friends(page, true);
    });
    m.on_copy_my_code(|| {
        if let Some(id) = profile_page::signed_in_user_id() {
            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                let _ = clipboard.set_text(id);
            }
            toast::success(&t("user_profile.friend_code_copied"));
        }
    });
    m.on_friend_code_edited(|code| {
        let code = profile::friend_code(&code);
        if let Some(ui) = window() {
            let m = ui.global::<ProfileModals>();
            if m.get_friend_code() != code.as_str() {
                m.set_friend_code(code.as_str().into());
            }
        }
        update_pending();
    });
    m.on_add_friend(add_friend);
    m.on_see_profile(|| {
        let Some(code) = valid_code() else { return };
        close();
        nav::navigate(&format!("/profile/{code}"));
    });
    m.on_open_request(|id| {
        close();
        nav::navigate(&format!("/profile/{id}"));
    });
    m.on_cancel_request(|id| cancel_request(id.to_string()));
    m.on_description_edited(|_| {
        if with(|s| s.report_submitted) {
            validate_report();
        }
    });
    m.on_submit_report(submit_report);
    m.on_pick_avatar(pick_avatar);
    m.on_display_name_edited(|_| {
        if with(|s| s.edit_submitted) {
            validate_name();
        }
    });
    m.on_save_profile(save_profile);
    m.on_open_settings(|| {
        close();
        nav::navigate("/settings");
    });
    m.on_crop_rotate(|| {
        // rotateImage: 90deg counter-clockwise; the re-fit recenters
        with(|s| s.crop_rotation = (s.crop_rotation + 270) % 360);
        refresh_crop_preview();
    });
    m.on_crop_reset(|| {
        with(|s| s.crop_rotation = 0);
        refresh_crop_preview();
    });
    m.on_crop_apply(|left, top, width, height| apply_crop(left, top, width, height));
    m.on_crop_cancelled(close_crop);

    let reasons: Vec<SelectOption> = REPORT_REASONS
        .iter()
        .map(|r| SelectOption {
            value: (*r).into(),
            label: t(&format!("user_profile.report_reason_{r}")).into(),
        })
        .collect();
    m.set_reasons(ModelRc::new(VecModel::from(reasons)));
}

/// SelectPopup.chosen for the report reason.
pub fn select_chosen(owner: &str, value: &str) {
    if owner != "profile-report-reason" {
        return;
    }
    if let Some(ui) = window() {
        let m = ui.global::<ProfileModals>();
        m.set_reason(value.into());
        m.set_reason_label(t(&format!("user_profile.report_reason_{value}")).into());
    }
}

/// The modal's backdrop-filter: blur(2px), from a snapshot of the window.
fn snapshot_backdrop(ui: &AppWindow) {
    let m = ui.global::<ProfileModals>();
    m.set_backdrop(Image::default());
    let Ok(snapshot) = ui.window().take_snapshot() else {
        return;
    };
    let scale = ui.window().scale_factor();
    let (w, h) = (snapshot.width(), snapshot.height());
    let rgba = snapshot.as_bytes().to_vec();
    let weak = ui.as_weak();
    std::thread::spawn(move || {
        let Some(pixels) = images::blur_rgba(w, h, rgba, 2, 2.0 * scale / 2.0) else {
            return;
        };
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = weak.upgrade() {
                ui.global::<ProfileModals>()
                    .set_backdrop(pixels.into_image());
            }
        });
    });
}

/// Open one of the profile modals ("badges", "friends", …).
pub fn open(kind: &str) {
    let Some(ui) = window() else { return };
    snapshot_backdrop(&ui);
    ui.global::<ProfileModals>().set_kind(kind.into());
}

/// Close the open modal with its exit animation.
pub fn close() {
    if let Some(ui) = window() {
        let m = ui.global::<ProfileModals>();
        if m.get_kind() == "avatar" {
            m.set_kind("".into());
        } else {
            m.set_close_request(m.get_close_request() + 1);
        }
    }
}

/// A rail image arrived: the friends modal may show it.
pub fn on_image_loaded() {
    let Some(ui) = window() else { return };
    let m = ui.global::<ProfileModals>();
    match m.get_kind().as_str() {
        "friends" => apply_friends(),
        "add-friend" => apply_sent(),
        _ => {}
    }
}

// ---- avatar -------------------------------------------------------------

pub fn open_avatar() {
    let Some(ui) = window() else { return };
    let Some(full) = profile_page::avatar_full() else {
        return;
    };
    let m = ui.global::<ProfileModals>();
    m.set_avatar_full(full);
    m.set_kind("avatar".into());
}

// ---- all-friends-modal ----------------------------------------------------

pub fn open_friends() {
    with(|s| {
        s.friends.clear();
        s.friends_page = 0;
        s.friends_loading = false;
    });
    if let Some(ui) = window() {
        let m = ui.global::<ProfileModals>();
        m.set_friends(ModelRc::default());
        m.set_friends_total(0);
        m.set_friends_has_more(true);
    }
    open("friends");
    fetch_friends(0, false);
}

fn fetch_friends(page: usize, append: bool) {
    if with(|s| s.friends_loading) {
        return;
    }
    let Some(api) = shell::api() else { return };
    let Some((user_id, me)) = profile_page::current() else {
        return;
    };
    let request = with(|s| {
        s.friends_loading = true;
        s.friends_request += 1;
        s.friends_request
    });
    if let Some(ui) = window() {
        ui.global::<ProfileModals>().set_friends_loading(true);
    }
    let path = if me {
        "/profile/friends".to_string()
    } else {
        format!("/users/{user_id}/friends")
    };
    std::thread::spawn(move || {
        let result = api.get(
            &path,
            &[
                ("take", profile::FRIENDS_PAGE_SIZE.to_string()),
                ("skip", (page * profile::FRIENDS_PAGE_SIZE).to_string()),
                ("shop", "steam".into()),
                ("shop", "launchbox".into()),
            ],
            Options::default(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.friends_request) != request {
                return;
            }
            with(|s| s.friends_loading = false);
            let Some(ui) = window() else { return };
            let m = ui.global::<ProfileModals>();
            m.set_friends_loading(false);
            match result {
                Ok(response) => {
                    let list = response
                        .get("friends")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    let total = response
                        .get("totalFriends")
                        .and_then(Value::as_i64)
                        .unwrap_or(0);
                    with(|s| {
                        if append {
                            s.friends.extend(list);
                        } else {
                            s.friends = list;
                        }
                        s.friends_page = page + 1;
                    });
                    m.set_friends_total(total as i32);
                    m.set_friends_has_more(
                        ((page + 1) * profile::FRIENDS_PAGE_SIZE) < total.max(0) as usize,
                    );
                    apply_friends();
                }
                Err(error) => eprintln!("Failed to fetch friends: {error}"),
            }
        });
    });
}

fn apply_friends() {
    let Some(ui) = window() else { return };
    let rows: Vec<ProfileFriend> = with(|s| s.friends.clone())
        .iter()
        .map(|f| profile_page::friend_row(f, 40.0))
        .collect();
    ui.global::<ProfileModals>()
        .set_friends(ModelRc::new(VecModel::from(rows)));
}

// ---- add-friend-modal -----------------------------------------------------

pub fn open_add_friend() {
    let Some(ui) = window() else { return };
    let m = ui.global::<ProfileModals>();
    m.set_friend_code("".into());
    m.set_code_pending(false);
    m.set_adding(false);
    m.set_my_code(profile_page::signed_in_user_id().unwrap_or_default().into());
    apply_sent();
    open("add-friend");
    if shell::signed_in() {
        fetch_requests();
    }
}

/// fetchFriendRequests: GET /profile/friend-requests (the SENT ones show here).
fn fetch_requests() {
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let result = api.get("/profile/friend-requests", &[], Options::default());
        let _ = slint::invoke_from_event_loop(move || {
            if let Ok(Value::Array(requests)) = result {
                with(|s| {
                    s.sent = requests
                        .into_iter()
                        .filter(|r| text(r, "type") == "SENT")
                        .collect()
                });
                apply_sent();
                update_pending();
            }
        });
    });
}

fn apply_sent() {
    let Some(ui) = window() else { return };
    let rows: Vec<ProfileFriend> = with(|s| s.sent.clone())
        .iter()
        .map(|r| profile_page::friend_row(r, 40.0))
        .collect();
    ui.global::<ProfileModals>()
        .set_sent_requests(ModelRc::new(VecModel::from(rows)));
}

fn update_pending() {
    let Some(ui) = window() else { return };
    let m = ui.global::<ProfileModals>();
    let code = m.get_friend_code().to_string();
    let pending =
        code.chars().count() == 8 && with(|s| s.sent.iter().any(|r| text(r, "id") == code));
    m.set_code_pending(pending);
}

/// validateFriendCode: 8 characters, else the toast.
fn valid_code() -> Option<String> {
    let code = window()?
        .global::<ProfileModals>()
        .get_friend_code()
        .to_string();
    if code.chars().count() == 8 {
        Some(code)
    } else {
        toast::error(&t("user_profile.friend_code_length_error"));
        None
    }
}

/// handleClickAddFriend: POST /profile/friend-requests { friendCode }.
fn add_friend() {
    let Some(code) = valid_code() else { return };
    if !shell::signed_in() {
        if let Some(ui) = window() {
            ui.global::<Session>().invoke_sign_in();
        }
        return;
    }
    let Some(api) = shell::api() else { return };
    if let Some(ui) = window() {
        ui.global::<ProfileModals>().set_adding(true);
    }
    std::thread::spawn(move || {
        let result = api.post(
            "/profile/friend-requests",
            &json!({ "friendCode": code }),
            Options::default(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = window() {
                let m = ui.global::<ProfileModals>();
                m.set_adding(false);
                if result.is_ok() {
                    m.set_friend_code("".into());
                }
            }
            match result {
                Ok(_) => {
                    toast::success(&t("user_profile.request_sent"));
                    fetch_requests();
                }
                Err(_) => toast::error(&t("user_profile.error_adding_friend")),
            }
        });
    });
}

/// handleCancelFriendRequest: DELETE /profile/friend-requests/{id}.
fn cancel_request(id: String) {
    if !shell::signed_in() {
        if let Some(ui) = window() {
            ui.global::<Session>().invoke_sign_in();
        }
        return;
    }
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let result = api.delete(
            &format!("/profile/friend-requests/{id}"),
            Options::default(),
        );
        let _ = slint::invoke_from_event_loop(move || match result {
            Ok(_) => fetch_requests(),
            Err(_) => toast::error(&t("user_profile.try_again")),
        });
    });
}

// ---- report-profile -------------------------------------------------------

pub fn open_report() {
    with(|s| s.report_submitted = false);
    let Some(ui) = window() else { return };
    let m = ui.global::<ProfileModals>();
    m.set_reason("hate".into());
    m.set_reason_label(t("user_profile.report_reason_hate").into());
    m.set_description("".into());
    m.set_description_error("".into());
    m.set_reporting(false);
    open("report");
}

fn validate_report() -> bool {
    let Some(ui) = window() else { return false };
    let m = ui.global::<ProfileModals>();
    let description = m.get_description().to_string();
    let error = if description.is_empty() {
        t("user_profile.required_field")
    } else if description.chars().count() > profile::MAX_REPORT_DESCRIPTION_LENGTH {
        shell::tr_with(
            "game_details.max_length_field",
            &[(
                "length",
                hydra_i18n::Arg::Number(profile::MAX_REPORT_DESCRIPTION_LENGTH as f64),
            )],
        )
    } else {
        String::new()
    };
    m.set_description_error(error.as_str().into());
    error.is_empty()
}

/// onSubmit: POST /users/{id}/report { reason, description }.
fn submit_report() {
    with(|s| s.report_submitted = true);
    if !validate_report() {
        return;
    }
    if !shell::signed_in() {
        if let Some(ui) = window() {
            ui.global::<Session>().invoke_sign_in();
        }
        return;
    }
    let (Some(api), Some(ui), Some((user_id, _))) =
        (shell::api(), window(), profile_page::current())
    else {
        return;
    };
    let m = ui.global::<ProfileModals>();
    let body = json!({
        "reason": m.get_reason().to_string(),
        "description": m.get_description().to_string(),
    });
    m.set_reporting(true);
    std::thread::spawn(move || {
        let result = api.post(
            &format!("/users/{user_id}/report"),
            &body,
            Options::default(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = window() {
                ui.global::<ProfileModals>().set_reporting(false);
            }
            match result {
                Ok(_) => {
                    toast::success(&t("user_profile.profile_reported"));
                    close();
                }
                Err(error) => eprintln!("report profile: {error}"),
            }
        });
    });
}

// ---- edit-profile-modal ---------------------------------------------------

pub fn open_edit() {
    let Some(ui) = window() else { return };
    let user = shell::user_details();
    with(|s| {
        s.edit_image = None;
        s.edit_submitted = false;
    });
    let m = ui.global::<ProfileModals>();
    m.set_display_name(
        user.as_ref()
            .map(|u| text(u, "displayName"))
            .unwrap_or_default()
            .into(),
    );
    m.set_display_name_error("".into());
    m.set_saving(false);
    let url = user
        .as_ref()
        .map(|u| text(u, "profileImageUrl"))
        .filter(|u| !u.is_empty());
    m.set_edit_has_avatar(url.is_some());
    m.set_edit_avatar(Image::default());
    if let Some(url) = url
        && let Some((loader, scale)) = shell::loader()
    {
        loader.load(
            url,
            Op::MaxWidth((128.0 * scale).ceil() as u32),
            move |img| {
                if with(|s| s.edit_image.is_none())
                    && let Some(ui) = window()
                {
                    ui.global::<ProfileModals>().set_edit_avatar(img);
                }
            },
        );
    }
    open("edit");
}

fn validate_name() -> bool {
    let Some(ui) = window() else { return false };
    let m = ui.global::<ProfileModals>();
    let error = profile::display_name_error(&m.get_display_name())
        .map(|key| t(&format!("user_profile.{key}")))
        .unwrap_or_default();
    m.set_display_name_error(error.as_str().into());
    error.is_empty()
}

/// The open-file dialog for profile images. `HYDRA_DEV_PICK_FILE` answers it
/// in scripted runs (headless windows can't show the native dialog).
fn pick_image() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("HYDRA_DEV_PICK_FILE") {
        return Some(PathBuf::from(path));
    }
    rfd::FileDialog::new()
        .add_filter("Image", &["jpg", "jpeg", "png", "apng", "gif", "webp"])
        .pick_file()
}

/// handleChangeProfileAvatar → handleProfileImagePath: animated pictures
/// keep their frames for subscribers and become a still otherwise.
fn pick_avatar() {
    let Some(path) = pick_image() else { return };
    let subscriber = window().is_some_and(|ui| ui.global::<Session>().get_has_subscription());
    std::thread::spawn(move || {
        let meta = profile_image::metadata(&path);
        let source = if meta.is_animated && !subscriber {
            profile_image::process(&path)
        } else {
            Ok(path)
        };
        let _ = slint::invoke_from_event_loop(move || match source {
            Ok(source) => open_crop(source, Variant::Avatar),
            Err(_) => toast::error(&t("user_profile.image_process_failure")),
        });
    });
}

/// onSubmit: patchUser({ displayName, profileImageUrl? }), then refetch the
/// user and the profile, close and toast.
fn save_profile() {
    with(|s| s.edit_submitted = true);
    if !validate_name() {
        return;
    }
    let (Some(api), Some(ui)) = (shell::api(), window()) else {
        return;
    };
    let m = ui.global::<ProfileModals>();
    let mut fields = Map::new();
    fields.insert(
        "displayName".into(),
        Value::String(m.get_display_name().to_string()),
    );
    let image = with(|s| s.edit_image.clone())
        .map(ImageChange::Upload)
        .unwrap_or(ImageChange::Keep);
    m.set_saving(true);
    std::thread::spawn(move || {
        let result = profile::update_profile(
            &api,
            &hydra_store::http_client(),
            fields,
            image,
            ImageChange::Keep,
        );
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = window() {
                ui.global::<ProfileModals>().set_saving(false);
            }
            match result {
                Ok(response) => {
                    store_user(&response);
                    shell::reload_user(None);
                    profile_page::reload();
                    close();
                    toast::success(&t("user_profile.saved_successfully"));
                }
                Err(error) => {
                    eprintln!("update profile: {error}");
                    toast::error(&t("user_profile.try_again"));
                }
            }
        });
    });
}

/// patchUser's updateUserDetails: the cached userDetails, merged.
fn store_user(response: &Value) {
    let merged = profile::merge_user_details(shell::user_details().as_ref(), response);
    if let Some(map) = merged.as_object() {
        shell::patch_user_details(map);
    }
}

// ---- banner (upload-background-image-button) ----------------------------

/// The banner button and its menu items (x = -1 replace, -2 remove).
pub fn banner_clicked(x: f32, y: f32, w: f32, h: f32) {
    let Some(ui) = window() else { return };
    if x == -1.0 {
        pick_banner();
        return;
    }
    if x == -2.0 {
        confirm_remove_banner();
        return;
    }
    let d = ui.global::<ProfileData>();
    if !d.get_viewer_subscriber() {
        // showHydraCloudModal("customization")
        eprintln!("TODO(cloud): showHydraCloudModal(\"customization\")");
        return;
    }
    if !d.get_has_banner_url() {
        pick_banner();
        return;
    }
    ui.global::<Popup>()
        .invoke_toggle("profile-banner".into(), x, y, w, h);
}

fn pick_banner() {
    let Some(path) = pick_image() else { return };
    open_crop(path, Variant::Banner);
}

/// uploadBanner: show the picked file, PATCH it, toast, refetch.
fn upload_banner(path: PathBuf) {
    let Some(api) = shell::api() else { return };
    with(|s| s.selected_banner = Some(path.clone()));
    load_banner();
    if let Some(ui) = window() {
        ui.global::<ProfileData>().set_banner_uploading(true);
    }
    std::thread::spawn(move || {
        let result = profile::update_profile(
            &api,
            &hydra_store::http_client(),
            Map::new(),
            ImageChange::Keep,
            ImageChange::Upload(path),
        );
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = window() {
                ui.global::<ProfileData>().set_banner_uploading(false);
            }
            match result {
                Ok(response) => {
                    store_user(&response);
                    toast::success(&t("user_profile.background_image_updated"));
                    shell::reload_user(None);
                    profile_page::reload();
                }
                Err(_) => toast::error(&t("user_profile.try_again")),
            }
        });
    });
}

/// The remove-banner ConfirmationModal, then PATCH backgroundImageUrl: null.
fn confirm_remove_banner() {
    crate::dialogs::confirm(
        crate::dialogs::Confirm {
            title: &t("user_profile.remove_banner_modal_title"),
            description: &t("user_profile.remove_banner_confirmation"),
            body: "",
            confirm_label: &t("user_profile.remove"),
            cancel_label: &t("user_profile.cancel"),
            danger: false,
        },
        || {
            crate::dialogs::close();
            let Some(api) = shell::api() else { return };
            with(|s| s.selected_banner = None);
            if let Some(ui) = window() {
                ui.global::<ProfileData>().set_banner_uploading(true);
            }
            std::thread::spawn(move || {
                let result = profile::update_profile(
                    &api,
                    &hydra_store::http_client(),
                    Map::new(),
                    ImageChange::Keep,
                    ImageChange::Remove,
                );
                let _ = slint::invoke_from_event_loop(move || {
                    if let Some(ui) = window() {
                        ui.global::<ProfileData>().set_banner_uploading(false);
                    }
                    if let Ok(response) = result {
                        store_user(&response);
                        toast::success(&t("user_profile.background_image_updated"));
                        shell::reload_user(None);
                        profile_page::reload();
                    }
                });
            });
        },
    );
}

/// The profile's backgroundImageUrl changed (or another profile opened).
pub fn on_profile_banner(url: Option<String>) {
    let me = profile_page::current().is_some_and(|(_, me)| me);
    with(|s| {
        if !me {
            s.selected_banner = None;
        }
        s.banner_url = url;
    });
    load_banner();
}

/// backgroundImage: the picked file (own profile), else the profile's URL,
/// at the window's width, plus its blur(15px) copy for the frosted panel.
fn load_banner() {
    let Some(ui) = window() else { return };
    let source = with(|s| {
        s.selected_banner
            .clone()
            .map(images::Source::from)
            .or_else(|| s.banner_url.clone().map(images::Source::from))
    });
    let d = ui.global::<ProfileData>();
    let Some(source) = source else {
        d.set_has_banner(false);
        d.set_banner(Image::default());
        d.set_banner_frost(Image::default());
        return;
    };
    d.set_has_banner(true);
    let Some((loader, scale)) = shell::loader() else {
        return;
    };
    let width = (ui.window().size().width as f32).max(1.0);
    let user = d.get_user_id().to_string();
    loader.run(move |http| {
        let decoded = images::fetch(http, &source).and_then(|bytes| images::open_bytes(&bytes));
        let result = decoded.map(|img| {
            use image::imageops::FilterType;
            let display = if img.width() as f32 > width * 1.2 {
                img.resize(
                    width as u32,
                    (img.height() as f32 * width / img.width() as f32).ceil() as u32,
                    FilterType::CatmullRom,
                )
            } else {
                img
            };
            let shrink = 4.0;
            let small = display.resize(
                ((display.width() as f32 / shrink).ceil() as u32).max(1),
                ((display.height() as f32 / shrink).ceil() as u32).max(1),
                FilterType::Triangle,
            );
            let per_px = width / display.width().max(1) as f32;
            let frost = small.blur((15.0 * scale / per_px.max(1e-3) / shrink).max(0.5));
            (
                images::to_pixels(display, Op::Full),
                images::to_pixels(frost, Op::Full),
            )
        });
        let _ = slint::invoke_from_event_loop(move || {
            let Some(ui) = window() else { return };
            let d = ui.global::<ProfileData>();
            if d.get_user_id() != user.as_str() {
                return;
            }
            if let Some((banner, frost)) = result {
                d.set_banner(banner.into_image());
                d.set_banner_frost(frost.into_image());
            }
        });
    });
}

// ---- image-crop-modal -----------------------------------------------------

fn open_crop(path: PathBuf, variant: Variant) {
    let Some(ui) = window() else { return };
    let m = ui.global::<ProfileModals>();
    with(|s| {
        s.crop_variant = variant;
        s.crop_source = Some(path.clone());
        s.crop_image = None;
        s.crop_rotation = 0;
    });
    let (width, height, max_frame, title) = match variant {
        Variant::Avatar => (512.0, 512.0, 420.0, t("user_profile.crop_profile_picture")),
        Variant::Banner => (1600.0, 400.0, 720.0, t("user_profile.crop_profile_banner")),
    };
    m.set_crop_title(title.into());
    m.set_crop_output_width(width);
    m.set_crop_output_height(height);
    m.set_crop_max_frame(max_frame);
    m.set_crop_applying(false);
    m.set_crop_image(Image::default());
    m.set_crop_natural_width(0.0);
    m.set_crop_natural_height(0.0);
    if m.get_kind().is_empty() {
        snapshot_backdrop(&ui);
    }
    m.set_crop_open(true);
    std::thread::spawn(move || {
        let decoded = image::ImageReader::open(&path)
            .ok()
            .and_then(|r| r.with_guessed_format().ok())
            .and_then(|r| r.decode().ok());
        let _ = slint::invoke_from_event_loop(move || match decoded {
            Some(img) => {
                if with(|s| s.crop_source.as_deref() == Some(path.as_path())) {
                    with(|s| s.crop_image = Some(img));
                    refresh_crop_preview();
                }
            }
            None => {
                toast::error(&t("user_profile.image_process_failure"));
                close_crop();
            }
        });
    });
}

/// The preview with the current rotation (clockwise, like CSS rotate()),
/// at most 2048px, and the full image's rotated size for the crop math.
fn refresh_crop_preview() {
    let Some(ui) = window() else { return };
    let Some((image, rotation)) = with(|s| s.crop_image.clone().map(|i| (i, s.crop_rotation)))
    else {
        return;
    };
    let quarter = rotation == 90 || rotation == 270;
    let (nat_w, nat_h) = if quarter {
        (image.height(), image.width())
    } else {
        (image.width(), image.height())
    };
    let preview = if image.width().max(image.height()) > 2048 {
        image.resize(2048, 2048, image::imageops::FilterType::Triangle)
    } else {
        image
    };
    let rotated = match rotation {
        90 => preview.rotate90(),
        180 => preview.rotate180(),
        270 => preview.rotate270(),
        _ => preview,
    };
    let m = ui.global::<ProfileModals>();
    m.set_crop_image(images::to_pixels(rotated, Op::Full).into_image());
    m.set_crop_natural_width(nat_w as f32);
    m.set_crop_natural_height(nat_h as f32);
    let generation = with(|s| {
        s.crop_generation += 1;
        s.crop_generation
    });
    m.set_crop_generation(generation);
}

fn close_crop() {
    if let Some(ui) = window() {
        let m = ui.global::<ProfileModals>();
        m.set_crop_close_request(m.get_crop_close_request() + 1);
    }
    with(|s| {
        s.crop_image = None;
        s.crop_source = None;
    });
}

/// handleApply: cropProfileImage, then the avatar preview or the banner upload.
fn apply_crop(left: f32, top: f32, width: f32, height: f32) {
    let Some((source, variant, rotation)) = with(|s| {
        s.crop_source
            .clone()
            .map(|p| (p, s.crop_variant, s.crop_rotation))
    }) else {
        return;
    };
    let (output_width, output_height) = match variant {
        Variant::Avatar => (512, 512),
        Variant::Banner => (1600, 400),
    };
    let crop = Crop {
        left: left as f64,
        top: top as f64,
        width: width as f64,
        height: height as f64,
        output_width,
        output_height,
        rotation,
    };
    if let Some(ui) = window() {
        ui.global::<ProfileModals>().set_crop_applying(true);
    }
    std::thread::spawn(move || {
        let result = profile_image::crop(&source, &crop);
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = window() {
                ui.global::<ProfileModals>().set_crop_applying(false);
            }
            match result {
                Ok(path) => {
                    close_crop();
                    match variant {
                        Variant::Avatar => set_edit_image(path),
                        Variant::Banner => upload_banner(path),
                    }
                }
                Err(error) => {
                    eprintln!("Failed to crop image: {error}");
                    toast::error(&t("user_profile.image_process_failure"));
                }
            }
        });
    });
}

/// The cropped avatar becomes the form's profileImageUrl (shown as local:).
fn set_edit_image(path: PathBuf) {
    with(|s| s.edit_image = Some(path.clone()));
    let Some((loader, scale)) = shell::loader() else {
        return;
    };
    let _ = loader;
    std::thread::spawn(move || {
        let pixels = images::decode(&path, Op::MaxWidth((128.0 * scale).ceil() as u32));
        let _ = slint::invoke_from_event_loop(move || {
            if let (Some(ui), Some(pixels)) = (window(), pixels) {
                let m = ui.global::<ProfileModals>();
                m.set_edit_avatar(pixels.into_image());
                m.set_edit_has_avatar(true);
            }
        });
    });
}
