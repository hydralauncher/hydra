//! gofile.ts: a guest account token (cached in gofile-guest-token.json), the
//! website token GoFile's own script computes (its secret is read by
//! running that script in a sandboxed JS engine, like Electron's `vm`), the
//! content tree walked for the first file, and the alternate CDN fallback.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::Context;
use crate::errors::{DlError, DlResult};

const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const LANGUAGE: &str = "en-US";
const TIMEOUT: Duration = Duration::from_millis(15_000);
const WEBSITE_URL: &str = "https://gofile.io/";
const WEBSITE_TOKEN_SCRIPT_URLS: [&str; 2] = [
    "https://gofile.io/js/wt.obf.js",
    "https://gofile.io/dist/js/wt.obf.js",
];
const ALTERNATE_CDN_BASE_URL: &str = "https://gofilecdn.eu.cc";
const ALTERNATE_CDN_PROBE_TIMEOUT: Duration = Duration::from_millis(5000);
const ALTERNATE_CDN_PROBE_TTL: Duration = Duration::from_millis(15_000);
const PAGE_SIZE: u32 = 1000;
const CACHE_VERSION: u32 = 1;
const RATE_LIMIT_MESSAGE: &str =
    "RATE_LIMIT:Gofile rate limit reached. Please enable a VPN and try again in a few minutes.";

#[derive(Default)]
struct State {
    token: Option<String>,
    secret: Option<String>,
    probes: HashMap<String, (Option<String>, Instant)>,
}

fn state() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(State::default()))
}

fn lock() -> std::sync::MutexGuard<'static, State> {
    state().lock().unwrap_or_else(|e| e.into_inner())
}

/// authorizePromise / websiteTokenSecretPromise: one at a time.
fn authorize_turn() -> &'static tokio::sync::Mutex<()> {
    static TURN: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    TURN.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn secret_turn() -> &'static tokio::sync::Mutex<()> {
    static TURN: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    TURN.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn user_agent() -> String {
    std::env::var("GOFILE_USER_AGENT")
        .or_else(|_| std::env::var("GF_USERAGENT"))
        .unwrap_or_else(|_| DEFAULT_USER_AGENT.to_string())
}

fn configured_token() -> Option<String> {
    std::env::var("GOFILE_TOKEN")
        .ok()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
}

fn cache_path(ctx: &Context) -> PathBuf {
    ctx.user_data.join("gofile-guest-token.json")
}

fn sha256_hex(input: &str) -> String {
    Sha256::digest(input.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// fetchWithTimeout
async fn fetch(
    request: reqwest::RequestBuilder,
    method: &str,
    url: &str,
    timeout: Duration,
) -> DlResult<reqwest::Response> {
    match request.timeout(timeout).send().await {
        Ok(response) => Ok(response),
        Err(error) if error.is_timeout() => {
            Err(DlError::msg(format!("Request timed out: {method} {url}")))
        }
        Err(error) => Err(error.into()),
    }
}

// ---- website token

/// extractWebsiteTokenSecret: runs GoFile's generator with probe values and
/// reads the secret from what it hashes.
pub fn extract_website_token_secret(script: &str) -> DlResult<String> {
    use rquickjs::{Context as JsContext, Runtime};
    const PROBE_UA: &str = "HydraGofileUserAgent";
    const PROBE_LANGUAGE: &str = "HydraGofileLanguage";
    const PROBE_TOKEN: &str = "HydraGofileToken";
    let fail = |m: &str| DlError::msg(m.to_string());
    let runtime = Runtime::new().map_err(|e| DlError::msg(e.to_string()))?;
    runtime.set_memory_limit(64 * 1024 * 1024);
    runtime.set_max_stack_size(1024 * 1024);
    // vm.runInContext(…, { timeout: 1000 }) per call
    let deadline = std::sync::Arc::new(Mutex::new(Instant::now() + Duration::from_millis(1000)));
    let watch = deadline.clone();
    runtime.set_interrupt_handler(Some(Box::new(move || {
        Instant::now() > *watch.lock().unwrap_or_else(|e| e.into_inner())
    })));
    let context = JsContext::full(&runtime).map_err(|e| DlError::msg(e.to_string()))?;
    let prelude = format!(
        r#"var navigator = {{ userAgent: {ua}, language: {lang} }};
var appdata = {{}};
var console = {{ error: function () {{}}, log: function () {{}}, warn: function () {{}} }};
var window = {{ location: {{ hostname: "gofile.io", search: "" }}, navigator: navigator }};"#,
        ua = json!(PROBE_UA),
        lang = json!(PROBE_LANGUAGE),
    );
    let raw = context.with(|ctx| -> DlResult<String> {
        let js = |e: rquickjs::Error| {
            let detail = ctx
                .catch()
                .as_exception()
                .and_then(|x| x.message())
                .unwrap_or_default();
            DlError::msg(format!("Gofile WT script failed: {e} {detail}"))
        };
        ctx.eval::<(), _>(prelude.as_str()).map_err(js)?;
        ctx.eval::<(), _>(script).map_err(js)?;
        let is_function: bool = ctx.eval("typeof generateWT === 'function'").map_err(js)?;
        if !is_function {
            return Err(fail("Gofile WT generator was not found"));
        }
        *deadline.lock().unwrap_or_else(|e| e.into_inner()) =
            Instant::now() + Duration::from_millis(1000);
        ctx.eval::<(), _>(
            r#"var __hydraRawHashInput;
_sha256 = function (input) { __hydraRawHashInput = String(input); return "0".repeat(64); };"#,
        )
        .map_err(js)?;
        ctx.eval::<rquickjs::Value, _>(format!("generateWT({})", json!(PROBE_TOKEN)))
            .map_err(js)?;
        let raw: Option<String> = ctx
            .eval("typeof __hydraRawHashInput === 'string' ? __hydraRawHashInput : null")
            .map_err(js)?;
        raw.ok_or_else(|| fail("Gofile WT generator did not hash any input"))
    })?;
    let prefix = format!("{PROBE_UA}::{PROBE_LANGUAGE}::{PROBE_TOKEN}::");
    let Some(rest) = raw.strip_prefix(&prefix) else {
        return Err(fail("Gofile WT generator format is unsupported"));
    };
    // `${timeSlot}::${secret}`: everything after the time slot.
    let mut parts = rest.split("::");
    parts.next();
    let secret = parts.collect::<Vec<_>>().join("::").trim().to_string();
    if secret.is_empty() {
        return Err(fail("Gofile WT secret was empty"));
    }
    Ok(secret)
}

/// The `<script src="…wt….js">` on gofile.io, when it is on GoFile's origin.
pub fn website_token_script_url(html: &str) -> Option<String> {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r#"(?i)<script[^>]+src=["']([^"']*wt[^"'/]*\.js)["']"#).expect("regex")
    });
    let src = re.captures(html)?.get(1)?.as_str();
    let url = reqwest::Url::parse(WEBSITE_URL).ok()?.join(src).ok()?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https" || !(host == "gofile.io" || host.ends_with(".gofile.io")) {
        eprintln!("[Gofile] Ignoring WT script URL outside the Gofile origin: {url}");
        return None;
    }
    Some(url.to_string())
}

async fn discover_script_url() -> Option<String> {
    let request = super::client()
        .get(WEBSITE_URL)
        .header("User-Agent", user_agent())
        .header("Accept", "text/html,application/xhtml+xml");
    match fetch(request, "GET", WEBSITE_URL, TIMEOUT).await {
        Ok(response) if response.status().is_success() => {
            website_token_script_url(&response.text().await.ok()?)
        }
        Ok(_) => None,
        Err(error) => {
            eprintln!("[Gofile] Failed to discover WT script URL: {error}");
            None
        }
    }
}

async fn fetch_script(url: &str) -> DlResult<String> {
    let request = super::client()
        .get(url)
        .header("User-Agent", user_agent())
        .header(
            "Accept",
            "application/javascript, text/javascript, */*;q=0.8",
        )
        .header("Referer", WEBSITE_URL);
    let response = fetch(request, "GET", url, TIMEOUT).await?;
    if !response.status().is_success() {
        return Err(DlError::msg(format!(
            "Failed to load Gofile WT script: {}",
            response.status().as_u16()
        )));
    }
    let script = response.text().await?;
    if script.trim_start().starts_with('<') {
        return Err(DlError::msg(format!(
            "Gofile WT script URL returned markup: {url}"
        )));
    }
    Ok(script)
}

async fn website_token_secret() -> DlResult<String> {
    if let Some(secret) = lock().secret.clone() {
        return Ok(secret);
    }
    let _turn = secret_turn().lock().await;
    if let Some(secret) = lock().secret.clone() {
        return Ok(secret);
    }
    let mut urls: Vec<String> = Vec::new();
    if let Some(found) = discover_script_url().await {
        urls.push(found);
    }
    for url in WEBSITE_TOKEN_SCRIPT_URLS {
        if !urls.iter().any(|u| u == url) {
            urls.push(url.to_string());
        }
    }
    let mut last = DlError::msg("Failed to load Gofile WT script");
    for url in urls {
        let attempt = async {
            let script = fetch_script(&url).await?;
            tokio::task::spawn_blocking(move || extract_website_token_secret(&script))
                .await
                .map_err(|e| DlError::msg(e.to_string()))?
        }
        .await;
        match attempt {
            Ok(secret) => {
                eprintln!("[Gofile] Loaded website token secret from {url}");
                lock().secret = Some(secret.clone());
                return Ok(secret);
            }
            Err(error) => {
                eprintln!("[Gofile] Failed to load WT script from {url}: {error}");
                last = error;
            }
        }
    }
    Err(last)
}

/// generateWebsiteToken
pub fn website_token(user_agent: &str, account_token: &str, secret: &str, now_ms: i64) -> String {
    let slot = now_ms / 1000 / 14400;
    sha256_hex(&format!(
        "{user_agent}::{LANGUAGE}::{account_token}::{slot}::{secret}"
    ))
}

async fn generate_website_token(account_token: &str) -> DlResult<String> {
    let secret = website_token_secret().await?;
    Ok(website_token(
        &user_agent(),
        account_token,
        &secret,
        chrono::Utc::now().timestamp_millis(),
    ))
}

/// hashPassword
pub fn hash_password(password: &str) -> String {
    let trimmed = password.trim();
    if trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return trimmed.to_lowercase();
    }
    sha256_hex(trimmed)
}

/// getBaseHeaders (without Accept-Encoding: the client doesn't decode gzip,
/// so the API answers uncompressed).
fn base_headers(
    request: reqwest::RequestBuilder,
    account_token: Option<&str>,
) -> reqwest::RequestBuilder {
    let request = request
        .header("User-Agent", user_agent())
        .header("Accept", "application/json")
        .header("Connection", "keep-alive")
        .header("Origin", "https://gofile.io")
        .header("Referer", "https://gofile.io/");
    match account_token {
        Some(token) if !token.is_empty() => request.bearer_auth(token),
        _ => request,
    }
}

// ---- guest token

fn load_cached_guest_token(ctx: &Context) -> Option<String> {
    let text = std::fs::read_to_string(cache_path(ctx)).ok()?;
    let parsed: Value = serde_json::from_str(&text).ok()?;
    let token = parsed.get("token")?.as_str()?.trim().to_string();
    if token.is_empty() {
        return None;
    }
    eprintln!("[Gofile] Loaded cached guest token");
    Some(token)
}

fn persist_guest_token(ctx: &Context, token: &str) {
    let payload = json!({
        "version": CACHE_VERSION,
        "token": token,
        "createdAt": chrono::Utc::now().timestamp_millis(),
    });
    let text = format!(
        "{}\n",
        serde_json::to_string_pretty(&payload).unwrap_or_default()
    );
    match std::fs::write(cache_path(ctx), text) {
        Ok(()) => eprintln!("[Gofile] Persisted guest token cache"),
        Err(error) => eprintln!("[Gofile] Failed to persist guest token cache: {error}"),
    }
}

fn is_retryable_status(status: u16) -> bool {
    [408, 425, 429, 500, 502, 503, 504].contains(&status)
}

async fn create_guest_token(ctx: &Context) -> DlResult<String> {
    let website_token = generate_website_token("").await?;
    eprintln!("[Gofile] Creating guest token");
    for attempt in 0..3u32 {
        let url = "https://api.gofile.io/accounts";
        let request = base_headers(super::client().post(url), None)
            .header("X-Website-Token", &website_token)
            .header("X-BL", LANGUAGE);
        let response = fetch(request, "POST", url, TIMEOUT).await?;
        let status = response.status().as_u16();
        let payload: Value = response.json().await.unwrap_or(Value::Null);
        let api_status = payload.get("status").and_then(Value::as_str);
        if api_status == Some("ok")
            && let Some(token) = payload
                .get("data")
                .and_then(|d| d.get("token"))
                .and_then(Value::as_str)
                .filter(|t| !t.is_empty())
        {
            eprintln!("[Gofile] Guest token created");
            persist_guest_token(ctx, token);
            return Ok(token.to_string());
        }
        if attempt < 2 && (api_status == Some("error-rateLimit") || is_retryable_status(status)) {
            tokio::time::sleep(Duration::from_millis(1000 * 2u64.pow(attempt))).await;
            continue;
        }
        return Err(DlError::msg(format!(
            "Account creation failed: {}",
            api_status.map(str::to_string).unwrap_or(status.to_string())
        )));
    }
    Err(DlError::msg("Account creation failed after all retries"))
}

/// initialize: get a guest token ready at startup.
pub async fn initialize(ctx: &Context) {
    eprintln!("[Gofile] Initializing guest token");
    if let Err(error) = authorize(ctx, false).await {
        eprintln!("[Gofile] Failed to initialize guest token: {error}");
    }
}

/// authorize
pub async fn authorize(ctx: &Context, force_refresh: bool) -> DlResult<String> {
    if let Some(configured) = configured_token() {
        let mut s = lock();
        if s.token.as_deref() != Some(configured.as_str()) {
            eprintln!("[Gofile] Using configured account token");
        }
        s.token = Some(configured.clone());
        return Ok(configured);
    }
    if !force_refresh && let Some(token) = lock().token.clone() {
        return Ok(token);
    }
    let _turn = authorize_turn().lock().await;
    if !force_refresh && let Some(token) = lock().token.clone() {
        return Ok(token);
    }
    if !force_refresh && let Some(cached) = load_cached_guest_token(ctx) {
        lock().token = Some(cached.clone());
        return Ok(cached);
    }
    let token = create_guest_token(ctx).await?;
    lock().token = Some(token.clone());
    Ok(token)
}

// ---- contents

fn status_to_message(status: &str, context: &str) -> String {
    match status {
        "error-notFound" => format!("Content not found: {context}"),
        "error-notPremium" => {
            "Gofile denied access with error-notPremium for this request/content.".into()
        }
        "error-passwordRequired" => format!("Content {context} requires a password."),
        "error-passwordWrong" => format!("Password is incorrect for content {context}."),
        "error-wrongToken" | "error-notAuthenticated" => {
            "The Gofile token is invalid or expired.".into()
        }
        other => format!("Gofile API returned {other} for {context}."),
    }
}

fn access_error_message(data: &Value, id: &str) -> String {
    if data.get("password").and_then(Value::as_bool) == Some(true) {
        match data.get("passwordStatus").and_then(Value::as_str) {
            Some("passwordRequired") => return format!("Content {id} is password protected."),
            Some("passwordWrong") => return format!("Password for content {id} is incorrect."),
            _ => {}
        }
    }
    if data.get("public").and_then(Value::as_bool) == Some(false) {
        return format!("Content {id} is private.");
    }
    if data.get("expire").is_some_and(Value::is_number) {
        return format!("Content {id} has expired.");
    }
    format!("Content {id} is not accessible.")
}

fn is_likely_token_auth_error(error: &DlError) -> bool {
    let message = error.message().to_lowercase();
    [
        "invalid or expired",
        "notauthenticated",
        "wrongtoken",
        "badtoken",
        "notpremium",
        "denied access",
        "authorization",
    ]
    .iter()
    .any(|p| message.contains(p))
}

/// getContentPage: (data, totalPages)
async fn content_page(
    id: &str,
    account_token: &str,
    page: u32,
    password: Option<&str>,
) -> DlResult<(Value, u32)> {
    let mut pairs = vec![
        ("page", page.to_string()),
        ("pageSize", PAGE_SIZE.to_string()),
        ("sortField", "createTime".to_string()),
        ("sortDirection", "-1".to_string()),
    ];
    if let Some(password) = password {
        pairs.push(("password", hash_password(password)));
    }
    let query = crate::debrid::form(
        &pairs
            .iter()
            .map(|(k, v)| (*k, v.as_str()))
            .collect::<Vec<_>>(),
    );
    let website_token = generate_website_token(account_token).await?;
    let url = format!("https://api.gofile.io/contents/{id}?{query}");
    let request = base_headers(super::client().get(&url), Some(account_token))
        .header("X-Website-Token", website_token)
        .header("X-BL", LANGUAGE);
    let response = fetch(request, "GET", &url, TIMEOUT).await?;
    let status = response.status().as_u16();
    let payload: Value = response.json().await.unwrap_or(Value::Null);
    let api_status = payload.get("status").and_then(Value::as_str);
    if api_status == Some("error-rateLimit") || status == 429 {
        return Err(DlError::msg(RATE_LIMIT_MESSAGE));
    }
    let data = payload.get("data").filter(|d| d.is_object());
    let (Some("ok"), Some(data)) = (api_status, data) else {
        return Err(DlError::msg(status_to_message(
            api_status.unwrap_or("unknown"),
            id,
        )));
    };
    if data.get("canAccess").and_then(Value::as_bool) == Some(false) {
        return Err(DlError::msg(access_error_message(data, id)));
    }
    let total = payload
        .get("metadata")
        .and_then(|m| m.get("totalPages"))
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .max(1) as u32;
    Ok((data.clone(), total))
}

/// parseLinksRecursively: the first file link in the content tree.
fn parse_links<'a>(
    id: &'a str,
    account_token: &'a str,
    password: Option<&'a str>,
    visited: &'a mut HashSet<String>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = DlResult<Option<String>>> + Send + 'a>> {
    Box::pin(async move {
        if !visited.insert(id.to_string()) {
            return Ok(None);
        }
        eprintln!("[Gofile] Fetching content {id}");
        let (first, total) = content_page(id, account_token, 1, password).await?;
        let mut pages = vec![first];
        for page in 2..=total {
            eprintln!("[Gofile] Fetching content {id} page {page}/{total}");
            pages.push(content_page(id, account_token, page, password).await?.0);
        }
        for content in pages {
            match content.get("type").and_then(Value::as_str) {
                Some("file") => {
                    return Ok(content
                        .get("link")
                        .and_then(Value::as_str)
                        .map(str::to_string));
                }
                Some("folder") => {}
                _ => return Err(DlError::msg("Unsupported content type")),
            }
            let children: Vec<Value> = match content.get("children") {
                Some(Value::Object(map)) => map.values().cloned().collect(),
                _ => Vec::new(),
            };
            for child in children {
                let kind = child.get("type").and_then(Value::as_str);
                if kind == Some("file")
                    && let Some(link) = child
                        .get("link")
                        .and_then(Value::as_str)
                        .filter(|l| !l.is_empty())
                {
                    eprintln!("[Gofile] Found file in content {id}");
                    return Ok(Some(link.to_string()));
                }
                if kind == Some("folder") {
                    let child_id = child
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    if child.get("canAccess").and_then(Value::as_bool) == Some(false) {
                        eprintln!("[Gofile] Skipping inaccessible folder {child_id}");
                        continue;
                    }
                    if let Some(link) =
                        parse_links(&child_id, account_token, password, visited).await?
                    {
                        return Ok(Some(link));
                    }
                }
            }
        }
        Ok(None)
    })
}

/// getDownloadLink
pub async fn download_link(ctx: &Context, id: &str, password: Option<&str>) -> DlResult<String> {
    eprintln!("[Gofile] Resolving download link for content {id}");
    let token = authorize(ctx, false).await?;
    let link = match parse_links(id, &token, password, &mut HashSet::new()).await {
        Ok(link) => link,
        Err(error) if configured_token().is_none() && is_likely_token_auth_error(&error) => {
            eprintln!("[Gofile] Guest token rejected; refreshing and retrying");
            let token = authorize(ctx, true).await?;
            parse_links(id, &token, password, &mut HashSet::new()).await?
        }
        Err(error) => return Err(error),
    };
    let link = link.ok_or_else(|| DlError::msg("No file links found in folder contents"))?;
    eprintln!("[Gofile] Download link resolved for content {id}");
    Ok(link)
}

/// checkDownloadUrl: a HEAD with the account cookie.
pub async fn check_download_url(ctx: &Context, url: &str) -> DlResult<()> {
    let token = authorize(ctx, false).await?;
    let request = super::client()
        .head(url)
        .header("Cookie", format!("accountToken={token}"));
    let response = fetch(request, "HEAD", url, TIMEOUT).await?;
    let status = response.status().as_u16();
    if status == 429 {
        return Err(DlError::msg(RATE_LIMIT_MESSAGE));
    }
    if !response.status().is_success() {
        return Err(DlError::msg(format!(
            "Failed to validate download URL: {status}"
        )));
    }
    eprintln!("[Gofile] Download URL HEAD check returned {status}");
    Ok(())
}

async fn probe_alternate_cdn(id: &str) -> Option<String> {
    let url = format!(
        "{ALTERNATE_CDN_BASE_URL}/{}",
        form_urlencoded::byte_serialize(id.as_bytes())
            .collect::<String>()
            .replace('+', "%20")
    );
    eprintln!("[Gofile] Checking alternate CDN downloader for {id}");
    let request = super::client()
        .get(&url)
        .header("User-Agent", user_agent())
        .header("Accept", "*/*")
        .header("Range", "bytes=0-0");
    match fetch(request, "GET", &url, ALTERNATE_CDN_PROBE_TIMEOUT).await {
        Ok(response) => {
            if !response.status().is_success() {
                eprintln!(
                    "[Gofile] Alternate CDN unavailable for {id}: {}; falling back to official downloader",
                    response.status().as_u16()
                );
                return None;
            }
            let content_type = response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default()
                .trim()
                .to_lowercase();
            drop(response);
            let error_body = [
                "text/html",
                "application/xhtml",
                "text/plain",
                "application/json",
            ]
            .iter()
            .any(|t| content_type.contains(t));
            if error_body {
                eprintln!(
                    "[Gofile] Alternate CDN returned a non-file response for {id} ({}); falling back to official downloader",
                    if content_type.is_empty() {
                        "no content-type"
                    } else {
                        &content_type
                    }
                );
                return None;
            }
            eprintln!("[Gofile] Using alternate CDN downloader for {id}");
            Some(url)
        }
        Err(error) => {
            eprintln!(
                "[Gofile] Alternate CDN check failed for {id}; falling back to official downloader: {error}"
            );
            None
        }
    }
}

/// getAlternateCdnDownloadLinkIfAvailable (answers cached for 15s).
pub async fn alternate_cdn_link(id: &str) -> Option<String> {
    if let Some((result, expires)) = lock().probes.get(id).cloned()
        && expires > Instant::now()
    {
        return result;
    }
    let result = probe_alternate_cdn(id).await;
    let mut s = lock();
    s.probes.insert(
        id.to_string(),
        (result.clone(), Instant::now() + ALTERNATE_CDN_PROBE_TTL),
    );
    let now = Instant::now();
    s.probes.retain(|_, (_, expires)| *expires > now);
    result
}

/// parseGofileUri: the content id and the `password` parameter.
pub fn parse_uri(uri: &str) -> (String, Option<String>) {
    let mut normalized = uri.trim().to_string();
    if !normalized.starts_with("http://") && !normalized.starts_with("https://") {
        normalized = format!("https://{normalized}");
    }
    match reqwest::Url::parse(&normalized) {
        Ok(url) => {
            let id = url
                .path_segments()
                .and_then(|mut s| s.rfind(|p| !p.is_empty()))
                .unwrap_or_default()
                .to_string();
            let password = url
                .query_pairs()
                .find(|(k, _)| k == "password")
                .map(|(_, v)| v.into_owned())
                .filter(|p| !p.is_empty());
            (id, password)
        }
        Err(_) => {
            let before = normalized.split('?').next().unwrap_or_default();
            let id = before
                .split('/')
                .rfind(|p| !p.is_empty())
                .unwrap_or_default()
                .to_string();
            (id, None)
        }
    }
}

/// resolveGofileDownload: the official link with the account cookie, else
/// the alternate CDN.
pub async fn resolve(ctx: &Context, uri: &str) -> DlResult<(String, Vec<(String, String)>)> {
    let (id, password) = parse_uri(uri);
    if id.is_empty() {
        return Err(DlError::msg("Invalid gofile URL"));
    }
    let official = async {
        let link = download_link(ctx, &id, password.as_deref()).await?;
        check_download_url(ctx, &link).await?;
        let token = authorize(ctx, false).await?;
        eprintln!("[DownloadManager] GoFile download {id} will use the official downloader");
        Ok::<_, DlError>((
            link,
            vec![("Cookie".into(), format!("accountToken={token}"))],
        ))
    }
    .await;
    match official {
        Ok(found) => Ok(found),
        Err(error) => {
            eprintln!(
                "[DownloadManager] Official GoFile downloader failed for {id}; checking alternate CDN: {error}"
            );
            let alternate = alternate_cdn_link(&id).await.ok_or(error)?;
            eprintln!("[DownloadManager] GoFile download {id} will use alternate CDN");
            Ok((alternate, Vec::new()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape of GoFile's generator: the hash of UA::language::token::slot::secret.
    const FAKE_SCRIPT: &str = r#"
function _sha256(input) { return "real-hash-" + input.length; }
function generateWT(token) {
  var slot = Math.floor(Date.now() / 1000 / 14400);
  var parts = [navigator.userAgent, navigator.language, token, slot, "s3cr" + "et::x"];
  return _sha256(parts.join("::"));
}"#;

    #[test]
    fn reads_the_secret_from_the_generator() {
        assert_eq!(
            extract_website_token_secret(FAKE_SCRIPT).unwrap(),
            "s3cret::x"
        );
        assert!(extract_website_token_secret("var nothing = 1;").is_err());
        // A script that never returns is stopped by the 1s budget.
        assert!(extract_website_token_secret("while (true) {}").is_err());
    }

    /// The script GoFile served on 2026-11-08, when present in the scratch
    /// fixtures (run with HYDRA_GOFILE_WT=<path>).
    #[test]
    fn reads_the_live_script_when_given() {
        let Ok(path) = std::env::var("HYDRA_GOFILE_WT") else {
            return;
        };
        let script = std::fs::read_to_string(path).unwrap();
        let secret = extract_website_token_secret(&script).unwrap();
        assert!(!secret.is_empty());
        eprintln!("secret length {}", secret.len());
    }

    #[test]
    fn tokens_and_passwords() {
        // sha256("UA::en-US::tok::1::sec"), slot = 14_400_000 ms / 1000 / 14400 = 1
        assert_eq!(
            website_token("UA", "tok", "sec", 14_400_000),
            sha256_hex("UA::en-US::tok::1::sec")
        );
        let hex = "A".repeat(64);
        assert_eq!(hash_password(&hex), "a".repeat(64));
        assert_eq!(hash_password(" pw "), sha256_hex("pw"));
    }

    #[test]
    fn uris_and_scripts() {
        assert_eq!(
            parse_uri("https://gofile.io/d/AbCd?password=x"),
            ("AbCd".into(), Some("x".into()))
        );
        assert_eq!(parse_uri("gofile.io/d/AbCd/"), ("AbCd".into(), None));
        assert_eq!(
            website_token_script_url(r#"<script src="/js/wt.obf.js" defer></script>"#).as_deref(),
            Some("https://gofile.io/js/wt.obf.js")
        );
        assert_eq!(
            website_token_script_url(r#"<script src="https://evil.com/wt.js"></script>"#),
            None
        );
        assert_eq!(
            status_to_message("error-notFound", "x"),
            "Content not found: x"
        );
    }
}
