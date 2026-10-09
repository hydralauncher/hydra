//! Sony controller HID report facts (DualShock 4 / DualSense).
//!
//! The byte offsets below are hardware facts, not copied program text. They are
//! taken from the reference implementations that document the wire format:
//!
//!   * SDL, `src/joystick/hidapi/SDL_hidapi_ps4.c` and `SDL_hidapi_ps5.c`
//!     (zlib licence), which describe the 0x01 / 0x11 / 0x31 input reports and
//!     their stick and button offsets.
//!   * The Linux kernel driver `drivers/hid/hid-playstation.c`, which documents
//!     the same reports and the fact that the PS/Home bit is the first bit of
//!     the third button byte.
//!
//! Both are permittively licensed or are documentation of a wire format, so
//! nothing here is derived from a third-party application's source.
//!
//! Offsets count from byte 0 of the report, so byte 0 is the report id.

/// Controller generation. The two families differ in report ids and in how
/// many bytes of transport/sequence padding follow the report id.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Family {
    DualSense,
    Ds4,
}

impl Family {
    /// Stable identifier used in tests and diagnostics.
    #[cfg(test)]
    pub fn as_str(self) -> &'static str {
        match self {
            Family::DualSense => "dualsense",
            Family::Ds4 => "ds4",
        }
    }
}

/// Byte offset of the first button byte inside a raw input report.
///
/// The PS/Home button is the first bit of the *third* button byte, i.e.
/// `report[buttons + 2] & 0x01`, so `buttons` is the only offset needed here.
#[derive(Clone, Copy, Debug)]
pub struct Layout {
    pub buttons: usize,
}

/// A DualSense "simple" report 0x01 is 10 bytes over Bluetooth, but Raw Input
/// can hand it over as 78 bytes (the longest input report of that HID
/// collection). Only USB sends 0x01 at 64 bytes.
fn is_dualsense_simple_report(len: usize) -> bool {
    len == 10 || len == 78
}

/// Resolve the button offset for one report, or `None` when the report is not a
/// state report we understand (in which case the device is left alone).
pub fn locate(report_id: u8, family: Family, len: usize) -> Option<Layout> {
    let ds4 = family == Family::Ds4;

    match report_id {
        0x01 => {
            if ds4 {
                // USB, or Bluetooth "simple": [id] LX LY RX RY buttons...
                Some(Layout { buttons: 5 })
            } else if is_dualsense_simple_report(len) {
                // Bluetooth simple: [id] LX LY RX RY buttons...
                Some(Layout { buttons: 5 })
            } else {
                // USB: [id] LX LY RX RY L2 R2 counter buttons...
                Some(Layout { buttons: 8 })
            }
        }
        // Bluetooth full report: the id is followed by two transport bytes.
        0x11 if ds4 => Some(Layout { buttons: 7 }),
        // Bluetooth full report: the id is followed by one sequence byte.
        0x31 if !ds4 => Some(Layout { buttons: 9 }),
        _ => None,
    }
}

/// The PS / Home / Guide button: first bit of the third button byte.
pub fn ps_pressed(report: &[u8], layout: Layout) -> Option<bool> {
    let index = layout.buttons.checked_add(2)?;
    report.get(index).map(|byte| byte & 0x01 != 0)
}

/// Identify a Sony (or Sony-compatible) controller from its USB ids.
///
/// `0x054C` is Sony's vendor id. The product ids are the ones SDL's hidapi
/// drivers enumerate; the two virtual ids are the widely documented DSX/ViGEm
/// DualShock 4 emulation ids, which present the same report format.
pub fn identify(vid: u16, pid: u16) -> Option<(Family, &'static str)> {
    match (vid, pid) {
        (0x054C, 0x0CE6) => Some((Family::DualSense, "Sony DualSense")),
        (0x054C, 0x0DF2) => Some((Family::DualSense, "Sony DualSense Edge")),
        (0x054C, 0x0ECC) => Some((Family::DualSense, "Virtual DualSense")),
        (0x054C, 0x05C4) => Some((Family::Ds4, "Sony DualShock 4")),
        (0x054C, 0x09CC) => Some((Family::Ds4, "Sony DualShock 4 v2")),
        (0x11FF, 0x0847) => Some((Family::Ds4, "Virtual DualShock 4")),
        (0x3670, 0x0902) => Some((Family::Ds4, "Virtual DualShock 4")),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ds4_usb_ps_bit_is_third_button_byte() {
        let layout = locate(0x01, Family::Ds4, 64).unwrap();
        assert_eq!(layout.buttons, 5);
        let mut report = [0u8; 64];
        assert_eq!(ps_pressed(&report, layout), Some(false));
        report[7] = 0x01;
        assert_eq!(ps_pressed(&report, layout), Some(true));
        // A neighbouring bit must not be mistaken for PS.
        report[7] = 0x02;
        assert_eq!(ps_pressed(&report, layout), Some(false));
    }

    #[test]
    fn ds4_bluetooth_full_report_shifts_by_two_transport_bytes() {
        let layout = locate(0x11, Family::Ds4, 78).unwrap();
        assert_eq!(layout.buttons, 7);
        let mut report = [0u8; 78];
        report[9] = 0x01;
        assert_eq!(ps_pressed(&report, layout), Some(true));
    }

    #[test]
    fn dualsense_usb_and_bluetooth_use_different_offsets() {
        let usb = locate(0x01, Family::DualSense, 64).unwrap();
        assert_eq!(usb.buttons, 8, "64-byte 0x01 is USB");

        let bt_simple = locate(0x01, Family::DualSense, 10).unwrap();
        assert_eq!(bt_simple.buttons, 5, "10-byte 0x01 is Bluetooth simple");

        let bt_simple_long = locate(0x01, Family::DualSense, 78).unwrap();
        assert_eq!(bt_simple_long.buttons, 5, "78-byte 0x01 is still simple");

        let bt_full = locate(0x31, Family::DualSense, 78).unwrap();
        assert_eq!(bt_full.buttons, 9, "0x31 carries one sequence byte");
    }

    #[test]
    fn unknown_reports_are_not_decoded() {
        assert!(locate(0x02, Family::DualSense, 64).is_none());
        assert!(locate(0x11, Family::DualSense, 64).is_none());
        assert!(locate(0x31, Family::Ds4, 64).is_none());
    }

    #[test]
    fn short_reports_never_read_out_of_bounds() {
        let layout = locate(0x31, Family::DualSense, 78).unwrap();
        assert_eq!(ps_pressed(&[0u8; 4], layout), None);
    }

    #[test]
    fn identifies_sony_and_virtual_controllers() {
        let dualsense = identify(0x054C, 0x0CE6).unwrap();
        assert_eq!(dualsense.1, "Sony DualSense");
        assert_eq!(dualsense.0.as_str(), "dualsense");

        let ds4 = identify(0x054C, 0x09CC).unwrap();
        assert_eq!(ds4.1, "Sony DualShock 4 v2");
        assert_eq!(ds4.0.as_str(), "ds4");

        assert!(identify(0x054C, 0x1234).is_none());
        assert!(identify(0x045E, 0x0B13).is_none(), "Xbox is not a Sony id");
    }
}
