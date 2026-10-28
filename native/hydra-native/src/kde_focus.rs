#[cfg(target_os = "linux")]
mod linux {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicI64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    use zbus::blocking::{connection, Connection};

    const KWIN_SERVICE: &str = "org.kde.KWin";
    const SCRIPTING_PATH: &str = "/Scripting";
    const SCRIPTING_INTERFACE: &str = "org.kde.kwin.Scripting";
    const WATCH_PATH: &str = "/FocusWatch";
    const WATCH_INTERFACE: &str = "org.hydralauncher.FocusWatch";
    const SCRIPT_PLUGIN: &str = "hydra-focus-watch";
    const UNREPORTED: i64 = -1;
    const FIRST_REPORT_TIMEOUT: Duration = Duration::from_millis(300);
    const FIRST_REPORT_POLL: Duration = Duration::from_millis(10);
    const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(10);

    struct FocusWatch {
        pid: Arc<AtomicI64>,
    }

    #[zbus::interface(name = "org.hydralauncher.FocusWatch")]
    impl FocusWatch {
        fn report(&self, pid: String) {
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
        Running(Watcher),
        Failed(Instant),
    }

    static STATE: Mutex<State> = Mutex::new(State::Idle);

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

    fn start() -> Result<Watcher, String> {
        let process_id = std::process::id();
        let service = format!("{WATCH_INTERFACE}.p{process_id}");
        let plugin = String::from(SCRIPT_PLUGIN);
        let pid = Arc::new(AtomicI64::new(UNREPORTED));

        let connection = connection::Builder::session()
            .and_then(|builder| builder.name(service.as_str()))
            .and_then(|builder| builder.serve_at(WATCH_PATH, FocusWatch { pid: pid.clone() }))
            .and_then(|builder| builder.build())
            .map_err(|error| error.to_string())?;

        let script_path = std::env::temp_dir().join(format!("{plugin}.js"));
        std::fs::write(&script_path, script_source(&service)).map_err(|error| error.to_string())?;

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

    fn wait_for_first_report(pid: &AtomicI64) -> i64 {
        let deadline = Instant::now() + FIRST_REPORT_TIMEOUT;
        loop {
            let value = pid.load(Ordering::SeqCst);
            if value != UNREPORTED || Instant::now() >= deadline {
                return value;
            }
            thread::sleep(FIRST_REPORT_POLL);
        }
    }

    pub fn focused_process_id() -> Result<Option<u32>, String> {
        let mut state = STATE.lock().map_err(|error| error.to_string())?;
        if let State::Failed(failed_at) = *state {
            if failed_at.elapsed() < RETRY_AFTER_FAILURE {
                return Err("KWin focus watch is unavailable".into());
            }
            *state = State::Idle;
        }
        if matches!(*state, State::Idle) {
            match start() {
                Ok(watcher) => *state = State::Running(watcher),
                Err(error) => {
                    *state = State::Failed(Instant::now());
                    return Err(error);
                }
            }
        }
        let State::Running(watcher) = &*state else {
            return Err("KWin focus watch is unavailable".into());
        };

        let value = wait_for_first_report(&watcher.pid);
        if value == UNREPORTED {
            return Err("KWin did not report the active window".into());
        }
        Ok(u32::try_from(value).ok().filter(|pid| *pid > 0))
    }

    pub fn stop() {
        let Ok(mut state) = STATE.lock() else {
            return;
        };
        if let State::Running(watcher) = std::mem::replace(&mut *state, State::Idle) {
            release(watcher);
        }
    }
}

#[cfg(target_os = "linux")]
pub use linux::{focused_process_id, stop};

#[cfg(not(target_os = "linux"))]
pub fn focused_process_id() -> Result<Option<u32>, String> {
    Err("KWin focus watch is only available on Linux".into())
}

#[cfg(not(target_os = "linux"))]
pub fn stop() {}
