//! datanodes.ts: the Hydra API unlocks Datanodes links.

use serde_json::{Value, json};

use super::Context;
use crate::errors::{DlError, DlResult};

pub async fn download_url(ctx: &Context, uri: &str) -> DlResult<String> {
    let response = super::api_post(
        ctx,
        "/hosters/datanodes/unlock",
        json!({ "url": uri }),
        false,
    )
    .await?;
    response
        .get("link")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| DlError::msg("Failed to unlock Datanodes URL"))
}
