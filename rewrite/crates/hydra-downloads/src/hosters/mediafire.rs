//! mediafire.ts: read the direct link from the file page.

use std::sync::OnceLock;

use regex::Regex;

use crate::errors::{DlError, DlResult};

/// processUrl
pub fn process_url(url: &str) -> String {
    let mut processed = url.replacen("http://", "https://", 1);
    // validMediafireIdentifierDL is multiline: any line made only of letters
    // and digits counts as a bare identifier.
    if processed
        .lines()
        .any(|line| !line.is_empty() && line.chars().all(|c| c.is_ascii_alphanumeric()))
    {
        processed = format!("https://mediafire.com/?{processed}");
    }
    let has_http = processed
        .lines()
        .any(|line| line.starts_with("http://") || line.starts_with("https://"));
    if !has_http {
        processed = if processed.starts_with("//") {
            format!("https:{processed}")
        } else {
            format!("https://{processed}")
        };
    }
    processed
}

fn pre_download() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"['"]((?:https?:)?(?://)?(?:www\.)?mediafire\.com/(?:file|view|download)/[^'"?]+\?dkey=[^'"]+)['"]"#)
            .expect("mediafire regex")
    })
}

fn dynamic_download() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"['"](https?://download\d+\.mediafire\.com/[^'"]+)['"]"#)
            .expect("mediafire regex")
    })
}

/// extractDirectUrl
pub fn extract_direct_url(html: &str) -> DlResult<String> {
    if let Some(found) = pre_download().captures(html).and_then(|c| c.get(1)) {
        let link = found.as_str();
        return Ok(if link.starts_with("//") {
            format!("https:{link}")
        } else {
            link.to_string()
        });
    }
    if let Some(found) = dynamic_download().captures(html).and_then(|c| c.get(1)) {
        return Ok(found.as_str().to_string());
    }
    Err(DlError::msg("No valid download links found"))
}

/// getDownloadUrl
pub async fn download_url(url: &str) -> DlResult<String> {
    let result = async {
        let response = super::client().get(process_url(url)).send().await?;
        if !response.status().is_success() {
            return Err(DlError::msg("Failed to fetch Mediafire page"));
        }
        let html = response.text().await?;
        extract_direct_url(&html)
    }
    .await;
    result.map_err(|_| DlError::msg("Failed to get download URL"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        assert_eq!(
            process_url("http://www.mediafire.com/file/abc/x.zip/file"),
            "https://www.mediafire.com/file/abc/x.zip/file"
        );
        assert_eq!(process_url("abc123"), "https://mediafire.com/?abc123");
        assert_eq!(
            process_url("www.mediafire.com/file/a"),
            "https://www.mediafire.com/file/a"
        );
    }

    #[test]
    fn page_links() {
        let html = r#"<a class="input popsok" aria-label="Download file" href="https://download2391.mediafire.com/abc/x/Game.zip" id="downloadButton">"#;
        assert_eq!(
            extract_direct_url(html).unwrap(),
            "https://download2391.mediafire.com/abc/x/Game.zip"
        );
        let pre =
            r#"window.location.href = '//www.mediafire.com/file/abc/Game.zip/file?dkey=xyz&r=1';"#;
        assert_eq!(
            extract_direct_url(pre).unwrap(),
            "https://www.mediafire.com/file/abc/Game.zip/file?dkey=xyz&r=1"
        );
        assert!(extract_direct_url("<html></html>").is_err());
    }
}
