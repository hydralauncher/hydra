use crate::cloud_save::manifest::types::CloudSaveRule;

use super::resolve_path::resolve_path;
use super::types::{PathResolutionContext, ResolvedCloudSaveRule};

pub fn resolve_rules(
    rules: Vec<CloudSaveRule>,
    context: &PathResolutionContext,
) -> Vec<ResolvedCloudSaveRule> {
    rules
        .into_iter()
        .map(|rule| {
            let resolved = resolve_path(&rule.raw_path, context);
            ResolvedCloudSaveRule {
                kind: rule.kind,
                raw_path: rule.raw_path,
                source: rule.source,
                tags: rule.tags,
                when: rule.when,
                resolved_paths: resolved.paths,
                unresolved_tokens: resolved.unresolved_tokens,
            }
        })
        .collect()
}
