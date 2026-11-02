mod evdev_input;
mod x11;

use super::binding::Backend;
use super::{BackendResult, Context, PlatformStatus, StartOptions};
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::sync::Arc;
use std::thread::JoinHandle;

pub struct WakePipe {
    read: OwnedFd,
    write: OwnedFd,
}

impl WakePipe {
    fn new() -> io::Result<Self> {
        let mut fds = [0; 2];
        if unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC | libc::O_NONBLOCK) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self {
            read: unsafe { OwnedFd::from_raw_fd(fds[0]) },
            write: unsafe { OwnedFd::from_raw_fd(fds[1]) },
        })
    }

    pub fn read_fd(&self) -> RawFd {
        self.read.as_raw_fd()
    }

    fn wake(&self) {
        let byte = 1u8;
        unsafe {
            libc::write(self.write.as_raw_fd(), (&byte as *const u8).cast(), 1);
        }
    }
}

pub fn poll_fds(fds: &mut [libc::pollfd], timeout_ms: i32) -> io::Result<usize> {
    loop {
        let result = unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as libc::nfds_t, timeout_ms) };
        if result >= 0 {
            return Ok(result as usize);
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

pub fn pollfd(fd: RawFd) -> libc::pollfd {
    libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    }
}

pub struct Runtime {
    wake: Option<Arc<WakePipe>>,
    threads: Vec<JoinHandle<()>>,
}

impl Runtime {
    pub fn stop(self) {
        if let Some(wake) = &self.wake {
            wake.wake();
        }
        for thread in self.threads {
            let _ = thread.join();
        }
    }
}

fn is_wayland_session() -> bool {
    let wayland_display =
        std::env::var_os("WAYLAND_DISPLAY").is_some_and(|value| !value.is_empty());
    let session_type = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    wayland_display || session_type.eq_ignore_ascii_case("wayland")
}

enum KeyboardPlan {
    Disabled,
    X11,
    Evdev,
    Unavailable(&'static str),
}

fn plan_keyboard(
    enabled: bool,
    wayland: bool,
    x11: impl FnOnce() -> Result<(), &'static str>,
    evdev_keyboard_readable: impl FnOnce() -> bool,
) -> KeyboardPlan {
    if !enabled {
        return KeyboardPlan::Disabled;
    }
    if wayland {
        if evdev_keyboard_readable() {
            return KeyboardPlan::Evdev;
        }
        return match x11() {
            Ok(()) => KeyboardPlan::X11,
            Err(_) => KeyboardPlan::Unavailable("wayland-no-access"),
        };
    }
    match x11() {
        Ok(()) => KeyboardPlan::X11,
        Err(_) if evdev_keyboard_readable() => KeyboardPlan::Evdev,
        Err(error) => KeyboardPlan::Unavailable(error),
    }
}

fn gamepad_result(enabled: bool, access: &evdev_input::Access) -> BackendResult {
    if !enabled {
        return BackendResult::disabled();
    }
    if !access.input_dir_readable {
        return BackendResult::unavailable("no-input-access");
    }
    BackendResult {
        backend: Backend::Evdev,
        error: access.gamepad_denied.then_some("gamepad-no-access"),
    }
}

pub fn probe(options: StartOptions) -> PlatformStatus {
    let wayland = is_wayland_session();
    let access = evdev_input::Access::scan();
    let plan = plan_keyboard(
        options.keyboard,
        wayland,
        || x11::Listener::connect().map(|_| ()),
        || access.keyboard_readable,
    );
    PlatformStatus {
        keyboard: keyboard_result(&plan),
        gamepad: gamepad_result(options.gamepad, &access),
        wayland_session: wayland,
    }
}

fn keyboard_result(plan: &KeyboardPlan) -> BackendResult {
    match plan {
        KeyboardPlan::Disabled => BackendResult::disabled(),
        KeyboardPlan::X11 => BackendResult::active(Backend::X11XInput2),
        KeyboardPlan::Evdev => BackendResult::active(Backend::Evdev),
        KeyboardPlan::Unavailable(error) => BackendResult::unavailable(error),
    }
}

pub fn start(context: Arc<Context>, options: StartOptions) -> (Runtime, PlatformStatus) {
    let wayland = is_wayland_session();
    let wake = match WakePipe::new() {
        Ok(wake) => Arc::new(wake),
        Err(_) => {
            return (
                Runtime {
                    wake: None,
                    threads: Vec::new(),
                },
                PlatformStatus {
                    keyboard: BackendResult::unavailable("thread-failed"),
                    gamepad: BackendResult::unavailable("thread-failed"),
                    wayland_session: wayland,
                },
            )
        }
    };

    let access = if options.keyboard || options.gamepad {
        evdev_input::Access::scan()
    } else {
        evdev_input::Access::default()
    };
    let mut listener = None;
    let plan = plan_keyboard(
        options.keyboard,
        wayland,
        || {
            listener = Some(x11::Listener::connect()?);
            Ok(())
        },
        || access.keyboard_readable,
    );

    let mut threads = Vec::new();
    let mut keyboard = keyboard_result(&plan);
    if let (KeyboardPlan::X11, Some(listener)) = (&plan, listener) {
        match x11::spawn(listener, context.clone(), wake.clone()) {
            Ok(thread) => threads.push(thread),
            Err(_) => keyboard = BackendResult::unavailable("thread-failed"),
        }
    }

    let mut gamepad = gamepad_result(options.gamepad, &access);
    let roles = evdev_input::Roles {
        keyboard: matches!(plan, KeyboardPlan::Evdev),
        gamepad: gamepad.backend == Backend::Evdev,
    };
    if roles.keyboard || roles.gamepad {
        match evdev_input::spawn(roles, context, wake.clone()) {
            Ok(thread) => threads.push(thread),
            Err(_) => {
                if roles.keyboard {
                    keyboard = BackendResult::unavailable("thread-failed");
                }
                if roles.gamepad {
                    gamepad = BackendResult::unavailable("thread-failed");
                }
            }
        }
    }

    (
        Runtime {
            wake: Some(wake),
            threads,
        },
        PlatformStatus {
            keyboard,
            gamepad,
            wayland_session: wayland,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(
        enabled: bool,
        wayland: bool,
        x11: Result<(), &'static str>,
        evdev: bool,
    ) -> &'static str {
        match plan_keyboard(enabled, wayland, || x11, || evdev) {
            KeyboardPlan::Disabled => "disabled",
            KeyboardPlan::X11 => "x11",
            KeyboardPlan::Evdev => "evdev",
            KeyboardPlan::Unavailable(error) => error,
        }
    }

    #[test]
    fn keyboard_backend_order() {
        assert_eq!(plan(false, false, Ok(()), true), "disabled");
        assert_eq!(plan(true, false, Ok(()), true), "x11");
        assert_eq!(plan(true, false, Err("no-display"), true), "evdev");
        assert_eq!(plan(true, false, Err("no-display"), false), "no-display");
        assert_eq!(plan(true, true, Ok(()), true), "evdev");
        assert_eq!(plan(true, true, Ok(()), false), "x11");
        assert_eq!(
            plan(true, true, Err("no-display"), false),
            "wayland-no-access"
        );
    }

    #[test]
    fn wake_pipe_wakes_poll() {
        let wake = WakePipe::new().unwrap();
        let mut fds = [pollfd(wake.read_fd())];
        assert_eq!(poll_fds(&mut fds, 0).unwrap(), 0);
        wake.wake();
        assert_eq!(poll_fds(&mut fds, 1000).unwrap(), 1);
        assert_ne!(fds[0].revents & libc::POLLIN, 0);
    }
}
