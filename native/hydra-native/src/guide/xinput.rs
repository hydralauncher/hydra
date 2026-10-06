//! XInput backend: the Xbox system button.
//!
//! The documented `XInputGetState` masks the Guide bit out of `wButtons`, so it
//! can never report the system button. Windows also exports an undocumented
//! variant at **ordinal 100** of `xinput1_4.dll` / `xinput1_3.dll` (commonly
//! called `XInputGetStateEx`) whose state structure keeps
//! `XINPUT_GAMEPAD_GUIDE` (`0x0400`). The ordinal is resolved at runtime, and
//! its absence is reported rather than guessed at.
//!
//! Because XInput is polled by an ordinary thread rather than driven by window
//! messages, this backend is inherently independent of which window has the
//! foreground — that is what makes Guide detection work while Hydra is in the
//! background.

use std::sync::OnceLock;

use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

use super::{mark_device_disconnected, push_event, upsert_device};

const ERROR_SUCCESS: u32 = 0;

/// `XINPUT_GAMEPAD_GUIDE`. Only present in the ordinal-100 state structure.
const XINPUT_GAMEPAD_GUIDE: u16 = 0x0400;

/// Ordinal of the state call that exposes the Guide bit.
const ORDINAL_GET_STATE_EX: usize = 100;

/// XInput exposes at most four user slots.
const MAX_SLOTS: usize = 4;

const BACKEND: &str = "xinput";

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct XInputGamepad {
    buttons: u16,
    left_trigger: u8,
    right_trigger: u8,
    thumb_lx: i16,
    thumb_ly: i16,
    thumb_rx: i16,
    thumb_ry: i16,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct XInputState {
    packet_number: u32,
    gamepad: XInputGamepad,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct XInputVibration {
    left_motor_speed: u16,
    right_motor_speed: u16,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct XInputCapabilities {
    /// `type` is a reserved word in Rust, hence the rename; the layout is what
    /// matters and it is unchanged.
    kind: u8,
    sub_type: u8,
    flags: u16,
    gamepad: XInputGamepad,
    vibration: XInputVibration,
}

/// `DWORD WINAPI XInputGetStateEx(DWORD dwUserIndex, XINPUT_STATE *pState)`
type GetStateExFn = unsafe extern "system" fn(u32, *mut XInputState) -> u32;

/// `DWORD WINAPI XInputGetCapabilities(DWORD, DWORD, XINPUT_CAPABILITIES *)`
type GetCapabilitiesFn = unsafe extern "system" fn(u32, u32, *mut XInputCapabilities) -> u32;

struct Api {
    get_state_ex: GetStateExFn,
    get_capabilities: Option<GetCapabilitiesFn>,
}

/// Resolve the entry point once per process.
///
/// The module handle is intentionally kept for the lifetime of the process: the
/// resolved function pointers must stay valid, and unloading would achieve
/// nothing while the process is alive.
fn api() -> Option<&'static Api> {
    static API: OnceLock<Option<Api>> = OnceLock::new();

    API.get_or_init(|| {
        // Newest first, mirroring the order Windows itself uses.
        for dll in ["xinput1_4.dll", "xinput1_3.dll", "xinput9_1_0.dll"] {
            let wide: Vec<u16> = dll.encode_utf16().chain(std::iter::once(0)).collect();
            let module = unsafe { LoadLibraryW(wide.as_ptr()) };

            if module.is_null() {
                continue;
            }

            // `xinput9_1_0.dll` does not export ordinal 100; it is in the list only
            // so that the failure is explicit rather than accidental.
            let Some(proc) = (unsafe { GetProcAddress(module, ORDINAL_GET_STATE_EX as *const u8) })
            else {
                continue;
            };

            let get_state_ex: GetStateExFn = unsafe { std::mem::transmute(proc) };

            let capabilities =
                unsafe { GetProcAddress(module, c"XInputGetCapabilities".as_ptr() as *const u8) };
            let get_capabilities: Option<GetCapabilitiesFn> =
                capabilities.map(|proc| unsafe { std::mem::transmute(proc) });

            return Some(Api {
                get_state_ex,
                get_capabilities,
            });
        }

        None
    })
    .as_ref()
}

/// Whether the Guide-capable entry point exists on this machine.
pub(crate) fn is_available() -> bool {
    api().is_some()
}

fn device_id(slot: usize) -> String {
    format!("xinput:slot{slot}")
}

fn subtype_name(sub_type: u8) -> &'static str {
    match sub_type {
        0x01 => "Xbox controller",
        0x02 => "Racing wheel",
        0x03 => "Arcade stick",
        0x04 => "Flight stick",
        0x05 => "Dance pad",
        0x06 | 0x07 | 0x0B => "Guitar controller",
        0x08 => "Drum kit",
        0x13 => "Arcade pad",
        _ => "XInput controller",
    }
}

fn describe_slot(api: &Api, slot: usize) -> String {
    let fallback = format!("XInput controller (slot {})", slot + 1);

    let Some(get_capabilities) = api.get_capabilities else {
        return fallback;
    };

    let mut capabilities = XInputCapabilities::default();
    let result = unsafe { get_capabilities(slot as u32, 0, &mut capabilities) };

    if result != ERROR_SUCCESS {
        return fallback;
    }

    format!(
        "{} (slot {})",
        subtype_name(capabilities.sub_type),
        slot + 1
    )
}

/// Per-slot edge-detection state.
///
/// `emitted_press` is what guarantees the "one physical press produces exactly
/// one press and one release" contract: a release is only published when a
/// press for it was actually published, and a second press cannot be emitted
/// before that release has happened.
#[derive(Clone, Copy, Default)]
struct SlotState {
    present: bool,
    pressed: bool,
    primed: bool,
    emitted_press: bool,
}

pub(crate) struct Backend {
    slots: [SlotState; MAX_SLOTS],
}

impl Backend {
    pub(crate) fn new() -> Self {
        Self {
            slots: [SlotState::default(); MAX_SLOTS],
        }
    }

    /// Poll all four slots once.
    pub(crate) fn poll(&mut self) {
        let Some(api) = api() else {
            return;
        };

        let mut present = [false; MAX_SLOTS];
        let mut guide_down = [false; MAX_SLOTS];

        for slot in 0..MAX_SLOTS {
            let mut state = XInputState::default();
            let result = unsafe { (api.get_state_ex)(slot as u32, &mut state) };

            if result == ERROR_SUCCESS {
                present[slot] = true;
                guide_down[slot] = state.gamepad.buttons & XINPUT_GAMEPAD_GUIDE != 0;
            }
        }

        // A slot that stays occupied can still end up hosting a different pad,
        // because Windows moves pads down when a lower slot frees up. That is
        // deliberately *not* re-baselined here: re-baselining would silently
        // swallow a real press that happened in the same tick as another pad's
        // arrival. Letting the ordinary edge detection run instead means the
        // worst case is an extra edge for a button that genuinely is down, which
        // is far less harmful than losing a Guide tap.
        for slot in 0..MAX_SLOTS {
            let id = device_id(slot);

            if present[slot] && !self.slots[slot].present {
                let name = describe_slot(api, slot);
                upsert_device(&id, &name, BACKEND, 0, 0, true);
                push_event("connected", BACKEND, &id, &name, 0, 0);

                self.slots[slot] = SlotState {
                    present: true,
                    pressed: guide_down[slot],
                    primed: true,
                    // Deliberately no press here. An Xbox pad is usually switched on *by*
                    // holding Guide, so firing on connect would make "turn the controller
                    // on" indistinguishable from "press Guide".
                    emitted_press: false,
                };
                continue;
            }

            if !present[slot] && self.slots[slot].present {
                let name = describe_slot(api, slot);

                if self.slots[slot].emitted_press {
                    push_event("guide-released", BACKEND, &id, &name, 0, 0);
                }
                push_event("disconnected", BACKEND, &id, &name, 0, 0);
                mark_device_disconnected(&id);

                self.slots[slot] = SlotState::default();
                continue;
            }

            if !present[slot] {
                continue;
            }

            self.apply_edge(api, slot, guide_down[slot]);
        }
    }

    fn apply_edge(&mut self, api: &Api, slot: usize, pressed: bool) {
        let state = &mut self.slots[slot];

        if !state.primed {
            state.primed = true;
            state.pressed = pressed;
            return;
        }

        if pressed == state.pressed {
            return;
        }

        state.pressed = pressed;
        let id = device_id(slot);

        if pressed {
            if state.emitted_press {
                return;
            }
            state.emitted_press = true;
            let name = describe_slot(api, slot);
            push_event("guide-pressed", BACKEND, &id, &name, 0, 0);
            return;
        }

        if state.emitted_press {
            state.emitted_press = false;
            let name = describe_slot(api, slot);
            push_event("guide-released", BACKEND, &id, &name, 0, 0);
        }
    }
}
