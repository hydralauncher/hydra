use std::collections::HashMap;
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::{rustls, TlsAcceptor};

use crate::nvhttp::{self, State};

const MAX_REQUEST_SIZE: usize = 32 * 1024;

enum ConnStream {
    Plain(TcpStream),
    Tls(tokio_rustls::server::TlsStream<TcpStream>),
}

impl AsyncRead for ConnStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match self.get_mut() {
            ConnStream::Plain(stream) => Pin::new(stream).poll_read(cx, buf),
            ConnStream::Tls(stream) => Pin::new(stream).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for ConnStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        match self.get_mut() {
            ConnStream::Plain(stream) => Pin::new(stream).poll_write(cx, buf),
            ConnStream::Tls(stream) => Pin::new(stream).poll_write(cx, buf),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            ConnStream::Plain(stream) => Pin::new(stream).poll_flush(cx),
            ConnStream::Tls(stream) => Pin::new(stream).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            ConnStream::Plain(stream) => Pin::new(stream).poll_shutdown(cx),
            ConnStream::Tls(stream) => Pin::new(stream).poll_shutdown(cx),
        }
    }
}

pub fn tls_acceptor(state: &State) -> Result<TlsAcceptor, String> {
    use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};

    let cert = CertificateDer::from(state.identity.cert_der.clone());
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
        state.identity.key_pkcs8_der.clone(),
    ));
    let config = rustls::ServerConfig::builder_with_protocol_versions(&[
        &rustls::version::TLS12,
        &rustls::version::TLS13,
    ])
    .with_client_cert_verifier(Arc::new(AcceptAnyClientCert))
    .with_single_cert(vec![cert], key)
    .map_err(|error| error.to_string())?;

    Ok(TlsAcceptor::from(Arc::new(config)))
}

/// Requests (but does not require) client certificates. Sunshine enforces
/// paired certs at the TLS layer; we accept any cert here so unauthorized
/// clients can still receive the 401 XML body, then match the presented
/// certificate against the paired-client store in nvhttp.
#[derive(Debug)]
struct AcceptAnyClientCert;

impl rustls::server::danger::ClientCertVerifier for AcceptAnyClientCert {
    fn offer_client_auth(&self) -> bool {
        true
    }

    fn client_auth_mandatory(&self) -> bool {
        false
    }

    fn root_hint_subjects(&self) -> &[rustls::DistinguishedName] {
        &[]
    }

    fn verify_client_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::server::danger::ClientCertVerified, rustls::Error> {
        Ok(rustls::server::danger::ClientCertVerified::assertion())
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

pub async fn serve(state: Arc<State>, port: u16, tls: Option<TlsAcceptor>) -> io::Result<()> {
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
    eprintln!(
        "{} server listening on {}",
        if tls.is_some() { "HTTPS" } else { "HTTP" },
        listener.local_addr()?
    );

    loop {
        let (stream, _peer) = listener.accept().await?;
        let state = state.clone();
        let tls = tls.clone();
        tokio::spawn(async move {
            if let Err(error) = handle_conn(state, stream, tls).await {
                eprintln!("connection error: {error}");
            }
        });
    }
}

pub async fn handle_conn(
    state: Arc<State>,
    stream: TcpStream,
    tls: Option<TlsAcceptor>,
) -> io::Result<()> {
    let local_ip = stream.local_addr()?.ip();
    let peer_ip = stream.peer_addr()?.ip();
    let is_https = tls.is_some();

    let mut io = match tls {
        Some(acceptor) => match acceptor.accept(stream).await {
            Ok(tls_stream) => ConnStream::Tls(tls_stream),
            Err(error) => {
                eprintln!("TLS handshake failed: {error}");
                return Ok(());
            }
        },
        None => ConnStream::Plain(stream),
    };

    let Some((method, target)) = read_request_head(&mut io).await? else {
        return Ok(());
    };
    if method != "GET" {
        return Ok(());
    }

    let peer_cert = match &io {
        ConnStream::Tls(tls) => tls
            .get_ref()
            .1
            .peer_certificates()
            .and_then(|certs| certs.first())
            .map(|cert| cert.as_ref().to_vec()),
        ConnStream::Plain(_) => None,
    };

    let (path, query) = target.split_once('?').unwrap_or((&target, ""));
    eprintln!(
        "nvhttp: request {}://{}{}",
        if is_https { "https" } else { "http" },
        path,
        if query.is_empty() {
            String::new()
        } else {
            format!("?{query}")
        }
    );
    let params = parse_query(query);

    let body = match nvhttp::route(
        &state,
        path,
        &params,
        is_https,
        local_ip,
        peer_ip,
        peer_cert.as_deref(),
    ) {
        nvhttp::RouteOutcome::Ready(body) => body,
        nvhttp::RouteOutcome::ReadyBinary { body, content_type } => {
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let mut response = header.into_bytes();
            response.extend_from_slice(&body);
            io.write_all(&response).await?;
            io.flush().await?;
            let _ = io.shutdown().await;
            return Ok(());
        }
        nvhttp::RouteOutcome::AwaitPairingPin { uniqueid } => {
            // The client (Moonlight) waits indefinitely for the
            // getservercert response while the user enters the PIN shown
            // on the client into Hydra (Sunshine semantics). The wait also
            // has to end when the client goes away: cancelling the PIN
            // dialog closes the connection, and a session parked until the
            // 5-minute timeout would refuse that same client's immediate
            // retry (Moonlight reuses one fixed uniqueid) with a 409.
            let (tx, rx) = tokio::sync::oneshot::channel();
            state.register_pair_response(&uniqueid, tx);
            let (body, abandoned) = {
                // The read future borrows io; the scope ends before the
                // response write below reuses it.
                let gone = wait_for_peer_close(&mut io);
                tokio::pin!(gone);
                tokio::select! {
                    result = tokio::time::timeout(nvhttp::PAIR_TIMEOUT, rx) => {
                        (result.ok().and_then(|result| result.ok()), false)
                    }
                    _ = &mut gone => (None, true),
                }
            };
            match body {
                Some(body) => body,
                None if abandoned => {
                    state.abandon_pairing_session(&uniqueid);
                    nvhttp::pair_fail(400, "Pairing cancelled by client")
                }
                None => {
                    state.expire_pairing_session(&uniqueid);
                    nvhttp::pair_fail(400, "Pairing session expired")
                }
            }
        }
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    io.write_all(response.as_bytes()).await?;
    io.flush().await?;
    let _ = io.shutdown().await;
    Ok(())
}

/// Resolves when the client closes its end of a connection whose response
/// is still being held. EOF or a read error means no response can reach it
/// any more; a cleartext or TLS `close_notify` both surface that way.
///
/// Bytes that are still arriving are *not* a disconnect — they are a
/// pipelining or probing client — so the wait continues instead of treating
/// a live session as abandoned.
async fn wait_for_peer_close(io: &mut (impl AsyncRead + Unpin)) {
    let mut stray = [0u8; 1];
    loop {
        match io.read(&mut stray).await {
            Ok(0) | Err(_) => return,
            Ok(_) => continue,
        }
    }
}

async fn read_request_head(
    io: &mut (impl AsyncRead + Unpin),
) -> io::Result<Option<(String, String)>> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];

    while !buffer.windows(4).any(|window| window == b"\r\n\r\n") {
        if buffer.len() > MAX_REQUEST_SIZE {
            return Ok(None);
        }
        let read = io.read(&mut chunk).await?;
        if read == 0 {
            return Ok(None);
        }
        buffer.extend_from_slice(&chunk[..read]);
    }

    let head = String::from_utf8_lossy(&buffer);
    let Some(request_line) = head.lines().next() else {
        return Ok(None);
    };
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();
    if method.is_empty() || target.is_empty() {
        return Ok(None);
    }
    Ok(Some((method, target)))
}

fn parse_query(query: &str) -> HashMap<String, String> {
    let mut params = HashMap::new();
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        params.insert(
            String::from_utf8_lossy(&percent_decode(key)).into_owned(),
            String::from_utf8_lossy(&percent_decode(value)).into_owned(),
        );
    }
    params
}

fn percent_decode(input: &str) -> Vec<u8> {
    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 3 <= bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
                match hex.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                    Some(decoded) => {
                        output.push(decoded);
                        index += 3;
                    }
                    None => {
                        output.push(bytes[index]);
                        index += 1;
                    }
                }
            }
            b'+' => {
                output.push(b' ');
                index += 1;
            }
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_parsing_decodes_percent_and_plus() {
        let params = parse_query("devicename=roth+pc&phrase=getservercert&salt=%2Aabc&flag&empty=");
        assert_eq!(params["devicename"], "roth pc");
        assert_eq!(params["phrase"], "getservercert");
        assert_eq!(params["salt"], "*abc");
        assert_eq!(params["empty"], "");
        assert!(!params.contains_key("flag"));
    }
}
