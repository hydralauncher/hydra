use crate::cloud_save::manifest::types::CloudSaveRule;

use super::applicability::{
    path_is_foreign_environment, rule_is_applicable, FOREIGN_ENVIRONMENT_TOKEN,
};
use super::resolve_path::resolve_path;
use super::types::{PathResolutionContext, ResolvedCloudSaveRule};

pub fn resolve_rules(
    rules: Vec<CloudSaveRule>,
    context: &PathResolutionContext,
) -> Vec<ResolvedCloudSaveRule> {
    rules
        .into_iter()
        .map(|rule| {
            if !rule_is_applicable(&rule.when, context)
                || path_is_foreign_environment(&rule.raw_path, context)
            {
                return ResolvedCloudSaveRule {
                    rule_id: rule.rule_id,
                    kind: rule.kind,
                    raw_path: rule.raw_path,
                    source: rule.source,
                    tags: rule.tags,
                    when: rule.when,
                    resolved_paths: vec![],
                    unresolved_tokens: vec![FOREIGN_ENVIRONMENT_TOKEN.to_string()],
                };
            }
            let mut resolved = resolve_path(&rule.raw_path, context);
            if rule.raw_path.starts_with("<custom>") {
                if let Some(preferred_path) = &rule.preferred_path {
                    resolved.paths = vec![super::types::ResolvedCloudSavePath {
                        path: preferred_path.replace('\\', "/"),
                        case_sensitive: context.platform == "linux"
                            && !context.windows_compatibility,
                        dynamic: false,
                        scan_root: None,
                    }];
                    resolved.unresolved_tokens.clear();
                }
            }
            ResolvedCloudSaveRule {
                rule_id: rule.rule_id,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_save::manifest::types::CloudSaveRuleCondition;
    use crate::cloud_save::path_resolution::context::build_context;
    use crate::cloud_save::path_resolution::types::ResolveSaveRulesInput;

    fn rule(raw_path: &str, os: Option<&str>) -> CloudSaveRule {
        CloudSaveRule {
            rule_id: raw_path.into(),
            kind: "dir".into(),
            raw_path: raw_path.into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: os
                .map(|os| CloudSaveRuleCondition {
                    os: Some(os.into()),
                    store: None,
                })
                .into_iter()
                .collect(),
            preferred_path: None,
        }
    }

    #[test]
    fn a_locally_bound_custom_rule_uses_only_its_approved_path() {
        let context = build_context(&ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "1".into(),
            platform: "linux".into(),
            home_dir: "/home/hydra".into(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: Some("/games/game.exe".into()),
            wine_prefix_path: Some("/prefix".into()),
            steam_path: None,
            rules: Vec::new(),
        })
        .unwrap();
        let result = resolve_rules(
            vec![CloudSaveRule {
                rule_id: "custom".into(),
                kind: "dir".into(),
                raw_path: "<custom><windows><winDocuments>/Game".into(),
                source: "custom".into(),
                tags: vec!["save".into()],
                when: Vec::<CloudSaveRuleCondition>::new(),
                preferred_path: Some("/prefix/drive_c/users/player-two/Documents/Game".into()),
            }],
            &context,
        );

        assert_eq!(result[0].resolved_paths.len(), 1);
        assert_eq!(
            result[0].resolved_paths[0].path,
            "/prefix/drive_c/users/player-two/Documents/Game"
        );
        assert!(result[0].unresolved_tokens.is_empty());
    }

    #[test]
    fn separates_native_windows_and_linux_rules() {
        let windows = build_context(&ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "1030300".into(),
            platform: "windows".into(),
            home_dir: "C:/Users/Hydra".into(),
            documents_dir: Some("C:/Users/Hydra/Documents".into()),
            app_data_dir: Some("C:/Users/Hydra/AppData/Roaming".into()),
            executable_path: Some("C:/Games/Silksong/game.exe".into()),
            wine_prefix_path: None,
            steam_path: None,
            rules: Vec::new(),
        })
        .unwrap();
        let result = resolve_rules(
            vec![
                rule(
                    "<winAppData>/Team Cherry/Hollow Knight Silksong",
                    Some("windows"),
                ),
                rule(
                    "<xdgConfig>/Team Cherry/Hollow Knight Silksong",
                    Some("linux"),
                ),
            ],
            &windows,
        );

        assert!(!result[0].resolved_paths.is_empty());
        assert!(result[0].unresolved_tokens.is_empty());
        assert!(result[1].resolved_paths.is_empty());
        assert_eq!(result[1].unresolved_tokens, vec![FOREIGN_ENVIRONMENT_TOKEN]);
    }
}
