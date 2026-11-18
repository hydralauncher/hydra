//! vikingfile.ts: the Hydra API unlocks VikingFile links for Hydra Cloud
//! subscribers.

use serde_json::{Value, json};

use super::Context;
use crate::errors::{DlError, DlResult};

pub async fn download_url(ctx: &Context, uri: &str) -> DlResult<String> {
    let response = super::api_post(
        ctx,
        "/hosters/vikingfile/unlock",
        json!({ "url": uri }),
        true,
    )
    .await?;
    response
        .get("link")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| DlError::msg("Failed to unlock VikingFile URL"))
}
