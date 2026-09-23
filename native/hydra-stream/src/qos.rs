//! Per-client socket QoS marking, negotiated by the ANNOUNCE
//! `x-nv-vqos[0].qosTrafficType` / `x-nv-aqos.qosTrafficType` attributes
//! the same way Sunshine applies them (parse: rtsp.cpp:1160/1159; apply:
//! stream.cpp:2147/2174 -> platform/windows/misc.cpp:1650): qWAVE
//! `QOSAddSocketToFlow` with `QOSTrafficTypeAudioVideo` for video (and
//! the control channel) and `QOSTrafficTypeVoice` for audio, falling
//! back to `setsockopt(IP_TOS)` with DSCP EF when qWAVE is unavailable
//! or refuses the flow. Nothing is marked when the client did not send
//! the attribute.

use std::net::{SocketAddr, UdpSocket};
use std::os::windows::io::AsRawSocket;
use std::sync::OnceLock;

use windows::Win32::Foundation::HANDLE;
use windows::Win32::Networking::WinSock::{
    AF_INET, IN_ADDR, IPPROTO_IP, IP_TOS, SOCKADDR, SOCKADDR_IN, SOCKET, setsockopt,
};
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::core::{s, w};

/// Which media class a socket carries; maps to the qWAVE traffic type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QosTraffic {
    /// Video and the control channel: qWAVE QOSTrafficTypeAudioVideo.
    Video,
    /// Audio: qWAVE QOSTrafficTypeVoice.
    Audio,
}

impl QosTraffic {
    fn qwave_type(self) -> u32 {
        // qos2.h: QOSTrafficTypeAudioVideo = 3, QOSTrafficTypeVoice = 4
        match self {
            QosTraffic::Video => 3,
            QosTraffic::Audio => 4,
        }
    }
    fn label(self) -> &'static str {
        match self {
            QosTraffic::Video => "AudioVideo",
            QosTraffic::Audio => "Voice",
        }
    }
}

/// DSCP EF (46) shifted into the IP TOS byte: the setsockopt fallback
/// marking. Expedited-forwarding treatment for the AP/router hops that
/// honor it — exactly what the tiny control ACKs need next to the video
/// flood (the adaptive controller's bufferbloat thesis).
pub const DSCP_EF_TOS: u8 = 46 << 2; // 0xB8

const QOS_NON_ADAPTIVE_FLOW: u32 = 0x0000_0002;

/// SOCKADDR_IN for an IPv4 socket address, or None for IPv6 (qWAVE flow
/// marking here is IPv4-only; Sunshine's dual-stack connect-hack is out
/// of scope for the LAN GameStream path).
fn sockaddr_v4(peer: SocketAddr) -> Option<SOCKADDR_IN> {
    let SocketAddr::V4(v4) = peer else {
        return None;
    };
    Some(SOCKADDR_IN {
        sin_family: AF_INET,
        sin_port: v4.port().to_be(),
        sin_addr: IN_ADDR {
            S_un: windows::Win32::Networking::WinSock::IN_ADDR_0 {
                S_addr: u32::from_ne_bytes(v4.ip().octets()),
            },
        },
        sin_zero: [0; 8],
    })
}

#[repr(C)]
struct QosVersion {
    major: u16,
    minor: u16,
}

type FnCreateHandle = unsafe extern "system" fn(*const QosVersion, *mut HANDLE) -> i32;
type FnAddSocketToFlow =
    unsafe extern "system" fn(HANDLE, SOCKET, *const SOCKADDR, u32, u32, *mut u32) -> i32;
type FnRemoveSocketFromFlow = unsafe extern "system" fn(HANDLE, SOCKET, u32, u32) -> i32;
type FnCloseHandle = unsafe extern "system" fn(HANDLE) -> i32;

/// qWAVE entry points plus the process-lifetime QOS handle (Sunshine
/// keeps the same statics in its platform misc).
struct Qwave {
    handle: HANDLE,
    add_socket_to_flow: FnAddSocketToFlow,
    remove_socket_from_flow: FnRemoveSocketFromFlow,
}
// HANDLE is an opaque kernel handle; the QOS entry points are
// thread-safe, and the static is only read after init.
unsafe impl Send for Qwave {}
unsafe impl Sync for Qwave {}

static QWAVE: OnceLock<Option<Qwave>> = OnceLock::new();

fn qwave() -> Option<&'static Qwave> {
    QWAVE
        .get_or_init(|| unsafe {
            let library = LoadLibraryW(w!("qwave.dll")).ok()?;
            let create: FnCreateHandle =
                std::mem::transmute(GetProcAddress(library, s!("QOSCreateHandle"))?);
            let add: FnAddSocketToFlow =
                std::mem::transmute(GetProcAddress(library, s!("QOSAddSocketToFlow"))?);
            let remove: FnRemoveSocketFromFlow =
                std::mem::transmute(GetProcAddress(library, s!("QOSRemoveSocketFromFlow"))?);
            let close: FnCloseHandle =
                std::mem::transmute(GetProcAddress(library, s!("QOSCloseHandle"))?);
            let mut handle = HANDLE::default();
            let version = QosVersion { major: 1, minor: 0 };
            if create(&version, &mut handle) == 0 || handle.is_invalid() {
                eprintln!("qos: QOSCreateHandle failed, DSCP EF fallback for all sockets");
                return None;
            }
            // the library and the handle stay loaded for the process
            // lifetime, like Sunshine's statics; `close` is only used on
            // failure paths below
            let _ = close;
            Some(Qwave {
                handle,
                add_socket_to_flow: add,
                remove_socket_from_flow: remove,
            })
        })
        .as_ref()
}

/// A live qWAVE flow; removed from the socket on drop.
pub struct QosFlow {
    socket: SOCKET,
    flow_id: u32,
}

impl Drop for QosFlow {
    fn drop(&mut self) {
        if let Some(qwave) = qwave() {
            unsafe {
                (qwave.remove_socket_from_flow)(qwave.handle, self.socket, self.flow_id, 0);
            }
        }
    }
}

/// Marks traffic from `socket` to `peer` with the client's requested
/// class. `attr_name` names the ANNOUNCE attribute that authorized
/// marking (for the log line). Returns the flow guard when qWAVE
/// marking is in effect, None otherwise (including the DSCP fallback,
/// which needs no cleanup).
pub fn apply_socket_qos(
    socket: &UdpSocket,
    peer: SocketAddr,
    traffic: QosTraffic,
    attr_name: &str,
) -> Option<QosFlow> {
    let Some(sockaddr) = sockaddr_v4(peer) else {
        eprintln!("qos: {attr_name}: IPv6 endpoint {peer}, skipping QoS marking");
        return None;
    };
    let raw = SOCKET(socket.as_raw_socket() as usize);

    if let Some(qwave) = qwave() {
        let mut flow_id = 0u32;
        let ok = unsafe {
            (qwave.add_socket_to_flow)(
                qwave.handle,
                raw,
                &sockaddr as *const SOCKADDR_IN as *const SOCKADDR,
                traffic.qwave_type(),
                QOS_NON_ADAPTIVE_FLOW,
                &mut flow_id,
            ) != 0
        };
        if ok && flow_id != 0 {
            eprintln!(
                "qos: {attr_name}: {} traffic to {peer} marked via qWAVE flow {flow_id}",
                traffic.label()
            );
            return Some(QosFlow {
                socket: raw,
                flow_id,
            });
        }
        eprintln!("qos: QOSAddSocketToFlow failed, falling back to DSCP EF");
    } else {
        eprintln!("qos: qWAVE unavailable, falling back to DSCP EF");
    }

    // fallback: best-effort TOS byte; needs no guard
    let result = unsafe { setsockopt(raw, IPPROTO_IP.0, IP_TOS, Some(&[DSCP_EF_TOS])) };
    if result == 0 {
        eprintln!(
            "qos: {attr_name}: {} traffic to {peer} marked via IP_TOS DSCP EF",
            traffic.label()
        );
    } else {
        eprintln!("qos: setsockopt(IP_TOS) failed ({result}), socket unmarked");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dscp_ef_is_46_in_the_tos_byte() {
        assert_eq!(DSCP_EF_TOS, 0xB8);
    }

    #[test]
    fn sockaddr_v4_packs_family_port_and_be_addr() {
        let addr = sockaddr_v4("192.168.1.20:47998".parse().unwrap()).expect("v4 sockaddr");
        assert_eq!(addr.sin_family.0, AF_INET.0);
        assert_eq!(addr.sin_port, 47998u16.to_be());
        let stored = unsafe { addr.sin_addr.S_un.S_addr };
        assert_eq!(u32::from_be(stored), 0xC0A8_0114);
        assert_eq!(addr.sin_zero, [0; 8]);
    }

    #[test]
    fn sockaddr_v6_is_not_supported() {
        assert!(
            sockaddr_v4("[2001:db8::1]:47998".parse().unwrap()).is_none(),
            "IPv6 endpoints skip qWAVE marking (IPv4-only LAN path)"
        );
    }

    #[test]
    fn traffic_types_map_to_qwave_values() {
        assert_eq!(QosTraffic::Video.qwave_type(), 3);
        assert_eq!(QosTraffic::Audio.qwave_type(), 4);
        assert_eq!(QosTraffic::Video.label(), "AudioVideo");
        assert_eq!(QosTraffic::Audio.label(), "Voice");
    }
}
