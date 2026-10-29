#[cfg(target_os = "linux")]
mod linux {
    use std::fs::OpenOptions;
    use std::io::{ErrorKind, Write};
    use std::os::unix::fs::OpenOptionsExt;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    use zbus::blocking::{connection, Connection};
    use zbus::message::Header;
    use zbus::names::{BusName, OwnedUniqueName};

    const KWIN_SERVICE: &str = "org.kde.KWin";
    const SCRIPTING_PATH: &str = "/Scripting";
    const SCRIPTING_INTERFACE: &str = "org.kde.kwin.Scripting";
    const WATCH_PATH: &str = "/FocusWatch";
    const WATCH_INTERFACE: &str = "org.hydralauncher.FocusWatch";
    const SCRIPT_PLUGIN: &str = "hydra-focus-watch";
    const UNREPORTED: i64 = -1;
    const METHOD_TIMEOUT: Duration = Duration::from_millis(500);
    const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(10);

    type KwinOwner = Arc<Mutex<Option<OwnedUniqueName>>>;

    struct FocusWatch {
        pid: Arc<AtomicI64>,
        kwin_owner: KwinOwner,
    }

    fn kwin_bus_name() -> zbus::Result<BusName<'static>> {
        Ok(BusName::try_from(KWIN_SERVICE)?)
    }

    fn is_known_kwin_owner(kwin_owner: &KwinOwner, sender: &str) -> bool {
        kwin_owner
            .lock()
            .map(|owner| owner.as_deref().map(|name| name.as_str()) == Some(sender))
            .unwrap_or(false)
    }

    async fn refresh_kwin_owner(
        connection: &zbus::Connection,
        kwin_owner: &KwinOwner,
    ) -> zbus::Result<OwnedUniqueName> {
        let owner = zbus::fdo::DBusProxy::new(connection)
            .await?
            .get_name_owner(kwin_bus_name()?)
            .await?;
        if let Ok(mut current) = kwin_owner.lock() {
            *current = Some(owner.clone());
        }
        Ok(owner)
    }

    fn resolve_kwin_owner(connection: &Connection) -> zbus::Result<OwnedUniqueName> {
        let proxy = zbus::blocking::fdo::DBusProxy::new(connection)?;
        Ok(proxy.get_name_owner(kwin_bus_name()?)?)
    }

    #[zbus::interface(name = "org.hydralauncher.FocusWatch")]
    impl FocusWatch {
        async fn report(
            &self,
            pid: String,
            #[zbus(header)] header: Header<'_>,
            #[zbus(connection)] connection: &zbus::Connection,
        ) {
            let Some(sender) = header.sender().map(|name| name.as_str()) else {
                return;
            };
            if !is_known_kwin_owner(&self.kwin_owner, sender) {
                let Ok(owner) = refresh_kwin_owner(connection, &self.kwin_owner).await else {
                    return;
                };
                if owner.as_str() != sender {
                    return;
                }
            }
            let value = pid.trim().parse::<i64>().unwrap_or(0);
            self.pid.store(value.max(0), Ordering::SeqCst);
        }
    }

    struct Watcher {
        connection: Connection,
        plugin: String,
        script_path: PathBuf,
        pid: Arc<AtomicI64>,
    }

    enum State {
        Idle,
        Starting(u64),
        Running(Watcher),
        Failed(Instant),
    }

    static STATE: Mutex<State> = Mutex::new(State::Idle);
    static NEXT_ATTEMPT: AtomicU64 = AtomicU64::new(0);

    fn script_source(service: &str) -> String {
        format!(
            r#"(function () {{
  function report(window) {{
    var pid = window && window.pid ? window.pid : 0;
    callDBus("{service}", "{WATCH_PATH}", "{WATCH_INTERFACE}", "Report", String(pid));
  }}
  if (workspace.windowActivated) {{
    workspace.windowActivated.connect(report);
    report(workspace.activeWindow);
  }} else {{
    workspace.clientActivated.connect(report);
    report(workspace.activeClient);
  }}
}})();
"#
        )
    }

    fn call_scripting<B>(connection: &Connection, method: &str, body: &B) -> zbus::Result<()>
    where
        B: serde::Serialize + zbus::zvariant::DynamicType,
    {
        connection
            .call_method(
                Some(KWIN_SERVICE),
                SCRIPTING_PATH,
                Some(SCRIPTING_INTERFACE),
                method,
                body,
            )
            .map(|_| ())
    }

    fn write_private_file(path: &Path, contents: &str) -> std::io::Result<()> {
        let open = || {
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(path)
        };
        let mut file = match open() {
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                std::fs::remove_file(path)?;
                open()?
            }
            result => result?,
        };
        file.write_all(contents.as_bytes())
    }

    fn start() -> Result<Watcher, String> {
        let runtime_dir = std::env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .ok_or("XDG_RUNTIME_DIR is not set")?;
        let process_id = std::process::id();
        let service = format!("{WATCH_INTERFACE}.p{process_id}");
        let plugin = String::from(SCRIPT_PLUGIN);
        let pid = Arc::new(AtomicI64::new(UNREPORTED));
        let kwin_owner: KwinOwner = Arc::new(Mutex::new(None));
        let focus_watch = FocusWatch {
            pid: pid.clone(),
            kwin_owner: kwin_owner.clone(),
        };

        let connection = connection::Builder::session()
            .and_then(|builder| builder.name(service.as_str()))
            .and_then(|builder| builder.serve_at(WATCH_PATH, focus_watch))
            .map(|builder| builder.method_timeout(METHOD_TIMEOUT))
            .and_then(|builder| builder.build())
            .map_err(|error| error.to_string())?;

        let owner = resolve_kwin_owner(&connection).map_err(|error| error.to_string())?;
        *kwin_owner.lock().map_err(|error| error.to_string())? = Some(owner);

        let script_path = runtime_dir.join(format!("{plugin}-{process_id}.js"));
        write_private_file(&script_path, &script_source(&service))
            .map_err(|error| error.to_string())?;

        let _ = call_scripting(&connection, "unloadScript", &(plugin.as_str(),));
        let script = script_path.to_string_lossy().into_owned();
        call_scripting(
            &connection,
            "loadScript",
            &(script.as_str(), plugin.as_str()),
        )
        .and_then(|_| call_scripting(&connection, "start", &()))
        .map_err(|error| {
            let _ = std::fs::remove_file(&script_path);
            error.to_string()
        })?;

        Ok(Watcher {
            connection,
            plugin,
            script_path,
            pid,
        })
    }

    fn release(watcher: Watcher) {
        let _ = call_scripting(
            &watcher.connection,
            "unloadScript",
            &(watcher.plugin.as_str(),),
        );
        let _ = std::fs::remove_file(&watcher.script_path);
    }

    fn finish_start(attempt: u64, result: Result<Watcher, String>) {
        let Ok(mut state) = STATE.lock() else {
            if let Ok(watcher) = result {
                release(watcher);
            }
            return;
        };
        let is_current = matches!(*state, State::Starting(current) if current == attempt);
        match result {
            Ok(watcher) if is_current => *state = State::Running(watcher),
            Ok(watcher) => {
                drop(state);
                release(watcher);
            }
            Err(_) if is_current => *state = State::Failed(Instant::now()),
            Err(_) => {}
        }
    }

    fn begin_start(state: &mut State) {
        if let State::Failed(failed_at) = *state {
            if failed_at.elapsed() < RETRY_AFTER_FAILURE {
                return;
            }
            *state = State::Idle;
        }
        if !matches!(*state, State::Idle) {
            return;
        }
        let attempt = NEXT_ATTEMPT.fetch_add(1, Ordering::SeqCst);
        *state = State::Starting(attempt);
        thread::spawn(move || finish_start(attempt, start()));
    }

    pub fn start_watch() {
        if let Ok(mut state) = STATE.lock() {
            begin_start(&mut state);
        }
    }

    pub fn focused_process_id() -> Result<Option<u32>, String> {
        let mut state = STATE.lock().map_err(|error| error.to_string())?;
        begin_start(&mut state);
        let State::Running(watcher) = &*state else {
            return Err("KWin focus watch is not running".into());
        };

        let value = watcher.pid.load(Ordering::SeqCst);
        if value == UNREPORTED {
            return Err("KWin has not reported the active window yet".into());
        }
        Ok(u32::try_from(value).ok().filter(|pid| *pid > 0))
    }

    pub fn stop() {
        let Ok(mut state) = STATE.lock() else {
            return;
        };
        if let State::Running(watcher) = std::mem::replace(&mut *state, State::Idle) {
            drop(state);
            release(watcher);
        }
    }
}

#[cfg(target_os = "linux")]
pub use linux::{focused_process_id, start_watch, stop};

#[cfg(not(target_os = "linux"))]
pub fn focused_process_id() -> Result<Option<u32>, String> {
    Err("KWin focus watch is only available on Linux".into())
}

#[cfg(not(target_os = "linux"))]
pub fn start_watch() {}

#[cfg(not(target_os = "linux"))]
pub fn stop() {}
