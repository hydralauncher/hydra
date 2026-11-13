//! torbox.ts: send a magnet to TorBox, wait until its files are present and
//! request a link per file (one request every 250ms at most).

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde_json::Value;
use tokio_util::sync::CancellationToken;

use super::files::{self, TorBoxManifest, TorBoxTorrent};
use super::{agent, check, guarded, multipart, sleep};
use crate::errors::{DlError, DlResult, key};

const BASE: &str = "https://api.torbox.app/v1/api";
const READINESS_POLL_ATTEMPTS: u32 = 6;
const READINESS_POLL_DELAY_MS: u64 = 1000;
const REQUEST_TIMEOUT: Duration = Duration::from_millis(20_000);
const MY_LIST_PAGE_SIZE: usize = 1000;
const MY_LIST_MAX_PAGES: usize = 10;
const LINK_REQUEST_INTERVAL: Duration = Duration::from_millis(250);

pub struct TorBox {
    token: String,
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .expect("TorBox client")
    })
}

/// lastLinkRequestAt / linkRequestQueue: link requests wait their turn.
fn link_slot() -> &'static tokio::sync::Mutex<Option<Instant>> {
    static SLOT: OnceLock<tokio::sync::Mutex<Option<Instant>>> = OnceLock::new();
    SLOT.get_or_init(|| tokio::sync::Mutex::new(None))
}

/// Parses an axios-style response: an error status becomes Http with the body.
async fn read(response: reqwest::Response) -> DlResult<(u16, Value)> {
    let status = response.status().as_u16();
    let text = response.text().await?;
    let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    Ok((status, body))
}

impl TorBox {
    pub fn new(token: &str) -> TorBox {
        TorBox {
            token: token.to_string(),
        }
    }

    fn request(&self, method: reqwest::Method, url: &str) -> reqwest::RequestBuilder {
        http()
            .request(method, url)
            .bearer_auth(&self.token)
            .header("User-Agent", agent())
    }

    async fn get_json(
        &self,
        path_and_query: &str,
        signal: Option<&CancellationToken>,
    ) -> DlResult<Value> {
        guarded(signal, async {
            let (status, body) = read(
                self.request(reqwest::Method::GET, &format!("{BASE}{path_and_query}"))
                    .send()
                    .await?,
            )
            .await?;
            if status >= 400 {
                return Err(DlError::Http {
                    status,
                    body: Some(body),
                });
            }
            Ok(body)
        })
        .await
    }

    /// addMagnet (createtorrent), with `add_only_if_cached` for the file picker.
    async fn add_magnet(&self, magnet: &str, cached_only: bool) -> DlResult<Value> {
        let mut fields = vec![("magnet", magnet), ("allow_zip", "false")];
        if cached_only {
            fields.push(("add_only_if_cached", "true"));
        }
        let (content_type, body) = multipart(&fields);
        let (status, data) = read(
            self.request(
                reqwest::Method::POST,
                &format!("{BASE}/torrents/createtorrent"),
            )
            .header("Content-Type", content_type)
            .body(body)
            .send()
            .await?,
        )
        .await?;
        if data.get("success").and_then(Value::as_bool) != Some(true) || status >= 400 {
            let detail = data
                .get("detail")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let error = data
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let reason = format!("{error} {detail}").to_lowercase();
            let not_cached = reason.contains("uncached")
                || ["not cached", "not_cached", "not-cached", "notcached"]
                    .iter()
                    .any(|p| reason.contains(p));
            return Err(DlError::msg(if cached_only && not_cached {
                key::NOT_CACHED_ON_TORBOX.to_string()
            } else if !detail.is_empty() {
                detail.to_string()
            } else {
                key::TORRENT_FILES_UNAVAILABLE.to_string()
            }));
        }
        Ok(data.get("data").cloned().unwrap_or(Value::Null))
    }

    /// getTorrentInfo
    pub async fn torrent_info(&self, id: i64) -> DlResult<Option<TorBoxTorrent>> {
        let body = self
            .get_json(&format!("/torrents/mylist?id={id}&bypass_cache=true"), None)
            .await?;
        let data = body.get("data").cloned().unwrap_or(Value::Null);
        let pick = |v: Value| serde_json::from_value::<TorBoxTorrent>(v).ok();
        Ok(match data {
            Value::Array(items) => items
                .into_iter()
                .filter_map(pick)
                .find(|t| t.id.map(|x| x as i64) == Some(id)),
            Value::Null => None,
            other => pick(other).filter(|t| t.id.map(|x| x as i64) == Some(id)),
        })
    }

    /// requestLink: a direct link to one file of the torrent.
    pub async fn request_link(
        &self,
        id: i64,
        file_id: i64,
        signal: Option<&CancellationToken>,
    ) -> DlResult<String> {
        {
            let mut last = guarded(signal, async { Ok(link_slot().lock().await) }).await?;
            check(signal)?;
            if let Some(previous) = *last {
                let wait =
                    (previous + LINK_REQUEST_INTERVAL).saturating_duration_since(Instant::now());
                if !wait.is_zero() {
                    sleep(wait.as_millis() as u64, signal).await?;
                }
            }
            check(signal)?;
            *last = Some(Instant::now());
        }
        let query = super::form(&[
            ("token", &self.token),
            ("torrent_id", &id.to_string()),
            ("file_id", &file_id.to_string()),
            ("zip_link", "false"),
        ]);
        let body = self
            .get_json(&format!("/torrents/requestdl?{query}"), signal)
            .await?;
        let link = body
            .get("data")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty());
        match (body.get("success").and_then(Value::as_bool), link) {
            (Some(true), Some(link)) => Ok(link.to_string()),
            _ => {
                eprintln!(
                    "[TorBox] requestdl did not return a link for torrent {id}: {}",
                    body.get("detail")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                );
                Err(DlError::msg(key::TORBOX_LINK_UNAVAILABLE))
            }
        }
    }

    async fn user_torrents(&self) -> DlResult<Vec<TorBoxTorrent>> {
        let mut torrents = Vec::new();
        for page in 0..MY_LIST_MAX_PAGES {
            let body = self
                .get_json(
                    &format!(
                        "/torrents/mylist?bypass_cache=true&offset={}&limit={MY_LIST_PAGE_SIZE}",
                        page * MY_LIST_PAGE_SIZE
                    ),
                    None,
                )
                .await?;
            let entries: Vec<TorBoxTorrent> = body
                .get("data")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|v| serde_json::from_value(v.clone()).ok())
                        .collect()
                })
                .unwrap_or_default();
            let count = entries.len();
            torrents.extend(entries);
            if count < MY_LIST_PAGE_SIZE {
                break;
            }
        }
        Ok(torrents)
    }

    fn is_ready(torrent: &TorBoxTorrent) -> bool {
        torrent.download_finished == Some(true) && torrent.download_present == Some(true)
    }

    async fn wait_for_ready(&self, id: i64) -> DlResult<TorBoxTorrent> {
        for attempt in 1..=READINESS_POLL_ATTEMPTS {
            let torrent = self.torrent_info(id).await?;
            if let Some(torrent) = torrent.as_ref().filter(|t| Self::is_ready(t)) {
                return Ok(torrent.clone());
            }
            eprintln!(
                "[TorBox] Torrent {id} not downloadable yet (state={}, finished={:?}, present={:?}, attempt {attempt}/{READINESS_POLL_ATTEMPTS})",
                torrent
                    .as_ref()
                    .and_then(|t| t.download_state.clone())
                    .unwrap_or_else(|| "unknown".into()),
                torrent.as_ref().and_then(|t| t.download_finished),
                torrent.as_ref().and_then(|t| t.download_present),
            );
            if attempt < READINESS_POLL_ATTEMPTS {
                tokio::time::sleep(Duration::from_millis(READINESS_POLL_DELAY_MS)).await;
            }
        }
        Err(DlError::msg(key::TORBOX_TORRENT_NOT_READY))
    }

    async fn downloadable_torrent(
        &self,
        magnet: &str,
        cached_only: bool,
    ) -> DlResult<TorBoxTorrent> {
        let hash = files::info_hash(magnet).ok_or_else(|| DlError::msg(key::INVALID_MAGNET))?;
        let torrents = self.user_torrents().await?;
        let matching: Vec<&TorBoxTorrent> = torrents
            .iter()
            .filter(|t| t.hash.as_deref().map(str::to_lowercase).as_deref() == Some(hash.as_str()))
            .collect();
        let found = matching
            .iter()
            .find(|t| Self::is_ready(t))
            .or(matching.first())
            .copied();
        if let Some(torrent) = found {
            if Self::is_ready(torrent) {
                return Ok(torrent.clone());
            }
            return self.wait_for_ready(torrent.id.unwrap_or(-1.0) as i64).await;
        }
        let added = self.add_magnet(magnet, cached_only).await?;
        let id = added
            .get("torrent_id")
            .and_then(Value::as_f64)
            .unwrap_or(-1.0) as i64;
        let mut ready = self.wait_for_ready(id).await?;
        if ready.name.as_deref().is_none_or(str::is_empty) {
            ready.name = added
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string);
        }
        Ok(ready)
    }

    /// getDownloadFiles: the manifest of a ready torrent.
    pub async fn download_files(&self, uri: &str, cached_only: bool) -> DlResult<TorBoxManifest> {
        let torrent = self.downloadable_torrent(uri, cached_only).await?;
        files::build_torbox_manifest(&torrent, files::display_name(uri).as_deref())
    }
}
