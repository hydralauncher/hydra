#[cfg(target_os = "linux")]
use x11rb::connection::Connection;
#[cfg(target_os = "linux")]
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt};
#[cfg(target_os = "linux")]
use x11rb::rust_connection::RustConnection;

#[cfg(target_os = "linux")]
fn intern_atom(connection: &RustConnection, name: &[u8]) -> Option<u32> {
    connection
        .intern_atom(false, name)
        .ok()?
        .reply()
        .ok()
        .map(|reply| reply.atom)
}

#[cfg(target_os = "linux")]
fn first_u32_property(
    connection: &RustConnection,
    window: u32,
    property: u32,
    property_type: u32,
) -> Option<u32> {
    connection
        .get_property(false, window, property, property_type, 0, 1)
        .ok()?
        .reply()
        .ok()?
        .value32()?
        .next()
}

#[cfg(target_os = "linux")]
pub fn get_active_window() -> Option<(u32, Option<u32>)> {
    let (connection, screen_index) = RustConnection::connect(None).ok()?;
    let root = connection.setup().roots.get(screen_index)?.root;
    let active_window_atom = intern_atom(&connection, b"_NET_ACTIVE_WINDOW")?;
    let active_window = first_u32_property(
        &connection,
        root,
        active_window_atom,
        AtomEnum::WINDOW.into(),
    )?;

    if active_window == 0 {
        return None;
    }

    let process_id = intern_atom(&connection, b"_NET_WM_PID").and_then(|pid_atom| {
        first_u32_property(
            &connection,
            active_window,
            pid_atom,
            AtomEnum::CARDINAL.into(),
        )
    });

    Some((active_window, process_id))
}

#[cfg(not(target_os = "linux"))]
pub fn get_active_window() -> Option<(u32, Option<u32>)> {
    None
}
