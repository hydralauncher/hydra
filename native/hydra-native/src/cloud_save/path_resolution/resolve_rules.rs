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
            let resolved_paths = resolved
                .candidates
                .iter()
                .map(|candidate| candidate.path.clone())
                .collect();
            let resolved_path_case_sensitive = resolved
                .candidates
                .iter()
                .map(|candidate| candidate.case_sensitive)
                .collect();
            let resolved_path_dynamic = resolved
                .candidates
                .iter()
                .map(|candidate| candidate.has_dynamic_root)
                .collect();
            let resolved_path_scan_roots = resolved
                .candidates
                .iter()
                .map(|candidate| candidate.scan_root.clone().unwrap_or_default())
                .collect();
            ResolvedCloudSaveRule {
                kind: rule.kind,
                raw_path: rule.raw_path,
                source: rule.source,
                tags: rule.tags,
                when: rule.when,
                resolved_paths,
                resolved_path_case_sensitive,
                resolved_path_dynamic,
                resolved_path_scan_roots,
                unresolved_tokens: resolved.unresolved_tokens,
            }
        })
        .collect()
}
