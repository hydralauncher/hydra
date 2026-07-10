use std::collections::HashSet;

use super::types::{PathResolutionContext, TokenMap};

fn unique_values(values: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| !value.is_empty() && seen.insert(value.clone()))
        .collect()
}

fn add_token(
    token_map: &mut TokenMap,
    token: &'static str,
    values: impl IntoIterator<Item = String>,
) {
    let values = unique_values(values);
    if !values.is_empty() {
        token_map.insert(token, values);
    }
}

fn optional_value(value: &Option<String>) -> Vec<String> {
    value.iter().cloned().collect()
}

pub fn build_token_map(context: &PathResolutionContext, steam_user_ids: &[String]) -> TokenMap {
    let mut token_map = TokenMap::new();

    add_token(
        &mut token_map,
        "<base>",
        optional_value(&context.install_dir),
    );
    add_token(&mut token_map, "<home>", [context.home_dir.clone()]);
    add_token(
        &mut token_map,
        "<storeUserId>",
        steam_user_ids.iter().cloned(),
    );
    add_token(
        &mut token_map,
        "<winAppData>",
        optional_value(&context.app_data_dir),
    );
    add_token(
        &mut token_map,
        "%APPDATA%",
        optional_value(&context.app_data_dir),
    );
    add_token(
        &mut token_map,
        "<winLocalAppData>",
        optional_value(&context.local_app_data_dir),
    );
    add_token(
        &mut token_map,
        "%LOCALAPPDATA%",
        optional_value(&context.local_app_data_dir),
    );
    add_token(
        &mut token_map,
        "<winDocuments>",
        optional_value(&context.documents_dir),
    );
    add_token(
        &mut token_map,
        "<winPublic>",
        optional_value(&context.public_dir),
    );
    add_token(
        &mut token_map,
        "<winProgramData>",
        optional_value(&context.program_data_dir),
    );

    token_map
}
