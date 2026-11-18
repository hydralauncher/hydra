//! app.requestSingleInstanceLock + "second-instance": one app per data
//! folder. A second launch hands its arguments (a `hydralauncher://` link,
//! `--hidden`) to the running app over a local socket and exits.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;

use interprocess::local_socket::{GenericNamespaced, ListenerOptions, Stream, prelude::*};

/// The socket name for a data folder, so test instances on other folders
/// (HYDRA_USER_DATA) run side by side.
fn socket_name(user_data: &Path) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    user_data.to_string_lossy().to_lowercase().hash(&mut hasher);
    format!("hydra-native-{:016x}.sock", hasher.finish())
}

pub enum Lock {
    /// This is the only instance; `on_args` gets later launches' arguments.
    Acquired,
    /// Another instance took the arguments; exit now.
    Forwarded,
}

/// Call before opening the database. `on_args` runs on the listener thread.
pub fn acquire(
    user_data: &Path,
    args: &[String],
    on_args: impl Fn(Vec<String>) + Send + 'static,
) -> Lock {
    let name = socket_name(user_data);
    let Ok(ns_name) = name.as_str().to_ns_name::<GenericNamespaced>() else {
        return Lock::Acquired;
    };
    // Someone is listening: hand over the arguments, and let it take the
    // foreground (Windows only lets the foreground process do that).
    if let Ok(mut stream) = Stream::connect(ns_name.clone()) {
        #[cfg(windows)]
        {
            #[link(name = "user32")]
            unsafe extern "system" {
                fn AllowSetForegroundWindow(process_id: u32) -> i32;
            }
            const ASFW_ANY: u32 = u32::MAX;
            unsafe { AllowSetForegroundWindow(ASFW_ANY) };
        }
        let payload = serde_json::to_string(args).unwrap_or_else(|_| "[]".into());
        let _ = stream.write_all(payload.as_bytes());
        let _ = stream.write_all(b"\n");
        let _ = stream.flush();
        return Lock::Forwarded;
    }
    let listener = match ListenerOptions::new().name(ns_name).create_sync() {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("single instance: {error}");
            return Lock::Acquired;
        }
    };
    std::thread::Builder::new()
        .name("single-instance".into())
        .spawn(move || {
            for stream in listener.incoming().filter_map(Result::ok) {
                let mut line = String::new();
                if BufReader::new(stream).read_line(&mut line).is_ok()
                    && let Ok(args) = serde_json::from_str::<Vec<String>>(line.trim())
                {
                    on_args(args);
                }
            }
        })
        .ok();
    Lock::Acquired
}
