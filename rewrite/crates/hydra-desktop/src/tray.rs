//! WindowManager.createSystemTray: the tray icon with Open, the six most
//! recently played games and Quit. Windows only for now; Linux needs a
//! StatusNotifierItem host (ksni) since the winit loop runs no GTK.

#[cfg(windows)]
mod imp {
    use std::cell::RefCell;

    use hydra_db::keys;
    use serde_json::Value;
    use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
    use tray_icon::{Icon, MouseButton, TrayIcon, TrayIconBuilder, TrayIconEvent};

    use crate::shell;

    static TRAY_ICON: &[u8] = include_bytes!("../../../../resources/tray-icon.png");
    static TRAY_ICON_DARK: &[u8] = include_bytes!("../../../../resources/tray-icon-dark.png");

    const OPEN_ID: &str = "tray-open";
    const QUIT_ID: &str = "tray-quit";
    const GAME_PREFIX: &str = "tray-game:";

    thread_local! {
        static TRAY: RefCell<Option<TrayIcon>> = const { RefCell::new(None) };
    }

    /// nativeTheme.shouldUseDarkColorsForSystemIntegratedUI: the light icon on
    /// a dark taskbar.
    fn taskbar_is_dark() -> bool {
        use winreg::RegKey;
        use winreg::enums::HKEY_CURRENT_USER;
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize")
            .and_then(|key| key.get_value::<u32, _>("SystemUsesLightTheme"))
            .map(|light| light == 0)
            .unwrap_or(true)
    }

    fn icon() -> Option<Icon> {
        let bytes = if taskbar_is_dark() {
            TRAY_ICON
        } else {
            TRAY_ICON_DARK
        };
        let image = image::load_from_memory(bytes).ok()?.into_rgba8();
        let (width, height) = image.dimensions();
        Icon::from_rgba(image.into_raw(), width, height).ok()
    }

    /// The six most recently played games with an executable.
    fn recent_games() -> Vec<(String, String)> {
        let Some(db) = shell::db() else {
            return Vec::new();
        };
        let mut games: Vec<Value> = db
            .values::<Value>(keys::GAMES)
            .unwrap_or_default()
            .into_iter()
            .filter(|g| {
                g.get("isDeleted").and_then(Value::as_bool) != Some(true)
                    && g.get("executablePath")
                        .and_then(Value::as_str)
                        .is_some_and(|p| !p.is_empty())
                    && g.get("lastTimePlayed").is_some_and(|v| !v.is_null())
            })
            .collect();
        let played = |g: &Value| {
            g.get("lastTimePlayed")
                .and_then(Value::as_str)
                .and_then(hydra_core::library::parse_iso_millis)
                .unwrap_or(0)
        };
        games.sort_by_key(|g| std::cmp::Reverse(played(g)));
        games
            .into_iter()
            .take(6)
            .map(|g| {
                let text = |k: &str| {
                    g.get(k)
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string()
                };
                (text("title"), text("executablePath"))
            })
            .collect()
    }

    fn menu() -> Menu {
        let t = |key: &str| shell::tr(&format!("system_tray.{key}"));
        let menu = Menu::new();
        let _ = menu.append(&MenuItem::with_id(OPEN_ID, t("open"), true, None));
        let _ = menu.append(&PredefinedMenuItem::separator());
        for (title, executable) in recent_games() {
            // label: title.length > 18 ? `${title.slice(0, 18)}…` : title
            let label = if title.chars().count() > 18 {
                format!("{}…", title.chars().take(18).collect::<String>())
            } else {
                title
            };
            let _ = menu.append(&MenuItem::with_id(
                format!("{GAME_PREFIX}{executable}"),
                label,
                true,
                None,
            ));
        }
        let _ = menu.append(&PredefinedMenuItem::separator());
        let _ = menu.append(&MenuItem::with_id(QUIT_ID, t("quit"), true, None));
        menu
    }

    pub fn init() {
        let tray = TrayIconBuilder::new()
            .with_tooltip("Hydra Launcher")
            .with_menu(Box::new(menu()))
            .with_menu_on_left_click(false);
        let tray = match icon() {
            Some(icon) => tray.with_icon(icon),
            None => tray,
        };
        match tray.build() {
            Ok(tray) => TRAY.with(|t| *t.borrow_mut() = Some(tray)),
            Err(error) => {
                eprintln!("Failed to create the tray icon: {error}");
                return;
            }
        }
        // double-click: show the window
        TrayIconEvent::set_event_handler(Some(|event: TrayIconEvent| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                let _ = slint::invoke_from_event_loop(crate::deeplink::show_main_window);
            }
        }));
        MenuEvent::set_event_handler(Some(|event: MenuEvent| {
            let id = event.id().0.clone();
            let _ = slint::invoke_from_event_loop(move || on_menu(&id));
        }));
    }

    fn on_menu(id: &str) {
        if id == OPEN_ID {
            crate::deeplink::show_main_window();
        } else if id == QUIT_ID {
            let _ = slint::quit_event_loop();
        } else if let Some(executable) = id.strip_prefix(GAME_PREFIX) {
            // shell.openPath(executablePath)
            if !hydra_launch::open_path(executable) {
                eprintln!("Failed to open {executable}");
            }
        }
    }

    /// Rebuild the menu (Electron rebuilds it on every right-click).
    pub fn refresh() {
        TRAY.with(|t| {
            if let Some(tray) = t.borrow().as_ref() {
                tray.set_menu(Some(Box::new(menu())));
            }
        });
    }

    pub fn available() -> bool {
        TRAY.with(|t| t.borrow().is_some())
    }
}

#[cfg(windows)]
pub use imp::{available, init, refresh};

#[cfg(not(windows))]
pub fn init() {}
#[cfg(not(windows))]
pub fn refresh() {}
#[cfg(not(windows))]
pub fn available() -> bool {
    false
}
