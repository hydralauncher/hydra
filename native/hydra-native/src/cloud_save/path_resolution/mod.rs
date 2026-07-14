mod resolve_rules;

pub(crate) mod context;
pub(crate) mod resolve_path;
pub(crate) mod types;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

pub use types::{ResolveSaveRulesInput, ResolvedCloudSaveRule};

pub(crate) fn resolve_save_rules_with_context(
    input: ResolveSaveRulesInput,
) -> Result<(Vec<ResolvedCloudSaveRule>, types::PathResolutionContext), String> {
    let context = context::build_context(&input)?;
    let rules = resolve_rules::resolve_rules(input.rules, &context);
    Ok((rules, context))
}

#[napi]
pub fn resolve_save_rules(
    input: ResolveSaveRulesInput,
) -> napi::Result<Vec<ResolvedCloudSaveRule>> {
    resolve_save_rules_with_context(input)
        .map(|(rules, _)| rules)
        .map_err(Error::from_reason)
}
