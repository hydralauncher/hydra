//! services/sse/websocket-client.ts: the realtime WebSocket. A token from
//! POST /auth/realtime opens `wss://…` with `Authorization: Bearer`; events
//! arrive as `{ v: 1, eventId, publishedAt, event, payload }` envelopes.
//! Reconnects with full jitter, honours Retry-After and close-reason hints,
//! pings every 30s and drops duplicate events and stale presence versions.

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
use tungstenite::client::IntoClientRequest;
use tungstenite::protocol::Message;

use crate::api::{ApiError, HydraApi, Options};

const INITIAL_RECONNECT_DELAY_MS: u64 = 1_000;
const MAX_RECONNECT_DELAY_MS: u64 = 30_000;
const DROPPED_CONNECTION_SPREAD_MS: u64 = 30_000;
const RESUME_RECONNECT_SPREAD_MS: u64 = 5_000;
const MIN_RANDOMIZED_DELAY_MS: u64 = 250;
const TOKEN_EXPIRY_SKEW_MS: i64 = 30_000;
const MAX_SEEN_EVENT_IDS: usize = 1_000;
const SERVICE_RESTART_CLOSE: u16 = 1_012;
const TRY_AGAIN_LATER_CLOSE: u16 = 1_013;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
/// How often the reader wakes up to check for stop requests and heartbeats.
const POLL: Duration = Duration::from_millis(500);

/// One realtime event (RealtimeEnvelope).
#[derive(Clone, Debug)]
pub struct Envelope {
    pub event_id: String,
    pub event: String,
    pub payload: Value,
}

type EventHandler = Box<dyn Fn(Envelope) + Send + Sync>;
type ReconnectHandler = Box<dyn Fn() + Send + Sync>;

struct Token {
    value: String,
    url: String,
    expires_at: i64,
}

#[derive(Default)]
struct Session {
    token: Option<Token>,
    seen: VecDeque<String>,
    seen_set: HashSet<String>,
    presence: HashMap<String, f64>,
}

struct AttemptResult {
    connected: bool,
    retry_after_ms: Option<u64>,
    server_drain: bool,
}

enum Attempt {
    Done(AttemptResult),
    /// shouldStop: not signed in
    Terminal,
}

pub struct Realtime {
    api: Arc<HydraApi>,
    on_event: EventHandler,
    on_reconnect: ReconnectHandler,
    /// Bumped by connect/close: a loop from an older epoch exits.
    epoch: AtomicU64,
    force_reconnect: AtomicBool,
    session: Mutex<Session>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// Math.random without a dependency: hash the clock with a random state.
fn random() -> f64 {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos()),
    );
    (hasher.finish() >> 11) as f64 / (1u64 << 53) as f64
}

/// fullJitterDelay
pub fn full_jitter_delay(attempt: u32, random: f64) -> u64 {
    let cap = (INITIAL_RECONNECT_DELAY_MS
        .saturating_mul(1u64 << attempt.saturating_sub(1).min(20)))
    .min(MAX_RECONNECT_DELAY_MS);
    (random * cap as f64).floor() as u64
}

/// parseRetryAfter: seconds, or an HTTP date.
pub fn parse_retry_after(value: &str, now_ms: i64) -> Option<u64> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if let Ok(seconds) = value.parse::<f64>() {
        return (seconds.is_finite() && seconds >= 0.0).then(|| (seconds * 1000.0) as u64);
    }
    let date = chrono::DateTime::parse_from_rfc2822(value).ok()?;
    Some((date.timestamp_millis() - now_ms).max(0) as u64)
}

/// retryHintFromCloseReason: `{"retryAfterMs": n}` or `{"retryAfterSeconds": n}`.
fn retry_hint(reason: &str) -> Option<u64> {
    let hint: Value = serde_json::from_str(reason).ok()?;
    if let Some(ms) = hint
        .get("retryAfterMs")
        .and_then(Value::as_f64)
        .filter(|v| *v >= 0.0)
    {
        return Some(ms as u64);
    }
    hint.get("retryAfterSeconds")
        .and_then(Value::as_f64)
        .filter(|v| *v >= 0.0)
        .map(|s| (s * 1000.0) as u64)
}

/// readJwtExpiration
fn jwt_expiration(token: &str) -> Option<i64> {
    let part = token.split('.').nth(1)?;
    let bytes = base64url_decode(part)?;
    let payload: Value = serde_json::from_slice(&bytes).ok()?;
    payload
        .get("exp")
        .and_then(Value::as_f64)
        .map(|exp| (exp * 1000.0) as i64)
}

fn base64url_decode(input: &str) -> Option<Vec<u8>> {
    let value = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            _ => return None,
        })
    };
    let mut out = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0;
    for c in input.bytes().filter(|c| *c != b'=') {
        buffer = (buffer << 6) | value(c)?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Some(out)
}

/// parseRealtimeEnvelope (the shape checks; payload checks are the handlers').
pub fn parse_envelope(text: &str) -> Option<Envelope> {
    let value: Value = serde_json::from_str(text).ok()?;
    if value.get("v").and_then(Value::as_i64) != Some(1) {
        return None;
    }
    let event_id = value
        .get("eventId")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())?
        .to_string();
    let published = value.get("publishedAt")?;
    let published_ok = published.as_f64().is_some_and(f64::is_finite)
        || published
            .as_str()
            .is_some_and(|s| !s.is_empty() && chrono::DateTime::parse_from_rfc3339(s).is_ok());
    if !published_ok {
        return None;
    }
    let event = value.get("event").and_then(Value::as_str)?.to_string();
    let payload = value.get("payload").filter(|p| p.is_object())?.clone();
    Some(Envelope {
        event_id,
        event,
        payload,
    })
}

/// A blocking TCP or TLS stream with a read timeout.
enum Stream {
    Plain(TcpStream),
    Tls(Box<rustls::StreamOwned<rustls::ClientConnection, TcpStream>>),
}

impl Read for Stream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Stream::Plain(s) => s.read(buf),
            Stream::Tls(s) => s.read(buf),
        }
    }
}

impl Write for Stream {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            Stream::Plain(s) => s.write(buf),
            Stream::Tls(s) => s.write(buf),
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Stream::Plain(s) => s.flush(),
            Stream::Tls(s) => s.flush(),
        }
    }
}

impl Stream {
    fn tcp(&self) -> &TcpStream {
        match self {
            Stream::Plain(s) => s,
            Stream::Tls(s) => s.get_ref(),
        }
    }
}

fn open_stream(url: &reqwest::Url) -> std::io::Result<Stream> {
    let host = url
        .host_str()
        .ok_or_else(|| std::io::Error::new(ErrorKind::InvalidInput, "no host"))?
        .to_string();
    let secure = url.scheme() == "wss";
    let port = url
        .port_or_known_default()
        .unwrap_or(if secure { 443 } else { 80 });
    let address = (host.as_str(), port)
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| std::io::Error::new(ErrorKind::NotFound, "no address"))?;
    let tcp = TcpStream::connect_timeout(&address, HANDSHAKE_TIMEOUT)?;
    tcp.set_read_timeout(Some(HANDSHAKE_TIMEOUT))?;
    tcp.set_nodelay(true)?;
    if !secure {
        return Ok(Stream::Plain(tcp));
    }
    use rustls_platform_verifier::ConfigVerifierExt;
    let config = rustls::ClientConfig::with_platform_verifier().map_err(std::io::Error::other)?;
    let name = rustls::pki_types::ServerName::try_from(host).map_err(std::io::Error::other)?;
    let connection =
        rustls::ClientConnection::new(Arc::new(config), name).map_err(std::io::Error::other)?;
    Ok(Stream::Tls(Box::new(rustls::StreamOwned::new(
        connection, tcp,
    ))))
}

fn is_timeout(error: &tungstenite::Error) -> bool {
    matches!(error, tungstenite::Error::Io(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut))
}

impl Realtime {
    pub fn new(
        api: Arc<HydraApi>,
        on_event: impl Fn(Envelope) + Send + Sync + 'static,
        on_reconnect: impl Fn() + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            api,
            on_event: Box::new(on_event),
            on_reconnect: Box::new(on_reconnect),
            epoch: AtomicU64::new(0),
            force_reconnect: AtomicBool::new(false),
            session: Mutex::new(Session::default()),
        })
    }

    fn session(&self) -> std::sync::MutexGuard<'_, Session> {
        self.session.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// SSEClient.connect: (re)start the loop on a worker thread.
    pub fn connect(self: &Arc<Self>) {
        let epoch = self.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        self.force_reconnect.store(false, Ordering::SeqCst);
        let this = self.clone();
        let _ = std::thread::Builder::new()
            .name("realtime".into())
            .spawn(move || this.run_loop(epoch));
    }

    /// SSEClient.close: stop and forget the session (sign-out).
    pub fn close(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        *self.session() = Session::default();
    }

    /// reconnectNow (resume from sleep / network change).
    pub fn reconnect_now(&self) {
        self.force_reconnect.store(true, Ordering::SeqCst);
    }

    fn active(&self, epoch: u64) -> bool {
        self.epoch.load(Ordering::SeqCst) == epoch
    }

    fn sleep(&self, epoch: u64, ms: u64) {
        let until = Instant::now() + Duration::from_millis(ms);
        while Instant::now() < until
            && self.active(epoch)
            && !self.force_reconnect.load(Ordering::SeqCst)
        {
            std::thread::sleep(
                Duration::from_millis(100).min(until.saturating_duration_since(Instant::now())),
            );
        }
    }

    fn run_loop(self: Arc<Self>, epoch: u64) {
        let mut attempt: u32 = 0;
        let mut connected_before = false;
        while self.active(epoch) {
            if self.force_reconnect.swap(false, Ordering::SeqCst) {
                self.sleep(
                    epoch,
                    MIN_RANDOMIZED_DELAY_MS + (random() * RESUME_RECONNECT_SPREAD_MS as f64) as u64,
                );
                if !self.active(epoch) {
                    return;
                }
            }
            let result = match self.connect_once(epoch, &mut || {
                attempt = 0;
                if connected_before {
                    (self.on_reconnect)();
                }
                connected_before = true;
            }) {
                Attempt::Terminal => {
                    eprintln!("Realtime connect skipped: user is not logged in");
                    return;
                }
                Attempt::Done(result) => result,
            };
            if !self.active(epoch) {
                return;
            }
            let resume = self.force_reconnect.swap(false, Ordering::SeqCst);
            attempt += 1;
            let delay = if resume {
                MIN_RANDOMIZED_DELAY_MS + (random() * RESUME_RECONNECT_SPREAD_MS as f64) as u64
            } else if let Some(retry) = result.retry_after_ms {
                retry
                    + MIN_RANDOMIZED_DELAY_MS
                    + (random() * INITIAL_RECONNECT_DELAY_MS as f64) as u64
            } else if result.connected || result.server_drain {
                INITIAL_RECONNECT_DELAY_MS + (random() * DROPPED_CONNECTION_SPREAD_MS as f64) as u64
            } else {
                full_jitter_delay(attempt, random())
            };
            eprintln!(
                "Realtime WebSocket reconnecting in {}s",
                (delay as f64 / 1000.0).round()
            );
            self.sleep(epoch, delay);
        }
    }

    fn token(&self) -> Result<(String, String), ApiError> {
        {
            let session = self.session();
            if let Some(token) = &session.token
                && token.expires_at - TOKEN_EXPIRY_SKEW_MS > now_ms()
            {
                return Ok((token.value.clone(), token.url.clone()));
            }
        }
        let response = self
            .api
            .post("/auth/realtime", &Value::Null, Options::default())?;
        let value = response
            .get("token")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let url = response
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if url.is_empty() {
            return Err(ApiError::Network(
                "Realtime token response omitted URL".into(),
            ));
        }
        let expires_at = jwt_expiration(&value).unwrap_or_else(|| {
            match response.get("expiresIn").and_then(Value::as_f64) {
                Some(seconds) if seconds > 0.0 => now_ms() + (seconds * 1000.0) as i64,
                _ => now_ms(),
            }
        });
        self.session().token = Some(Token {
            value: value.clone(),
            url: url.clone(),
            expires_at,
        });
        Ok((value, url))
    }

    fn connect_once(&self, epoch: u64, on_open: &mut dyn FnMut()) -> Attempt {
        let failed = |retry_after_ms, server_drain| {
            Attempt::Done(AttemptResult {
                connected: false,
                retry_after_ms,
                server_drain,
            })
        };
        let (token, url) = match self.token() {
            Ok(credentials) => credentials,
            Err(ApiError::NotLoggedIn) => return Attempt::Terminal,
            Err(error) => {
                eprintln!("Realtime WebSocket error: {error}");
                return failed(None, false);
            }
        };
        if !self.active(epoch) {
            return failed(None, false);
        }
        let Ok(parsed) = reqwest::Url::parse(&url) else {
            eprintln!("Realtime WebSocket error: bad URL");
            return failed(None, false);
        };
        let stream = match open_stream(&parsed) {
            Ok(stream) => stream,
            Err(error) => {
                eprintln!("Realtime WebSocket error: {error}");
                return failed(None, false);
            }
        };
        let Ok(mut request) = url.as_str().into_client_request() else {
            return failed(None, false);
        };
        if let Ok(value) = format!("Bearer {token}").parse() {
            request.headers_mut().insert("Authorization", value);
        }
        let mut socket = match tungstenite::client::client(request, stream) {
            Ok((socket, _response)) => socket,
            Err(tungstenite::HandshakeError::Failure(tungstenite::Error::Http(response))) => {
                let retry = response
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| parse_retry_after(v, now_ms()));
                let status = response.status().as_u16();
                if status == 401 || status == 403 {
                    self.session().token = None;
                }
                return failed(retry, status == 503);
            }
            Err(error) => {
                eprintln!("Realtime WebSocket error: {error}");
                return failed(None, false);
            }
        };
        let _ = socket.get_ref().tcp().set_read_timeout(Some(POLL));
        if !self.active(epoch) {
            let _ = socket.close(None);
            return failed(None, false);
        }
        eprintln!("Realtime WebSocket connected");
        on_open();
        let mut alive = true;
        let mut next_heartbeat = Instant::now() + HEARTBEAT_INTERVAL;
        let mut retry_after_ms = None;
        let mut server_drain = false;
        loop {
            if !self.active(epoch) || self.force_reconnect.load(Ordering::SeqCst) {
                let _ = socket.close(None);
                break;
            }
            if Instant::now() >= next_heartbeat {
                next_heartbeat = Instant::now() + HEARTBEAT_INTERVAL;
                if !alive {
                    // no pong or message for a full interval: terminate
                    break;
                }
                alive = false;
                let _ = socket.send(Message::Ping(Vec::new().into()));
            }
            match socket.read() {
                Ok(Message::Text(text)) => {
                    alive = true;
                    match parse_envelope(text.as_str()) {
                        Some(envelope) => self.dispatch(envelope),
                        None => eprintln!("Ignored malformed realtime WebSocket message"),
                    }
                }
                Ok(Message::Ping(_) | Message::Pong(_)) => alive = true,
                Ok(Message::Close(frame)) => {
                    if let Some(frame) = frame {
                        let code = u16::from(frame.code);
                        retry_after_ms = retry_hint(frame.reason.as_str());
                        server_drain =
                            code == SERVICE_RESTART_CLOSE || code == TRY_AGAIN_LATER_CLOSE;
                    }
                    break;
                }
                Ok(_) => alive = true,
                Err(error) if is_timeout(&error) => {}
                Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => {
                    break;
                }
                Err(error) => {
                    if self.active(epoch) {
                        eprintln!("Realtime socket error: {error}");
                    }
                    break;
                }
            }
        }
        Attempt::Done(AttemptResult {
            connected: true,
            retry_after_ms,
            server_drain,
        })
    }

    /// Presence versions only move forward; each eventId is handled once.
    fn dispatch(&self, envelope: Envelope) {
        {
            let mut session = self.session();
            if envelope.event == "friendPresence" {
                let friend = envelope
                    .payload
                    .get("friendId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let version = envelope
                    .payload
                    .get("version")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                let highest = session.presence.get(&friend).copied().unwrap_or(0.0);
                if version <= highest {
                    return;
                }
                session.presence.insert(friend, version);
            }
            if session.seen_set.contains(&envelope.event_id) {
                return;
            }
            session.seen_set.insert(envelope.event_id.clone());
            session.seen.push_back(envelope.event_id.clone());
            if session.seen.len() > MAX_SEEN_EVENT_IDS
                && let Some(oldest) = session.seen.pop_front()
            {
                session.seen_set.remove(&oldest);
            }
        }
        (self.on_event)(envelope);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jitter_caps_at_thirty_seconds() {
        assert_eq!(full_jitter_delay(1, 0.999), 999);
        assert_eq!(full_jitter_delay(3, 0.5), 2_000);
        assert_eq!(full_jitter_delay(10, 0.5), 15_000);
    }

    #[test]
    fn retry_after_seconds_and_hints() {
        assert_eq!(parse_retry_after("5", 0), Some(5_000));
        assert_eq!(parse_retry_after("", 0), None);
        assert_eq!(retry_hint(r#"{"retryAfterSeconds":2}"#), Some(2_000));
        assert_eq!(retry_hint(r#"{"retryAfterMs":750}"#), Some(750));
        assert_eq!(retry_hint("bye"), None);
    }

    #[test]
    fn envelopes_and_jwt() {
        let ok = r#"{"v":1,"eventId":"e1","publishedAt":1700000000000,"event":"notification","payload":{"invalidate":"notifications"}}"#;
        assert_eq!(
            parse_envelope(ok).map(|e| e.event),
            Some("notification".into())
        );
        assert!(
            parse_envelope(r#"{"v":2,"eventId":"e1","publishedAt":1,"event":"x","payload":{}}"#)
                .is_none()
        );
        assert!(
            parse_envelope(r#"{"v":1,"eventId":"","publishedAt":1,"event":"x","payload":{}}"#)
                .is_none()
        );
        // {"exp":1700000000}
        assert_eq!(
            jwt_expiration("x.eyJleHAiOjE3MDAwMDAwMDB9.y"),
            Some(1_700_000_000_000)
        );
    }
}
