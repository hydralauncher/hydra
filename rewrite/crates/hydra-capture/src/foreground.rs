//! resolveForegroundWindow (screenshots/foreground-game.ts) and
//! screenshots/wayland-focus.ts: which window has the focus, and its process.

/// ForegroundWindowInfo
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ForegroundWindow {
    pub process_id: Option<u32>,
    /// Windows HWND, as a decimal string (window_order.rs)
    pub window_handle: Option<String>,
    /// X11 window id, as a decimal string
    pub window_id: Option<String>,
    /// The X11 client's pid (XRes), which can differ from _NET_WM_PID in sandboxes
    pub client_process_id: Option<u32>,
    /// "x11", "hyprland", "sway" or "kde"
    pub focus_source: Option<&'static str>,
}

impl ForegroundWindow {
    /// getForegroundWindowKey
    pub fn window_key(&self) -> Option<&str> {
        self.window_handle.as_deref().or(self.window_id.as_deref())
    }
}

/// isWaylandSession (linux-game-capture-session.ts)
pub fn is_wayland_session() -> bool {
    cfg!(target_os = "linux")
        && (std::env::var("XDG_SESSION_TYPE")
            .map(|value| value.eq_ignore_ascii_case("wayland"))
            .unwrap_or(false)
            || std::env::var_os("WAYLAND_DISPLAY").is_some_and(|v| !v.is_empty()))
}

/// resolveForegroundWindow
pub fn foreground_window() -> Option<ForegroundWindow> {
    #[cfg(windows)]
    {
        crate::window_order::get_foreground_window().map(|(handle, pid)| ForegroundWindow {
            process_id: Some(pid),
            window_handle: Some(handle),
            ..Default::default()
        })
    }
    #[cfg(target_os = "linux")]
    {
        if is_wayland_session() {
            if let Some(focus) = wayland::focus() {
                return Some(ForegroundWindow {
                    process_id: focus.process_id,
                    focus_source: Some(focus.source),
                    ..Default::default()
                });
            }
        }
        let (window, process_id) = crate::active_window::get_active_window()?;
        let window_id = window.to_string();
        Some(ForegroundWindow {
            process_id,
            client_process_id: crate::window_client::get_window_client_pid(&window_id),
            window_id: Some(window_id),
            focus_source: Some("x11"),
            ..Default::default()
        })
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        None
    }
}

/// startWaylandFocusWatch: KDE keeps a focus watch while games run.
pub fn start_wayland_focus_watch() {
    #[cfg(target_os = "linux")]
    if wayland::is_kde_session() {
        crate::kde_focus::start_watch();
    }
}

/// stopWaylandFocusWatch
pub fn stop_wayland_focus_watch() {
    crate::kde_focus::stop();
}

#[cfg(target_os = "linux")]
pub mod wayland {
    //! wayland-focus.ts: Hyprland and Sway IPC sockets, then KDE (kde_focus.rs).
    use std::io::{Read, Write};
    use std::os::unix::net::UnixStream;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    const SOCKET_TIMEOUT: Duration = Duration::from_millis(500);
    const I3_IPC_MAGIC: &[u8] = b"i3-ipc";
    const I3_IPC_HEADER_SIZE: usize = 6 + 8;
    const I3_IPC_GET_TREE: u32 = 4;

    pub struct WaylandFocus {
        pub source: &'static str,
        pub process_id: Option<u32>,
    }

    fn request(
        path: &Path,
        payload: &[u8],
        is_complete: impl Fn(&[u8]) -> bool,
    ) -> std::io::Result<Vec<u8>> {
        let mut socket = UnixStream::connect(path)?;
        socket.set_read_timeout(Some(SOCKET_TIMEOUT))?;
        socket.set_write_timeout(Some(SOCKET_TIMEOUT))?;
        socket.write_all(payload)?;
        let mut response = Vec::new();
        let mut chunk = [0u8; 16 * 1024];
        loop {
            match socket.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => {
                    response.extend_from_slice(&chunk[..read]);
                    if is_complete(&response) {
                        break;
                    }
                }
                Err(error) => return Err(error),
            }
        }
        Ok(response)
    }

    fn to_pid(value: Option<&serde_json::Value>) -> Option<u32> {
        value
            .and_then(serde_json::Value::as_u64)
            .filter(|pid| *pid > 0 && *pid <= u64::from(u32::MAX))
            .map(|pid| pid as u32)
    }

    fn hyprland_socket(signature: &str) -> Option<PathBuf> {
        let runtime = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from);
        [
            runtime.map(|dir| dir.join("hypr").join(signature).join(".socket.sock")),
            Some(Path::new("/tmp/hypr").join(signature).join(".socket.sock")),
        ]
        .into_iter()
        .flatten()
        .find(|candidate| candidate.exists())
    }

    fn hyprland_focus(path: &Path) -> Result<Option<u32>, String> {
        let response = request(path, b"j/activewindow", |_| false).map_err(|e| e.to_string())?;
        let window: serde_json::Value =
            serde_json::from_slice(&response).map_err(|e| e.to_string())?;
        Ok(to_pid(window.get("pid")))
    }

    fn payload_length(response: &[u8]) -> Option<usize> {
        (response.len() >= I3_IPC_HEADER_SIZE)
            .then(|| u32::from_le_bytes(response[6..10].try_into().unwrap_or_default()) as usize)
    }

    fn focused_sway_pid(node: &serde_json::Value) -> Option<Option<u32>> {
        if node.get("focused").and_then(serde_json::Value::as_bool) == Some(true) {
            return Some(to_pid(node.get("pid")));
        }
        ["nodes", "floating_nodes"]
            .iter()
            .filter_map(|key| node.get(*key).and_then(serde_json::Value::as_array))
            .flatten()
            .find_map(focused_sway_pid)
    }

    fn sway_focus(path: &Path) -> Result<Option<u32>, String> {
        let mut header = Vec::with_capacity(I3_IPC_HEADER_SIZE);
        header.extend_from_slice(I3_IPC_MAGIC);
        header.extend_from_slice(&0u32.to_le_bytes());
        header.extend_from_slice(&I3_IPC_GET_TREE.to_le_bytes());
        let response = request(path, &header, |current| {
            payload_length(current)
                .is_some_and(|length| current.len() >= I3_IPC_HEADER_SIZE + length)
        })
        .map_err(|e| e.to_string())?;
        let length = payload_length(&response).ok_or("Sway IPC reply was truncated")?;
        let end = (I3_IPC_HEADER_SIZE + length).min(response.len());
        let tree: serde_json::Value = serde_json::from_slice(&response[I3_IPC_HEADER_SIZE..end])
            .map_err(|e| e.to_string())?;
        Ok(focused_sway_pid(&tree).flatten())
    }

    pub fn is_kde_session() -> bool {
        std::env::var("XDG_CURRENT_DESKTOP")
            .unwrap_or_default()
            .split(':')
            .any(|desktop| desktop.eq_ignore_ascii_case("KDE"))
    }

    fn read(
        source: &'static str,
        read: impl FnOnce() -> Result<Option<u32>, String>,
    ) -> Option<WaylandFocus> {
        match read() {
            Ok(process_id) => Some(WaylandFocus { source, process_id }),
            Err(error) => {
                eprintln!("Failed to read the focused Wayland window ({source}): {error}");
                None
            }
        }
    }

    /// getWaylandFocus
    pub fn focus() -> Option<WaylandFocus> {
        if let Some(path) = std::env::var("HYPRLAND_INSTANCE_SIGNATURE")
            .ok()
            .and_then(|signature| hyprland_socket(&signature))
        {
            if let Some(focus) = read("hyprland", || hyprland_focus(&path)) {
                return Some(focus);
            }
        }
        if let Some(path) = std::env::var_os("SWAYSOCK")
            .map(PathBuf::from)
            .filter(|path| path.exists())
        {
            if let Some(focus) = read("sway", || sway_focus(&path)) {
                return Some(focus);
            }
        }
        if is_kde_session() {
            // getKdeFocusedProcessId: undefined (an error) means no KDE focus
            if let Ok(process_id) = crate::kde_focus::focused_process_id() {
                return Some(WaylandFocus {
                    source: "kde",
                    process_id,
                });
            }
        }
        None
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn finds_the_focused_sway_node() {
            let tree = serde_json::json!({
                "nodes": [{ "nodes": [{ "focused": false, "pid": 3 }] }],
                "floating_nodes": [{ "focused": true, "pid": 42 }]
            });
            assert_eq!(focused_sway_pid(&tree), Some(Some(42)));
        }
    }
}
