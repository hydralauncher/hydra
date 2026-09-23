//! Differential test: the REAL reference ENet client (cgutman/enet, the
//! fork moonlight-common-c vendors — tests/enet_client.c, prebuilt to
//! tests/enet_client.exe with w64devkit gcc) against our hand-rolled
//! protocol server. Proves at the peer level that our outgoing
//! datagrams (VERIFY_CONNECT, ACKNOWLEDGE) are accepted: the reference
//! client only removes commands from sentReliableCommands when our ACK
//! is processed, and only updates RTT from processed ACKs.

use std::io::Read;
use std::net::UdpSocket;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use hydra_stream::enet::{EnetEvent, EnetServer};

/// Runs our protocol server the same way control.rs does: receive,
/// handle, deliver, flush every 20ms.
fn run_reference_client_against_our_server() -> (String, bool) {
    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    socket
        .set_read_timeout(Some(Duration::from_millis(20)))
        .unwrap();
    let port = socket.local_addr().unwrap().port();

    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = stop.clone();
    let server_thread = std::thread::spawn(move || {
        let mut server = EnetServer::new();
        let mut events: Vec<EnetEvent> = Vec::new();
        let mut buffer = [0u8; 4096];
        let mut delivered: u64 = 0;
        let mut last_flush = Instant::now();
        while !stop_for_thread.load(Ordering::Relaxed) {
            let now = Instant::now();
            match socket.recv_from(&mut buffer) {
                Ok((length, from)) => {
                    let _ = server.handle_datagram(from, &buffer[..length], now, &mut events);
                }
                Err(error)
                    if error.kind() == std::io::ErrorKind::WouldBlock
                        || error.kind() == std::io::ErrorKind::TimedOut => {}
                Err(_) => break,
            }
            for event in events.drain(..) {
                if let EnetEvent::Payload { .. } = event {
                    delivered += 1;
                }
            }
            if now.duration_since(last_flush) >= Duration::from_millis(20) {
                last_flush = now;
                if let Some(peer) = server.peer_address() {
                    for datagram in server.flush(now) {
                        let _ = socket.send_to(&datagram, peer);
                    }
                }
            }
        }
        delivered
    });

    let exe = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/enet_client.exe");
    let mut child = Command::new(&exe)
        .arg("127.0.0.1")
        .arg(port.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap_or_else(|error| panic!("launch {}: {error}", exe.display()));
    let mut output = String::new();
    child
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut output)
        .unwrap();
    let status = child.wait().unwrap();

    stop.store(true, Ordering::Relaxed);
    let delivered = server_thread.join().unwrap();
    eprintln!("reference client delivered {delivered} payloads");
    eprintln!("{output}");
    (output, status.success())
}

#[test]
fn reference_enet_client_accepts_our_datagrams() {
    let (output, success) = run_reference_client_against_our_server();
    assert!(
        output.contains("RESULT OK"),
        "reference client rejected our datagrams:\n{output}"
    );
    assert!(success, "reference client exited non-zero:\n{output}");
}

/// Lossy differential: drop 25% of our -> client datagrams
/// deterministically. The ACK/retransmit dance must still converge: the
/// reference client only stops retransmitting once our ACKs are processed.
#[test]
fn reference_enet_client_converges_under_loss() {
    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    socket
        .set_read_timeout(Some(Duration::from_millis(20)))
        .unwrap();
    let port = socket.local_addr().unwrap().port();

    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = stop.clone();
    let server_thread = std::thread::spawn(move || {
        let mut server = EnetServer::new();
        let mut events: Vec<EnetEvent> = Vec::new();
        let mut buffer = [0u8; 4096];
        let mut last_flush = Instant::now();
        let mut sent_count = 0u64;
        let mut dropped = 0u64;
        while !stop_for_thread.load(Ordering::Relaxed) {
            let now = Instant::now();
            match socket.recv_from(&mut buffer) {
                Ok((length, from)) => {
                    let _ = server.handle_datagram(from, &buffer[..length], now, &mut events);
                }
                Err(error)
                    if error.kind() == std::io::ErrorKind::WouldBlock
                        || error.kind() == std::io::ErrorKind::TimedOut => {}
                Err(_) => break,
            }
            events.clear();
            if now.duration_since(last_flush) >= Duration::from_millis(20) {
                last_flush = now;
                if let Some(peer) = server.peer_address() {
                    for datagram in server.flush(now) {
                        // count-based 1-in-7 drop: deterministic
                        // regardless of flush batching or scheduling
                        sent_count += 1;
                        if sent_count % 7 == 0 {
                            dropped += 1;
                            continue;
                        }
                        let _ = socket.send_to(&datagram, peer);
                    }
                }
            }
        }
        dropped
    });

    let exe = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/enet_client.exe");
    let mut child = Command::new(&exe)
        .arg("127.0.0.1")
        .arg(port.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap_or_else(|error| panic!("launch {}: {error}", exe.display()));
    let mut output = String::new();
    child
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut output)
        .unwrap();
    let status = child.wait().unwrap();

    stop.store(true, Ordering::Relaxed);
    let dropped = server_thread.join().unwrap();
    eprintln!("dropped {dropped} of our datagrams under loss injection");
    eprintln!("{output}");
    assert!(
        output.contains("RESULT OK"),
        "reference client did not converge under 25% loss:\n{output}"
    );
    assert!(status.success());
}
