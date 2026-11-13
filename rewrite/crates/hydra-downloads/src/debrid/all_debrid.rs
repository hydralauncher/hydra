//! all-debrid.ts: unlock hoster links (waiting for delayed ones) and read a
//! magnet's files once AllDebrid has it. Requests are throttled to 10 per
//! second and 500 per minute; 429 and 503 retry with a doubling delay.

use std::collections::VecDeque;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::files;
use super::{agent, as_i64, as_text, form};
use crate::errors::{DlError, DlResult};

const BASE: &str = "https://api.alldebrid.com/v4";
const RL_PER_SECOND: usize = 10;
const RL_PER_MINUTE: usize = 500;
const RL_RETRY_MAX: u32 = 5;
const RL_RETRY_BASE_MS: u64 = 2000;
const DELAYED_POLL_INTERVAL: Duration = Duration::from_millis(5000);
const DELAYED_MAX_ATTEMPTS: u32 = 120;

/// AllDebridDownloadEntry
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub url: String,
    pub filename: String,
    pub size: Option<u64>,
    pub is_locked: bool,
}

pub struct AllDebrid {
    token: String,
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .build()
            .expect("AllDebrid client")
    })
}

fn timestamps() -> &'static tokio::sync::Mutex<VecDeque<Instant>> {
    static TIMES: OnceLock<tokio::sync::Mutex<VecDeque<Instant>>> = OnceLock::new();
    TIMES.get_or_init(|| tokio::sync::Mutex::new(VecDeque::new()))
}

/// applyThrottle (the chain runs one request at a time).
async fn throttle() {
    let mut times = timestamps().lock().await;
    let now = Instant::now();
    times.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
    let second_ago = now - Duration::from_secs(1);
    let in_last_second: Vec<Instant> = times.iter().copied().filter(|t| *t >= second_ago).collect();
    if in_last_second.len() >= RL_PER_SECOND
        && let Some(oldest) = in_last_second.first()
    {
        let wait = (*oldest + Duration::from_millis(1050)).saturating_duration_since(now);
        tokio::time::sleep(wait).await;
    }
    if times.len() >= RL_PER_MINUTE
        && let Some(first) = times.front()
    {
        let wait =
            (*first + Duration::from_millis(60_050)).saturating_duration_since(Instant::now());
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
    }
    times.push_back(Instant::now());
}

/// normalizeMagnets / normalizeMagnetFiles: an array, one object, or a map.
fn normalize(value: Option<&Value>, single_key: &str) -> Vec<Value> {
    match value {
        Some(Value::Array(items)) => items.clone(),
        Some(Value::Object(map)) if map.contains_key("id") && map.contains_key(single_key) => {
            vec![Value::Object(map.clone())]
        }
        Some(Value::Object(map)) if map.contains_key("id") && single_key.is_empty() => {
            vec![Value::Object(map.clone())]
        }
        Some(Value::Object(map)) => map.values().cloned().collect(),
        _ => Vec::new(),
    }
}

/// extractFilenameFromLink
fn filename_from_link(link: &str) -> String {
    reqwest::Url::parse(link)
        .ok()
        .and_then(|u| {
            u.path_segments()?
                .rfind(|s| !s.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "file".into())
}

/// extractFileEntries: the file tree flattened to links with relative paths.
pub fn file_entries(nodes: &[Value], parent: &[String]) -> Vec<(String, String, Option<u64>)> {
    let mut entries = Vec::new();
    for node in nodes {
        let name = node
            .get("n")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty());
        if let Some(link) = node
            .get("l")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            let file_name = name
                .map(str::to_string)
                .unwrap_or_else(|| filename_from_link(link));
            let mut path = parent.to_vec();
            path.push(file_name);
            entries.push((
                link.to_string(),
                path.join("/"),
                node.get("s").and_then(Value::as_f64).map(|s| s as u64),
            ));
        }
        if let Some(children) = node
            .get("e")
            .and_then(Value::as_array)
            .filter(|e| !e.is_empty())
        {
            let mut next = parent.to_vec();
            if let Some(name) = name {
                next.push(name.to_string());
            }
            entries.extend(file_entries(children, &next));
        }
    }
    entries
}

impl AllDebrid {
    pub fn new(token: &str) -> AllDebrid {
        AllDebrid {
            token: token.to_string(),
        }
    }

    fn params(&self) -> String {
        form(&[("apikey", &self.token), ("agent", &agent())])
    }

    /// One request through the throttle, retried on 429/503.
    async fn send(&self, url: String, body: String) -> DlResult<Value> {
        let mut retry = 0;
        loop {
            throttle().await;
            let response = http()
                .post(&url)
                .bearer_auth(&self.token)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(body.clone())
                .send()
                .await?;
            let status = response.status().as_u16();
            let text = response.text().await?;
            let parsed: Option<Value> = serde_json::from_str(&text).ok();
            if status == 429 || status == 503 {
                if retry >= RL_RETRY_MAX {
                    eprintln!("[AllDebrid] Rate-limit retries exhausted ({RL_RETRY_MAX})");
                    return Err(DlError::Http {
                        status,
                        body: parsed,
                    });
                }
                let delay = RL_RETRY_BASE_MS * 2u64.pow(retry);
                retry += 1;
                eprintln!(
                    "[AllDebrid] {status} rate-limited, retry {retry}/{RL_RETRY_MAX} in {delay}ms"
                );
                tokio::time::sleep(Duration::from_millis(delay)).await;
                continue;
            }
            if status >= 400 {
                return Err(DlError::Http {
                    status,
                    body: parsed,
                });
            }
            let payload =
                parsed.ok_or_else(|| DlError::msg("AllDebrid returned an invalid response."))?;
            // ensureSuccess
            if payload.get("status").and_then(Value::as_str) == Some("error") {
                return Err(DlError::msg(
                    payload
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("AllDebrid API error"),
                ));
            }
            return Ok(payload);
        }
    }

    /// unlockLink, waiting for delayed links.
    async fn unlock_link(&self, link: &str) -> DlResult<(String, Option<String>, Option<u64>)> {
        let payload = self
            .send(
                format!("{BASE}/link/unlock?{}", self.params()),
                form(&[("link", link)]),
            )
            .await?;
        let data = payload.get("data").cloned().unwrap_or(Value::Null);
        let filename = data
            .get("filename")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let size = data
            .get("filesize")
            .and_then(Value::as_f64)
            .map(|s| s as u64);
        if let Some(delayed) = as_i64(data.get("delayed")).filter(|d| *d != 0) {
            return Ok((self.wait_for_delayed(delayed).await?, filename, size));
        }
        let link = data
            .get("link")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                DlError::msg(
                    "[AllDebrid] /link/unlock returned neither a download link nor a delayed ID",
                )
            })?;
        Ok((link.to_string(), filename, size))
    }

    async fn wait_for_delayed(&self, id: i64) -> DlResult<String> {
        for _ in 0..DELAYED_MAX_ATTEMPTS {
            tokio::time::sleep(DELAYED_POLL_INTERVAL).await;
            let payload = self
                .send(
                    format!("{BASE}/link/delayed?{}", self.params()),
                    form(&[("id", &id.to_string())]),
                )
                .await?;
            let data = payload.get("data").cloned().unwrap_or(Value::Null);
            let status = as_i64(data.get("status"));
            if status == Some(2)
                && let Some(link) = data
                    .get("link")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
            {
                return Ok(link.to_string());
            }
            if status == Some(3) {
                return Err(DlError::msg(
                    "[AllDebrid] Delayed link generation failed (status=3)",
                ));
            }
        }
        Err(DlError::msg(format!(
            "[AllDebrid] Delayed link timed out after {DELAYED_MAX_ATTEMPTS} attempts"
        )))
    }

    async fn magnet_status(&self, id: Option<i64>) -> DlResult<Vec<Value>> {
        let agent = agent();
        let mut pairs = vec![("agent", agent.as_str())];
        let id_text = id.map(|i| i.to_string());
        if let Some(id) = id_text.as_deref() {
            pairs.push(("id", id));
        }
        let payload = self
            .send(
                "https://api.alldebrid.com/v4.1/magnet/status".into(),
                form(&pairs),
            )
            .await?;
        Ok(normalize(
            payload.get("data").and_then(|d| d.get("magnets")),
            "hash",
        ))
    }

    async fn magnet_files(&self, id: i64) -> DlResult<Vec<(String, String, Option<u64>)>> {
        let body = form(&[("agent", &agent()), ("id[]", &id.to_string())]);
        let request = |endpoint: &'static str| {
            let body = body.clone();
            async move {
                let payload = self.send(endpoint.into(), body).await?;
                let magnets = normalize(payload.get("data").and_then(|d| d.get("magnets")), "");
                let Some(first) = magnets.first() else {
                    return Ok(Vec::new());
                };
                if let Some(error) = first.get("error") {
                    eprintln!(
                        "[AllDebrid] {endpoint} returned per-magnet error code={} message={}",
                        error
                            .get("code")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        error
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                    );
                    return Ok(Vec::new());
                }
                let nodes = first
                    .get("files")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                Ok::<_, DlError>(file_entries(&nodes, &[]))
            }
        };
        match request("https://api.alldebrid.com/v4.1/magnet/files").await {
            Ok(entries) => Ok(entries),
            Err(error) => {
                eprintln!(
                    "[AllDebrid] /v4.1/magnet/files failed, falling back to /v4/magnet/files: {error}"
                );
                request("https://api.alldebrid.com/v4/magnet/files").await
            }
        }
    }

    async fn add_magnet(&self, magnet: &str) -> DlResult<Vec<Value>> {
        let payload = self
            .send(
                format!("{BASE}/magnet/upload?{}", self.params()),
                form(&[("agent", &agent()), ("magnets[]", magnet)]),
            )
            .await?;
        Ok(normalize(
            payload.get("data").and_then(|d| d.get("magnets")),
            "hash",
        ))
    }

    async fn magnet_id(&self, magnet: &str) -> DlResult<Option<i64>> {
        let Some(hash) = files::loose_info_hash(magnet) else {
            eprintln!("[AllDebrid] Could not extract info hash for magnet");
            return Ok(None);
        };
        let existing = self.magnet_status(None).await?.into_iter().find(|m| {
            m.get("hash")
                .and_then(Value::as_str)
                .is_some_and(|h| h.to_lowercase() == hash)
        });
        if let Some(existing) = existing {
            return Ok(as_i64(existing.get("id")));
        }
        Ok(self
            .add_magnet(magnet)
            .await?
            .first()
            .and_then(|m| as_i64(m.get("id"))))
    }

    /// getDownloadEntries: `None` while the magnet isn't ready yet.
    pub async fn download_entries(&self, uri: &str) -> DlResult<Option<Vec<Entry>>> {
        if !uri.starts_with("magnet:") {
            let (link, filename, size) = self.unlock_link(uri).await?;
            let decoded = crate::filename::decode_uri_component(&link).unwrap_or(link);
            let filename = filename.unwrap_or_else(|| filename_from_link(&decoded));
            return Ok(Some(vec![Entry {
                url: decoded,
                filename,
                size,
                is_locked: false,
            }]));
        }
        let Some(id) = self.magnet_id(uri).await? else {
            eprintln!("[AllDebrid] Magnet id resolution failed");
            return Ok(None);
        };
        let status = self.magnet_status(Some(id)).await?;
        let first = status.first();
        let code = as_i64(first.and_then(|m| m.get("statusCode")));
        let label = as_text(first.and_then(|m| m.get("status"))).unwrap_or_default();
        if let Some(code) = code {
            if code >= 5 {
                eprintln!("[AllDebrid] Magnet id={id} is in error state: {label} (code={code})");
                return Ok(None);
            }
            if code != 4 {
                eprintln!(
                    "[AllDebrid] Magnet id={id} is not ready yet: {label} (code={code}). Torrent is still processing on AllDebrid servers."
                );
                return Ok(None);
            }
        }
        let links = self.magnet_files(id).await?;
        if links.is_empty() {
            eprintln!("[AllDebrid] No downloadable links for magnet id={id}");
            return Ok(None);
        }
        Ok(Some(
            links
                .into_iter()
                .map(|(url, filename, size)| Entry {
                    url,
                    filename,
                    size,
                    is_locked: true,
                })
                .collect(),
        ))
    }

    /// unlockDownloadLink
    pub async fn unlock_download_link(&self, link: &str) -> DlResult<String> {
        let (link, _, _) = self.unlock_link(link).await?;
        Ok(crate::filename::decode_uri_component(&link).unwrap_or(link))
    }

    /// getDownloadInfo: the first file's link and name.
    pub async fn download_info(&self, uri: &str) -> DlResult<Option<(String, String)>> {
        let Some(first) = self
            .download_entries(uri)
            .await?
            .and_then(|e| e.into_iter().next())
        else {
            return Ok(None);
        };
        let url = if first.is_locked {
            self.unlock_download_link(&first.url).await?
        } else {
            first.url
        };
        Ok(Some((url, first.filename)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn flattens_the_file_tree() {
        let nodes = json!([
            { "n": "Game", "e": [
                { "n": "setup.exe", "l": "https://a/1", "s": 10 },
                { "n": "data", "e": [{ "l": "https://a/x/part.bin", "s": 5 }] }
            ]},
            { "n": "readme.txt", "l": "https://a/2" }
        ]);
        let entries = file_entries(nodes.as_array().unwrap(), &[]);
        assert_eq!(
            entries,
            vec![
                ("https://a/1".into(), "Game/setup.exe".into(), Some(10)),
                (
                    "https://a/x/part.bin".into(),
                    "Game/data/part.bin".into(),
                    Some(5)
                ),
                ("https://a/2".into(), "readme.txt".into(), None),
            ]
        );
    }

    #[test]
    fn normalizes_magnet_payloads() {
        let one = json!({ "id": 1, "hash": "h" });
        assert_eq!(normalize(Some(&one), "hash").len(), 1);
        let map = json!({ "a": { "id": 1, "hash": "h" }, "b": { "id": 2, "hash": "i" } });
        assert_eq!(normalize(Some(&map), "hash").len(), 2);
        let list = json!([{ "id": 1 }]);
        assert_eq!(normalize(Some(&list), "hash").len(), 1);
        assert!(normalize(None, "hash").is_empty());
    }
}
