#[cfg(target_os = "linux")]
use x11rb::protocol::res::{ClientIdMask, ClientIdSpec, ConnectionExt};
#[cfg(target_os = "linux")]
use x11rb::rust_connection::RustConnection;

#[cfg(target_os = "linux")]
pub fn get_window_client_pid(window_id: &str) -> Option<u32> {
    let window = window_id.trim().parse::<u32>().ok()?;
    if window == 0 {
        return None;
    }

    let (connection, _) = RustConnection::connect(None).ok()?;
    connection.res_query_version(1, 2).ok()?.reply().ok()?;

    let specs = [ClientIdSpec {
        client: window,
        mask: ClientIdMask::LOCAL_CLIENT_PID,
    }];
    let reply = connection.res_query_client_ids(&specs).ok()?.reply().ok()?;

    reply
        .ids
        .iter()
        .find(|id| u32::from(id.spec.mask) & u32::from(ClientIdMask::LOCAL_CLIENT_PID) != 0)
        .and_then(|id| id.value.first().copied())
        .filter(|pid| *pid > 0)
}

#[cfg(not(target_os = "linux"))]
pub fn get_window_client_pid(_window_id: &str) -> Option<u32> {
    None
}
