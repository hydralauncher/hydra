//! `hydralauncher://` links (index.ts handleDeepLinkPath), the protocol
//! registration (app.setAsDefaultProtocolClient) and "second-instance".

use slint::ComponentHandle;

use crate::{AppWindow, nav};

pub const PROTOCOL: &str = "hydralauncher";

/// Hosts that work without bringing the window up (a running app).
const RUNNING_BACKGROUND_HOSTS: [&str; 2] = ["run", "screenshot"];
/// Hosts that start the app without a window (a cold start).
pub const COLD_START_BACKGROUND_HOSTS: [&str; 1] = ["run"];

thread_local! {
    static UI: std::cell::RefCell<slint::Weak<AppWindow>> = std::cell::RefCell::new(slint::Weak::default());
}

pub fn init(ui: &AppWindow) {
    UI.with(|u| *u.borrow_mut() = ui.as_weak());
}

fn host(uri: &str) -> Option<String> {
    reqwest::Url::parse(uri)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
}

pub fn find(args: &[String]) -> Option<String> {
    args.iter()
        .find(|a| a.starts_with(&format!("{PROTOCOL}://")))
        .cloned()
}

/// isBackgroundDeepLink
pub fn is_background(uri: Option<&str>, hosts: &[&str]) -> bool {
    uri.and_then(host)
        .is_some_and(|h| hosts.contains(&h.as_str()))
}

/// app.on("second-instance"): bring the window up unless the link runs in
/// the background, then handle the link.
pub fn on_second_instance(args: Vec<String>) {
    let link = find(&args);
    if !is_background(link.as_deref(), &RUNNING_BACKGROUND_HOSTS) {
        show_main_window();
    }
    if let Some(link) = link {
        handle(&link);
    }
}

/// The main window, while it exists.
pub fn main_window() -> Option<AppWindow> {
    UI.with(|u| u.borrow().upgrade())
}

/// showToastInMainWindow's check: the main window is on screen.
pub fn main_window_visible() -> bool {
    main_window().is_some_and(|ui| ui.window().is_visible() && !ui.window().is_minimized())
}

/// mainWindow.restore() + focus() (or show it again from the tray).
pub fn show_main_window() {
    let Some(ui) = UI.with(|u| u.borrow().upgrade()) else {
        return;
    };
    let _ = ui.show();
    use slint::winit_030::WinitWindowAccessor;
    ui.window().with_winit_window(|window| {
        window.set_visible(true);
        window.set_minimized(false);
        window.focus_window();
    });
}

/// handleDeepLinkPath
pub fn handle(uri: &str) {
    let Ok(url) = reqwest::Url::parse(uri) else {
        eprintln!("Error handling deep link {uri}");
        return;
    };
    let param = |key: &str| {
        url.query_pairs()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
    };
    match url.host_str().unwrap_or_default() {
        "screenshot" => crate::screenshots::trigger_deeplink(),
        "run" => {
            if let (Some(shop), Some(object_id)) = (param("shop"), param("objectId")) {
                run_game(&shop, &object_id);
            }
        }
        "install-source" => {
            let query = url.query().map(|q| format!("?{q}")).unwrap_or_default();
            nav::navigate(&format!("/settings{query}"));
        }
        "profile" => {
            if let Some(user_id) = param("userId") {
                nav::navigate(&format!("/profile/{user_id}"));
            }
        }
        // Themes are gone from the rewrite (decided 2026-11-08).
        "install-theme" => {}
        "steam-connected" => crate::settings_integrations::handle_steam_connected_link(uri),
        other => eprintln!("deep link: unknown host {other:?}"),
    }
}

/// handleRunGame: the window only comes up when hideToTrayOnGameStart is off.
fn run_game(shop: &str, object_id: &str) {
    let key = format!("{shop}:{object_id}");
    let game: Option<serde_json::Value> =
        crate::shell::db().and_then(|db| db.get_in(hydra_db::keys::GAMES, &key));
    if game.is_none() {
        eprintln!("Game not found {key}");
        return;
    }
    if !crate::prefs::flag(&crate::prefs::get(), "hideToTrayOnGameStart") {
        show_main_window();
    }
    crate::games::play(shop, object_id);
}

/// app.setAsDefaultProtocolClient(PROTOCOL). Only installed builds register:
/// a dev build would take the links away from the installed Electron app.
pub fn register_protocol() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let exe_text = exe.to_string_lossy().to_string();
    if cfg!(debug_assertions)
        || exe_text.to_lowercase().contains(&format!(
            "{}target{}",
            std::path::MAIN_SEPARATOR,
            std::path::MAIN_SEPARATOR
        ))
    {
        return;
    }
    #[cfg(windows)]
    {
        use winreg::RegKey;
        use winreg::enums::HKEY_CURRENT_USER;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let result = (|| -> std::io::Result<()> {
            let (key, _) = hkcu.create_subkey(format!("Software\\Classes\\{PROTOCOL}"))?;
            key.set_value("", &format!("URL:{PROTOCOL}"))?;
            key.set_value("URL Protocol", &"")?;
            let (command, _) = key.create_subkey("shell\\open\\command")?;
            command.set_value("", &format!("\"{exe_text}\" \"%1\""))?;
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("Failed to register {PROTOCOL}://: {error}");
        }
    }
    // Linux and macOS register through the package (.desktop MimeType,
    // Info.plist CFBundleURLTypes).
}
