use super::super::binding::{
    is_linux_gamepad, is_linux_keyboard, linux_trigger_ranges, AxisRange, Backend, ComboMatcher,
    HotkeyMatcher, LinuxGamepadState, ModifierTracker, TriggerSource,
};
use super::super::Context;
use super::{poll_fds, pollfd, WakePipe};
use evdev::{AbsoluteAxisCode, Device, EventType, KeyCode};
use std::collections::HashSet;
use std::ffi::CString;
use std::fs;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

const INPUT_DIR: &str = "/dev/input";
const LINK_DIRS: [&str; 2] = ["/dev/input/by-id", "/dev/input/by-path"];
const RESCAN_TIMEOUT_MS: i32 = 5000;

#[derive(Default)]
pub struct Access {
    pub input_dir_readable: bool,
    pub keyboard_readable: bool,
    pub gamepad_denied: bool,
}

impl Access {
    pub fn scan() -> Self {
        let Ok(entries) = event_nodes() else {
            return Self::default();
        };
        let keyboard_readable = entries.iter().any(|path| {
            Device::open(path)
                .map(|device| is_linux_keyboard(supports_key(&device)))
                .unwrap_or(false)
        });
        Self {
            input_dir_readable: true,
            keyboard_readable,
            gamepad_denied: joystick_permission_denied(),
        }
    }
}

fn event_nodes() -> io::Result<Vec<PathBuf>> {
    let mut nodes: Vec<PathBuf> = fs::read_dir(INPUT_DIR)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("event"))
        .map(|entry| entry.path())
        .collect();
    nodes.sort();
    Ok(nodes)
}

fn joystick_permission_denied() -> bool {
    LINK_DIRS
        .iter()
        .filter_map(|dir| fs::read_dir(dir).ok())
        .flatten()
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .ends_with("-event-joystick")
        })
        .filter_map(|entry| fs::canonicalize(entry.path()).ok())
        .any(|path| {
            fs::File::open(path)
                .err()
                .is_some_and(|error| error.kind() == io::ErrorKind::PermissionDenied)
        })
}

fn supports_key(device: &Device) -> impl Fn(u16) -> bool + '_ {
    move |code| {
        device
            .supported_keys()
            .is_some_and(|keys| keys.contains(KeyCode::new(code)))
    }
}

fn trigger_ranges(device: &Device) -> (Option<AxisRange>, Option<AxisRange>) {
    let ranges: Vec<(u16, AxisRange)> = device
        .get_absinfo()
        .map(|axes| {
            axes.map(|(axis, info)| {
                (
                    axis.0,
                    AxisRange {
                        minimum: info.minimum(),
                        maximum: info.maximum(),
                    },
                )
            })
            .collect()
        })
        .unwrap_or_default();
    linux_trigger_ranges(
        |code| {
            device
                .supported_absolute_axes()
                .is_some_and(|axes| axes.contains(AbsoluteAxisCode(code)))
        },
        |code| {
            ranges
                .iter()
                .find(|(axis, _)| *axis == code)
                .map(|(_, range)| *range)
        },
    )
}

#[derive(Clone, Copy)]
pub struct Roles {
    pub keyboard: bool,
    pub gamepad: bool,
}

struct Tracked {
    path: PathBuf,
    device: Device,
    keyboard: bool,
    gamepad: Option<(LinuxGamepadState, ComboMatcher)>,
}

struct Watcher {
    roles: Roles,
    context: Arc<Context>,
    devices: Vec<Tracked>,
    ignored: HashSet<PathBuf>,
    modifiers: ModifierTracker,
    hotkey: HotkeyMatcher,
    inotify: Option<OwnedFd>,
}

impl Watcher {
    fn new(roles: Roles, context: Arc<Context>) -> Self {
        Self {
            roles,
            context,
            devices: Vec::new(),
            ignored: HashSet::new(),
            modifiers: ModifierTracker::default(),
            hotkey: HotkeyMatcher::default(),
            inotify: watch_input_dir(),
        }
    }

    fn scan(&mut self) {
        let Ok(nodes) = event_nodes() else {
            return;
        };
        self.ignored.retain(|path| nodes.contains(path));
        for path in nodes {
            if self.ignored.contains(&path) || self.devices.iter().any(|entry| entry.path == path) {
                continue;
            }
            let Ok(device) = Device::open(&path) else {
                continue;
            };
            match self.classify(path.clone(), device) {
                Some(tracked) => self.devices.push(tracked),
                None => {
                    self.ignored.insert(path);
                }
            }
        }
    }

    fn classify(&self, path: PathBuf, device: Device) -> Option<Tracked> {
        let keyboard = self.roles.keyboard && is_linux_keyboard(supports_key(&device));
        let gamepad = self.roles.gamepad && is_linux_gamepad(supports_key(&device));
        if !keyboard && !gamepad {
            return None;
        }
        device.set_nonblocking(true).ok()?;
        let gamepad = gamepad.then(|| {
            let (left_trigger, right_trigger) = trigger_ranges(&device);
            (
                LinuxGamepadState {
                    left_trigger,
                    right_trigger,
                    ..LinuxGamepadState::default()
                },
                ComboMatcher::default(),
            )
        });
        Some(Tracked {
            path,
            device,
            keyboard,
            gamepad,
        })
    }

    fn drain_inotify(&self) {
        let Some(inotify) = &self.inotify else {
            return;
        };
        let mut buffer = [0u8; 4096];
        while unsafe {
            libc::read(
                inotify.as_raw_fd(),
                buffer.as_mut_ptr().cast(),
                buffer.len(),
            )
        } > 0
        {}
    }

    fn read_device(&mut self, index: usize) -> bool {
        let entry = &mut self.devices[index];
        let events: Vec<(EventType, u16, i32)> = match entry.device.fetch_events() {
            Ok(events) => events
                .map(|event| (event.event_type(), event.code(), event.value()))
                .collect(),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => return true,
            Err(_) => return false,
        };
        let binding = self.context.binding();

        for (event_type, code, value) in events {
            if event_type == EventType::KEY && entry.keyboard {
                if self.modifiers.update(code, value != 0) {
                    continue;
                }
                if let Some(hotkey) = binding.hotkey {
                    if self
                        .hotkey
                        .on_key(code, value != 0, &hotkey, self.modifiers.current())
                    {
                        self.context.emit(TriggerSource::Keyboard, Backend::Evdev);
                    }
                }
            }
            if let Some((state, _)) = entry.gamepad.as_mut() {
                if event_type == EventType::KEY {
                    state.apply_key(code, value);
                } else if event_type == EventType::ABSOLUTE {
                    state.apply_axis(code, value);
                }
            }
        }

        if let Some((state, combo)) = entry.gamepad.as_mut() {
            if combo.update(state.buttons, binding.gamepad_mask) {
                self.context.emit(TriggerSource::Gamepad, Backend::Evdev);
            }
        }
        true
    }

    fn remove(&mut self, index: usize) {
        let removed = self.devices.swap_remove(index);
        if removed.keyboard {
            self.modifiers = ModifierTracker::default();
            self.hotkey = HotkeyMatcher::default();
        }
    }

    fn run(&mut self, wake: &WakePipe) {
        self.scan();
        loop {
            if self.context.is_stopped() {
                return;
            }
            let mut fds = vec![pollfd(wake.read_fd())];
            let inotify_index = self.inotify.as_ref().map(|inotify| {
                fds.push(pollfd(inotify.as_raw_fd()));
                fds.len() - 1
            });
            let first_device = fds.len();
            fds.extend(
                self.devices
                    .iter()
                    .map(|entry| pollfd(entry.device.as_raw_fd())),
            );

            let ready = match poll_fds(&mut fds, RESCAN_TIMEOUT_MS) {
                Ok(ready) => ready,
                Err(_) => return,
            };
            if fds[0].revents != 0 || self.context.is_stopped() {
                return;
            }
            if ready == 0 {
                self.scan();
                continue;
            }

            for index in (0..self.devices.len()).rev() {
                let revents = fds[first_device + index].revents;
                if revents == 0 {
                    continue;
                }
                let healthy = revents & libc::POLLIN == 0 || self.read_device(index);
                if !healthy || revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 {
                    self.remove(index);
                }
            }

            if inotify_index.is_some_and(|index| fds[index].revents != 0) {
                self.drain_inotify();
                self.scan();
            }
        }
    }
}

fn watch_input_dir() -> Option<OwnedFd> {
    let fd = unsafe { libc::inotify_init1(libc::IN_NONBLOCK | libc::IN_CLOEXEC) };
    if fd < 0 {
        return None;
    }
    let inotify = unsafe { OwnedFd::from_raw_fd(fd) };
    let path = CString::new(Path::new(INPUT_DIR).as_os_str().as_encoded_bytes()).ok()?;
    let watch = unsafe {
        libc::inotify_add_watch(
            inotify.as_raw_fd(),
            path.as_ptr(),
            libc::IN_CREATE | libc::IN_ATTRIB | libc::IN_MOVED_TO,
        )
    };
    (watch >= 0).then_some(inotify)
}

pub fn spawn(
    roles: Roles,
    context: Arc<Context>,
    wake: Arc<WakePipe>,
) -> io::Result<JoinHandle<()>> {
    thread::Builder::new()
        .name("hydra-screenshot-evdev".into())
        .spawn(move || Watcher::new(roles, context).run(&wake))
}
