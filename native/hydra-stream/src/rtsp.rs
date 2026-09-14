use std::collections::HashMap;
use std::io;
use std::sync::Arc;

use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_128_GCM};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::config;
use crate::nvhttp::State;

pub const RTSP_PORT: u16 = 48010;

const RTSP_SESSION_ID: &str = "DEADBEEFCAFE";
const MAX_MESSAGE_SIZE: usize = 16 * 1024;
const ENCRYPTED_HEADER_SIZE: usize = 24;
const ENCRYPTED_MESSAGE_BIT: u32 = 0x8000_0000;

/// Base for the media UDP ports advertised in SETUP responses; the client
/// sends its pings there and the host learns the client endpoint from
/// them. Configurable via the environment for development.
fn stream_port(kind: &str) -> u16 {
    let ports = config::ports();
    match kind {
        "audio" => ports.audio,
        "video" => ports.video,
        "control" => ports.control,
        _ => 0,
    }
}

/// SDP advertised in DESCRIBE responses. Feature flags 0 (no Sunshine
/// extensions) and stereo/5.1/7.1 Opus layouts with GFE's channel ordering,
/// so Moonlight negotiates H.264/HEVC + Opus without surround hardcoded
/// fallback.
///
/// The five `surround-params` lines are Sunshine's `stream_configs` in order
/// (`audio.cpp:51-100`): stereo 2/1/1, 5.1 6/4/2, 5.1 6/6/0, 7.1 8/5/3,
/// 7.1 8/8/0 (both stereo rows advertise the identical string). The channel
/// digits are the layout's mapping in Moonlight's speaker order, with GFE's
/// rotation applied to the NORMAL-QUALITY 5.1 and 7.1 rows only
/// (`rtsp.cpp:975-993`): those two advertise `012453` / `01245673` instead
/// of the unrotated `012345` / `01234567` tables from
/// `platform/common.h:292-316`, because the client compensates the rotation
/// GFE has always sent. The host's encoder uses the unrotated mapping.
///
/// The 7.1 NORMAL row is a deliberate deviation, not a copy error: Sunshine's
/// `std::rotate` spans only `[3, audio::MAX_STREAM_CONFIG)` (`rtsp.cpp:982`),
/// and `MAX_STREAM_CONFIG` is the enum's length, 6 (`audio.h:18-26`), so its
/// 8-channel row would print `01245367`; ours rotates the whole `[3,8)` tail
/// (`platf::speaker::MAX_SPEAKERS`), so the rewrite the client applies in
/// `RtspConnection.c parseOpusConfigurations` (`N[3] = M[channelCount-1]`,
/// `N[4..] = M[3..channelCount-1]`) yields the identity mapping our encoder is
/// configured with. Do not "correct" `01245673` back.
///
/// The `refPicInvalidation` attribute is appended only when the startup
/// probe found the session's encoder able to invalidate reference frames:
/// moonlight-common-c detects RFI by substring match on this payload
/// (RtspConnection.c), and without the attribute the client discards every
/// frame after a loss and waits for a full IDR instead of resuming on the
/// host's frameType-5 recovery frame (VideoDepacketizer.c). Sunshine emits
/// exactly this line when its encoder probe supports RFI (rtsp.cpp). The
/// remaining lines are byte-identical to the pre-RFI SDP.
///
/// The HEVC marker is the `sprop-parameter-sets=AAAAAU` line Sunshine emits
/// when its probe found an HEVC encoder (`rtsp.cpp:955-956`). It is NOT
/// SDP: there is no `a=` prefix, and the payload is the base64 of the
/// annex-B start code `00 00 00 01`, not a parameter set. It is the only
/// signal the client uses to decide whether this host can do HEVC —
/// `RtspConnection.c:1104-1119` substring-matches it because the host (GFE,
/// and Sunshine in its wake) keeps the HEVC format's MIME type as H264, so
/// the client cannot look for an HEVC MIME type instead. Without it a
/// client that supports HEVC never offers it, however much the serverinfo
/// advertises.
///
/// The marker is a host capability, not a session choice: DESCRIBE arrives
/// before ANNOUNCE, and it is what makes the client offer HEVC there.
fn describe_sdp() -> String {
    let capability = crate::capture::recovery_capability();
    describe_sdp_for(capability.rfi, capability.hevc)
}

/// The SDP for a given probed capability pair. Pure, so both the RFI and
/// the HEVC advertisements are testable without a GPU.
fn describe_sdp_for(rfi: bool, hevc: bool) -> String {
    let mut sdp = String::from(concat!(
        "a=x-ss-general.featureFlags:0\n",
        "a=fmtp:97 surround-params=21101\n",
        "a=fmtp:97 surround-params=642012453\n",
        "a=fmtp:97 surround-params=660012345\n",
        "a=fmtp:97 surround-params=85301245673\n",
        "a=fmtp:97 surround-params=88001234567\n",
    ));
    if rfi {
        sdp.push_str("a=x-nv-video[0].refPicInvalidation:1\n");
    }
    if hevc {
        sdp.push_str(HEVC_SDP_MARKER);
    }
    sdp
}

/// Sunshine's HEVC capability marker (`rtsp.cpp:956`), verbatim: no `a=`
/// prefix, no trailing attribute name. The client's `strstr` is exact.
pub const HEVC_SDP_MARKER: &str = "sprop-parameter-sets=AAAAAU\n";

pub async fn serve(state: Arc<State>, port: u16) -> io::Result<()> {
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
    eprintln!("RTSP server listening on {}", listener.local_addr()?);

    loop {
        let (stream, peer) = listener.accept().await?;
        eprintln!("rtsp: connection from {peer}");
        let state = state.clone();
        tokio::spawn(async move {
            if let Err(error) = handle_conn(state, stream).await {
                eprintln!("rtsp connection error: {error}");
            }
        });
    }
}

pub async fn handle_conn(state: Arc<State>, mut stream: TcpStream) -> io::Result<()> {
    let peer = stream
        .peer_addr()
        .map(|addr| addr.to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    let result = handle_request(&state, &mut stream, &peer).await;
    eprintln!("rtsp: connection with {peer} closed");
    result
}

/// Handles one RTSP message. Moonlight (like GFE) opens a fresh TCP
/// connection per request and reads until the server closes it, so we answer
/// a single request and shut the connection down, mirroring Sunshine.
async fn handle_request(state: &State, stream: &mut TcpStream, peer: &str) -> io::Result<()> {
    // RTSP is tied to the /launch session: without a pending or active
    // session the connection is dropped unanswered.
    if !state.rtsp_contact() {
        eprintln!("rtsp: dropping {peer}: no session pending");
        return Ok(());
    }
    let Some(launch) = state.launch_params() else {
        eprintln!("rtsp: dropping {peer}: no launch params");
        return Ok(());
    };
    // The handshake tells us WHO the session's client is: its source IP is
    // the authoritative media destination (the audio sender accepts that IP
    // and no other). Recorded on the first connection of the session only.
    if let Ok(address) = stream.peer_addr() {
        state.note_rtsp_client(address.ip());
    }

    let Some(plaintext) = read_message(stream, &launch).await? else {
        return Ok(());
    };
    let Some(request) = parse_request(&plaintext) else {
        write_response(
            stream,
            state,
            &launch,
            RtspResponse {
                code: 400,
                reason: "BAD REQUEST",
                headers: vec![("CSeq", "0".to_string())],
                body: Vec::new(),
            },
        )
        .await?;
        return Ok(());
    };

    eprintln!(
        "rtsp: request {} {} (CSeq {}) from {peer}",
        request.method, request.target, request.cseq
    );
    let response = dispatch(state, &launch, &request);
    write_response(stream, state, &launch, response).await?;
    Ok(())
}

struct RtspRequest {
    method: String,
    target: String,
    cseq: u32,
    body: Vec<u8>,
}

struct RtspResponse {
    code: u32,
    reason: &'static str,
    headers: Vec<(&'static str, String)>,
    body: Vec<u8>,
}

fn ok(request: &RtspRequest) -> RtspResponse {
    RtspResponse {
        code: 200,
        reason: "OK",
        headers: vec![("CSeq", request.cseq.to_string())],
        body: Vec::new(),
    }
}

fn not_found(request: &RtspRequest) -> RtspResponse {
    RtspResponse {
        code: 404,
        reason: "NOT FOUND",
        headers: vec![("CSeq", request.cseq.to_string())],
        body: Vec::new(),
    }
}

fn dispatch(state: &State, launch: &crate::nvhttp::LaunchParams, request: &RtspRequest) -> RtspResponse {
    match request.method.as_str() {
        "OPTIONS" => ok(request),
        "DESCRIBE" => {
            let sdp = describe_sdp();
            let mut response = ok(request);
            response
                .headers
                .push(("Content-type", "application/sdp".to_string()));
            response
                .headers
                .push(("Content-length", sdp.len().to_string()));
            response.body = sdp.into_bytes();
            response
        }
        "SETUP" => setup_response(launch, request),
        "ANNOUNCE" => {
            let body = String::from_utf8_lossy(&request.body);
            let client = body
                .lines()
                .find_map(|line| line.strip_prefix("s="))
                .unwrap_or("unknown")
                .to_string();
            let attrs: HashMap<String, String> = body
                .lines()
                .filter_map(|line| {
                    let attribute = line.strip_prefix("a=")?;
                    let (name, value) = attribute.split_once(':')?;
                    Some((name.trim().to_string(), value.trim().to_string()))
                })
                .collect();
            state.update_announcement(&attrs);
            let key_attrs = [
                "x-nv-video[0].packetSize",
                "x-nv-video[0].maxFPS",
                "x-nv-vqos[0].bw.maximumBitrateKbps",
                "x-nv-video[0].videoEncoderSlicesPerFrame",
                "x-nv-video[0].maxNumReferenceFrames",
                "x-nv-aqos.packetDuration",
                "x-nv-vqos[0].fec.minRequiredFecPackets",
                "x-nv-audio.surround.AudioQuality",
            ]
            .iter()
            .filter_map(|key| attrs.get(*key).map(|value| format!("{key}={value}")))
            .collect::<Vec<_>>()
            .join(", ");
            eprintln!(
                "rtsp: ANNOUNCE from {client} ({} bytes, {} attrs, {key_attrs})",
                request.body.len(),
                attrs.len()
            );
            // The ANNOUNCE attribute set is the only record of what the
            // client negotiated (protocol version, capability flags, FEC,
            // surround); dump it in full, sorted for stable diffs, so a
            // capability mismatch can be diagnosed without a capture.
            let mut attr_names: Vec<&String> = attrs.keys().collect();
            attr_names.sort();
            eprintln!("rtsp: ANNOUNCE attribute dump from {client}:");
            for name in attr_names {
                let value = &attrs[name];
                if is_sensitive_attr(name) {
                    eprintln!("rtsp: ANNOUNCE attr {name}=[redacted]");
                } else {
                    eprintln!("rtsp: ANNOUNCE attr {name}={value}");
                }
            }
            ok(request)
        }
        "PLAY" => {
            eprintln!("rtsp: PLAY received, starting stream");
            if state.mark_streaming() {
                state.start_streaming();
            }
            ok(request)
        }
        "TEARDOWN" => {
            state.end_session("teardown");
            ok(request)
        }
        // Not used by moonlight-common-c, but answered for keepalive-style
        // clients; Sunshine instead 404s unknown commands.
        "GET_PARAMETER" => ok(request),
        _ => not_found(request),
    }
}

/// ANNOUNCE names whose value carries key material or a pairing secret: the
/// debug dump logs every attribute, so anything that looks like a secret is
/// redacted instead (the same rule the /launch logging applies to
/// `rikey`/`salt`/`phrase`).
fn is_sensitive_attr(name: &str) -> bool {
    let lowered = name.to_ascii_lowercase();
    ["rikey", "key", "salt", "phrase", "token", "password"]
        .iter()
        .any(|needle| lowered.contains(needle))
}

fn setup_response(launch: &crate::nvhttp::LaunchParams, request: &RtspRequest) -> RtspResponse {
    // Target looks like "streamid=audio/0/0"; the stream kind is whatever
    // follows '=' up to the next '/'.
    let stream_kind = request
        .target
        .split_once('=')
        .map(|(_, rest)| rest)
        .unwrap_or("")
        .split('/')
        .next()
        .unwrap_or("");

    let (port, extra_header) = match stream_kind {
        "audio" => (
            stream_port("audio"),
            ("X-SS-Ping-Payload", launch.av_ping_payload.clone()),
        ),
        "video" => (
            stream_port("video"),
            ("X-SS-Ping-Payload", launch.av_ping_payload.clone()),
        ),
        "control" => (
            stream_port("control"),
            ("X-SS-Connect-Data", launch.control_connect_data.to_string()),
        ),
        _ => return not_found(request),
    };

    let mut response = ok(request);
    response
        .headers
        .push(("Session", format!("{RTSP_SESSION_ID};timeout = 90")));
    response
        .headers
        .push(("Transport", format!("server_port={port}")));
    response.headers.push(extra_header);
    response
}

/// Reads one full RTSP message (headers + body) in the session's transport
/// framing and returns the plaintext bytes.
async fn read_message(
    stream: &mut TcpStream,
    launch: &crate::nvhttp::LaunchParams,
) -> io::Result<Option<Vec<u8>>> {
    if launch.encrypted_rtsp {
        read_encrypted(stream, &launch.rikey).await
    } else {
        read_plaintext(stream).await
    }
}

async fn read_plaintext(stream: &mut TcpStream) -> io::Result<Option<Vec<u8>>> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];

    let head_end = loop {
        if let Some(position) = find(&buffer, b"\r\n\r\n") {
            break position + 4;
        }
        if buffer.len() > MAX_MESSAGE_SIZE {
            return Ok(None);
        }
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Ok(None);
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let content_length = parse_headers(&buffer[..head_end])
        .1
        .get("content-length")
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_MESSAGE_SIZE {
        return Ok(None);
    }

    while buffer.len() < head_end + content_length {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Ok(None);
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    buffer.truncate(head_end + content_length);
    Ok(Some(buffer))
}

/// GameStream encrypted RTSP framing: a 24-byte header (typeAndLength with
/// the encrypted bit set, sequence number, GCM tag) followed by the
/// AES-128-GCM ciphertext of the full RTSP message, keyed by the launch
/// rikey. The IV is the sequence number in bytes 0-3 with 'CR' at 10-11.
async fn read_encrypted(stream: &mut TcpStream, rikey: &[u8; 16]) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0u8; ENCRYPTED_HEADER_SIZE];
    if stream.read_exact(&mut header).await.is_err() {
        return Ok(None);
    }

    let type_and_length = u32::from_be_bytes(header[..4].try_into().expect("4 bytes"));
    if type_and_length & ENCRYPTED_MESSAGE_BIT == 0 {
        return Ok(None);
    }
    let length = (type_and_length & !ENCRYPTED_MESSAGE_BIT) as usize;
    if length == 0 || length > MAX_MESSAGE_SIZE {
        return Ok(None);
    }

    let sequence = u32::from_be_bytes(header[4..8].try_into().expect("4 bytes"));
    let mut sealed = vec![0u8; length + 16];
    if stream.read_exact(&mut sealed[..length]).await.is_err() {
        return Ok(None);
    }
    sealed[length..].copy_from_slice(&header[8..24]);

    let key = LessSafeKey::new(UnboundKey::new(&AES_128_GCM, rikey).expect("AES-128 key"));
    let plaintext = key
        .open_in_place(nonce(sequence, *b"CR"), Aad::empty(), &mut sealed)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "rtsp decrypt failed"))?;
    let plaintext = plaintext.to_vec();
    Ok(Some(plaintext))
}

fn parse_request(plaintext: &[u8]) -> Option<RtspRequest> {
    let text = String::from_utf8_lossy(plaintext);
    let mut lines = text.split("\r\n");

    let request_line = lines.next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();

    let headers: HashMap<String, String> = lines
        .take_while(|line| !line.is_empty())
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            Some((name.trim().to_ascii_lowercase(), value.trim().to_string()))
        })
        .collect();
    let cseq = headers
        .get("cseq")
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(0);
    let content_length = headers
        .get("content-length")
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0);

    let body_offset = text
        .find("\r\n\r\n")
        .map(|position| position + 4)
        .unwrap_or(text.len());
    let body_end = (body_offset + content_length).min(plaintext.len());
    let body = plaintext.get(body_offset..body_end).unwrap_or(&[]).to_vec();

    Some(RtspRequest {
        method,
        target,
        cseq,
        body,
    })
}

/// Splits a header block into (request line, lowercased header map).
fn parse_headers(head: &[u8]) -> (String, HashMap<String, String>) {
    let text = String::from_utf8_lossy(head);
    let mut lines = text.split("\r\n");
    let request_line = lines.next().unwrap_or("").to_string();
    let headers = lines
        .take_while(|line| !line.is_empty())
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            Some((name.trim().to_ascii_lowercase(), value.trim().to_string()))
        })
        .collect();
    (request_line, headers)
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn nonce(sequence: u32, suffix: [u8; 2]) -> Nonce {
    let mut bytes = [0u8; 12];
    bytes[..4].copy_from_slice(&sequence.to_le_bytes());
    bytes[10] = suffix[0];
    bytes[11] = suffix[1];
    Nonce::assume_unique_for_key(bytes)
}

async fn write_response(
    stream: &mut TcpStream,
    state: &State,
    launch: &crate::nvhttp::LaunchParams,
    response: RtspResponse,
) -> io::Result<()> {
    let cseq = response
        .headers
        .iter()
        .find(|(name, _)| *name == "CSeq")
        .map(|(_, value)| value.as_str())
        .unwrap_or("?");
    eprintln!(
        "rtsp: response {} {} (CSeq {})",
        response.code, response.reason, cseq
    );
    let mut serialized = format!(
        "RTSP/1.0 {} {}\r\n",
        response.code, response.reason
    );
    for (name, value) in &response.headers {
        serialized.push_str(&format!("{name}: {value}\r\n"));
    }
    serialized.push_str("\r\n");
    let mut plaintext = serialized.into_bytes();
    plaintext.extend_from_slice(&response.body);

    if launch.encrypted_rtsp {
        let sequence = state.next_rtsp_seq();
        let key = LessSafeKey::new(UnboundKey::new(&AES_128_GCM, &launch.rikey).expect("AES-128 key"));
        let tag = key
            .seal_in_place_separate_tag(nonce(sequence, *b"HR"), Aad::empty(), &mut plaintext)
            .expect("rtsp encrypt");

        let mut framed = Vec::with_capacity(ENCRYPTED_HEADER_SIZE + plaintext.len());
        framed.extend_from_slice(&((plaintext.len() as u32) | ENCRYPTED_MESSAGE_BIT).to_be_bytes());
        framed.extend_from_slice(&sequence.to_be_bytes());
        framed.extend_from_slice(tag.as_ref());
        framed.extend_from_slice(&plaintext);
        stream.write_all(&framed).await?;
    } else {
        stream.write_all(&plaintext).await?;
    }
    stream.flush().await?;
    let _ = stream.shutdown().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_request_line_headers_and_body() {
        let raw = b"OPTIONS rtsp://0.0.0.0:48010 RTSP/1.0\r\nCSeq: 7\r\nHost: 0.0.0.0\r\n\r\n";
        let request = parse_request(raw).expect("request");
        assert_eq!(request.method, "OPTIONS");
        assert_eq!(request.target, "rtsp://0.0.0.0:48010");
        assert_eq!(request.cseq, 7);
        assert!(request.body.is_empty());
    }

    #[test]
    fn parses_announce_body_via_content_length() {
        let sdp = "v=0\r\ns=Moonlight\r\na=x-nv-video[0].maxFPS:60\r\n";
        let raw = format!(
            "ANNOUNCE streamid=control/13/0 RTSP/1.0\r\nCSeq: 9\r\nSession: DEADBEEFCAFE\r\nContent-type: application/sdp\r\nContent-length: {}\r\n\r\n{}",
            sdp.len(),
            sdp
        );
        let request = parse_request(raw.as_bytes()).expect("request");
        assert_eq!(request.method, "ANNOUNCE");
        assert_eq!(request.cseq, 9);
        assert_eq!(request.body, sdp.as_bytes());
    }

    /// The base SDP lines must survive the RFI work byte-identically
    /// (Moonlight substring-matches them), and the capability attribute
    /// must follow exactly the probed capability — it is what makes the
    /// client send 0-length invalidation requests instead of only begging
    /// for IDRs.
    #[test]
    fn describe_sdp_advertises_rfi_only_when_probed() {
        let sdp = describe_sdp();
        for line in [
            "a=x-ss-general.featureFlags:0\n",
            "a=fmtp:97 surround-params=21101\n",
            "a=fmtp:97 surround-params=642012453\n",
            "a=fmtp:97 surround-params=660012345\n",
            "a=fmtp:97 surround-params=85301245673\n",
            "a=fmtp:97 surround-params=88001234567\n",
        ] {
            assert!(sdp.contains(line), "missing {line:?} in {sdp:?}");
        }
        assert_eq!(
            sdp.contains("a=x-nv-video[0].refPicInvalidation:1\n"),
            crate::capture::recovery_capability().rfi,
            "the attribute must track the probed capability: {sdp:?}"
        );
    }

    /// The HEVC capability marker: exactly Sunshine's line, no `a=`
    /// prefix, and only when the probe found an HEVC session. The client
    /// substring-matches `sprop-parameter-sets=AAAAAU`
    /// (`RtspConnection.c:1104`), so the marker is also asserted as a
    /// substring of the emitted body, not as an SDP attribute.
    #[test]
    fn describe_sdp_advertises_hevc_only_when_the_probe_did() {
        let with_hevc = describe_sdp_for(true, true);
        assert!(
            with_hevc.contains("sprop-parameter-sets=AAAAAU"),
            "the client's strstr must match: {with_hevc:?}"
        );
        assert!(
            with_hevc.lines().any(|line| line == "sprop-parameter-sets=AAAAAU"),
            "the marker is its own line, verbatim and without an a= prefix: {with_hevc:?}"
        );
        assert!(!with_hevc.contains("a=sprop-parameter-sets"), "{with_hevc:?}");
        // the RFI attribute keeps its place before it (Sunshine's order:
        // rtsp.cpp emits refPicInvalidation, then the HEVC marker)
        let rfi_at = with_hevc.find("a=x-nv-video[0].refPicInvalidation:1").expect("rfi");
        let hevc_at = with_hevc.find("sprop-parameter-sets").expect("hevc");
        assert!(rfi_at < hevc_at, "{with_hevc:?}");

        // no HEVC session: not a byte of it, and the H.264 SDP is the one
        // the pre-HEVC host sent
        let h264_only = describe_sdp_for(true, false);
        assert!(!h264_only.contains("sprop-parameter-sets"), "{h264_only:?}");
        assert!(!h264_only.contains("AAAAAU"), "{h264_only:?}");

        // and the live call tracks the same probe the serverinfo uses
        assert_eq!(
            describe_sdp().contains(HEVC_SDP_MARKER),
            crate::capture::recovery_capability().hevc,
        );
    }

    /// The five surround-params lines, in Sunshine's `stream_configs` order
    /// (`audio.cpp:51-100`), as GFE advertises them (`rtsp.cpp:975-993`):
    /// only the normal-quality 5.1 and 7.1 rows carry the rotated channel
    /// mapping, so their digits end in `3` (`012453` / `01245673`); the
    /// high-quality rows advertise the unrotated `012345` / `01234567`.
    /// Moonlight builds its `opus_multistream` decoder from these strings
    /// (`RtspConnection.c parseOpusConfigurations`), which is why a 5.1/7.1
    /// client only decodes packets encoded with the matching layout.
    #[test]
    fn describe_sdp_advertises_sunshine_surround_params() {
        let sdp = describe_sdp();
        let advertised: Vec<&str> = sdp
            .lines()
            .filter_map(|line| line.strip_prefix("a=fmtp:97 surround-params="))
            .collect();
        assert_eq!(
            advertised,
            [
                "21101", // stereo 2/1/1 (normal and high quality), mapping [0,1]
                "642012453",   // 5.1 normal 6/4/2, rotated from index 3
                "660012345",   // 5.1 high quality 6/6/0, unrotated
                "85301245673", // 7.1 normal 8/5/3, rotated from index 3
                "88001234567", // 7.1 high quality 8/8/0, unrotated
            ]
        );
    }

    #[test]
    fn setup_extracts_stream_kind_from_target() {
        let request = RtspRequest {
            method: "SETUP".to_string(),
            target: "streamid=audio/0/0".to_string(),
            cseq: 3,
            body: Vec::new(),
        };
        let launch = crate::nvhttp::LaunchParams {
            uniqueid: String::new(),
            appid: 1,
            width: 0,
            height: 0,
            fps: 0,
            rikey: [0; 16],
            rikeyid: 0,
            encrypted_rtsp: false,
            av_ping_payload: "aabb".to_string(),
            control_connect_data: 42,
            activity: std::time::Instant::now(),
            packet_size: crate::video::DEFAULT_PACKET_SIZE,
            bitrate_kbps: 10_000,
            slices_per_frame: 1,
            max_ref_frames: None,
            host_audio: false,
            packet_duration_ms: crate::audio::DEFAULT_PACKET_DURATION_MS,
            min_required_fec_packets: 0,
            requested_channels: 2,
            audio_quality: None,
            surround_enabled: true,
            video_qos_type: None,
            audio_qos_type: None,
            audio_encryption: false,
            codec: crate::video::VideoCodec::H264,
        };
        let response = setup_response(&launch, &request);
        assert_eq!(response.code, 200);
        let headers: HashMap<_, _> = response.headers.into_iter().collect();
        assert_eq!(headers["Transport"], "server_port=48000");
        assert!(headers["Session"].starts_with("DEADBEEFCAFE;timeout = 90"));

        let unknown = RtspRequest {
            target: "streamid=wat/0/0".to_string(),
            ..request
        };
        assert_eq!(setup_response(&launch, &unknown).code, 404);
    }
}
