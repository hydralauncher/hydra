//! events/library/create-game-shortcut.ts: desktop and Start Menu shortcuts
//! that open `hydralauncher://run?shop=…&objectId=…` with this executable,
//! with the game's icon converted to `.ico` under `<userData>/Assets`.
//! Windows gets a `.lnk` (WScript.Shell, like create-desktop-shortcuts'
//! windows.vbs) and falls back to an `.url` internet shortcut; Linux gets a
//! `.desktop` launcher.

use std::path::{Path, PathBuf};

use base64::Engine;
use hydra_db::keys;
use serde_json::{Map, Value};

use crate::{shell, toast};

/// "desktop" | "start_menu"
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Location {
    Desktop,
    StartMenu,
}

impl Location {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "desktop" => Some(Self::Desktop),
            "start_menu" => Some(Self::StartMenu),
            _ => None,
        }
    }
}

/// removeSymbolsFromName: ASCII letters, digits and spaces only.
pub fn remove_symbols(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == ' ')
        .collect()
}

/// buildRunDeepLink: URLSearchParams({ shop, objectId }).
pub fn run_deep_link(shop: &str, object_id: &str) -> String {
    let encode = |text: &str| -> String {
        text.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'*' => {
                    (b as char).to_string()
                }
                b' ' => "+".to_string(),
                _ => format!("%{b:02X}"),
            })
            .collect()
    };
    format!(
        "hydralauncher://run?shop={}&objectId={}",
        encode(shop),
        encode(object_id)
    )
}

fn output_dir(location: Location) -> Option<PathBuf> {
    if cfg!(windows) && location == Location::StartMenu {
        return std::env::var_os("APPDATA").map(|a| {
            PathBuf::from(a)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
        });
    }
    dirs::desktop_dir()
}

/// createGameShortcut, on a worker thread. Errors carry Electron's messages.
pub fn create(
    handles: &Handles,
    shop: &str,
    object_id: &str,
    location: Location,
) -> Result<PathBuf, String> {
    let db = handles.0.clone().ok_or("no database")?;
    let key = keys::game(shop, object_id);
    let game: Map<String, Value> = db
        .get_in(keys::GAMES, &key)
        .ok_or("Could not find this game in your library.")?;
    let text = |k: &str| {
        game.get(k)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    if shop == "launchbox" {
        let disc = text("selectedDiscPath").or_else(|| {
            game.get("discs")
                .and_then(Value::as_array)
                .and_then(|d| d.first())
                .and_then(|d| d.get("path"))
                .and_then(Value::as_str)
                .map(str::to_string)
        });
        if !disc.is_some_and(|d| Path::new(&d).exists()) {
            return Err("Classic games need an available disc before creating a shortcut.".into());
        }
    }
    if location == Location::StartMenu && !cfg!(windows) {
        return Err("Start Menu shortcuts are only available on Windows.".into());
    }
    let title = text("title").unwrap_or_default();
    let name = {
        let cleaned = remove_symbols(&title).trim().to_string();
        if cleaned.is_empty() {
            object_id.to_string()
        } else {
            cleaned
        }
    };
    let deep_link = run_deep_link(shop, object_id);
    let output = output_dir(location).ok_or("Could not resolve the shortcut output folder.")?;
    std::fs::create_dir_all(&output).map_err(|e| e.to_string())?;

    let assets = if shop == "custom" {
        None
    } else {
        game_assets(handles, shop, object_id)
    };
    let asset = |k: &str| {
        assets
            .as_ref()
            .and_then(|a| a.get(k))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let icon = download_icon(
        shop,
        object_id,
        &[
            text("customIconUrl"),
            asset("iconUrl"),
            text("iconUrl"),
            asset("coverImageUrl"),
        ],
    );
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;

    if cfg!(windows) {
        let link = output.join(format!("{name}.lnk"));
        let url = output.join(format!("{name}.url"));
        let _ = std::fs::remove_file(&link);
        let _ = std::fs::remove_file(&url);
        let icon_location = icon
            .clone()
            .unwrap_or_else(|| executable.clone())
            .to_string_lossy()
            .to_string();
        if windows_lnk(&link, &executable, &deep_link, &icon_location).is_ok() && link.exists() {
            return Ok(link);
        }
        // createUrlShortcut
        let mut content = format!("[InternetShortcut]\nURL={deep_link}\n");
        content.push_str(&format!("IconFile={icon_location}\nIconIndex=0\n"));
        std::fs::write(&url, content).map_err(|_| {
            let place = if location == Location::Desktop {
                "desktop"
            } else {
                "Start Menu"
            };
            format!("Failed to create {place} shortcut in {}.", output.display())
        })?;
        return Ok(url);
    }

    if cfg!(target_os = "linux") {
        let file = output.join(format!("{name}.desktop"));
        let quote = |v: &str| format!("\"{}\"", v.replace('"', "\\\""));
        let mut content = format!(
            "#!/usr/bin/env xdg-open\n[Desktop Entry]\nVersion=1.0\nType=Application\nTerminal=false\nExec={} {}\nName={name}\n",
            quote(&executable.to_string_lossy()),
            quote(&deep_link)
        );
        if let Some(icon) = &icon {
            content.push_str(&format!("Icon={}\n", icon.display()));
        }
        std::fs::write(&file, content).map_err(|_| "Failed to create desktop shortcut.")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755));
        }
        return Ok(file);
    }

    // TODO(shortcuts): macOS (create-desktop-shortcuts' osx alias).
    Err("Failed to create desktop shortcut.".into())
}

/// A `.lnk` through WScript.Shell, values passed in the environment so no
/// quoting can break the script.
#[cfg(windows)]
fn windows_lnk(link: &Path, target: &Path, arguments: &str, icon: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let script = "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:HYDRA_LNK); \
        $s.TargetPath = $env:HYDRA_LNK_TARGET; $s.Arguments = $env:HYDRA_LNK_ARGS; \
        $s.IconLocation = $env:HYDRA_LNK_ICON; \
        $s.WorkingDirectory = [System.IO.Path]::GetDirectoryName($env:HYDRA_LNK_TARGET); $s.Save()";
    let status = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("HYDRA_LNK", link)
        .env("HYDRA_LNK_TARGET", target)
        .env("HYDRA_LNK_ARGS", arguments)
        .env("HYDRA_LNK_ICON", icon)
        .creation_flags(0x0800_0000)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("powershell exited with {status}"))
    }
}

#[cfg(not(windows))]
fn windows_lnk(_: &Path, _: &Path, _: &str, _: &str) -> Result<(), String> {
    Err("not windows".into())
}

/// getGameAssets: the stored shop assets, else the API.
fn game_assets(handles: &Handles, shop: &str, object_id: &str) -> Option<Value> {
    let db = handles.0.clone()?;
    if let Some(stored) = db.get_in::<Value>(keys::GAME_SHOP_ASSETS, &keys::game(shop, object_id)) {
        return Some(stored);
    }
    handles
        .1
        .clone()?
        .get(
            &format!("/games/{shop}/{object_id}/assets"),
            &[],
            hydra_core::api::Options::public(),
        )
        .ok()
}

/// downloadIcon: the first source that decodes, as a 256x256 `.ico` cached
/// by a hash of its URL.
fn download_icon(shop: &str, object_id: &str, sources: &[Option<String>]) -> Option<PathBuf> {
    let valid: Vec<&String> = sources
        .iter()
        .flatten()
        .filter(|u| {
            u.starts_with("http://") || u.starts_with("https://") || u.starts_with("local:")
        })
        .collect();
    let first = valid.first()?;
    let hash: String = base64::engine::general_purpose::STANDARD
        .encode(first.as_bytes())
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(16)
        .collect();
    let dir = hydra_db::paths::native_user_data()?
        .join("Assets")
        .join(format!("{shop}-{object_id}"));
    let path = dir.join(format!("icon-{hash}.ico"));
    if path.exists() {
        return Some(path);
    }
    std::fs::create_dir_all(&dir).ok()?;
    let http = hydra_store::http_client();
    for url in valid {
        let bytes = if let Some(local) = url.strip_prefix("local:") {
            std::fs::read(local).ok()
        } else {
            http.get(url.as_str())
                .send()
                .and_then(|r| r.error_for_status())
                .and_then(|r| r.bytes())
                .ok()
                .map(|b| b.to_vec())
        };
        let Some(bytes) = bytes else { continue };
        if url.to_lowercase().ends_with(".ico") {
            if std::fs::write(&path, &bytes).is_ok() {
                return Some(path);
            }
            continue;
        }
        let Ok(img) = image::load_from_memory(&bytes) else {
            continue;
        };
        // sharp(...).resize(256, 256, { fit: "cover" })
        let square = img.resize_to_fill(256, 256, image::imageops::FilterType::Lanczos3);
        if square
            .save_with_format(&path, image::ImageFormat::Ico)
            .is_ok()
        {
            return Some(path);
        }
    }
    eprintln!("Failed to download/convert game icon from any source");
    None
}

/// The database and API, taken on the UI thread for the worker.
pub type Handles = (
    Option<std::sync::Arc<hydra_db::Db>>,
    Option<std::sync::Arc<hydra_core::api::HydraApi>>,
);

fn handles() -> Handles {
    (shell::db(), shell::api())
}

/// handleCreateShortcut: create on a worker, then the toast.
pub fn create_with_toast(shop: &str, object_id: &str, location: Location) {
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    let handles = handles();
    std::thread::spawn(move || {
        let result = create(&handles, &shop, &object_id, location);
        let _ = slint::invoke_from_event_loop(move || match result {
            Ok(_) => toast::success(&shell::tr("game_details.create_shortcut_success")),
            Err(error) => {
                eprintln!("Failed to create shortcut: {error}");
                toast::error(&shell::tr("game_details.create_shortcut_error"));
            }
        });
    });
}

/// use-game-actions.ts handleCreateShortcut (context menu): the desktop and,
/// on Windows, the Start Menu.
pub fn create_all_with_toast(shop: &str, object_id: &str) {
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    let handles = handles();
    std::thread::spawn(move || {
        let mut locations = vec![Location::Desktop];
        if cfg!(windows) {
            locations.push(Location::StartMenu);
        }
        let result = locations
            .into_iter()
            .try_for_each(|location| create(&handles, &shop, &object_id, location).map(|_| ()));
        let _ = slint::invoke_from_event_loop(move || match result {
            Ok(()) => toast::success(&shell::tr("game_details.create_shortcut_success")),
            Err(error) => {
                eprintln!("Failed to create shortcut: {error}");
                toast::show(
                    toast::Kind::Error,
                    &shell::tr("game_details.create_shortcut_error"),
                    Some(&error),
                );
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_run_links_and_names() {
        assert_eq!(
            run_deep_link("steam", "2050650"),
            "hydralauncher://run?shop=steam&objectId=2050650"
        );
        assert_eq!(
            run_deep_link("custom", "a b/c"),
            "hydralauncher://run?shop=custom&objectId=a+b%2Fc"
        );
        assert_eq!(remove_symbols("Call of Duty® HQ: Ü"), "Call of Duty HQ ");
    }
}
