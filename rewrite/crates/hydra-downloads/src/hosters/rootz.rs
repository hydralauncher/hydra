//! rootz.ts: the file page carries a page token the API wants back.

use serde_json::Value;

use crate::errors::{DlError, DlResult};

const BASE_URL: &str = "https://www.rootz.so";
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// extractPageToken: `"pageToken":"…"`, also inside escaped JSON.
pub fn extract_page_token(html: &str) -> DlResult<String> {
    let mut rest = html;
    while let Some(start) = rest.find("pageToken") {
        let after = &rest[start + "pageToken".len()..];
        let after = after.strip_prefix('\\').unwrap_or(after);
        let Some(after) = after.strip_prefix('"') else {
            rest = &rest[start + 1..];
            continue;
        };
        let after = after.trim_start();
        let Some(after) = after.strip_prefix(':') else {
            rest = &rest[start + 1..];
            continue;
        };
        let after = after.trim_start();
        let after = after.strip_prefix('\\').unwrap_or(after);
        let Some(after) = after.strip_prefix('"') else {
            rest = &rest[start + 1..];
            continue;
        };
        let token: String = after
            .chars()
            .take_while(|c| *c != '"' && *c != '\\')
            .collect();
        if !token.is_empty() {
            return Ok(token);
        }
        rest = &rest[start + 1..];
    }
    Err(DlError::msg("Rootz page token not found"))
}

fn short_id(uri: &str) -> DlResult<String> {
    let url = reqwest::Url::parse(uri).map_err(|e| DlError::msg(e.to_string()))?;
    let parts: Vec<&str> = url
        .path_segments()
        .map(|s| s.filter(|p| !p.is_empty()).collect())
        .unwrap_or_default();
    if parts.len() < 2 || parts[0] != "d" {
        return Err(DlError::msg("Invalid rootz URL format"));
    }
    Ok(parts[1].to_string())
}

/// getDownloadUrl
pub async fn download_url(uri: &str) -> DlResult<String> {
    let result = async {
        let id = short_id(uri)?;
        let page_url = format!("{BASE_URL}/d/{id}");
        let api_url = format!(
            "{BASE_URL}/api/files/download-by-short?shortId={}",
            form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>()
        );
        let page = super::client()
            .get(&page_url)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "text/html")
            .send()
            .await?;
        let status = page.status().as_u16();
        if status >= 400 {
            return Err(DlError::Http { status, body: None });
        }
        let token = extract_page_token(&page.text().await?)?;
        let response = super::client()
            .get(&api_url)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/json")
            .header("Referer", &page_url)
            .header("X-Page-Token", token)
            .send()
            .await?;
        let status = response.status().as_u16();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        if status >= 400 {
            return Err(DlError::Http {
                status,
                body: Some(body),
            });
        }
        let data = body.get("data");
        let file_id = data
            .and_then(|d| d.get("fileId"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty());
        if body.get("success").and_then(Value::as_bool) == Some(true)
            && let (Some(data), Some(file_id)) = (data, file_id)
        {
            if let Some(state) = data
                .get("status")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty() && *s != "active")
            {
                return Err(DlError::msg(format!("Rootz file is {state}")));
            }
            if data.get("downloadAllowed").and_then(Value::as_bool) == Some(false) {
                return Err(DlError::msg("Rootz download is not allowed"));
            }
            if data.get("passwordProtected").and_then(Value::as_bool) == Some(true) {
                return Err(DlError::msg("Rootz file is password protected"));
            }
            return Ok(format!("{BASE_URL}/api/files/proxy-download/{file_id}"));
        }
        Err(DlError::msg("Failed to get download URL from rootz API"))
    }
    .await;
    match result {
        Err(DlError::Http { status, body }) => {
            let message = body
                .as_ref()
                .and_then(|b| b.get("error"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty());
            if message.is_some() || status == 404 {
                let message = message.unwrap_or("File not found");
                eprintln!("[Rootz] {message}");
                return Err(DlError::msg(message));
            }
            eprintln!("[Rootz] Error fetching download URL: HTTP {status}");
            Err(DlError::Http { status, body })
        }
        Err(error) => {
            eprintln!("[Rootz] Error fetching download URL: {error}");
            Err(error)
        }
        ok => ok,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_tokens() {
        assert_eq!(
            extract_page_token(r#"{"pageToken":"abc123"}"#).unwrap(),
            "abc123"
        );
        assert_eq!(
            extract_page_token(r#"self.__next_f.push([1,"{\"pageToken\":\"tok-9\"}"])"#).unwrap(),
            "tok-9"
        );
        assert!(extract_page_token("<html></html>").is_err());
        assert_eq!(short_id("https://www.rootz.so/d/XyZ").unwrap(), "XyZ");
        assert!(short_id("https://www.rootz.so/f/XyZ").is_err());
    }
}
