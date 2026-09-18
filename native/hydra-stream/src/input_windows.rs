//! Windows input injection: keyboard/mouse via SendInput, gamepads via
//! ViGEmBus virtual Xbox 360 controllers (pure-Rust `vigem-client` crate
//! talking to the driver directly). When the ViGEmBus driver is not
//! installed, gamepad injection is disabled with a log and everything
//! else keeps working.

use std::collections::HashMap;

use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_EXTENDEDKEY,
    KEYEVENTF_KEYUP, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE,
    MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL,
    MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, MOUSEINPUT, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

use crate::input::{
    GamepadState, InputBackend, ScrollAccumulator, is_extended_key, xusb_buttons,
};

const XINPUT_MAX_GAMEPADS: u8 = 4;

pub struct WindowsInputBackend {
    scroll_v: ScrollAccumulator,
    scroll_h: ScrollAccumulator,
    vigem: Option<VigemClient>,
    injected: u64,
}

impl WindowsInputBackend {
    pub fn new() -> WindowsInputBackend {
        let vigem = match VigemClient::connect() {
            Ok(client) => {
                eprintln!("input: ViGEmBus connected (gamepad injection enabled)");
                Some(client)
            }
            Err(error) => {
                eprintln!("input: ViGEmBus unavailable ({error}); gamepad injection disabled");
                None
            }
        };
        WindowsInputBackend {
            scroll_v: ScrollAccumulator::new(),
            scroll_h: ScrollAccumulator::new(),
            vigem,
            injected: 0,
        }
    }

    fn send_input(&mut self, input: INPUT) {
        self.injected += 1;
        unsafe {
            SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
        }
    }
}

impl InputBackend for WindowsInputBackend {
    fn key(&mut self, key_code: i16, down: bool) {
        let mut flags = KEYBD_EVENT_FLAGS(0);
        if !down {
            flags |= KEYEVENTF_KEYUP;
        }
        if is_extended_key(key_code) {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        self.send_input(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(key_code as u16),
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
    }

    fn mouse_move_rel(&mut self, delta_x: i16, delta_y: i16) {
        self.send_input(INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: delta_x as i32,
                    dy: delta_y as i32,
                    mouseData: 0,
                    dwFlags: MOUSEEVENTF_MOVE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
    }

    fn mouse_move_abs(&mut self, x: i16, y: i16, width: i16, height: i16) {
        // Normalize against the reference size, then map to the primary
        // screen in the 0..=65535 absolute coordinate space.
        let reference_width = width.max(1) as i32;
        let reference_height = height.max(1) as i32;
        let screen_width = unsafe { GetSystemMetrics(SM_CXSCREEN) }.max(1);
        let screen_height = unsafe { GetSystemMetrics(SM_CYSCREEN) }.max(1);
        let screen_x = (x as i32 * (screen_width - 1)) / reference_width;
        let screen_y = (y as i32 * (screen_height - 1)) / reference_height;
        self.send_input(INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: screen_x * 65535 / (screen_width - 1),
                    dy: screen_y * 65535 / (screen_height - 1),
                    mouseData: 0,
                    dwFlags: MOUSEEVENTF_MOVE
                        | MOUSEEVENTF_ABSOLUTE
                        | MOUSEEVENTF_VIRTUALDESK,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
    }

    fn mouse_button(&mut self, button: u8, down: bool) {
        let flags = match (button, down) {
            (1, true) => Some((MOUSEEVENTF_LEFTDOWN, 0)),
            (1, false) => Some((MOUSEEVENTF_LEFTUP, 0)),
            (2, true) => Some((MOUSEEVENTF_RIGHTDOWN, 0)),
            (2, false) => Some((MOUSEEVENTF_RIGHTUP, 0)),
            (3, true) => Some((MOUSEEVENTF_MIDDLEDOWN, 0)),
            (3, false) => Some((MOUSEEVENTF_MIDDLEUP, 0)),
            (4, true) => Some((MOUSEEVENTF_XDOWN, 1)),
            (4, false) => Some((MOUSEEVENTF_XUP, 1)),
            (5, true) => Some((MOUSEEVENTF_XDOWN, 2)),
            (5, false) => Some((MOUSEEVENTF_XUP, 2)),
            _ => None,
        };
        let Some((flags, data)) = flags else {
            eprintln!("input: unsupported mouse button {button}");
            return;
        };
        self.send_input(INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: data,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
    }

    fn scroll(&mut self, horizontal: bool, amount: i16) {
        let delta = if horizontal {
            self.scroll_h.add(amount)
        } else {
            self.scroll_v.add(amount)
        };
        if delta == 0 {
            return;
        }
        self.send_input(INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: delta as u32,
                    dwFlags: if horizontal {
                        MOUSEEVENTF_HWHEEL
                    } else {
                        MOUSEEVENTF_WHEEL
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
    }

    fn gamepad(&mut self, state: &GamepadState) {
        let Some(vigem) = self.vigem.as_mut() else {
            return;
        };
        if state.index >= XINPUT_MAX_GAMEPADS {
            eprintln!("input: ignoring gamepad index {}", state.index);
            return;
        }
        if let Err(error) = vigem.update(state) {
            eprintln!("input: gamepad update failed: {error}");
        }
    }
}

/// Gamepad injection via ViGEmBus (pure-Rust `vigem-client` crate, MIT).
/// One client connection; one lazily plugged virtual Xbox 360 controller
/// per controller index.
struct VigemClient {
    client: vigem_client::Client,
    targets: HashMap<u8, vigem_client::Xbox360Wired<vigem_client::Client>>,
}

impl VigemClient {
    fn connect() -> Result<VigemClient, String> {
        let client = vigem_client::Client::connect()
            .map_err(|error| format!("{error:?} (ViGEmBus driver not installed?)"))?;
        Ok(VigemClient {
            client,
            targets: HashMap::new(),
        })
    }

    fn update(&mut self, state: &GamepadState) -> Result<(), String> {
        let target = match self.targets.entry(state.index) {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => {
                let client = self
                    .client
                    .try_clone()
                    .map_err(|error| format!("vigem try_clone: {error:?}"))?;
                let mut target =
                    vigem_client::Xbox360Wired::new(client, vigem_client::TargetId::XBOX360_WIRED);
                target
                    .plugin()
                    .map_err(|error| format!("vigem plugin: {error:?}"))?;
                target
                    .wait_ready()
                    .map_err(|error| format!("vigem wait_ready: {error:?}"))?;
                eprintln!("input: virtual gamepad {} connected", state.index);
                entry.insert(target)
            }
        };

        let report = vigem_client::XGamepad {
            buttons: vigem_client::XButtons(xusb_buttons(state.buttons)),
            left_trigger: state.left_trigger,
            right_trigger: state.right_trigger,
            thumb_lx: state.left_stick.0,
            thumb_ly: state.left_stick.1,
            thumb_rx: state.right_stick.0,
            thumb_ry: state.right_stick.1,
        };
        target
            .update(&report)
            .map_err(|error| format!("vigem update: {error:?}"))
    }
}
