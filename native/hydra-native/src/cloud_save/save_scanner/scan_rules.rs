use crate::cloud_save::path_resolution::types::ResolvedCloudSaveRule;

use super::scan_path::scan_resolved_path;
use super::types::ScannedCloudSaveRule;

pub fn scan_rules(rules: Vec<ResolvedCloudSaveRule>) -> Result<Vec<ScannedCloudSaveRule>, String> {
    rules
        .into_iter()
        .map(|rule| {
            let scanned_paths =
                if rule.unresolved_tokens.is_empty() && !rule.resolved_paths.is_empty() {
                    rule.resolved_paths
                        .iter()
                        .map(|path| scan_resolved_path(&rule, path))
                        .collect::<Result<Vec<_>, _>>()?
                } else {
                    Vec::new()
                };

            Ok(ScannedCloudSaveRule {
                kind: rule.kind,
                raw_path: rule.raw_path,
                source: rule.source,
                tags: rule.tags,
                when: rule.when,
                resolved_paths: rule.resolved_paths,
                unresolved_tokens: rule.unresolved_tokens,
                scanned_paths,
            })
        })
        .collect()
}
