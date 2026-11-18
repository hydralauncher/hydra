//! fuckingfast.ts. FuckingFast pages sit behind a Cloudflare check that only
//! a browser passes: a hidden browser page (the app's webview, see
//! [`Browser`]) resolves each link; the file itself downloads without it.
//! With the multi-part hoster feature off, the link is read from the page
//! HTML like Hydra did before.

use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, Instant};

use serde_json::Value;
use tokio::sync::oneshot;

use super::{Context, HOSTER_USER_AGENT};
use crate::errors::{DlError, DlResult};

const DOMAINS: [&str; 2] = ["fuckingfast.co", "fuckingfast.net"];
const LEGACY_DOMAIN: &str = "fuckingfast.co";
const PAGE_TIMEOUT: Duration = Duration::from_millis(45_000);
const PAGE_POLL_INTERVAL: Duration = Duration::from_millis(500);
/// WINDOW_IDLE_CLOSE_MS
pub const WINDOW_IDLE_CLOSE: Duration = Duration::from_millis(60_000);
/// The partition the hidden page keeps its cookies in.
pub const PARTITION: &str = "persist:hydra-fuckingfast";

/// The hidden browser page (a BrowserWindow with `show: false` in Electron).
/// Calls arrive one at a time.
pub trait Browser: Send + Sync {
    /// Opens the page if needed (cancelling an idle close) and navigates.
    fn load(&self, url: String) -> oneshot::Receiver<Result<(), String>>;
    /// Runs `script` in the page; the result as JSON text.
    fn eval(&self, script: String) -> oneshot::Receiver<Result<String, String>>;
    /// Destroys the page.
    fn close(&self);
    /// Closes the page after `after` unless it is used again.
    fn close_when_idle(&self, after: Duration);
}

fn browser_slot() -> &'static RwLock<Option<Arc<dyn Browser>>> {
    static SLOT: OnceLock<RwLock<Option<Arc<dyn Browser>>>> = OnceLock::new();
    SLOT.get_or_init(|| RwLock::new(None))
}

/// The app installs its webview here at startup.
pub fn set_browser(browser: Arc<dyn Browser>) {
    *browser_slot().write().unwrap_or_else(|e| e.into_inner()) = Some(browser);
}

fn browser() -> Option<Arc<dyn Browser>> {
    browser_slot()
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

/// One hidden page serves every link, so requests run one at a time.
fn queue() -> &'static tokio::sync::Mutex<()> {
    static QUEUE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    QUEUE.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// isSupportedHost
pub fn is_supported_host(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    let host = parsed.host_str().unwrap_or_default();
    parsed.scheme() == "https"
        && DOMAINS
            .iter()
            .any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

/// getGoPath: the URL the download button posts to.
pub fn go_path(url: &str) -> DlResult<String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| DlError::msg("Invalid FuckingFast URL"))?;
    let id = parsed
        .path_segments()
        .and_then(|mut s| s.find(|p| !p.is_empty()))
        .ok_or_else(|| DlError::msg("Invalid FuckingFast URL"))?;
    Ok(format!("/f/{}/go", utf8_percent_encode_component(id)))
}

/// encodeURIComponent
fn utf8_percent_encode_component(value: &str) -> String {
    value
        .bytes()
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

/// readPageState: matching the button's file ID keeps a slow navigation
/// from reading the previous page.
pub fn read_page_state_script(go_path: &str) -> String {
    let quoted = serde_json::to_string(go_path).unwrap_or_default();
    format!(
        r#"(() => {{
  if (document.querySelector('[hx-post="' + {quoted} + '"]')) return "ready";
  const text = document.body ? document.body.innerText : "";
  if (text.includes("File Not Found Or Deleted")) return "not-found";
  if (/rate limit/i.test(text)) return "rate-limited";
  return "pending";
}})()"#
    )
}

/// requestDownloadLink: the download button posts here; the response names
/// the file link in HX-Redirect. The webview can't await a promise, so the
/// answer lands in a global the next call reads.
pub fn request_download_link_script(go_path: &str) -> String {
    let quoted = serde_json::to_string(go_path).unwrap_or_default();
    format!(
        r#"(() => {{
  window.__hydraFuckingFastLink = null;
  fetch({quoted}, {{
    method: "POST",
    headers: {{ "HX-Request": "true", "HX-Current-URL": location.href }},
  }}).then(
    (response) => {{ window.__hydraFuckingFastLink = {{ status: response.status, redirect: response.headers.get("HX-Redirect") }}; }},
    () => {{ window.__hydraFuckingFastLink = {{ status: 0, redirect: null }}; }}
  );
  return true;
}})()"#
    )
}

pub const READ_DOWNLOAD_LINK_SCRIPT: &str = "window.__hydraFuckingFastLink ?? null";

/// Awaits `receiver` until `deadline`, else `fallback`.
async fn until<T>(receiver: oneshot::Receiver<T>, deadline: Instant, fallback: T) -> T {
    match tokio::time::timeout(deadline.saturating_duration_since(Instant::now()), receiver).await {
        Ok(Ok(value)) => value,
        _ => fallback,
    }
}

fn parse_state(json: &str) -> &'static str {
    match serde_json::from_str::<Value>(json)
        .ok()
        .as_ref()
        .and_then(Value::as_str)
    {
        Some("ready") => "ready",
        Some("not-found") => "not-found",
        Some("rate-limited") => "rate-limited",
        _ => "pending",
    }
}

/// waitForPage
async fn wait_for_page(browser: &dyn Browser, go: &str, deadline: Instant) -> &'static str {
    let script = read_page_state_script(go);
    while Instant::now() < deadline {
        let state = until(
            browser.eval(script.clone()),
            deadline,
            Err("timeout".into()),
        )
        .await
        .map(|json| parse_state(&json))
        .unwrap_or("pending");
        if state != "pending" {
            return state;
        }
        tokio::time::sleep(PAGE_POLL_INTERVAL).await;
    }
    "pending"
}

const RATE_LIMITED: &str = "Rate limit exceeded. Please wait a few minutes and try again.";

/// resolveDirectLink
async fn resolve_direct_link(browser: &dyn Browser, url: &str) -> DlResult<String> {
    let go = go_path(url)?;
    let deadline = Instant::now() + PAGE_TIMEOUT;
    eprintln!("[FuckingFast] Starting download link extraction for: {url}");
    let page = url.split('#').next().unwrap_or(url).to_string();
    let _ = until(browser.load(page), deadline, Ok(())).await;
    match wait_for_page(browser, &go, deadline).await {
        "not-found" => return Err(DlError::msg("File not found or deleted")),
        "rate-limited" => return Err(DlError::msg(RATE_LIMITED)),
        "pending" => {
            return Err(DlError::msg("The FuckingFast page did not finish loading."));
        }
        _ => {}
    }
    let _ = until(
        browser.eval(request_download_link_script(&go)),
        deadline,
        Err("timeout".into()),
    )
    .await;
    let mut answer: Option<Value> = None;
    while Instant::now() < deadline {
        let json = until(
            browser.eval(READ_DOWNLOAD_LINK_SCRIPT.into()),
            deadline,
            Err("timeout".into()),
        )
        .await
        .unwrap_or_default();
        if let Ok(value) = serde_json::from_str::<Value>(&json)
            && value.is_object()
        {
            answer = Some(value);
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let answer = answer
        .ok_or_else(|| DlError::msg("FuckingFast did not return a download link in time."))?;
    let status = answer.get("status").and_then(Value::as_u64).unwrap_or(0);
    if status == 429 {
        return Err(DlError::msg(RATE_LIMITED));
    }
    match answer.get("redirect").and_then(Value::as_str) {
        Some(redirect) if is_supported_host(redirect) => {
            eprintln!("[FuckingFast] Successfully extracted direct link");
            Ok(redirect.to_string())
        }
        _ => Err(DlError::msg(format!(
            "Could not extract download link from page (HTTP {status})"
        ))),
    }
}

/// LEGACY_DIRECT_LINK_REGEX
pub fn legacy_link(html: &str) -> Option<String> {
    let start = html.find("window.open(\"https://fuckingfast.co/dl/")? + "window.open(\"".len();
    let end = html[start..].find('"')?;
    html[start + end..]
        .starts_with("\")")
        .then(|| html[start..start + end].to_string())
}

/// getLegacyDirectLink
async fn legacy_direct_link(url: &str) -> DlResult<String> {
    if !url.to_lowercase().contains(LEGACY_DOMAIN) {
        return Err(DlError::msg(format!(
            "Unsupported domain. Supported domains: {LEGACY_DOMAIN}"
        )));
    }
    eprintln!("[FuckingFast] Starting download link extraction for: {url}");
    let response = super::client()
        .get(url)
        .header("User-Agent", HOSTER_USER_AGENT)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(DlError::from)?;
    // handleHosterError
    let status = response.status().as_u16();
    match status {
        404 => return Err(DlError::msg("File not found")),
        429 => return Err(DlError::msg("Rate limit exceeded. Please try again later.")),
        403 => {
            return Err(DlError::msg(
                "Access denied. File may be private or deleted.",
            ));
        }
        s if s >= 400 => return Err(DlError::msg(format!("Network error: {s}"))),
        _ => {}
    }
    let html = response.text().await?;
    if html.to_lowercase().contains("rate limit") {
        eprintln!("[FuckingFast] Rate limit detected");
        return Err(DlError::msg(RATE_LIMITED));
    }
    if html.contains("File Not Found Or Deleted") {
        eprintln!("[FuckingFast] File not found or deleted");
        return Err(DlError::msg("File not found or deleted"));
    }
    let link = legacy_link(&html).ok_or_else(|| {
        eprintln!("[FuckingFast] Could not extract download link");
        DlError::msg("Could not extract download link from page")
    })?;
    eprintln!("[FuckingFast] Successfully extracted direct link");
    Ok(link)
}

/// getDirectLink
pub async fn direct_link(ctx: &Context, url: &str) -> DlResult<String> {
    if !super::multipart_enabled(ctx).await {
        return legacy_direct_link(url).await;
    }
    if !is_supported_host(url) {
        return Err(DlError::msg(format!(
            "Unsupported domain. Supported domains: {}",
            DOMAINS.join(", ")
        )));
    }
    let browser =
        browser().ok_or_else(|| DlError::msg("The FuckingFast page did not finish loading."))?;
    let _turn = queue().lock().await;
    let result = resolve_direct_link(browser.as_ref(), url).await;
    match &result {
        // A failed page may hold a stale challenge; start fresh next time.
        Err(error) => {
            eprintln!("[FuckingFast] Error: {error}");
            browser.close();
        }
        Ok(_) => browser.close_when_idle(WINDOW_IDLE_CLOSE),
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn hosts_and_paths() {
        assert!(is_supported_host(
            "https://fuckingfast.co/abc#Game.part1.rar"
        ));
        assert!(is_supported_host("https://dl.fuckingfast.net/abc"));
        assert!(!is_supported_host("http://fuckingfast.co/abc"));
        assert!(!is_supported_host("https://fuckingfast.co.evil.com/abc"));
        assert_eq!(
            go_path("https://fuckingfast.co/abc123#Game.rar").unwrap(),
            "/f/abc123/go"
        );
        assert!(read_page_state_script("/f/a/go").contains(r#"'[hx-post="' + "/f/a/go" + '"]'"#));
    }

    #[test]
    fn legacy_page() {
        let html = r#"<script>function download(){ window.open("https://fuckingfast.co/dl/XyZ_123") }</script>"#;
        assert_eq!(
            legacy_link(html).as_deref(),
            Some("https://fuckingfast.co/dl/XyZ_123")
        );
        assert_eq!(legacy_link("<html/>"), None);
    }

    /// A page that becomes ready on the second poll and answers the post.
    struct FakeBrowser {
        polls: Mutex<u32>,
        closed: Mutex<bool>,
    }

    impl Browser for FakeBrowser {
        fn load(&self, _url: String) -> oneshot::Receiver<Result<(), String>> {
            let (tx, rx) = oneshot::channel();
            let _ = tx.send(Ok(()));
            rx
        }
        fn eval(&self, script: String) -> oneshot::Receiver<Result<String, String>> {
            let (tx, rx) = oneshot::channel();
            let answer = if script.contains("querySelector") {
                let mut polls = self.polls.lock().unwrap();
                *polls += 1;
                if *polls >= 2 {
                    "\"ready\""
                } else {
                    "\"pending\""
                }
                .to_string()
            } else if script == READ_DOWNLOAD_LINK_SCRIPT {
                r#"{"status":200,"redirect":"https://fuckingfast.co/dl/abc"}"#.into()
            } else {
                "true".into()
            };
            let _ = tx.send(Ok(answer));
            rx
        }
        fn close(&self) {
            *self.closed.lock().unwrap() = true;
        }
        fn close_when_idle(&self, _after: Duration) {}
    }

    #[test]
    fn resolves_through_the_page() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let browser = FakeBrowser {
            polls: Mutex::new(0),
            closed: Mutex::new(false),
        };
        let link = runtime
            .block_on(resolve_direct_link(
                &browser,
                "https://fuckingfast.co/abc#Game.rar",
            ))
            .unwrap();
        assert_eq!(link, "https://fuckingfast.co/dl/abc");
        assert_eq!(*browser.polls.lock().unwrap(), 2);
    }
}
