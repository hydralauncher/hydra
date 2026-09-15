use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::mpsc;

use crate::certs;
use crate::config;
use crate::crypto;
use crate::store::Store;

pub const HTTPS_PORT: u16 = 47984;
pub const HTTP_PORT: u16 = 47989;
pub const HOSTNAME: &str = "Hydra";

const APPVERSION: &str = "7.1.431.-1";
const GFE_VERSION: &str = "3.23.0.74";
pub(crate) const PAIR_TIMEOUT: Duration = Duration::from_secs(300);
const DESKTOP_APPID: u32 = 1;
/// `x-nv-general.featureFlags` bit 0x20 (NVFF_AUDIO_ENCRYPTION): a client
/// raises it in its ANNOUNCE exactly when it will decrypt every audio
/// payload with AES-128-CBC, so the host must encrypt the payloads then.
/// `moonlight-common-c SdpGenerator.c:195-197` sets the bit and
/// `AudioEncryptionEnabled` in the same branch, and Sunshine ORs the bit
/// into `SS_ENC_AUDIO` ("Legacy clients use nvFeatureFlags to indicate
/// support for audio encryption", `src/rtsp.cpp:1164-1165`).
const NVFF_AUDIO_ENCRYPTION: u32 = 0x20;

#[derive(Serialize, Deserialize, Clone)]
pub struct PairedClient {
    pub uniqueid: String,
    pub name: String,
    pub cert: String,
}

pub struct State {
    pub store: Store,
    pub uuid: String,
    pub identity: certs::Identity,
    pub cert_signature: Vec<u8>,
    pub paired: Mutex<HashMap<String, PairedClient>>,
    pub sessions: Mutex<HashMap<String, PairSession>>,
    pub game_session: Mutex<GameSession>,
    pub stream: Mutex<Option<crate::stream::StreamHandle>>,
    /// Starvation-aware gate for client IDR requests (REQUEST_IDR
    /// floods): one applied request per 200ms at most (~5/s) while a
    /// client is starving, slowing to one per 500ms (2/s) once eight
    /// applied requests in one episode are still drawing more —
    /// persistent begging is evidence that keyframes are not the fix, so
    /// it slows the response instead of speeding it up (see
    /// `stream::IdrRequestGate`).
    pub idr_gate: Mutex<crate::stream::IdrRequestGate>,
    /// Host-originated control message sequence number (for the 0x0001
    /// AES-GCM envelope of encrypted termination messages).
    pub control_out_seq: std::sync::atomic::AtomicU32,
    /// App catalog pushed by the Electron host (Hydra game library).
    /// Desktop (appid 1) is always served in addition to these.
    pub app_list: Mutex<Vec<StreamApp>>,
    /// Appid of the game process the launcher reports as running (0 = none),
    /// pushed by the Electron host over the `setRunningGame` RPC. The running
    /// app is a property of the *process*, not of the Moonlight session: a
    /// client that merely drops leaves the game running and the host busy.
    pub running_appid: std::sync::atomic::AtomicU32,
    /// Media (video/audio) UDP sockets bound ONCE for the life of the
    /// process, like Sunshine's stream sockets. Per-session binds created
    /// a dead window between sessions: the client's hole-punch pings
    /// arrived while nothing was bound (or were consumed by the dying
    /// session's drain loop), so a relaunched session never learned the
    /// client endpoint and dropped every frame. With one long-lived
    /// socket the kernel queues pings across the gap and the next
    /// session's first drain learns the endpoint.
    pub media: Mutex<Option<(std::net::UdpSocket, std::net::UdpSocket)>>,
    pub events: mpsc::UnboundedSender<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GamePhase {
    Idle,
    Launching,
    WaitingForClient,
    Streaming,
    Quitting,
}

impl GamePhase {
    pub fn as_str(self) -> &'static str {
        match self {
            GamePhase::Idle => "idle",
            GamePhase::Launching => "launching",
            GamePhase::WaitingForClient => "waiting-for-client",
            GamePhase::Streaming => "streaming",
            GamePhase::Quitting => "quitting",
        }
    }
}

#[derive(Clone)]
pub struct LaunchParams {
    pub uniqueid: String,
    pub appid: u32,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// `/launch`'s `hdrMode` (Moonlight's client-side HDR switch).
    ///
    /// Recorded, but *not* what decides the stream: Sunshine parses the same
    /// argument (`nvhttp.cpp:501`) and uses it only to switch the host's
    /// virtual display device, never the encoder — the encoder-side decision
    /// is driven by the RTSP `x-nv-video[0].dynamicRangeMode` the client
    /// sends once it has negotiated a 10-bit format
    /// (`video_colorspace.cpp:33-35`). This host has no virtual display, so
    /// it is reported in logs and the session banner only; see
    /// [`LaunchParams::dynamic_range`].
    pub hdr_mode: bool,
    /// `x-nv-video[0].dynamicRangeMode` from ANNOUNCE: the client's encoding
    /// *depth* request, 0 = 8-bit and >= 1 = 10-bit (`video.h:39`,
    /// `video_colorspace.cpp:62-75`; Moonlight sends 1 only when the
    /// negotiated video format is 10-bit, `SdpGenerator.c:456-457`).
    ///
    /// This is the request an HDR session is built from, together with the
    /// HEVC codec and an HDR desktop: 10-bit plus a PQ/BT.2020 display is
    /// HDR10, 10-bit on an SDR desktop would be 10-bit BT.709, which this
    /// host does not produce and therefore downgrades to SDR.
    pub dynamic_range: u32,
    pub rikey: [u8; 16],
    /// `/launch`'s `rikeyid`: the AV key identifier the client puts (big
    /// endian) in the first 4 bytes of every audio packet's IV
    /// (`AudioStream.c:81-82,188`; Sunshine builds the identical IV from
    /// its `launch_session.iv`, `nvhttp.cpp:523`, `stream.cpp:2372`).
    pub rikeyid: u32,
    pub encrypted_rtsp: bool,
    /// `X-SS-Ping-Payload` from SETUP: the hex of 8 random bytes, i.e. the
    /// 16 characters the client's SS_PING payload field holds and echoes
    /// back in its ping datagrams (moonlight-common-c RtspConnection.c:1204).
    pub av_ping_payload: String,
    pub control_connect_data: u32,
    pub activity: Instant,
    /// `x-nv-video[0].packetSize` from ANNOUNCE (Moonlight default 1392).
    pub packet_size: u32,
    /// `x-nv-vqos[0].bw.maximumBitrateKbps` from ANNOUNCE.
    pub bitrate_kbps: u32,
    /// `x-nv-video[0].videoEncoderSlicesPerFrame` from ANNOUNCE.
    pub slices_per_frame: u32,
    /// `x-nv-video[0].maxNumReferenceFrames` from ANNOUNCE: the DPB depth
    /// the client asks for. `Some(0)` = "host picks" (only an RFI-aware
    /// client sends it), `Some(n > 0)` = that many reference frames, `None`
    /// = attribute absent (an older client). Resolved against the startup
    /// probe in `capture::resolve_ref_frames`.
    pub max_ref_frames: Option<i32>,
    /// `localAudioPlayMode` from /launch: host plays the audio (higher
    /// Opus bitrate, matching Sunshine's stream configs).
    pub host_audio: bool,
    /// `x-nv-aqos.packetDuration` from ANNOUNCE (milliseconds per Opus
    /// packet, Moonlight default 5).
    pub packet_duration_ms: u32,
    /// `x-nv-vqos[0].fec.minRequiredFecPackets` from ANNOUNCE: the minimum
    /// recovery packets the client needs in every FEC block (0 = none).
    /// Sunshine defaults the attribute to 0 (`rtsp.cpp:1132`) and hands it
    /// to the encoder as `stream::config_t::minRequiredFecPackets`
    /// (`rtsp.cpp:1157`, `stream.cpp:852-859` raises a block's parity to
    /// it). Sunshine ignores a neighbouring `x-nv-vqos[0].fec.enable`
    /// entirely, so a literal 0 there is not treated as "no FEC required".
    pub min_required_fec_packets: u32,
    /// Channel count the client asked for via `surroundAudioInfo`; the
    /// Opus layout is selected from this (stereo when surround is off).
    pub requested_channels: u32,
    /// `x-nv-audio.surround.AudioQuality` from ANNOUNCE: the client's Opus
    /// quality tier (0 = normal, 1 = high quality; Sunshine reads the same
    /// attribute, `rtsp.cpp:1152-1153`). None = attribute absent, in which
    /// case the host-audio rule stands in.
    pub audio_quality: Option<bool>,
    /// `x-nv-audio.surround.enable`: an explicit 0 pins the stream to
    /// stereo. Absent (or any other value) leaves the requested layout.
    pub surround_enabled: bool,
    /// `x-nv-vqos[0].qosTrafficType` from ANNOUNCE: the client
    /// authorizes QoS marking of the video (and control) socket when
    /// present and non-zero (Sunshine rtsp.cpp:1160,
    /// stream.cpp:2147). None = attribute absent, no marking.
    pub video_qos_type: Option<i32>,
    /// `x-nv-aqos.qosTrafficType` from ANNOUNCE: the same for the audio
    /// socket (Sunshine rtsp.cpp:1159, stream.cpp:2174).
    pub audio_qos_type: Option<i32>,
    /// `x-nv-general.featureFlags` from ANNOUNCE has bit 0x20
    /// (NVFF_AUDIO_ENCRYPTION, `SdpGenerator.c:178`): the client set it
    /// exactly when it will AES-CBC decrypt every audio payload
    /// (`SdpGenerator.c:195-197` raises the bit and `AudioEncryptionEnabled`
    /// together), so the host must encrypt then. Sunshine reads the same bit
    /// (`rtsp.cpp:1164-1165`). `false` (attribute absent included) sends
    /// plaintext.
    pub audio_encryption: bool,
    /// The codec this session encodes — H.264 unless the client's ANNOUNCE
    /// asked for HEVC with `x-nv-vqos[0].bitStreamFormat=1`
    /// (`SdpGenerator.c:433-451`) and the host's startup probe found a
    /// working HEVC session (`capture::RecoveryCapability::hevc`). Resolved
    /// once, by [`negotiate_codec`], when the ANNOUNCE is parsed.
    pub codec: crate::video::VideoCodec,
}

pub struct GameSession {
    pub phase: GamePhase,
    pub launch: Option<LaunchParams>,
    pub rtsp_seq: u32,
    /// The client this session was negotiated with: the source IP of the
    /// RTSP connection that carried its handshake (`note_rtsp_client`),
    /// cleared whenever a session is raised or resumed. It is the
    /// authoritative media destination — the audio sender accepts that IP
    /// and nothing else, so a second device on the network cannot take the
    /// stream's audio over.
    pub client_ip: Option<IpAddr>,
}

/// The codec a session encodes, from the client's ANNOUNCE and the host's
/// probed HEVC support. The client states its choice with
/// `x-nv-vqos[0].bitStreamFormat` (`SdpGenerator.c:433-451`: 0 = H.264,
/// 1 = HEVC, 2 = AV1) — the same attribute Sunshine reads into
/// `config.monitor.videoFormat` (`rtsp.cpp:1203`). HEVC is selected only
/// when the client asks for it AND the host can encode it; every other
/// combination (attribute absent, 0, 2/AV1, or a host without an HEVC
/// session) keeps H.264. Pure.
pub fn negotiate_codec(
    bit_stream_format: Option<u32>,
    hevc_available: bool,
) -> crate::video::VideoCodec {
    match bit_stream_format {
        Some(1) if hevc_available => crate::video::VideoCodec::Hevc,
        _ => crate::video::VideoCodec::H264,
    }
}

pub struct StreamApp {
    pub appid: u32,
    pub title: String,
    /// Local box-art file resolved by the Electron host; served by
    /// /appasset (read at request time so art changes are picked up).
    pub cover: Option<std::path::PathBuf>,
}

pub struct PairSession {
    created: Instant,
    phase: Phase,
    /// Client salt from getservercert; the AES key is derived once the
    /// user submits the PIN shown on the client (Sunshine semantics: the
    /// client generates and displays the PIN, the host learns it from UI
    /// input while the getservercert request is held open).
    salt: [u8; 16],
    aes_key: Option<[u8; 16]>,
    client_cert: Vec<u8>,
    devicename: String,
    server_secret: [u8; 16],
    server_challenge: [u8; 16],
    client_hash: Vec<u8>,
    /// Held getservercert HTTP response, resolved when the PIN arrives.
    response_tx: Option<tokio::sync::oneshot::Sender<String>>,
    /// getservercert body produced by a PIN that arrived before the HTTP
    /// side registered its waiter.
    pending_body: Option<String>,
}

#[derive(PartialEq, Clone, Copy)]
enum Phase {
    GetServerCert,
    ClientChallenge,
    ServerChallengeResp,
}

impl State {
    pub fn load(events: mpsc::UnboundedSender<String>) -> Result<State, String> {
        let store = Store::load().map_err(|error| format!("stream store: {error}"))?;
        State::with_store(store, events)
    }

    pub fn with_store(store: Store, events: mpsc::UnboundedSender<String>) -> Result<State, String> {
        let uuid = store.uuid().map_err(|error| error.to_string())?;
        let identity = certs::load_or_generate(&store)?;
        let cert_signature = crypto::cert_signature(&identity.cert_der)?;
        let paired: Vec<PairedClient> = store.read_json("clients.json").unwrap_or_default();

        Ok(State {
            store,
            uuid,
            identity,
            cert_signature,
            paired: Mutex::new(paired.into_iter().map(|client| (client.uniqueid.clone(), client)).collect()),
            sessions: Mutex::new(HashMap::new()),
            game_session: Mutex::new(GameSession {
                phase: GamePhase::Idle,
                launch: None,
                rtsp_seq: 0,
                client_ip: None,
            }),
            stream: Mutex::new(None),
            idr_gate: Mutex::new(crate::stream::IdrRequestGate::new()),
            control_out_seq: std::sync::atomic::AtomicU32::new(0),
            app_list: Mutex::new(Vec::new()),
            running_appid: std::sync::atomic::AtomicU32::new(0),
            media: Mutex::new(None),
            events,
        })
    }

    pub fn session_phase(&self) -> GamePhase {
        self.game_session.lock().expect("game session lock").phase
    }

    /// The game process the launcher reports as running (0 = none).
    pub fn running_appid(&self) -> u32 {
        self.running_appid.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Replaces the running appid the launcher reports. Logged only when the
    /// value changes: this drives what every client sees in /serverinfo.
    pub fn set_running_appid(&self, appid: u32) {
        let previous = self.running_appid.swap(appid, std::sync::atomic::Ordering::Relaxed);
        if previous == appid {
            return;
        }
        if appid == 0 {
            eprintln!("nvhttp: no app running (clients see SUNSHINE_SERVER_FREE)");
        } else {
            eprintln!("nvhttp: running app appid={appid} (clients see SUNSHINE_SERVER_BUSY)");
        }
    }

    fn emit_session_state(&self, phase: GamePhase) {
        let _ = self.events.send(
            json!({ "event": "session-state", "state": phase.as_str() }).to_string(),
        );
    }

    /// Raises a pending session for a validated /launch. Fails while another
    /// session is still active.
    pub fn begin_launch(&self, params: LaunchParams) -> Result<(), ()> {
        {
            let mut session = self.game_session.lock().expect("game session lock");
            if session.phase != GamePhase::Idle {
                return Err(());
            }
            session.launch = Some(params);
            session.rtsp_seq = 0;
            session.client_ip = None;
            session.phase = GamePhase::Launching;
        }
        self.emit_session_state(GamePhase::Launching);
        Ok(())
    }

    /// Re-raises the pending session for a validated /resume so the client can
    /// redo the RTSP handshake against the still-running app.
    /// Re-raises the pending session with fresh params: Sunshine applies a
    /// /resume's new rikey/rikeyid/mode to the pending session (launching
    /// or waiting-for-client) so the client can redo the RTSP handshake
    /// against the new keys; while streaming it restarts the handshake
    /// window from scratch.
    pub fn resume_launch(&self, params: LaunchParams) -> Result<(), ()> {
        let mut session = self.game_session.lock().expect("game session lock");
        match session.phase {
            GamePhase::Idle => Err(()),
            GamePhase::Launching | GamePhase::WaitingForClient => {
                // apply the new launch params to the pending session
                session.launch = Some(params);
                session.rtsp_seq = 0;
                // the handshake is redone: re-learn who the client is
                session.client_ip = None;
                if let Some(launch) = session.launch.as_mut() {
                    launch.activity = Instant::now();
                }
                Ok(())
            }
            GamePhase::Streaming | GamePhase::Quitting => {
                session.launch = Some(params);
                session.rtsp_seq = 0;
                session.client_ip = None;
                session.phase = GamePhase::Launching;
                let phase = session.phase;
                drop(session);
                self.emit_session_state(phase);
                Ok(())
            }
        }
    }

    /// Gates an incoming RTSP connection. Returns false (connection must be
    /// dropped) when no session is pending, otherwise records client activity
    /// and moves launching -> waiting-for-client on first contact.
    pub fn rtsp_contact(&self) -> bool {
        let mut session = self.game_session.lock().expect("game session lock");
        match session.phase {
            GamePhase::Idle | GamePhase::Quitting => false,
            GamePhase::Launching => {
                session.phase = GamePhase::WaitingForClient;
                if let Some(launch) = session.launch.as_mut() {
                    launch.activity = Instant::now();
                }
                let phase = session.phase;
                drop(session);
                self.emit_session_state(phase);
                true
            }
            GamePhase::WaitingForClient | GamePhase::Streaming => {
                if let Some(launch) = session.launch.as_mut() {
                    launch.activity = Instant::now();
                }
                true
            }
        }
    }

    /// Records the client this session is being negotiated with: the source
    /// IP of its RTSP connection. The first connection of a session wins —
    /// a later RTSP connection from another host must not swing the
    /// session's media destination to itself. Cleared by `begin_launch` and
    /// `resume_launch`, so every handshake learns its own client.
    pub fn note_rtsp_client(&self, ip: IpAddr) {
        let mut session = self.game_session.lock().expect("game session lock");
        if matches!(session.phase, GamePhase::Idle | GamePhase::Quitting) {
            return;
        }
        if session.client_ip.is_none() {
            session.client_ip = Some(ip);
            eprintln!("rtsp: session client is {ip} (the media destination)");
        }
    }

    /// The client IP this session was negotiated with, or `None` when no
    /// RTSP connection has been seen yet (`note_rtsp_client`).
    pub fn session_client_ip(&self) -> Option<IpAddr> {
        self.game_session
            .lock()
            .expect("game session lock")
            .client_ip
    }

    pub fn launch_params(&self) -> Option<LaunchParams> {
        self.game_session
            .lock()
            .expect("game session lock")
            .launch
            .clone()
    }

    pub fn next_rtsp_seq(&self) -> u32 {
        let mut session = self.game_session.lock().expect("game session lock");
        session.rtsp_seq += 1;
        session.rtsp_seq
    }

    /// PLAY received: the client is fully connected and the placeholder
    /// streaming phase begins. Only promotes a live session
    /// (waiting-for-client/streaming): a PLAY racing a session end must
    /// not resurrect from Idle with no launch params. Returns true when
    /// the promotion happened.
    pub fn mark_streaming(&self) -> bool {
        let launch = {
            let mut session = self.game_session.lock().expect("game session lock");
            if session.phase != GamePhase::WaitingForClient && session.phase != GamePhase::Streaming
            {
                eprintln!(
                    "nvhttp: PLAY ignored in phase {} (session ended?)",
                    session.phase.as_str()
                );
                return false;
            }
            if session.phase == GamePhase::Streaming {
                return true;
            }
            session.phase = GamePhase::Streaming;
            if let Some(launch) = session.launch.as_mut() {
                launch.activity = Instant::now();
            }
            session.launch.clone()
        };
        self.emit_session_state(GamePhase::Streaming);
        if let Some(launch) = launch {
            let _ = self.events.send(
                json!({
                    "event": "client-connected",
                    "appid": launch.appid,
                    "uniqueid": launch.uniqueid,
                    "width": launch.width,
                    "height": launch.height,
                    "fps": launch.fps,
                })
                .to_string(),
            );
        }
        true
    }

    /// Ends the active session (cancel, teardown, or timeout) and emits the
    /// quitting / client-disconnected / idle event sequence.
    pub fn end_session(&self, reason: &str) {
        self.stop_streaming();
        {
            let mut session = self.game_session.lock().expect("game session lock");
            if session.phase == GamePhase::Idle {
                return;
            }
            session.phase = GamePhase::Quitting;
        }
        self.emit_session_state(GamePhase::Quitting);
        let _ = self.events.send(
            json!({ "event": "client-disconnected", "reason": reason }).to_string(),
        );
        {
            let mut session = self.game_session.lock().expect("game session lock");
            if let Some(launch) = session.launch.take() {
                if launch.appid != DESKTOP_APPID {
                    // The reason decides whether the Electron host stops the
                    // game: only an explicit /cancel may kill it, every other
                    // teardown leaves it running. `running_appid` is Electron's
                    // to clear, never this path's.
                    let _ = self.events.send(
                        json!({ "event": "stream-ended", "appid": launch.appid, "reason": reason })
                            .to_string(),
                    );
                }
            }
            session.phase = GamePhase::Idle;
        }
        self.emit_session_state(GamePhase::Idle);
    }

    /// Long-lived media (video/audio) sender sockets. Created lazily on
    /// first use and reused by every session; each caller gets its own
    /// cloned handle, so concurrent sessions never rebind the ports.
    pub fn media_sockets(&self) -> Result<(std::net::UdpSocket, std::net::UdpSocket), String> {
        let mut guard = self.media.lock().expect("media sockets lock");
        if guard.is_none() {
            let video = bind_media_socket(config::ports().video)?;
            let audio = bind_media_socket(config::ports().audio)?;
            *guard = Some((video, audio));
        }
        let (video, audio) = guard.as_ref().expect("media sockets initialized");
        Ok((
            video
                .try_clone()
                .map_err(|error| format!("video socket clone: {error}"))?,
            audio
                .try_clone()
                .map_err(|error| format!("audio socket clone: {error}"))?,
        ))
    }

    /// Replaces the advertised app catalog (Hydra game library, pushed by
    /// the Electron host via the setAppList RPC). Desktop (appid 1) is
    /// reserved and duplicates are dropped.
    pub fn set_app_list(&self, apps: Vec<(u32, String, Option<String>)>) {
        let mut list = self.app_list.lock().expect("app list lock");
        list.clear();
        for (appid, title, cover) in apps {
            if appid == DESKTOP_APPID || list.iter().any(|app| app.appid == appid) {
                eprintln!("nvhttp: ignoring appid {appid} (reserved or duplicate)");
                continue;
            }
            list.push(StreamApp {
                appid,
                title,
                cover: cover.map(std::path::PathBuf::from),
            });
        }
        eprintln!("nvhttp: app list updated ({} apps)", list.len());
    }

    fn is_known_appid(&self, appid: u32) -> bool {
        appid == DESKTOP_APPID
            || self
                .app_list
                .lock()
                .expect("app list lock")
                .iter()
                .any(|app| app.appid == appid)
    }

    /// Stores the streaming parameters the client negotiates in the RTSP
    /// ANNOUNCE SDP (`x-nv-*` attributes) into the pending launch.
    pub fn update_announcement(&self, attrs: &HashMap<String, String>) {
        let mut session = self.game_session.lock().expect("game session lock");
        let Some(launch) = session.launch.as_mut() else {
            return;
        };
        if let Some(value) = attrs.get("x-nv-video[0].packetSize") {
            if let Ok(packet_size) = value.parse() {
                launch.packet_size = packet_size;
            }
        }
        if let Some(value) = attrs.get("x-nv-vqos[0].bw.maximumBitrateKbps") {
            if let Ok(bitrate) = value.parse() {
                launch.bitrate_kbps = bitrate;
            }
        }
        if let Some(value) = attrs.get("x-nv-video[0].videoEncoderSlicesPerFrame") {
            if let Ok(slices) = value.parse() {
                launch.slices_per_frame = slices;
            }
        }
        // The client's encoding-depth request: 0 = 8-bit, anything else =
        // 10-bit (Sunshine defaults the attribute to "0" and treats every
        // non-zero value as 10-bit, `rtsp.cpp:1129,1204`,
        // `video_colorspace.cpp:62-75`). It only ever says 10-bit when the
        // client saw SCM_HEVC_MAIN10 and negotiated a 10-bit format.
        if let Some(value) = attrs.get("x-nv-video[0].dynamicRangeMode") {
            if let Ok(range) = value.parse() {
                launch.dynamic_range = range;
            }
        }
        if let Some(value) = attrs.get("x-nv-video[0].maxNumReferenceFrames") {
            // 0 means "host picks" (moonlight-common-c only sends 0 when it
            // saw the RFI attribute in DESCRIBE); a positive value is the
            // client's DPB-depth request. Clamping happens at pipeline build.
            match value.parse::<i32>() {
                Ok(count) => launch.max_ref_frames = Some(count),
                Err(_) => {
                    eprintln!("nvhttp: ignoring invalid maxNumReferenceFrames {value:?}")
                }
            }
        }
        if let Some(value) = attrs.get("x-nv-aqos.packetDuration") {
            if let Ok(duration) = value.parse::<u32>() {
                // only Opus-valid frame durations are legal (48kHz frame
                // sizes); clamp the rest to the Moonlight default
                launch.packet_duration_ms = match duration {
                    5 | 10 | 20 | 40 | 60 => duration,
                    other => {
                        eprintln!("nvhttp: ignoring invalid packetDuration {other}ms, using 5ms");
                        5
                    }
                };
            }
        }
        // Sunshine reads the FEC minimum only from its own try_emplace
        // default of 0 (rtsp.cpp:1132/1157) — a `fec.enable` in the same
        // ANNOUNCE is never consulted — and rises a frame's parity count
        // to it before encoding (stream.cpp:852-859).
        if let Some(value) = attrs.get("x-nv-vqos[0].fec.minRequiredFecPackets") {
            match value.trim().parse::<u32>() {
                Ok(minimum) => launch.min_required_fec_packets = minimum,
                Err(_) => eprintln!(
                    "nvhttp: ignoring invalid fec minRequiredFecPackets {value:?}"
                ),
            }
        }
        // QoS authorization (0 means "do not mark"; absent means the
        // same here — unlike Sunshine's try_emplace defaults we skip
        // marking for clients that never sent the attribute)
        if let Some(value) = attrs.get("x-nv-vqos[0].qosTrafficType") {
            match value.parse::<i32>() {
                Ok(qos_type) => launch.video_qos_type = Some(qos_type),
                Err(_) => eprintln!("nvhttp: ignoring invalid video qosTrafficType {value:?}"),
            }
        }
        if let Some(value) = attrs.get("x-nv-aqos.qosTrafficType") {
            match value.parse::<i32>() {
                Ok(qos_type) => launch.audio_qos_type = Some(qos_type),
                Err(_) => eprintln!("nvhttp: ignoring invalid audio qosTrafficType {value:?}"),
            }
        }
        if let Some(value) = attrs.get("x-nv-general.featureFlags") {
            match value.trim().parse::<u32>() {
                Ok(flags) => launch.audio_encryption = flags & NVFF_AUDIO_ENCRYPTION != 0,
                Err(_) => {
                    eprintln!("nvhttp: ignoring invalid general featureFlags {value:?}")
                }
            }
        }
        if let Some(value) = attrs.get("x-nv-audio.surround.AudioQuality") {
            match value.trim().parse::<i32>() {
                Ok(quality) => launch.audio_quality = Some(quality != 0),
                Err(_) => eprintln!("nvhttp: ignoring invalid surround AudioQuality {value:?}"),
            }
        }
        // The codec decision, once per session: the client names its
        // choice with x-nv-vqos[0].bitStreamFormat (moonlight-common-c
        // raises it to 1 together with x-nv-clientSupportHevc when its
        // decoder is HEVC and the DESCRIBE body carried the VPS marker,
        // SdpGenerator.c:433-451). The host side of the decision is the
        // startup probe: without a working HEVC session no client is ever
        // offered the marker, and a client that asks anyway is answered
        // H.264 rather than left with a decoder the bitstream cannot feed.
        let hevc_available =
            crate::capture::recovery_capability().hevc && crate::capture::hevc_offered();
        let requested = attrs
            .get("x-nv-vqos[0].bitStreamFormat")
            .and_then(|value| match value.trim().parse::<u32>() {
                Ok(format) => Some(format),
                Err(_) => {
                    eprintln!("nvhttp: ignoring invalid bitStreamFormat {value:?}");
                    None
                }
            });
        launch.codec = negotiate_codec(requested, hevc_available);
        let client_hevc = attrs.get("x-nv-clientSupportHevc").map(String::as_str);
        // State the decision and its evidence: the attribute the client
        // sent (absent, 0/1/2) and whether the host could honor it.
        match (launch.codec, requested) {
            (crate::video::VideoCodec::Hevc, _) => eprintln!(
                "nvhttp: codec HEVC: the client's x-nv-vqos[0].bitStreamFormat asked for it \
                 (={}, x-nv-clientSupportHevc={}) and the encoder probe has an HEVC session",
                requested.unwrap_or_default(),
                client_hevc.unwrap_or("absent")
            ),
            (crate::video::VideoCodec::H264, Some(1)) => eprintln!(
                "nvhttp: codec H.264: the client asked for HEVC \
                 (x-nv-vqos[0].bitStreamFormat=1, x-nv-clientSupportHevc={}) but the encoder \
                 probe has no HEVC session",
                client_hevc.unwrap_or("absent")
            ),
            (crate::video::VideoCodec::H264, other) => eprintln!(
                "nvhttp: codec H.264: the client did not ask for HEVC \
                 (x-nv-vqos[0].bitStreamFormat={})",
                other.map(|value| value.to_string()).unwrap_or_else(|| "absent".to_string())
            ),
        }
        if let Some(value) = attrs.get("x-nv-audio.surround.enable") {
            launch.surround_enabled = value.trim() != "0";
        }
        if launch.requested_channels > 2 {
            let layout = crate::audio::select_layout(
                launch.requested_channels,
                launch.audio_quality,
                launch.surround_enabled,
                launch.host_audio,
            );
            eprintln!(
                "nvhttp: client requested {} audio channels; Opus layout {} channels, {} streams, {} coupled, {} kbps",
                launch.requested_channels,
                layout.channel_count,
                layout.streams,
                layout.coupled_streams,
                layout.bitrate_bps / 1000
            );
        }
    }

    /// Discards a session whose client stopped progressing: covers the
    /// pre-RTSP launch window AND the waiting-for-client phase (a stray
    /// TCP connect or aborted handshake must not leave the host BUSY
    /// forever) — matching Sunshine, which arms the ping_timeout at
    /// session_raise and cancels it only when the stream is up
    /// (rtsp.cpp:594-616). Activity is refreshed by every RTSP request,
    /// so a slow-but-alive handshake is never cut. Once streaming, the
    /// control channel's silence timeout is the sole liveness killer.
    /// Returns true when it expired.
    pub fn expire_session(&self, window_timeout: Duration) -> bool {
        let expired = {
            let session = self.game_session.lock().expect("game session lock");
            matches!(session.phase, GamePhase::Launching | GamePhase::WaitingForClient)
                && session
                    .launch
                    .as_ref()
                    .is_some_and(|launch| launch.activity.elapsed() >= window_timeout)
        };
        if expired {
            eprintln!("nvhttp: session expired before the stream started (RTSP went silent)");
            self.end_session("timeout");
        }
        expired
    }
}

pub enum RouteOutcome {
    Ready(String),
    ReadyBinary {
        body: Vec<u8>,
        content_type: &'static str,
    },
    /// getservercert created a pairing session and the HTTP response is
    /// held until `submit_pairing_pin` resolves it (or it expires).
    AwaitPairingPin { uniqueid: String },
}

pub fn route(
    state: &State,
    path: &str,
    params: &HashMap<String, String>,
    is_https: bool,
    local_ip: IpAddr,
    peer_cert: Option<&[u8]>,
) -> RouteOutcome {
    if matches!(
        path,
        "/pair" | "/launch" | "/resume" | "/cancel" | "/appasset"
    ) {
        eprintln!(
            "nvhttp: {} {} uniqueid={:?} phrase={:?} salt={:?} updateState={:?}",
            if is_https { "https" } else { "http" },
            path,
            params.get("uniqueid"),
            params.get("phrase"),
            params.get("salt").map(|s| s.chars().take(8).collect::<String>()),
            params.get("updateState").map(|s| s.as_str()),
        );
    }
    let outcome = match path {
        "/serverinfo" => serverinfo(state, is_https, params.contains_key("uniqueid"), local_ip),
        "/pair" => return pair(state, params),
        "/applist" if is_https => applist(state),
        "/appasset" if is_https => {
            let appid = params.get("appid").and_then(|value| value.parse().ok());
            return appasset(state, appid);
        }
        "/launch" if is_https => launch(state, params, local_ip, peer_cert),
        "/resume" if is_https => resume(state, params, local_ip, peer_cert),
        "/cancel" if is_https => cancel(state, params, peer_cert),
        _ => not_found(),
    };
    RouteOutcome::Ready(outcome)
}

fn serverinfo(state: &State, is_https: bool, has_uniqueid: bool, local_ip: IpAddr) -> String {
    let pair_status = if is_https && has_uniqueid { 1 } else { 0 };
    let local_ip = match local_ip {
        std::net::IpAddr::V6(v6) if v6.to_ipv4_mapped().is_none() => "127.0.0.1".to_string(),
        other => other.to_string(),
    };
    // HYDRA_STREAM_CODECS=h264 (`config::hevc_advertised`) pins the host to
    // H.264 for clients whose HEVC decode is worse than their H.264. Every
    // place that decides the codec has to agree on this, or the client asks
    // for something the DESCRIBE never offered.
    let hevc = crate::capture::recovery_capability().hevc && crate::capture::hevc_offered();
    let hevc_main10 =
        crate::capture::recovery_capability().hevc_main10 && crate::capture::hevc_offered();
    // What the client is actually offered, and why: the HDR bit goes out only
    // when this desktop can be *captured* as HDR, so a client never negotiates
    // 10-bit against a host that would have to degrade it to 8-bit (see
    // `advertised_codec_mode_support`). Logged once per process, because "the
    // client behaves differently than before" is the symptom of getting this
    // wrong.
    let codec_mode_support = advertised_codec_mode_support();
    {
        static LOGGED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if !LOGGED.swap(true, std::sync::atomic::Ordering::Relaxed) {
            eprintln!(
                "nvhttp: advertising ServerCodecModeSupport={codec_mode_support:#x} (hevc={hevc}, \
                 hevc-main10={hevc_main10}, desktop HDR={})",
                crate::capture::desktop_is_hdr()
            );
        }
    }
    // Sunshine mirrors the running app into serverinfo: clients poll this
    // after /launch and only start RTSP once the host reports BUSY with the
    // launched appid as currentgame (Moonlight-Android's AppView flow).
    // Precedence: a live session wins, because the client must see BUSY with
    // its own appid during the launch handshake, before the game process has
    // even started; in Idle the *process* the launcher reports decides. That
    // second half is what makes a game started from Hydra's own UI visible to
    // Moonlight, and what keeps a merely-dropped session's game reported.
    let (currentgame, server_state) = {
        let session = state.game_session.lock().expect("game session lock");
        match session.phase {
            GamePhase::Idle => {
                let running = state.running_appid();
                if running != 0 {
                    (running, "SUNSHINE_SERVER_BUSY")
                } else {
                    (0, "SUNSHINE_SERVER_FREE")
                }
            }
            _ => (
                session
                    .launch
                    .as_ref()
                    .map(|launch| launch.appid)
                    .unwrap_or(0),
                "SUNSHINE_SERVER_BUSY",
            ),
        }
    };

    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n",
            "<root status_code=\"200\">\n",
            "  <hostname>{hostname}</hostname>\n",
            "  <appversion>{appversion}</appversion>\n",
            "  <GfeVersion>{gfe_version}</GfeVersion>\n",
            "  <uniqueid>{uuid}</uniqueid>\n",
            "  <HttpsPort>{https_port}</HttpsPort>\n",
            "  <ExternalPort>{http_port}</ExternalPort>\n",
            "  <MaxLumaPixelsHEVC>{max_luma_pixels_hevc}</MaxLumaPixelsHEVC>\n",
            "  <mac>00:00:00:00:00:00</mac>\n",
            "  <LocalIP>{local_ip}</LocalIP>\n",
            // moonlight-common-c hard-fails LiStartConnection when this is 0
            // ("serverCodecModeSupport field in SERVER_INFORMATION must be
            // set!"), before the RTSP stage ever runs. Sunshine advertises
            // SCM_H264 always and ORs in SCM_HEVC when HEVC is available
            // (nvhttp.cpp:1166-1190).
            "  <ServerCodecModeSupport>{server_codec_mode_support}</ServerCodecModeSupport>\n",
            "  <PairStatus>{pair_status}</PairStatus>\n",
            "  <currentgame>{currentgame}</currentgame>\n",
            "  <state>{server_state}</state>\n",
            "</root>\n",
        ),
        hostname = HOSTNAME,
        appversion = APPVERSION,
        gfe_version = GFE_VERSION,
        uuid = state.uuid,
        https_port = HTTPS_PORT,
        http_port = HTTP_PORT,
        max_luma_pixels_hevc = max_luma_pixels_hevc(hevc),
        server_codec_mode_support = codec_mode_support,
        local_ip = local_ip,
        pair_status = pair_status,
        currentgame = currentgame,
        server_state = server_state,
    )
}

/// `root.ServerCodecModeSupport` bits the client reads
/// (moonlight-common-c Limelight.h:506-513). Only the codecs this host can
/// actually encode are advertised: the 4:4:4 extension bits stay clear
/// because nothing here produces those bitstreams. `SCM_HEVC_MAIN10` is what
/// makes a Moonlight client offer HDR at all — without it the client never
/// sends `dynamicRangeMode=1`, so the HDR stream would exist but never be
/// requested (Sunshine gates the same bit on its DYNAMIC_RANGE probe flag,
/// `nvhttp.cpp:1178`).
const SCM_H264: u32 = 0x0000_0001;
const SCM_HEVC: u32 = 0x0000_0100;
const SCM_HEVC_MAIN10: u32 = 0x0000_0200;

/// The `MaxLumaPixelsHEVC` value Sunshine reports when HEVC is available
/// (`nvhttp.cpp:1232`); 0 when it is not. It is a fixed budget, not a
/// computed luma count. Pure.
fn max_luma_pixels_hevc(hevc: bool) -> &'static str {
    if hevc { "1869449984" } else { "0" }
}

/// The codec-capability bitmask to advertise (Sunshine's
/// `get_codec_mode_flags`, nvhttp.cpp:1166-1190, reduced to the codecs this
/// host has). `hevc_main10` is the startup probe's HEVC Main10 answer; the
/// HDR bit is never advertised without it, so a client is never offered a
/// stream this driver cannot produce. Pure.
fn server_codec_mode_support(hevc: bool, hevc_main10: bool) -> u32 {
    SCM_H264
        | if hevc { SCM_HEVC } else { 0 }
        | if hevc && hevc_main10 { SCM_HEVC_MAIN10 } else { 0 }
}

/// [`server_codec_mode_support`] for the current state of this host, which is
/// what `/serverinfo` reports.
///
/// The HDR bit additionally requires the desktop to be in an HDR colour space
/// *right now*. That is stricter than Sunshine, which gates only on the
/// encoder's DYNAMIC_RANGE probe, and it is deliberate here for two reasons:
///
/// * this host's HDR path *is* the display's FP16 scRGB surface — an SDR
///   desktop has no HDR content to carry, so a 10-bit request can only be
///   answered with 8-bit (the downgrade in `stream::session_hdr`);
/// * advertising the bit changes what the client does: Moonlight negotiates a
///   10-bit format and aims its bitrate at 10-bit levels. In this machine's
///   session logs the same client asks for 100 Mbps (configured 150 Mbps) on a
///   Main10-negotiated session and 32 Mbps on an 8-bit one, and it was never
///   told when the 10-bit request was answered with 8-bit — which is what
///   "HDR off is broken too" looked like from the outside.
///
/// With the desktop HDR the bit goes out, the client negotiates 10-bit, and
/// `session_hdr` serves it. With the desktop SDR the bit stays clear, so the
/// client asks for 8-bit and the bitrate it picks matches the stream it gets.
fn advertised_codec_mode_support() -> u32 {
    let capability = crate::capture::recovery_capability();
    // The probe's answer, narrowed by the codec policy and then by the
    // desktop: H.264-only means no HEVC bit at all, and no HDR bit without an
    // HDR desktop to capture.
    let hevc = capability.hevc && crate::capture::hevc_offered();
    server_codec_mode_support(
        hevc,
        capability.hevc_main10 && crate::capture::hevc_offered(),
    )
}

fn xml_escape(text: &str) -> String {
    // boost encode_char_entities equivalents
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\"', "&quot;")
        .replace('\'', "&apos;")
}

fn app_entry(title: &str, appid: u32) -> String {
    format!(
        "<App><IsHdrSupported>0</IsHdrSupported><AppTitle>{}</AppTitle><ID>{}</ID></App>",
        xml_escape(title),
        appid
    )
}

fn applist(state: &State) -> String {
    // Single line with zero whitespace anywhere (not even after the XML
    // declaration): Moonlight-Android's pull parser calls appList.getLast()
    // on every TEXT event, so ANY whitespace text node (including one before
    // the root element, depending on the parser build) makes it crash or
    // drop the whole list while "loading app list".
    let mut body = String::from("<root status_code=\"200\">");
    body.push_str(&app_entry("Desktop", DESKTOP_APPID));
    for app in state.app_list.lock().expect("app list lock").iter() {
        body.push_str(&app_entry(&app.title, app.appid));
    }
    body.push_str("</root>");
    format!("<?xml version=\"1.0\" encoding=\"utf-8\"?>{body}")
}

/// 600x900 cover for the Desktop tile. `include_bytes!` keeps dev and
/// packaged builds identical: the sidecar ships as a single .exe.
const DESKTOP_COVER_PNG: &[u8] = include_bytes!("../assets/desktop-app.png");

/// Sunshine serves the app's box art here as image/png (an empty/failed
/// stream still gets a 200 with image/png). Hydra games map to cover
/// files resolved by the Electron host, Desktop gets a bundled cover, and
/// anything else (unknown appid, unreadable file) falls back to a 1x1
/// transparent PNG so a missing cover stays a visible gap.
fn appasset(state: &State, appid: Option<u32>) -> RouteOutcome {
    if let Some(appid) = appid {
        let cover = state
            .app_list
            .lock()
            .expect("app list lock")
            .iter()
            .find(|app| app.appid == appid)
            .and_then(|app| app.cover.clone());
        if let Some(cover) = cover {
            match std::fs::read(&cover) {
                Ok(bytes) => {
                    return RouteOutcome::ReadyBinary {
                        body: bytes,
                        content_type: "image/png",
                    };
                }
                Err(error) => {
                    eprintln!("nvhttp: unreadable cover {}: {error}", cover.display());
                }
            }
        }

        if appid == DESKTOP_APPID {
            return RouteOutcome::ReadyBinary {
                body: DESKTOP_COVER_PNG.to_vec(),
                content_type: "image/png",
            };
        }
    }

    const ONE_BY_ONE_TRANSPARENT_PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];
    RouteOutcome::ReadyBinary {
        body: ONE_BY_ONE_TRANSPARENT_PNG.to_vec(),
        content_type: "image/png",
    }
}

/// A request is authorized when it presents a client certificate that matches
/// a paired client (Moonlight-Qt sends no uniqueid on /launch; it identifies
/// by TLS cert), or when it carries a paired uniqueid *and* the very
/// certificate stored for that uniqueid. The uniqueid alone must not
/// authorize: it is a fixed public constant in Moonlight-Android
/// (`docs/console-streaming.md`), so any LAN host could name a paired client
/// and launch, resume or cancel its stream.
fn client_authorized(state: &State, uniqueid: &str, peer_cert: Option<&[u8]>) -> bool {
    let paired = state.paired.lock().expect("paired clients lock");
    if !uniqueid.is_empty() {
        if let Some(client) = paired.get(uniqueid) {
            match peer_cert {
                Some(presented) if cert_matches(&client.cert, presented) => return true,
                // A certificate that is missing or belongs to another client
                // is a rejected identity claim, never a fallback.
                other => {
                    eprintln!(
                        "nvhttp: rejecting uniqueid {uniqueid}: {}",
                        if other.is_some() {
                            "presented client certificate does not match the paired certificate"
                        } else {
                            "no TLS client certificate presented"
                        }
                    );
                    return false;
                }
            }
        }
    }
    if let Some(presented) = peer_cert {
        return paired.values().any(|client| cert_matches(&client.cert, presented));
    }
    false
}

/// Constant-time comparison of the paired client's stored certificate (PEM or
/// DER) against the DER the TLS peer presented. A different length fails
/// first; length is part of a certificate's public shape, so it reveals
/// nothing, and the bytes themselves are never compared with an early exit.
fn cert_matches(stored: &str, presented: &[u8]) -> bool {
    use subtle::ConstantTimeEq;

    let Ok(stored_der) = crypto::parse_cert(stored.as_bytes()) else {
        return false;
    };
    stored_der.ct_eq(presented).into()
}

fn unauthorized(path: &str) -> String {
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n",
            "<root status_code=\"401\" query=\"{path}\" ",
            "status_message=\"The client is not authorized. Certificate verification failed.\"/>\n",
        ),
        path = path,
    )
}

fn launch(state: &State, params: &HashMap<String, String>, local_ip: IpAddr, peer_cert: Option<&[u8]>) -> String {
    let uniqueid = params.get("uniqueid").map(String::as_str).unwrap_or("");
    if !client_authorized(state, uniqueid, peer_cert) {
        return unauthorized("/launch");
    }

    for required in ["rikey", "rikeyid", "localAudioPlayMode", "appid"] {
        if !params.contains_key(required) {
            return launch_error(400, "Missing a required launch parameter", "gamesession", 0);
        }
    }

    if state.session_phase() != GamePhase::Idle {
        return launch_error(400, "An app is already running on this host", "gamesession", 0);
    }

    let Some(params) = make_launch_params(params, uniqueid) else {
        return launch_error(400, "Invalid launch parameters", "gamesession", 0);
    };
    if !state.is_known_appid(params.appid) {
        return launch_error(404, "Failed to start the specified application", "gamesession", 0);
    }

    // An app already running outside the client flow (Hydra's own UI started
    // it): the same appid attaches to it instead of starting a second
    // instance — deliberately friendlier than Sunshine, which 400s
    // unconditionally (nvhttp.cpp:1368-1375). Any other appid conflicts.
    let running = state.running_appid();
    let attach = running != 0 && running == params.appid;
    if running != 0 && !attach {
        return launch_error(400, "An app is already running on this host", "gamesession", 0);
    }

    if state.begin_launch(params.clone()).is_err() {
        return launch_error(400, "An app is already running on this host", "gamesession", 0);
    }

    if attach {
        eprintln!("nvhttp: /launch attached to appid {} (already running)", params.appid);
    }

    // Only AFTER the session is raised: emitting before begin_launch is a
    // TOCTOU (a racing launch can make the Electron host start the game
    // for a session that then fails with 400). An attach has nothing to
    // start — the Electron host is already running that game.
    if params.appid != DESKTOP_APPID && !attach {
        // The Electron host starts the game and ends it when the stream
        // stops; the stream itself shows whatever is on screen.
        let _ = state.events.send(
            json!({ "event": "launch-requested", "appid": params.appid }).to_string(),
        );
    }

    let body = match session_started_xml(state, local_ip, "gamesession", 1) {
        Some(body) => body,
        // /cancel raced us between begin_launch and the XML build
        None => return launch_error(503, "Session ended before the response was built", "gamesession", 0),
    };
    eprintln!("nvhttp: /launch response:\n{body}");
    body
}

fn resume(state: &State, params: &HashMap<String, String>, local_ip: IpAddr, peer_cert: Option<&[u8]>) -> String {
    let uniqueid = params.get("uniqueid").map(String::as_str).unwrap_or("");
    if !client_authorized(state, uniqueid, peer_cert) {
        return unauthorized("/resume");
    }

    if !params.contains_key("rikey") || !params.contains_key("rikeyid") {
        return launch_error(400, "Missing a required resume parameter", "resume", 0);
    }

    let Some(launch) = make_launch_params(params, uniqueid) else {
        return launch_error(400, "Invalid resume parameters", "resume", 0);
    };

    if state.session_phase() != GamePhase::Idle {
        // /resume must target the running app, like Sunshine
        if state
            .launch_params()
            .is_some_and(|current| current.appid != launch.appid)
        {
            return launch_error(404, "Failed to start the specified application", "resume", 0);
        }
        if state.resume_launch(launch).is_err() {
            return launch_error(503, "No running app to resume", "resume", 0);
        }
    } else {
        // No session: the app must be one the launcher reports as running
        // (started from Hydra's own UI). Raising the session adopts it — the
        // Electron host must NOT be asked to start a second instance.
        let running = state.running_appid();
        if running == 0 {
            return launch_error(503, "No running app to resume", "resume", 0);
        }
        if running != launch.appid {
            return launch_error(404, "Failed to start the specified application", "resume", 0);
        }
        if state.begin_launch(launch).is_err() {
            return launch_error(503, "No running app to resume", "resume", 0);
        }
    }

    match session_started_xml(state, local_ip, "resume", 1) {
        Some(body) => body,
        None => launch_error(503, "No running app to resume", "resume", 0),
    }
}

fn cancel(state: &State, params: &HashMap<String, String>, peer_cert: Option<&[u8]>) -> String {
    // Moonlight sends /cancel with no query string at all (identified by its
    // TLS client certificate); a uniqueid parameter is honored when present.
    let uniqueid = params.get("uniqueid").map(String::as_str).unwrap_or("");
    if !client_authorized(state, uniqueid, peer_cert) {
        return unauthorized("/cancel");
    }

    state.end_session("cancel");

    concat!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n",
        "<root status_code=\"200\">\n",
        "  <cancel>1</cancel>\n",
        "</root>\n",
    )
    .to_string()
}

fn make_launch_params(params: &HashMap<String, String>, uniqueid: &str) -> Option<LaunchParams> {
    let rikey_vec = crypto::hex_decode(params.get("rikey")?)?;
    let rikey: [u8; 16] = rikey_vec.as_slice().try_into().ok()?;

    let (width, height, fps) = params
        .get("mode")
        .map(|mode| {
            let mut parts = mode.split('x');
            let number = |part: Option<&str>| part.and_then(|part| part.parse().ok()).unwrap_or(0);
            (
                number(parts.next()),
                number(parts.next()),
                number(parts.next()),
            )
        })
        .unwrap_or((0, 0, 0));

    let corever: u32 = params.get("corever").and_then(|value| value.parse().ok()).unwrap_or(0);

    // rikeyid: the client's own AV key id — a random 32-bit value, sent as a
    // SIGNED decimal (Moonlight generates a random int32, so roughly half of
    // all sessions carry a negative one), and the value the client writes
    // big endian into remoteInputAesIv (`AudioStream.c:81-82`). Sunshine
    // parses it the same way: `(int) util::from_view(...)` truncated into
    // the u32 the IV needs (`nvhttp.cpp:523`; `from_view` returns a signed
    // `std::int64_t`, `utility.h:820-822`). Parsing it as unsigned reads a
    // negative id as unparsable and silently leaves 0 — every audio IV is
    // then built from the wrong key id and the client cannot recover a
    // single payload. A value that does not parse at all still leaves 0.
    let rikeyid: u32 = params
        .get("rikeyid")
        .and_then(|value| value.trim().parse::<i64>().ok())
        .map(|value| value as i32 as u32)
        .unwrap_or(0);

    Some(LaunchParams {
        uniqueid: uniqueid.to_string(),
        appid: params.get("appid")?.parse().ok()?,
        width,
        height,
        fps,
        // Sunshine reads the same argument with a "0" default
        // (`nvhttp.cpp:501`); Moonlight sends "1" when its HDR switch is on.
        hdr_mode: params.get("hdrMode").is_some_and(|value| value.trim() == "1"),
        // filled in from the ANNOUNCE (see `update_announcement`)
        dynamic_range: 0,
        rikey,
        rikeyid,
        encrypted_rtsp: corever >= 1,
        // X-SS-Ping-Payload: Sunshine hex-encodes EIGHT random bytes here
        // (`nvhttp.cpp:517-519`, `unsigned char raw_payload[8]`), and the
        // client only adopts the payload when its length is exactly the
        // 16-byte SS_PING payload field — `strlen(pingPayload) ==
        // sizeof(AudioPingPayload.payload)` (moonlight-common-c
        // RtspConnection.c:1204-1207). A 32-character hex string made that
        // check fail, so the client silently fell back to the 4-byte legacy
        // ping and the payload handshake was never exercised. Sunshine
        // emits uppercase hex (`util::hex_vec`), matched here.
        av_ping_payload: crypto::hex_encode_upper(&crypto::random_bytes(8)),
        control_connect_data: u32::from_le_bytes(
            crypto::random_bytes(4).try_into().expect("4 bytes"),
        ),
        activity: Instant::now(),
        packet_size: crate::video::DEFAULT_PACKET_SIZE,
        bitrate_kbps: 10_000,
        slices_per_frame: 1,
        max_ref_frames: None,
        host_audio: params.get("localAudioPlayMode").is_some_and(|value| value == "1"),
        packet_duration_ms: crate::audio::DEFAULT_PACKET_DURATION_MS,
        min_required_fec_packets: 0,
        requested_channels: params
            .get("surroundAudioInfo")
            .and_then(|value| value.parse::<u32>().ok())
            .map(|info| info & 0xFFFF)
            .filter(|channels| *channels > 0)
            .unwrap_or(2),
        audio_quality: None,
        surround_enabled: true,
        video_qos_type: None,
        audio_qos_type: None,
        // the ANNOUNCE that carries x-nv-general.featureFlags follows the
        // launch; until then nothing asks for encrypted audio
        audio_encryption: false,
        // ...nor asks for HEVC: every session starts H.264 and only the
        // ANNOUNCE's bitStreamFormat can move it (negotiate_codec)
        codec: crate::video::VideoCodec::H264,
    })
}

fn launch_error(status: u32, message: &str, child: &str, child_value: u32) -> String {
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n",
            "<root status_code=\"{status}\" status_message=\"{message}\">\n",
            "  <{child}>{child_value}</{child}>\n",
            "</root>\n",
        ),
        status = status,
        message = message,
        child = child,
        child_value = child_value,
    )
}

/// Builds the session XML. Returns None when the session vanished
/// between raising it and building the response (/cancel race) — the
/// caller must answer with an error instead of panicking.
fn session_started_xml(
    state: &State,
    local_ip: IpAddr,
    child: &str,
    child_value: u32,
) -> Option<String> {
    let launch = state.launch_params()?;
    let scheme = if launch.encrypted_rtsp { "rtspenc" } else { "rtsp" };
    Some(format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n",
            "<root status_code=\"200\">\n",
            "  <sessionUrl0>{scheme}://{local_ip}:{rtsp_port}</sessionUrl0>\n",
            "  <{child}>{child_value}</{child}>\n",
            "</root>\n",
        ),
        scheme = scheme,
        local_ip = local_ip,
        rtsp_port = crate::config::ports().rtsp,
        child = child,
        child_value = child_value,
    ))
}

fn not_found() -> String {
    concat!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n",
        "<root status_code=\"404\"/>\n",
    )
    .to_string()
}

fn pair(state: &State, params: &HashMap<String, String>) -> RouteOutcome {
    let Some(uniqueid) = params.get("uniqueid") else {
        return RouteOutcome::Ready(pair_fail(400, "Missing uniqueid parameter"));
    };

    match params.get("phrase").map(String::as_str) {
        Some("getservercert") => getservercert(state, uniqueid, params),
        Some("pairchallenge") => RouteOutcome::Ready(pair_ok("")),
        _ => RouteOutcome::Ready(pair_phases(state, uniqueid, params)),
    }
}

fn getservercert(state: &State, uniqueid: &str, params: &HashMap<String, String>) -> RouteOutcome {
    let mut sessions = state.sessions.lock().expect("pair sessions lock");
    expire_pair_sessions(state, &mut sessions);

    if sessions.contains_key(uniqueid) {
        // Re-pair escape: if the previous session's getservercert request
        // already completed or timed out (its held response is gone and
        // no PIN raced ahead), the client is starting over — replace the
        // abandoned session instead of 409ing for the rest of the
        // 5-minute lifetime. A session whose HTTP request is still held
        // open (user mid-PIN-entry) still conflicts.
        let replaceable = sessions.get(uniqueid).is_some_and(|session| {
            session.response_tx.is_none() && session.pending_body.is_none()
        });
        if replaceable {
            eprintln!("nvhttp: replacing abandoned pairing session for {uniqueid}");
            sessions.remove(uniqueid);
        } else {
            return RouteOutcome::Ready(pair_fail(
                409,
                "A pairing session with this uniqueid already exists",
            ));
        }
    }

    let Some(salt) = params.get("salt") else {
        return RouteOutcome::Ready(pair_fail(400, "Salt too short"));
    };
    let Some(salt_hex) = salt.get(..32) else {
        return RouteOutcome::Ready(pair_fail(400, "Salt too short"));
    };
    let Some(salt_vec) = crypto::hex_decode(salt_hex) else {
        return RouteOutcome::Ready(pair_fail(400, "Salt too short"));
    };
    let Ok(salt) = <[u8; 16]>::try_from(salt_vec.as_slice()) else {
        return RouteOutcome::Ready(pair_fail(400, "Salt too short"));
    };

    // The client generated the PIN and is showing it to the user; the
    // host learns it later via submit_pairing_pin (JSON-RPC from the UI).
    let _ = state.events.send(json!({ "event": "pairing-requested" }).to_string());

    let client_cert = params
        .get("clientcert")
        .and_then(|hex| crypto::hex_decode(hex))
        .unwrap_or_default();

    sessions.insert(
        uniqueid.to_string(),
        PairSession {
            created: Instant::now(),
            phase: Phase::GetServerCert,
            salt,
            aes_key: None,
            client_cert,
            devicename: params.get("devicename").cloned().unwrap_or_default(),
            server_secret: [0; 16],
            server_challenge: [0; 16],
            client_hash: Vec::new(),
            response_tx: None,
            pending_body: None,
        },
    );

    eprintln!("pairing started for uniqueid {uniqueid}, waiting for PIN");
    RouteOutcome::AwaitPairingPin {
        uniqueid: uniqueid.to_string(),
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum SubmitPinError {
    InvalidPin,
    NoSession,
}

impl State {
    /// Applies the user-entered PIN to the newest pairing session that is
    /// still waiting for it, deriving the AES key and producing the held
    /// getservercert response. Mirrors Sunshine: a session only accepts a
    /// PIN while it has no cipher key yet.
    pub fn submit_pairing_pin(&self, pin: &str) -> Result<String, SubmitPinError> {
        if pin.len() != 4 || !pin.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(SubmitPinError::InvalidPin);
        }

        let mut sessions = self.sessions.lock().expect("pair sessions lock");
        expire_pair_sessions(self, &mut sessions);

        let Some(session) = sessions
            .values_mut()
            .filter(|session| session.aes_key.is_none())
            .max_by_key(|session| session.created)
        else {
            return Err(SubmitPinError::NoSession);
        };

        let aes_key = crypto::derive_aes_key(&session.salt, pin);
        session.aes_key = Some(aes_key);
        let body = getservercert_response(self);
        session.pending_body = Some(body.clone());
        if let Some(tx) = session.response_tx.take() {
            let _ = tx.send(body.clone());
        }
        eprintln!("pairing PIN submitted, session unlocked");
        Ok(body)
    }

    /// Hooks a held getservercert HTTP response up to its pairing
    /// session; resolves immediately if the PIN already arrived.
    pub fn register_pair_response(&self, uniqueid: &str, tx: tokio::sync::oneshot::Sender<String>) {
        let mut sessions = self.sessions.lock().expect("pair sessions lock");
        if let Some(session) = sessions.get_mut(uniqueid) {
            if let Some(body) = session.pending_body.take() {
                let _ = tx.send(body);
            } else if session.aes_key.is_none() {
                session.response_tx = Some(tx);
            }
        }
    }

    /// Removes a pairing session (timeout or terminal failure) and emits
    /// pairing-finished(false).
    pub fn expire_pairing_session(&self, uniqueid: &str) {
        let mut sessions = self.sessions.lock().expect("pair sessions lock");
        if let Some(mut session) = sessions.remove(uniqueid) {
            if let Some(tx) = session.response_tx.take() {
                let _ = tx.send(pair_fail(400, "Pairing session expired"));
            }
            eprintln!("nvhttp: pairing session {uniqueid} expired");
            emit_pairing_finished(self, false);
        }
    }
}

fn getservercert_response(state: &State) -> String {
    pair_ok(&format!(
        "  <plaincert>{}</plaincert>
",
        crypto::hex_encode_upper(state.identity.cert_pem.as_bytes())
    ))
}

/// Drops expired sessions, completing any held HTTP response with a 400
/// and emitting pairing-finished(false) for each.
fn expire_pair_sessions(state: &State, sessions: &mut HashMap<String, PairSession>) {
    let expired: Vec<(String, PairSession)> = sessions
        .extract_if(|_, session| session.created.elapsed() >= PAIR_TIMEOUT)
        .collect();
    for (uniqueid, mut session) in expired {
        if let Some(tx) = session.response_tx.take() {
            let _ = tx.send(pair_fail(400, "Pairing session expired"));
        }
        eprintln!("nvhttp: pairing session {uniqueid} expired");
        emit_pairing_finished(state, false);
    }
}

fn emit_pairing_finished(state: &State, success: bool) {
    let _ = state
        .events
        .send(json!({ "event": "pairing-finished", "success": success }).to_string());
}

fn pair_phases(state: &State, uniqueid: &str, params: &HashMap<String, String>) -> String {
    let mut sessions = state.sessions.lock().expect("pair sessions lock");
    expire_pair_sessions(state, &mut sessions);

    let Some(session) = sessions.get_mut(uniqueid) else {
        return pair_fail(400, "Invalid uniqueid");
    };

    let is_fail = |response: &str| !response.contains("<paired>1</paired>");

    let response = if let Some(challenge) = params.get("clientchallenge") {
        let response = client_challenge(state, session, challenge);
        if is_fail(&response) {
            // Sunshine marks the session failed and erases it
            sessions.remove(uniqueid);
            emit_pairing_finished(state, false);
        }
        response
    } else if let Some(encrypted_response) = params.get("serverchallengeresp") {
        let response = server_challenge_response(state, session, encrypted_response);
        if is_fail(&response) {
            sessions.remove(uniqueid);
            emit_pairing_finished(state, false);
        }
        response
    } else if let Some(pairing_secret) = params.get("clientpairingsecret") {
        let (response, success) = client_pairing_secret(state, session, uniqueid, pairing_secret);
        sessions.remove(uniqueid);
        emit_pairing_finished(state, success);
        response
    } else {
        pair_fail(400, "Invalid pairing request")
    };

    response
}

fn client_challenge(state: &State, session: &mut PairSession, challenge: &str) -> String {
    if session.phase != Phase::GetServerCert {
        return pair_fail(400, "Out of order call to clientchallenge");
    }

    let Some(aes_key) = session.aes_key else {
        return pair_fail(400, "Cipher key not set");
    };
    session.phase = Phase::ClientChallenge;

    let Some(ciphertext) = crypto::hex_decode(challenge) else {
        return pair_fail(400, "Invalid pairing request");
    };
    let decrypted = crypto::aes128_ecb_decrypt(&aes_key, &ciphertext);

    let server_secret: [u8; 16] = crypto::random_bytes(16).try_into().expect("16 bytes");
    let server_challenge: [u8; 16] = crypto::random_bytes(16).try_into().expect("16 bytes");

    let mut hash_input = decrypted;
    hash_input.extend_from_slice(&state.cert_signature);
    hash_input.extend_from_slice(&server_secret);
    let hash = crypto::sha256(&hash_input);

    let mut plaintext = hash.to_vec();
    plaintext.extend_from_slice(&server_challenge);
    let encrypted = crypto::aes128_ecb_encrypt(&aes_key, &plaintext);

    session.server_secret = server_secret;
    session.server_challenge = server_challenge;

    pair_ok(&format!(
        "  <challengeresponse>{}</challengeresponse>\n",
        crypto::hex_encode_upper(&encrypted)
    ))
}

fn server_challenge_response(state: &State, session: &mut PairSession, encrypted_response: &str) -> String {
    if session.phase != Phase::ClientChallenge {
        return pair_fail(400, "Out of order call to serverchallengeresp");
    }
    session.phase = Phase::ServerChallengeResp;

    let aes_key = session.aes_key.unwrap_or([0; 16]);

    let Some(ciphertext) = crypto::hex_decode(encrypted_response) else {
        return pair_fail(400, "Invalid pairing request");
    };
    session.client_hash = crypto::aes128_ecb_decrypt(&aes_key, &ciphertext);

    let Ok(signature) = crypto::sign_sha256(&state.identity.key_pkcs8_der, &session.server_secret) else {
        return pair_fail(400, "Invalid pairing request");
    };
    let mut pairing_secret = session.server_secret.to_vec();
    pairing_secret.extend_from_slice(&signature);

    pair_ok(&format!(
        "  <pairingsecret>{}</pairingsecret>\n",
        crypto::hex_encode_upper(&pairing_secret)
    ))
}

fn client_pairing_secret(
    state: &State,
    session: &PairSession,
    uniqueid: &str,
    pairing_secret: &str,
) -> (String, bool) {
    if session.phase != Phase::ServerChallengeResp {
        return (pair_fail(400, "Out of order call to clientpairingsecret"), false);
    }

    let Some(secret_data) = crypto::hex_decode(pairing_secret) else {
        return (pair_fail(400, "Client pairing secret too short"), false);
    };
    if secret_data.len() <= 16 {
        return (pair_fail(400, "Client pairing secret too short"), false);
    }
    let (secret, signature) = secret_data.split_at(16);

    let Ok(client_cert_der) = crypto::parse_cert(&session.client_cert) else {
        return (pair_fail(400, "Invalid client certificate"), false);
    };
    let Ok(client_cert_signature) = crypto::cert_signature(&client_cert_der) else {
        return (pair_fail(400, "Invalid client certificate"), false);
    };

    let mut hash_input = session.server_challenge.to_vec();
    hash_input.extend_from_slice(&client_cert_signature);
    hash_input.extend_from_slice(secret);
    let same_hash = crypto::sha256(&hash_input) == session.client_hash.as_slice();

    let verified = crypto::verify_sha256(&client_cert_der, secret, signature).unwrap_or(false);

    let paired = same_hash && verified;
    if paired {
        let client = PairedClient {
            uniqueid: uniqueid.to_string(),
            name: session.devicename.clone(),
            cert: String::from_utf8_lossy(&session.client_cert).into_owned(),
        };
        let mut clients = state.paired.lock().expect("paired clients lock");
        clients.insert(uniqueid.to_string(), client);
        let clients: Vec<PairedClient> = clients.values().cloned().collect();
        if let Err(error) = state.store.write_json("clients.json", &clients) {
            eprintln!("failed to persist paired clients: {error}");
        }
        eprintln!("paired client {uniqueid} ({})", session.devicename);
    }

    (pair_ok(""), paired)
}

fn pair_ok(extra: &str) -> String {
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n",
            "<root status_code=\"200\">\n",
            "  <paired>1</paired>\n",
            "{extra}",
            "</root>\n",
        ),
        extra = extra,
    )
}

pub(crate) fn pair_fail(status: u32, message: &str) -> String {
    eprintln!("nvhttp: pair_fail status={status} message={message}");
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n",
            "<root status_code=\"{status}\" status_message=\"{message}\">\n",
            "  <paired>0</paired>\n",
            "</root>\n",
        ),
        status = status,
        message = message,
    )
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::{Arc, Mutex, OnceLock};

    static STATE: OnceLock<(Arc<State>, Mutex<mpsc::UnboundedReceiver<String>>)> = OnceLock::new();

    pub(crate) fn test_state() -> Arc<State> {
        STATE
            .get_or_init(|| {
                let store = Store::at(std::env::temp_dir().join("hydra-stream-nvhttp-test"))
                    .expect("temp store");
                std::fs::remove_file(store.path("clients.json")).ok();
                let (tx, rx) = mpsc::unbounded_channel::<String>();
                (
                    Arc::new(State::with_store(store, tx).expect("state")),
                    Mutex::new(rx),
                )
            })
            .0
            .clone()
    }

    fn next_event() -> String {
        STATE
            .get()
            .expect("test state")
            .1
            .lock()
            .expect("event receiver lock")
            .blocking_recv()
            .expect("stdio event")
    }

    fn params(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    fn tag<'a>(xml: &'a str, tag: &str) -> &'a str {
        let open = format!("<{tag}>");
        let start = xml.find(&open).map(|index| index + open.len()).expect(tag);
        let end = xml[start..].find(&format!("</{tag}>")).expect(tag) + start;
        &xml[start..end]
    }

    #[test]
    fn serverinfo_xml_shape() {
        let state = test_state();
        let xml = serverinfo(&state, true, true, "192.168.1.10".parse().unwrap());

        assert!(xml.starts_with("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<root status_code=\"200\">"));
        assert!(xml.ends_with("</root>\n"));
        assert_eq!(tag(&xml, "hostname"), "Hydra");
        assert_eq!(tag(&xml, "appversion"), "7.1.431.-1");
        assert_eq!(tag(&xml, "uniqueid"), state.uuid);
        assert_eq!(tag(&xml, "HttpsPort"), "47984");
        assert_eq!(tag(&xml, "ExternalPort"), "47989");
        assert_eq!(tag(&xml, "LocalIP"), "192.168.1.10");
        assert_eq!(tag(&xml, "PairStatus"), "1");
        assert_eq!(tag(&xml, "state"), "SUNSHINE_SERVER_FREE");
        // the codec advertisement tracks the startup probe, the same one
        // the RTSP DESCRIBE marker and the codec negotiation use
        // HYDRA_STREAM_CODECS=h264 (`config::hevc_advertised`) pins the host to
    // H.264 for clients whose HEVC decode is worse than their H.264. Every
    // place that decides the codec has to agree on this, or the client asks
    // for something the DESCRIBE never offered.
    let hevc = crate::capture::recovery_capability().hevc && crate::capture::hevc_offered();
    let hevc_main10 =
        crate::capture::recovery_capability().hevc_main10 && crate::capture::hevc_offered();
        assert_eq!(tag(&xml, "MaxLumaPixelsHEVC"), max_luma_pixels_hevc(hevc));
        // The advertised mask is the probe's codecs *and* the desktop's current
        // HDR state (the capture path can only deliver HDR from an HDR
        // desktop), so the assertion goes through the same helper the response
        // does.
        assert_eq!(
            tag(&xml, "ServerCodecModeSupport"),
            advertised_codec_mode_support().to_string()
        );
        assert_eq!(
            advertised_codec_mode_support() & SCM_HEVC_MAIN10 != 0,
            hevc_main10 && crate::capture::desktop_is_hdr()
        );
        // http without uniqueid reports unpaired
        let http_xml = serverinfo(&state, false, false, "10.0.0.5".parse().unwrap());
        assert_eq!(tag(&http_xml, "PairStatus"), "0");
        assert_eq!(tag(&http_xml, "LocalIP"), "10.0.0.5");
    }

    #[test]
    fn pairing_state_machine_happy_path() {
        let state = test_state();
        let uniqueid = "testclient0123";

        // generate a client identity for this test run
        let client_store = Store::at(std::env::temp_dir().join("hydra-stream-test-client"))
            .expect("temp store");
        let client_identity = certs::load_or_generate(&client_store).expect("client identity");
        let client_cert_signature = crypto::cert_signature(&client_identity.cert_der).unwrap();

        // phase 1: getservercert creates the session and HOLDS the
        // response until the user submits the PIN shown on the client
        let salt = crypto::random_bytes(16);
        let salt_hex = crypto::hex_encode_upper(&salt);
        let client_cert_hex = crypto::hex_encode_upper(client_identity.cert_pem.as_bytes());
        let outcome = pair(
            &state,
            &params(&[
                ("uniqueid", uniqueid),
                ("phrase", "getservercert"),
                ("salt", &salt_hex),
                ("devicename", "test-device"),
                ("clientcert", &client_cert_hex),
            ]),
        );
        let RouteOutcome::AwaitPairingPin { uniqueid: held } = outcome else {
            panic!("getservercert must hold the response");
        };
        assert_eq!(held, uniqueid);

        // the UI is asked for the PIN (the client shows it to the user);
        // no PIN is generated host-side
        let event: serde_json::Value = serde_json::from_str(&next_event()).unwrap();
        assert_eq!(event["event"], "pairing-requested");
        assert!(event.get("pin").is_none(), "host must not generate a PIN");

        // the user enters the PIN from the client; the held response body
        // is produced and the key is derived
        let pin = "1234".to_string();
        let response = state.submit_pairing_pin(&pin).expect("pin applies");
        assert!(response.contains("status_code=\"200\""), "{response}");
        assert_eq!(tag(&response, "paired"), "1");
        let plaincert_hex = tag(&response, "plaincert");
        let server_cert_pem = crypto::hex_decode(plaincert_hex).expect("plaincert hex");
        assert_eq!(server_cert_pem, state.identity.cert_pem.as_bytes());

        // phase 2: clientchallenge
        let aes_key = crypto::derive_aes_key(&salt.try_into().unwrap(), &pin);
        let client_challenge = crypto::random_bytes(16);
        let encrypted_challenge = crypto::aes128_ecb_encrypt(&aes_key, &client_challenge);
        let RouteOutcome::Ready(response) = pair(
            &state,
            &params(&[
                ("uniqueid", uniqueid),
                ("clientchallenge", &crypto::hex_encode_upper(&encrypted_challenge)),
            ]),
        ) else {
            panic!("phases must not hold");
        };
        assert!(response.contains("status_code=\"200\""), "{response}");
        let challenge_response = crypto::hex_decode(tag(&response, "challengeresponse")).unwrap();
        let decrypted = crypto::aes128_ecb_decrypt(&aes_key, &challenge_response);
        assert_eq!(decrypted.len(), 48);
        let server_hash = &decrypted[..32];
        let server_challenge = &decrypted[32..];

        // phase 3: serverchallengeresp
        let client_secret = crypto::random_bytes(16);
        let mut hash_input = server_challenge.to_vec();
        hash_input.extend_from_slice(&client_cert_signature);
        hash_input.extend_from_slice(&client_secret);
        let hash = crypto::sha256(&hash_input);
        let encrypted_hash = crypto::aes128_ecb_encrypt(&aes_key, &hash);
        let RouteOutcome::Ready(response) = pair(
            &state,
            &params(&[
                ("uniqueid", uniqueid),
                ("serverchallengeresp", &crypto::hex_encode_upper(&encrypted_hash)),
            ]),
        ) else {
            panic!("phases must not hold");
        };
        assert!(response.contains("status_code=\"200\""), "{response}");
        let pairing_secret = crypto::hex_decode(tag(&response, "pairingsecret")).unwrap();
        let (server_secret, server_signature) = pairing_secret.split_at(16);

        // server signature must verify against the advertised server cert
        let (_, server_cert) =
            x509_parser::parse_x509_certificate(&state.identity.cert_der).unwrap();
        let spki = server_cert.public_key();
        assert!(crypto::verify_sha256_with_public_key(
            spki.subject_public_key.data.as_ref(),
            server_secret,
            server_signature
        )
        .unwrap());

        // the hash the server returned must match what we expect from the challenge
        let mut expected_input = client_challenge.clone();
        expected_input.extend_from_slice(&state.cert_signature);
        expected_input.extend_from_slice(server_secret);
        assert_eq!(server_hash, &crypto::sha256(&expected_input)[..]);

        // phase 4: clientpairingsecret
        let signature =
            crypto::sign_sha256(&client_identity.key_pkcs8_der, &client_secret).unwrap();
        let mut pairing_secret = client_secret.clone();
        pairing_secret.extend_from_slice(&signature);
        let RouteOutcome::Ready(response) = pair(
            &state,
            &params(&[
                ("uniqueid", uniqueid),
                ("clientpairingsecret", &crypto::hex_encode_upper(&pairing_secret)),
            ]),
        ) else {
            panic!("phases must not hold");
        };
        assert!(response.contains("status_code=\"200\""), "{response}");
        assert_eq!(tag(&response, "paired"), "1");

        // pairing completion is broadcast so the UI can close the prompt
        let event: serde_json::Value = serde_json::from_str(&next_event()).unwrap();
        assert_eq!(event["event"], "pairing-finished");
        assert_eq!(event["success"], true);

        // client must be persisted
        let paired = state.paired.lock().unwrap();
        let client = paired.get(uniqueid).expect("paired client");
        assert_eq!(client.name, "test-device");
        assert_eq!(client.cert.as_bytes(), client_identity.cert_pem.as_bytes());
        let persisted: Vec<PairedClient> = state.store.read_json("clients.json").unwrap();
        assert!(persisted.iter().any(|client| client.uniqueid == uniqueid));
    }

    #[test]
    fn applist_has_zero_whitespace() {
        // Moonlight-Android's pull parser calls appList.getLast() on every
        // TEXT event, so ANY whitespace text node (even before the root
        // element, depending on the parser build) kills the app list.
        let (state, _rx) = local_state("applist-shape");
        let body = applist(&state);
        assert!(!body.contains([' ', '\n', '\t', '\r'].as_slice()) || body.starts_with("<?xml"));
        assert_eq!(
            body,
            concat!(
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
                "<root status_code=\"200\"><App><IsHdrSupported>0</IsHdrSupported><AppTitle>Desktop</AppTitle><ID>1</ID></App></root>",
            )
        );
    }

    #[test]
    fn applist_includes_pushed_library_apps() {
        let (state, _rx) = local_state("applist-apps");
        state.set_app_list(vec![
            (100, "Hollow & Knight".to_string(), None),
            (200, "Celeste".to_string(), None),
        ]);
        let body = applist(&state);
        assert_eq!(
            body,
            concat!(
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
                "<root status_code=\"200\">",
                "<App><IsHdrSupported>0</IsHdrSupported><AppTitle>Desktop</AppTitle><ID>1</ID></App>",
                "<App><IsHdrSupported>0</IsHdrSupported><AppTitle>Hollow &amp; Knight</AppTitle><ID>100</ID></App>",
                "<App><IsHdrSupported>0</IsHdrSupported><AppTitle>Celeste</AppTitle><ID>200</ID></App>",
                "</root>",
            )
        );
    }

    #[test]
    fn set_app_list_drops_reserved_and_duplicate_appids() {
        let (state, _rx) = local_state("applist-dupes");
        state.set_app_list(vec![
            (1, "Fake Desktop".to_string(), None),
            (42, "Game A".to_string(), None),
            (42, "Game B".to_string(), None),
        ]);
        let list = state.app_list.lock().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].appid, 42);
        assert_eq!(list[0].title, "Game A");
        assert!(list[0].cover.is_none());
    }

    fn png_fallback(body: &[u8]) {
        assert!(body.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
        assert!(body.ends_with(b"IEND\xAE\x42\x60\x82"));
    }

    #[test]
    fn appasset_serves_a_tiny_png() {
        let (state, _rx) = local_state("appasset-png");
        let RouteOutcome::ReadyBinary { body, content_type } = appasset(&state, None) else {
            panic!("appasset must be a binary response");
        };
        assert_eq!(content_type, "image/png");
        png_fallback(&body);
    }

    #[test]
    fn appasset_serves_mapped_cover_file_bytes() {
        let (state, _rx) = local_state("appasset-cover");
        let cover_path = std::env::temp_dir().join(format!(
            "hydra-stream-cover-{}.webp",
            std::process::id()
        ));
        std::fs::write(&cover_path, b"RIFF-TEST-COVER-BYTES").unwrap();

        state.set_app_list(vec![(
            42,
            "Game A".to_string(),
            Some(cover_path.to_string_lossy().into_owned()),
        )]);

        let RouteOutcome::ReadyBinary { body, content_type } = appasset(&state, Some(42)) else {
            panic!("appasset must be a binary response");
        };
        assert_eq!(content_type, "image/png"); // Sunshine labels all art image/png
        assert_eq!(body, b"RIFF-TEST-COVER-BYTES");

        std::fs::remove_file(&cover_path).ok();

        // unreadable file after deletion falls back to the PNG
        let RouteOutcome::ReadyBinary { body, .. } = appasset(&state, Some(42)) else {
            panic!("appasset must be a binary response");
        };
        png_fallback(&body);
    }

    #[test]
    fn appasset_serves_bundled_desktop_cover() {
        let (state, _rx) = local_state("appasset-desktop");
        let RouteOutcome::ReadyBinary { body, content_type } =
            appasset(&state, Some(DESKTOP_APPID))
        else {
            panic!("appasset must be a binary response");
        };
        assert_eq!(content_type, "image/png");
        png_fallback(&body);
        assert!(body.len() > 4096, "desktop cover is {} bytes", body.len());
    }

    #[test]
    fn appasset_falls_back_for_unknown_appids() {
        let (state, _rx) = local_state("appasset-fallback");
        state.set_app_list(vec![(42, "Game A".to_string(), None)]);
        for appid in [None, Some(99)] {
            let RouteOutcome::ReadyBinary { body, .. } = appasset(&state, appid) else {
                panic!("appasset must be a binary response");
            };
            png_fallback(&body);
        }
    }

    #[test]
    fn pairing_rejects_unknown_uniqueid_and_bad_order() {
        let state = test_state();
        let RouteOutcome::Ready(response) = pair(
            &state,
            &params(&[("uniqueid", "nobody"), ("clientchallenge", "00")]),
        ) else {
            panic!("phases must not hold");
        };
        assert!(response.contains("status_code=\"400\""));
        assert!(response.contains("Invalid uniqueid"));
    }

    fn local_state(name: &str) -> (Arc<State>, mpsc::UnboundedReceiver<String>) {
        let dir = std::env::temp_dir().join(format!(
            "hydra-stream-pairing-{name}-{}",
            std::process::id()
        ));
        std::fs::remove_dir_all(&dir).ok();
        let store = Store::at(dir).expect("temp store");
        let (tx, rx) = mpsc::unbounded_channel::<String>();
        (Arc::new(State::with_store(store, tx).expect("state")), rx)
    }

    fn start_pairing(state: &State, uniqueid: &str) -> [u8; 16] {
        let salt: [u8; 16] = crypto::random_bytes(16).try_into().unwrap();
        let salt_hex = crypto::hex_encode_upper(&salt);
        let outcome = pair(
            state,
            &params(&[
                ("uniqueid", uniqueid),
                ("phrase", "getservercert"),
                ("salt", &salt_hex),
                ("devicename", "tester"),
            ]),
        );
        assert!(matches!(outcome, RouteOutcome::AwaitPairingPin { .. }));
        salt
    }

    #[test]
    fn clientchallenge_before_pin_fails_like_sunshine() {
        let (state, mut rx) = local_state("early-challenge");
        let uniqueid = "earlybird";
        let _salt = start_pairing(&state, uniqueid);

        // the client must not reach phase 2 while the PIN is missing
        let RouteOutcome::Ready(response) = pair(
            &state,
            &params(&[
                ("uniqueid", uniqueid),
                ("clientchallenge", &crypto::hex_encode_upper(&[0xAB; 32])),
            ]),
        ) else {
            panic!("phases must not hold");
        };
        assert!(response.contains("status_code=\"400\""), "{response}");
        assert!(response.contains("Cipher key not set"), "{response}");

        // the failure is terminal and broadcast
        let event: serde_json::Value = serde_json::from_str(&rx.try_recv().unwrap()).unwrap();
        assert_eq!(event["event"], "pairing-requested");
        let event: serde_json::Value = serde_json::from_str(&rx.try_recv().unwrap()).unwrap();
        assert_eq!(event["event"], "pairing-finished");
        assert_eq!(event["success"], false);

        // a later PIN has no session to apply to
        assert_eq!(
            state.submit_pairing_pin("1234"),
            Err(SubmitPinError::NoSession)
        );
    }

    #[test]
    fn submit_pairing_pin_validation() {
        let (state, _rx) = local_state("pin-validation");

        // no session at all
        assert_eq!(
            state.submit_pairing_pin("1234"),
            Err(SubmitPinError::NoSession)
        );

        // malformed PINs
        let _salt = start_pairing(&state, "pinclient");
        assert_eq!(
            state.submit_pairing_pin("12"),
            Err(SubmitPinError::InvalidPin)
        );
        assert_eq!(
            state.submit_pairing_pin("12ab"),
            Err(SubmitPinError::InvalidPin)
        );
        assert!(state.submit_pairing_pin("1234").is_ok());

        // the session consumed its PIN; re-submission finds no awaiting
        // session (mirrors Sunshine: PINs only apply pre-key)
        assert_eq!(
            state.submit_pairing_pin("5678"),
            Err(SubmitPinError::NoSession)
        );
    }

    #[test]
    fn pairing_expiry_emits_finished_false_and_responds_400() {
        let (state, mut rx) = local_state("expiry");
        let uniqueid = "slowpoke";
        let _salt = start_pairing(&state, uniqueid);

        // an HTTP waiter registers on the held session
        let (tx, rx_http) = tokio::sync::oneshot::channel();
        state.register_pair_response(uniqueid, tx);

        // timeout fires: the session is expired, the waiter gets a 400,
        // and the UI is told pairing finished without success
        state.expire_pairing_session(uniqueid);
        let body = rx_http.blocking_recv().expect("held response");
        assert!(body.contains("status_code=\"400\""), "{body}");

        let event: serde_json::Value = serde_json::from_str(&rx.blocking_recv().unwrap()).unwrap();
        assert_eq!(event["event"], "pairing-requested");
        let event: serde_json::Value = serde_json::from_str(&rx.blocking_recv().unwrap()).unwrap();
        assert_eq!(event["event"], "pairing-finished");
        assert_eq!(event["success"], false);
    }

    #[test]
    fn pin_arriving_before_http_waiter_resolves_it() {
        let (state, _rx) = local_state("pin-first");
        let uniqueid = "fastpin";
        let _salt = start_pairing(&state, uniqueid);

        // PIN submitted before the held HTTP response registered
        assert!(state.submit_pairing_pin("4321").is_ok());

        // the late waiter still gets the response immediately
        let (tx, rx_http) = tokio::sync::oneshot::channel();
        state.register_pair_response(uniqueid, tx);
        let body = rx_http.blocking_recv().expect("held response");
        assert!(body.contains("plaincert"), "{body}");
    }

    /// The client's ANNOUNCE carries the minimum recovery packets it needs
    /// in every FEC block (the live client sends 2); the launch must hand
    /// it to the packetizer, absent or unparsable values leaving it at 0.
    #[test]
    fn announcement_parses_the_clients_fec_minimum() {
        let (state, _rx) = local_state("fec-min");
        let launch = make_launch_params(
            &params(&[
                ("appid", "1"),
                ("rikey", "00112233445566778899aabbccddeeff"),
            ]),
            "tester",
        )
        .expect("launch");
        state.begin_launch(launch).expect("begin launch");
        let minimum = |state: &State| {
            state
                .launch_params()
                .expect("launch params")
                .min_required_fec_packets
        };
        assert_eq!(minimum(&state), 0, "absent attribute: no minimum");

        state.update_announcement(&params(&[
            ("x-nv-vqos[0].fec.enable", "1"),
            ("x-nv-vqos[0].fec.minRequiredFecPackets", "2"),
        ]));
        assert_eq!(minimum(&state), 2);

        // an invalid value leaves the parsed minimum in place
        state.update_announcement(&params(&[(
            "x-nv-vqos[0].fec.minRequiredFecPackets",
            "two",
        )]));
        assert_eq!(minimum(&state), 2);
    }

    /// Audio payload encryption is gated on exactly one thing: bit 0x20
    /// (NVFF_AUDIO_ENCRYPTION) of the client's `x-nv-general.featureFlags`.
    /// The client sets that bit in the same branch that makes it AES-CBC
    /// decrypt every audio payload (`SdpGenerator.c:195-197`), and both of
    /// the clients that hit the silent-audio bug send 167 = 0xA7.
    #[test]
    fn announcement_gates_audio_encryption_on_the_feature_flags_bit() {
        let (state, _rx) = local_state("audio-encryption");
        let launch = make_launch_params(
            &params(&[
                ("appid", "1"),
                ("rikey", "00112233445566778899aabbccddeeff"),
                ("rikeyid", "305419896"),
            ]),
            "tester",
        )
        .expect("launch");
        state.begin_launch(launch).expect("begin launch");
        // the rikeyid the audio IV is built from rides the same /launch
        assert_eq!(state.launch_params().expect("launch").rikeyid, 305419896);

        let encrypted = |state: &State| state.launch_params().expect("launch").audio_encryption;
        assert!(!encrypted(&state), "absent attribute: plaintext");

        state.update_announcement(&params(&[("x-nv-general.featureFlags", "167")]));
        assert!(encrypted(&state), "0xA7 asks for NVFF_AUDIO_ENCRYPTION");

        // a client that keeps the bit clear keeps plaintext Opus
        state.update_announcement(&params(&[("x-nv-general.featureFlags", "135")]));
        assert!(!encrypted(&state), "0x87 does not ask for encrypted audio");

        // and an unparsable value is not a request either (it leaves the
        // previous state, like the FEC minimum above)
        state.update_announcement(&params(&[("x-nv-general.featureFlags", "0x20")]));
        assert!(!encrypted(&state));
    }

    /// The codec rule, exhaustively: HEVC only when the client asked for it
    /// with `x-nv-vqos[0].bitStreamFormat=1` AND the host's probe found an
    /// HEVC session. Everything else — attribute absent, 0 (H.264), 2 (AV1,
    /// which this host does not encode) or a host without HEVC — stays
    /// H.264, which is the pre-HEVC behavior byte for byte.
    #[test]
    fn codec_is_hevc_only_when_requested_and_available() {
        use crate::video::VideoCodec::{H264, Hevc};
        assert_eq!(negotiate_codec(Some(1), true), Hevc);
        assert_eq!(negotiate_codec(Some(1), false), H264, "host cannot encode it");
        assert_eq!(negotiate_codec(Some(0), true), H264);
        assert_eq!(negotiate_codec(Some(2), true), H264, "AV1 is not ours");
        assert_eq!(negotiate_codec(Some(7), true), H264, "unknown format");
        assert_eq!(negotiate_codec(None, true), H264, "absent attribute");
        assert_eq!(negotiate_codec(None, false), H264);
    }

    /// ...and the ANNOUNCE plumbing that feeds it: the attribute moves the
    /// pending launch's codec, an absent attribute leaves the H.264 default
    /// the launch was raised with.
    #[test]
    fn announcement_moves_the_session_codec() {
        let (state, _rx) = local_state("codec-negotiation");
        let launch = make_launch_params(
            &params(&[
                ("appid", "1"),
                ("rikey", "00112233445566778899aabbccddeeff"),
                ("rikeyid", "305419896"),
            ]),
            "tester",
        )
        .expect("launch");
        state.begin_launch(launch).expect("begin launch");

        let codec = |state: &State| state.launch_params().expect("launch").codec;
        assert_eq!(
            codec(&state),
            crate::video::VideoCodec::H264,
            "a launch starts H.264, before any ANNOUNCE"
        );

        // the client asks for HEVC: honored exactly when this host has the
        // session the probe opened
        state.update_announcement(&params(&[(
            "x-nv-vqos[0].bitStreamFormat",
            "1",
        )]));
        assert_eq!(
            codec(&state),
            negotiate_codec(Some(1), crate::capture::recovery_capability().hevc && crate::capture::hevc_offered())
        );

        // asking for H.264 (or for nothing) is H.264
        state.update_announcement(&params(&[(
            "x-nv-vqos[0].bitStreamFormat",
            "0",
        )]));
        assert_eq!(codec(&state), crate::video::VideoCodec::H264);
        state.update_announcement(&params(&[("x-nv-video[0].maxFPS", "60")]));
        assert_eq!(codec(&state), crate::video::VideoCodec::H264);
    }

    /// The serverinfo codec fields, both ways: `MaxLumaPixelsHEVC` is
    /// Sunshine's fixed budget when the probe found an HEVC session and 0
    /// when it did not, and `ServerCodecModeSupport` carries SCM_H264
    /// always plus SCM_HEVC when it can and SCM_HEVC_MAIN10 when a 10-bit
    /// session also opened (Sunshine's `get_codec_mode_flags`,
    /// nvhttp.cpp:1166-1190).
    #[test]
    fn serverinfo_codec_fields_follow_the_probe() {
        assert_eq!(max_luma_pixels_hevc(false), "0");
        assert_eq!(max_luma_pixels_hevc(true), "1869449984");
        // the bits the client reads (moonlight-common-c Limelight.h:506-513)
        assert_eq!(server_codec_mode_support(false, false), 0x1);
        assert_eq!(server_codec_mode_support(true, false), 0x101);
        assert_eq!(server_codec_mode_support(true, true), 0x301);
        assert_eq!(server_codec_mode_support(false, false) & SCM_HEVC, 0);
        // the HDR bit is never advertised without HEVC, whatever the probe
        // says about 10-bit (a client must not be offered Main10 over H.264)
        assert_eq!(server_codec_mode_support(false, true) & SCM_HEVC_MAIN10, 0);
        assert_ne!(server_codec_mode_support(false, false), 0, "the client hard-fails on 0");
    }

    fn launch_with_rikeyid(rikeyid: &str) -> LaunchParams {
        let mut pairs = vec![
            ("appid", "1"),
            ("rikey", "00112233445566778899aabbccddeeff"),
        ];
        pairs.push(("rikeyid", rikeyid));
        make_launch_params(&params(&pairs), "tester").expect("launch")
    }

    /// `rikeyid` is a SIGNED decimal: Moonlight generates a random int32 for
    /// it, so about half of all sessions carry a negative one (twelve
    /// distinct negative values in a single evening's logs, e.g.
    /// -1721505449). Sunshine parses it signed and truncates to the u32 the
    /// audio IV needs (`nvhttp.cpp:523`; `from_view` is an `std::int64_t`,
    /// `utility.h:820-822`). An unsigned parse read every negative id as
    /// "no value" and left 0, which built every audio IV from the wrong key
    /// id.
    #[test]
    fn launch_parses_rikeyid_as_a_signed_decimal() {
        assert_eq!(launch_with_rikeyid("-1721505449").rikeyid, 2_573_461_847);
        assert_eq!(launch_with_rikeyid("305419896").rikeyid, 305_419_896);
        assert_eq!(launch_with_rikeyid("-1").rikeyid, u32::MAX);
        assert_eq!(launch_with_rikeyid(" 42 ").rikeyid, 42);
        // genuinely unparsable: 0, as Sunshine's from_chars leaves it
        assert_eq!(launch_with_rikeyid("abc").rikeyid, 0);
        assert_eq!(launch_with_rikeyid("0x20").rikeyid, 0);
    }

    /// The same value end to end: the /launch query string of a real
    /// session, through the audio cipher, to a packet the client's own
    /// decrypt path (IV `BE32(rikeyid + sequence)`, then PKCS#7-stripping
    /// AES-128-CBC) recovers byte for byte. The IV asserted for packet 0 is
    /// `BE32(0x9963E957)`, the two's complement of -1721505449.
    #[test]
    fn negative_rikeyid_reaches_the_client_audio_decrypt() {
        let launch = launch_with_rikeyid("-1721505449");
        let frame = crate::crypto::hex_decode("5d0102030405060708090a0b0c0d0e0f1011121314").unwrap();
        let expected_iv: [u8; 16] = crate::crypto::hex_decode("9963e957000000000000000000000000")
            .unwrap()
            .try_into()
            .unwrap();

        let cipher = crate::audio::AudioCipher::new(launch.rikey, launch.rikeyid);
        assert_eq!(cipher.iv(0), expected_iv);
        let packet = crate::audio::AudioPacketizer::new(5)
            .with_cipher(Some(cipher))
            .packetize(&frame);
        assert_eq!(
            crate::crypto::client_audio_decrypt(&launch.rikey, &expected_iv, &packet[12..])
                .expect("the client decrypts"),
            frame
        );

        // the 0 the unsigned parse substituted never matches; note the pad
        // is still legal there (it lives in the last block, which the IV
        // does not touch), so the client plays noise rather than logging
        // "Failed to decrypt audio packet"
        let buggy = crate::audio::AudioCipher::new(launch.rikey, 0);
        assert_ne!(buggy.iv(0), expected_iv);
        assert_ne!(
            crate::crypto::client_audio_decrypt(&launch.rikey, &buggy.iv(0), &packet[12..])
                .expect("still unpads"),
            frame
        );
    }

    /// The certificate `authorize` stores: any non-PEM bytes stand in for the
    /// DER the TLS peer presents (`crypto::parse_cert` passes those through).
    const PEER_CERT: &[u8] = b"paired-client-der";

    /// A paired client, so /launch and /resume pass the authorization gate
    /// without a full pairing handshake. The uniqueid alone is not enough:
    /// requests must also present `PEER_CERT`.
    fn authorize(state: &State, uniqueid: &str) {
        let mut paired = state.paired.lock().expect("paired clients lock");
        paired.insert(
            uniqueid.to_string(),
            PairedClient {
                uniqueid: uniqueid.to_string(),
                name: "tester".to_string(),
                cert: String::from_utf8_lossy(PEER_CERT).into_owned(),
            },
        );
    }

    fn session_params(appid: u32) -> HashMap<String, String> {
        params(&[
            ("uniqueid", "tester"),
            ("rikey", "00112233445566778899aabbccddeeff"),
            ("rikeyid", "305419896"),
            ("localAudioPlayMode", "0"),
            ("appid", &appid.to_string()),
        ])
    }

    fn launch_params_for(appid: u32) -> LaunchParams {
        make_launch_params(&session_params(appid), "tester").expect("launch params")
    }

    /// `<currentgame>`/`<state>` follow the running *process* while the
    /// session is Idle — a game Hydra started from its own UI is what
    /// Moonlight sees — and the live session still wins during a handshake.
    #[test]
    fn serverinfo_reports_the_running_process_in_idle() {
        let (state, _rx) = local_state("serverinfo-running");

        let xml = serverinfo(&state, true, true, "127.0.0.1".parse().unwrap());
        assert_eq!(tag(&xml, "state"), "SUNSHINE_SERVER_FREE");
        assert_eq!(tag(&xml, "currentgame"), "0");

        state.set_running_appid(42);
        let xml = serverinfo(&state, true, true, "127.0.0.1".parse().unwrap());
        assert_eq!(tag(&xml, "state"), "SUNSHINE_SERVER_BUSY");
        assert_eq!(tag(&xml, "currentgame"), "42");

        // the pending handshake's own appid wins over the running process
        state.begin_launch(launch_params_for(7)).expect("begin launch");
        let xml = serverinfo(&state, true, true, "127.0.0.1".parse().unwrap());
        assert_eq!(tag(&xml, "state"), "SUNSHINE_SERVER_BUSY");
        assert_eq!(tag(&xml, "currentgame"), "7");
    }

    /// The uniqueid is a public constant on some clients, so a paired
    /// uniqueid authorizes only together with that client's stored
    /// certificate.
    #[test]
    fn paired_uniqueid_requires_the_stored_client_certificate() {
        let (state, _rx) = local_state("uniqueid-cert");
        authorize(&state, "tester");
        state.set_app_list(vec![(7, "Test Game".to_string(), None)]);

        // the uniqueid alone (no peer certificate) is not authorization
        let response = launch(&state, &session_params(7), "127.0.0.1".parse().unwrap(), None);
        assert!(response.contains("status_code=\"401\""), "{response}");
        assert!(
            response.contains("The client is not authorized"),
            "{response}"
        );
        assert_eq!(state.session_phase(), GamePhase::Idle);

        // nor is another client's certificate
        let response = launch(
            &state,
            &session_params(7),
            "127.0.0.1".parse().unwrap(),
            Some(b"some-other-client-der"),
        );
        assert!(response.contains("status_code=\"401\""), "{response}");
        assert_eq!(state.session_phase(), GamePhase::Idle);

        // the stored certificate is
        let response = launch(
            &state,
            &session_params(7),
            "127.0.0.1".parse().unwrap(),
            Some(PEER_CERT),
        );
        assert!(response.contains("status_code=\"200\""), "{response}");
        assert_eq!(state.session_phase(), GamePhase::Launching);
    }

    /// A game running outside the client flow: the same appid attaches (no
    /// second instance, no `launch-requested`), any other 400s like Sunshine.
    #[test]
    fn launch_attaches_to_the_same_running_app_and_rejects_another() {
        let (state, mut rx) = local_state("launch-running");
        authorize(&state, "tester");
        state.set_app_list(vec![
            (7, "Test Game".to_string(), None),
            (9, "Other Game".to_string(), None),
        ]);

        state.set_running_appid(9);
        let response = launch(
            &state,
            &session_params(7),
            "127.0.0.1".parse().unwrap(),
            Some(PEER_CERT),
        );
        assert!(response.contains("status_code=\"400\""), "{response}");
        assert!(
            response.contains("An app is already running on this host"),
            "{response}"
        );
        assert!(rx.try_recv().is_err(), "a refused launch emits nothing");
        assert_eq!(state.session_phase(), GamePhase::Idle);

        state.set_running_appid(7);
        let response = launch(
            &state,
            &session_params(7),
            "127.0.0.1".parse().unwrap(),
            Some(PEER_CERT),
        );
        assert!(response.contains("status_code=\"200\""), "{response}");
        assert!(response.contains("<gamesession>1</gamesession>"), "{response}");
        assert_eq!(state.session_phase(), GamePhase::Launching);
        while let Ok(event) = rx.try_recv() {
            let event: serde_json::Value = serde_json::from_str(&event).unwrap();
            assert_ne!(
                event["event"], "launch-requested",
                "an attach must not ask the host to start the game again"
            );
        }
    }

    /// /resume with no session adopts the running process, and reproduces
    /// Sunshine's status codes when there is nothing to adopt.
    #[test]
    fn resume_adopts_the_running_app_or_fails_like_sunshine() {
        let (state, _rx) = local_state("resume-running");
        authorize(&state, "tester");

        let response = resume(
            &state,
            &session_params(7),
            "127.0.0.1".parse().unwrap(),
            Some(PEER_CERT),
        );
        assert!(response.contains("status_code=\"503\""), "{response}");
        assert!(response.contains("No running app to resume"), "{response}");

        state.set_running_appid(9);
        let response = resume(
            &state,
            &session_params(7),
            "127.0.0.1".parse().unwrap(),
            Some(PEER_CERT),
        );
        assert!(response.contains("status_code=\"404\""), "{response}");
        assert!(
            response.contains("Failed to start the specified application"),
            "{response}"
        );

        state.set_running_appid(7);
        let response = resume(
            &state,
            &session_params(7),
            "127.0.0.1".parse().unwrap(),
            Some(PEER_CERT),
        );
        assert!(response.contains("status_code=\"200\""), "{response}");
        assert!(response.contains("<resume>1</resume>"), "{response}");
        assert_eq!(state.session_phase(), GamePhase::Launching);
    }
}

/// Binds one media UDP port for the life of the process: nonblocking, with
/// enlarged kernel buffers so an IDR burst does not would-block the sender
/// (a full send buffer on relaunch starved the client's decoder and spun
/// it into an IDR-request flood).
fn bind_media_socket(port: u16) -> Result<std::net::UdpSocket, String> {
    let socket = std::net::UdpSocket::bind(("0.0.0.0", port))
        .map_err(|error| format!("media port {port} bind: {error}"))?;
    socket
        .set_nonblocking(true)
        .map_err(|error| format!("media port {port} nonblocking: {error}"))?;
    crate::stream::enlarge_udp_buffers(&socket, port);
    Ok(socket)
}
