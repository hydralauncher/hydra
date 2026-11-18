//! services/hosters: turn a file hoster's page link into a direct download
//! link (GoFile, PixelDrain, Datanodes, Mediafire, FuckingFast, VikingFile,
//! Rootz, FileKeeper).

pub mod datanodes;
pub mod filekeeper;
pub mod fuckingfast;
pub mod gofile;
pub mod mediafire;
pub mod pixeldrain;
pub mod rootz;
pub mod vikingfile;

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use hydra_core::api::{HydraApi, Options as ApiOptions};
use serde_json::Value;

use crate::errors::{DlError, DlResult};

/// HOSTER_USER_AGENT (fuckingfast.ts, filekeeper.ts)
pub const HOSTER_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

/// MULTIPART_HOSTER_DOWNLOADS_FEATURE
pub const MULTIPART_HOSTER_DOWNLOADS_FEATURE: &str = "MULTIPART_HOSTER_DOWNLOADS";

/// What the hosters need from the app.
#[derive(Clone)]
pub struct Context {
    pub api: Option<Arc<HydraApi>>,
    /// The app's data folder (gofile-guest-token.json lives there).
    pub user_data: PathBuf,
}

/// An async client that follows redirects, for the hosters' pages and APIs.
pub(crate) fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .build()
            .expect("hoster HTTP client")
    })
}

/// A blocking Hydra API call off the async runtime.
pub(crate) async fn api_post(
    ctx: &Context,
    path: &str,
    body: Value,
    needs_subscription: bool,
) -> DlResult<Value> {
    let api = ctx
        .api
        .clone()
        .ok_or(DlError::Api(hydra_core::api::ApiError::NotLoggedIn))?;
    let path = path.to_string();
    tokio::task::spawn_blocking(move || {
        if needs_subscription && !has_active_subscription(&api) {
            return Err(DlError::SubscriptionRequired);
        }
        api.post(&path, &body, ApiOptions::default())
            .map_err(DlError::from)
    })
    .await
    .map_err(|e| DlError::msg(e.to_string()))?
}

/// HydraApi.hasActiveSubscription, refreshed from /profile/me like
/// refreshUserSubscription when the saved one has expired.
fn has_active_subscription(api: &HydraApi) -> bool {
    let active = |user: &Value| {
        user.get("subscription")
            .and_then(|s| s.get("expiresAt"))
            .and_then(Value::as_str)
            .and_then(hydra_core::library::parse_iso_millis)
            .is_some_and(|at| at > chrono::Utc::now().timestamp_millis())
    };
    if !api.is_logged_in() {
        return false;
    }
    if let Ok(user) = api.get("/profile/me", &[], ApiOptions::default())
        && active(&user)
    {
        return true;
    }
    false
}

/// isMultipartHosterDownloadsEnabled: GET /features (10s), off on any error.
pub async fn multipart_enabled(ctx: &Context) -> bool {
    let Some(api) = ctx.api.clone() else {
        return false;
    };
    tokio::task::spawn_blocking(move || {
        match api.get(
            "/features",
            &[],
            ApiOptions {
                needs_auth: false,
                timeout: Some(Duration::from_secs(10)),
            },
        ) {
            Ok(Value::Array(features)) => features
                .iter()
                .any(|f| f.as_str() == Some(MULTIPART_HOSTER_DOWNLOADS_FEATURE)),
            Ok(_) => false,
            Err(error) => {
                eprintln!("[DownloadManager] Could not load feature flags: {error}");
                false
            }
        }
    })
    .await
    .unwrap_or(false)
}

/// assertMultipartHosterDownloadsEnabled
pub async fn assert_multipart_enabled(ctx: &Context) -> DlResult<()> {
    if multipart_enabled(ctx).await {
        Ok(())
    } else {
        Err(DlError::msg("Multi-part hoster downloads are turned off."))
    }
}
