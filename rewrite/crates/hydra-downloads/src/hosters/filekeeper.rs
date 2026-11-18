//! filekeeper.ts: FileKeeper runs XFileSharing. The file page shows a short
//! countdown, then a form post redirects to the file on its download host.

use std::collections::BTreeMap;
use std::sync::OnceLock;
use std::time::Duration;

use super::HOSTER_USER_AGENT;
use crate::errors::{DlError, DlResult};

const ORIGIN: &str = "https://filekeeper.net";
const MAX_REDIRECTS: usize = 5;
const MAX_COUNTDOWN_SECONDS: u64 = 30;

fn client() -> &'static reqwest::Client {
    // redirect: "manual"
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(20))
            .build()
            .expect("FileKeeper client")
    })
}

fn origin_of(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    Some(parsed.origin().ascii_serialization())
}

struct Page {
    status: u16,
    body: Option<String>,
    url: String,
    /// FileKeeper redirected to another host, which serves the file.
    left_site: bool,
}

/// request: follows FileKeeper's own redirects, keeping its cookies.
async fn request(
    mut url: String,
    cookies: &mut BTreeMap<String, String>,
    mut form: Option<(String, String)>,
) -> DlResult<Page> {
    for _ in 0..=MAX_REDIRECTS {
        let cookie = cookies
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ");
        let mut builder = match form.as_ref() {
            Some((referer, body)) => client()
                .post(&url)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Referer", referer)
                .body(body.clone()),
            None => client().get(&url),
        };
        builder = builder
            .header("User-Agent", HOSTER_USER_AGENT)
            .header("Cookie", cookie);
        let response = builder.send().await?;
        for value in response.headers().get_all("set-cookie") {
            let Ok(text) = value.to_str() else { continue };
            let pair = text.split(';').next().unwrap_or_default();
            if let Some(separator) = pair.find('=')
                && separator > 0
            {
                cookies.insert(
                    pair[..separator].to_string(),
                    pair[separator + 1..].to_string(),
                );
            }
        }
        let status = response.status().as_u16();
        let location = response
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let Some(location) = location else {
            let body = response.text().await.ok();
            return Ok(Page {
                status,
                body,
                url,
                left_site: false,
            });
        };
        drop(response);
        url = reqwest::Url::parse(&url)
            .and_then(|base| base.join(&location))
            .map_err(|e| DlError::msg(e.to_string()))?
            .to_string();
        if origin_of(&url).as_deref() != Some(ORIGIN) {
            return Ok(Page {
                status,
                body: None,
                url,
                left_site: true,
            });
        }
        // The site moves the file code into a cookie and redirects with a GET.
        form = None;
    }
    Err(DlError::msg("FileKeeper redirected too many times"))
}

/// `data-<name>="…"` from the download form.
pub fn read_attribute(html: &str, name: &str) -> Option<String> {
    let needle = format!("data-{name}=\"");
    let start = html.find(&needle)? + needle.len();
    let end = html[start..].find('"')?;
    Some(html[start..start + end].to_string())
}

pub async fn download_url(uri: &str) -> DlResult<String> {
    if origin_of(uri).as_deref() != Some(ORIGIN) {
        return Err(DlError::msg("Invalid FileKeeper URL"));
    }
    let mut cookies = BTreeMap::new();
    let page = request(uri.to_string(), &mut cookies, None).await?;
    if page.status == 404 {
        return Err(DlError::msg("File not found or deleted"));
    }
    if !(200..300).contains(&page.status) || page.left_site {
        return Err(DlError::msg(format!(
            "FileKeeper returned HTTP {}",
            page.status
        )));
    }
    let html = page.body.unwrap_or_default();
    let read = |name: &str| read_attribute(&html, name);
    let code = read("code")
        .filter(|c| !c.is_empty())
        .ok_or_else(|| DlError::msg("Could not find the FileKeeper download form"))?;
    if read("has-password").as_deref() == Some("true") {
        return Err(DlError::msg("FileKeeper file is password protected"));
    }
    if read("has-captcha").as_deref() == Some("true") {
        return Err(DlError::msg("FileKeeper requires a captcha for this file"));
    }
    // Honor the page's countdown in case the server starts enforcing it.
    let countdown = read("countdown")
        .and_then(|c| c.trim().parse::<f64>().ok())
        .filter(|c| c.is_finite() && *c > 0.0)
        .map_or(0, |c| (c as u64).min(MAX_COUNTDOWN_SECONDS));
    tokio::time::sleep(Duration::from_secs(countdown)).await;

    let method = read("method").filter(|m| !m.is_empty());
    let body = crate::debrid::form(&[
        ("op", "download2"),
        ("id", &code),
        ("rand", &read("rand").unwrap_or_default()),
        ("referer", &read("referer").unwrap_or_default()),
        ("method_free", method.as_deref().unwrap_or("Free download")),
        ("down_direct", "1"),
    ]);
    let result = request(
        page.url.clone(),
        &mut cookies,
        Some((page.url.clone(), body)),
    )
    .await?;
    if !result.left_site {
        eprintln!(
            "[FileKeeper] Download form returned HTTP {} without a file link",
            result.status
        );
        return Err(DlError::msg("FileKeeper did not return a download link"));
    }
    eprintln!("[FileKeeper] Resolved download link for {code}");
    Ok(result.url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn form_attributes() {
        let html = r#"<form data-code="abc123" data-rand="r9" data-has-password="false" data-countdown="5" data-method="">"#;
        assert_eq!(read_attribute(html, "code").as_deref(), Some("abc123"));
        assert_eq!(read_attribute(html, "rand").as_deref(), Some("r9"));
        assert_eq!(read_attribute(html, "method").as_deref(), Some(""));
        assert_eq!(read_attribute(html, "referer"), None);
        assert_eq!(
            origin_of("https://filekeeper.net/abc").as_deref(),
            Some(ORIGIN)
        );
        assert_ne!(origin_of("https://evil.net/abc").as_deref(), Some(ORIGIN));
    }
}
