//! pixeldrain.ts: check the file is downloadable, then use the API's
//! download link.

use serde_json::Value;

use crate::errors::{DlError, DlResult, key};

const API_BASE_URL: &str = "https://pixeldrain.com/api/file";

/// extractId: `https://pixeldrain.com/u/<id>`
pub fn extract_id(url: &str) -> DlResult<String> {
    let invalid = || DlError::msg(format!("Invalid pixeldrain URL: {url}"));
    let parsed = reqwest::Url::parse(url).map_err(|_| invalid())?;
    let parts: Vec<&str> = parsed
        .path_segments()
        .map(|s| s.filter(|p| !p.is_empty()).collect())
        .unwrap_or_default();
    match (parts.first(), parts.get(1)) {
        (Some(&"u"), Some(id)) => Ok(id.to_string()),
        _ => Err(invalid()),
    }
}

/// checkAvailability
async fn check_availability(id: &str) -> DlResult<()> {
    let response = super::client()
        .get(format!("{API_BASE_URL}/{id}/info"))
        .send()
        .await?;
    let status = response.status().as_u16();
    if status == 404 {
        return Err(DlError::msg(key::HOSTER_UNLOCK_FILE_NOT_FOUND));
    }
    let body: Value = response.json().await.unwrap_or(Value::Null);
    let availability = body
        .get("availability")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    if status >= 400
        || availability.is_some()
        || body.get("can_download").and_then(Value::as_bool) == Some(false)
    {
        eprintln!(
            "[PixelDrain] File {id} is not downloadable (status={status}, availability={})",
            availability.unwrap_or("none")
        );
        return Err(DlError::msg(key::HOSTER_UNLOCK_UNAVAILABLE));
    }
    Ok(())
}

/// unlock / getDownloadUrl
pub async fn unlock(url: &str) -> DlResult<String> {
    let result = async {
        let id = extract_id(url)?;
        check_availability(&id).await?;
        Ok(format!("{API_BASE_URL}/{id}?download"))
    }
    .await;
    if let Err(error) = &result {
        eprintln!("Error fetching PixelDrain URL: {error}");
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids() {
        assert_eq!(
            extract_id("https://pixeldrain.com/u/AbC123").unwrap(),
            "AbC123"
        );
        assert_eq!(
            extract_id("https://pixeldrain.com/u/AbC123?embed").unwrap(),
            "AbC123"
        );
        assert!(extract_id("https://pixeldrain.com/l/AbC123").is_err());
        assert!(extract_id("not a url").is_err());
    }
}
