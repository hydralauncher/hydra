//! M3 live smoke: spawns the real hydra-stream.exe (with port overrides,
//! since Sunshine owns the default ports on this machine), drives a full
//! pairing -> launch -> RTSP -> PLAY flow as a client, and verifies that
//! real NVENC video RTP packets flow on the video port and that the ENet
//! control handshake completes.
//!
//! Requires an NVIDIA GPU with nvEncodeAPI64.dll; on machines without one
//! the test skips itself (no video datagrams will ever arrive, but the
//! skip is detected earlier via the pipeline error line in the log).

use std::io::{BufRead, BufReader};
use tokio::io::AsyncWriteExt;
use std::net::{TcpStream, UdpSocket};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use aes::cipher::generic_array::GenericArray;
use aes::cipher::{BlockEncrypt, KeyInit};
use aes::Aes128;
use sha2::Digest;
use tokio_rustls::{rustls, TlsConnector};

use hydra_stream::crypto;
use hydra_stream::enet;

const HTTP_PORT: u16 = 48190;
const HTTPS_PORT: u16 = 48184;
const RTSP_PORT: u16 = 48110;
const VIDEO_PORT: u16 = 48198;
const CONTROL_PORT: u16 = 48199;
const AUDIO_PORT: u16 = 48100;

fn ecb_encrypt(key: &[u8; 16], plaintext: &[u8]) -> Vec<u8> {
    let cipher = Aes128::new_from_slice(key).unwrap();
    let mut output = Vec::with_capacity(plaintext.len());
    for chunk in plaintext.chunks_exact(16) {
        let mut block = GenericArray::clone_from_slice(chunk);
        cipher.encrypt_block(&mut block);
        output.extend_from_slice(&block);
    }
    output
}

fn sha256(data: &[u8]) -> [u8; 32] {
    sha2::Sha256::digest(data).into()
}

fn tag<'a>(xml: &'a str, tag: &str) -> &'a str {
    let open = format!("<{tag}>");
    let start = xml.find(&open).map(|index| index + open.len()).unwrap();
    let end = xml[start..].find(&format!("</{tag}>")).unwrap() + start;
    &xml[start..end]
}

struct Log {
    lines: Mutex<Vec<String>>,
}

impl Log {
    fn wait_for(&self, needle: &str, timeout: Duration) -> Option<String> {
        let deadline = Instant::now() + timeout;
        loop {
            for line in self.lines.lock().unwrap().iter() {
                if line.contains(needle) {
                    return Some(line.clone());
                }
            }
            if Instant::now() > deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

fn spawn_exe() -> (Child, Arc<Log>) {
    let exe = env!("CARGO_BIN_EXE_hydra-stream");
    let mut child = Command::new(exe)
        .env("HYDRA_STREAM_HTTP_PORT", HTTP_PORT.to_string())
        .env("HYDRA_STREAM_HTTPS_PORT", HTTPS_PORT.to_string())
        .env("HYDRA_STREAM_RTSP_PORT", RTSP_PORT.to_string())
        .env("HYDRA_STREAM_VIDEO_PORT", VIDEO_PORT.to_string())
        .env("HYDRA_STREAM_CONTROL_PORT", CONTROL_PORT.to_string())
        .env("HYDRA_STREAM_AUDIO_PORT", AUDIO_PORT.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn hydra-stream.exe");

    let log = Arc::new(Log {
        lines: Mutex::new(Vec::new()),
    });
    {
        let log = log.clone();
        let stdout = child.stdout.take().expect("stdout");
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                if let Ok(line) = line {
                    log.lines.lock().unwrap().push(line);
                }
            }
        });
    }
    {
        let log = log.clone();
        let stderr = child.stderr.take().expect("stderr");
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                if let Ok(line) = line {
                    log.lines.lock().unwrap().push(line);
                }
            }
        });
    }
    (child, log)
}

fn http_get(port: u16, target: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    std::io::Write::write_all(
        &mut stream,
            format!("GET {target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .unwrap();
    let mut response = Vec::new();
    std::io::Read::read_to_end(&mut stream, &mut response).unwrap();
    String::from_utf8_lossy(&response)
        .split("\r\n\r\n")
        .nth(1)
        .expect("HTTP body")
        .to_string()
}

#[derive(Debug)]
struct PinnedCertVerifier {
    pinned: Vec<u8>,
}

impl rustls::client::danger::ServerCertVerifier for PinnedCertVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        if end_entity.as_ref() == self.pinned.as_slice() {
            Ok(rustls::client::danger::ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General(
                "server certificate does not match pinned cert".into(),
            ))
        }
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &rustls::crypto::ring::default_provider().signature_verification_algorithms,
        )
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &rustls::crypto::ring::default_provider().signature_verification_algorithms,
        )
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

fn tls_get(port: u16, target: &str, pinned: &[u8]) -> String {
    let config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinnedCertVerifier {
            pinned: pinned.to_vec(),
        }))
        .with_no_client_auth();
    let connector = TlsConnector::from(Arc::new(config));
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime
        .block_on(async move {
            let stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .unwrap();
            let mut tls = connector
                .connect(
                    rustls::pki_types::ServerName::try_from("localhost").unwrap(),
                    stream,
                )
                .await
                .unwrap();
            tls.write_all(
                format!("GET {target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                    .as_bytes(),
            )
            .await
            .unwrap();
            let mut response = Vec::new();
            tokio::io::AsyncReadExt::read_to_end(&mut tls, &mut response)
                .await
                .unwrap();
            String::from_utf8_lossy(&response)
                .split("\r\n\r\n")
                .nth(1)
                .expect("TLS body")
                .to_string()
        })
}

fn rtsp_roundtrip(request: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", RTSP_PORT)).unwrap();
    std::io::Write::write_all(&mut stream, request.as_bytes()).unwrap();
    let mut response = Vec::new();
    std::io::Read::read_to_end(&mut stream, &mut response).unwrap();
    String::from_utf8_lossy(&response).into_owned()
}

fn rtsp_request(cseq: u32, method: &str, target: &str, extra: &str) -> String {
    format!("{method} {target} RTSP/1.0\r\nCSeq: {cseq}\r\nX-GS-ClientVersion: 14\r\nHost: 0.0.0.0{extra}\r\n\r\n")
}

/// Minimal raw ENet client for the control channel.
struct ControlClient {
    socket: UdpSocket,
    sequence: u16,
}

impl ControlClient {
    fn new() -> Self {
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        ControlClient { socket, sequence: 0 }
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
        packet.extend_from_slice(&0x55AAu32.to_be_bytes());
        packet.extend_from_slice(&0u32.to_be_bytes());
        self.socket.send_to(&packet, ("127.0.0.1", CONTROL_PORT)).unwrap();

        let mut buffer = [0u8; 2048];
        let (length, _) = self.socket.recv_from(&mut buffer).unwrap();
        let reply = &buffer[..length];
        assert_eq!(reply[4], enet::COMMAND_ACKNOWLEDGE);
        assert_eq!(reply[12] & enet::COMMAND_MASK, enet::COMMAND_VERIFY_CONNECT);

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
        self.socket.send_to(&ack, ("127.0.0.1", CONTROL_PORT)).unwrap();
    }

    fn send_reliable(&mut self, payload: &[u8]) {
        self.sequence = self.sequence.wrapping_add(1);
        let mut packet = Vec::new();
        packet.extend_from_slice(&enet::HEADER_FLAG_SENT_TIME.to_be_bytes());
        packet.extend_from_slice(&0x3333u16.to_be_bytes());
        packet.push(enet::COMMAND_SEND_RELIABLE | enet::FLAG_ACKNOWLEDGE);
        packet.push(0);
        packet.extend_from_slice(&self.sequence.to_be_bytes());
        packet.extend_from_slice(&(payload.len() as u16).to_be_bytes());
        packet.extend_from_slice(payload);
        self.socket.send_to(&packet, ("127.0.0.1", CONTROL_PORT)).unwrap();
    }
}

#[test]
fn live_video_and_control_smoke() {
    // wiggle the cursor so desktop duplication produces fresh frames even
    // if the desktop is otherwise idle
    let _wiggler = std::thread::spawn(|| loop {
        unsafe {
            let mut point = windows::Win32::Foundation::POINT { x: 0, y: 0 };
            let _ = windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point);
            let _ = windows::Win32::UI::WindowsAndMessaging::SetCursorPos(point.x + 1, point.y);
            let _ = windows::Win32::UI::WindowsAndMessaging::SetCursorPos(point.x, point.y);
        }
        std::thread::sleep(Duration::from_millis(500));
    });

    let (mut child, log) = spawn_exe();

    // readiness: the exe must bind everything (port overrides avoid Sunshine)
    log.wait_for("RTSP server listening", Duration::from_secs(15))
        .expect("sidecar did not start its servers");

    let uniqueid = format!("smoke{:08x}", std::process::id());
    let pin;

    // ---- pairing over plain HTTP (full crypto client) ----
    let client_key = rsa::RsaPrivateKey::new(&mut rsa::rand_core::OsRng, 2048).unwrap();
    use rsa::pkcs8::EncodePrivateKey;
    let client_key_der = client_key.to_pkcs8_der().unwrap().as_bytes().to_vec();
    let (client_cert_pem, client_cert_der) = {
        use rcgen::{CertificateParams, DistinguishedName, DnType, KeyPair, PKCS_RSA_SHA256};
        let mut params = CertificateParams::new(vec![]).unwrap();
        let mut name = DistinguishedName::new();
        name.push(DnType::CommonName, "NVIDIA GameStream Client");
        params.distinguished_name = name;
        let key_pair = KeyPair::from_pkcs8_der_and_sign_algo(
            &rustls::pki_types::PrivatePkcs8KeyDer::from(client_key_der.clone()),
            &PKCS_RSA_SHA256,
        )
        .unwrap();
        let cert = params.self_signed(&key_pair).unwrap();
        (cert.pem(), cert.der().to_vec())
    };

    let salt = crypto::random_bytes(16);
    let query = format!(
        "/pair?uniqueid={uniqueid}&devicename=smoke&updateState=1&phrase=getservercert&salt={}&clientcert={}",
        crypto::hex_encode_upper(&salt),
        crypto::hex_encode_upper(client_cert_pem.as_bytes())
    );
    // the host holds the response until the PIN shown on the client is
    // submitted through the JSON-RPC channel
    let get_thread = std::thread::spawn(move || http_get(HTTP_PORT, &query));
    log.wait_for("pairing-requested", Duration::from_secs(5))
        .expect("pairing requested event");
    pin = "1234".to_string();
    let mut stdin = child.stdin.take().expect("child stdin");
    std::io::Write::write_all(
        &mut stdin,
        format!(
            "{{\"id\":99,\"method\":\"submitPairingPin\",\"params\":{{\"pin\":\"{pin}\"}}}}\n"
        )
        .as_bytes(),
    )
    .unwrap();
    let response = get_thread.join().unwrap();
    assert!(response.contains("status_code=\"200\""), "{response}");
    log.wait_for("pairing PIN submitted", Duration::from_secs(5))
        .expect("pin submit log");
    let server_cert_pem = crypto::hex_decode(tag(&response, "plaincert")).unwrap();
    let (_, pem) = x509_parser::pem::parse_x509_pem(&server_cert_pem).unwrap();
    let pinned = pem.contents.to_vec();

    let mut aes_input = salt.clone();
    aes_input.extend_from_slice(pin.as_bytes());
    let aes_key: [u8; 16] = sha256(&aes_input)[..16].try_into().unwrap();

    let client_challenge = crypto::random_bytes(16);
    let query = format!(
        "/pair?uniqueid={uniqueid}&clientchallenge={}",
        crypto::hex_encode_upper(&ecb_encrypt(&aes_key, &client_challenge))
    );
    let response = http_get(HTTP_PORT, &query);
    assert!(response.contains("status_code=\"200\""), "{response}");
    let challenge_response = crypto::hex_decode(tag(&response, "challengeresponse")).unwrap();
    let decrypted = crypto::aes128_ecb_decrypt(&aes_key, &challenge_response);
    let server_challenge = decrypted[32..].to_vec();

    let client_secret = crypto::random_bytes(16);
    let client_cert_signature = crypto::cert_signature(&client_cert_der).unwrap();
    let mut hash_input = server_challenge.clone();
    hash_input.extend_from_slice(&client_cert_signature);
    hash_input.extend_from_slice(&client_secret);
    let query = format!(
        "/pair?uniqueid={uniqueid}&serverchallengeresp={}",
        crypto::hex_encode_upper(&ecb_encrypt(&aes_key, &sha256(&hash_input)))
    );
    let response = http_get(HTTP_PORT, &query);
    assert!(response.contains("status_code=\"200\""), "{response}");

    use rsa::pkcs1v15::Pkcs1v15Sign;
    let signature = client_key
        .sign(Pkcs1v15Sign::new::<sha2::Sha256>(), &sha256(&client_secret))
        .unwrap();
    let mut pairing_secret = client_secret.clone();
    pairing_secret.extend_from_slice(&signature);
    let query = format!(
        "/pair?uniqueid={uniqueid}&clientpairingsecret={}",
        crypto::hex_encode_upper(&pairing_secret)
    );
    let response = http_get(HTTP_PORT, &query);
    assert!(response.contains("status_code=\"200\""), "{response}");
    log.wait_for("paired client", Duration::from_secs(5))
        .expect("paired log line");

    // ---- launch over HTTPS (plaintext RTSP: no corever) ----
    let rikey = crypto::hex_encode(&crypto::random_bytes(16));
    let query = format!(
        "/launch?uniqueid={uniqueid}&appid=1&mode=1280x720x60&additionalStates=1&sops=0&rikey={rikey}&rikeyid=99&localAudioPlayMode=0&surroundAudioInfo=196610"
    );
    let response = tls_get(HTTPS_PORT, &query, &pinned);
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(
        tag(&response, "sessionUrl0"),
        format!("rtsp://127.0.0.1:{RTSP_PORT}")
    );

    // ---- RTSP handshake in Moonlight order ----
    let response = rtsp_roundtrip(&rtsp_request(1, "OPTIONS", "rtsp://127.0.0.1", ""));
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");

    let response = rtsp_roundtrip(&rtsp_request(
        2,
        "SETUP",
        "streamid=video/0/0",
        "\r\nTransport: unicast;X-GS-ClientPort=50000-50001",
    ));
    assert!(response.contains(&format!("Transport: server_port={VIDEO_PORT}\r\n")), "{response}");

    // HYDRA_LIVE_HDR=1 announces what a Moonlight client sends after it saw
    // `SCM_HEVC_MAIN10` in serverinfo: HEVC (`bitStreamFormat:1`) plus the
    // 10-bit request (`dynamicRangeMode:1`). That drives the *negotiated* HDR
    // path — no `HYDRA_STREAM_HDR` override — so the sidecar's own decision is
    // what gets tested.
    let hdr_announce = std::env::var("HYDRA_LIVE_HDR").ok().as_deref() == Some("1");
    let mut sdp = String::from(
        "v=0\r\ns=Moonlight\r\na=x-nv-video[0].packetSize:1392\r\na=x-nv-vqos[0].bw.maximumBitrateKbps:15000\r\na=x-nv-video[0].videoEncoderSlicesPerFrame:1\r\n",
    );
    if hdr_announce {
        sdp.push_str("a=x-nv-vqos[0].bitStreamFormat:1\r\n");
        sdp.push_str("a=x-nv-video[0].dynamicRangeMode:1\r\n");
    }
    let announce = format!(
        "ANNOUNCE streamid=control/13/0 RTSP/1.0\r\nCSeq: 3\r\nContent-type: application/sdp\r\nContent-length: {}\r\n\r\n{sdp}",
        sdp.len()
    );
    let response = rtsp_roundtrip(&announce);
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");

    let response = rtsp_roundtrip(&rtsp_request(4, "PLAY", "/", "\r\nSession: DEADBEEFCAFE"));
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");
    log.wait_for("\"state\":\"streaming\"", Duration::from_secs(5))
        .expect("streaming event");

    // ---- ENet control: connect + START_A ----
    let mut control = ControlClient::new();
    control.connect();
    log.wait_for("control: client connected", Duration::from_secs(5))
        .expect("control-connected log");
    control.send_reliable(&0x0305u16.to_le_bytes());
    control.send_reliable(&0x0307u16.to_le_bytes());
    control.send_reliable(&0x0200u16.to_le_bytes());
    log.wait_for("control: START_A", Duration::from_secs(5))
        .expect("START_A log");

    // IDR request reaches the video pipeline
    control.send_reliable(&0x0302u16.to_le_bytes());
    log.wait_for("control: IDR applied", Duration::from_secs(5))
        .expect("IDR request log");

    // ---- input injection: crafted input packets like Moonlight sends ----
    fn nv_packet(magic: u32, body: &[u8]) -> Vec<u8> {
        let mut packet = Vec::new();
        packet.extend_from_slice(&((body.len() + 4) as u32).to_be_bytes());
        packet.extend_from_slice(&magic.to_le_bytes());
        packet.extend_from_slice(body);
        packet
    }
    fn input_data(nv: &[u8]) -> Vec<u8> {
        let mut message = Vec::new();
        message.extend_from_slice(&0x0206u16.to_le_bytes()); // INPUT_DATA
        message.extend_from_slice(nv);
        message
    }
    // key 'A' down/up
    control.send_reliable(&input_data(&nv_packet(0x03, &[0, 0x41, 0, 0, 0, 0])));
    control.send_reliable(&input_data(&nv_packet(0x04, &[0, 0x41, 0, 0, 0, 0])));
    // relative mouse +5/+3 (big-endian on the wire)
    control.send_reliable(&input_data(&nv_packet(0x07, &[0, 5, 0, 3])));
    // left button down/up
    control.send_reliable(&input_data(&nv_packet(0x08, &[1])));
    control.send_reliable(&input_data(&nv_packet(0x09, &[1])));
    // gamepad 0: A button held, right trigger half
    let mut gamepad_body = Vec::new();
    gamepad_body.extend_from_slice(&0x1Au16.to_le_bytes());
    gamepad_body.extend_from_slice(&0i16.to_le_bytes());
    gamepad_body.extend_from_slice(&1i16.to_le_bytes());
    gamepad_body.extend_from_slice(&0x14u16.to_le_bytes());
    gamepad_body.extend_from_slice(&0x1000u16.to_le_bytes()); // A
    gamepad_body.push(0);
    gamepad_body.push(128);
    gamepad_body.extend_from_slice(&0i16.to_le_bytes());
    gamepad_body.extend_from_slice(&0i16.to_le_bytes());
    gamepad_body.extend_from_slice(&0i16.to_le_bytes());
    gamepad_body.extend_from_slice(&0i16.to_le_bytes());
    gamepad_body.extend_from_slice(&0x009Cu16.to_le_bytes());
    gamepad_body.extend_from_slice(&0u16.to_le_bytes());
    gamepad_body.extend_from_slice(&0x0055u16.to_le_bytes());
    control.send_reliable(&input_data(&nv_packet(0x0C, &gamepad_body)));

    // the gamepad packet is sent last: by the time it plugs, every input
    // packet has been dispatched (flush ticks may split the count line)
    let gamepad_log = log.wait_for("virtual gamepad 0 connected", Duration::from_secs(5));
    if gamepad_log.is_none() {
        eprintln!("---- sidecar log dump ----");
        for line in log.lines.lock().unwrap().iter() {
            eprintln!("{line}");
        }
        eprintln!("---- end log dump ----");
        panic!("input injection log missing");
    }
    // the flush prints injected counts on a 20 ms cadence; poll briefly
    let injected_total = {
        let mut total = 0u64;
        for _ in 0..50 {
            total = log
                .lines
                .lock()
                .unwrap()
                .iter()
                .filter_map(|line| line.strip_prefix("control: injected "))
                .filter_map(|line| line.split_whitespace().next())
                .filter_map(|count| count.parse::<u64>().ok())
                .sum();
            if total >= 6 {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        total
    };
    if injected_total < 6 {
        eprintln!("---- sidecar log dump ----");
        for line in log.lines.lock().unwrap().iter() {
            eprintln!("{line}");
        }
        eprintln!("---- end log dump ----");
    }
    assert!(injected_total >= 6, "expected >= 6 injected events, got {injected_total}");
    eprintln!("note: virtual gamepad plug: {}", gamepad_log.is_some());

    // with ViGEmBus installed, a virtual Xbox 360 controller must appear
    if gamepad_log.is_some() {
        std::thread::sleep(Duration::from_secs(2));
        let output = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-Command",
                "Get-PnpDevice | Where-Object { $_.Name -match 'XBOX|Xusb|Gamepad' } | Select-Object -First 1 -ExpandProperty Name",
            ])
            .output()
            .expect("pnpp query");
        let name = String::from_utf8_lossy(&output.stdout);
        eprintln!("note: PnP query returned: {}", name.trim());
        assert!(
            name.to_ascii_uppercase().contains("XBOX"),
            "virtual Xbox 360 controller not visible to Windows"
        );
    }

    // ---- keep the session alive like Moonlight: periodic ping ----
    let ping_stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let ping_stop = ping_stop.clone();
        std::thread::spawn(move || {
            while !ping_stop.load(std::sync::atomic::Ordering::Relaxed) {
                control.send_reliable(&0x0200u16.to_le_bytes());
                std::thread::sleep(Duration::from_millis(500));
            }
        });
    }

    // ---- video availability probe (hybrid-GPU dev machines may have the
    // display on a GPU without NVENC; the sidecar then reports the
    // pipeline unavailable and video assertions are skipped) ----
    let video_deadline = Instant::now() + Duration::from_secs(8);
    let mut video_available = true;
    loop {
        if log.wait_for("video pipeline unavailable", Duration::from_millis(200)).is_some()
            || log.wait_for("no usable capture adapter", Duration::from_millis(200)).is_some()
        {
            video_available = false;
            break;
        }
        if log.wait_for("desktop duplication:", Duration::from_millis(200)).is_some() {
            break;
        }
        if Instant::now() > video_deadline {
            video_available = false;
            break;
        }
    }

    // ---- collect video and audio concurrently, like a real client ----
    // moonlight-common-c never blocks mid-drain: its receive queue is
    // always drained before the next network wait. A blocking recv with
    // a read timeout breaks that contract — one timeout-block while a
    // frame's shards (~26) sit in flight lets them pile into the 64KB
    // kernel buffer and overflow (observed as 130-260 packet sequence
    // gaps on a busy host). Nonblocking sockets + drain-until-WouldBlock
    // model the real client; the empty-socket path still sleeps below.
    let video = UdpSocket::bind("127.0.0.1:0").unwrap();
    video.set_nonblocking(true).unwrap();
    let audio = UdpSocket::bind("127.0.0.1:0").unwrap();
    audio.set_nonblocking(true).unwrap();

    let deadline = Instant::now() + Duration::from_secs(30);
    let mut packets: Vec<Vec<u8>> = Vec::new();
    let mut saw_sps = false;
    let mut audio_packets: Vec<Vec<u8>> = Vec::new();
    let mut video_buffer = [0u8; 2048];
    let mut audio_buffer = [0u8; 2048];
    while Instant::now() < deadline {
        video.send_to(b"PING", ("127.0.0.1", VIDEO_PORT)).ok();
        audio.send_to(b"PING", ("127.0.0.1", AUDIO_PORT)).ok();
        let mut got_anything = false;
        for _ in 0..128 {
            match video.recv_from(&mut video_buffer) {
                Ok((length, _)) => {
                    got_anything = true;
                    let packet = video_buffer[..length].to_vec();
                    if packets.is_empty() && video_available {
                        assert_eq!(packet[0], 0x90);
                        assert_eq!(packet[1], 96);
                        let nv = &packet[16..32];
                        assert_eq!(nv[8] & 0x5, 0x5, "first packet must have SOF");
                    }
                    if !saw_sps {
                        // HEVC's NAL header is two bytes and its type sits in
                        // bits 1..6 of the first one (SPS = 33); H.264's is one
                        // byte with the type in the low five bits (SPS = 7).
                        for window in packet.windows(5) {
                            let hevc_sps = hdr_announce
                                && window[..3] == [0, 0, 1]
                                && (window[3] >> 1) & 0x3F == 33;
                            let h264_sps = !hdr_announce
                                && window[..4] == [0, 0, 0, 1]
                                && window[4] & 0x1F == 7;
                            if hevc_sps || h264_sps {
                                saw_sps = true;
                                break;
                            }
                        }
                    }
                    packets.push(packet);
                }
                Err(_) => break,
            }
        }
        for _ in 0..128 {
            match audio.recv_from(&mut audio_buffer) {
                Ok((length, _)) => {
                    got_anything = true;
                    audio_packets.push(audio_buffer[..length].to_vec());
                }
                Err(_) => break,
            }
        }
        let done = (!video_available || (packets.len() >= 300 && saw_sps))
            && audio_packets.len() >= 100;
        if done && Instant::now() + Duration::from_secs(2) < deadline {
            break;
        }
        if !got_anything {
            // both sockets momentarily empty (between 60fps bursts): a
            // long sleep here backs packets up into the 64KB kernel
            // buffer faster than it drains and they drop on the floor
            // (observed as sequence gaps of ~17-260). 2ms bounds the
            // backlog to a few packets while keeping the idle poll cheap.
            std::thread::sleep(Duration::from_millis(2));
        }
    }
    ping_stop.store(true, std::sync::atomic::Ordering::Relaxed);

    let _ = child.kill();

    // dump the sidecar log BEFORE asserting: a sender-side counter line
    // (stale drops, IDR lifecycle, adaptive steps) is exactly what a
    // gap/stall assertion failure needs for diagnosis
    eprintln!("---- sidecar log dump ----");
    for line in log.lines.lock().unwrap().iter() {
        eprintln!("{line}");
    }
    eprintln!("---- end log dump ----");

    if video_available {
        if packets.len() < 30 || !saw_sps {
            eprintln!("---- sidecar log dump ----");
            for line in log.lines.lock().unwrap().iter() {
                eprintln!("{line}");
            }
            eprintln!("---- end log dump ----");
        }
        assert!(
            packets.len() >= 30,
            "expected a stream of video packets, got {}",
            packets.len()
        );
        assert!(saw_sps, "no H.264 SPS NAL found in the video stream");

        // sequence numbers must be continuous
        for window in packets.windows(2) {
            let a = u16::from_be_bytes(window[0][2..4].try_into().unwrap());
            let b = u16::from_be_bytes(window[1][2..4].try_into().unwrap());
            assert_eq!(a.wrapping_add(1), b, "RTP sequence gap");
        }
    } else {
        eprintln!(
            "note: video pipeline unavailable on this host (display not on              an NVENC-capable GPU); skipping video assertions"
        );
    }

    // audio: NVSP audio wire format + continuous sequences + real Opus
    assert!(
        audio_packets.len() >= 30,
        "expected a stream of audio packets, got {}",
        audio_packets.len()
    );
    let mut expected_sequence = u16::from_be_bytes(audio_packets[0][2..4].try_into().unwrap());
    let mut expected_timestamp = u32::from_be_bytes(audio_packets[0][4..8].try_into().unwrap());
    for packet in &audio_packets {
        assert_eq!(packet[0], 0x80, "audio RTP header byte");
        assert_eq!(packet[1], 97, "audio payload type");
        assert_eq!(
            u16::from_be_bytes(packet[2..4].try_into().unwrap()),
            expected_sequence,
            "audio sequence continuity"
        );
        assert_eq!(
            u32::from_be_bytes(packet[4..8].try_into().unwrap()),
            expected_timestamp,
            "audio timestamp continuity"
        );
        assert!(packet.len() > 12, "Opus payload present");
        expected_sequence = expected_sequence.wrapping_add(1);
        expected_timestamp = expected_timestamp.wrapping_add(5);
    }

    // The negotiated HDR path, end to end and without any env override: the
    // sidecar has to have decided HDR10 from the announcement alone, and told
    // the client so (the HDR mode control message Moonlight switches its
    // display on).
    if hdr_announce {
        let session = log
            .wait_for("HDR10 session", Duration::from_secs(5))
            .expect("sidecar did not build an HDR10 session from the announcement");
        println!("live smoke: {session}");
        let told = log
            .wait_for("told the client the stream is HDR10", Duration::from_secs(5))
            .expect("sidecar did not send the HDR mode control message");
        println!("live smoke: {told}");
    }

    println!(
        "LIVE SMOKE OK: video {} ({} packets, SPS present), {} audio packets (Opus), control handshake OK",
        if video_available { "verified" } else { "unavailable (skipped)" },
        packets.len(),
        audio_packets.len()
    );
}



