//! GameStream input packet parser (pure, unit-testable) and the injection
//! backend trait. Layouts verified against moonlight-common-c `Input.h` /
//! `InputStream.c` and Sunshine `input.cpp` (see the constants below).
//!
//! Framing: every input message arrives on the ENet control stream as an
//! INPUT_DATA (0x0206) message whose payload is one raw NV packet:
//!
//! ```text
//! u32 size   big-endian   packet size excluding this field
//! u32 magic  little-endian  packet type
//! body       type-specific (mostly little-endian; REL mouse deltas are
//!            BIG-endian — a wire quirk both sides implement)
//! ```

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputEvent {
    KeyDown { key_code: i16 },
    KeyUp { key_code: i16 },
    MouseMoveRel { delta_x: i16, delta_y: i16 },
    /// x/y reference the client stream size width/height.
    MouseMoveAbs { x: i16, y: i16, width: i16, height: i16 },
    /// button: 1 = left, 2 = right, 3 = middle, 4 = X1, 5 = X2.
    MouseButton { button: u8, down: bool },
    /// Vertical scroll in WHEEL_DELTA (120) units.
    Scroll { amount: i16 },
    /// Horizontal scroll (Sunshine extension).
    ScrollH { amount: i16 },
    Gamepad(GamepadState),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GamepadState {
    pub index: u8,
    /// Moonlight button mask (DPAD_UP = 0x0001 .. Y = 0x8000, HOME 0x0400;
    /// the low 16 bits match XUSB button bits one-to-one).
    pub buttons: u32,
    pub left_trigger: u8,
    pub right_trigger: u8,
    pub left_stick: (i16, i16),
    pub right_stick: (i16, i16),
}

pub const KEY_DOWN_MAGIC: u32 = 0x03;
pub const KEY_UP_MAGIC: u32 = 0x04;
pub const MOUSE_MOVE_ABS_MAGIC: u32 = 0x05;
pub const MOUSE_MOVE_REL_MAGIC: u32 = 0x07; // gen5 (0x06 pre-gen5)
pub const MOUSE_BUTTON_MAGIC: u32 = 0x09; // up (0x08 = down)
pub const SCROLL_MAGIC: u32 = 0x0A; // gen5 (0x09 pre-gen5)
// (0x0A was also the pre-gen5 single-controller magic; for gen5+ clients
// it is always scroll, so only the scroll layout is parsed.)
pub const MULTI_CONTROLLER_MAGIC: u32 = 0x0C; // gen5 (0x0D pre-gen5)
pub const HAPTICS_MAGIC: u32 = 0x0D;
pub const SS_HSCROLL_MAGIC: u32 = 0x5500_0001;
pub const SS_TOUCH_MAGIC: u32 = 0x5500_0002;
pub const SS_PEN_MAGIC: u32 = 0x5500_0003;

#[derive(Debug, PartialEq, Eq)]
pub enum ParseOutcome {
    Event(InputEvent),
    /// Well-formed but not handled in v1 (touch, pen, unicode, haptics...).
    Ignored(&'static str),
    /// Structurally invalid; count and log, never fatal.
    Malformed(&'static str),
}

fn i16le(body: &[u8], offset: usize) -> i16 {
    i16::from_le_bytes(body[offset..offset + 2].try_into().unwrap())
}

fn u16le(body: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(body[offset..offset + 2].try_into().unwrap())
}

/// Parses one INPUT_DATA payload. `payload` is the full NV packet
/// (size field included).
pub fn parse_input_packet(payload: &[u8]) -> ParseOutcome {
    if payload.len() < 8 {
        return ParseOutcome::Malformed("too short for input header");
    }
    let declared = u32::from_be_bytes(payload[0..4].try_into().unwrap()) as usize;
    // Sunshine validates the declared size against the datagram exactly.
    if declared + 4 != payload.len() {
        return ParseOutcome::Malformed("declared size mismatch");
    }
    let magic = u32::from_le_bytes(payload[4..8].try_into().unwrap());
    let body = &payload[8..];

    match magic {
        KEY_DOWN_MAGIC | KEY_UP_MAGIC => {
            if body.len() != 6 {
                return ParseOutcome::Malformed("bad keyboard packet size");
            }
            let key_code = i16le(body, 1); // after flags byte
            let event = if magic == KEY_DOWN_MAGIC {
                InputEvent::KeyDown { key_code }
            } else {
                InputEvent::KeyUp { key_code }
            };
            ParseOutcome::Event(event)
        }
        MOUSE_MOVE_REL_MAGIC => {
            if body.len() != 4 {
                return ParseOutcome::Malformed("bad rel mouse size");
            }
            // Wire quirk (Sunshine reads these big-endian too).
            let delta_x = i16::from_be_bytes(body[0..2].try_into().unwrap());
            let delta_y = i16::from_be_bytes(body[2..4].try_into().unwrap());
            ParseOutcome::Event(InputEvent::MouseMoveRel { delta_x, delta_y })
        }
        MOUSE_MOVE_ABS_MAGIC => {
            if body.len() != 10 {
                return ParseOutcome::Malformed("bad abs mouse size");
            }
            // common-c sends all four fields big-endian
            // (InputStream.c:450-459).
            ParseOutcome::Event(InputEvent::MouseMoveAbs {
                x: i16::from_be_bytes(body[0..2].try_into().unwrap()),
                y: i16::from_be_bytes(body[2..4].try_into().unwrap()),
                width: i16::from_be_bytes(body[6..8].try_into().unwrap()),
                height: i16::from_be_bytes(body[8..10].try_into().unwrap()),
            })
        }
        magic if magic == MOUSE_BUTTON_MAGIC - 1 || magic == MOUSE_BUTTON_MAGIC => {
            if body.len() != 1 {
                return ParseOutcome::Malformed("bad mouse button size");
            }
            ParseOutcome::Event(InputEvent::MouseButton {
                button: body[0],
                down: magic == MOUSE_BUTTON_MAGIC - 1,
            })
        }
        SCROLL_MAGIC => {
            if body.len() != 6 {
                // gen5 scroll is 6 bytes; the legacy 0x09 collides with
                // button-up and is disambiguated by size there.
                return ParseOutcome::Malformed("bad scroll size");
            }
            // gen5 scroll: both amounts big-endian (InputStream.c:1229-1230)
            ParseOutcome::Event(InputEvent::Scroll {
                amount: i16::from_be_bytes(body[0..2].try_into().unwrap()),
            })
        }
        MULTI_CONTROLLER_MAGIC => {
            if body.len() != 26 {
                return ParseOutcome::Malformed("bad multi controller size");
            }
            // headerB(0) controllerNumber(2) activeGamepadMask(4) midB(6)
            // buttonFlags(8) LT(10) RT(11) LSX(12) LSY(14) RSX(16) RSY(18)
            // tailA(20) buttonFlags2(22) tailB(24)
            ParseOutcome::Event(InputEvent::Gamepad(GamepadState {
                index: i16le(body, 2) as u8,
                buttons: u16le(body, 8) as u32 | ((u16le(body, 22) as u32) << 16),
                left_trigger: body[10],
                right_trigger: body[11],
                left_stick: (i16le(body, 12), i16le(body, 14)),
                right_stick: (i16le(body, 16), i16le(body, 18)),
            }))
        }
        SS_HSCROLL_MAGIC => {
            if body.len() != 2 {
                return ParseOutcome::Malformed("bad hscroll size");
            }
            // big-endian (InputStream.c:1310)
            ParseOutcome::Event(InputEvent::ScrollH {
                amount: i16::from_be_bytes(body[0..2].try_into().unwrap()),
            })
        }
        HAPTICS_MAGIC if payload.len() == 10 => ParseOutcome::Ignored("haptics"),
        SS_TOUCH_MAGIC => ParseOutcome::Ignored("touch"),
        SS_PEN_MAGIC => ParseOutcome::Ignored("pen"),
        magic if magic == 0x17 => ParseOutcome::Ignored("unicode text"),
        _ => ParseOutcome::Ignored("unknown magic"),
    }
}

/// Maps the Moonlight button mask to XUSB (Xbox 360) report buttons. The
/// low 16 bits match one-to-one (verified against Sunshine's x360_buttons).
pub fn xusb_buttons(mask: u32) -> u16 {
    (mask & 0xFFFF) as u16
}

/// Keys that require KEYEVENTF_EXTENDEDKEY with SendInput (the classic
/// GFE/Sunshine extended set).
pub fn is_extended_key(vk: i16) -> bool {
    matches!(
        vk as u32,
        0x0C // PA1/CANCEL-ish region unused; keep numeric list tight
        | 0x21..=0x28 // prior, next, end, home, arrows
        | 0x2C // print screen
        | 0x2D..=0x2E // insert, delete
        | 0x6F // divide
        | 0x90 // num lock
        | 0xA3 // right control
        | 0xA5 // right menu
    )
}

/// Accumulates high-resolution scroll distances and emits whole
/// WHEEL_DELTA (120) clicks, carrying the remainder.
pub struct ScrollAccumulator {
    remainder: i32,
}

impl ScrollAccumulator {
    pub fn new() -> Self {
        ScrollAccumulator { remainder: 0 }
    }

    /// Returns the wheel delta to inject now (a multiple of 120), if any.
    pub fn add(&mut self, amount: i16) -> i32 {
        self.remainder += amount as i32;
        let clicks = self.remainder / 120;
        self.remainder -= clicks * 120;
        clicks * 120
    }
}

/// Injection backend; implemented with SendInput + ViGEm on Windows and
/// with a recording fake in tests.
pub trait InputBackend: Send {
    fn key(&mut self, key_code: i16, down: bool);
    /// Relative mouse motion.
    fn mouse_move_rel(&mut self, delta_x: i16, delta_y: i16);
    /// Absolute position; x/y are relative to the client stream size
    /// width/height.
    fn mouse_move_abs(&mut self, x: i16, y: i16, width: i16, height: i16);
    fn mouse_button(&mut self, button: u8, down: bool);
    fn scroll(&mut self, horizontal: bool, amount: i16);
    fn gamepad(&mut self, state: &GamepadState);
}

/// Dispatches one parsed payload to the backend. Returns a log line when
/// the packet was counted rather than injected.
pub fn dispatch(payload: &[u8], backend: &mut dyn InputBackend) -> Option<String> {
    match parse_input_packet(payload) {
        ParseOutcome::Event(event) => {
            dispatch_event(event, backend);
            None
        }
        ParseOutcome::Ignored(what) => Some(format!("input: ignored {what}")),
        ParseOutcome::Malformed(why) => Some(format!("input: malformed packet ({why})")),
    }
}

pub fn dispatch_event(event: InputEvent, backend: &mut dyn InputBackend) {
    match event {
        InputEvent::KeyDown { key_code } => backend.key(key_code, true),
        InputEvent::KeyUp { key_code } => backend.key(key_code, false),
        InputEvent::MouseMoveRel { delta_x, delta_y } => backend.mouse_move_rel(delta_x, delta_y),
        InputEvent::MouseMoveAbs {
            x,
            y,
            width,
            height,
        } => backend.mouse_move_abs(x, y, width, height),
        InputEvent::MouseButton { button, down } => backend.mouse_button(button, down),
        InputEvent::Scroll { amount } => backend.scroll(false, amount),
        InputEvent::ScrollH { amount } => backend.scroll(true, amount),
        InputEvent::Gamepad(state) => backend.gamepad(&state),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(magic: u32, body: &[u8]) -> Vec<u8> {
        let mut packet = Vec::with_capacity(8 + body.len());
        packet.extend_from_slice(&((body.len() + 4) as u32).to_be_bytes());
        packet.extend_from_slice(&magic.to_le_bytes());
        packet.extend_from_slice(body);
        packet
    }

    #[derive(Default)]
    struct RecordingBackend {
        events: Vec<InputEvent>,
    }

    impl InputBackend for RecordingBackend {
        fn key(&mut self, key_code: i16, down: bool) {
            self.events.push(if down {
                InputEvent::KeyDown { key_code }
            } else {
                InputEvent::KeyUp { key_code }
            });
        }
        fn mouse_move_rel(&mut self, delta_x: i16, delta_y: i16) {
            self.events.push(InputEvent::MouseMoveRel { delta_x, delta_y });
        }
        fn mouse_move_abs(&mut self, x: i16, y: i16, width: i16, height: i16) {
            self.events.push(InputEvent::MouseMoveAbs { x, y, width, height });
        }
        fn mouse_button(&mut self, button: u8, down: bool) {
            self.events.push(InputEvent::MouseButton { button, down });
        }
        fn scroll(&mut self, horizontal: bool, amount: i16) {
            self.events.push(if horizontal {
                InputEvent::ScrollH { amount }
            } else {
                InputEvent::Scroll { amount }
            });
        }
        fn gamepad(&mut self, state: &GamepadState) {
            self.events.push(InputEvent::Gamepad(*state));
        }
    }

    #[test]
    fn parses_keyboard_down_and_up() {
        // flags i8, keyCode i16 LE, modifiers i8, zero2 i16
        let body = [0u8, 0x41, 0x00, 0x00, 0x00, 0x00];
        match parse_input_packet(&packet(KEY_DOWN_MAGIC, &body)) {
            ParseOutcome::Event(InputEvent::KeyDown { key_code }) => assert_eq!(key_code, 0x41),
            other => panic!("unexpected {other:?}"),
        }
        match parse_input_packet(&packet(KEY_UP_MAGIC, &body)) {
            ParseOutcome::Event(InputEvent::KeyUp { key_code }) => assert_eq!(key_code, 0x41),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn parses_relative_mouse_with_big_endian_deltas() {
        let body = [0x00, 0x01, 0xFF, 0xFF]; // +1, -1 big-endian
        match parse_input_packet(&packet(MOUSE_MOVE_REL_MAGIC, &body)) {
            ParseOutcome::Event(InputEvent::MouseMoveRel { delta_x, delta_y }) => {
                assert_eq!((delta_x, delta_y), (1, -1));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn parses_absolute_mouse_with_reference_size() {
        // common-c sends all fields big-endian (InputStream.c:450-459)
        let body = [
            0x00, 0x40, // x 64
            0x00, 0xF0, // y 240
            0x00, 0x00, // unused
            0x00, 0x7F, // width 127 (client sends size-1)
            0x00, 0x47, // height 71
        ];
        match parse_input_packet(&packet(MOUSE_MOVE_ABS_MAGIC, &body)) {
            ParseOutcome::Event(InputEvent::MouseMoveAbs { x, y, width, height }) => {
                assert_eq!((x, y, width, height), (64, 240, 127, 71));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn parses_mouse_buttons_and_distinguishes_legacy_scroll_collision() {
        // gen5: 0x08 down, 0x09 up (1-byte body)
        match parse_input_packet(&packet(0x08, &[1])) {
            ParseOutcome::Event(InputEvent::MouseButton { button, down }) => {
                assert_eq!((button, down), (1, true));
            }
            other => panic!("unexpected {other:?}"),
        }
        match parse_input_packet(&packet(0x09, &[2])) {
            ParseOutcome::Event(InputEvent::MouseButton { button, down }) => {
                assert_eq!((button, down), (2, false));
            }
            other => panic!("unexpected {other:?}"),
        }
        // gen5 scroll 0x0A with 6-byte body
        match parse_input_packet(&packet(SCROLL_MAGIC, &[0x00, 0x78, 0, 0, 0, 0])) {
            ParseOutcome::Event(InputEvent::Scroll { amount }) => assert_eq!(amount, 120),
            other => panic!("unexpected {other:?}"),
        }
        // h-scroll Sunshine extension
        match parse_input_packet(&packet(SS_HSCROLL_MAGIC, &[0x00, 0x78])) {
            ParseOutcome::Event(InputEvent::ScrollH { amount }) => assert_eq!(amount, 120),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn parses_multi_controller_gen5_packet() {
        // headerB i16, controllerNumber i16, activeGamepadMask i16, midB i16,
        // buttonFlags u16, LT u8, RT u8, LSX LSY RSX RSY i16, tailA i16,
        // buttonFlags2 i16, tailB i16  (all little-endian)
        let mut body = Vec::new();
        body.extend_from_slice(&0x1Au16.to_le_bytes()); // headerB
        body.extend_from_slice(&2i16.to_le_bytes()); // controllerNumber
        body.extend_from_slice(&0x07i16.to_le_bytes()); // activeGamepadMask
        body.extend_from_slice(&0x14u16.to_le_bytes()); // midB
        body.extend_from_slice(&(0x1000u16 | 0x0010).to_le_bytes()); // A + START
        body.push(255); // LT
        body.push(7); // RT
        body.extend_from_slice(&(-1000i16).to_le_bytes()); // LSX
        body.extend_from_slice(&1000i16.to_le_bytes()); // LSY
        body.extend_from_slice(&(32767i16).to_le_bytes()); // RSX
        body.extend_from_slice(&(-32768i16).to_le_bytes()); // RSY
        body.extend_from_slice(&0x009Cu16.to_le_bytes()); // tailA
        body.extend_from_slice(&1u16.to_le_bytes()); // buttonFlags2 (paddle1)
        body.extend_from_slice(&0x0055u16.to_le_bytes()); // tailB
        assert_eq!(body.len(), 26);

        match parse_input_packet(&packet(MULTI_CONTROLLER_MAGIC, &body)) {
            ParseOutcome::Event(InputEvent::Gamepad(state)) => {
                assert_eq!(state.index, 2);
                assert_eq!(state.buttons, 0x1000 | 0x0010 | 0x10000);
                assert_eq!(state.left_trigger, 255);
                assert_eq!(state.right_trigger, 7);
                assert_eq!(state.left_stick, (-1000, 1000));
                assert_eq!(state.right_stick, (32767, -32768));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn rejects_malformed_packets_without_panicking() {
        assert_eq!(
            parse_input_packet(&[]),
            ParseOutcome::Malformed("too short for input header")
        );
        let mut bad = packet(KEY_DOWN_MAGIC, &[0; 6]);
        bad[0] = 99; // corrupt declared size
        assert!(matches!(
            parse_input_packet(&bad),
            ParseOutcome::Malformed("declared size mismatch")
        ));
        // right size field, wrong body length
        assert!(matches!(
            parse_input_packet(&packet(KEY_DOWN_MAGIC, &[0; 4])),
            ParseOutcome::Malformed(_)
        ));
        // unknown magic is counted, not fatal
        assert!(matches!(
            parse_input_packet(&packet(0xDEAD, &[0; 4])),
            ParseOutcome::Ignored("unknown magic")
        ));
        // touch/pen/unicode ignored in v1
        assert!(matches!(
            parse_input_packet(&packet(SS_TOUCH_MAGIC, &[0; 20])),
            ParseOutcome::Ignored("touch")
        ));
    }

    #[test]
    fn xusb_button_mapping_matches_xbox_report() {
        // Moonlight mask bits equal XUSB bits directly (0x0001..0x8000).
        assert_eq!(xusb_buttons(0x0001), 0x0001); // dpad up
        assert_eq!(xusb_buttons(0x0400), 0x0400); // guide
        assert_eq!(xusb_buttons(0x8000), 0x8000); // Y
        assert_eq!(xusb_buttons(0x1000 | 0x0020), 0x1020); // A + back
        // paddle / touchpad extension bits do not fit an X360 report
        assert_eq!(xusb_buttons(0x1_0000), 0);
    }

    #[test]
    fn extended_key_detection() {
        for vk in [0x21, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x6F, 0x90, 0xA3, 0xA5] {
            assert!(is_extended_key(vk), "vk {vk:#x} should be extended");
        }
        for vk in [0x41, 0x0D, 0x11, 0x10, 0xA0, 0xA1, 0xA2, 0xA4] {
            assert!(!is_extended_key(vk), "vk {vk:#x} should not be extended");
        }
    }

    #[test]
    fn scroll_accumulator_emits_whole_clicks_and_carries_remainder() {
        let mut scroll = ScrollAccumulator::new();
        assert_eq!(scroll.add(120), 120);
        assert_eq!(scroll.add(100), 0); // remainder 100
        assert_eq!(scroll.add(20), 120); // 120 total -> one click
        assert_eq!(scroll.add(-240), -240);
        assert_eq!(scroll.add(-119), 0);
        assert_eq!(scroll.add(-1), -120);
    }

    #[test]
    fn dispatch_routes_every_event_type() {
        let mut backend = RecordingBackend::default();
        let packets = [
            packet(KEY_DOWN_MAGIC, &[0, 0x41, 0, 0, 0, 0]),
            packet(KEY_UP_MAGIC, &[0, 0x41, 0, 0, 0, 0]),
            packet(MOUSE_MOVE_REL_MAGIC, &[1, 0, 0, 0]),
            packet(MOUSE_MOVE_ABS_MAGIC, &[0, 1, 0, 2, 0, 0, 0, 9, 0, 4]),
            packet(0x08, &[1]),
            packet(SCROLL_MAGIC, &[0, 0x78, 0, 0, 0, 0]),
            packet(SS_HSCROLL_MAGIC, &[0, 0x78]),
            packet(MULTI_CONTROLLER_MAGIC, &[0; 26]),
        ];
        for payload in &packets {
            assert!(dispatch(payload, &mut backend).is_none());
        }
        assert_eq!(backend.events.len(), 8);
        assert!(matches!(backend.events[4], InputEvent::MouseButton { button: 1, down: true }));
        assert!(matches!(backend.events[7], InputEvent::Gamepad(_)));
        // malformed payloads produce log lines, not panics
        assert!(dispatch(&[], &mut backend).is_some());
    }
}
