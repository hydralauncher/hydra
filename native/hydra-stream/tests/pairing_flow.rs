use std::sync::Arc;

use aes::cipher::generic_array::GenericArray;
use aes::cipher::{BlockEncrypt, KeyInit};
use aes::Aes128;
use sha2::Digest;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_rustls::{rustls, TlsConnector};

use hydra_stream::certs;
use hydra_stream::crypto;
use hydra_stream::http;
use hydra_stream::nvhttp::{PairedClient, State};
use hydra_stream::store::Store;

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

fn cert_der_from_pem(pem: &[u8]) -> Vec<u8> {
    let (_, parsed) = x509_parser::pem::parse_x509_pem(pem).unwrap();
    parsed.contents
}

fn generate_client_identity() -> certs::Identity {
    let dir = std::env::temp_dir().join(format!("hydra-stream-e2e-client-{}", std::process::id()));
    let store = Store::at(dir).unwrap();
    // a fresh key per run so the signature path is genuinely exercised
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
        &rustls::pki_types::PrivatePkcs8KeyDer::from(key_pkcs8_der.clone()),
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

async fn read_body(stream: &mut (impl AsyncRead + Unpin)) -> String {
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.unwrap();
    String::from_utf8_lossy(&response)
        .split("\r\n\r\n")
        .nth(1)
        .expect("HTTP body")
        .to_string()
}

async fn http_get(port: u16, target: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream
        .write_all(
            format!("GET {target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await
        .unwrap();
    read_body(&mut stream).await
}

/// Next pairing event the host broadcasts (pairing-requested /
/// pairing-finished), with a deadline so a hang fails the test instead of
/// blocking it forever.
async fn next_pairing_event(rx: &mut mpsc::UnboundedReceiver<String>) -> serde_json::Value {
    let raw = tokio::time::timeout(std::time::Duration::from_secs(10), rx.recv())
        .await
        .expect("pairing event timed out")
        .expect("pairing event channel closed");
    serde_json::from_str(&raw).expect("pairing event json")
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

/// The paired client's own connection: it presents the certificate it
/// registered during pairing, which is what authorizes its uniqueid.
fn tls_connector_as_client(pinned_cert: &[u8], client: &certs::Identity) -> TlsConnector {
    use rustls::pki_types::{PrivateKeyDer, PrivatePkcs8KeyDer};

    let verifier = PinnedCertVerifier {
        pinned: pinned_cert.to_vec(),
    };
    let config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_client_auth_cert(
            vec![client.cert_der.clone().into()],
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(client.key_pkcs8_der.clone())),
        )
        .unwrap();
    TlsConnector::from(Arc::new(config))
}

async fn tls_get_as_client(
    port: u16,
    target: &str,
    pinned_cert: &[u8],
    client: &certs::Identity,
) -> String {
    let connector = tls_connector_as_client(pinned_cert, client);
    let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let server_name = rustls::pki_types::ServerName::try_from("localhost").unwrap();
    let mut tls = connector.connect(server_name, stream).await.unwrap();
    tls.write_all(
        format!("GET {target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").as_bytes(),
    )
    .await
    .unwrap();
    read_body(&mut tls).await
}

async fn tls_get(port: u16, target: &str, pinned_cert: &[u8]) -> String {
    tls_try_get(port, target, pinned_cert)
        .await
        .expect("TLS request")
}

async fn tls_try_get(
    port: u16,
    target: &str,
    pinned_cert: &[u8],
) -> Result<String, Box<dyn std::error::Error>> {
    let connector = tls_connector(pinned_cert);
    let stream = TcpStream::connect(("127.0.0.1", port)).await?;
    let server_name = rustls::pki_types::ServerName::try_from("localhost")?;
    let mut tls = connector.connect(server_name, stream).await?;
    tls.write_all(
        format!("GET {target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").as_bytes(),
    )
    .await?;
    Ok(read_body(&mut tls).await)
}

struct BinaryResponse {
    content_type: String,
    body: Vec<u8>,
}

async fn tls_get_bytes(port: u16, target: &str, pinned_cert: &[u8]) -> BinaryResponse {
    let connector = tls_connector(pinned_cert);
    let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
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
    let mut raw = Vec::new();
    tls.read_to_end(&mut raw).await.unwrap();
    let text = String::from_utf8_lossy(&raw);
    let header = text.split("\r\n\r\n").next().expect("response head");
    let content_type = header
        .lines()
        .find_map(|line| line.strip_prefix("Content-Type: "))
        .expect("content type")
        .to_string();
    let body_offset = text.find("\r\n\r\n").expect("header end") + 4;
    BinaryResponse {
        content_type,
        body: raw[body_offset..].to_vec(),
    }
}

async fn spawn_servers(state: Arc<State>) -> (u16, u16) {
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

    (http_port, https_port)
}

#[tokio::test]
async fn moonlight_client_pairing_flow() {
    let dir = std::env::temp_dir().join(format!("hydra-stream-e2e-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    let store = Store::at(dir).unwrap();
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<String>();
    let state = Arc::new(State::with_store(store.clone(), event_tx).unwrap());
    let (http_port, https_port) = spawn_servers(state.clone()).await;

    let uniqueid = "e2eclient42";
    let client = generate_client_identity();

    // stage 1: getservercert (plain HTTP, like Moonlight). The response
    // is held until the user submits the PIN shown on the client.
    let salt = crypto::random_bytes(16);
    let query = format!(
        "/pair?uniqueid={uniqueid}&devicename=roth&updateState=1&phrase=getservercert&salt={}&clientcert={}",
        crypto::hex_encode_upper(&salt),
        crypto::hex_encode_upper(client.cert_pem.as_bytes())
    );
    let get_task = tokio::spawn(async move { http_get(http_port, &query).await });
    let event: serde_json::Value =
        serde_json::from_str(&event_rx.recv().await.expect("pairing event")).unwrap();
    assert_eq!(event["event"], "pairing-requested");
    assert!(event.get("pin").is_none());

    // the client generated the PIN; the user enters it into the host
    let pin = "1234".to_string();
    assert!(state.submit_pairing_pin(&pin).is_ok());
    let response = get_task.await.unwrap();
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "paired"), "1");
    let server_cert_pem = crypto::hex_decode(tag(&response, "plaincert")).unwrap();
    let server_cert_der = cert_der_from_pem(&server_cert_pem);

    let mut aes_input = salt.clone();
    aes_input.extend_from_slice(pin.as_bytes());
    let aes_key: [u8; 16] = sha256(&aes_input)[..16].try_into().unwrap();

    // stage 2: clientchallenge
    let client_challenge = crypto::random_bytes(16);
    let query = format!(
        "/pair?uniqueid={uniqueid}&devicename=roth&updateState=1&clientchallenge={}",
        crypto::hex_encode_upper(&ecb_encrypt(&aes_key, &client_challenge))
    );
    let response = http_get(http_port, &query).await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    let challenge_response = crypto::hex_decode(tag(&response, "challengeresponse")).unwrap();
    let decrypted = crypto::aes128_ecb_decrypt(&aes_key, &challenge_response);
    assert_eq!(decrypted.len(), 48);
    let server_hash = decrypted[..32].to_vec();
    let server_challenge = decrypted[32..].to_vec();

    // stage 3: serverchallengeresp
    let client_secret = crypto::random_bytes(16);
    let client_cert_signature = crypto::cert_signature(&client.cert_der).unwrap();
    let mut hash_input = server_challenge.clone();
    hash_input.extend_from_slice(&client_cert_signature);
    hash_input.extend_from_slice(&client_secret);
    let query = format!(
        "/pair?uniqueid={uniqueid}&devicename=roth&updateState=1&serverchallengeresp={}",
        crypto::hex_encode_upper(&ecb_encrypt(&aes_key, &sha256(&hash_input)))
    );
    let response = http_get(http_port, &query).await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    let pairing_secret = crypto::hex_decode(tag(&response, "pairingsecret")).unwrap();
    let (server_secret, server_signature) = pairing_secret.split_at(16);
    assert!(crypto::verify_sha256(&server_cert_der, server_secret, server_signature).unwrap());

    // the hash the server returned must match what we expect from the challenge
    let server_cert_signature = crypto::cert_signature(&server_cert_der).unwrap();
    let mut expected_input = client_challenge.clone();
    expected_input.extend_from_slice(&server_cert_signature);
    expected_input.extend_from_slice(server_secret);
    assert_eq!(server_hash, sha256(&expected_input)[..]);

    // stage 4: clientpairingsecret
    use rsa::pkcs8::DecodePrivateKey;
    let client_key = rsa::RsaPrivateKey::from_pkcs8_der(&client.key_pkcs8_der).unwrap();
    let signature = client_key
        .sign(rsa::Pkcs1v15Sign::new::<sha2::Sha256>(), &sha256(&client_secret))
        .unwrap();
    let mut pairing_secret = client_secret.clone();
    pairing_secret.extend_from_slice(&signature);
    let query = format!(
        "/pair?uniqueid={uniqueid}&devicename=roth&updateState=1&clientpairingsecret={}",
        crypto::hex_encode_upper(&pairing_secret)
    );
    let response = http_get(http_port, &query).await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "paired"), "1");

    // stage 5: pairchallenge over HTTPS with the pinned server cert
    let response = tls_get(
        https_port,
        &format!("/pair?uniqueid={uniqueid}&devicename=roth&updateState=1&phrase=pairchallenge"),
        &server_cert_der,
    )
    .await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "paired"), "1");

    // paired client must be persisted
    let persisted: Vec<PairedClient> = store.read_json("clients.json").unwrap();
    assert!(persisted.iter().any(|client| client.uniqueid == uniqueid));

    // host listing over HTTPS
    let response = tls_get(
        https_port,
        &format!("/serverinfo?uniqueid={uniqueid}"),
        &server_cert_der,
    )
    .await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "hostname"), "Hydra");
    assert_eq!(tag(&response, "uniqueid"), state.uuid);
    assert_eq!(tag(&response, "PairStatus"), "1");
    assert_eq!(tag(&response, "state"), "SUNSHINE_SERVER_FREE");

    // applist over HTTPS — must be the compact Sunshine/boost wire shape:
    // any whitespace between elements crashes Moonlight-Android's pull
    // parser while "loading app list"
    let response = tls_get(
        https_port,
        &format!("/applist?uniqueid={uniqueid}"),
        &server_cert_der,
    )
    .await;
    let expected_applist = concat!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
        "<root status_code=\"200\"><App><IsHdrSupported>0</IsHdrSupported><AppTitle>Desktop</AppTitle><ID>1</ID></App></root>",
    );
    assert_eq!(response, expected_applist);

    // the Electron host pushes the Hydra library as streamable apps
    state.set_app_list(vec![
        (100, "Hollow & Knight".to_string(), None),
        (200, "Celeste".to_string(), None),
    ]);
    let response = tls_get(
        https_port,
        &format!("/applist?uniqueid={uniqueid}"),
        &server_cert_der,
    )
    .await;
    let expected_applist = concat!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
        "<root status_code=\"200\">",
        "<App><IsHdrSupported>0</IsHdrSupported><AppTitle>Desktop</AppTitle><ID>1</ID></App>",
        "<App><IsHdrSupported>0</IsHdrSupported><AppTitle>Hollow &amp; Knight</AppTitle><ID>100</ID></App>",
        "<App><IsHdrSupported>0</IsHdrSupported><AppTitle>Celeste</AppTitle><ID>200</ID></App>",
        "</root>",
    );
    assert_eq!(response, expected_applist);

    // launching a pushed game appid works and requests the game launch;
    // unknown appids get the Sunshine error
    let rikey = crypto::hex_encode(&crypto::random_bytes(16));
    let response = tls_get_as_client(
        https_port,
        &format!(
            "/launch?uniqueid={uniqueid}&appid=100&mode=1280x720x60&rikey={rikey}&rikeyid=1&localAudioPlayMode=0"
        ),
        &server_cert_der,
        &client,
    )
    .await;
    assert!(response.contains("status_code=\"200\""), "{response}");

    // collect events until the named one arrives (queue may hold leftovers)
    async fn next_event_named(
        rx: &mut mpsc::UnboundedReceiver<String>,
        name: &str,
    ) -> serde_json::Value {
        for _ in 0..8 {
            let event: serde_json::Value =
                serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
            if event["event"] == name {
                return event;
            }
        }
        panic!("event {name} never arrived");
    }

    // M4: launch-requested is emitted only after begin_launch succeeds,
    // so session-state launching precedes it
    let event = next_event_named(&mut event_rx, "session-state").await;
    assert_eq!(event["state"], "launching");
    let event = next_event_named(&mut event_rx, "launch-requested").await;
    assert_eq!(event["appid"], 100);

    state.end_session("cancel");
    let event = next_event_named(&mut event_rx, "stream-ended").await;
    assert_eq!(event["appid"], 100);
    next_event_named(&mut event_rx, "session-state").await; // idle

    let response = tls_get_as_client(
        https_port,
        &format!(
            "/launch?uniqueid={uniqueid}&appid=999&mode=1280x720x60&rikey={rikey}&rikeyid=1&localAudioPlayMode=0"
        ),
        &server_cert_der,
        &client,
    )
    .await;
    assert!(response.contains("status_code=\"404\""), "{response}");
    assert!(
        response.contains("Failed to start the specified application"),
        "{response}"
    );

    // box art: Moonlight-Android requests /appasset right after the list;
    // Sunshine answers 200 image/png (even for missing art)
    let art = tls_get_bytes(
        https_port,
        "/appasset?appid=1&AssetType=2&AssetIdx=0",
        &server_cert_der,
    )
    .await;
    assert_eq!(art.content_type, "image/png");
    assert!(art.body.starts_with(&[0x89, 0x50, 0x4E, 0x47]));
    assert!(art.body.ends_with(b"IEND\xAE\x42\x60\x82"));

    // serverinfo over plain HTTP reports the https port and unpaired status
    let response = http_get(http_port, "/serverinfo").await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "HttpsPort"), "47984");
    assert_eq!(tag(&response, "PairStatus"), "0");

    // launch from an unknown uniqueid is rejected with the standard error
    let response = tls_get(
        https_port,
        "/launch?uniqueid=stranger&appid=1",
        &server_cert_der,
    )
    .await;
    assert!(response.contains("status_code=\"401\""), "{response}");
    assert!(response.contains("The client is not authorized"), "{response}");
}

/// A cancelled pairing must not lock the client out: the user dismisses the
/// PIN dialog, Moonlight drops the held connection and retries with the same
/// fixed uniqueid, and that retry has to pair from scratch rather than get a
/// 409 until Hydra is restarted.
#[tokio::test]
async fn cancelled_pairing_retry_pairs_from_scratch() {
    let dir = std::env::temp_dir().join(format!("hydra-stream-cancel-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    let store = Store::at(dir).unwrap();
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<String>();
    let state = Arc::new(State::with_store(store.clone(), event_tx).unwrap());
    let (http_port, _https_port) = spawn_servers(state.clone()).await;

    let uniqueid = "cancelclient7";
    let client = generate_client_identity();
    let salt = crypto::random_bytes(16);
    let getservercert = format!(
        "/pair?uniqueid={uniqueid}&devicename=roth&updateState=1&phrase=getservercert&salt={}&clientcert={}",
        crypto::hex_encode_upper(&salt),
        crypto::hex_encode_upper(client.cert_pem.as_bytes())
    );

    // the client asks for the server certificate; the host raises the
    // session and holds the response while the user looks at the PIN dialog
    let mut stream = TcpStream::connect(("127.0.0.1", http_port)).await.unwrap();
    stream
        .write_all(
            format!("GET {getservercert} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await
        .unwrap();
    let event = next_pairing_event(&mut event_rx).await;
    assert_eq!(event["event"], "pairing-requested");

    // the user cancels the dialog and the client drops the socket without
    // ever reading the held response
    drop(stream);

    // the host must notice the abandoned request, release the session and
    // close the PIN prompt that no longer has a request behind it
    let event = next_pairing_event(&mut event_rx).await;
    assert_eq!(event["event"], "pairing-finished");
    assert_eq!(event["success"], false);

    // the retry reuses the same uniqueid and must start a new session
    let retry = {
        let getservercert = getservercert.clone();
        tokio::spawn(async move { http_get(http_port, &getservercert).await })
    };
    let event = next_pairing_event(&mut event_rx).await;
    assert_eq!(event["event"], "pairing-requested");

    // ...and that session must pair all the way through
    let pin = "1234".to_string();
    assert!(state.submit_pairing_pin(&pin).is_ok());
    let response = retry.await.unwrap();
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "paired"), "1");

    let mut aes_input = salt.clone();
    aes_input.extend_from_slice(pin.as_bytes());
    let aes_key: [u8; 16] = sha256(&aes_input)[..16].try_into().unwrap();

    // stage 2: clientchallenge
    let client_challenge = crypto::random_bytes(16);
    let response = http_get(
        http_port,
        &format!(
            "/pair?uniqueid={uniqueid}&devicename=roth&updateState=1&clientchallenge={}",
            crypto::hex_encode_upper(&ecb_encrypt(&aes_key, &client_challenge))
        ),
    )
    .await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    let challenge_response = crypto::hex_decode(tag(&response, "challengeresponse")).unwrap();
    let decrypted = crypto::aes128_ecb_decrypt(&aes_key, &challenge_response);
    assert_eq!(decrypted.len(), 48);
    let server_challenge = decrypted[32..].to_vec();

    // stage 3: serverchallengeresp
    let client_secret = crypto::random_bytes(16);
    let mut hash_input = server_challenge.clone();
    hash_input.extend_from_slice(&crypto::cert_signature(&client.cert_der).unwrap());
    hash_input.extend_from_slice(&client_secret);
    let response = http_get(
        http_port,
        &format!(
            "/pair?uniqueid={uniqueid}&devicename=roth&updateState=1&serverchallengeresp={}",
            crypto::hex_encode_upper(&ecb_encrypt(&aes_key, &sha256(&hash_input)))
        ),
    )
    .await;
    assert!(response.contains("status_code=\"200\""), "{response}");

    // stage 4: clientpairingsecret
    use rsa::pkcs8::DecodePrivateKey;
    let client_key = rsa::RsaPrivateKey::from_pkcs8_der(&client.key_pkcs8_der).unwrap();
    let signature = client_key
        .sign(rsa::Pkcs1v15Sign::new::<sha2::Sha256>(), &sha256(&client_secret))
        .unwrap();
    let mut pairing_secret = client_secret.clone();
    pairing_secret.extend_from_slice(&signature);
    let response = http_get(
        http_port,
        &format!(
            "/pair?uniqueid={uniqueid}&devicename=roth&updateState=1&clientpairingsecret={}",
            crypto::hex_encode_upper(&pairing_secret)
        ),
    )
    .await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "paired"), "1");

    // the retried pairing registered the client for real
    let persisted: Vec<PairedClient> = store.read_json("clients.json").unwrap();
    assert!(persisted.iter().any(|client| client.uniqueid == uniqueid));
}

/// The cancel sequence from the sidecar log: the client holds a
/// getservercert while the PIN dialog is open, the user cancels, Moonlight
/// calls `/unpair` over plain HTTP, and its immediate retry with the same
/// fixed uniqueid pairs from scratch.
#[tokio::test]
async fn unpair_after_a_cancelled_pin_dialog_lets_the_client_pair_again() {
    let dir = std::env::temp_dir().join(format!("hydra-stream-unpair-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    let store = Store::at(dir).unwrap();
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<String>();
    let state = Arc::new(State::with_store(store, event_tx).unwrap());
    let (http_port, https_port) = spawn_servers(state.clone()).await;

    let uniqueid = "unpairclient9";
    let client = generate_client_identity();
    let getservercert = |salt: &[u8]| {
        format!(
            "/pair?uniqueid={uniqueid}&devicename=roth&updateState=1&phrase=getservercert&salt={}&clientcert={}",
            crypto::hex_encode_upper(salt),
            crypto::hex_encode_upper(client.cert_pem.as_bytes())
        )
    };

    // stage 1: the client raises the session and the response is held while
    // the user looks at the PIN dialog
    let salt = crypto::random_bytes(16);
    let held = {
        let query = getservercert(&salt);
        tokio::spawn(async move { http_get(http_port, &query).await })
    };
    let event = next_pairing_event(&mut event_rx).await;
    assert_eq!(event["event"], "pairing-requested");

    // stage 2: the user cancels and the client calls GET /unpair over plain
    // HTTP (Moonlight-Android's NvHTTP.unpair, which also sends its uuid)
    let response = http_get(
        http_port,
        &format!("/unpair?uniqueid={uniqueid}&uuid=0123456789abcdef"),
    )
    .await;
    assert!(response.contains("status_code=\"200\""), "{response}");

    // the held request ends with a terminal failure, closing the prompt the
    // user cancelled
    let body = held.await.unwrap();
    assert!(body.contains("status_code=\"400\""), "{body}");
    let event = next_pairing_event(&mut event_rx).await;
    assert_eq!(event["event"], "pairing-finished");
    assert_eq!(event["success"], false);

    // stage 3: the retry with the same uniqueid starts clean (no 409) and
    // runs to a successful getservercert
    let salt = crypto::random_bytes(16);
    let retry = {
        let query = getservercert(&salt);
        tokio::spawn(async move { http_get(http_port, &query).await })
    };
    let event = next_pairing_event(&mut event_rx).await;
    assert_eq!(event["event"], "pairing-requested");
    let pin = "1234".to_string();
    assert!(state.submit_pairing_pin(&pin).is_ok());
    let response = retry.await.unwrap();
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "paired"), "1");
    assert!(response.contains("plaincert"), "{response}");

    // stage 4: the status poll answers for the client store, so a client that
    // never completed pairing is not told it is paired; the same route works
    // over HTTPS and releases the session that is still mid-handshake
    let response = tls_get(
        https_port,
        &format!("/serverinfo?uniqueid={uniqueid}"),
        &state.identity.cert_der,
    )
    .await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert_eq!(tag(&response, "PairStatus"), "0");

    let response = tls_get(
        https_port,
        &format!("/unpair?uniqueid={uniqueid}"),
        &state.identity.cert_der,
    )
    .await;
    assert!(response.contains("status_code=\"200\""), "{response}");
    assert!(state.sessions.lock().unwrap().is_empty());
}

#[tokio::test]
async fn tls_rejects_wrong_pinned_cert() {
    let dir = std::env::temp_dir().join(format!("hydra-stream-e2e-tls-{}", std::process::id()));
    let store = Store::at(dir).unwrap();
    let (event_tx, _rx) = mpsc::unbounded_channel::<String>();
    let state = Arc::new(State::with_store(store, event_tx).unwrap());
    let (_http_port, https_port) = spawn_servers(state.clone()).await;

    let other = generate_client_identity();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tls_try_get(https_port, "/serverinfo", &other.cert_der),
    )
    .await
    .expect("request completes or fails")
    .expect_err("TLS with a mismatched pinned cert must fail");
    let _ = result;
}
