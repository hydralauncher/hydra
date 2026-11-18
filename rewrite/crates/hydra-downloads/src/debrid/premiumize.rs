//! premiumize.ts: direct links from Premiumize's cache, transfers for links
//! it hasn't cached (waiting for them), and ZIPs of multi-file content.

use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;

use super::files;
use crate::errors::{DlError, DlResult, key};

const BASE: &str = "https://www.premiumize.me/api";
const TRANSFER_POLL_INTERVAL: Duration = Duration::from_millis(5000);
/// 30 minutes
const TRANSFER_MAX_ATTEMPTS: u32 = 360;

pub struct Premiumize {
    token: String,
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .build()
            .expect("Premiumize client")
    })
}

/// PremiumizeTransfer
#[derive(Clone, Debug, Default)]
struct Transfer {
    id: String,
    status: String,
    message: Option<String>,
    src: Option<String>,
    folder_id: Option<String>,
    file_id: Option<String>,
}

fn transfer_of(value: &Value) -> Transfer {
    let text = |k: &str| super::as_text(value.get(k)).filter(|s| !s.is_empty());
    Transfer {
        id: text("id").unwrap_or_default(),
        status: text("status").unwrap_or_default(),
        message: text("message"),
        src: text("src"),
        folder_id: text("folder_id"),
        file_id: text("file_id"),
    }
}

fn failed(status: &str) -> bool {
    matches!(status, "error" | "banned" | "timeout")
}

/// extractDisplayName: the magnet's `dn`.
fn display_name(uri: &str) -> Option<String> {
    let lower = uri.to_lowercase();
    let start = ["?dn=", "&dn="]
        .iter()
        .filter_map(|p| lower.find(p).map(|i| i + p.len()))
        .min()?;
    let raw: String = uri[start..].chars().take_while(|c| *c != '&').collect();
    if raw.is_empty() {
        return None;
    }
    Some(
        crate::filename::decode_uri_component(&raw)
            .unwrap_or_else(|| raw.clone())
            .replace('+', " "),
    )
}

impl Premiumize {
    pub fn new(token: &str) -> Premiumize {
        Premiumize {
            token: token.to_string(),
        }
    }

    fn params(&self, extra: &[(&str, &str)]) -> String {
        let mut pairs = vec![("apikey", self.token.as_str())];
        pairs.extend_from_slice(extra);
        super::form(&pairs)
    }

    async fn call(&self, method: reqwest::Method, path: &str, params: String) -> DlResult<Value> {
        let request = if method == reqwest::Method::GET {
            http().get(format!("{BASE}{path}?{params}"))
        } else {
            http()
                .post(format!("{BASE}{path}"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(params)
        };
        super::read_json(request.send().await?).await
    }

    /// ensureSuccess
    fn ensure(payload: &Value) -> DlResult<()> {
        if payload.get("status").and_then(Value::as_str) != Some("success") {
            return Err(DlError::msg(
                payload
                    .get("message")
                    .or_else(|| payload.get("error"))
                    .and_then(Value::as_str)
                    .unwrap_or("Premiumize API error"),
            ));
        }
        Ok(())
    }

    fn reason(payload: &Value) -> String {
        payload
            .get("message")
            .or_else(|| payload.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string()
    }

    /// directDownload: `None` when Premiumize can't serve it right away.
    async fn direct_download(&self, uri: &str) -> Option<Value> {
        match self
            .call(
                reqwest::Method::POST,
                "/transfer/directdl",
                self.params(&[("src", uri)]),
            )
            .await
        {
            Ok(payload) if payload.get("status").and_then(Value::as_str) == Some("success") => {
                Some(payload)
            }
            Ok(payload) => {
                eprintln!(
                    "[Premiumize] /transfer/directdl failed: {}",
                    Self::reason(&payload)
                );
                None
            }
            Err(error) => {
                eprintln!("[Premiumize] /transfer/directdl error: {error}");
                None
            }
        }
    }

    async fn create_transfer(&self, src: &str) -> Option<String> {
        match self
            .call(
                reqwest::Method::POST,
                "/transfer/create",
                self.params(&[("src", src)]),
            )
            .await
        {
            Ok(payload) if payload.get("status").and_then(Value::as_str) == Some("success") => {
                super::as_text(payload.get("id")).filter(|s| !s.is_empty())
            }
            Ok(payload) => {
                eprintln!(
                    "[Premiumize] /transfer/create failed: {}",
                    Self::reason(&payload)
                );
                None
            }
            Err(error) => {
                eprintln!("[Premiumize] /transfer/create error: {error}");
                None
            }
        }
    }

    async fn list_transfers(&self) -> DlResult<Vec<Transfer>> {
        let payload = self
            .call(reqwest::Method::GET, "/transfer/list", self.params(&[]))
            .await?;
        Self::ensure(&payload)?;
        Ok(payload
            .get("transfers")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(transfer_of).collect())
            .unwrap_or_default())
    }

    async fn list_folder(&self) -> DlResult<Vec<Value>> {
        let payload = self
            .call(reqwest::Method::GET, "/folder/list", self.params(&[]))
            .await?;
        Self::ensure(&payload)?;
        Ok(payload
            .get("content")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default())
    }

    async fn generate_zip(&self, file_ids: &[&str], folder_ids: &[&str]) -> DlResult<String> {
        let mut pairs: Vec<(&str, &str)> = Vec::new();
        for id in file_ids {
            pairs.push(("files[]", id));
        }
        for id in folder_ids {
            pairs.push(("folders[]", id));
        }
        let payload = self
            .call(reqwest::Method::POST, "/zip/generate", self.params(&pairs))
            .await?;
        Self::ensure(&payload)?;
        payload
            .get("location")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .ok_or_else(|| DlError::msg("[Premiumize] /zip/generate did not return a location"))
    }

    async fn wait_for_transfer(&self, id: &str) -> DlResult<Transfer> {
        for _ in 0..TRANSFER_MAX_ATTEMPTS {
            let transfers = self.list_transfers().await?;
            let Some(transfer) = transfers.into_iter().find(|t| t.id == id) else {
                return Ok(Transfer {
                    id: id.to_string(),
                    status: "finished".into(),
                    ..Transfer::default()
                });
            };
            let status = transfer.status.to_lowercase();
            if status == "finished" || status == "seeding" {
                return Ok(transfer);
            }
            if failed(&status) {
                return Err(DlError::msg(format!(
                    "[Premiumize] Transfer failed: {}",
                    transfer.message.unwrap_or(transfer.status)
                )));
            }
            tokio::time::sleep(TRANSFER_POLL_INTERVAL).await;
        }
        Err(DlError::msg(format!(
            "[Premiumize] Transfer {id} timed out after {TRANSFER_MAX_ATTEMPTS} attempts"
        )))
    }

    /// extractSingleLink
    fn single_link(direct: Option<&Value>) -> Option<String> {
        let content = direct?.get("content")?.as_array()?;
        if content.len() != 1 {
            return None;
        }
        let link = content[0].get("link")?.as_str().filter(|s| !s.is_empty())?;
        Some(crate::filename::decode_uri_component(link).unwrap_or_else(|| link.to_string()))
    }

    fn content_len(direct: Option<&Value>) -> usize {
        direct
            .and_then(|d| d.get("content"))
            .and_then(Value::as_array)
            .map_or(0, Vec::len)
    }

    fn matches(uri: &str, hash: Option<&str>, transfer: &Transfer) -> bool {
        transfer.src.as_deref() == Some(uri)
            || hash.is_some_and(|h| {
                transfer
                    .src
                    .as_deref()
                    .is_some_and(|s| s.to_lowercase().contains(h))
            })
    }

    fn magnet_hash(uri: &str) -> Option<String> {
        uri.starts_with("magnet:")
            .then(|| files::loose_info_hash(uri))
            .flatten()
    }

    /// getDownloadUrl
    pub async fn download_url(&self, uri: &str) -> DlResult<Option<String>> {
        let direct = self.direct_download(uri).await;
        if let Some(link) = Self::single_link(direct.as_ref()) {
            return Ok(Some(link));
        }
        if Self::content_len(direct.as_ref()) > 1 {
            let Some(transfer) = self.ensure_transfer_completed(uri).await else {
                return Ok(None);
            };
            return Ok(self.zip_transfer(&transfer).await);
        }
        if uri.starts_with("magnet:") {
            if self.start_transfer_in_background(uri).await {
                return Err(DlError::msg(key::PREMIUMIZE_TRANSFER_STARTED));
            }
            eprintln!("[Premiumize] Magnet could not be resolved via direct download");
            return Ok(None);
        }
        if uri.starts_with("http") {
            return Ok(self.resolve_via_transfer(uri).await);
        }
        eprintln!("[Premiumize] Could not resolve download URL");
        Ok(None)
    }

    async fn resolve_via_transfer(&self, uri: &str) -> Option<String> {
        let transfer = self.ensure_transfer_completed(uri).await;
        let retry = self.direct_download(uri).await;
        if let Some(link) = Self::single_link(retry.as_ref()) {
            return Some(link);
        }
        if let Some(transfer) = transfer {
            return self.zip_transfer(&transfer).await;
        }
        self.resolve_from_root_folder(uri).await
    }

    async fn ensure_transfer_completed(&self, uri: &str) -> Option<Transfer> {
        if let Some(id) = self.create_transfer(uri).await {
            match self.wait_for_transfer(&id).await {
                Ok(transfer) => return Some(transfer),
                Err(error) => {
                    eprintln!("[Premiumize] waitForTransfer failed for id={id}: {error}")
                }
            }
        }
        self.find_existing_transfer(uri).await
    }

    async fn find_existing_transfer(&self, uri: &str) -> Option<Transfer> {
        let hash = Self::magnet_hash(uri);
        let transfers = match self.list_transfers().await {
            Ok(t) => t,
            Err(error) => {
                eprintln!("[Premiumize] findExistingTransfer failed: {error}");
                return None;
            }
        };
        let found = transfers
            .into_iter()
            .find(|t| Self::matches(uri, hash.as_deref(), t))?;
        let status = found.status.to_lowercase();
        if status == "finished" || status == "seeding" {
            return Some(found);
        }
        if failed(&status) {
            eprintln!(
                "[Premiumize] Existing transfer is in error state: {}",
                found.message.unwrap_or(found.status)
            );
            return None;
        }
        match self.wait_for_transfer(&found.id).await {
            Ok(t) => Some(t),
            Err(error) => {
                eprintln!("[Premiumize] findExistingTransfer failed: {error}");
                None
            }
        }
    }

    async fn has_runnable_transfer(&self, uri: &str) -> bool {
        let hash = Self::magnet_hash(uri);
        match self.list_transfers().await {
            Ok(transfers) => transfers
                .iter()
                .find(|t| Self::matches(uri, hash.as_deref(), t))
                .is_some_and(|t| !failed(&t.status.to_lowercase())),
            Err(error) => {
                eprintln!("[Premiumize] hasRunnableTransfer failed: {error}");
                false
            }
        }
    }

    async fn start_transfer_in_background(&self, uri: &str) -> bool {
        if let Some(id) = self.create_transfer(uri).await {
            eprintln!(
                "[Premiumize] Transfer started in background (id={id}). User should retry download later."
            );
            return true;
        }
        if self.has_runnable_transfer(uri).await {
            eprintln!("[Premiumize] Existing transfer found. User should retry download later.");
            return true;
        }
        false
    }

    async fn resolve_from_root_folder(&self, uri: &str) -> Option<String> {
        Self::magnet_hash(uri)?;
        let items = match self.list_folder().await {
            Ok(items) => items,
            Err(error) => {
                eprintln!("[Premiumize] resolveFromRootFolder failed: {error}");
                return None;
            }
        };
        let name = display_name(uri)?.to_lowercase();
        let named = |item: &&Value, kind: &str| {
            item.get("type").and_then(Value::as_str) == Some(kind)
                && item
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|n| n.to_lowercase().contains(&name))
        };
        if let Some(folder) = items.iter().find(|i| named(i, "folder"))
            && let Some(id) = super::as_text(folder.get("id"))
        {
            return match self.generate_zip(&[], &[&id]).await {
                Ok(link) => Some(link),
                Err(error) => {
                    eprintln!("[Premiumize] resolveFromRootFolder failed: {error}");
                    None
                }
            };
        }
        if let Some(link) = items.iter().filter(|i| named(i, "file")).find_map(|i| {
            i.get("link")
                .and_then(Value::as_str)
                .filter(|l| !l.is_empty())
        }) {
            return Some(
                crate::filename::decode_uri_component(link).unwrap_or_else(|| link.into()),
            );
        }
        eprintln!("[Premiumize] Could not find content in root folder");
        None
    }

    async fn zip_transfer(&self, transfer: &Transfer) -> Option<String> {
        let result = if let Some(folder) = transfer.folder_id.as_deref() {
            self.generate_zip(&[], &[folder]).await
        } else if let Some(file) = transfer.file_id.as_deref() {
            self.generate_zip(&[file], &[]).await
        } else {
            eprintln!(
                "[Premiumize] Transfer {} has no folder_id or file_id",
                transfer.id
            );
            return None;
        };
        match result {
            Ok(link) => Some(link),
            Err(error) => {
                eprintln!("[Premiumize] Zip generation failed: {error}");
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn display_names() {
        assert_eq!(
            display_name("magnet:?xt=urn:btih:abc&dn=My+Game%20Deluxe&tr=x").as_deref(),
            Some("My Game Deluxe")
        );
        assert_eq!(display_name("magnet:?xt=urn:btih:abc"), None);
    }

    #[test]
    fn single_links() {
        let one =
            json!({ "content": [{ "link": "https://p/a%20b.zip", "path": "a b.zip", "size": 1 }] });
        assert_eq!(
            Premiumize::single_link(Some(&one)).as_deref(),
            Some("https://p/a b.zip")
        );
        let two = json!({ "content": [{ "link": "a" }, { "link": "b" }] });
        assert_eq!(Premiumize::single_link(Some(&two)), None);
        assert_eq!(Premiumize::content_len(Some(&two)), 2);
    }
}
