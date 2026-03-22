use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use napi::bindgen_prelude::Error;
use napi_derive::napi;
use once_cell::sync::Lazy;
use regex::Regex;
use url::Url;

use crate::libtorrent_bridge::ffi as bridge;

const TORRENT_FILES_CACHE_TTL_SECONDS: u64 = 300;
const TORRENT_FILES_CACHE_MAX_ITEMS: usize = 128;
const TORRENT_MAX_FILES: usize = 100_000;
const HYDRA_TORRENT_STATUS_SEEDING: u32 = 5;

static MAGNET_HASH_HEX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[a-fA-F0-9]{40}$").expect("valid regex"));
static MAGNET_HASH_BASE32_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[a-zA-Z2-7]{32}$").expect("valid regex"));

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
    pub estimated_seeds: u32,
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
    pub estimated_seeds: u32,
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

fn sanitize_folder_component(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut sanitized = String::with_capacity(trimmed.len());

    for ch in trimmed.chars() {
        let mapped = match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ if ch.is_control() => '_',
            _ => ch,
        };
        sanitized.push(mapped);
    }

    let compact = sanitized.trim_matches(['.', ' ']);
    if compact.is_empty() {
        return None;
    }

    Some(compact.to_string())
}

fn build_reserved_output_folder(
    root_save_path: &str,
    torrent_name: Option<&str>,
    file_count: usize,
    info_hash: &str,
) -> String {
    if file_count <= 1 {
        return root_save_path.to_string();
    }

    let fallback_hash_len = info_hash.len().min(12);
    let fallback_name = format!("torrent-{}", &info_hash[..fallback_hash_len]);
    let folder_name = torrent_name
        .and_then(sanitize_folder_component)
        .unwrap_or(fallback_name);

    PathBuf::from(root_save_path)
        .join(folder_name)
        .to_string_lossy()
        .to_string()
}

fn resolve_torrent_output_folder(
    root_save_path: &str,
    magnet: &str,
    info_hash: &str,
    timeout_ms: u32,
) -> String {
    match fetch_torrent_files_internal(magnet.to_string(), info_hash.to_string(), timeout_ms) {
        Ok(files_payload) => build_reserved_output_folder(
            root_save_path,
            Some(&files_payload.name),
            files_payload.files.len(),
            info_hash,
        ),
        Err(_) => root_save_path.to_string(),
    }
}

fn ensure_reserved_output_folder_exists(
    root_save_path: &str,
    resolved_save_path: &str,
) -> napi::Result<()> {
    if resolved_save_path == root_save_path {
        return Ok(());
    }

    std::fs::create_dir_all(resolved_save_path).map_err(|err| Error::from_reason(err.to_string()))
}

struct TorrentManager {
    downloading_game_id: Option<String>,
    seeding_game_ids: HashSet<String>,
    current_download_limit: Option<u32>,
    torrent_files_cache: HashMap<String, CachedTorrentFiles>,
}

impl TorrentManager {
    fn new() -> Self {
        Self {
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
}

static TORRENT_MANAGER: Lazy<Mutex<TorrentManager>> =
    Lazy::new(|| Mutex::new(TorrentManager::new()));

fn map_bridge_error(error: String) -> napi::Result<()> {
    if error.is_empty() {
        Ok(())
    } else {
        Err(Error::from_reason(error))
    }
}

fn ensure_session() -> napi::Result<()> {
    let current_limit = {
        TORRENT_MANAGER
            .lock()
            .map_err(|_| Error::from_reason("internal_error"))?
            .current_download_limit
    };

    map_bridge_error(bridge::init_session(5881, 5892))?;

    if let Some(limit) = current_limit {
        map_bridge_error(bridge::set_download_limit(limit as i64))?;
    }

    Ok(())
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
    let mut trackers = Vec::new();

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

    for value in DEFAULT_TRACKERS {
        let tracker = value.to_string();
        if !trackers.contains(&tracker) {
            trackers.push(tracker);
        }
    }

    trackers
}

fn fetch_torrent_files_internal(
    magnet: String,
    info_hash: String,
    timeout_ms: u32,
) -> napi::Result<TorrentFilesPayload> {
    {
        let mut manager = TORRENT_MANAGER
            .lock()
            .map_err(|_| Error::from_reason("internal_error"))?;

        if let Some(cached) = manager.cache_get(&info_hash) {
            return Ok(cached);
        }
    }

    ensure_session()?;

    let trackers = parse_magnet_trackers(&magnet);
    let temp_save_path = std::env::temp_dir().to_string_lossy().to_string();

    let bridge_result = bridge::get_torrent_files(
        &magnet,
        &temp_save_path,
        &trackers,
        timeout_ms,
        TORRENT_MAX_FILES as u32,
    );

    if !bridge_result.ok {
        return Err(Error::from_reason(bridge_result.error));
    }

    let payload = TorrentFilesPayload {
        info_hash: info_hash.clone(),
        name: bridge_result.name,
        total_size: bridge_result.total_size,
        files: bridge_result
            .files
            .into_iter()
            .map(|file| TorrentFileEntry {
                index: file.index,
                path: file.path,
                length: file.length,
            })
            .collect(),
    };

    let mut manager = TORRENT_MANAGER
        .lock()
        .map_err(|_| Error::from_reason("internal_error"))?;
    manager.cache_set(info_hash, payload.clone());

    Ok(payload)
}

#[napi]
pub fn torrent_get_status() -> napi::Result<Option<TorrentStatusPayload>> {
    let game_id = {
        let manager = TORRENT_MANAGER
            .lock()
            .map_err(|_| Error::from_reason("internal_error"))?;
        manager.downloading_game_id.clone()
    };

    let Some(game_id) = game_id else {
        return Ok(None);
    };

    let status = bridge::get_torrent_status(&game_id);
    if !status.present {
        return Ok(None);
    }

    Ok(Some(TorrentStatusPayload {
        progress: status.progress,
        num_peers: status.num_peers,
        num_seeds: status.num_seeds,
        estimated_seeds: 0,
        download_speed: status.download_speed,
        upload_speed: status.upload_speed,
        bytes_downloaded: status.bytes_downloaded,
        file_size: status.file_size,
        folder_name: status.folder_name,
        status: status.status,
    }))
}

#[napi]
pub fn torrent_get_seed_status() -> napi::Result<Vec<TorrentSeedStatusPayload>> {
    let game_ids = {
        let manager = TORRENT_MANAGER
            .lock()
            .map_err(|_| Error::from_reason("internal_error"))?;

        manager
            .seeding_game_ids
            .iter()
            .cloned()
            .collect::<Vec<String>>()
    };

    let mut payload = Vec::new();

    for game_id in game_ids {
        let status = bridge::get_torrent_status(&game_id);
        if !status.present {
            continue;
        }

        if status.status != HYDRA_TORRENT_STATUS_SEEDING {
            continue;
        }

        payload.push(TorrentSeedStatusPayload {
            game_id,
            progress: status.progress,
            num_peers: status.num_peers,
            num_seeds: status.num_seeds,
            estimated_seeds: 0,
            download_speed: status.download_speed,
            upload_speed: status.upload_speed,
            bytes_downloaded: status.bytes_downloaded,
            file_size: status.file_size,
            folder_name: status.folder_name,
            status: status.status,
        });
    }

    Ok(payload)
}

#[napi]
pub async fn torrent_get_files(
    magnet: String,
    timeout_ms: Option<u32>,
) -> napi::Result<TorrentFilesPayload> {
    let (magnet, info_hash) = validate_magnet_uri(&magnet)?;
    let timeout_ms = TorrentManager::normalize_timeout_ms(timeout_ms, 30_000);
    fetch_torrent_files_internal(magnet, info_hash, timeout_ms)
}

#[napi]
pub async fn torrent_start(payload: StartTorrentPayload) -> napi::Result<()> {
    if payload.save_path.trim().is_empty() {
        return Err(Error::from_reason("invalid_save_path"));
    }

    let (magnet, info_hash) = validate_magnet_uri(&payload.url)?;
    let selective = payload.file_indices.is_some();
    let output_resolution_timeout_ms =
        TorrentManager::normalize_timeout_ms(payload.timeout_ms, 10_000);
    let timeout_ms = TorrentManager::normalize_timeout_ms(
        payload.timeout_ms,
        if selective { 60_000 } else { 30_000 },
    );

    let resolved_save_path = resolve_torrent_output_folder(
        &payload.save_path,
        &magnet,
        &info_hash,
        output_resolution_timeout_ms,
    );

    ensure_reserved_output_folder_exists(&payload.save_path, &resolved_save_path)?;

    ensure_session()?;

    let trackers = parse_magnet_trackers(&magnet);
    let file_indices = payload.file_indices.unwrap_or_default();

    map_bridge_error(bridge::start_torrent(
        &payload.game_id,
        &magnet,
        &resolved_save_path,
        &trackers,
        &file_indices,
        selective,
        false,
        timeout_ms,
    ))?;

    let mut manager = TORRENT_MANAGER
        .lock()
        .map_err(|_| Error::from_reason("internal_error"))?;
    manager.downloading_game_id = Some(payload.game_id.clone());
    manager.seeding_game_ids.remove(&payload.game_id);

    Ok(())
}

#[napi]
pub fn torrent_pause(game_id: String) -> napi::Result<()> {
    map_bridge_error(bridge::pause_torrent(&game_id))?;

    let mut manager = TORRENT_MANAGER
        .lock()
        .map_err(|_| Error::from_reason("internal_error"))?;
    if manager.downloading_game_id.as_deref() == Some(game_id.as_str()) {
        manager.downloading_game_id = None;
    }

    Ok(())
}

#[napi]
pub fn torrent_cancel(game_id: String) -> napi::Result<()> {
    map_bridge_error(bridge::cancel_torrent(&game_id))?;

    let mut manager = TORRENT_MANAGER
        .lock()
        .map_err(|_| Error::from_reason("internal_error"))?;
    manager.seeding_game_ids.remove(&game_id);

    if manager.downloading_game_id.as_deref() == Some(game_id.as_str()) {
        manager.downloading_game_id = None;
    }

    Ok(())
}

#[napi]
pub fn torrent_resume_seeding(payload: ResumeSeedingPayload) -> napi::Result<()> {
    if payload.save_path.trim().is_empty() {
        return Err(Error::from_reason("invalid_save_path"));
    }

    let (magnet, info_hash) = validate_magnet_uri(&payload.url)?;
    ensure_session()?;

    let resolved_save_path =
        resolve_torrent_output_folder(&payload.save_path, &magnet, &info_hash, 15_000);

    ensure_reserved_output_folder_exists(&payload.save_path, &resolved_save_path)?;

    let trackers = parse_magnet_trackers(&magnet);
    let no_file_indices = Vec::<u32>::new();

    map_bridge_error(bridge::start_torrent(
        &payload.game_id,
        &magnet,
        &resolved_save_path,
        &trackers,
        &no_file_indices,
        false,
        true,
        30_000,
    ))?;

    let mut manager = TORRENT_MANAGER
        .lock()
        .map_err(|_| Error::from_reason("internal_error"))?;
    manager.seeding_game_ids.insert(payload.game_id);

    Ok(())
}

#[napi]
pub fn torrent_pause_seeding(game_id: String) -> napi::Result<()> {
    torrent_cancel(game_id)
}

#[napi]
pub fn torrent_set_download_limit(
  max_download_speed_bytes_per_second: Option<u32>,
) -> napi::Result<()> {
    let limit = max_download_speed_bytes_per_second.filter(|value| *value > 0);

    {
        let mut manager = TORRENT_MANAGER
            .lock()
            .map_err(|_| Error::from_reason("internal_error"))?;
        manager.current_download_limit = limit;
    }

    ensure_session()?;

    map_bridge_error(bridge::set_download_limit(
        limit.map(|value| value as i64).unwrap_or(0),
    ))
}

#[napi]
pub fn torrent_backend() -> String {
    "libtorrent".to_string()
}
