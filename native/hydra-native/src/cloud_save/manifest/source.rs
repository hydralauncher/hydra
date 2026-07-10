pub const DEFAULT_CLOUD_SAVE_MANIFEST_URL: &str = "https://cdn.losbroxas.org/manifest.yaml";

pub fn resolve_source_url(configured_url: Option<String>) -> String {
    configured_url
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| DEFAULT_CLOUD_SAVE_MANIFEST_URL.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_configured_url() {
        let configured_url = Some(
            "https://example.com/manifest.yaml".to_string(),
        );

        let result = resolve_source_url(configured_url);

        println!("resolved url: {result}");

        assert_eq!(
            result,
            "https://example.com/manifest.yaml"
        );
    }

    #[test]
    fn uses_default_when_url_is_none() {
        let result = resolve_source_url(None);

        println!("resolved default url: {result}");

        assert_eq!(
            result,
            DEFAULT_CLOUD_SAVE_MANIFEST_URL
        );
    }
}
