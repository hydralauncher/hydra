//! download-manager.ts getJsDownloadOptions and validateDownloadUrl: each
//! hoster's and debrid service's direct link, file name and HTTP options,
//! checked with a one-byte GET before the download is queued.

use std::path::{Component, Path};
use std::time::{Duration, Instant};

use hydra_core::repacks::{self, Downloader};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use super::Manager;
use crate::batch::{self, DownloadFile};
use crate::debrid::{
    self, all_debrid::AllDebrid, premiumize::Premiumize, real_debrid::RealDebrid, torbox::TorBox,
};
use crate::errors::{DlError, DlResult, key};
use crate::filename::{extract_download_filename, sanitize_filename};
use crate::http;
use crate::layout::Download;
use crate::{hosters, range_state};

/// PREPARED_JS_DOWNLOAD_TTL_MS
pub(crate) const PREPARED_TTL: Duration = Duration::from_millis(120_000);
const PREFLIGHT_MAX_ATTEMPTS: u32 = 3;
const PREFLIGHT_RETRY_DELAY_MS: u64 = 1000;
const PREFLIGHT_TIMEOUT: Duration = Duration::from_millis(15_000);
const DEFAULT_REAL_DEBRID_CONNECTIONS: usize = 4;
const REAL_DEBRID_MAX_CONNECTIONS: usize = 8;

/// JsDownloadOptions
#[derive(Clone, Debug, Default)]
pub(crate) struct JsOptions {
    pub url: String,
    pub save_path: String,
    pub filename: Option<String>,
    pub headers: Vec<(String, String)>,
    pub allow_parallel_ranges: Option<bool>,
    pub parallel_range_connections: Option<usize>,
    pub probe_unbounded_range: bool,
    pub total_size: Option<u64>,
}

impl JsOptions {
    fn new(url: String, save_path: &str, filename: Option<String>) -> JsOptions {
        JsOptions {
            url,
            save_path: save_path.to_string(),
            filename,
            ..JsOptions::default()
        }
    }

    /// The HTTP downloader's options (`{ ...options, resourceId }`).
    pub fn to_http(&self, resource_id: Option<String>) -> http::Options {
        let mut options = http::Options::new(&self.url, &self.save_path, self.filename.clone());
        options.headers = self.headers.clone();
        if let Some(allow) = self.allow_parallel_ranges {
            options.allow_parallel_ranges = allow;
        }
        options.parallel_range_connections = self.parallel_range_connections;
        options.probe_unbounded_range = self.probe_unbounded_range;
        options.resource_id = resource_id;
        options
    }
}

/// preparedJsDownloads
pub(crate) struct PreparedJs {
    pub uri: String,
    pub resolved_at: Instant,
    pub options: JsOptions,
}

/// preparedRealDebridDownloads
pub(crate) struct PreparedRd {
    pub uri: String,
    pub selection: String,
    pub resolved_at: Instant,
    pub resolved: debrid::real_debrid::Resolved,
}

pub(crate) fn text<'a>(download: &'a Download, key: &str) -> Option<&'a str> {
    download
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

pub(crate) fn downloader_of(download: &Download) -> Option<Downloader> {
    download
        .get("downloader")
        .and_then(Value::as_i64)
        .and_then(Downloader::from_i64)
}

pub(crate) fn file_indices(download: &Download) -> Option<Vec<i64>> {
    download
        .get("fileIndices")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_f64().map(|f| f as i64))
                .collect()
        })
}

pub(crate) fn parts_of(download: &Download) -> Option<Vec<String>> {
    download.get("parts").and_then(Value::as_array).map(|a| {
        a.iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect()
    })
}

/// realDebridConnections
pub(crate) fn real_debrid_connections(chunks: Option<u32>) -> usize {
    match chunks {
        Some(c) if c >= 1 => (c as usize).min(REAL_DEBRID_MAX_CONNECTIONS),
        _ => DEFAULT_REAL_DEBRID_CONNECTIONS,
    }
}

/// sanitizeRelativePath
pub(crate) fn sanitize_relative_path(value: &str) -> String {
    value
        .split(['/', '\\'])
        .filter(|s| !s.is_empty() && *s != "." && *s != "..")
        .map(sanitize_filename)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

/// assertSafeBatchPath: inside the folder, through no symbolic link.
pub(crate) fn assert_safe_batch_path(save_path: &str, filename: &str) -> DlResult<()> {
    let outside = || DlError::msg("The download file path is outside the selected folder.");
    let relative = Path::new(filename);
    let mut depth = 0usize;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => {
                depth += 1;
                parts.push(part.to_os_string());
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if depth == 0 {
                    return Err(outside());
                }
                depth -= 1;
                parts.pop();
            }
            Component::RootDir | Component::Prefix(_) => return Err(outside()),
        }
    }
    if parts.is_empty() {
        return Err(outside());
    }
    let mut current = std::path::PathBuf::from(save_path);
    for part in parts {
        current.push(part);
        match std::fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(DlError::msg(
                    "The download file path contains a symbolic link.",
                ));
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(DlError::msg(e.to_string())),
        }
    }
    Ok(())
}

/// resolveFilename
fn resolve_filename(resuming: Option<&str>, original: &str, download_url: &str) -> Option<String> {
    if let Some(resuming) = resuming {
        return Some(resuming.to_string());
    }
    extract_download_filename(original, Some(download_url))
        .or_else(|| extract_download_filename(download_url, None))
        .map(|n| sanitize_filename(&n))
}

fn log_resolved_url(url: &str) {
    let sanitized = reqwest::Url::parse(url)
        .map(|u| format!("{}{}", u.origin().ascii_serialization(), u.path()))
        .unwrap_or_else(|_| url.split(['?', '#']).next().unwrap_or(url).to_string());
    eprintln!("[DownloadManager] Resolved URL: {sanitized}");
}

pub(crate) fn log_url(url: &str) {
    log_resolved_url(url);
}

/// The token for a debrid downloader, or the "not authorized" error.
fn need(token: Option<String>, missing: &str) -> DlResult<String> {
    token.ok_or_else(|| DlError::msg(missing))
}

impl Manager {
    pub(crate) fn tokens(&self) -> debrid::Tokens {
        debrid::tokens(&self.db)
    }

    /// getJsDownloadOptions
    pub(crate) async fn js_options(
        &self,
        download: &mut Download,
        signal: Option<&CancellationToken>,
    ) -> DlResult<Option<JsOptions>> {
        let resuming = text(download, "folderName").map(str::to_string);
        let resuming = resuming.as_deref();
        let uri = text(download, "uri").unwrap_or_default().to_string();
        let path = text(download, "downloadPath")
            .unwrap_or_default()
            .to_string();
        let ctx = &self.hosters;
        let simple = |url: String| {
            let filename = resolve_filename(resuming, &uri, &url);
            Some(JsOptions::new(url, &path, filename))
        };
        let Some(downloader) = downloader_of(download) else {
            return Ok(None);
        };
        Ok(match downloader {
            Downloader::Gofile => {
                let (url, headers) = hosters::gofile::resolve(ctx, &uri).await?;
                let filename = resolve_filename(resuming, &uri, &url);
                let mut options = JsOptions::new(url, &path, filename);
                options.headers = headers;
                Some(options)
            }
            Downloader::PixelDrain => simple(hosters::pixeldrain::unlock(&uri).await?),
            Downloader::Datanodes => simple(hosters::datanodes::download_url(ctx, &uri).await?),
            Downloader::FuckingFast => {
                eprintln!("[DownloadManager] Processing FuckingFast download for URI: {uri}");
                simple(hosters::fuckingfast::direct_link(ctx, &uri).await?)
            }
            Downloader::Mediafire => simple(hosters::mediafire::download_url(&uri).await?),
            Downloader::VikingFile => {
                eprintln!("[DownloadManager] Processing VikingFile download for URI: {uri}");
                simple(hosters::vikingfile::download_url(ctx, &uri).await?)
            }
            Downloader::Rootz => simple(hosters::rootz::download_url(&uri).await?),
            Downloader::FileKeeper => {
                hosters::assert_multipart_enabled(ctx).await?;
                simple(hosters::filekeeper::download_url(&uri).await?)
            }
            Downloader::ArchiveOrg => {
                let (identifier, file) = repacks::parse_archive_org_file_uri(&uri)
                    .ok_or_else(|| DlError::msg(key::ARCHIVE_ORG_INVALID_FILE_URL))?;
                let encoded = file
                    .split('/')
                    .map(encode_component)
                    .collect::<Vec<_>>()
                    .join("/");
                let url = format!(
                    "https://archive.org/download/{}/{encoded}",
                    encode_component(&identifier)
                );
                let name = file.rsplit('/').next().unwrap_or(&file).to_string();
                Some(JsOptions::new(
                    url,
                    &path,
                    Some(
                        resuming
                            .map(str::to_string)
                            .unwrap_or_else(|| sanitize_filename(&name)),
                    ),
                ))
            }
            Downloader::RealDebrid => {
                Some(self.real_debrid_options(download, resuming, signal).await?)
            }
            Downloader::Premiumize => {
                let token = need(
                    self.tokens().premiumize,
                    key::PREMIUMIZE_ACCOUNT_NOT_AUTHORIZED,
                )?;
                let url = Premiumize::new(&token)
                    .download_url(&uri)
                    .await?
                    .ok_or_else(|| DlError::msg(key::NOT_CACHED_ON_PREMIUMIZE))?;
                simple(url)
            }
            Downloader::AllDebrid => {
                let token = need(
                    self.tokens().all_debrid,
                    key::ALLDEBRID_ACCOUNT_NOT_AUTHORIZED,
                )?;
                let (url, filename) = AllDebrid::new(&token)
                    .download_info(&uri)
                    .await?
                    .ok_or_else(|| DlError::msg(key::NOT_CACHED_ON_ALLDEBRID))?;
                let filename = match resuming {
                    Some(resuming) => Some(sanitize_relative_path(resuming)),
                    None if !filename.is_empty() => Some(sanitize_relative_path(&filename)),
                    None => resolve_filename(None, &uri, &url),
                };
                Some(JsOptions::new(url, &path, filename))
            }
            Downloader::TorBox => Some(self.torbox_options(download).await?),
            Downloader::Hydra => return Err(DlError::msg(key::NOT_CACHED_ON_HYDRA)),
            Downloader::Torrent | Downloader::Epic => None,
        })
    }

    /// getRealDebridDownloadOptions: the first file's link.
    async fn real_debrid_options(
        &self,
        download: &mut Download,
        resuming: Option<&str>,
        signal: Option<&CancellationToken>,
    ) -> DlResult<JsOptions> {
        let token = need(
            self.tokens().real_debrid,
            key::REAL_DEBRID_ACCOUNT_NOT_AUTHORIZED,
        )?;
        let client = RealDebrid::new(&token);
        let uri = text(download, "uri").unwrap_or_default().to_string();
        let path = text(download, "downloadPath")
            .unwrap_or_default()
            .to_string();
        let indices = file_indices(download);
        let preferred = text(download, "realDebridTorrentId").map(str::to_string);
        let resolved = client
            .download_entries(&uri, indices.as_deref(), preferred.as_deref(), signal)
            .await?;
        if let Some(id) = resolved.torrent_id.as_ref() {
            download.insert("realDebridTorrentId".into(), json!(id));
        }
        let entries = resolved.entries.unwrap_or_default();
        let first = entries.first();
        let url = match first {
            Some(first) => match first.prepared_link.as_ref() {
                Some(prepared) => Some(prepared.url.clone()),
                None if first.is_locked => {
                    let expected = first.source_path.as_deref().unwrap_or(&first.path);
                    let size = if first.is_archive { 0 } else { first.size };
                    Some(
                        client
                            .unlock_file(&first.url, expected, size, signal)
                            .await?
                            .0,
                    )
                }
                None => Some(first.url.clone()),
            },
            None => None,
        };
        let url = url
            .filter(|u| !u.is_empty())
            .ok_or_else(|| DlError::msg(key::NOT_CACHED_ON_REAL_DEBRID))?;
        let filename = resolve_filename(resuming, &uri, &url);
        let mut options = JsOptions::new(url.clone(), &path, filename);
        options.allow_parallel_ranges = Some(!debrid::files::is_zip_download_url(
            &url,
            first.map(|f| f.path.as_str()),
        ));
        options.parallel_range_connections =
            Some(real_debrid_connections(first.and_then(|f| f.chunks)));
        options.probe_unbounded_range = true;
        options.total_size = Some(entries.iter().map(|e| e.size).sum());
        Ok(options)
    }

    /// readLocalFileProgress
    pub(crate) fn read_local_file_progress(
        &self,
        download_path: &str,
        files: &[(i64, String, u64)],
    ) -> DlResult<Vec<DownloadFile>> {
        files
            .iter()
            .map(|(index, path, size)| {
                assert_safe_batch_path(download_path, path)?;
                let local = Path::new(download_path).join(path);
                let bytes = range_state::downloaded_bytes(&local).map_err(DlError::msg)?;
                Ok(DownloadFile {
                    index: *index,
                    path: path.clone(),
                    size: *size,
                    bytes_downloaded: bytes,
                    completed: local.exists() && bytes == *size,
                })
            })
            .collect()
    }

    /// getDebridOutputPath: a single ZIP needs no wrapper folder (existing
    /// partials keep their path).
    pub(crate) fn debrid_output_path(
        &self,
        download: &Download,
        index: i64,
        path: &str,
        file_count: usize,
    ) -> DlResult<String> {
        if file_count != 1 || !path.to_lowercase().ends_with(".zip") {
            return Ok(path.to_string());
        }
        let filename = path.rsplit(['/', '\\']).next().unwrap_or(path).to_string();
        let previous = batch::files_of(download)
            .into_iter()
            .find(|f| f.index == index)
            .map(|f| f.path);
        let existing = previous.unwrap_or_else(|| path.to_string());
        let download_path = text(download, "downloadPath").unwrap_or_default();
        assert_safe_batch_path(download_path, &existing)?;
        let existing_name = existing.rsplit(['/', '\\']).next().unwrap_or(&existing);
        if existing_name == filename
            && range_state::downloaded_bytes(&Path::new(download_path).join(&existing)).unwrap_or(0)
                > 0
        {
            return Ok(existing);
        }
        Ok(filename)
    }

    /// prepareTorBoxFiles: the manifest, the selected files at their local
    /// paths, and `download.files` from what's on disk.
    pub(crate) async fn prepare_torbox_files(
        &self,
        download: &mut Download,
    ) -> DlResult<(
        debrid::files::TorBoxManifest,
        Vec<debrid::files::TorBoxDownloadFile>,
    )> {
        let token = need(self.tokens().torbox, key::TORBOX_ACCOUNT_NOT_AUTHORIZED)?;
        let uri = text(download, "uri").unwrap_or_default().to_string();
        let manifest = TorBox::new(&token).download_files(&uri, false).await?;
        let indices = file_indices(download);
        let chosen = debrid::files::select_torbox_files(&manifest, indices.as_deref())?;
        let count = chosen.len();
        let mut selected = Vec::with_capacity(count);
        for file in chosen {
            let path = self.debrid_output_path(download, file.id, &file.path, count)?;
            selected.push(debrid::files::TorBoxDownloadFile { path, ..file });
        }
        let download_path = text(download, "downloadPath")
            .unwrap_or_default()
            .to_string();
        let files = self.read_local_file_progress(
            &download_path,
            &selected
                .iter()
                .map(|f| (f.id, f.path.clone(), f.size))
                .collect::<Vec<_>>(),
        )?;
        download.insert("files".into(), batch::files_json(&files));
        Ok((manifest, selected))
    }

    /// getTorBoxDownloadOptions
    async fn torbox_options(&self, download: &mut Download) -> DlResult<JsOptions> {
        let (manifest, selected) = self.prepare_torbox_files(download).await?;
        let first = selected
            .first()
            .ok_or_else(|| DlError::msg("TorBox did not provide downloadable files."))?;
        let url = if first.size == 0 {
            "about:blank".to_string()
        } else {
            let token = need(self.tokens().torbox, key::TORBOX_ACCOUNT_NOT_AUTHORIZED)?;
            TorBox::new(&token)
                .request_link(manifest.torrent_id, first.id, None)
                .await?
        };
        let path = text(download, "downloadPath")
            .unwrap_or_default()
            .to_string();
        let mut options = JsOptions::new(url, &path, Some(first.path.clone()));
        options.total_size = Some(selected.iter().map(|f| f.size).sum());
        Ok(options)
    }

    /// validateDownloadUrl: resolve the link now (keeping it for the start)
    /// and check it answers with a file, not a web page.
    pub(crate) async fn validate_js_download(
        &self,
        download: &mut Download,
        signal: Option<&CancellationToken>,
    ) -> DlResult<()> {
        debrid::check(signal)?;
        let Some(downloader) = downloader_of(download) else {
            return Ok(());
        };
        if matches!(downloader, Downloader::Torrent | Downloader::Epic) {
            return Ok(());
        }
        let id = crate::layout::id(download);
        self.prepared_js().remove(&id);
        let options = self
            .js_options(download, signal)
            .await?
            .ok_or_else(|| DlError::msg("Failed to validate download URL"))?;
        if let Some(total) = options.total_size.filter(|t| *t > 0) {
            download.insert("fileSize".into(), json!(total));
            download.insert("selectedFilesSize".into(), json!(total));
        }
        debrid::check(signal)?;
        let first_empty = downloader == Downloader::TorBox
            && batch::files_of(download)
                .first()
                .is_some_and(|f| f.size == 0);
        if !first_empty {
            debrid::guarded(signal, preflight(&options.url, &options.headers)).await?;
        }
        debrid::check(signal)?;
        let mut prepared = self.prepared_js();
        prepared.retain(|_, p| p.resolved_at.elapsed() <= PREPARED_TTL);
        prepared.insert(
            id,
            PreparedJs {
                uri: text(download, "uri").unwrap_or_default().to_string(),
                resolved_at: Instant::now(),
                options,
            },
        );
        Ok(())
    }

    /// takePreparedJsDownload
    pub(crate) fn take_prepared(&self, download: &Download, id: &str) -> Option<JsOptions> {
        let prepared = self.prepared_js().remove(id)?;
        if Some(prepared.uri.as_str()) != text(download, "uri")
            || prepared.resolved_at.elapsed() > PREPARED_TTL
        {
            return None;
        }
        Some(prepared.options)
    }

    pub(crate) fn prepared_js(
        &self,
    ) -> std::sync::MutexGuard<'_, std::collections::HashMap<String, PreparedJs>> {
        self.prepared.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(crate) fn prepared_rd(
        &self,
    ) -> std::sync::MutexGuard<'_, std::collections::HashMap<String, PreparedRd>> {
        self.prepared_real_debrid
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    /// prepareRealDebridDownload: whether Real-Debrid has the files ready
    /// (kept for the start that follows).
    pub(crate) async fn prepare_real_debrid_download(
        &self,
        download: &mut Download,
        signal: Option<&CancellationToken>,
    ) -> DlResult<bool> {
        let token = need(
            self.tokens().real_debrid,
            key::REAL_DEBRID_ACCOUNT_NOT_AUTHORIZED,
        )?;
        let id = crate::layout::id(download);
        let uri = text(download, "uri").unwrap_or_default().to_string();
        let indices = file_indices(download);
        let preferred = text(download, "realDebridTorrentId").map(str::to_string);
        let resolved = RealDebrid::new(&token)
            .download_entries(&uri, indices.as_deref(), preferred.as_deref(), signal)
            .await?;
        debrid::check(signal)?;
        if let Some(torrent) = resolved.torrent_id.clone().or(preferred) {
            download.insert("realDebridTorrentId".into(), json!(torrent));
        }
        if resolved.entries.as_ref().is_none_or(Vec::is_empty) {
            return Ok(false);
        }
        self.prepared_rd().insert(
            id,
            PreparedRd {
                uri,
                selection: serde_json::to_string(&indices).unwrap_or_default(),
                resolved_at: Instant::now(),
                resolved,
            },
        );
        Ok(true)
    }
}

/// encodeURIComponent
pub(crate) fn encode_component(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn preflight_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(PREFLIGHT_TIMEOUT)
            .build()
            .expect("preflight client")
    })
}

/// validateJsDownloadResponse: a one-byte GET (three attempts on 408/429/5xx).
pub(crate) async fn preflight(url: &str, headers: &[(String, String)]) -> DlResult<()> {
    let has = |name: &str| headers.iter().any(|(k, _)| k.eq_ignore_ascii_case(name));
    for attempt in 1..=PREFLIGHT_MAX_ATTEMPTS {
        let mut request = preflight_client().get(url);
        for (name, value) in headers {
            request = request.header(name, value);
        }
        if !has("user-agent") {
            request = request.header("User-Agent", http::DEFAULT_DOWNLOAD_USER_AGENT);
        }
        if !has("accept-encoding") {
            request = request.header("Accept-Encoding", "identity");
        }
        if !has("range") {
            request = request.header("Range", "bytes=0-0");
        }
        let response = match request.send().await {
            Ok(r) => r,
            Err(e) if e.is_timeout() => {
                return Err(DlError::msg("Download URL validation timed out"));
            }
            Err(e) => {
                eprintln!("[DownloadManager] Preflight request failed: {e}");
                return Err(e.into());
            }
        };
        let status = response.status().as_u16();
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("unknown")
                .to_string()
        };
        let content_type = header("content-type");
        eprintln!(
            "[DownloadManager] Preflight response status={status} content-type={content_type} content-length={}",
            header("content-length")
        );
        drop(response);
        if status == 416 {
            eprintln!(
                "[DownloadManager] Preflight range was rejected but the link resolved; allowing the download to start"
            );
            return Ok(());
        }
        if [408, 429, 500, 502, 503, 504].contains(&status) {
            if attempt < PREFLIGHT_MAX_ATTEMPTS {
                eprintln!(
                    "[DownloadManager] Preflight got transient HTTP {status}; retrying ({attempt}/{PREFLIGHT_MAX_ATTEMPTS})"
                );
                tokio::time::sleep(Duration::from_millis(
                    PREFLIGHT_RETRY_DELAY_MS * attempt as u64,
                ))
                .await;
                continue;
            }
            eprintln!(
                "[DownloadManager] Preflight still HTTP {status} after {PREFLIGHT_MAX_ATTEMPTS} attempts; allowing the download to start and retry"
            );
            return Ok(());
        }
        if status >= 400 {
            return Err(DlError::msg(format!(
                "The download link is not available (HTTP {status})."
            )));
        }
        if content_type.contains("text/html") || content_type.contains("application/xhtml") {
            return Err(DlError::msg(key::DOWNLOAD_LINK_RETURNED_WEB_PAGE));
        }
        return Ok(());
    }
    Ok(())
}

/// resolvePartFilename: links without a name in the URL (PixelDrain's)
/// name the file in Content-Disposition.
pub(crate) async fn resolve_part_filename(options: &JsOptions) -> Option<String> {
    if let Some(filename) = options.filename.clone() {
        return Some(filename);
    }
    let mut request = preflight_client().get(&options.url);
    for (name, value) in &options.headers {
        request = request.header(name, value);
    }
    let response = request.header("Range", "bytes=0-0").send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let disposition = response
        .headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    drop(response);
    crate::filename::content_disposition_filename(disposition.as_deref())
}

/// TorrentFilesResponse (getDebridFiles).
#[derive(Clone, Debug, PartialEq)]
pub struct TorrentFiles {
    pub name: String,
    pub total_size: u64,
    pub archive_only: bool,
    pub files: Vec<debrid::files::DebridFile>,
}

impl Manager {
    /// getDebridFiles: a magnet's files on TorBox (cached torrents only) or
    /// Real-Debrid, for the file picker. `Err` is the error key or message.
    pub fn debrid_files(
        &self,
        magnet: &str,
        downloader: Downloader,
    ) -> Result<TorrentFiles, String> {
        if !magnet.starts_with("magnet:") {
            return Err(key::INVALID_MAGNET.into());
        }
        let tokens = self.tokens();
        let result = self.runtime.block_on(async {
            match downloader {
                Downloader::TorBox => {
                    let token = need(tokens.torbox, key::TORBOX_ACCOUNT_NOT_AUTHORIZED)?;
                    let manifest = TorBox::new(&token).download_files(magnet, true).await?;
                    Ok(TorrentFiles {
                        name: manifest.name,
                        total_size: manifest.total_size,
                        archive_only: manifest.archive_only,
                        files: manifest
                            .files
                            .into_iter()
                            .map(|f| debrid::files::DebridFile {
                                index: f.id,
                                path: f.path,
                                size: f.size,
                            })
                            .collect(),
                    })
                }
                Downloader::RealDebrid => {
                    let token = need(tokens.real_debrid, key::REAL_DEBRID_ACCOUNT_NOT_AUTHORIZED)?;
                    let (name, files) =
                        RealDebrid::new(&token).download_files(magnet, None).await?;
                    Ok(TorrentFiles {
                        name,
                        total_size: files.iter().map(|f| f.size).sum(),
                        archive_only: false,
                        files,
                    })
                }
                _ => Err(DlError::msg(key::TORRENT_FILES_UNAVAILABLE)),
            }
        });
        result.map_err(|error| {
            eprintln!("Failed to get debrid files: {error}");
            match error {
                DlError::Message(message) => message,
                other => crate::errors::describe(&other, downloader),
            }
        })
    }

    /// Resolves `uri` with `downloader` like the URL check before a download
    /// (only the one-byte preflight is fetched): the direct link without its
    /// query, and the file name. For manual checks of hosters and debrid
    /// services.
    pub fn probe_link(
        &self,
        downloader: Downloader,
        uri: &str,
        download_path: &str,
    ) -> Result<(String, Option<String>), String> {
        let mut download: Download = json!({
            "shop": "probe",
            "objectId": uri,
            "downloader": downloader as i64,
            "uri": uri,
            "downloadPath": download_path,
            "folderName": null,
        })
        .as_object()
        .cloned()
        .unwrap_or_default();
        self.runtime
            .block_on(self.validate_js_download(&mut download, None))
            .map_err(|e| crate::errors::describe(&e, downloader))?;
        let id = crate::layout::id(&download);
        let prepared = self
            .prepared_js()
            .remove(&id)
            .ok_or_else(|| "nothing was prepared".to_string())?;
        let shown = reqwest::Url::parse(&prepared.options.url)
            .map(|u| format!("{}{}", u.origin().ascii_serialization(), u.path()))
            .unwrap_or(prepared.options.url.clone());
        Ok((shown, prepared.options.filename))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths() {
        assert_eq!(sanitize_relative_path("a/../b\\c:d/./e"), "a/b/c_d/e");
        assert_eq!(sanitize_relative_path("/x//y/"), "x/y");
    }

    #[test]
    fn safe_paths() {
        let dir = std::env::temp_dir();
        let dir = dir.to_string_lossy();
        assert!(assert_safe_batch_path(&dir, "Game/a.bin").is_ok());
        assert!(assert_safe_batch_path(&dir, "../a.bin").is_err());
        assert!(assert_safe_batch_path(&dir, "a/../../b").is_err());
        assert!(assert_safe_batch_path(&dir, "").is_err());
        assert!(assert_safe_batch_path(&dir, if cfg!(windows) { "C:\\x" } else { "/x" }).is_err());
    }

    #[test]
    fn connections_and_names() {
        assert_eq!(real_debrid_connections(None), 4);
        assert_eq!(real_debrid_connections(Some(16)), 8);
        assert_eq!(real_debrid_connections(Some(2)), 2);
        assert_eq!(
            resolve_filename(
                None,
                "https://fuckingfast.co/x#Game.part1.rar",
                "https://fuckingfast.co/dl/abc"
            )
            .as_deref(),
            Some("Game.part1.rar")
        );
        assert_eq!(
            resolve_filename(Some("Kept.zip"), "https://a/b.zip", "https://a/c.zip").as_deref(),
            Some("Kept.zip")
        );
        assert_eq!(encode_component("a b/c"), "a%20b%2Fc");
    }
}
