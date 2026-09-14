mod applicability;
mod candidates;
mod capture;
mod context;
mod custom;
mod resolve_path;
mod resolve_rules;
mod restore_root;
mod tokens;
mod types;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

pub(crate) use applicability::{
    path_is_foreign_environment, rule_is_applicable, FOREIGN_ENVIRONMENT_TOKEN,
};
pub(crate) use capture::{
    capture_store_user_with_components, capture_template, StoreUserCapture,
    STORE_USER_CAPTURE_MARKER,
};
pub(crate) use context::build_context;
pub(crate) use resolve_path::{glob_base_path, resolve_path};
pub(crate) use restore_root::{resolve_restore_root, target_matches_rule};
pub use types::{ResolveSaveRulesInput, ResolvedCloudSavePath, ResolvedCloudSaveRule};

#[napi]
pub fn resolve_save_rules(
    input: ResolveSaveRulesInput,
) -> napi::Result<Vec<ResolvedCloudSaveRule>> {
    let context = context::build_context(&input).map_err(Error::from_reason)?;
    Ok(resolve_rules::resolve_rules(input.rules, &context))
}
