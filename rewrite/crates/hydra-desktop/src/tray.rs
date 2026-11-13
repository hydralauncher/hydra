//! WindowManager.createSystemTray: the tray icon with Open, the six most
//! recently played games and Quit.
//!
//! - Windows (tray-icon): the light or dark icon per taskbar theme,
//!   double-click shows the window, right-click opens the menu.
//! - Linux (ksni): a StatusNotifierItem over D-Bus, which is what Electron's
//!   Linux tray speaks (Chromium's StatusIconLinuxDbus). Its own thread serves
//!   it, so the winit loop needs no GTK. Click (Activate) shows the window,
//!   right-click shows the menu; the host fetches the menu over dbusmenu.

use hydra_db::{Db, keys};
use serde_json::Value;

/// The six most recently played games with an executable: (label, executable).
#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
fn recent_games(db: &Db) -> Vec<(String, String)> {
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
            (label(&text("title")), text("executablePath"))
        })
        .collect()
}

/// label: title.length > 18 ? `${title.slice(0, 18)}…` : title
#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
fn label(title: &str) -> String {
    if title.chars().count() > 18 {
        format!("{}…", title.chars().take(18).collect::<String>())
    } else {
        title.to_string()
    }
}

/// The menu actions, run on the UI thread.
#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
enum Action {
    Open,
    Game(String),
    Quit,
}

#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
fn run(action: Action) {
    match action {
        // mainWindow.show() (or a new main window)
        Action::Open => crate::deeplink::show_main_window(),
        // shell.openPath(executablePath)
        Action::Game(executable) => {
            if !hydra_launch::open_path(&executable) {
                eprintln!("Failed to open {executable}");
            }
        }
        // app.quit()
        Action::Quit => {
            let _ = slint::quit_event_loop();
        }
    }
}

#[cfg(windows)]
mod imp {
    use std::cell::RefCell;

    use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
    use tray_icon::{Icon, MouseButton, TrayIcon, TrayIconBuilder, TrayIconEvent};

    use super::Action;
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

    fn menu() -> Menu {
        let t = |key: &str| shell::tr(&format!("system_tray.{key}"));
        let menu = Menu::new();
        let _ = menu.append(&MenuItem::with_id(OPEN_ID, t("open"), true, None));
        let _ = menu.append(&PredefinedMenuItem::separator());
        let games = shell::db()
            .map(|db| super::recent_games(&db))
            .unwrap_or_default();
        for (label, executable) in games {
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
            super::run(Action::Open);
        } else if id == QUIT_ID {
            super::run(Action::Quit);
        } else if let Some(executable) = id.strip_prefix(GAME_PREFIX) {
            super::run(Action::Game(executable.to_string()));
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

#[cfg(target_os = "linux")]
mod imp {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    use hydra_db::Db;
    use ksni::blocking::{Handle, TrayMethods};
    use ksni::menu::StandardItem;

    use super::Action;
    use crate::shell;

    /// new Tray(trayIcon): Linux uses the light icon.
    static TRAY_ICON: &[u8] = include_bytes!("../../../../resources/tray-icon.png");

    /// Registered with a StatusNotifierWatcher, so a host can show the icon.
    static ONLINE: AtomicBool = AtomicBool::new(false);
    static HANDLE: Mutex<Option<Handle<HydraTray>>> = Mutex::new(None);

    struct HydraTray {
        db: Arc<Db>,
        open: String,
        quit: String,
        games: Vec<(String, String)>,
        icons: Vec<ksni::Icon>,
    }

    /// The icon as ARGB32 (network byte order) at a few sizes, so hosts don't
    /// have to shrink the 256px original to panel size themselves.
    fn icons() -> Vec<ksni::Icon> {
        let Ok(image) = image::load_from_memory(TRAY_ICON) else {
            return Vec::new();
        };
        [256u32, 64, 32]
            .into_iter()
            .map(|size| {
                let scaled = if image.width() == size {
                    image.to_rgba8()
                } else {
                    image
                        .resize_exact(size, size, image::imageops::FilterType::Lanczos3)
                        .into_rgba8()
                };
                let mut data = scaled.into_raw();
                for pixel in data.chunks_exact_mut(4) {
                    pixel.rotate_right(1); // RGBA -> ARGB
                }
                ksni::Icon {
                    width: size as i32,
                    height: size as i32,
                    data,
                }
            })
            .collect()
    }

    /// dbusmenu labels treat "_" as the access key marker; Chromium escapes
    /// literal underscores, so titles show as they are.
    fn escape(label: &str) -> String {
        label.replace('_', "__")
    }

    fn item(
        label: &str,
        action: impl Fn() -> Action + Send + 'static,
    ) -> ksni::MenuItem<HydraTray> {
        StandardItem {
            label: escape(label),
            activate: Box::new(move |_: &mut HydraTray| {
                let action = action();
                let _ = slint::invoke_from_event_loop(move || super::run(action));
            }),
            ..Default::default()
        }
        .into()
    }

    impl ksni::Tray for HydraTray {
        fn id(&self) -> String {
            "hydralauncher".into()
        }

        fn title(&self) -> String {
            "Hydra Launcher".into()
        }

        fn icon_pixmap(&self) -> Vec<ksni::Icon> {
            self.icons.clone()
        }

        // tray.setToolTip("Hydra Launcher")
        fn tool_tip(&self) -> ksni::ToolTip {
            ksni::ToolTip {
                title: "Hydra Launcher".into(),
                ..Default::default()
            }
        }

        // tray.on("click"): show the main window
        fn activate(&mut self, _x: i32, _y: i32) {
            let _ = slint::invoke_from_event_loop(|| super::run(Action::Open));
        }

        fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
            let mut menu = vec![item(&self.open, || Action::Open), ksni::MenuItem::Separator];
            for (label, executable) in &self.games {
                let executable = executable.clone();
                menu.push(item(label, move || Action::Game(executable.clone())));
            }
            menu.push(ksni::MenuItem::Separator);
            menu.push(item(&self.quit, || Action::Quit));
            menu
        }

        // Electron rebuilds the menu on every right-click (updateSystemTray).
        fn menu_about_to_show(&mut self) {
            self.games = super::recent_games(&self.db);
        }

        fn watcher_online(&self) {
            ONLINE.store(true, Ordering::Release);
        }

        fn watcher_offline(&self, reason: ksni::OfflineReason) -> bool {
            ONLINE.store(false, Ordering::Release);
            eprintln!("tray: no StatusNotifierWatcher ({reason:?}); waiting for one");
            // keep serving: the item registers again when a watcher appears
            true
        }
    }

    fn labels() -> (String, String) {
        let t = |key: &str| shell::tr(&format!("system_tray.{key}"));
        (t("open"), t("quit"))
    }

    pub fn init() {
        let Some(db) = shell::db() else { return };
        let (open, quit) = labels();
        let tray = HydraTray {
            games: super::recent_games(&db),
            db,
            open,
            quit,
            icons: icons(),
        };
        // Online until the registration says otherwise (watcher_offline runs
        // inside spawn when there is no watcher yet).
        ONLINE.store(true, Ordering::Release);
        match tray.assume_sni_available(true).spawn() {
            Ok(handle) => {
                *HANDLE.lock().unwrap_or_else(|e| e.into_inner()) = Some(handle);
            }
            Err(error) => {
                ONLINE.store(false, Ordering::Release);
                eprintln!("Failed to create the tray icon: {error}");
            }
        }
    }

    /// The library changed: new recent games (and the current language).
    pub fn refresh() {
        let Some(handle) = HANDLE.lock().unwrap_or_else(|e| e.into_inner()).clone() else {
            return;
        };
        let (open, quit) = labels();
        // Handle::update waits for the D-Bus service; keep it off the UI thread.
        std::thread::spawn(move || {
            handle.update(move |tray: &mut HydraTray| {
                tray.games = super::recent_games(&tray.db);
                tray.open = open;
                tray.quit = quit;
            });
        });
    }

    /// A host can show the icon, so closing the window can hide it there.
    pub fn available() -> bool {
        ONLINE.load(Ordering::Acquire)
            && HANDLE
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
                .is_some_and(|h| !h.is_closed())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn recent_games_like_update_system_tray() {
        let dir = std::env::temp_dir().join(format!("hydra-tray-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let db = hydra_db::Db::open(dir.join("hydra-db")).unwrap();
        let game = |id: &str, title: &str, played: Option<&str>, exe: &str, deleted: bool| {
            db.put_in(
                hydra_db::keys::GAMES,
                &format!("steam:{id}"),
                &json!({
                    "title": title,
                    "lastTimePlayed": played,
                    "executablePath": exe,
                    "isDeleted": deleted,
                }),
            )
            .unwrap();
        };
        for day in 1..=7 {
            game(
                &day.to_string(),
                &format!("Game {day}"),
                Some(&format!("2026-11-0{day}T10:00:00.000Z")),
                &format!("/games/{day}/game"),
                false,
            );
        }
        game(
            "8",
            "Deleted",
            Some("2026-11-09T10:00:00.000Z"),
            "/games/8",
            true,
        );
        game("9", "Never played", None, "/games/9", false);
        game(
            "10",
            "No executable",
            Some("2026-11-09T10:00:00.000Z"),
            "",
            false,
        );
        game(
            "11",
            "A very long game title_with_underscores",
            Some("2026-11-08T10:00:00.000Z"),
            "/games/11/game",
            false,
        );
        let games = super::recent_games(&db);
        let labels: Vec<&str> = games.iter().map(|(label, _)| label.as_str()).collect();
        assert_eq!(
            labels,
            [
                "A very long game t…",
                "Game 7",
                "Game 6",
                "Game 5",
                "Game 4",
                "Game 3"
            ]
        );
        assert_eq!(games[1].1, "/games/7/game");
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(any(windows, target_os = "linux"))]
pub use imp::{available, init, refresh};

#[cfg(not(any(windows, target_os = "linux")))]
pub fn init() {}
#[cfg(not(any(windows, target_os = "linux")))]
pub fn refresh() {}
#[cfg(not(any(windows, target_os = "linux")))]
pub fn available() -> bool {
    false
}
