mod context;
mod resolve_path;
mod resolve_rules;
mod tokens;
mod types;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

pub use types::{ResolveSaveRulesInput, ResolvedCloudSaveRule};

#[napi]
pub fn resolve_save_rules(
    input: ResolveSaveRulesInput,
) -> napi::Result<Vec<ResolvedCloudSaveRule>> {
    let context = context::build_context(&input).map_err(Error::from_reason)?;
    Ok(resolve_rules::resolve_rules(
        input.rules,
        &context,
        &input.steam_user_ids,
    ))
}
