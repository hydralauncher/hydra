use crate::cloud_save::manifest::types::CloudSaveRule;

use super::resolve_path::resolve_path;
use super::tokens::build_token_map;
use super::types::{PathResolutionContext, ResolvedCloudSaveRule};

pub fn resolve_rules(
    rules: Vec<CloudSaveRule>,
    context: &PathResolutionContext,
    steam_user_ids: &[String],
) -> Vec<ResolvedCloudSaveRule> {
    let token_map = build_token_map(context, steam_user_ids);

    rules
        .into_iter()
        .map(|rule| {
            let resolved = resolve_path(&rule.raw_path, context, &token_map);
            ResolvedCloudSaveRule {
                kind: rule.kind,
                raw_path: rule.raw_path,
                source: rule.source,
                tags: rule.tags,
                when: rule.when,
                resolved_paths: resolved.resolved_paths,
                unresolved_tokens: resolved.unresolved_tokens,
            }
        })
        .collect()
}
