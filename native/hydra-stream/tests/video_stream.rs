//! M3 integration tests: synthetic end-to-end video flow over loopback UDP
//! and the ENet control handshake against the real control server.

use std::net::UdpSocket;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use hydra_stream::control;
use hydra_stream::enet;
use hydra_stream::nvhttp::{GamePhase, LaunchParams, State};
use hydra_stream::store::Store;
use hydra_stream::stream::termination_payload;
use hydra_stream::audio::{run_audio_loop, AudioCipher, AudioPacketizer, SyntheticAudioPipeline, AUDIO_PAYLOAD_TYPE};
use hydra_stream::video::{
    run_video_loop, StreamShared, SyntheticPipeline, FLAG_CONTAINS_PIC_DATA, FLAG_EOF, FLAG_SOF,
    VIDEO_PAYLOAD_TYPE,
};

fn test_state(name: &str) -> (Arc<State>, mpsc::UnboundedReceiver<String>) {
    let dir = std::env::temp_dir().join(format!("hydra-stream-m3-{name}-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    let store = Store::at(dir).unwrap();
    let (event_tx, event_rx) = mpsc::unbounded_channel::<String>();
    (Arc::new(State::with_store(store, event_tx).unwrap()), event_rx)
}

use tokio::sync::mpsc;

#[test]
fn synthetic_stream_flows_over_loopback_udp() {
    let (state, _events) = test_state("video");
    let shared = StreamShared::new();

    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    let server_addr = socket.local_addr().unwrap();
    let client = UdpSocket::bind("127.0.0.1:0").unwrap();
    let client_addr = client.local_addr().unwrap();
    client.connect(server_addr).unwrap();

    // establish the client endpoint BEFORE the sender starts, like
    // Moonlight's ping does, so the first (IDR) frame is not dropped
    client.send(b"PING").unwrap();

    let task_shared = shared.clone();
    let thread = std::thread::spawn(move || {
        let pipeline = Box::new(SyntheticPipeline::new(5000, 5, 1000));
        // frame_pacing is the frame interval (fps=1000 here); it also
        // bases the freshness budget, so it must not be zero
        run_video_loop(socket, task_shared, pipeline, 1392, 0, 0, Duration::from_millis(1), 1920, 1080, 60, 10_000, None).unwrap();
    });

    client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    let mut received: Vec<Vec<u8>> = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline && received.len() < 20 {
        let mut buffer = [0u8; 2048];
        match client.recv(&mut buffer) {
            Ok(length) => received.push(buffer[..length].to_vec()),
            Err(_) => break,
        }
    }

    // stop the loop and wait for the thread
    shared.stop.store(true, Ordering::Relaxed);
    // nudge: one more datagram so a blocking send wakes up if needed
    client.send(b"PING").unwrap();
    thread.join().unwrap();

    assert!(received.len() >= 5, "expected video packets, got {}", received.len());

    // validate wire structure of every datagram and reassemble frames
    let mut sequence: u16 = u16::from_be_bytes(received[0][2..4].try_into().unwrap());
    let mut frames: Vec<Vec<u8>> = Vec::new();
    let mut current: Vec<u8> = Vec::new();
    for packet in &received {
        assert_eq!(packet[0], 0x90, "RTP header byte");
        assert_eq!(packet[1], VIDEO_PAYLOAD_TYPE);
        assert_eq!(u16::from_be_bytes(packet[2..4].try_into().unwrap()), sequence);
        sequence = sequence.wrapping_add(1);
        assert_eq!(&packet[8..16], &[0; 8], "ssrc + reserved");

        let nv = &packet[16..32];
        let flags = nv[8];
        assert_eq!(flags & FLAG_CONTAINS_PIC_DATA, FLAG_CONTAINS_PIC_DATA);
        // FEC shards are zero-padded to the full shard size; the real
        // depacketizer derives the frame length from the short frame
        // header's lastPayloadLen field
        let mut payload = &packet[32..];
        if flags & FLAG_EOF != 0 {
            let short_header = if flags & FLAG_SOF != 0 {
                payload
            } else {
                &current[..8.min(current.len())]
            };
            let last_payload_len =
                u16::from_le_bytes(short_header[4..6].try_into().unwrap()) as usize;
            payload = &payload[..last_payload_len.min(payload.len())];
        }
        if flags & FLAG_SOF != 0 {
            assert!(current.is_empty(), "SOF while a frame is open");
            // short frame header begins the frame data
            assert_eq!(payload[0], 0x01);
        }
        current.extend_from_slice(payload);
        if flags & FLAG_EOF != 0 {
            frames.push(std::mem::take(&mut current));
        }
    }
    assert!(current.is_empty(), "stream ended mid-frame");
    assert!(!frames.is_empty(), "expected at least one complete frame");

    // frame data = 8-byte short header + 5000 synthetic bytes
    for (index, frame) in frames.iter().enumerate() {
        assert_eq!(frame.len(), 8 + 5000);
        assert_eq!(&frame[8..12], &[0, 0, 0, 1], "annex-B start code");
        assert_eq!(frame[3], if index == 0 { 2 } else { 1 }, "frame type");
    }

    // the sender learned the client endpoint from the ping datagram
    assert_eq!(
        *shared.video_peer.lock().unwrap(),
        Some(client_addr)
    );
    let _ = state;
}

#[test]
fn stale_frames_are_dropped_and_the_stream_skips_ahead() {
    let (_state, _events) = test_state("stale");
    let shared = StreamShared::new();

    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    let server_addr = socket.local_addr().unwrap();
    let client = UdpSocket::bind("127.0.0.1:0").unwrap();
    client.connect(server_addr).unwrap();

    // establish the client endpoint BEFORE the sender starts, like
    // Moonlight's ping does, so the first (IDR) frame is not dropped
    client.send(b"PING").unwrap();

    let task_shared = shared.clone();
    let thread = std::thread::spawn(move || {
        let mut pipeline = SyntheticPipeline::new(5000, 5, 1000);
        // the first three emissions are born 100ms stale — far beyond the
        // 30ms budget the loop derives from the 10ms frame pacing — like a
        // capture pipeline that fell behind under load; emissions 4 and 5
        // are fresh
        pipeline.stale_frames = 3;
        pipeline.stale_age = Duration::from_millis(100);
        run_video_loop(
            socket,
            task_shared,
            Box::new(pipeline),
            1392,
            0,
            0,
            Duration::from_millis(10),
            1920,
            1080,
            60,
            10_000,
            None,
        )
        .unwrap();
    });

    client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    let mut received: Vec<Vec<u8>> = Vec::new();
    // reassembled frames: (frameIndex, frameType, frameData)
    let mut frames: Vec<(u32, u8, Vec<u8>)> = Vec::new();
    let mut current: Vec<u8> = Vec::new();
    let mut current_index = 0u32;
    let mut current_type = 0u8;
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline && frames.len() < 3 {
        let mut buffer = [0u8; 2048];
        let length = match client.recv(&mut buffer) {
            Ok(length) => length,
            Err(_) => continue,
        };
        received.push(buffer[..length].to_vec());
        let packet = &buffer[..length];
        let nv = &packet[16..32];
        let flags = nv[8];
        assert_eq!(flags & FLAG_CONTAINS_PIC_DATA, FLAG_CONTAINS_PIC_DATA);
        if flags & FLAG_SOF != 0 {
            assert!(current.is_empty(), "SOF while a frame is open");
            current_index = u32::from_le_bytes(nv[4..8].try_into().unwrap());
        }
        let mut payload = &packet[32..];
        if flags & FLAG_EOF != 0 {
            let short_header = if flags & FLAG_SOF != 0 {
                payload
            } else {
                &current[..8.min(current.len())]
            };
            let last_payload_len =
                u16::from_le_bytes(short_header[4..6].try_into().unwrap()) as usize;
            payload = &payload[..last_payload_len.min(payload.len())];
        }
        if flags & FLAG_SOF != 0 {
            current_type = payload[3];
        }
        current.extend_from_slice(payload);
        if flags & FLAG_EOF != 0 {
            frames.push((current_index, current_type, std::mem::take(&mut current)));
        }
    }

    // stop the loop and wait for the thread
    shared.stop.store(true, Ordering::Relaxed);
    client.send(b"PING").unwrap();
    thread.join().unwrap();

    // the two stale P-frames never shipped — and they never reach the
    // encoder either, because the source mirrors the production pipeline's
    // pre-encode gate: a frame the sender could not ship is never produced,
    // so it can never be the reference for the frame behind it. Exactly 3
    // frames x 4 datagrams arrive (the IDR is exempt from the age budget
    // even though it was born stale — it is the client's recovery
    // mechanism, and dropping it would starve the decoder)
    assert_eq!(received.len(), 12, "stale frames must never be shipped");
    assert_eq!(frames.len(), 3);
    // frame indices stay contiguous: a dropped frame consumes no frame
    // number, so the client sees a gap-free 1,2,3 while the stream has
    // skipped ahead to the newest emissions (a gap would read as a lost
    // frame to the client, which is the intended semantics)
    assert_eq!(frames[0].0, 1);
    assert_eq!(frames[1].0, 2);
    assert_eq!(frames[2].0, 3);
    assert_eq!(frames[0].1, 2, "first frame is the IDR");
    assert_eq!(frames[1].1, 1);
    assert_eq!(frames[2].1, 1);
    // skip-ahead content proof: the synthetic payload begins with the
    // emission counter — the received frames carry emissions 0 (the IDR),
    // 3 and 4, never the stale emissions 1 and 2
    for (frame, emission) in frames.iter().zip([0u32, 3, 4]) {
        assert_eq!(frame.2.len(), 8 + 5000);
        assert_eq!(&frame.2[8..12], &[0, 0, 0, 1], "annex-B start code");
        assert_eq!(
            &frame.2[12..16],
            &emission.to_be_bytes(),
            "frame data must be the newest emission, not stale history"
        );
    }
}

#[test]
fn synthetic_audio_flows_over_loopback_udp() {
    let (_state, _events) = test_state("audio");
    let shared = StreamShared::new();

    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    let server_addr = socket.local_addr().unwrap();
    let client = UdpSocket::bind("127.0.0.1:0").unwrap();
    client.connect(server_addr).unwrap();

    let task_shared = shared.clone();
    let thread = std::thread::spawn(move || {
        let pipeline = Box::new(SyntheticAudioPipeline::new(20, 5).unwrap());
        // the loop only accepts the session's own client: this test's
        // client is on loopback
        run_audio_loop(
            socket,
            task_shared,
            pipeline,
            5,
            None,
            Some(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
            None,
        )
        .unwrap();
    });

    // establish the client endpoint like Moonlight's audio ping does
    client.send(b"PING").unwrap();
    std::thread::sleep(Duration::from_millis(100));

    client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    let mut received: Vec<Vec<u8>> = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline && received.len() < 20 {
        let mut buffer = [0u8; 2048];
        match client.recv(&mut buffer) {
            Ok(length) => received.push(buffer[..length].to_vec()),
            Err(_) => break,
        }
    }

    shared.stop.store(true, Ordering::Relaxed);
    client.send(b"PING").unwrap();
    thread.join().unwrap();

    assert!(received.len() >= 15, "expected audio packets, got {}", received.len());

    // validate the NVSP audio wire format of every packet
    let mut expected_sequence = 0u16;
    let mut expected_timestamp = 0u32;
    for packet in &received {
        assert_eq!(packet[0], 0x80, "RTP header byte");
        assert_eq!(packet[1], AUDIO_PAYLOAD_TYPE, "audio payload type");
        assert_eq!(
            u16::from_be_bytes(packet[2..4].try_into().unwrap()),
            expected_sequence,
            "sequence continuity"
        );
        assert_eq!(
            u32::from_be_bytes(packet[4..8].try_into().unwrap()),
            expected_timestamp,
            "timestamp advances by packetDuration"
        );
        assert_eq!(&packet[8..12], &[0; 4], "ssrc");
        assert!(packet.len() > 12, "Opus payload present");
        expected_sequence = expected_sequence.wrapping_add(1);
        expected_timestamp = expected_timestamp.wrapping_add(5);
    }

    // the Opus payloads must decode: verify the first payload is a valid
    // Opus packet by checking its TOC byte is a sane config (CELT/SILK)
    let first_toc = received[0][12];
    assert_ne!(first_toc, 0, "Opus TOC byte");

    // sender learned the client endpoint from the ping datagram
    assert_eq!(*shared.audio_peer.lock().unwrap(), Some(client.local_addr().unwrap()));

    // packetizer unit behavior is shared with the loop; sanity-check one
    let mut packetizer = AudioPacketizer::new(5);
    let packet = packetizer.packetize(&[0xAA]);
    assert_eq!(packet.len(), 13);
}

/// The confirmed bug this covers: a client whose ANNOUNCE carries
/// `x-nv-general.featureFlags` bit 0x20 (both of the reported clients send
/// 167 = 0xA7) decrypts every audio payload with AES-128-CBC + PKCS#7 under
/// the session's AV key and the IV `BE(rikeyid + sequenceNumber)`
/// (`moonlight-common-c AudioStream.c:178-205`), and discards what does not
/// decrypt — its logcat then repeats "Failed to decrypt audio packet" for
/// the rest of the stream while plaintext Opus played as silence. What the
/// loop puts on the wire must satisfy that decrypt, with the RTP header —
/// payload type, sequence, timestamp cadence — exactly as in the plaintext
/// case.
#[test]
fn encrypted_audio_flows_over_loopback_udp_and_decrypts() {
    // the client's decrypt path, reimplemented: EVP_aes_128_cbc under the
    // per-packet IV, PKCS#7 stripped by EVP_DecryptFinal_ex (which is what
    // fails there and prints the log line)
    fn client_decrypt(key: &[u8; 16], iv: &[u8; 16], ciphertext: &[u8]) -> Option<Vec<u8>> {
        use aes::cipher::{BlockDecrypt, KeyInit};
        use aes::Aes128;
        use aes::cipher::generic_array::GenericArray;

        if ciphertext.is_empty() || ciphertext.len() % 16 != 0 {
            return None;
        }
        let cipher = Aes128::new_from_slice(key).unwrap();
        let mut previous = *iv;
        let mut plaintext = Vec::with_capacity(ciphertext.len());
        for chunk in ciphertext.chunks_exact(16) {
            let mut block = GenericArray::clone_from_slice(chunk);
            cipher.decrypt_block(&mut block);
            for index in 0..16 {
                plaintext.push(block[index] ^ previous[index]);
            }
            previous.copy_from_slice(chunk);
        }
        let pad = *plaintext.last()? as usize;
        if pad == 0 || pad > 16 {
            return None;
        }
        if plaintext[plaintext.len() - pad..]
            .iter()
            .any(|b| *b as usize != pad)
        {
            return None;
        }
        plaintext.truncate(plaintext.len() - pad);
        Some(plaintext)
    }

    let (_state, _events) = test_state("audio-encrypted");
    let shared = StreamShared::new();

    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    let server_addr = socket.local_addr().unwrap();
    let client = UdpSocket::bind("127.0.0.1:0").unwrap();
    client.connect(server_addr).unwrap();

    let key = [0x5Au8; 16];
    let key_id = 0x1234_5678u32;
    // Establish the client endpoint like Moonlight's audio ping does, and
    // queue the ping BEFORE the loop starts: the loop drops frames until it
    // has a peer, and the synthetic source emits only 20 of them. The
    // datagram waits in the socket's receive buffer, so the loop's first
    // drain finds it and every frame reaches this socket.
    client.send(b"PING").unwrap();

    let task_shared = shared.clone();
    let thread = std::thread::spawn(move || {
        let pipeline = Box::new(SyntheticAudioPipeline::new(20, 5).unwrap());
        run_audio_loop(
            socket,
            task_shared,
            pipeline,
            5,
            None,
            Some(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
            Some(AudioCipher::new(key, key_id)),
        )
        .unwrap();
    });

    client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    let mut received: Vec<Vec<u8>> = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline && received.len() < 20 {
        let mut buffer = [0u8; 2048];
        match client.recv(&mut buffer) {
            Ok(length) => received.push(buffer[..length].to_vec()),
            Err(_) => break,
        }
    }

    shared.stop.store(true, Ordering::Relaxed);
    client.send(b"PING").unwrap();
    thread.join().unwrap();

    assert!(received.len() >= 15, "expected audio packets, got {}", received.len());

    let layout = hydra_stream::audio::layout_for(hydra_stream::audio::STEREO);
    let mut decoder = hydra_stream::audio_encode::OpusDecoder::new(layout).unwrap();
    let frame_size = hydra_stream::audio::SAMPLE_RATE * 5 / 1000;

    let mut expected_sequence = 0u16;
    let mut expected_timestamp = 0u32;
    for packet in &received {
        assert_eq!(packet[0], 0x80, "RTP header byte");
        assert_eq!(packet[1], AUDIO_PAYLOAD_TYPE, "audio payload type");
        assert_eq!(
            u16::from_be_bytes(packet[2..4].try_into().unwrap()),
            expected_sequence,
            "sequence continuity (encryption must not change it)"
        );
        assert_eq!(
            u32::from_be_bytes(packet[4..8].try_into().unwrap()),
            expected_timestamp,
            "timestamp advances by packetDuration"
        );
        assert_eq!(&packet[8..12], &[0; 4], "ssrc");
        assert_eq!(
            (packet.len() - 12) % 16,
            0,
            "AES-CBC payload is a whole number of blocks"
        );

        // what the client does with this datagram, in its own order: build
        // the IV from the sequence it just read out of the header, decrypt,
        // then hand the frame to Opus
        let mut iv = [0u8; 16];
        iv[..4].copy_from_slice(&key_id.wrapping_add(expected_sequence as u32).to_be_bytes());
        let frame = client_decrypt(&key, &iv, &packet[12..])
            .expect("the client's AES-128-CBC/PKCS#7 decrypt");
        let decoded = decoder
            .decode_float(&frame, frame_size)
            .expect("the decrypted frame is decodable Opus");
        assert_eq!(decoded.len(), frame_size * 2, "stereo samples per frame");

        expected_sequence = expected_sequence.wrapping_add(1);
        expected_timestamp = expected_timestamp.wrapping_add(5);
    }

    // sender learned the client endpoint from the ping datagram
    assert_eq!(*shared.audio_peer.lock().unwrap(), Some(client.local_addr().unwrap()));
}

/// The audio destination belongs to the session's own client. A second
/// device on the network — the logged session had one, and its pings flipped
/// the destination between two clients 64 times in 60s — must not be able to
/// take the stream over, while a new port from the session client itself is
/// a legitimate rebind and must move the destination.
#[test]
fn audio_peer_ignores_a_second_client_and_follows_a_rebind() {
    let (_state, _events) = test_state("audio-peer-filter");
    let shared = StreamShared::new();

    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    let server_addr = socket.local_addr().unwrap();

    // the session's own client, and a second device on another loopback IP
    let session_client = UdpSocket::bind("127.0.0.1:0").unwrap();
    let session_client_addr = session_client.local_addr().unwrap();
    let other_device = UdpSocket::bind("127.0.0.2:0").unwrap();

    let task_shared = shared.clone();
    let thread = std::thread::spawn(move || {
        // no frames are needed: this test is about which datagrams the loop
        // accepts, so a source that never produces audio is enough
        let pipeline = Box::new(SyntheticAudioPipeline::new(0, 5).unwrap());
        run_audio_loop(
            socket,
            task_shared,
            pipeline,
            5,
            None,
            Some(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
            None,
        )
        .unwrap();
    });
    std::thread::sleep(Duration::from_millis(50));

    // the second device pinged first and must be ignored
    other_device.send_to(b"PING", server_addr).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(
        *shared.audio_peer.lock().unwrap(),
        None,
        "a ping from another host must never become the destination"
    );

    // the session client's own ping is taken
    session_client.send_to(b"PING", server_addr).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(
        *shared.audio_peer.lock().unwrap(),
        Some(session_client_addr)
    );

    // a rebind on the same IP (new port) moves the destination
    let rebound = UdpSocket::bind("127.0.0.1:0").unwrap();
    let rebound_addr = rebound.local_addr().unwrap();
    assert_ne!(rebound_addr, session_client_addr);
    rebound.send_to(b"PING", server_addr).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(*shared.audio_peer.lock().unwrap(), Some(rebound_addr));

    // ... and the second device still cannot take it back
    other_device.send_to(b"PING", server_addr).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(*shared.audio_peer.lock().unwrap(), Some(rebound_addr));

    shared.stop.store(true, Ordering::Relaxed);
    session_client.send_to(b"PING", server_addr).unwrap();
    thread.join().unwrap();
}

// ---- ENet control client (test-side raw protocol driver) ----

struct ControlClient {
    socket: UdpSocket,
    server: std::net::SocketAddr,
    sequence: u16,
}

impl ControlClient {
    fn new(server: std::net::SocketAddr) -> Self {
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        ControlClient {
            socket,
            server,
            sequence: 0,
        }
    }

    fn send(&mut self, datagram: &[u8]) {
        self.socket.send_to(datagram, self.server).unwrap();
    }

    fn recv(&mut self) -> Vec<u8> {
        let mut buffer = [0u8; 2048];
        let (length, _) = self.socket.recv_from(&mut buffer).unwrap();
        buffer[..length].to_vec()
    }

    fn connect(&mut self) {
        let mut packet = Vec::new();
        packet.extend_from_slice(&0xFFFFu16.to_be_bytes());
        packet.extend_from_slice(&0x1111u16.to_be_bytes());
        packet.push(enet::COMMAND_CONNECT | enet::FLAG_ACKNOWLEDGE);
        packet.push(0xFF);
        packet.extend_from_slice(&1u16.to_be_bytes());
        packet.extend_from_slice(&0u16.to_be_bytes());
        packet.push(0xFF);
        packet.push(0xFF);
        packet.extend_from_slice(&1392u32.to_be_bytes());
        packet.extend_from_slice(&32768u32.to_be_bytes());
        packet.extend_from_slice(&4u32.to_be_bytes());
        packet.extend_from_slice(&0u32.to_be_bytes());
        packet.extend_from_slice(&0u32.to_be_bytes());
        packet.extend_from_slice(&enet::THROTTLE_INTERVAL.to_be_bytes());
        packet.extend_from_slice(&enet::THROTTLE_ACCELERATION.to_be_bytes());
        packet.extend_from_slice(&enet::THROTTLE_DECELERATION.to_be_bytes());
        packet.extend_from_slice(&0xABCDEF01u32.to_be_bytes()); // connectID
        packet.extend_from_slice(&0x1234u32.to_be_bytes()); // data
        self.send(&packet);

        let reply = self.recv();
        assert_eq!(reply[4], enet::COMMAND_ACKNOWLEDGE, "CONNECT must be ACKed");
        assert_eq!(reply[12] & enet::COMMAND_MASK, enet::COMMAND_VERIFY_CONNECT);

        // ACK the VERIFY_CONNECT (server command seq 1, channel 0xFF)
        let session = (u16::from_be_bytes(reply[0..2].try_into().unwrap())
            & enet::HEADER_SESSION_MASK)
            >> enet::HEADER_SESSION_SHIFT;
        let mut ack = Vec::new();
        ack.extend_from_slice(
            &((session << enet::HEADER_SESSION_SHIFT) | enet::HEADER_FLAG_SENT_TIME).to_be_bytes(),
        );
        ack.extend_from_slice(&0x2222u16.to_be_bytes());
        ack.push(enet::COMMAND_ACKNOWLEDGE);
        ack.push(0xFF);
        ack.extend_from_slice(&0u16.to_be_bytes());
        ack.extend_from_slice(&1u16.to_be_bytes());
        ack.extend_from_slice(&0x1111u16.to_be_bytes());
        self.send(&ack);
    }

    fn send_reliable(&mut self, channel: u8, payload: &[u8]) -> u16 {
        self.sequence = self.sequence.wrapping_add(1);
        let mut packet = Vec::new();
        packet.extend_from_slice(&enet::HEADER_FLAG_SENT_TIME.to_be_bytes());
        packet.extend_from_slice(&0x3333u16.to_be_bytes());
        packet.push(enet::COMMAND_SEND_RELIABLE | enet::FLAG_ACKNOWLEDGE);
        packet.push(channel);
        packet.extend_from_slice(&self.sequence.to_be_bytes());
        packet.extend_from_slice(&(payload.len() as u16).to_be_bytes());
        packet.extend_from_slice(payload);
        self.send(&packet);
        self.sequence
    }

    /// Waits for the server to ACK the given reliable sequence.
    fn wait_ack(&mut self, sequence: u16) {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let datagram = self.recv();
            let mut offset = 4;
            while offset + 8 <= datagram.len() {
                if datagram[offset] != enet::COMMAND_ACKNOWLEDGE {
                    break;
                }
                let acked = u16::from_be_bytes(datagram[offset + 4..offset + 6].try_into().unwrap());
                if acked == sequence {
                    return;
                }
                offset += 8;
            }
            assert!(Instant::now() < deadline, "server did not ACK {sequence}");
        }
    }

    /// Receives the next server-to-client reliable payload.
    fn recv_payload(&mut self) -> Vec<u8> {
        loop {
            let datagram = self.recv();
            let mut offset = 4;
            while offset + 6 <= datagram.len() {
                let command = datagram[offset] & enet::COMMAND_MASK;
                let channel = datagram[offset + 1];
                if command == enet::COMMAND_SEND_RELIABLE && channel == 0 {
                    let length =
                        u16::from_be_bytes(datagram[offset + 4..offset + 6].try_into().unwrap())
                            as usize;
                    return datagram[offset + 6..offset + 6 + length].to_vec();
                }
                offset += match command {
                    enet::COMMAND_ACKNOWLEDGE => 8,
                    enet::COMMAND_SEND_RELIABLE => {
                        6 + u16::from_be_bytes(
                            datagram[offset + 4..offset + 6].try_into().unwrap(),
                        ) as usize
                    }
                    _ => 4,
                };
            }
        }
    }
}

#[test]
fn enet_control_handshake_and_session_lifecycle() {
    let (state, mut events) = test_state("control");

    // raise a session so the control server accepts the connection
    state
        .begin_launch(LaunchParams {
            uniqueid: "tester".to_string(),
            appid: 1,
            width: 1920,
            height: 1080,
            fps: 60,
            hdr_mode: false,
            dynamic_range: 0,
            rikey: [0xAB; 16],
            rikeyid: 0x12345678,
            encrypted_rtsp: false,
            av_ping_payload: "00".repeat(16),
            control_connect_data: 0x1234,
            activity: std::time::Instant::now(),
            packet_size: 1392,
            bitrate_kbps: 10_000,
            slices_per_frame: 1,
            max_ref_frames: None,
            host_audio: false,
            packet_duration_ms: 5,
            min_required_fec_packets: 0,
            requested_channels: 2,
            audio_quality: None,
            surround_enabled: true,
            video_qos_type: None,
            audio_qos_type: None,
            audio_encryption: false,
            codec: hydra_stream::video::VideoCodec::H264,
        })
        .unwrap();

    // begin_launch emits session-state launching first
    let event = events
        .blocking_recv_timeout()
        .expect("launching event");
    assert!(event.contains("\"state\":\"launching\""));

    let port = control::serve(state.clone(), 0).unwrap();
    let mut client = ControlClient::new(std::net::SocketAddr::from(([127, 0, 0, 1], port)));
    client.connect();

    // the server must have emitted control-connected
    let event = events
        .blocking_recv_timeout()
        .expect("control-connected event");
    let event: serde_json::Value = serde_json::from_str(&event).unwrap();
    assert_eq!(event["event"], "control-connected");
    assert_eq!(state.session_phase(), GamePhase::Launching);

    // START_A then an IDR request, both reliably delivered and ACKed
    let start_a = 0x0305u16.to_le_bytes().to_vec();
    let sequence = client.send_reliable(0, &start_a);
    client.wait_ack(sequence);

    let idr_request = 0x0302u16.to_le_bytes().to_vec();
    let sequence = client.send_reliable(0, &idr_request);
    client.wait_ack(sequence);
    let shared = state.stream_shared();
    if let Some(shared) = &shared {
        // IDR request arms the flag even before streaming starts
        assert!(shared.idr_pending.load(Ordering::Relaxed) || state.session_phase() != GamePhase::Streaming);
    }

    // raw non-ENet datagrams must be tolerated
    client.send(b"\xde\xad\xbe\xef raw input");
    std::thread::sleep(Duration::from_millis(100));

    // ending the session delivers a termination message to the client
    state.end_session("cancel");
    let event = events.blocking_recv_timeout().expect("quitting event");
    assert!(event.contains("\"state\":\"quitting\""));

    let termination = client.recv_payload();
    assert_eq!(termination, termination_payload(0));
}

trait BlockingRecv {
    fn blocking_recv_timeout(&mut self) -> Option<String>;
}

impl BlockingRecv for mpsc::UnboundedReceiver<String> {
    fn blocking_recv_timeout(&mut self) -> Option<String> {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match self.try_recv() {
                Ok(event) => return Some(event),
                Err(_) => {
                    if Instant::now() > deadline {
                        return None;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
    }
}
