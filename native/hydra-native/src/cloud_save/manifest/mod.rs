mod cache;
mod indexer;
mod lookup;
mod source;

pub(crate) mod rules;
pub(crate) mod types;

use std::path::Path;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

pub use types::{GameSaveRules, GetSaveRulesForGameInput};

#[napi]
pub async fn get_save_rules_for_game(
    input: GetSaveRulesForGameInput,
) -> napi::Result<GameSaveRules> {
    let source_url = source::resolve_source_url(input.source_url);
    let index = cache::get_manifest_index(Path::new(&input.user_data_path), &source_url)
        .await
        .map_err(|error| Error::from_reason(format!("{error:#}")))?;
    let entry = lookup::find_manifest_entry(
        &index,
        &input.object_id,
        input.remote_id.as_deref(),
        input.title.as_deref(),
    );

    Ok(rules::build_game_save_rules(
        input.shop,
        input.object_id,
        entry,
    ))
}
