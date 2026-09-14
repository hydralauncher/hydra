use std::sync::Arc;

use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_128_GCM};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_rustls::{rustls, TlsConnector};

use hydra_stream::capture::recovery_capability;
use hydra_stream::certs;
use hydra_stream::crypto;
use hydra_stream::http;
use hydra_stream::nvhttp::{GamePhase, PairedClient, State};
use hydra_stream::rtsp;
use hydra_stream::store::Store;

const ENCRYPTED_BIT: u32 = 0x8000_0000;

fn tag<'a>(xml: &'a str, tag: &str) -> &'a str {
    let open = format!("<{tag}>");
    let start = xml.find(&open).map(|index| index + open.len()).unwrap();
    let end = xml[start..].find(&format!("</{tag}>")).unwrap() + start;
    &xml[start..end]
}

fn generate_client_identity() -> certs::Identity {
    let dir = std::env::temp_dir().join(format!("hydra-stream-session-client-{}", std::process::id()));
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

async fn read_body(stream: &mut (impl tokio::io::AsyncRead + Unpin)) -> String {
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.unwrap();
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

fn tls_connector(pinned_cert: &[u8], client: Option<&certs::Identity>) -> TlsConnector {
    let verifier = PinnedCertVerifier {
        pinned: pinned_cert.to_vec(),
    };
    let builder = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier));
    let config = match client {
        Some(identity) => builder
            .with_client_auth_cert(
                vec![identity.cert_der.clone().into()],
                rustls::pki_types::PrivateKeyDer::Pkcs8(identity.key_pkcs8_der.clone().into()),
            )
            .expect("client auth config"),
        None => builder.with_no_client_auth(),
    };
    TlsConnector::from(Arc::new(config))
}

async fn tls_get(port: u16, target: &str, pinned_cert: &[u8]) -> String {
    let mut tls = tls_connector(pinned_cert, None)
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

async fn tls_get_as_client(
    port: u16,
    target: &str,
    pinned_cert: &[u8],
    client: &certs::Identity,
) -> String {
    let mut tls = tls_connector(pinned_cert, Some(client))
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
                tokio::spawn(http::handle_conn(
                    state.clone(),
                    stream,
                    Some(acceptor.clone()),
                ));
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

async fn setup(name: &str) -> (Arc<State>, mpsc::UnboundedReceiver<String>, u16, u16, u16, Vec<u8>) {
    let dir = std::env::temp_dir().join(format!("hydra-stream-{name}-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    let store = Store::at(dir).unwrap();
    let (event_tx, event_rx) = mpsc::unbounded_channel::<String>();
    let state = Arc::new(State::with_store(store, event_tx).unwrap());
    let (http_port, https_port, rtsp_port) = spawn_servers(state.clone()).await;
    let pinned = state.identity.cert_der.clone();
    (state, event_rx, http_port, https_port, rtsp_port, pinned)
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

fn launch_query(uniqueid: &str, extra: &str) -> String {
    let rikey = crypto::hex_encode(&crypto::random_bytes(16));
    format!(
        "/launch?uniqueid={uniqueid}&appid=1&mode=1920x1080x60&additionalStates=1&sops=0&rikey={rikey}&rikeyid=123456&localAudioPlayMode=0&surroundAudioInfo=196610{extra}"
    )
}

async fn rtsp_roundtrip(port: u16, request: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream.write_all(request.as_bytes()).await.unwrap();
    let response = read_until_close(&mut stream).await;
    String::from_utf8_lossy(&response).into_owned()
}

/// Reads until the server closes. Windows resets the connection when the
/// server drops it with unread request data pending (the no-session RTSP
/// case), which surfaces as ConnectionReset instead of a clean EOF.
async fn read_until_close(stream: &mut TcpStream) -> Vec<u8> {
    let mut response = Vec::new();
    loop {
        let mut chunk = [0u8; 1024];
        match stream.read(&mut chunk).await {
            Ok(0) => break,
            Ok(read) => response.extend_from_slice(&chunk[..read]),
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => break,
            Err(error) => panic!("read failed: {error}"),
        }
    }
    response
}

fn rtsp_nonce(sequence: u32, suffix: [u8; 2]) -> Nonce {
    let mut bytes = [0u8; 12];
    bytes[..4].copy_from_slice(&sequence.to_le_bytes());
    bytes[10] = suffix[0];
    bytes[11] = suffix[1];
    Nonce::assume_unique_for_key(bytes)
}

/// Seals an RTSP message the way moonlight-common-c does for rtspenc://.
fn seal(rikey: &[u8; 16], sequence: u32, plaintext: &[u8]) -> Vec<u8> {
    let key = LessSafeKey::new(UnboundKey::new(&AES_128_GCM, rikey).unwrap());
    let mut data = plaintext.to_vec();
    let tag = key
        .seal_in_place_separate_tag(rtsp_nonce(sequence, *b"CR"), Aad::empty(), &mut data)
        .unwrap();
    let mut framed = Vec::with_capacity(24 + data.len());
    framed.extend_from_slice(&((data.len() as u32) | ENCRYPTED_BIT).to_be_bytes());
    framed.extend_from_slice(&sequence.to_be_bytes());
    framed.extend_from_slice(tag.as_ref());
    framed.extend_from_slice(&data);
    framed
}

/// Opens a sealed RTSP response and returns the plaintext.
fn open(rikey: &[u8; 16], framed: &[u8]) -> String {
    let type_and_length = u32::from_be_bytes(framed[..4].try_into().unwrap());
    assert_ne!(type_and_length & ENCRYPTED_BIT, 0, "response is not encrypted");
    let length = (type_and_length & !ENCRYPTED_BIT) as usize;
    assert_eq!(framed.len(), 24 + length, "framing mismatch");
    let sequence = u32::from_be_bytes(framed[4..8].try_into().unwrap());
    let mut data = framed[24..].to_vec();
    data.extend_from_slice(&framed[8..24]);
    let key = LessSafeKey::new(UnboundKey::new(&AES_128_GCM, rikey).unwrap());
    let plaintext = key
        .open_in_place(rtsp_nonce(sequence, *b"HR"), Aad::empty(), &mut data)
        .expect("response decrypt failed");
    String::from_utf8_lossy(plaintext).into_owned()
}

struct EncryptedRtspClient {
    port: u16,
    rikey: [u8; 16],
    sequence: u32,
}

impl EncryptedRtspClient {
    async fn roundtrip(&mut self, request: &str) -> String {
        self.sequence += 1;
        let framed = seal(&self.rikey, self.sequence, request.as_bytes());
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).await.unwrap();
        stream.write_all(&framed).await.unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await.unwrap();
        open(&self.rikey, &response)
    }
}

fn rtsp_request(cseq: u32, method: &str, target: &str, extra_headers: &str) -> String {
    format!(
        "{method} {target} RTSP/1.0\r\nCSeq: {cseq}\r\nX-GS-ClientVersion: 14\r\nHost: 0.0.0.0{extra_headers}\r\n\r\n"
    )
}

async fn next_event(event_rx: &mut mpsc::UnboundedReceiver<String>) -> serde_json::Value {
    serde_json::from_str(&event_rx.recv().await.expect("stdio event")).unwrap()
}

#[tokio::test]
async fn plaintext_rtsp_handshake_matches_moonlight_sequence() {
    let (state, mut events, _http_port, https_port, rtsp_port, pinned) = setup("plaintext").await;
    let client = generate_client_identity();
    pair_client(&state, "tester", &client);

    // /launch over HTTPS raises the session and reports the RTSP url
    let response = tls_get(https_port, &launch_query("tester", ""), &pinned).await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "gamesession"), "1");
    assert_eq!(tag(&response, "sessionUrl0"), "rtsp://127.0.0.1:48010");
    let event = next_event(&mut events).await;
    assert_eq!(event["event"], "session-state");
    assert_eq!(event["state"], "launching");

    // OPTIONS (first contact moves the session to waiting-for-client)
    let response = rtsp_roundtrip(
        rtsp_port,
        &rtsp_request(1, "OPTIONS", "rtsp://0.0.0.0:48010", ""),
    )
    .await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");
    assert!(response.contains("CSeq: 1\r\n"), "{response}");
    let event = next_event(&mut events).await;
    assert_eq!(event["event"], "session-state");
    assert_eq!(event["state"], "waiting-for-client");

    // DESCRIBE must carry an SDP payload (Moonlight fails without one), and
    // the codec markers it advertises must track the probed encoder: no AV1
    // (this host has none) and the HEVC VPS marker exactly when the probe
    // opened an HEVC session — that marker is the only signal the client
    // uses to decide whether to offer HEVC at all
    let response = rtsp_roundtrip(
        rtsp_port,
        &rtsp_request(
            2,
            "DESCRIBE",
            "rtsp://0.0.0.0:48010",
            "\r\nAccept: application/sdp\r\nIf-Modified-Since: Thu, 01 Jan 1970 00:00:00 GMT",
        ),
    )
    .await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");
    assert!(response.contains("CSeq: 2\r\n"), "{response}");
    assert!(response.contains("Content-length: "), "{response}");
    let payload = response.split("\r\n\r\n").nth(1).expect("DESCRIBE payload");
    assert!(payload.contains("a=x-ss-general.featureFlags:0"), "{payload}");
    assert!(payload.contains("a=fmtp:97 surround-params=21101"), "{payload}");
    assert!(payload.contains("a=fmtp:97 surround-params=642012453"), "{payload}");
    assert!(payload.contains("a=fmtp:97 surround-params=660012345"), "{payload}");
    assert!(payload.contains("a=fmtp:97 surround-params=85301245673"), "{payload}");
    assert!(payload.contains("a=fmtp:97 surround-params=88001234567"), "{payload}");
    // the live payload advertises reference-frame invalidation exactly when
    // the probed encoder capability says it is usable (Moonlight detects RFI
    // by substring match on this payload)
    assert_eq!(
        payload.contains("a=x-nv-video[0].refPicInvalidation:1"),
        recovery_capability().rfi,
        "RFI advertisement must track the probed capability: {payload}"
    );
    // the HEVC capability marker, same rule as RFI above: present exactly
    // when the probed encoder can produce the codec the client would then
    // ask for in ANNOUNCE (moonlight-common-c RtspConnection.c:1104
    // substring-matches it)
    assert_eq!(
        payload.contains("sprop-parameter-sets=AAAAAU"),
        recovery_capability().hevc,
        "HEVC advertisement must track the probed capability: {payload}"
    );
    assert!(!payload.contains("AV1/90000"), "{payload}");

    // SETUP audio -> 48000, video -> 47998, control -> 47999
    let setup = |cseq, target| {
        rtsp_request(
            cseq,
            "SETUP",
            target,
            "\r\nSession: DEADBEEFCAFE\r\nTransport: unicast;X-GS-ClientPort=50000-50001\r\nIf-Modified-Since: Thu, 01 Jan 1970 00:00:00 GMT",
        )
    };
    let response = rtsp_roundtrip(rtsp_port, &setup(3, "streamid=audio/0/0")).await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");
    assert!(response.contains("CSeq: 3\r\n"), "{response}");
    assert!(response.contains("Session: DEADBEEFCAFE;timeout = 90\r\n"), "{response}");
    assert!(response.contains("Transport: server_port=48000\r\n"), "{response}");
    let ping_payload = response
        .lines()
        .find_map(|line| line.strip_prefix("X-SS-Ping-Payload: "))
        .expect("ping payload");
    // Moonlight copies the payload only when it is exactly the 16 bytes of
    // its SS_PING payload field (moonlight-common-c RtspConnection.c:1204-1207,
    // `strlen(pingPayload) == sizeof(AudioPingPayload.payload)`); anything
    // else silently falls back to the 4-byte legacy ping. Sunshine hex-encodes
    // eight random bytes here, so the wire value is 16 characters.
    assert_eq!(ping_payload.len(), 16);
    assert!(ping_payload.chars().all(|c| c.is_ascii_hexdigit()));

    let response = rtsp_roundtrip(rtsp_port, &setup(4, "streamid=video/0/0")).await;
    assert!(response.contains("CSeq: 4\r\n"), "{response}");
    assert!(response.contains("Transport: server_port=47998\r\n"), "{response}");

    let response = rtsp_roundtrip(rtsp_port, &setup(5, "streamid=control/13/0")).await;
    assert!(response.contains("CSeq: 5\r\n"), "{response}");
    assert!(response.contains("Transport: server_port=47999\r\n"), "{response}");
    let connect_data = response
        .lines()
        .find_map(|line| line.strip_prefix("X-SS-Connect-Data: "))
        .expect("connect data");
    connect_data.parse::<u32>().expect("numeric connect data");

    // unknown stream kind is rejected like Sunshine
    let response = rtsp_roundtrip(rtsp_port, &setup(6, "streamid=wat/0/0")).await;
    assert!(response.starts_with("RTSP/1.0 404 NOT FOUND\r\n"), "{response}");

    // ANNOUNCE carries the x-nv-* SDP attributes
    let sdp = concat!(
        "v=0\r\n",
        "s=Moonlight\r\n",
        "a=x-nv-video[0].maxFPS:60\r\n",
        "a=x-nv-video[0].clientViewportWd:1920\r\n",
        "a=x-nv-video[0].clientViewportHt:1080\r\n",
        "a=x-nv-vqos[0].bw.maximumBitrateKbps:20000\r\n",
        "a=x-nv-audio.surround.numChannels:2\r\n",
    );
    let announce = format!(
        "ANNOUNCE streamid=control/13/0 RTSP/1.0\r\nCSeq: 7\r\nX-GS-ClientVersion: 14\r\nHost: 0.0.0.0\r\nSession: DEADBEEFCAFE\r\nContent-type: application/sdp\r\nContent-length: {len}\r\n\r\n{sdp}",
        len = sdp.len()
    );
    let response = rtsp_roundtrip(rtsp_port, &announce).await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");

    // PLAY starts the placeholder streaming phase and emits client events
    let response = rtsp_roundtrip(
        rtsp_port,
        &rtsp_request(8, "PLAY", "/", "\r\nSession: DEADBEEFCAFE"),
    )
    .await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");
    let event = next_event(&mut events).await;
    assert_eq!(event["event"], "session-state");
    assert_eq!(event["state"], "streaming");
    let event = next_event(&mut events).await;
    assert_eq!(event["event"], "client-connected");
    assert_eq!(event["appid"], 1);
    assert_eq!(event["uniqueid"], "tester");
    assert_eq!(event["width"], 1920);
    assert_eq!(event["height"], 1080);
    assert_eq!(event["fps"], 60);

    // GET_PARAMETER keepalive is answered (Sunshine 404s it; Moonlight never sends it)
    let response = rtsp_roundtrip(
        rtsp_port,
        &rtsp_request(9, "GET_PARAMETER", "rtsp://0.0.0.0:48010", "\r\nSession: DEADBEEFCAFE"),
    )
    .await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");

    // TEARDOWN ends the session with the quitting/disconnected/idle event sequence
    let response = rtsp_roundtrip(
        rtsp_port,
        &rtsp_request(10, "TEARDOWN", "/", "\r\nSession: DEADBEEFCAFE"),
    )
    .await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");
    let event = next_event(&mut events).await;
    assert_eq!(event["event"], "session-state");
    assert_eq!(event["state"], "quitting");
    let event = next_event(&mut events).await;
    assert_eq!(event["event"], "client-disconnected");
    assert_eq!(event["reason"], "teardown");
    let event = next_event(&mut events).await;
    assert_eq!(event["event"], "session-state");
    assert_eq!(event["state"], "idle");
}

#[tokio::test]
async fn encrypted_rtsp_handshake_with_corever() {
    let (state, mut events, _http_port, https_port, rtsp_port, pinned) = setup("encrypted").await;
    let client = generate_client_identity();
    pair_client(&state, "tester", &client);

    // Moonlight always sends corever=1 -> rtspenc:// + AES-GCM RTSP messages
    let rikey = crypto::random_bytes(16);
    let rikey_hex = crypto::hex_encode(&rikey);
    let query = format!(
        "/launch?appid=1&mode=1280x720x30&rikey={rikey_hex}&rikeyid=7&localAudioPlayMode=0&corever=1"
    );
    let response = tls_get_as_client(https_port, &query, &pinned, &client).await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "sessionUrl0"), "rtspenc://127.0.0.1:48010");
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "launching");

    let mut rtsp_client = EncryptedRtspClient {
        port: rtsp_port,
        rikey: rikey.try_into().unwrap(),
        sequence: 0,
    };

    let response = rtsp_client
        .roundtrip(&rtsp_request(1, "OPTIONS", "rtsp://0.0.0.0:48010", ""))
        .await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n"), "{response}");
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "waiting-for-client");

    // a plaintext request on an encrypted session must not be answered
    let mut stream = TcpStream::connect(("127.0.0.1", rtsp_port)).await.unwrap();
    stream
        .write_all(b"OPTIONS rtsp://0.0.0.0:48010 RTSP/1.0\r\nCSeq: 1\r\n\r\n")
        .await
        .unwrap();
    let response = read_until_close(&mut stream).await;
    assert!(response.is_empty(), "plaintext on rtspenc session: {response:?}");

    let response = rtsp_client
        .roundtrip(&rtsp_request(2, "DESCRIBE", "rtsp://0.0.0.0:48010", ""))
        .await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");
    assert!(
        response.contains("a=x-ss-general.featureFlags:0"),
        "{response}"
    );

    let response = rtsp_client
        .roundtrip(&rtsp_request(3, "SETUP", "streamid=video/0/0", ""))
        .await;
    assert!(response.contains("Transport: server_port=47998\r\n"), "{response}");

    let response = rtsp_client
        .roundtrip(&rtsp_request(4, "PLAY", "/", ""))
        .await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");
    let event = next_event(&mut events).await;
    assert_eq!(event["event"], "session-state");
    assert_eq!(event["state"], "streaming");
    let event = next_event(&mut events).await;
    assert_eq!(event["event"], "client-connected");
    assert_eq!(event["appid"], 1);
    assert_eq!(event["width"], 1280);
    assert_eq!(event["height"], 720);
    assert_eq!(event["fps"], 30);
}

#[tokio::test]
async fn rtsp_is_rejected_without_pending_session() {
    let (_state, _events, _http_port, _https_port, rtsp_port, _pinned) =
        setup("tiein").await;

    // no /launch was issued: the server must drop the connection unanswered
    let mut stream = TcpStream::connect(("127.0.0.1", rtsp_port)).await.unwrap();
    stream
        .write_all(b"OPTIONS rtsp://0.0.0.0:48010 RTSP/1.0\r\nCSeq: 1\r\n\r\n")
        .await
        .unwrap();
    let response = read_until_close(&mut stream).await;
    assert!(response.is_empty(), "RTSP without a session: {response:?}");
}

#[tokio::test]
async fn launch_resume_cancel_validation_and_events() {
    let (state, mut events, _http_port, https_port, _rtsp_port, pinned) =
        setup("validation").await;
    let client = generate_client_identity();
    pair_client(&state, "tester", &client);

    // unknown uniqueid without a client certificate is rejected
    let response = tls_get(https_port, &launch_query("stranger", ""), &pinned).await;
    assert!(response.contains("status_code=\"401\""), "{response}");
    assert!(response.contains("The client is not authorized"), "{response}");

    // missing required launch parameters
    let response = tls_get(
        https_port,
        "/launch?uniqueid=tester&appid=1&rikeyid=1&localAudioPlayMode=0",
        &pinned,
    )
    .await;
    assert!(response.contains("status_code=\"400\""), "{response}");
    assert!(response.contains("Missing a required launch parameter"), "{response}");

    // unknown appid, Sunshine-style
    let rikey = crypto::hex_encode(&crypto::random_bytes(16));
    let response = tls_get(
        https_port,
        &format!("/launch?uniqueid=tester&appid=99&mode=0x0x0&rikey={rikey}&rikeyid=1&localAudioPlayMode=0"),
        &pinned,
    )
    .await;
    assert!(response.contains("status_code=\"404\""), "{response}");
    assert!(
        response.contains("Failed to start the specified application"),
        "{response}"
    );

    // valid launch
    let response = tls_get(https_port, &launch_query("tester", ""), &pinned).await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "launching");

    // a second launch while the session is active is rejected
    let response = tls_get(https_port, &launch_query("tester", ""), &pinned).await;
    assert!(response.contains("status_code=\"400\""), "{response}");
    assert!(
        response.contains("An app is already running on this host"),
        "{response}"
    );

    // resume while no app is streaming yet is allowed (session pending);
    // Sunshine re-raises the pending session WITH the new rikey — assert
    // it was actually applied (M2: the old silent no-op arm kept the
    // stale key and the client's next RTSP used the wrong one)
    let resume_rikey = crypto::hex_encode(&crypto::random_bytes(16));
    let response = tls_get(
        https_port,
        &format!(
            "/resume?uniqueid=tester&appid=1&mode=1920x1080x60&rikey={resume_rikey}&rikeyid=9&localAudioPlayMode=0"
        ),
        &pinned,
    )
    .await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "resume"), "1");
    let applied = state.launch_params().expect("pending session");
    assert_eq!(
        crypto::hex_encode(&applied.rikey),
        resume_rikey,
        "/resume must apply the new rikey to the pending session"
    );

    // missing rikey on resume (session still pending)
    let response = tls_get(
        https_port,
        "/resume?uniqueid=tester&appid=1&rikeyid=9",
        &pinned,
    )
    .await;
    assert!(response.contains("status_code=\"400\""), "{response}");
    assert!(
        response.contains("Missing a required resume parameter"),
        "{response}"
    );

    // resume is still allowed while the session is pending
    let second_rikey = crypto::hex_encode(&crypto::random_bytes(16));
    let response = tls_get(
        https_port,
        &format!(
            "/resume?uniqueid=tester&appid=1&mode=1920x1080x60&rikey={second_rikey}&rikeyid=9&localAudioPlayMode=0"
        ),
        &pinned,
    )
    .await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(
        crypto::hex_encode(&state.launch_params().unwrap().rikey),
        second_rikey
    );
    state.end_session("cancel");
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "quitting");
    let event = next_event(&mut events).await;
    assert_eq!(event["event"], "client-disconnected");
    assert_eq!(event["reason"], "cancel");
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "idle");

    // resume is rejected once the session is gone
    let late_rikey = crypto::hex_encode(&crypto::random_bytes(16));
    let response = tls_get(
        https_port,
        &format!(
            "/resume?uniqueid=tester&appid=1&mode=1920x1080x60&rikey={late_rikey}&rikeyid=9&localAudioPlayMode=0"
        ),
        &pinned,
    )
    .await;
    assert!(response.contains("status_code=\"503\""), "{response}");
    assert!(response.contains("No running app to resume"), "{response}");

    // /cancel with no active session still succeeds and emits no events
    let response = tls_get(https_port, "/cancel?uniqueid=tester", &pinned).await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "cancel"), "1");
}

#[tokio::test]
async fn launch_authorizes_paired_client_certificate() {
    let (state, mut events, _http_port, https_port, _rtsp_port, pinned) =
        setup("certauth").await;
    let client = generate_client_identity();
    pair_client(&state, "tester", &client);

    // Moonlight-Qt sends no uniqueid on /launch; it is identified by the
    // TLS client certificate registered during pairing.
    let rikey = crypto::hex_encode(&crypto::random_bytes(16));
    let query = format!(
        "/launch?appid=1&mode=1920x1080x60&rikey={rikey}&rikeyid=123456&localAudioPlayMode=0"
    );
    let response = tls_get_as_client(https_port, &query, &pinned, &client).await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "gamesession"), "1");
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "launching");

    // an unpaired certificate is rejected
    let stranger = generate_client_identity();
    let response = tls_get_as_client(https_port, &query, &pinned, &stranger).await;
    assert!(response.contains("status_code=\"401\""), "{response}");

    // but the unpaired client is still allowed to read serverinfo
    let response = tls_get_as_client(
        https_port,
        "/serverinfo?uniqueid=stranger",
        &pinned,
        &stranger,
    )
    .await;
    assert!(response.contains("status_code=\"200\""), "{response}");
}

#[tokio::test]
async fn session_expires_when_client_never_connects() {
    let (state, mut events, _http_port, https_port, rtsp_port, pinned) =
        setup("timeout").await;
    let client = generate_client_identity();
    pair_client(&state, "tester", &client);

    let response = tls_get(https_port, &launch_query("tester", ""), &pinned).await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "launching");

    // serverinfo reports the launched session as BUSY with the appid, like
    // Sunshine, so clients polling after /launch see the app running
    let info = tls_get(https_port, "/serverinfo", &pinned).await;
    assert_eq!(tag(&info, "state"), "SUNSHINE_SERVER_BUSY");
    assert_eq!(tag(&info, "currentgame"), "1");

    // a fresh session must not expire
    assert!(!state.expire_session(std::time::Duration::from_secs(300)));

    // C1: the waiting-for-client phase expires too — a stray TCP connect
    // must not leave the host BUSY forever (Sunshine cancels the
    // ping_timeout only when the stream is up)
    let response = rtsp_roundtrip(
        rtsp_port,
        &rtsp_request(1, "OPTIONS", "rtsp://0.0.0.0:48010", ""),
    )
    .await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");
    assert_eq!(state.session_phase(), GamePhase::WaitingForClient);
    let event = next_event(&mut events).await; // waiting-for-client
    assert_eq!(event["state"], "waiting-for-client");
    assert!(!state.expire_session(std::time::Duration::from_secs(300)));
    assert!(state.expire_session(std::time::Duration::from_secs(0)));
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "quitting");
    let event = next_event(&mut events).await;
    assert_eq!(event["event"], "client-disconnected");
    assert_eq!(event["reason"], "timeout");
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "idle");

    // idle again: serverinfo is FREE with no current game
    let info = tls_get(https_port, "/serverinfo", &pinned).await;
    assert_eq!(tag(&info, "state"), "SUNSHINE_SERVER_FREE");
    assert_eq!(tag(&info, "currentgame"), "0");

    // RTSP is closed again once the session is gone
    assert!(!state.rtsp_contact());
}

#[tokio::test]
/// C2: a PLAY racing a session end must not resurrect the session from
/// Idle (no orphaned capture, no BUSY wedge).
async fn play_after_session_end_is_ignored() {
    let (state, mut events, _http_port, https_port, _rtsp_port, pinned) =
        setup("play-after-end").await;
    let client = generate_client_identity();
    pair_client(&state, "tester", &client);

    let response = tls_get(https_port, &launch_query("tester", ""), &pinned).await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    let _ = next_event(&mut events).await; // launching

    state.end_session("cancel");
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "quitting");
    let _ = next_event(&mut events).await; // client-disconnected
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "idle");

    // PLAY arriving after the end: no promotion, no capture
    assert!(!state.mark_streaming());
    assert_eq!(state.session_phase(), GamePhase::Idle);
    // no client-connected event was emitted
    assert!(events.try_recv().is_err());
}

#[tokio::test]
async fn streaming_session_never_expires_via_nvhttp() {
    let (state, mut events, _http_port, https_port, rtsp_port, pinned) =
        setup("post-play-timeout").await;
    let client = generate_client_identity();
    pair_client(&state, "tester", &client);

    let response = tls_get(https_port, &launch_query("tester", ""), &pinned).await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "launching");

    // RTSP contact first (OPTIONS), like a real client: PLAY only
    // promotes a waiting-for-client/streaming session (C2)
    let response = rtsp_roundtrip(
        rtsp_port,
        &rtsp_request(1, "OPTIONS", "rtsp://0.0.0.0:48010", ""),
    )
    .await;
    assert!(response.starts_with("RTSP/1.0 200 OK\r\n"), "{response}");
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "waiting-for-client");

    // PLAY reached: the stream is up and serverinfo stays BUSY
    assert!(state.mark_streaming());
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "streaming");
    let event = next_event(&mut events).await;
    assert_eq!(event["event"], "client-connected");
    let info = tls_get(https_port, "/serverinfo", &pinned).await;
    assert_eq!(tag(&info, "state"), "SUNSHINE_SERVER_BUSY");
    assert_eq!(tag(&info, "currentgame"), "1");

    // Sunshine semantics: once RTSP connected, the nvhttp-level expiry no
    // longer applies at all — even a zero launch timeout must not expire
    // the session. The control channel's silence timeout is the sole
    // streaming-phase liveness killer (end_session, "control-timeout").
    assert!(!state.expire_session(std::time::Duration::from_secs(0)));
    assert!(!state.expire_session(std::time::Duration::from_secs(0)));
    let info = tls_get(https_port, "/serverinfo", &pinned).await;
    assert_eq!(tag(&info, "state"), "SUNSHINE_SERVER_BUSY");

    // what control.rs does after 10s of control silence:
    state.end_session("control-timeout");
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "quitting");
    let event = next_event(&mut events).await;
    assert_eq!(event["event"], "client-disconnected");
    assert_eq!(event["reason"], "control-timeout");
    let event = next_event(&mut events).await;
    assert_eq!(event["state"], "idle");

    let info = tls_get(https_port, "/serverinfo", &pinned).await;
    assert_eq!(tag(&info, "state"), "SUNSHINE_SERVER_FREE");
    assert_eq!(tag(&info, "currentgame"), "0");
}
