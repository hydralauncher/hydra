use std::collections::{HashMap, HashSet};
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::SystemTime;
use std::time::{Duration, Instant};

use data_encoding::BASE32;
use librqbit::{
    AddTorrent, AddTorrentOptions, AddTorrentResponse, Api, Session, SessionOptions, TorrentStats,
    TorrentStatsState,
};
use napi::bindgen_prelude::Error;
use napi_derive::napi;
use once_cell::sync::Lazy;
use regex::Regex;
use tokio::runtime::Runtime;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use url::Url;

const TORRENT_FILES_CACHE_TTL_SECONDS: u64 = 300;
const TORRENT_FILES_CACHE_MAX_ITEMS: usize = 128;
const TORRENT_MAX_FILES: usize = 100_000;
const SEED_ESTIMATE_TTL_SECONDS: u64 = 600;
const SEED_POLL_INTERVAL_SECONDS: u64 = 90;
const ENABLE_TRACKER_SEED_ESTIMATOR: bool = false;

static MAGNET_HASH_HEX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[a-fA-F0-9]{40}$").expect("valid regex"));
static MAGNET_HASH_BASE32_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[a-zA-Z2-7]{32}$").expect("valid regex"));

static TOKIO_RT: Lazy<Runtime> = Lazy::new(|| {
    Runtime::new().unwrap_or_else(|err| panic!("failed to initialize tokio runtime: {err}"))
});

static TORRENT_MANAGER: Lazy<Mutex<TorrentManager>> = Lazy::new(|| Mutex::new(TorrentManager::new()));
static TRACKER_HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(7))
        .build()
        .unwrap_or_else(|err| panic!("failed to initialize tracker http client: {err}"))
});

const TRACKER_PEER_ID: &[u8; 20] = b"-HY0001-012345678901";

const DEFAULT_TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "http://tracker.opentrackr.org:1337/announce",
    "udp://open.tracker.cl:1337/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.theoks.net:6969/announce",
    "udp://tracker-udp.gbitt.info:80/announce",
    "udp://explodie.org:6969/announce",
    "https://tracker.tamersunion.org:443/announce",
    "udp://tracker2.dler.org:80/announce",
    "udp://tracker1.myporn.club:9337/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://tracker.bittor.pw:1337/announce",
    "udp://tracker.0x7c0.com:6969/announce",
    "udp://retracker01-msk-virt.corbina.net:80/announce",
    "udp://opentracker.io:6969/announce",
    "udp://open.free-tracker.ga:6969/announce",
    "udp://new-line.net:6969/announce",
    "udp://moonburrow.club:6969/announce",
    "udp://leet-tracker.moe:1337/announce",
    "udp://bt2.archive.org:6969/announce",
    "udp://bt1.archive.org:6969/announce",
    "http://tracker2.dler.org:80/announce",
    "http://tracker1.bt.moack.co.kr:80/announce",
    "http://tracker.dler.org:6969/announce",
    "http://tr.kxmp.cf:80/announce",
    "udp://u.peer-exchange.download:6969/announce",
    "udp://ttk2.nbaonlineservice.com:6969/announce",
    "udp://tracker.tryhackx.org:6969/announce",
    "udp://tracker.srv00.com:6969/announce",
    "udp://tracker.skynetcloud.site:6969/announce",
    "udp://tracker.jamesthebard.net:6969/announce",
    "udp://tracker.fnix.net:6969/announce",
    "udp://tracker.filemail.com:6969/announce",
    "udp://tracker.farted.net:6969/announce",
    "udp://tracker.edkj.club:6969/announce",
    "udp://tracker.dump.cl:6969/announce",
    "udp://tracker.deadorbit.nl:6969/announce",
    "udp://tracker.darkness.services:6969/announce",
    "udp://tracker.ccp.ovh:6969/announce",
    "udp://tamas3.ynh.fr:6969/announce",
    "udp://ryjer.com:6969/announce",
    "udp://run.publictracker.xyz:6969/announce",
    "udp://public.tracker.vraphim.com:6969/announce",
    "udp://p4p.arenabg.com:1337/announce",
    "udp://p2p.publictracker.xyz:6969/announce",
    "udp://open.u-p.pw:6969/announce",
    "udp://open.publictracker.xyz:6969/announce",
    "udp://open.dstud.io:6969/announce",
    "udp://open.demonoid.ch:6969/announce",
    "udp://odd-hd.fr:6969/announce",
    "udp://martin-gebhardt.eu:25/announce",
    "udp://jutone.com:6969/announce",
    "udp://isk.richardsw.club:6969/announce",
    "udp://evan.im:6969/announce",
    "udp://epider.me:6969/announce",
    "udp://d40969.acod.regrucolo.ru:6969/announce",
    "udp://bt.rer.lol:6969/announce",
    "udp://amigacity.xyz:6969/announce",
    "udp://1c.premierzal.ru:6969/announce",
    "https://trackers.run:443/announce",
    "https://tracker.yemekyedim.com:443/announce",
    "https://tracker.renfei.net:443/announce",
    "https://tracker.pmman.tech:443/announce",
    "https://tracker.lilithraws.org:443/announce",
    "https://tracker.imgoingto.icu:443/announce",
    "https://tracker.cloudit.top:443/announce",
    "https://tracker-zhuqiy.dgj055.icu:443/announce",
    "http://tracker.renfei.net:8080/announce",
    "http://tracker.mywaifu.best:6969/announce",
    "http://tracker.ipv6tracker.org:80/announce",
    "http://tracker.files.fm:6969/announce",
    "http://tracker.edkj.club:6969/announce",
    "http://tracker.bt4g.com:2095/announce",
    "http://tracker-zhuqiy.dgj055.icu:80/announce",
    "http://t1.aag.moe:17715/announce",
    "http://t.overflow.biz:6969/announce",
    "http://bittorrent-tracker.e-n-c-r-y-p-t.net:1337/announce",
    "udp://torrents.artixlinux.org:6969/announce",
    "udp://mail.artixlinux.org:6969/announce",
    "udp://ipv4.rer.lol:2710/announce",
    "udp://concen.org:6969/announce",
    "udp://bt.rer.lol:2710/announce",
    "udp://aegir.sexy:6969/announce",
    "https://www.peckservers.com:9443/announce",
    "https://tracker.ipfsscan.io:443/announce",
    "https://tracker.gcrenwp.top:443/announce",
    "http://www.peckservers.com:9000/announce",
    "http://tracker1.itzmx.com:8080/announce",
    "http://ch3oh.ru:6969/announce",
    "http://bvarf.tracker.sh:2086/announce",
];

#[napi(object)]
#[derive(Clone)]
pub struct TorrentFileEntry {
    pub index: u32,
    pub path: String,
    pub length: i64,
}

#[napi(object)]
#[derive(Clone)]
pub struct TorrentFilesPayload {
    pub info_hash: String,
    pub name: String,
    pub total_size: i64,
    pub files: Vec<TorrentFileEntry>,
}

#[napi(object)]
#[derive(Clone)]
pub struct TorrentStatusPayload {
    pub progress: f64,
    pub num_peers: u32,
    pub num_seeds: u32,
    pub download_speed: i64,
    pub upload_speed: i64,
    pub bytes_downloaded: i64,
    pub file_size: i64,
    pub folder_name: String,
    pub status: u32,
}

#[napi(object)]
#[derive(Clone)]
pub struct TorrentSeedStatusPayload {
    pub game_id: String,
    pub progress: f64,
    pub num_peers: u32,
    pub num_seeds: u32,
    pub download_speed: i64,
    pub upload_speed: i64,
    pub bytes_downloaded: i64,
    pub file_size: i64,
    pub folder_name: String,
    pub status: u32,
}

#[napi(object)]
pub struct StartTorrentPayload {
    pub game_id: String,
    pub url: String,
    pub save_path: String,
    pub file_indices: Option<Vec<u32>>,
    pub timeout_ms: Option<u32>,
}

#[napi(object)]
pub struct ResumeSeedingPayload {
    pub game_id: String,
    pub url: String,
    pub save_path: String,
}

struct CachedTorrentFiles {
    cached_at: Instant,
    payload: TorrentFilesPayload,
}

struct PendingStart {
    save_path: String,
}

#[derive(Clone)]
struct TorrentMeta {
    info_hash: String,
    trackers: Vec<String>,
}

struct SeedEstimate {
    value: u32,
    updated_at: Instant,
}

struct TorrentManager {
    session: Option<Arc<Session>>,
    downloads: HashMap<String, Arc<librqbit::ManagedTorrent>>,
    torrent_meta: HashMap<String, TorrentMeta>,
    seed_estimates: HashMap<String, SeedEstimate>,
    pending_starts: HashMap<String, PendingStart>,
    pending_tasks: HashMap<String, JoinHandle<()>>,
    seed_poll_tasks: HashMap<String, JoinHandle<()>>,
    downloading_game_id: Option<String>,
    seeding_game_ids: HashSet<String>,
    current_download_limit: Option<u32>,
    torrent_files_cache: HashMap<String, CachedTorrentFiles>,
}

impl TorrentManager {
    fn new() -> Self {
        Self {
            session: None,
            downloads: HashMap::new(),
            torrent_meta: HashMap::new(),
            seed_estimates: HashMap::new(),
            pending_starts: HashMap::new(),
            pending_tasks: HashMap::new(),
            seed_poll_tasks: HashMap::new(),
            downloading_game_id: None,
            seeding_game_ids: HashSet::new(),
            current_download_limit: None,
            torrent_files_cache: HashMap::new(),
        }
    }

    fn normalize_timeout_ms(timeout_ms: Option<u32>, default_ms: u32) -> u32 {
        let value = timeout_ms.unwrap_or(default_ms);
        value.clamp(5_000, 120_000)
    }

    fn cache_get(&mut self, info_hash: &str) -> Option<TorrentFilesPayload> {
        self.prune_expired_cache();
        self.torrent_files_cache
            .get(info_hash)
            .map(|item| item.payload.clone())
    }

    fn cache_set(&mut self, info_hash: String, payload: TorrentFilesPayload) {
        self.prune_expired_cache();

        if self.torrent_files_cache.len() >= TORRENT_FILES_CACHE_MAX_ITEMS {
            let oldest_key = self
                .torrent_files_cache
                .iter()
                .min_by_key(|(_, value)| value.cached_at)
                .map(|(key, _)| key.clone());

            if let Some(key) = oldest_key {
                self.torrent_files_cache.remove(&key);
            }
        }

        self.torrent_files_cache.insert(
            info_hash,
            CachedTorrentFiles {
                cached_at: Instant::now(),
                payload,
            },
        );
    }

    fn prune_expired_cache(&mut self) {
        let ttl = Duration::from_secs(TORRENT_FILES_CACHE_TTL_SECONDS);
        self.torrent_files_cache
            .retain(|_, value| value.cached_at.elapsed() <= ttl);
    }

    fn abort_pending_start(&mut self, game_id: &str) {
        if let Some(task) = self.pending_tasks.remove(game_id) {
            task.abort();
        }
        self.pending_starts.remove(game_id);
    }

    fn stop_seed_polling(&mut self, game_id: &str) {
        if let Some(task) = self.seed_poll_tasks.remove(game_id) {
            task.abort();
        }
        self.seed_estimates.remove(game_id);
    }
}

fn map_anyhow_error(error: anyhow::Error) -> Error {
    let message = error.to_string().to_lowercase();

    if message.contains("magnet") || message.contains("btih") || message.contains("scheme") {
        return Error::from_reason("invalid_magnet");
    }

    if message.contains("only_files contains invalid value") {
        return Error::from_reason("invalid_file_indices");
    }

    Error::from_reason(error.to_string())
}

fn validate_magnet_uri(raw_magnet: &str) -> napi::Result<(String, String)> {
    let magnet = raw_magnet.trim();

    if !magnet.starts_with("magnet:") || magnet.len() > 8192 {
        return Err(Error::from_reason("invalid_magnet"));
    }

    let parsed = Url::parse(magnet).map_err(|_| Error::from_reason("invalid_magnet"))?;
    if parsed.scheme() != "magnet" {
        return Err(Error::from_reason("invalid_magnet"));
    }

    for (key, value) in parsed.query_pairs() {
        if key != "xt" {
            continue;
        }

        if !value.starts_with("urn:btih:") {
            continue;
        }

        let hash = value[9..].trim().to_lowercase();
        if MAGNET_HASH_HEX_RE.is_match(&hash) || MAGNET_HASH_BASE32_RE.is_match(&hash) {
            return Ok((magnet.to_string(), hash));
        }
    }

    Err(Error::from_reason("invalid_magnet"))
}

fn parse_magnet_trackers(magnet: &str) -> Vec<String> {
    let mut trackers = DEFAULT_TRACKERS
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();

    if let Ok(parsed) = Url::parse(magnet) {
        for (key, value) in parsed.query_pairs() {
            if key == "tr" {
                let tracker = value.to_string();
                if !trackers.contains(&tracker) {
                    trackers.push(tracker);
                }
            }
        }
    }

    trackers
}

fn decode_info_hash_bytes(hash: &str) -> Option<[u8; 20]> {
    if hash.len() == 40 {
        let mut output = [0u8; 20];
        for (index, chunk) in hash.as_bytes().chunks(2).enumerate() {
            let piece = std::str::from_utf8(chunk).ok()?;
            output[index] = u8::from_str_radix(piece, 16).ok()?;
        }
        return Some(output);
    }

    if hash.len() == 32 {
        let decoded = BASE32.decode(hash.to_uppercase().as_bytes()).ok()?;
        if decoded.len() == 20 {
            let mut output = [0u8; 20];
            output.copy_from_slice(&decoded);
            return Some(output);
        }
    }

    None
}

fn parse_complete_from_bencode(bytes: &[u8]) -> Option<u32> {
    let marker = b"8:completei";
    let pos = bytes.windows(marker.len()).position(|window| window == marker)?;
    let mut cursor = pos + marker.len();
    let mut value = 0u32;
    let mut parsed_digit = false;

    while let Some(byte) = bytes.get(cursor).copied() {
        if byte == b'e' {
            return if parsed_digit { Some(value) } else { None };
        }

        if !byte.is_ascii_digit() {
            return None;
        }

        parsed_digit = true;
        value = value.saturating_mul(10).saturating_add((byte - b'0') as u32);
        cursor += 1;
    }

    None
}

async fn fetch_tracker_seeders_http(tracker: &str, info_hash: &[u8; 20]) -> Option<u32> {
    let mut url = Url::parse(tracker).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }

    {
        let mut query = url.query_pairs_mut();
        query.append_pair("info_hash", &urlencoding::encode_binary(info_hash));
        query.append_pair("peer_id", &urlencoding::encode_binary(TRACKER_PEER_ID));
        query.append_pair("port", "0");
        query.append_pair("uploaded", "0");
        query.append_pair("downloaded", "0");
        query.append_pair("left", "0");
        query.append_pair("compact", "1");
        query.append_pair("event", "started");
    }

    let response = TRACKER_HTTP_CLIENT.get(url).send().await.ok()?;
    let bytes = response.bytes().await.ok()?;
    parse_complete_from_bencode(&bytes)
}

fn next_tracker_transaction_id() -> u32 {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.subsec_nanos())
        .unwrap_or(0);
    nanos ^ 0x5A17_4E3D
}

async fn fetch_tracker_seeders_udp(tracker: &str, info_hash: &[u8; 20]) -> Option<u32> {
    let parsed = Url::parse(tracker).ok()?;
    if parsed.scheme() != "udp" {
        return None;
    }

    let host = parsed.host_str()?;
    let port = parsed.port().unwrap_or(80);
    let target = format!("{host}:{port}");

    let socket = tokio::net::UdpSocket::bind("0.0.0.0:0").await.ok()?;

    let connect_tid = next_tracker_transaction_id();
    let mut connect_request = [0u8; 16];
    connect_request[0..8].copy_from_slice(&0x41727101980u64.to_be_bytes());
    connect_request[8..12].copy_from_slice(&0u32.to_be_bytes());
    connect_request[12..16].copy_from_slice(&connect_tid.to_be_bytes());

    socket.send_to(&connect_request, &target).await.ok()?;

    let mut response = [0u8; 2048];
    let (connect_len, _) = timeout(Duration::from_secs(4), socket.recv_from(&mut response))
        .await
        .ok()?
        .ok()?;

    if connect_len < 16 {
        return None;
    }

    let action = u32::from_be_bytes(response[0..4].try_into().ok()?);
    let response_tid = u32::from_be_bytes(response[4..8].try_into().ok()?);

    if action != 0 || response_tid != connect_tid {
        return None;
    }

    let connection_id = u64::from_be_bytes(response[8..16].try_into().ok()?);

    let announce_tid = next_tracker_transaction_id();
    let mut announce_request = vec![0u8; 98];
    announce_request[0..8].copy_from_slice(&connection_id.to_be_bytes());
    announce_request[8..12].copy_from_slice(&1u32.to_be_bytes());
    announce_request[12..16].copy_from_slice(&announce_tid.to_be_bytes());
    announce_request[16..36].copy_from_slice(info_hash);
    announce_request[36..56].copy_from_slice(TRACKER_PEER_ID);
    announce_request[56..64].copy_from_slice(&0u64.to_be_bytes());
    announce_request[64..72].copy_from_slice(&0u64.to_be_bytes());
    announce_request[72..80].copy_from_slice(&0u64.to_be_bytes());
    announce_request[80..84].copy_from_slice(&2u32.to_be_bytes());
    announce_request[84..88].copy_from_slice(&0u32.to_be_bytes());
    announce_request[88..92].copy_from_slice(&0u32.to_be_bytes());
    announce_request[92..96].copy_from_slice(&(-1i32).to_be_bytes());
    announce_request[96..98].copy_from_slice(&0u16.to_be_bytes());

    socket.send_to(&announce_request, &target).await.ok()?;

    let (announce_len, _) = timeout(Duration::from_secs(5), socket.recv_from(&mut response))
        .await
        .ok()?
        .ok()?;

    if announce_len < 20 {
        return None;
    }

    let action = u32::from_be_bytes(response[0..4].try_into().ok()?);
    let response_tid = u32::from_be_bytes(response[4..8].try_into().ok()?);

    if action != 1 || response_tid != announce_tid {
        return None;
    }

    let seeders = u32::from_be_bytes(response[16..20].try_into().ok()?);
    Some(seeders)
}

async fn update_seed_estimate(game_id: &str, meta: &TorrentMeta) {
    let Some(info_hash) = decode_info_hash_bytes(&meta.info_hash) else {
        return;
    };

    let mut best = None;
    for tracker in &meta.trackers {
        let estimate = if tracker.starts_with("udp://") {
            fetch_tracker_seeders_udp(tracker, &info_hash).await
        } else {
            fetch_tracker_seeders_http(tracker, &info_hash).await
        };

        if let Some(value) = estimate {
            best = Some(best.map_or(value, |current: u32| current.max(value)));
        }
    }

    if let Some(value) = best {
        let mut manager = TORRENT_MANAGER.lock().await;
        manager.seed_estimates.insert(
            game_id.to_string(),
            SeedEstimate {
                value,
                updated_at: Instant::now(),
            },
        );
    }
}

async fn ensure_seed_polling(game_id: String) {
    if !ENABLE_TRACKER_SEED_ESTIMATOR {
        return;
    }

    let meta = {
        let mut manager = TORRENT_MANAGER.lock().await;

        if manager.seed_poll_tasks.contains_key(&game_id) {
            return;
        }

        let Some(meta) = manager.torrent_meta.get(&game_id).cloned() else {
            return;
        };

        let game_id_for_task = game_id.clone();
        let meta_for_task = meta.clone();

        let task = TOKIO_RT.spawn(async move {
            loop {
                update_seed_estimate(&game_id_for_task, &meta_for_task).await;
                tokio::time::sleep(Duration::from_secs(SEED_POLL_INTERVAL_SECONDS)).await;
            }
        });

        manager.seed_poll_tasks.insert(game_id.clone(), task);
        meta
    };

    update_seed_estimate(&game_id, &meta).await;
}

fn current_seed_estimate(manager: &TorrentManager, game_id: &str) -> Option<u32> {
    if !ENABLE_TRACKER_SEED_ESTIMATOR {
        return None;
    }

    let estimate = manager.seed_estimates.get(game_id)?;
    if estimate.updated_at.elapsed() > Duration::from_secs(SEED_ESTIMATE_TTL_SECONDS) {
        return None;
    }
    Some(estimate.value)
}

fn build_tracker_set() -> HashSet<Url> {
    DEFAULT_TRACKERS
        .iter()
        .filter_map(|value| Url::parse(value).ok())
        .collect()
}

async fn get_or_create_session() -> napi::Result<Arc<Session>> {
    let (existing, limit) = {
        let manager = TORRENT_MANAGER.lock().await;
        (manager.session.clone(), manager.current_download_limit)
    };

    if let Some(session) = existing {
        return Ok(session);
    }

    let mut opts = SessionOptions::default();
    opts.listen_port_range = Some(5881..5892);
    opts.trackers = build_tracker_set();
    opts.enable_upnp_port_forwarding = true;

    let session = Session::new_with_opts(std::env::temp_dir(), opts)
        .await
        .map_err(map_anyhow_error)?;

    if let Some(value) = limit {
        session.ratelimits.set_download_bps(NonZeroU32::new(value));
    }

    let mut manager = TORRENT_MANAGER.lock().await;
    if manager.session.is_none() {
        manager.session = Some(session.clone());
    }

    Ok(manager.session.as_ref().expect("session exists").clone())
}

fn compute_status(
    stats: &TorrentStats,
    metadata_available: bool,
    seeding_hint: bool,
) -> (u32, u32, u32, i64, i64, u32) {
    match stats.state {
        TorrentStatsState::Initializing => {
            let state = if metadata_available { 1 } else { 2 };
            (state, 0, 0, 0, 0, 0)
        }
        TorrentStatsState::Live => {
            let status = if stats.finished {
                if seeding_hint {
                    5
                } else {
                    4
                }
            } else {
                3
            };

            let (num_peers, download_speed, upload_speed, connected_seeders) =
                if let Some(live) = &stats.live {
                (
                    (live.snapshot.peer_stats.live + live.snapshot.peer_stats.connecting) as u32,
                    (live.download_speed.mbps * 1024.0 * 1024.0).max(0.0) as i64,
                    (live.upload_speed.mbps * 1024.0 * 1024.0).max(0.0) as i64,
                    live.snapshot.peer_stats.not_needed as u32,
                )
            } else {
                (0, 0, 0, 0)
            };

            (
                status,
                num_peers,
                0,
                download_speed,
                upload_speed,
                connected_seeders,
            )
        }
        TorrentStatsState::Paused => {
            let status = if stats.finished {
                if seeding_hint {
                    5
                } else {
                    4
                }
            } else {
                3
            };
            (status, 0, 0, 0, 0, 0)
        }
        TorrentStatsState::Error => (3, 0, 0, 0, 0, 0),
    }
}

fn build_status_payload(
    handle: &Arc<librqbit::ManagedTorrent>,
    seeding_hint: bool,
    tracker_seed_estimate: Option<u32>,
) -> TorrentStatusPayload {
    let stats = handle.stats();
    let metadata_available = handle.with_metadata(|_| ()).is_ok();
    let (status, num_peers, _num_seeds, download_speed, upload_speed, connected_seeders) =
        compute_status(&stats, metadata_available, seeding_hint);

    let num_seeds = tracker_seed_estimate
        .unwrap_or(0)
        .max(connected_seeders);

    let file_size = stats.total_bytes;
    let bytes_downloaded = stats.progress_bytes;
    let progress = if file_size > 0 {
        (bytes_downloaded as f64 / file_size as f64).clamp(0.0, 1.0)
    } else if stats.finished {
        1.0
    } else {
        0.0
    };

    TorrentStatusPayload {
        progress,
        num_peers,
        num_seeds,
        download_speed,
        upload_speed,
        bytes_downloaded: bytes_downloaded as i64,
        file_size: file_size as i64,
        folder_name: handle.name().unwrap_or_default(),
        status,
    }
}

async fn fetch_torrent_files_internal(
    magnet: String,
    info_hash: String,
    timeout_ms: u32,
) -> napi::Result<TorrentFilesPayload> {
    {
        let mut manager = TORRENT_MANAGER.lock().await;
        if let Some(cached) = manager.cache_get(&info_hash) {
            return Ok(cached);
        }
    }

    let session = get_or_create_session().await?;
    let api = Api::new(session, None);
    let mut opts = AddTorrentOptions::default();
    opts.list_only = true;

    let add_future = api.api_add_torrent(AddTorrent::from_url(magnet), Some(opts));
    let response = timeout(Duration::from_millis(timeout_ms as u64), add_future)
        .await
        .map_err(|_| Error::from_reason("metadata_timeout"))?
        .map_err(|error| {
            let message = error.to_string();
            if message.to_lowercase().contains("timeout") {
                Error::from_reason("metadata_timeout")
            } else {
                Error::from_reason("metadata_incomplete")
            }
        })?;

    let files = response
        .details
        .files
        .ok_or_else(|| Error::from_reason("metadata_incomplete"))?;

    if files.len() > TORRENT_MAX_FILES {
        return Err(Error::from_reason("too_many_files"));
    }

    let mut mapped_files = Vec::with_capacity(files.len());
    let mut total_size = 0u64;

    for (index, file) in files.into_iter().enumerate() {
        let path = if file.components.is_empty() {
            file.name
        } else {
            let mut components = file.components;
            components.push(file.name);
            PathBuf::from_iter(components)
                .to_string_lossy()
                .to_string()
        };

        total_size = total_size.saturating_add(file.length);

        mapped_files.push(TorrentFileEntry {
            index: index as u32,
            path,
            length: file.length as i64,
        });
    }

    let payload = TorrentFilesPayload {
        info_hash: info_hash.clone(),
        name: response.details.name.unwrap_or_default(),
        total_size: total_size as i64,
        files: mapped_files,
    };

    let mut manager = TORRENT_MANAGER.lock().await;
    manager.cache_set(info_hash, payload.clone());

    Ok(payload)
}

async fn complete_pending_start(
    game_id: String,
    info_hash: String,
    magnet: String,
    save_path: String,
) -> napi::Result<()> {
    let trackers = parse_magnet_trackers(&magnet);
    let session = get_or_create_session().await?;

    let mut opts = AddTorrentOptions::default();
    opts.output_folder = Some(save_path);
    opts.overwrite = true;

    let response = session
        .add_torrent(AddTorrent::from_url(magnet), Some(opts))
        .await
        .map_err(map_anyhow_error)?;

    let handle = match response {
        AddTorrentResponse::Added(_, handle) | AddTorrentResponse::AlreadyManaged(_, handle) => {
            handle
        }
        AddTorrentResponse::ListOnly(_) => {
            return Err(Error::from_reason("metadata_incomplete"));
        }
    };

    let mut manager = TORRENT_MANAGER.lock().await;
    manager.pending_starts.remove(&game_id);
    manager.pending_tasks.remove(&game_id);
    manager.downloads.insert(game_id.clone(), handle);
    manager.torrent_meta.insert(
        game_id.clone(),
        TorrentMeta {
            info_hash,
            trackers,
        },
    );
    manager.downloading_game_id = Some(game_id.clone());
    manager.seeding_game_ids.remove(&game_id);
    drop(manager);

    ensure_seed_polling(game_id).await;
    Ok(())
}

#[napi]
pub fn torrent_get_status() -> napi::Result<Option<TorrentStatusPayload>> {
    TOKIO_RT.block_on(async {
        let manager = TORRENT_MANAGER.lock().await;

        let Some(game_id) = &manager.downloading_game_id else {
            return Ok(None);
        };

        if let Some(handle) = manager.downloads.get(game_id) {
            let tracker_seed_estimate = current_seed_estimate(&manager, game_id);
            return Ok(Some(build_status_payload(
                handle,
                manager.seeding_game_ids.contains(game_id),
                tracker_seed_estimate,
            )));
        }

        if let Some(pending) = manager.pending_starts.get(game_id) {
            return Ok(Some(TorrentStatusPayload {
                progress: 0.0,
                num_peers: 0,
                num_seeds: 0,
                download_speed: 0,
                upload_speed: 0,
                bytes_downloaded: 0,
                file_size: 0,
                folder_name: PathBuf::from(&pending.save_path)
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_default(),
                status: 2,
            }));
        }

        Ok(None)
    })
}

#[napi]
pub fn torrent_get_seed_status() -> napi::Result<Vec<TorrentSeedStatusPayload>> {
    TOKIO_RT.block_on(async {
        let manager = TORRENT_MANAGER.lock().await;
        let mut payload = Vec::new();

        for game_id in &manager.seeding_game_ids {
            let Some(handle) = manager.downloads.get(game_id) else {
                continue;
            };

            let status = build_status_payload(handle, true, current_seed_estimate(&manager, game_id));
            if status.status != 5 {
                continue;
            }

            payload.push(TorrentSeedStatusPayload {
                game_id: game_id.clone(),
                progress: status.progress,
                num_peers: status.num_peers,
                num_seeds: status.num_seeds,
                download_speed: status.download_speed,
                upload_speed: status.upload_speed,
                bytes_downloaded: status.bytes_downloaded,
                file_size: status.file_size,
                folder_name: status.folder_name,
                status: status.status,
            });
        }

        Ok(payload)
    })
}

#[napi]
pub fn torrent_get_files(
    magnet: String,
    timeout_ms: Option<u32>,
) -> napi::Result<TorrentFilesPayload> {
    TOKIO_RT.block_on(async {
        let (magnet, info_hash) = validate_magnet_uri(&magnet)?;
        let timeout_ms = TorrentManager::normalize_timeout_ms(timeout_ms, 30_000);
        fetch_torrent_files_internal(magnet, info_hash, timeout_ms).await
    })
}

#[napi]
pub fn torrent_start(payload: StartTorrentPayload) -> napi::Result<()> {
    TOKIO_RT.block_on(async {
        if payload.save_path.trim().is_empty() {
            return Err(Error::from_reason("invalid_save_path"));
        }

        let (magnet, info_hash) = validate_magnet_uri(&payload.url)?;
        let is_selective = payload.file_indices.is_some();

        let existing_handle = {
            let manager = TORRENT_MANAGER.lock().await;
            manager.downloads.get(&payload.game_id).cloned()
        };

        if !is_selective {
            if let Some(handle) = existing_handle {
                let session = get_or_create_session().await?;
                let _ = session.unpause(&handle).await;

                let mut manager = TORRENT_MANAGER.lock().await;
                manager.downloading_game_id = Some(payload.game_id.clone());
                manager.seeding_game_ids.remove(&payload.game_id);
                manager.pending_starts.remove(&payload.game_id);
                drop(manager);
                ensure_seed_polling(payload.game_id).await;
                return Ok(());
            }

            {
                let mut manager = TORRENT_MANAGER.lock().await;
                manager.abort_pending_start(&payload.game_id);
                manager.pending_starts.insert(
                    payload.game_id.clone(),
                    PendingStart {
                        save_path: payload.save_path.clone(),
                    },
                );
                manager.downloading_game_id = Some(payload.game_id.clone());
                manager.seeding_game_ids.remove(&payload.game_id);
            }

            {
                let mut manager = TORRENT_MANAGER.lock().await;
                manager.torrent_meta.insert(
                    payload.game_id.clone(),
                    TorrentMeta {
                        info_hash: info_hash.clone(),
                        trackers: parse_magnet_trackers(&magnet),
                    },
                );
            }

            if let Err(error) = complete_pending_start(
                payload.game_id.clone(),
                info_hash,
                magnet,
                payload.save_path,
            )
            .await
            {
                eprintln!(
                    "[hydra-native] pending torrent start failed for {}: {}",
                    payload.game_id, error
                );

                let mut manager = TORRENT_MANAGER.lock().await;
                manager.pending_starts.remove(&payload.game_id);
                manager.pending_tasks.remove(&payload.game_id);

                if manager.downloading_game_id.as_deref() == Some(payload.game_id.as_str()) {
                    manager.downloading_game_id = None;
                }

                return Err(error);
            }
            return Ok(());
        }

        if let Some(handle) = existing_handle {
            let session = get_or_create_session().await?;
            let _ = session.delete(handle.id().into(), false).await;
        }

        {
            let mut manager = TORRENT_MANAGER.lock().await;
            manager.abort_pending_start(&payload.game_id);
        }

        let timeout_ms =
            TorrentManager::normalize_timeout_ms(payload.timeout_ms, 60_000);

        let trackers = parse_magnet_trackers(&magnet);

        let files_payload =
            fetch_torrent_files_internal(magnet.clone(), info_hash.clone(), timeout_ms).await?;

        let raw_indices = payload
            .file_indices
            .ok_or_else(|| Error::from_reason("invalid_file_indices"))?;

        if raw_indices.is_empty() {
            return Err(Error::from_reason("empty_selection"));
        }

        let max_index = files_payload.files.len().saturating_sub(1) as u32;
        let mut sanitized = HashSet::new();

        for index in raw_indices {
            if index > max_index {
                return Err(Error::from_reason("invalid_file_indices"));
            }
            sanitized.insert(index as usize);
        }

        if sanitized.is_empty() {
            return Err(Error::from_reason("empty_selection"));
        }

        let mut only_files: Vec<usize> = sanitized.into_iter().collect();
        only_files.sort_unstable();

        let session = get_or_create_session().await?;
        let mut opts = AddTorrentOptions::default();
        opts.output_folder = Some(payload.save_path);
        opts.overwrite = true;
        opts.only_files = Some(only_files);

        let add_future = session.add_torrent(AddTorrent::from_url(magnet), Some(opts));
        let response = timeout(Duration::from_millis(timeout_ms as u64), add_future)
            .await
            .map_err(|_| Error::from_reason("metadata_timeout"))?
            .map_err(map_anyhow_error)?;

        let handle = match response {
            AddTorrentResponse::Added(_, handle) | AddTorrentResponse::AlreadyManaged(_, handle) => {
                handle
            }
            AddTorrentResponse::ListOnly(_) => {
                return Err(Error::from_reason("metadata_incomplete"));
            }
        };

        let mut manager = TORRENT_MANAGER.lock().await;
        manager.downloads.insert(payload.game_id.clone(), handle);
        manager.torrent_meta.insert(
            payload.game_id.clone(),
            TorrentMeta {
                info_hash,
                trackers,
            },
        );
        manager.downloading_game_id = Some(payload.game_id.clone());
        manager.seeding_game_ids.remove(&payload.game_id);
        drop(manager);

        ensure_seed_polling(payload.game_id).await;

        Ok(())
    })
}

#[napi]
pub fn torrent_pause(game_id: String) -> napi::Result<()> {
    TOKIO_RT.block_on(async {
        let handle = {
            let mut manager = TORRENT_MANAGER.lock().await;
            manager.abort_pending_start(&game_id);
            manager.stop_seed_polling(&game_id);

            if manager.downloading_game_id.as_deref() == Some(game_id.as_str()) {
                manager.downloading_game_id = None;
            }

            manager.downloads.get(&game_id).cloned()
        };

        if let Some(handle) = handle {
            let session = get_or_create_session().await?;
            let _ = session.pause(&handle).await;
        }

        Ok(())
    })
}

#[napi]
pub fn torrent_cancel(game_id: String) -> napi::Result<()> {
    TOKIO_RT.block_on(async {
        let handle = {
            let mut manager = TORRENT_MANAGER.lock().await;
            manager.abort_pending_start(&game_id);
            manager.stop_seed_polling(&game_id);
            manager.seeding_game_ids.remove(&game_id);
            manager.torrent_meta.remove(&game_id);

            if manager.downloading_game_id.as_deref() == Some(game_id.as_str()) {
                manager.downloading_game_id = None;
            }

            manager.downloads.remove(&game_id)
        };

        if let Some(handle) = handle {
            let session = get_or_create_session().await?;
            let _ = session.delete(handle.id().into(), false).await;
        }

        Ok(())
    })
}

#[napi]
pub fn torrent_resume_seeding(payload: ResumeSeedingPayload) -> napi::Result<()> {
    TOKIO_RT.block_on(async {
        if payload.save_path.trim().is_empty() {
            return Err(Error::from_reason("invalid_save_path"));
        }

        let (magnet, info_hash) = validate_magnet_uri(&payload.url)?;

        let handle = {
            let mut manager = TORRENT_MANAGER.lock().await;
            manager.abort_pending_start(&payload.game_id);
            manager.downloads.get(&payload.game_id).cloned()
        };

        let session = get_or_create_session().await?;

        if let Some(handle) = handle {
            let _ = session.unpause(&handle).await;

            let mut manager = TORRENT_MANAGER.lock().await;
            manager.seeding_game_ids.insert(payload.game_id.clone());
            if !manager.torrent_meta.contains_key(&payload.game_id) {
                manager.torrent_meta.insert(
                    payload.game_id.clone(),
                    TorrentMeta {
                        info_hash,
                        trackers: parse_magnet_trackers(&payload.url),
                    },
                );
            }
            drop(manager);

            ensure_seed_polling(payload.game_id).await;
            return Ok(());
        }

        let mut opts = AddTorrentOptions::default();
        opts.output_folder = Some(payload.save_path);
        opts.overwrite = true;

        let add_future = session.add_torrent(AddTorrent::from_url(magnet), Some(opts));
        let response = timeout(Duration::from_secs(30), add_future)
            .await
            .map_err(|_| Error::from_reason("metadata_timeout"))?
            .map_err(map_anyhow_error)?;

        let handle = match response {
            AddTorrentResponse::Added(_, handle) | AddTorrentResponse::AlreadyManaged(_, handle) => {
                handle
            }
            AddTorrentResponse::ListOnly(_) => {
                return Err(Error::from_reason("metadata_incomplete"));
            }
        };

        let mut manager = TORRENT_MANAGER.lock().await;
        manager.downloads.insert(payload.game_id.clone(), handle);
        manager.seeding_game_ids.insert(payload.game_id.clone());
        manager.torrent_meta.insert(
            payload.game_id.clone(),
            TorrentMeta {
                info_hash,
                trackers: parse_magnet_trackers(&payload.url),
            },
        );
        drop(manager);
        ensure_seed_polling(payload.game_id).await;
        Ok(())
    })
}

#[napi]
pub fn torrent_pause_seeding(game_id: String) -> napi::Result<()> {
    torrent_cancel(game_id)
}

#[napi]
pub fn torrent_set_download_limit(
    max_download_speed_bytes_per_second: Option<u32>,
) -> napi::Result<()> {
    TOKIO_RT.block_on(async {
        let limit = max_download_speed_bytes_per_second.filter(|value| *value > 0);

        let session = {
            let mut manager = TORRENT_MANAGER.lock().await;
            manager.current_download_limit = limit;
            manager.session.clone()
        };

        if let Some(session) = session {
            session
                .ratelimits
                .set_download_bps(limit.and_then(NonZeroU32::new));
        }

        Ok(())
    })
}
