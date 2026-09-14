//! Relaunch regression: a second stream must learn the client endpoint
//! even when the hole-punch arrives in the gap between sessions.
//!
//! The media sockets are bound once for the process (like Sunshine), so
//! the kernel queues the gap punch and the second session's first drain
//! learns the endpoint. With the old per-session binds the punch was lost
//! (nothing bound / dying session consumed it) and every frame was
//! dropped as "video client endpoint unknown".

use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_rustls::{rustls, TlsConnector};

use hydra_stream::certs;
use hydra_stream::crypto;
use hydra_stream::http;
use hydra_stream::nvhttp::{PairedClient, State};
use hydra_stream::rtsp;
use hydra_stream::store::Store;

fn tag<'a>(xml: &'a str, tag: &str) -> &'a str {
    let open = format!("<{tag}>");
    let start = xml.find(&open).map(|index| index + open.len()).unwrap();
    let end = xml[start..].find(&format!("</{tag}>")).unwrap() + start;
    &xml[start..end]
}

fn generate_client_identity() -> certs::Identity {
    let dir = std::env::temp_dir().join(format!(
        "hydra-stream-relaunch-client-{}",
        std::process::id()
    ));
    let store = Store::at(dir).unwrap();
    std::fs::remove_file(store.path("cert.pem")).ok();
    std::fs::remove_file(store.path("key.der")).ok();

    use rcgen::{CertificateParams, DistinguishedName, DnType, KeyPair, PKCS_RSA_SHA256};
    let mut params = CertificateParams::new(vec![]).unwrap();
    let mut name = DistinguishedName::new();
    name.push(DnType::CommonName, "NVIDIA GameStream Client");
    params.distinguished_name = name;

    use rsa::pkcs8::EncodePrivateKey;
    let mut rng = rsa::rand_core::OsRng;
    let private_key = rsa::RsaPrivateKey::new(&mut rng, 2048).unwrap();
    let key_pkcs8_der = private_key.to_pkcs8_der().unwrap().as_bytes().to_vec();
    let key_pair = KeyPair::from_pkcs8_der_and_sign_algo(
        &rustls::pki_types::PrivatePkcs8KeyDer::from(key_pkcs8_der),
        &PKCS_RSA_SHA256,
    )
    .unwrap();
    let cert = params.self_signed(&key_pair).unwrap();
    certs::Identity {
        cert_pem: cert.pem(),
        cert_der: cert.der().to_vec(),
        key_pkcs8_der: key_pair.serialize_der(),
    }
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
            Err(rustls::Error::General("cert mismatch".to_string()))
        }
    }
    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

fn tls_connector(pinned_cert: &[u8]) -> TlsConnector {
    let verifier = PinnedCertVerifier {
        pinned: pinned_cert.to_vec(),
    };
    let config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth();
    TlsConnector::from(Arc::new(config))
}

async fn read_body(stream: &mut (impl tokio::io::AsyncRead + Unpin)) -> String {
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.unwrap();
    String::from_utf8_lossy(&response)
        .split("\r\n\r\n")
        .nth(1)
        .expect("HTTP body")
        .to_string()
}

async fn tls_get(port: u16, target: &str, pinned_cert: &[u8]) -> String {
    let mut tls = tls_connector(pinned_cert)
        .connect(
            rustls::pki_types::ServerName::try_from("localhost").unwrap(),
            TcpStream::connect(("127.0.0.1", port)).await.unwrap(),
        )
        .await
        .unwrap();
    tls.write_all(
        format!("GET {target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").as_bytes(),
    )
    .await
    .unwrap();
    read_body(&mut tls).await
}

async fn spawn_servers(state: Arc<State>) -> (u16, u16, u16) {
    let http_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let http_port = http_listener.local_addr().unwrap().port();
    {
        let state = state.clone();
        tokio::spawn(async move {
            loop {
                let (stream, _) = http_listener.accept().await.unwrap();
                tokio::spawn(http::handle_conn(state.clone(), stream, None));
            }
        });
    }

    let acceptor = http::tls_acceptor(&state).unwrap();
    let https_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let https_port = https_listener.local_addr().unwrap().port();
    {
        let state = state.clone();
        tokio::spawn(async move {
            loop {
                let (stream, _) = https_listener.accept().await.unwrap();
                tokio::spawn(http::handle_conn(state.clone(), stream, Some(acceptor.clone())));
            }
        });
    }

    let rtsp_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let rtsp_port = rtsp_listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let (stream, _) = rtsp_listener.accept().await.unwrap();
            tokio::spawn(rtsp::handle_conn(state.clone(), stream));
        }
    });

    (http_port, https_port, rtsp_port)
}

fn pair_client(state: &State, uniqueid: &str, identity: &certs::Identity) {
    state
        .paired
        .lock()
        .unwrap()
        .insert(uniqueid.to_string(), PairedClient {
            uniqueid: uniqueid.to_string(),
            name: "tester".to_string(),
            cert: identity.cert_pem.clone(),
        });
}

fn launch_query(uniqueid: &str) -> String {
    let rikey = crypto::hex_encode(&crypto::random_bytes(16));
    format!(
        "/launch?uniqueid={uniqueid}&appid=1&mode=1280x720x60&additionalStates=1&sops=0&rikey={rikey}&rikeyid=123456&localAudioPlayMode=0&surroundAudioInfo=196610"
    )
}

fn rtsp_request(cseq: u32, method: &str, target: &str, extra_headers: &str) -> String {
    format!(
        "{method} {target} RTSP/1.0\r\nCSeq: {cseq}\r\nX-GS-ClientVersion: 14\r\nHost: 0.0.0.0{extra_headers}\r\n\r\n"
    )
}

async fn read_until_close(stream: &mut TcpStream) -> Vec<u8> {
    let mut response = Vec::new();
    loop {
        match stream.read_buf(&mut response).await {
            Ok(0) => break,
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => break,
            Err(error) => panic!("read failed: {error}"),
        }
    }
    response
}

async fn rtsp_roundtrip(port: u16, request: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream.write_all(request.as_bytes()).await.unwrap();
    let response = read_until_close(&mut stream).await;
    String::from_utf8_lossy(&response).into_owned()
}

async fn setup(name: &str) -> (Arc<State>, mpsc::UnboundedReceiver<String>, u16, u16, Vec<u8>) {
    let dir = std::env::temp_dir().join(format!("hydra-stream-{name}-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    let store = Store::at(dir).unwrap();
    let (event_tx, event_rx) = mpsc::unbounded_channel::<String>();
    let state = Arc::new(State::with_store(store, event_tx).unwrap());
    let (_http_port, https_port, rtsp_port) = spawn_servers(state.clone()).await;
    let pinned = state.identity.cert_der.clone();
    (state, event_rx, https_port, rtsp_port, pinned)
}

/// Drives OPTIONS + SETUP(video/audio) + PLAY. `punch` is sent right after
/// PLAY from the fake client socket. Returns when video RTP is flowing.
async fn stream_once(
    https_port: u16,
    rtsp_port: u16,
    pinned: &[u8],
    client: &std::net::UdpSocket,
    punch: &[u8],
    video_port: u16,
) {
    let response = tls_get(https_port, &launch_query("tester"), pinned).await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "gamesession"), "1");

    let response = rtsp_roundtrip(
        rtsp_port,
        &rtsp_request(1, "OPTIONS", "rtsp://0.0.0.0:48010", ""),
    )
    .await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");

    let setup = |cseq, target| {
        rtsp_request(
            cseq,
            "SETUP",
            target,
            "\r\nSession: DEADBEEFCAFE\r\nTransport: unicast;X-GS-ClientPort=50000-50001\r\nIf-Modified-Since: Thu, 01 Jan 1970 00:00:00 GMT",
        )
    };
    let response = rtsp_roundtrip(rtsp_port, &setup(2, "streamid=audio/0/0")).await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");
    let response = rtsp_roundtrip(rtsp_port, &setup(3, "streamid=video/0/0")).await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");

    let response = rtsp_roundtrip(
        rtsp_port,
        &rtsp_request(4, "PLAY", "/", "\r\nSession: DEADBEEFCAFE"),
    )
    .await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");

    if !punch.is_empty() {
        client.send_to(punch, ("127.0.0.1", video_port)).unwrap();
    }

    // the fake client must receive video RTP (0x90 header, payload 96)
    let mut buffer = [0u8; 2048];
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        client
            .set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();
        match client.recv_from(&mut buffer) {
            Ok((length, _)) => {
                assert_eq!(buffer[0], 0x90, "RTP video header, got {length} bytes");
                assert_eq!(buffer[1], 96);
                break;
            }
            Err(_) if std::time::Instant::now() < deadline => continue,
            Err(error) => panic!("no video RTP arrived: {error}"),
        }
    }
}

async fn teardown(rtsp_port: u16) {
    let response = rtsp_roundtrip(
        rtsp_port,
        &rtsp_request(9, "TEARDOWN", "/", "\r\nSession: DEADBEEFCAFE"),
    )
    .await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");
}

#[tokio::test]
async fn relaunch_learns_endpoint_from_gap_punch() {
    // media port overrides must be set before the first config::ports()
    // call (the process-wide OnceLock)
    std::env::set_var("HYDRA_STREAM_VIDEO_PORT", "48398");
    std::env::set_var("HYDRA_STREAM_AUDIO_PORT", "48399");
    std::env::set_var("HYDRA_STREAM_CONTROL_PORT", "48397");

    let (_state, _events, https_port, rtsp_port, pinned) = setup("relaunch").await;
    let client = generate_client_identity();
    pair_client(&_state, "tester", &client);

    let media = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
    let punch = [0xABu8; 16];

    // session 1: ordinary stream, endpoint learned from the punch
    stream_once(https_port, rtsp_port, &pinned, &media, &punch, 48398).await;
    teardown(rtsp_port).await;

    // wait for the video loop of session 1 to exit (one acquire timeout)
    tokio::time::sleep(Duration::from_millis(700)).await;

    // the gap punch: sent AFTER session 1 ended and BEFORE session 2's
    // PLAY binds a reader. With persistent media sockets the kernel
    // queues it; with the old per-session binds it was lost.
    for _ in 0..3 {
        media.send_to(&punch, ("127.0.0.1", 48398)).unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // session 2: NO punch after PLAY — the queued gap punch must seed it
    stream_once(https_port, rtsp_port, &pinned, &media, &[], 48398).await;
    teardown(rtsp_port).await;
}
