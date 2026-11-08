//! services/notifications: OS notifications (Electron's `Notification`) and
//! the local notifications the Notifications page lists
//! (LocalNotificationManager).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use hydra_db::keys;
use serde_json::{Value, json};

use crate::shell;

/// Electron's app.setAppUserModelId: toasts are grouped under the installed app.
#[cfg(windows)]
const APP_USER_MODEL_ID: &str = "gg.hydralauncher.hydra";

/// NOTIFICATION_ICON_SIZE (notification-icon.ts)
const ICON_SIZE: u32 = 256;

static TRAY_ICON: &[u8] = include_bytes!("../../../../resources/tray-icon.png");

/// <temp>/hydra-native-notifications, emptied once per run. Not Electron's
/// hydra-notifications: both apps may run side by side during the migration.
fn icon_directory() -> &'static Path {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = std::env::temp_dir().join("hydra-native-notifications");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        dir
    })
}

fn hash(text: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// transcodeNotificationIcon: a PNG at most 256px on its longest side,
/// never upscaled.
fn transcode(bytes: &[u8], name: &str) -> Option<PathBuf> {
    let image = image::load_from_memory(bytes).ok()?;
    let image = if image.width() > ICON_SIZE || image.height() > ICON_SIZE {
        image.resize(ICON_SIZE, ICON_SIZE, image::imageops::FilterType::Lanczos3)
    } else {
        image
    };
    let path = icon_directory().join(format!("icon-{}.png", hash(name)));
    image
        .save_with_format(&path, image::ImageFormat::Png)
        .ok()?;
    Some(path)
}

/// downloadImage: remote icons are fetched, `local:` ones read from disk.
/// Blocking, so call it off the UI thread.
pub(crate) fn icon_for(url: &str) -> Option<PathBuf> {
    if let Some(local) = url.strip_prefix("local:") {
        let bytes = std::fs::read(local).ok()?;
        return transcode(&bytes, url);
    }
    if !url.starts_with("http") {
        return None;
    }
    let bytes = reqwest::blocking::get(url)
        .ok()?
        .error_for_status()
        .ok()?
        .bytes()
        .ok()?;
    transcode(&bytes, url)
}

pub(crate) fn tray_icon() -> Option<PathBuf> {
    let path = icon_directory().join("tray-icon.png");
    if !path.exists() {
        std::fs::write(&path, TRAY_ICON).ok()?;
    }
    Some(path)
}

/// new Notification({ title, body, icon }).show()
fn show(title: &str, body: &str, icon: Option<&Path>) {
    #[cfg(windows)]
    {
        use tauri_winrt_notification::{IconCrop, Toast};
        let mut toast = Toast::new(APP_USER_MODEL_ID).title(title).text1(body);
        if let Some(icon) = icon {
            toast = toast.icon(icon, IconCrop::Square, "");
        }
        if let Err(error) = toast.show() {
            eprintln!("Failed to show notification: {error:?}");
        }
    }
    #[cfg(not(windows))]
    {
        let mut notification = notify_rust::Notification::new();
        notification.appname("Hydra").summary(title).body(body);
        if let Some(icon) = icon.and_then(Path::to_str) {
            notification.image_path(icon);
        }
        if let Err(error) = notification.show() {
            eprintln!("Failed to show notification: {error}");
        }
    }
}

/// A notification that runs `on_click` when activated (chat messages).
/// `silent`: no system sound (chat plays its own). The callback runs on a
/// notification thread; hand work to the UI thread from it.
pub fn show_clickable(
    title: &str,
    body: &str,
    icon: Option<&Path>,
    silent: bool,
    on_click: impl Fn() + Send + Sync + 'static,
) {
    #[cfg(windows)]
    {
        use tauri_winrt_notification::{IconCrop, Toast};
        let mut toast = Toast::new(APP_USER_MODEL_ID).title(title).text1(body);
        if let Some(icon) = icon {
            toast = toast.icon(icon, IconCrop::Square, "");
        }
        if silent {
            toast = toast.sound(None);
        }
        toast = toast.on_activated(move |_| {
            on_click();
            Ok(())
        });
        if let Err(error) = toast.show() {
            eprintln!("Failed to show notification: {error:?}");
        }
    }
    #[cfg(not(windows))]
    {
        let mut notification = notify_rust::Notification::new();
        notification
            .appname("Hydra")
            .summary(title)
            .body(body)
            .action("default", "default");
        if let Some(icon) = icon.and_then(Path::to_str) {
            notification.image_path(icon);
        }
        let _ = silent;
        match notification.show() {
            #[cfg(all(unix, not(target_os = "macos")))]
            Ok(handle) => {
                std::thread::spawn(move || {
                    handle.wait_for_action(|action| {
                        if action == "default" {
                            on_click();
                        }
                    })
                });
            }
            #[cfg(not(all(unix, not(target_os = "macos"))))]
            Ok(_) => {
                let _ = on_click;
            }
            Err(error) => eprintln!("Failed to show notification: {error}"),
        }
    }
}

/// Shows an OS notification from a worker thread (the icon is downloaded first).
fn show_async(title: String, body: String, icon_url: Option<String>, tray: bool) {
    std::thread::spawn(move || {
        // a picture that fails to load falls back to the tray icon
        let icon = if tray {
            tray_icon()
        } else {
            icon_url.as_deref().and_then(icon_for).or_else(tray_icon)
        };
        show(&title, &body, icon.as_deref());
    });
}

/// publishNewFriendRequestNotification: the sender's picture, else the tray icon.
pub fn new_friend_request(display_name: &str, picture: Option<String>) {
    let title = shell::tr("notifications.new_friend_request_title");
    let body = shell::tr_with(
        "notifications.new_friend_request_description",
        &[("displayName", display_name.to_string().into())],
    );
    let tray = picture.is_none();
    show_async(title, body, picture, tray);
}

/// publishFriendStartedPlayingGameNotification
pub fn friend_started_playing(
    display_name: &str,
    picture: Option<String>,
    game_title: Option<String>,
) {
    let title = shell::tr_with(
        "notifications.friend_started_playing_game",
        &[("displayName", display_name.to_string().into())],
    );
    let tray = picture.is_none();
    show_async(title, game_title.unwrap_or_default(), picture, tray);
}

/// LocalNotificationManager.createNotification
pub fn create_local(
    kind: &str,
    title: &str,
    description: &str,
    picture_url: Option<&str>,
    url: Option<&str>,
) {
    let Some(db) = shell::db() else { return };
    let id: String = (0..8).map(|_| format!("{:02x}", fastrand_byte())).collect();
    let created_at = hydra_core::library_actions::now_iso();
    let notification = json!({
        "id": id,
        "type": kind,
        "title": title,
        "description": description,
        "pictureUrl": picture_url,
        "url": url,
        "isRead": false,
        "createdAt": created_at,
    });
    if let Err(error) = db.put_in(keys::LOCAL_NOTIFICATIONS, &id, &notification) {
        eprintln!("Failed to create local notification: {error}");
        return;
    }
    // on-local-notification-created
    crate::notifications_page::on_local_created();
}

/// crypto.randomBytes without a dependency: the clock mixed through a hasher.
fn fastrand_byte() -> u8 {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos()),
    );
    (hasher.finish() & 0xff) as u8
}

fn game(game_id: &str) -> Option<Value> {
    shell::db()?.get_in::<Value>(keys::GAMES, game_id)
}

fn text(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// publishDownloadCompleteNotification
pub fn download_complete(game_id: &str) {
    let Some(game) = game(game_id) else { return };
    let title = shell::tr("notifications.download_complete");
    let body = shell::tr_with(
        "notifications.game_ready_to_install",
        &[("title", text(&game, "title").into())],
    );
    let icon = Some(text(&game, "iconUrl")).filter(|u| !u.is_empty());
    if crate::prefs::flag(&crate::prefs::get(), "downloadNotificationsEnabled") {
        show_async(title.clone(), body.clone(), icon.clone(), false);
    }
    let url = format!("/game/{}/{}", text(&game, "shop"), text(&game, "objectId"));
    create_local(
        "DOWNLOAD_COMPLETE",
        &title,
        &body,
        icon.as_deref(),
        Some(&url),
    );
}

/// publishDownloadHaltedNotification
#[allow(dead_code)]
pub fn download_halted(game_id: &str) {
    if !crate::prefs::flag(&crate::prefs::get(), "downloadNotificationsEnabled") {
        return;
    }
    let Some(game) = game(game_id) else { return };
    let title = shell::tr("notifications.download_halted");
    let body = shell::tr_with(
        "notifications.download_halted_no_disk_space",
        &[("title", text(&game, "title").into())],
    );
    let icon = Some(text(&game, "iconUrl")).filter(|u| !u.is_empty());
    show_async(title, body, icon, false);
}

/// publishExtractionCompleteNotification: always shown, with the tray icon.
pub fn extraction_complete(game_id: &str) {
    let Some(game) = game(game_id) else { return };
    let title = shell::tr("notifications.extraction_complete");
    let body = shell::tr_with(
        "notifications.game_extracted",
        &[("title", text(&game, "title").into())],
    );
    show_async(title.clone(), body.clone(), None, true);
    let icon = Some(text(&game, "iconUrl")).filter(|u| !u.is_empty());
    let url = format!("/game/{}/{}", text(&game, "shop"), text(&game, "objectId"));
    create_local(
        "EXTRACTION_COMPLETE",
        &title,
        &body,
        icon.as_deref(),
        Some(&url),
    );
}
