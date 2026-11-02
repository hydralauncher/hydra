#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TriggerSource {
    Keyboard,
    Gamepad,
}

impl TriggerSource {
    pub fn as_str(self) -> &'static str {
        match self {
            TriggerSource::Keyboard => "keyboard",
            TriggerSource::Gamepad => "gamepad",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    #[cfg(target_os = "windows")]
    WindowsRawInput,
    #[cfg(target_os = "windows")]
    XInput,
    #[cfg(target_os = "linux")]
    X11XInput2,
    #[cfg(target_os = "linux")]
    Evdev,
    Unavailable,
}

impl Backend {
    pub fn as_str(self) -> &'static str {
        match self {
            #[cfg(target_os = "windows")]
            Backend::WindowsRawInput => "windows-raw-input",
            #[cfg(target_os = "windows")]
            Backend::XInput => "xinput",
            #[cfg(target_os = "linux")]
            Backend::X11XInput2 => "x11-xinput2",
            #[cfg(target_os = "linux")]
            Backend::Evdev => "evdev",
            Backend::Unavailable => "unavailable",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeyDefinition {
    pub name: &'static str,
    pub evdev: u16,
    pub windows: u16,
}

const fn key(name: &'static str, evdev: u16) -> KeyDefinition {
    KeyDefinition {
        name,
        evdev,
        windows: evdev,
    }
}

const fn extended(name: &'static str, evdev: u16, windows: u16) -> KeyDefinition {
    KeyDefinition {
        name,
        evdev,
        windows,
    }
}

pub const KEYS: &[KeyDefinition] = &[
    key("Escape", 1),
    key("Digit1", 2),
    key("Digit2", 3),
    key("Digit3", 4),
    key("Digit4", 5),
    key("Digit5", 6),
    key("Digit6", 7),
    key("Digit7", 8),
    key("Digit8", 9),
    key("Digit9", 10),
    key("Digit0", 11),
    key("Minus", 12),
    key("Equal", 13),
    key("Backspace", 14),
    key("Tab", 15),
    key("KeyQ", 16),
    key("KeyW", 17),
    key("KeyE", 18),
    key("KeyR", 19),
    key("KeyT", 20),
    key("KeyY", 21),
    key("KeyU", 22),
    key("KeyI", 23),
    key("KeyO", 24),
    key("KeyP", 25),
    key("BracketLeft", 26),
    key("BracketRight", 27),
    key("Enter", 28),
    key("KeyA", 30),
    key("KeyS", 31),
    key("KeyD", 32),
    key("KeyF", 33),
    key("KeyG", 34),
    key("KeyH", 35),
    key("KeyJ", 36),
    key("KeyK", 37),
    key("KeyL", 38),
    key("Semicolon", 39),
    key("Quote", 40),
    key("Backquote", 41),
    key("Backslash", 43),
    key("KeyZ", 44),
    key("KeyX", 45),
    key("KeyC", 46),
    key("KeyV", 47),
    key("KeyB", 48),
    key("KeyN", 49),
    key("KeyM", 50),
    key("Comma", 51),
    key("Period", 52),
    key("Slash", 53),
    key("NumpadMultiply", 55),
    key("Space", 57),
    key("F1", 59),
    key("F2", 60),
    key("F3", 61),
    key("F4", 62),
    key("F5", 63),
    key("F6", 64),
    key("F7", 65),
    key("F8", 66),
    key("F9", 67),
    key("F10", 68),
    key("ScrollLock", 70),
    key("Numpad7", 71),
    key("Numpad8", 72),
    key("Numpad9", 73),
    key("NumpadSubtract", 74),
    key("Numpad4", 75),
    key("Numpad5", 76),
    key("Numpad6", 77),
    key("NumpadAdd", 78),
    key("Numpad1", 79),
    key("Numpad2", 80),
    key("Numpad3", 81),
    key("Numpad0", 82),
    key("NumpadDecimal", 83),
    key("F11", 87),
    key("F12", 88),
    extended("NumpadEnter", 96, 0xE01C),
    extended("NumpadDivide", 98, 0xE035),
    extended("PrintScreen", 99, 0xE037),
    extended("Home", 102, 0xE047),
    extended("ArrowUp", 103, 0xE048),
    extended("PageUp", 104, 0xE049),
    extended("ArrowLeft", 105, 0xE04B),
    extended("ArrowRight", 106, 0xE04D),
    extended("End", 107, 0xE04F),
    extended("ArrowDown", 108, 0xE050),
    extended("PageDown", 109, 0xE051),
    extended("Insert", 110, 0xE052),
    extended("Delete", 111, 0xE053),
    extended("Pause", 119, 0xE11D),
    extended("F13", 183, 0x64),
    extended("F14", 184, 0x65),
    extended("F15", 185, 0x66),
    extended("F16", 186, 0x67),
    extended("F17", 187, 0x68),
    extended("F18", 188, 0x69),
    extended("F19", 189, 0x6A),
    extended("F20", 190, 0x6B),
    extended("F21", 191, 0x6C),
    extended("F22", 192, 0x6D),
    extended("F23", 193, 0x6E),
    extended("F24", 194, 0x76),
];

pub fn find_key(name: &str) -> Option<KeyDefinition> {
    KEYS.iter().copied().find(|entry| entry.name == name)
}

impl KeyDefinition {
    pub fn platform_code(&self) -> u16 {
        if cfg!(target_os = "windows") {
            self.windows
        } else {
            self.evdev
        }
    }
}

pub mod gamepad {
    pub const DPAD_UP: u32 = 0x0001;
    pub const DPAD_DOWN: u32 = 0x0002;
    pub const DPAD_LEFT: u32 = 0x0004;
    pub const DPAD_RIGHT: u32 = 0x0008;
    pub const START: u32 = 0x0010;
    pub const BACK: u32 = 0x0020;
    pub const LS: u32 = 0x0040;
    pub const RS: u32 = 0x0080;
    pub const LB: u32 = 0x0100;
    pub const RB: u32 = 0x0200;
    pub const A: u32 = 0x1000;
    pub const B: u32 = 0x2000;
    pub const X: u32 = 0x4000;
    pub const Y: u32 = 0x8000;
    pub const LT: u32 = 0x1_0000;
    pub const RT: u32 = 0x2_0000;

    pub const MIN_COMBO_BUTTONS: u32 = 2;
    pub const MAX_COMBO_BUTTONS: u32 = 4;

    #[cfg(any(target_os = "windows", test))]
    const XINPUT_BUTTONS: u32 = 0xF3FF;
    #[cfg(any(target_os = "windows", test))]
    const TRIGGER_THRESHOLD: u8 = 30;

    pub fn button_mask(name: &str) -> Option<u32> {
        Some(match name {
            "a" => A,
            "b" => B,
            "x" => X,
            "y" => Y,
            "lb" => LB,
            "rb" => RB,
            "lt" => LT,
            "rt" => RT,
            "back" => BACK,
            "start" => START,
            "ls" => LS,
            "rs" => RS,
            "dpadUp" => DPAD_UP,
            "dpadDown" => DPAD_DOWN,
            "dpadLeft" => DPAD_LEFT,
            "dpadRight" => DPAD_RIGHT,
            _ => return None,
        })
    }

    pub fn combo_mask<S: AsRef<str>>(names: &[S]) -> Option<u32> {
        let mut mask = 0;
        for name in names {
            mask |= button_mask(name.as_ref())?;
        }
        (MIN_COMBO_BUTTONS..=MAX_COMBO_BUTTONS)
            .contains(&mask.count_ones())
            .then_some(mask)
    }

    #[cfg(any(target_os = "windows", test))]
    pub fn xinput_mask(buttons: u16, left_trigger: u8, right_trigger: u8) -> u32 {
        let mut mask = u32::from(buttons) & XINPUT_BUTTONS;
        if left_trigger > TRIGGER_THRESHOLD {
            mask |= LT;
        }
        if right_trigger > TRIGGER_THRESHOLD {
            mask |= RT;
        }
        mask
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Modifiers {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
}

impl Modifiers {
    pub fn union(self, other: Modifiers) -> Modifiers {
        Modifiers {
            ctrl: self.ctrl || other.ctrl,
            alt: self.alt || other.alt,
            shift: self.shift || other.shift,
            meta: self.meta || other.meta,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HotkeyBinding {
    pub key: KeyDefinition,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

impl HotkeyBinding {
    pub fn matches_modifiers(&self, modifiers: Modifiers) -> bool {
        modifiers.ctrl == self.ctrl
            && modifiers.alt == self.alt
            && modifiers.shift == self.shift
            && !modifiers.meta
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct InputBinding {
    pub hotkey: Option<HotkeyBinding>,
    pub gamepad_mask: u32,
}

#[derive(Default)]
pub struct HotkeyMatcher {
    held: Option<u16>,
}

impl HotkeyMatcher {
    pub fn on_key(
        &mut self,
        code: u16,
        pressed: bool,
        binding: &HotkeyBinding,
        modifiers: Modifiers,
    ) -> bool {
        if !pressed {
            if self.held == Some(code) {
                self.held = None;
            }
            return false;
        }
        if code != binding.key.platform_code() || self.held == Some(code) {
            return false;
        }
        self.held = Some(code);
        binding.matches_modifiers(modifiers)
    }

    #[cfg(target_os = "linux")]
    pub fn reset(&mut self) {
        self.held = None;
    }
}

#[derive(Default)]
pub struct ComboMatcher {
    satisfied: bool,
}

impl ComboMatcher {
    pub fn update(&mut self, buttons: u32, combo: u32) -> bool {
        let satisfied = combo != 0 && buttons & combo == combo;
        let fire = satisfied && !self.satisfied;
        self.satisfied = satisfied;
        fire
    }
}

#[cfg(any(target_os = "linux", test))]
pub mod evdev_codes {
    #[cfg(target_os = "linux")]
    pub const EV_SYN: u16 = 0x00;
    #[cfg(target_os = "linux")]
    pub const EV_KEY: u16 = 0x01;
    #[cfg(target_os = "linux")]
    pub const EV_ABS: u16 = 0x03;
    #[cfg(target_os = "linux")]
    pub const SYN_REPORT: u16 = 0;

    pub const KEY_ENTER: u16 = 28;
    pub const KEY_LEFTCTRL: u16 = 29;
    pub const KEY_A: u16 = 30;
    pub const KEY_LEFTSHIFT: u16 = 42;
    pub const KEY_Z: u16 = 44;
    pub const KEY_RIGHTSHIFT: u16 = 54;
    pub const KEY_LEFTALT: u16 = 56;
    pub const KEY_RIGHTCTRL: u16 = 97;
    pub const KEY_RIGHTALT: u16 = 100;
    pub const KEY_LEFTMETA: u16 = 125;
    pub const KEY_RIGHTMETA: u16 = 126;

    pub const BTN_SOUTH: u16 = 0x130;
    pub const BTN_EAST: u16 = 0x131;
    pub const BTN_X: u16 = 0x133;
    pub const BTN_Y: u16 = 0x134;
    pub const BTN_TL: u16 = 0x136;
    pub const BTN_TR: u16 = 0x137;
    pub const BTN_TL2: u16 = 0x138;
    pub const BTN_TR2: u16 = 0x139;
    pub const BTN_SELECT: u16 = 0x13a;
    pub const BTN_START: u16 = 0x13b;
    pub const BTN_THUMBL: u16 = 0x13d;
    pub const BTN_THUMBR: u16 = 0x13e;
    pub const BTN_DPAD_UP: u16 = 0x220;
    pub const BTN_DPAD_DOWN: u16 = 0x221;
    pub const BTN_DPAD_LEFT: u16 = 0x222;
    pub const BTN_DPAD_RIGHT: u16 = 0x223;

    pub const ABS_Z: u16 = 0x02;
    pub const ABS_RX: u16 = 0x03;
    pub const ABS_RY: u16 = 0x04;
    pub const ABS_RZ: u16 = 0x05;
    pub const ABS_GAS: u16 = 0x09;
    pub const ABS_BRAKE: u16 = 0x0a;
    pub const ABS_HAT0X: u16 = 0x10;
    pub const ABS_HAT0Y: u16 = 0x11;
}

#[cfg(any(target_os = "linux", test))]
#[derive(Default)]
pub struct ModifierTracker {
    ctrl: u8,
    alt: u8,
    shift: u8,
    meta: u8,
}

#[cfg(any(target_os = "linux", test))]
impl ModifierTracker {
    #[cfg(target_os = "linux")]
    pub fn from_held_keys(is_held: impl Fn(u16) -> bool) -> Self {
        use evdev_codes::*;
        let mut tracker = Self::default();
        for code in [
            KEY_LEFTCTRL,
            KEY_RIGHTCTRL,
            KEY_LEFTALT,
            KEY_RIGHTALT,
            KEY_LEFTSHIFT,
            KEY_RIGHTSHIFT,
            KEY_LEFTMETA,
            KEY_RIGHTMETA,
        ] {
            if is_held(code) {
                tracker.update(code, true);
            }
        }
        tracker
    }

    pub fn update(&mut self, code: u16, pressed: bool) -> bool {
        use evdev_codes::*;
        let (bit, slot) = match code {
            KEY_LEFTCTRL => (1, &mut self.ctrl),
            KEY_RIGHTCTRL => (2, &mut self.ctrl),
            KEY_LEFTALT => (1, &mut self.alt),
            KEY_RIGHTALT => (2, &mut self.alt),
            KEY_LEFTSHIFT => (1, &mut self.shift),
            KEY_RIGHTSHIFT => (2, &mut self.shift),
            KEY_LEFTMETA => (1, &mut self.meta),
            KEY_RIGHTMETA => (2, &mut self.meta),
            _ => return false,
        };
        if pressed {
            *slot |= bit;
        } else {
            *slot &= !bit;
        }
        true
    }

    pub fn current(&self) -> Modifiers {
        Modifiers {
            ctrl: self.ctrl != 0,
            alt: self.alt != 0,
            shift: self.shift != 0,
            meta: self.meta != 0,
        }
    }
}

#[cfg(any(target_os = "linux", test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AxisRange {
    pub minimum: i32,
    pub maximum: i32,
}

#[cfg(any(target_os = "linux", test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TriggerAxis {
    pub code: u16,
    pub range: AxisRange,
}

#[cfg(any(target_os = "linux", test))]
const ANALOG_TRIGGER_PRESS_DIVISOR: i64 = 4;

#[cfg(any(target_os = "linux", test))]
impl AxisRange {
    fn is_pressed(self, value: i32) -> bool {
        let span = i64::from(self.maximum) - i64::from(self.minimum);
        let travel = i64::from(value) - i64::from(self.minimum);
        span > 0 && travel * ANALOG_TRIGGER_PRESS_DIVISOR > span
    }
}

#[cfg(any(target_os = "linux", test))]
#[derive(Default)]
pub struct LinuxGamepadState {
    pub buttons: u32,
    pub analog_triggers: u32,
    pub left_trigger: Option<TriggerAxis>,
    pub right_trigger: Option<TriggerAxis>,
    pub positional_face_buttons: bool,
}

#[cfg(any(target_os = "linux", test))]
impl LinuxGamepadState {
    pub fn uses_positional_face_buttons(vendor_id: u16) -> bool {
        const SONY: u16 = 0x054c;
        const NINTENDO: u16 = 0x057e;
        matches!(vendor_id, SONY | NINTENDO)
    }

    pub fn mask(&self) -> u32 {
        self.buttons | self.analog_triggers
    }

    pub fn key_mask(&self, code: u16) -> u32 {
        use evdev_codes::*;
        match code {
            BTN_SOUTH => gamepad::A,
            BTN_EAST => gamepad::B,
            BTN_X if self.positional_face_buttons => gamepad::Y,
            BTN_Y if self.positional_face_buttons => gamepad::X,
            BTN_X => gamepad::X,
            BTN_Y => gamepad::Y,
            BTN_TL => gamepad::LB,
            BTN_TR => gamepad::RB,
            BTN_TL2 => gamepad::LT,
            BTN_TR2 => gamepad::RT,
            BTN_SELECT => gamepad::BACK,
            BTN_START => gamepad::START,
            BTN_THUMBL => gamepad::LS,
            BTN_THUMBR => gamepad::RS,
            BTN_DPAD_UP => gamepad::DPAD_UP,
            BTN_DPAD_DOWN => gamepad::DPAD_DOWN,
            BTN_DPAD_LEFT => gamepad::DPAD_LEFT,
            BTN_DPAD_RIGHT => gamepad::DPAD_RIGHT,
            _ => 0,
        }
    }

    pub fn apply_key(&mut self, code: u16, value: i32) {
        let mask = self.key_mask(code);
        if mask == 0 {
            return;
        }
        if value != 0 {
            self.buttons |= mask;
        } else {
            self.buttons &= !mask;
        }
    }

    pub fn apply_axis(&mut self, code: u16, value: i32) {
        use evdev_codes::*;
        match code {
            ABS_HAT0X => {
                self.buttons &= !(gamepad::DPAD_LEFT | gamepad::DPAD_RIGHT);
                if value < 0 {
                    self.buttons |= gamepad::DPAD_LEFT;
                } else if value > 0 {
                    self.buttons |= gamepad::DPAD_RIGHT;
                }
            }
            ABS_HAT0Y => {
                self.buttons &= !(gamepad::DPAD_UP | gamepad::DPAD_DOWN);
                if value < 0 {
                    self.buttons |= gamepad::DPAD_UP;
                } else if value > 0 {
                    self.buttons |= gamepad::DPAD_DOWN;
                }
            }
            _ => {
                self.apply_trigger(self.left_trigger, gamepad::LT, code, value);
                self.apply_trigger(self.right_trigger, gamepad::RT, code, value);
            }
        }
    }

    fn apply_trigger(&mut self, trigger: Option<TriggerAxis>, mask: u32, code: u16, value: i32) {
        let Some(trigger) = trigger.filter(|trigger| trigger.code == code) else {
            return;
        };
        if trigger.range.is_pressed(value) {
            self.analog_triggers |= mask;
        } else {
            self.analog_triggers &= !mask;
        }
    }
}

#[cfg(target_os = "linux")]
pub struct GamepadTracker {
    state: LinuxGamepadState,
    combo: ComboMatcher,
}

#[cfg(target_os = "linux")]
impl GamepadTracker {
    pub fn new(state: LinuxGamepadState, combo_mask: u32) -> Self {
        let mut combo = ComboMatcher::default();
        combo.update(state.mask(), combo_mask);
        Self { state, combo }
    }

    pub fn handle(&mut self, event_type: u16, code: u16, value: i32, combo_mask: u32) -> bool {
        use evdev_codes::*;
        match event_type {
            EV_KEY => self.state.apply_key(code, value),
            EV_ABS => self.state.apply_axis(code, value),
            EV_SYN if code == SYN_REPORT => {
                return self.combo.update(self.state.mask(), combo_mask);
            }
            _ => {}
        }
        false
    }
}

#[cfg(any(target_os = "linux", test))]
pub fn is_linux_keyboard(supports_key: impl Fn(u16) -> bool) -> bool {
    use evdev_codes::*;
    supports_key(KEY_A) && supports_key(KEY_Z) && supports_key(KEY_ENTER)
}

#[cfg(any(target_os = "linux", test))]
pub fn is_linux_gamepad(supports_key: impl Fn(u16) -> bool) -> bool {
    use evdev_codes::*;
    !is_linux_keyboard(&supports_key) && (supports_key(BTN_SOUTH) || supports_key(BTN_START))
}

#[cfg(any(target_os = "linux", test))]
pub fn linux_trigger_axes(
    supports_axis: impl Fn(u16) -> bool,
    range_of: impl Fn(u16) -> Option<AxisRange>,
) -> (Option<TriggerAxis>, Option<TriggerAxis>) {
    use evdev_codes::*;
    let axis = |code: u16| {
        supports_axis(code)
            .then(|| range_of(code))
            .flatten()
            .map(|range| TriggerAxis { code, range })
    };
    if supports_axis(ABS_BRAKE) || supports_axis(ABS_GAS) {
        return (axis(ABS_BRAKE), axis(ABS_GAS));
    }
    if !(supports_axis(ABS_RX) && supports_axis(ABS_RY)) {
        return (None, None);
    }
    (axis(ABS_Z), axis(ABS_RZ))
}

#[cfg(any(target_os = "windows", test))]
const RI_KEY_E0: u16 = 2;
#[cfg(any(target_os = "windows", test))]
const RI_KEY_E1: u16 = 4;
#[cfg(target_os = "windows")]
const WINDOWS_LEFT_SHIFT: u16 = 0x2A;
#[cfg(target_os = "windows")]
const WINDOWS_RIGHT_SHIFT: u16 = 0x36;
#[cfg(target_os = "windows")]
const WINDOWS_MODIFIER_SCAN_CODES: &[u16] = &[
    0x1D,
    0xE01D,
    0x38,
    0xE038,
    WINDOWS_LEFT_SHIFT,
    WINDOWS_RIGHT_SHIFT,
    0xE05B,
    0xE05C,
];

#[cfg(target_os = "windows")]
pub fn is_windows_modifier_scan_code(scan_code: u16) -> bool {
    WINDOWS_MODIFIER_SCAN_CODES.contains(&scan_code)
}

#[cfg(target_os = "windows")]
pub struct WindowsShiftTracker {
    held: u8,
    released_by_system: bool,
}

#[cfg(target_os = "windows")]
impl WindowsShiftTracker {
    pub fn new(left_held: bool, right_held: bool) -> Self {
        Self {
            held: u8::from(left_held) | u8::from(right_held) << 1,
            released_by_system: false,
        }
    }

    pub fn on_key(&mut self, scan_code: u16, pressed: bool) -> bool {
        let bit = match scan_code {
            WINDOWS_LEFT_SHIFT => 1,
            WINDOWS_RIGHT_SHIFT => 2,
            _ => return false,
        };
        if pressed {
            self.held |= bit;
        } else {
            self.held &= !bit;
        }
        self.released_by_system = false;
        true
    }

    pub fn on_system_shift(&mut self) {
        self.released_by_system = !self.released_by_system;
    }

    pub fn is_held(&self, reported_held: bool) -> bool {
        reported_held || (self.released_by_system && self.held != 0)
    }
}

#[cfg(target_os = "windows")]
pub fn windows_virtual_key_scan_code(mapped: u32, flags: u16) -> Option<u16> {
    let make = (mapped & 0x7F) as u16;
    if make == 0 {
        return None;
    }
    let prefix = match mapped >> 8 {
        0xE0 => RI_KEY_E0,
        0xE1 => RI_KEY_E1,
        _ => 0,
    };
    Some(windows_scan_code(make, flags | prefix))
}

#[cfg(any(target_os = "windows", test))]
pub fn windows_scan_code(make_code: u16, flags: u16) -> u16 {
    let make = make_code & 0x7F;
    let scan_code = if flags & RI_KEY_E1 != 0 {
        0xE100 | make
    } else if flags & RI_KEY_E0 != 0 {
        0xE000 | make
    } else {
        make
    };
    normalize_windows_scan_code(scan_code)
}

#[cfg(any(target_os = "windows", test))]
fn normalize_windows_scan_code(scan_code: u16) -> u16 {
    const ALT_PRINT_SCREEN: u16 = 0x54;
    const EXTENDED_ALT_PRINT_SCREEN: u16 = 0xE054;
    const CTRL_PAUSE: u16 = 0xE046;
    match scan_code {
        ALT_PRINT_SCREEN | EXTENDED_ALT_PRINT_SCREEN => 0xE037,
        CTRL_PAUSE => 0xE11D,
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::evdev_codes::*;
    use super::*;

    fn f10() -> HotkeyBinding {
        HotkeyBinding {
            key: find_key("F10").unwrap(),
            ctrl: false,
            alt: false,
            shift: false,
        }
    }

    #[test]
    fn key_table_has_unique_names_and_codes() {
        for (index, entry) in KEYS.iter().enumerate() {
            for other in &KEYS[index + 1..] {
                assert_ne!(entry.name, other.name);
                assert_ne!(entry.evdev, other.evdev, "{}", entry.name);
                assert_ne!(entry.windows, other.windows, "{}", entry.name);
            }
        }
    }

    #[test]
    fn function_keys_map_to_expected_codes() {
        assert_eq!(find_key("F10").unwrap().evdev, 68);
        assert_eq!(find_key("F10").unwrap().windows, 0x44);
        assert_eq!(find_key("F12").unwrap().evdev, 88);
        assert_eq!(find_key("F13").unwrap().evdev, 183);
        assert_eq!(find_key("F13").unwrap().windows, 0x64);
        assert_eq!(find_key("Insert").unwrap().windows, 0xE052);
        assert!(find_key("MetaLeft").is_none());
    }

    #[test]
    fn hotkey_fires_once_per_press_and_ignores_repeats() {
        let binding = f10();
        let code = binding.key.platform_code();
        let mut matcher = HotkeyMatcher::default();
        let none = Modifiers::default();
        assert!(matcher.on_key(code, true, &binding, none));
        assert!(!matcher.on_key(code, true, &binding, none));
        assert!(!matcher.on_key(code, false, &binding, none));
        assert!(matcher.on_key(code, true, &binding, none));
        assert!(!matcher.on_key(67, true, &binding, none));
    }

    #[test]
    fn hotkey_requires_exact_modifiers() {
        let binding = HotkeyBinding {
            ctrl: true,
            ..f10()
        };
        let code = binding.key.platform_code();
        let mut matcher = HotkeyMatcher::default();
        assert!(!matcher.on_key(code, true, &binding, Modifiers::default()));
        matcher.on_key(code, false, &binding, Modifiers::default());
        let ctrl = Modifiers {
            ctrl: true,
            ..Modifiers::default()
        };
        assert!(matcher.on_key(code, true, &binding, ctrl));
        matcher.on_key(code, false, &binding, ctrl);
        let ctrl_shift = Modifiers {
            shift: true,
            ..ctrl
        };
        assert!(!matcher.on_key(code, true, &binding, ctrl_shift));
        matcher.on_key(code, false, &binding, ctrl);
        let ctrl_meta = Modifiers { meta: true, ..ctrl };
        assert!(!matcher.on_key(code, true, &binding, ctrl_meta));
    }

    #[test]
    fn modifier_tracker_handles_both_sides() {
        let mut tracker = ModifierTracker::default();
        assert!(tracker.update(KEY_LEFTCTRL, true));
        assert!(tracker.update(KEY_RIGHTCTRL, true));
        tracker.update(KEY_LEFTCTRL, false);
        assert!(tracker.current().ctrl);
        tracker.update(KEY_RIGHTCTRL, false);
        assert!(!tracker.current().ctrl);
        tracker.update(KEY_RIGHTALT, true);
        tracker.update(KEY_LEFTMETA, true);
        assert_eq!(
            tracker.current(),
            Modifiers {
                ctrl: false,
                alt: true,
                shift: false,
                meta: true
            }
        );
        assert!(!tracker.update(68, true));
    }

    #[test]
    fn combo_mask_requires_two_known_buttons() {
        assert_eq!(
            gamepad::combo_mask(&["back", "rb"]),
            Some(gamepad::BACK | gamepad::RB)
        );
        assert_eq!(gamepad::combo_mask(&["back"]), None);
        assert_eq!(gamepad::combo_mask(&["back", "guide"]), None);
        assert_eq!(gamepad::combo_mask::<&str>(&[]), None);
        assert!(gamepad::combo_mask(&["a", "b", "x", "y"]).is_some());
        assert_eq!(gamepad::combo_mask(&["a", "b", "x", "y", "lb"]), None);
    }

    #[test]
    fn combo_fires_on_edge_only() {
        let combo = gamepad::BACK | gamepad::RB;
        let mut matcher = ComboMatcher::default();
        assert!(!matcher.update(gamepad::BACK, combo));
        assert!(matcher.update(gamepad::BACK | gamepad::RB, combo));
        assert!(!matcher.update(gamepad::BACK | gamepad::RB | gamepad::A, combo));
        assert!(!matcher.update(gamepad::RB, combo));
        assert!(matcher.update(combo, combo));
        assert!(!matcher.update(combo, 0));
    }

    #[test]
    fn xinput_mask_maps_triggers_with_threshold() {
        assert_eq!(
            gamepad::xinput_mask(0x0220, 0, 0),
            gamepad::BACK | gamepad::RB
        );
        assert_eq!(gamepad::xinput_mask(0, 31, 30), gamepad::LT);
        assert_eq!(gamepad::xinput_mask(0x0400, 0, 255), gamepad::RT);
    }

    #[test]
    fn linux_gamepad_buttons_and_hat() {
        let mut state = LinuxGamepadState::default();
        state.apply_key(BTN_SELECT, 1);
        state.apply_key(BTN_TR, 1);
        assert_eq!(state.buttons, gamepad::BACK | gamepad::RB);
        state.apply_key(BTN_TR, 0);
        assert_eq!(state.buttons, gamepad::BACK);
        state.apply_axis(ABS_HAT0X, -1);
        assert_eq!(state.buttons, gamepad::BACK | gamepad::DPAD_LEFT);
        state.apply_axis(ABS_HAT0X, 1);
        assert_eq!(state.buttons, gamepad::BACK | gamepad::DPAD_RIGHT);
        state.apply_axis(ABS_HAT0X, 0);
        state.apply_axis(ABS_HAT0Y, -1);
        assert_eq!(state.buttons, gamepad::BACK | gamepad::DPAD_UP);
        state.apply_axis(ABS_HAT0Y, 1);
        assert_eq!(state.buttons, gamepad::BACK | gamepad::DPAD_DOWN);
        state.apply_key(BTN_X, 1);
        state.apply_key(BTN_Y, 1);
        state.apply_key(0x110, 1);
        assert_eq!(
            state.buttons,
            gamepad::BACK | gamepad::DPAD_DOWN | gamepad::X | gamepad::Y
        );
    }

    #[test]
    fn linux_analog_triggers_only_with_right_stick() {
        let range = AxisRange {
            minimum: 0,
            maximum: 255,
        };
        let generic = linux_trigger_axes(|axis| axis == ABS_Z || axis == ABS_RZ, |_| Some(range));
        assert_eq!(generic, (None, None));
        let xpad = linux_trigger_axes(
            |axis| matches!(axis, ABS_Z | ABS_RZ | ABS_RX | ABS_RY),
            |_| Some(range),
        );
        assert_eq!(
            xpad,
            (
                Some(TriggerAxis { code: ABS_Z, range }),
                Some(TriggerAxis {
                    code: ABS_RZ,
                    range
                })
            )
        );

        let mut state = LinuxGamepadState {
            left_trigger: xpad.0,
            right_trigger: xpad.1,
            ..LinuxGamepadState::default()
        };
        state.apply_axis(ABS_RZ, 60);
        assert_eq!(state.mask(), 0);
        state.apply_axis(ABS_RZ, 200);
        assert_eq!(state.mask(), gamepad::RT);
        state.apply_axis(ABS_RZ, 0);
        assert_eq!(state.mask(), 0);
        state.apply_axis(ABS_Z, 255);
        assert_eq!(state.mask(), gamepad::LT);
    }

    #[test]
    fn linux_digital_and_analog_triggers_do_not_clear_each_other() {
        let range = AxisRange {
            minimum: 0,
            maximum: 255,
        };
        let mut state = LinuxGamepadState {
            left_trigger: Some(TriggerAxis { code: ABS_Z, range }),
            ..LinuxGamepadState::default()
        };
        let mut held = Vec::new();
        for travel in [10, 30, 50, 70, 120] {
            state.apply_axis(ABS_Z, travel);
            state.apply_key(BTN_TL2, 1);
            held.push(state.mask() & gamepad::LT != 0);
        }
        assert_eq!(held, [true; 5]);
        state.apply_key(BTN_TL2, 0);
        state.apply_axis(ABS_Z, 0);
        assert_eq!(state.mask(), 0);
    }

    #[test]
    fn linux_positional_face_buttons_follow_the_vendor() {
        assert!(LinuxGamepadState::uses_positional_face_buttons(0x054c));
        assert!(!LinuxGamepadState::uses_positional_face_buttons(0x045e));
        let mut sony = LinuxGamepadState {
            positional_face_buttons: true,
            ..LinuxGamepadState::default()
        };
        sony.apply_key(BTN_X, 1);
        assert_eq!(sony.mask(), gamepad::Y);
        sony.apply_key(BTN_X, 0);
        sony.apply_key(BTN_Y, 1);
        assert_eq!(sony.mask(), gamepad::X);
        let mut xpad = LinuxGamepadState::default();
        xpad.apply_key(BTN_X, 1);
        assert_eq!(xpad.mask(), gamepad::X);
    }

    #[test]
    fn linux_device_classification() {
        let keyboard = |code: u16| matches!(code, KEY_A | KEY_Z | KEY_ENTER | KEY_LEFTSHIFT);
        let pad = |code: u16| matches!(code, BTN_SOUTH | BTN_EAST | BTN_START | BTN_SELECT);
        let power_button = |code: u16| code == 116;
        assert!(is_linux_keyboard(keyboard));
        assert!(!is_linux_gamepad(keyboard));
        assert!(is_linux_gamepad(pad));
        assert!(!is_linux_keyboard(pad));
        assert!(!is_linux_keyboard(power_button));
        assert!(!is_linux_gamepad(power_button));
    }

    #[test]
    fn windows_scan_codes_cover_prefixes() {
        assert_eq!(windows_scan_code(0x44, 0), 0x44);
        assert_eq!(windows_scan_code(0x44, 1), 0x44);
        assert_eq!(windows_scan_code(0x52, 2), 0xE052);
        assert_eq!(windows_scan_code(0x52, 3), 0xE052);
        assert_eq!(windows_scan_code(0x1D, 4), 0xE11D);
        assert_eq!(
            windows_scan_code(0x37, 2),
            find_key("PrintScreen").unwrap().windows
        );
        assert_eq!(
            windows_scan_code(0x54, 0),
            find_key("PrintScreen").unwrap().windows
        );
        assert_eq!(
            windows_scan_code(0x46, 2),
            find_key("Pause").unwrap().windows
        );
        assert_eq!(
            windows_scan_code(0x46, 0),
            find_key("ScrollLock").unwrap().windows
        );
        assert_eq!(
            normalize_windows_scan_code(0x54),
            find_key("PrintScreen").unwrap().windows
        );
        assert_eq!(
            normalize_windows_scan_code(0xE046),
            find_key("Pause").unwrap().windows
        );
        assert_eq!(normalize_windows_scan_code(0x44), 0x44);
    }
}
