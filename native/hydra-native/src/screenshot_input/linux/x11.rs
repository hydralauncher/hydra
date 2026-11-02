use super::super::binding::{Backend, HotkeyMatcher, ModifierTracker, TriggerSource};
use super::super::Context;
use super::{poll_fds, pollfd, WakePipe};
use std::io;
use std::os::fd::AsRawFd;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use x11rb::connection::{Connection, RequestConnection};
use x11rb::protocol::xinput::{self, ConnectionExt as _, EventMask, XIEventMask};
use x11rb::protocol::xproto::ConnectionExt as _;
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;

const X11_KEYCODE_OFFSET: u32 = 8;

fn keymap_contains(keys: &[u8; 32], code: u16) -> bool {
    let keycode = u32::from(code) + X11_KEYCODE_OFFSET;
    let byte = (keycode / 8) as usize;
    keys.get(byte)
        .is_some_and(|value| value & (1 << (keycode % 8)) != 0)
}

pub struct Listener {
    connection: RustConnection,
}

impl Listener {
    pub fn connect() -> Result<Self, &'static str> {
        let (connection, screen) = RustConnection::connect(None).map_err(|_| "no-display")?;
        let root = connection
            .setup()
            .roots
            .get(screen)
            .ok_or("no-display")?
            .root;

        connection
            .extension_information(xinput::X11_EXTENSION_NAME)
            .ok()
            .flatten()
            .ok_or("xinput2-missing")?;
        let version = connection
            .xinput_xi_query_version(2, 2)
            .map_err(|_| "xinput2-missing")?
            .reply()
            .map_err(|_| "xinput2-missing")?;
        if version.major_version < 2 {
            return Err("xinput2-missing");
        }

        connection
            .xinput_xi_select_events(
                root,
                &[EventMask {
                    deviceid: xinput::Device::ALL_MASTER.into(),
                    mask: vec![XIEventMask::RAW_KEY_PRESS | XIEventMask::RAW_KEY_RELEASE],
                }],
            )
            .map_err(|_| "xinput2-select-failed")?
            .check()
            .map_err(|_| "xinput2-select-failed")?;

        Ok(Self { connection })
    }

    fn held_modifiers(&self) -> ModifierTracker {
        let keys = self
            .connection
            .query_keymap()
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .map(|reply| reply.keys)
            .unwrap_or_default();
        ModifierTracker::from_held_keys(|code| keymap_contains(&keys, code))
    }

    fn run(self, context: &Context, wake: &WakePipe) {
        if !self.listen(context, wake) {
            context.report_stopped(TriggerSource::Keyboard, Backend::X11XInput2);
        }
    }

    fn listen(&self, context: &Context, wake: &WakePipe) -> bool {
        let mut modifiers = self.held_modifiers();
        let mut hotkey = HotkeyMatcher::default();
        loop {
            loop {
                if context.is_stopped() {
                    return true;
                }
                let event = match self.connection.poll_for_event() {
                    Ok(Some(event)) => event,
                    Ok(None) => break,
                    Err(_) => return false,
                };
                let (detail, pressed) = match event {
                    Event::XinputRawKeyPress(event) => (event.detail, true),
                    Event::XinputRawKeyRelease(event) => (event.detail, false),
                    _ => continue,
                };
                let Some(code) = detail
                    .checked_sub(X11_KEYCODE_OFFSET)
                    .and_then(|code| u16::try_from(code).ok())
                else {
                    continue;
                };
                if modifiers.update(code, pressed) {
                    continue;
                }
                let Some(binding) = context.binding().hotkey else {
                    continue;
                };
                if hotkey.on_key(code, pressed, &binding, modifiers.current()) {
                    context.emit(TriggerSource::Keyboard, Backend::X11XInput2);
                }
            }

            let mut fds = [
                pollfd(wake.read_fd()),
                pollfd(self.connection.stream().as_raw_fd()),
            ];
            if poll_fds(&mut fds, -1).is_err() {
                return false;
            }
            if fds[0].revents != 0 {
                return true;
            }
            if fds[1].revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0
                && fds[1].revents & libc::POLLIN == 0
            {
                return false;
            }
        }
    }
}

pub fn spawn(
    listener: Listener,
    context: Arc<Context>,
    wake: Arc<WakePipe>,
) -> io::Result<JoinHandle<()>> {
    thread::Builder::new()
        .name("hydra-screenshot-x11".into())
        .spawn(move || listener.run(&context, &wake))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keymap_bits_use_x11_keycodes() {
        let mut keys = [0u8; 32];
        keys[4] = 1 << 5;
        assert!(keymap_contains(&keys, 29));
        assert!(!keymap_contains(&keys, 30));
        assert!(!keymap_contains(&keys, 400));
    }
}
