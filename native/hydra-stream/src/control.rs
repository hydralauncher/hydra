//! GameStream control channel server: the hand-rolled ENet protocol
//! server (Part A) bound to the control UDP port, bridged with the
//! session state machine.
//!
//! Moonlight connects here right after RTSP PLAY, sends START_A/START_B,
//! periodic pings and loss stats, and terminates the session either with
//! an explicit TERMINATION message or by disconnecting. Raw (non-ENet)
//! datagrams are tolerated and counted.

use std::io;
use std::net::UdpSocket;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::enet::{EnetError, EnetEvent, EnetServer};
use crate::nvhttp::State;
use crate::stream::{
    control_acceptable, encrypted_termination_payload, handle_control_payload,
};

const CONTROL_SILENCE_TIMEOUT: Duration = Duration::from_secs(10);
const FLUSH_INTERVAL: Duration = Duration::from_millis(20);

pub fn serve(state: Arc<State>, port: u16) -> io::Result<u16> {
    let socket = UdpSocket::bind(("0.0.0.0", port))?;
    let bound = socket.local_addr()?.port();
    std::thread::spawn(move || {
        if let Err(error) = run(state, socket) {
            eprintln!("control server failed: {error}");
        }
    });
    Ok(bound)
}

fn run(state: Arc<State>, socket: UdpSocket) -> io::Result<()> {
    socket.set_read_timeout(Some(FLUSH_INTERVAL))?;
    eprintln!("ENet control server listening on {}", socket.local_addr()?.port());

    let mut server = EnetServer::new();
    let mut events: Vec<EnetEvent> = Vec::new();
    // Input injection runs on a dedicated thread: ViGEmBus ioctls can
    // block (plugin/update with GetOverlappedResult wait), and blocking
    // the ENet protocol loop stalls ACKs and liveness. Bounded channel:
    // a full queue drops events, never the protocol (Sunshine runs
    // injection off the network thread the same way).
    let (input_tx, input_rx) = std::sync::mpsc::sync_channel::<crate::input::InputEvent>(256);
    let input_dropped = Arc::new(std::sync::atomic::AtomicU64::new(0));
    {
        let input_dropped = input_dropped.clone();
        std::thread::spawn(move || {
            let mut backend = crate::input_windows::WindowsInputBackend::new();
            while let Ok(event) = input_rx.recv() {
                crate::input::dispatch_event(event, &mut backend);
            }
            let _ = input_dropped; // worker exits with the process
        });
    }
    struct QueuedInputBackend {
        sender: std::sync::mpsc::SyncSender<crate::input::InputEvent>,
        dropped: Arc<std::sync::atomic::AtomicU64>,
    }
    impl QueuedInputBackend {
        fn offer(&self, event: crate::input::InputEvent) {
            if self.sender.try_send(event).is_err() {
                self.dropped.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }
    impl crate::input::InputBackend for QueuedInputBackend {
        fn key(&mut self, key_code: i16, down: bool) {
            self.offer(if down {
                crate::input::InputEvent::KeyDown { key_code }
            } else {
                crate::input::InputEvent::KeyUp { key_code }
            });
        }
        fn mouse_move_rel(&mut self, delta_x: i16, delta_y: i16) {
            self.offer(crate::input::InputEvent::MouseMoveRel { delta_x, delta_y });
        }
        fn mouse_move_abs(&mut self, x: i16, y: i16, width: i16, height: i16) {
            self.offer(crate::input::InputEvent::MouseMoveAbs { x, y, width, height });
        }
        fn mouse_button(&mut self, button: u8, down: bool) {
            self.offer(crate::input::InputEvent::MouseButton { button, down });
        }
        fn scroll(&mut self, horizontal: bool, amount: i16) {
            self.offer(if horizontal {
                crate::input::InputEvent::ScrollH { amount }
            } else {
                crate::input::InputEvent::Scroll { amount }
            });
        }
        fn gamepad(&mut self, state: &crate::input::GamepadState) {
            self.offer(crate::input::InputEvent::Gamepad(state.clone()));
        }
    }
    let mut input_backend = QueuedInputBackend {
        sender: input_tx,
        dropped: input_dropped.clone(),
    };
    let mut input_count: u64 = 0;
    let mut raw_input_count: u64 = 0;
    let mut buffer = [0u8; 4096];
    let mut last_flush = Instant::now();
    let mut last_stats_log = Instant::now();
    // ENet wire-counter snapshots for the per-5s stats window: the raw
    // deltas feed the adaptive controller on the video thread (which owns
    // the congestion verdict)
    let mut last_dup = 0u64;
    let mut last_window_drops = 0u64;
    let mut last_received = 0u64;
    // IDR-gate snapshots for the same window: how many client IDR
    // requests were answered vs coalesced into an already-owed answer, so
    // the keyframe spend of a starving client is visible in the stats
    let mut last_idr_answered = 0u64;
    let mut last_idr_coalesced = 0u64;
    // qWAVE flow for the connected peer; dropped with the peer (the
    // control ACKs are marked per the client's video qosTrafficType —
    // the tiny return-path datagrams that bufferbloat drowns first)
    let mut _control_qos_flow: Option<crate::qos::QosFlow> = None;

    loop {
        let now = Instant::now();

        // Session ended while a client is connected: tell it why and drop.
        if server.peer_connected() && !control_acceptable(&state) {
            eprintln!("control: session ended, sending termination");
            let _ = server.send_reliable(0, &encrypted_termination_payload(&state, 0));
            send_flush(&socket, &mut server, now);
            _control_qos_flow = None;
            server.reset();
        }

        match socket.recv_from(&mut buffer) {
            Ok((length, from)) => {
                if !control_acceptable(&state) && server.peer_address().is_none() {
                    // No pending session: ignore probes (Sunshine model).
                    continue;
                }
                let result = server.handle_datagram(from, &buffer[..length], now, &mut events);
                // Raw input tolerance must survive the client's source port
                // changing mid-session (WiFi roaming rebinds the input
                // socket): besides datagrams that are not ENet at all, a
                // datagram from the peer's host IP at a port other than the
                // peer's failed protocol validation (the enet layer only
                // migrates the peer address when the session id matches, and
                // rejects these otherwise). Count both as tolerated raw
                // input; anything else — a different host IP above all —
                // stays a silent drop.
                let raw_input = match &result {
                    Err(EnetError::NonProtocol) => true,
                    Err(EnetError::Invalid) => server
                        .peer_address()
                        .is_some_and(|peer| peer.ip() == from.ip() && peer.port() != from.port()),
                    Ok(()) => false,
                };
                if raw_input {
                    raw_input_count += 1;
                }
            }
            Err(error)
                if error.kind() == io::ErrorKind::WouldBlock
                    || error.kind() == io::ErrorKind::TimedOut => {}
            Err(error) => return Err(error),
        }

        for event in events.drain(..) {
            match event {
                EnetEvent::Connected { connect_data } => {
                    eprintln!("control: client connected (enet data {connect_data:#x})");
                    // mark the control channel per the client's video
                    // qosTrafficType (the control socket carries the
                    // return-path ACKs alongside the video class)
                    if let Some(peer) = server.peer_address() {
                        _control_qos_flow = match state
                            .launch_params()
                            .and_then(|launch| launch.video_qos_type)
                        {
                            Some(0) => {
                                eprintln!("control: client sent qosTrafficType=0, socket stays unmarked");
                                None
                            }
                            Some(_) => crate::qos::apply_socket_qos(
                                &socket,
                                peer,
                                crate::qos::QosTraffic::Video,
                                "x-nv-vqos[0].qosTrafficType (control)",
                            ),
                            None => None,
                        };
                    }
                    let _ = state.events.send(
                        serde_json::json!({ "event": "control-connected" }).to_string(),
                    );
                }
                EnetEvent::Payload { channel, payload } => {
                    handle_control_payload(
                        &state,
                        &payload,
                        channel,
                        &mut input_backend,
                        &mut input_count,
                        &mut raw_input_count,
                    );
                }
                EnetEvent::Disconnected => {
                    eprintln!("control: client disconnected");
                    _control_qos_flow = None;
                    state.end_session("control-lost");
                }
            }
        }

        // Liveness: a connected client must produce traffic (it pings at
        // least once per second in practice).
        if server.peer_connected()
            && server
                .silent_for(now)
                .is_some_and(|silent| silent >= CONTROL_SILENCE_TIMEOUT)
        {
            eprintln!("control: client timed out");
            _control_qos_flow = None;
            server.reset();
            state.end_session("control-timeout");
        }

        if now.duration_since(last_flush) >= FLUSH_INTERVAL {
            last_flush = now;
            send_flush(&socket, &mut server, now);
            if server.take_failure() {
                eprintln!("control: peer stopped acknowledging our commands, ending session");
                state.end_session("control-ack-timeout");
            }
            if now.duration_since(last_stats_log) >= Duration::from_secs(5) {
                last_stats_log = now;
                if server.peer_address().is_some() || control_acceptable(&state) {
                    let depths: Vec<String> = server
                        .reorder_depths()
                        .iter()
                        .map(|(channel, depth)| format!("ch{channel}={depth}"))
                        .collect();
                    // per-5s deltas: a re-send the receive window refused
                    // (`window_discards`) and a re-send of a sequence already
                    // seen at the delivery cursor (`duplicate_reliable`) are
                    // the client retransmitting, which means OUR ACKs are
                    // being delayed/dropped on the return path (the video
                    // flood queues ahead of the tiny ACKs on the client's
                    // radio). The two counters are different arrivals of that
                    // same retransmit pressure — both are evidence, and the
                    // verdict sums them (see
                    // `adaptive::enet_window_congested`). Feed the RAW deltas
                    // to the adaptive controller; the verdict itself is
                    // computed there, on its own window.
                    let dup_delta = server.stats.duplicate_reliable - last_dup;
                    let drop_delta = server.stats.window_discards - last_window_drops;
                    let recv_delta = server.stats.send_reliable - last_received;
                    last_dup = server.stats.duplicate_reliable;
                    last_window_drops = server.stats.window_discards;
                    last_received = server.stats.send_reliable;
                    let congested =
                        crate::adaptive::enet_window_congested(dup_delta, drop_delta, recv_delta);
                    // IDR spend of the same window: requests the starvation
                    // gate answered vs coalesced into an answer already owed
                    // (nothing is ever dropped — a coalesced request rides
                    // the armed idr_pending). A window that answers 15/s for
                    // a 25Mbps stream is ~11Mbps of keyframes, which is the
                    // 2026-09-14 freeze's whole shape, so it must be visible
                    // here and not only in the per-IDR trace.
                    let (idr_answered, idr_coalesced) = state.idr_gate_counts();
                    let idr_answered_delta = idr_answered.saturating_sub(last_idr_answered);
                    let idr_coalesced_delta = idr_coalesced.saturating_sub(last_idr_coalesced);
                    last_idr_answered = idr_answered;
                    last_idr_coalesced = idr_coalesced;
                    eprintln!(
                        "enet: stats {} reorder-depth[{}] | 5s window: events+{} (= dup+{} window-drops+{}) recv+{} congested={} | idr answered+{} coalesced+{}",
                        server.stats.summary(),
                        depths.join(","),
                        dup_delta + drop_delta,
                        dup_delta,
                        drop_delta,
                        recv_delta,
                        congested,
                        idr_answered_delta,
                        idr_coalesced_delta,
                    );
                    for warning in server.stall_warnings(now) {
                        eprintln!("{warning}");
                    }
                    if let Some(shared) = state.stream_shared() {
                        shared
                            .enet_dup
                            .fetch_add(dup_delta, std::sync::atomic::Ordering::Relaxed);
                        shared
                            .enet_window_drops
                            .fetch_add(drop_delta, std::sync::atomic::Ordering::Relaxed);
                        shared
                            .enet_received
                            .fetch_add(recv_delta, std::sync::atomic::Ordering::Relaxed);
                    }
                    let dropped = input_dropped.load(std::sync::atomic::Ordering::Relaxed);
                    if dropped > 0 {
                        eprintln!("control: dropped {dropped} input event(s), worker busy");
                        input_dropped.store(0, std::sync::atomic::Ordering::Relaxed);
                    }
                }
            }
            if raw_input_count > 0 && server.peer_address().is_none() {
                eprintln!("control: tolerated {raw_input_count} non-ENet datagram(s)");
                raw_input_count = 0;
            }
            if input_count > 0 {
                eprintln!("control: injected {input_count} input event(s)");
                input_count = 0;
            }
        }
    }
}

fn send_flush(socket: &UdpSocket, server: &mut EnetServer, now: Instant) {
    static SEND_ERRORS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let Some(peer) = server.peer_address() else {
        return;
    };
    for datagram in server.flush(now) {
        if let Err(error) = socket.send_to(&datagram, peer) {
            // same drop-and-count semantics as the RTP senders: a failed
            // control datagram is dropped, never fatal
            let count = SEND_ERRORS.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            if count == 1 || count % 100 == 0 {
                eprintln!("control: send error, dropping datagram: {error} (total {count})");
            }
        }
    }
}
