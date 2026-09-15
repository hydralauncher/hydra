use std::net::Ipv4Addr;

use if_addrs::IfAddr;
use mdns_sd::{ServiceDaemon, ServiceInfo};

use crate::nvhttp::{HOSTNAME, HTTP_PORT};

pub fn start(uuid: &str) -> Result<(), String> {
    let daemon = ServiceDaemon::new().map_err(|error| error.to_string())?;
    let txt: [(&str, &str); 2] = [("uniqueid", uuid), ("https", "1")];

    // Register with explicit addresses: addr_auto leaves the service without
    // usable addresses at announce time on Windows, so the daemon never
    // reaches the Announced state and answers queries with empty responses.
    // All non-loopback IPv4s are advertised (including VPN adapters like
    // Tailscale): clients pick whichever address family they can reach, and
    // private VPNs are a supported streaming path.
    let addrs: Vec<Ipv4Addr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|interface| !interface.is_loopback())
        .filter_map(|interface| match interface.addr {
            IfAddr::V4(v4) => Some(v4.ip),
            IfAddr::V6(_) => None,
        })
        .collect();
    let addrs: String = addrs
        .iter()
        .map(std::string::ToString::to_string)
        .collect::<Vec<_>>()
        .join(",");

    let service = ServiceInfo::new(
        "_nvstream._tcp.local.",
        HOSTNAME,
        "hydra.local.",
        addrs.as_str(),
        HTTP_PORT,
        &txt[..],
    )
    .map_err(|error| error.to_string())?;
    daemon.register(service).map_err(|error| error.to_string())?;

    let monitor = daemon.monitor().map_err(|error| error.to_string())?;
    tokio::spawn(async move {
        let _daemon = daemon;
        loop {
            match monitor.recv_async().await {
                Ok(event) => eprintln!("mdns: {event:?}"),
                Err(_) => break,
            }
        }
    });

    eprintln!("mDNS: advertising _nvstream._tcp on port {HTTP_PORT} as \"{HOSTNAME}\"");
    Ok(())
}
