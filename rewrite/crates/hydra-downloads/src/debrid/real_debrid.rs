//! real-debrid.ts and real-debrid-links.ts: unrestrict hoster links, and
//! send magnets to Real-Debrid, select their files and wait for the links.

use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tokio_util::sync::CancellationToken;

use super::files::{self, RdTorrentInfo};
use super::{check, form, guarded, read_json, sleep};
use crate::errors::{DlError, DlResult, key};

const BASE: &str = "https://api.real-debrid.com/rest/1.0";
const REQUEST_TIMEOUT: Duration = Duration::from_millis(15_000);
const TORRENT_LIST_PAGE_LIMIT: u32 = 5000;
const TORRENT_FILE_POLL_ATTEMPTS: u32 = 15;
const TORRENT_FILE_POLL_DELAY_MS: u64 = 1000;
const LINK_POLL_ATTEMPTS: u32 = 10;
const LINK_POLL_DELAY_MS: u64 = 1000;

/// RealDebridUnrestrictLink
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Unrestricted {
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub filesize: u64,
    #[serde(default)]
    pub download: String,
    #[serde(default)]
    pub chunks: Option<u32>,
}

/// A link resolved ahead of the transfer (reused while it is fresh).
#[derive(Clone, Debug)]
pub struct PreparedLink {
    pub url: String,
    pub resolved_at: Instant,
}

/// RealDebridDownloadEntry
#[derive(Clone, Debug)]
pub struct Entry {
    pub index: i64,
    pub path: String,
    pub size: u64,
    pub url: String,
    pub is_locked: bool,
    pub source_path: Option<String>,
    pub chunks: Option<u32>,
    pub is_archive: bool,
    pub resource_id: Option<String>,
    pub prepared_link: Option<PreparedLink>,
}

/// getDownloadEntriesWithTorrent's result.
#[derive(Clone, Debug)]
pub struct Resolved {
    pub torrent_id: Option<String>,
    pub entries: Option<Vec<Entry>>,
}

/// The API with one token.
pub struct RealDebrid {
    token: String,
}

fn http() -> &'static reqwest::Client {
    // httpsAgent: new https.Agent({ family: 4 })
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .local_address(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
            .timeout(REQUEST_TIMEOUT)
            .build()
            .expect("Real-Debrid client")
    })
}

/// torrentIdsByHash, cleared when the token changes (authorize).
fn ids_by_hash() -> &'static Mutex<(String, HashMap<String, String>)> {
    static CACHE: OnceLock<Mutex<(String, HashMap<String, String>)>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new((String::new(), HashMap::new())))
}

impl RealDebrid {
    pub fn new(token: &str) -> RealDebrid {
        let mut cache = ids_by_hash().lock().unwrap_or_else(|e| e.into_inner());
        if cache.0 != token {
            *cache = (token.to_string(), HashMap::new());
        }
        RealDebrid {
            token: token.to_string(),
        }
    }

    fn cached_id(&self, hash: &str) -> Option<String> {
        ids_by_hash()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .1
            .get(hash)
            .cloned()
    }

    fn remember_id(&self, hash: &str, id: &str) {
        ids_by_hash()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .1
            .insert(hash.to_string(), id.to_string());
    }

    fn forget_hash(&self, hash: &str) {
        ids_by_hash()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .1
            .remove(hash);
    }

    async fn get(
        &self,
        path: &str,
        signal: Option<&CancellationToken>,
    ) -> DlResult<serde_json::Value> {
        guarded(signal, async {
            let response = http()
                .get(format!("{BASE}{path}"))
                .bearer_auth(&self.token)
                .send()
                .await?;
            read_json(response).await
        })
        .await
    }

    async fn post(
        &self,
        path: &str,
        body: String,
        signal: Option<&CancellationToken>,
    ) -> DlResult<serde_json::Value> {
        guarded(signal, async {
            let response = http()
                .post(format!("{BASE}{path}"))
                .bearer_auth(&self.token)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(body)
                .send()
                .await?;
            let status = response.status().as_u16();
            // selectFiles answers 204 with no body.
            if status == 204 || status == 202 {
                return Ok(serde_json::Value::Null);
            }
            read_json(response).await
        })
        .await
    }

    /// addMagnet: the new torrent's id.
    pub async fn add_magnet(
        &self,
        magnet: &str,
        signal: Option<&CancellationToken>,
    ) -> DlResult<String> {
        let body = self
            .post("/torrents/addMagnet", form(&[("magnet", magnet)]), signal)
            .await?;
        super::as_text(body.get("id"))
            .ok_or_else(|| DlError::msg("Real-Debrid did not return a torrent id."))
    }

    pub async fn torrent_info(
        &self,
        id: &str,
        signal: Option<&CancellationToken>,
    ) -> DlResult<RdTorrentInfo> {
        let body = self.get(&format!("/torrents/info/{id}"), signal).await?;
        serde_json::from_value(body)
            .map_err(|_| DlError::msg("Real-Debrid returned an invalid torrent."))
    }

    async fn select_files(
        &self,
        id: &str,
        file_ids: Option<&[i64]>,
        signal: Option<&CancellationToken>,
    ) -> DlResult<()> {
        let files = match file_ids {
            None => "all".to_string(),
            Some(ids) => ids.iter().map(i64::to_string).collect::<Vec<_>>().join(","),
        };
        self.post(
            &format!("/torrents/selectFiles/{id}"),
            form(&[("files", &files)]),
            signal,
        )
        .await?;
        Ok(())
    }

    /// unrestrictLink
    pub async fn unrestrict_link(
        &self,
        link: &str,
        signal: Option<&CancellationToken>,
    ) -> DlResult<Unrestricted> {
        let body = self
            .post("/unrestrict/link", form(&[("link", link)]), signal)
            .await?;
        serde_json::from_value(body)
            .map_err(|_| DlError::msg("Real-Debrid returned an invalid link."))
    }

    /// unlockFileWithDetails: the direct link and its chunk count.
    pub async fn unlock_file(
        &self,
        link: &str,
        expected_path: &str,
        expected_size: u64,
        signal: Option<&CancellationToken>,
    ) -> DlResult<(String, Option<u32>)> {
        let file = self.unrestrict_link(link, signal).await?;
        files::assert_real_debrid_file_link(
            expected_path,
            expected_size,
            &file.filename,
            file.filesize,
        )?;
        Ok((file.download, file.chunks))
    }

    async fn user_torrents(
        &self,
        signal: Option<&CancellationToken>,
    ) -> DlResult<Vec<RdTorrentInfo>> {
        let body = self
            .get(
                &format!("/torrents?limit={TORRENT_LIST_PAGE_LIMIT}"),
                signal,
            )
            .await?;
        // An empty list answers 204 with no body.
        if body.is_null() {
            return Ok(Vec::new());
        }
        serde_json::from_value(body)
            .map_err(|_| DlError::msg("Real-Debrid returned an invalid torrent list."))
    }

    /// getTorrentId: the user's torrent for this magnet, or a new one.
    pub async fn torrent_id(
        &self,
        magnet: &str,
        signal: Option<&CancellationToken>,
        unavailable: Option<&HashSet<String>>,
    ) -> DlResult<String> {
        check(signal)?;
        let hash = files::info_hash(magnet)
            .ok_or_else(|| DlError::msg("The magnet link has no torrent hash."))?;
        if let Some(cached) = self.cached_id(&hash)
            && unavailable.is_none_or(|u| !u.contains(&cached))
        {
            return Ok(cached);
        }
        let mut matches: Vec<RdTorrentInfo> = self
            .user_torrents(signal)
            .await?
            .into_iter()
            .filter(|t| {
                t.hash.to_lowercase() == hash
                    && unavailable.is_none_or(|u| !u.contains(&t.id))
                    && !["error", "dead", "virus", "magnet_error"].contains(&t.status.as_str())
            })
            .collect();
        matches.sort_by(|a, b| {
            b.bytes
                .partial_cmp(&a.bytes)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let found = matches
            .iter()
            .find(|t| t.status == "downloaded")
            .or(matches.first())
            .map(|t| t.id.clone());
        if let Some(id) = found {
            self.remember_id(&hash, &id);
            return Ok(id);
        }
        let id = self.add_magnet(magnet, signal).await?;
        self.remember_id(&hash, &id);
        Ok(id)
    }

    /// pollTorrentFiles (with the attempt budget of assertTorrentFilePollRemaining).
    async fn poll_torrent_files(
        &self,
        uri: &str,
        mut id: String,
        allow_empty_selection: bool,
        signal: Option<&CancellationToken>,
    ) -> DlResult<RdTorrentInfo> {
        let mut unavailable = HashSet::new();
        for attempt in 0..TORRENT_FILE_POLL_ATTEMPTS {
            let info = match self.torrent_info(&id, signal).await {
                Ok(info) => info,
                Err(DlError::Http { status: 404, .. }) => {
                    if let Some(hash) = files::info_hash(uri) {
                        self.forget_hash(&hash);
                    }
                    unavailable.insert(id.clone());
                    if attempt >= TORRENT_FILE_POLL_ATTEMPTS - 1 {
                        break;
                    }
                    id = self.torrent_id(uri, signal, Some(&unavailable)).await?;
                    continue;
                }
                Err(error) => return Err(error),
            };
            check(signal)?;
            files::real_debrid_failed(&info)?;
            if !info.files.is_empty()
                || (allow_empty_selection && info.status == "waiting_files_selection")
            {
                return Ok(info);
            }
            if attempt >= TORRENT_FILE_POLL_ATTEMPTS - 1 {
                break;
            }
            sleep(TORRENT_FILE_POLL_DELAY_MS, signal).await?;
        }
        Err(DlError::msg(key::REAL_DEBRID_TORRENT_NOT_READY))
    }

    async fn torrent_with_files(
        &self,
        uri: &str,
        preferred_id: Option<&str>,
        allow_empty_selection: bool,
        signal: Option<&CancellationToken>,
    ) -> DlResult<RdTorrentInfo> {
        check(signal)?;
        let id = match preferred_id {
            Some(id) => id.to_string(),
            None => self.torrent_id(uri, signal, None).await?,
        };
        self.poll_torrent_files(uri, id, allow_empty_selection, signal)
            .await
    }

    /// getDownloadFiles: the torrent's files for the file picker.
    pub async fn download_files(
        &self,
        uri: &str,
        signal: Option<&CancellationToken>,
    ) -> DlResult<(String, Vec<files::DebridFile>)> {
        let info = self.torrent_with_files(uri, None, false, signal).await?;
        let list = files::real_debrid_files(&info)?
            .into_iter()
            .map(|f| files::DebridFile {
                index: f.index,
                path: f.path,
                size: f.size,
            })
            .collect();
        Ok((info.filename, list))
    }

    /// getTorrentOrPending
    async fn torrent_or_pending(
        &self,
        uri: &str,
        preferred_id: Option<&str>,
        allow_empty_selection: bool,
        signal: Option<&CancellationToken>,
    ) -> DlResult<(String, Option<RdTorrentInfo>)> {
        match self
            .torrent_with_files(uri, preferred_id, allow_empty_selection, signal)
            .await
        {
            Ok(info) => Ok((info.id.clone(), Some(info))),
            Err(e) if e.is(key::REAL_DEBRID_TORRENT_NOT_READY) => {
                Ok((self.torrent_id(uri, signal, None).await?, None))
            }
            Err(e) => Err(e),
        }
    }

    /// restartTorrentForSelection: a torrent whose files were selected
    /// differently is added again for this selection.
    async fn restart_for_selection(
        &self,
        uri: &str,
        info: RdTorrentInfo,
        selected: Option<&[i64]>,
        signal: Option<&CancellationToken>,
    ) -> DlResult<(String, Option<RdTorrentInfo>)> {
        let can_change =
            info.status != "waiting_files_selection" && info.files.iter().any(|f| f.selected != 0);
        if !can_change || files::has_real_debrid_selection(&info, selected) {
            return Ok((info.id.clone(), Some(info)));
        }
        let torrent = self.add_magnet(uri, signal).await?;
        if let Some(hash) = files::info_hash(uri) {
            self.remember_id(&hash, &torrent);
        }
        match self
            .torrent_with_files(uri, Some(&torrent), false, signal)
            .await
        {
            Ok(next) => Ok((next.id.clone(), Some(next))),
            Err(e) if e.is(key::REAL_DEBRID_TORRENT_NOT_READY) => Ok((torrent, None)),
            Err(e) => Err(e),
        }
    }

    /// waitForRealDebridLinks
    async fn wait_for_links(
        &self,
        id: &str,
        initial: Option<RdTorrentInfo>,
        signal: Option<&CancellationToken>,
    ) -> DlResult<Option<RdTorrentInfo>> {
        let mut initial = initial;
        for attempt in 0..LINK_POLL_ATTEMPTS {
            check(signal)?;
            let info = match initial.take() {
                Some(info) if attempt == 0 => info,
                _ => self.torrent_info(id, signal).await?,
            };
            check(signal)?;
            files::real_debrid_failed(&info)?;
            if info.status != "downloaded" {
                return Ok(None);
            }
            let selected = info.files.iter().filter(|f| f.selected != 0).count();
            if (selected > 0 && selected == info.links.len())
                || files::is_real_debrid_archive_candidate(&info, None)
            {
                return Ok(Some(info));
            }
            if attempt == LINK_POLL_ATTEMPTS - 1 {
                eprintln!(
                    "[Real-Debrid] links not ready (selected={selected}, links={})",
                    info.links.len()
                );
                return Err(DlError::msg(key::REAL_DEBRID_LINKS_NOT_READY));
            }
            sleep(LINK_POLL_DELAY_MS, signal).await?;
        }
        Ok(None)
    }

    /// getArchiveEntry: Real-Debrid serves several selected files as one archive.
    async fn archive_entry(
        &self,
        info: &RdTorrentInfo,
        selected: Option<&[i64]>,
        signal: Option<&CancellationToken>,
    ) -> DlResult<Entry> {
        let link = info.links[0].clone();
        let unlocked = self.unrestrict_link(&link, signal).await?;
        if !files::can_use_real_debrid_archive_link(info, &unlocked.filename, selected) {
            return Err(DlError::msg(
                "Real-Debrid returned an invalid torrent archive.",
            ));
        }
        let archive = RdTorrentInfo {
            files: vec![files::RdFile {
                id: 0,
                path: format!("/{}", unlocked.filename),
                bytes: unlocked.filesize,
                selected: 1,
            }],
            ..info.clone()
        };
        let file = files::real_debrid_files(&archive)?
            .into_iter()
            .next()
            .ok_or_else(|| DlError::msg("Real-Debrid returned an invalid torrent archive."))?;
        let mut ids: Vec<i64> = info
            .files
            .iter()
            .filter(|f| f.selected != 0)
            .map(|f| f.id)
            .collect();
        ids.sort_unstable();
        let selection = ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",");
        Ok(Entry {
            index: file.index,
            path: file.path,
            size: file.size,
            url: link,
            is_locked: true,
            source_path: Some(file.source_path),
            chunks: unlocked.chunks,
            is_archive: true,
            resource_id: Some(format!(
                "realDebrid:{}:archive:{selection}",
                info.hash.to_lowercase()
            )),
            prepared_link: Some(PreparedLink {
                url: unlocked.download,
                resolved_at: Instant::now(),
            }),
        })
    }

    /// getDownloadEntriesWithTorrent: the files to download, or no entries
    /// while Real-Debrid is still preparing them.
    pub async fn download_entries(
        &self,
        uri: &str,
        selected: Option<&[i64]>,
        preferred_id: Option<&str>,
        signal: Option<&CancellationToken>,
    ) -> DlResult<Resolved> {
        check(signal)?;
        if !uri.starts_with("magnet:") {
            let unlocked = self.unrestrict_link(uri, signal).await?;
            return Ok(Resolved {
                torrent_id: None,
                entries: Some(vec![Entry {
                    index: 0,
                    path: unlocked.filename,
                    size: unlocked.filesize,
                    url: unlocked.download,
                    is_locked: false,
                    source_path: None,
                    chunks: unlocked.chunks,
                    is_archive: false,
                    resource_id: None,
                    prepared_link: None,
                }]),
            });
        }
        let pending = |id: String| Resolved {
            torrent_id: Some(id),
            entries: None,
        };
        let (initial_id, initial) = self
            .torrent_or_pending(uri, preferred_id, selected.is_none(), signal)
            .await?;
        let Some(initial) = initial else {
            return Ok(pending(initial_id));
        };
        if initial.files.is_empty() {
            self.select_files(&initial.id, None, signal).await?;
            return Ok(pending(initial.id));
        }
        let requested = files::select_debrid_files(
            &files::real_debrid_files(&initial)?,
            |f| f.index,
            selected,
        )?;
        if requested.iter().all(|f| f.size == 0) {
            return Ok(Resolved {
                torrent_id: Some(initial.id.clone()),
                entries: Some(
                    requested
                        .into_iter()
                        .map(|f| Entry {
                            index: f.index,
                            path: f.path,
                            size: f.size,
                            url: "about:blank".into(),
                            is_locked: false,
                            source_path: Some(f.source_path),
                            chunks: None,
                            is_archive: false,
                            resource_id: None,
                            prepared_link: None,
                        })
                        .collect(),
                ),
            });
        }
        let (restarted_id, info) = self
            .restart_for_selection(uri, initial, selected, signal)
            .await?;
        let Some(info) = info else {
            return Ok(pending(restarted_id));
        };
        let local = files::real_debrid_files(&info)?;
        let requested = files::select_debrid_files(&local, |f| f.index, selected)?;
        let requested_ids: Vec<i64> = requested.iter().map(|f| f.index).collect();
        if info.status == "waiting_files_selection" {
            self.select_files(&info.id, selected.map(|_| requested_ids.as_slice()), signal)
                .await?;
        }
        let initial_ready = (info.status == "downloaded").then(|| info.clone());
        let Some(ready) = self.wait_for_links(&info.id, initial_ready, signal).await? else {
            return Ok(pending(info.id));
        };
        if !files::has_real_debrid_selection(&ready, Some(&requested_ids)) {
            return Ok(pending(info.id));
        }
        if files::is_real_debrid_archive_candidate(&ready, None) {
            let entry = self.archive_entry(&ready, selected, signal).await?;
            return Ok(Resolved {
                torrent_id: Some(info.id),
                entries: Some(vec![entry]),
            });
        }
        let normalized = files::real_debrid_files(&ready)?;
        let mut entries = Vec::new();
        for (index, file) in ready.files.iter().filter(|f| f.selected != 0).enumerate() {
            let Some(local) = normalized.iter().find(|e| e.index == file.id) else {
                continue;
            };
            entries.push(Entry {
                index: local.index,
                path: local.path.clone(),
                size: local.size,
                url: ready.links.get(index).cloned().unwrap_or_default(),
                is_locked: true,
                source_path: Some(local.source_path.clone()),
                chunks: None,
                is_archive: false,
                resource_id: None,
                prepared_link: None,
            });
        }
        Ok(Resolved {
            torrent_id: Some(info.id),
            entries: Some(files::select_debrid_files(&entries, |e| e.index, selected)?),
        })
    }

    /// getDownloadUrl: the first file's direct link.
    pub async fn download_url(
        &self,
        uri: &str,
        signal: Option<&CancellationToken>,
    ) -> DlResult<Option<String>> {
        let resolved = self.download_entries(uri, None, None, signal).await?;
        let Some(first) = resolved.entries.and_then(|e| e.into_iter().next()) else {
            return Ok(None);
        };
        if let Some(prepared) = first.prepared_link {
            return Ok(Some(prepared.url));
        }
        if !first.is_locked {
            return Ok(Some(first.url));
        }
        let expected = first.source_path.as_deref().unwrap_or(&first.path);
        let size = if first.is_archive { 0 } else { first.size };
        Ok(Some(
            self.unlock_file(&first.url, expected, size, signal)
                .await?
                .0,
        ))
    }
}
