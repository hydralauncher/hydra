use super::types::{
    CloudSaveGameId, CloudSaveRule, CloudSaveRuleCondition, GameSaveRules, ManifestFileRule,
    ManifestGameEntry,
};

pub(crate) fn infer_rule_kind(raw_path: &str) -> &'static str {
    if raw_path
        .chars()
        .any(|character| matches!(character, '*' | '?' | '[' | '{' | ']'))
    {
        return "file";
    }
    if raw_path.ends_with('/') {
        return "dir";
    }
    let base_name = raw_path.rsplit('/').next().unwrap_or(raw_path);
    if base_name.contains('.') {
        "file"
    } else {
        "dir"
    }
}

fn build_rule(file: &ManifestFileRule) -> CloudSaveRule {
    CloudSaveRule {
        kind: infer_rule_kind(&file.raw_path).to_string(),
        raw_path: file.raw_path.clone(),
        source: "ludusavi".to_string(),
        tags: file.tags.clone(),
        when: file
            .when
            .iter()
            .map(|condition| CloudSaveRuleCondition {
                os: condition.os.clone(),
                store: condition.store.clone(),
            })
            .collect(),
    }
}

pub fn build_game_save_rules(
    shop: String,
    object_id: String,
    entry: Option<&ManifestGameEntry>,
) -> GameSaveRules {
    let manifest_key = entry.map(|entry| entry.manifest_key.clone());

    let rules = entry.map_or_else(Vec::new, |entry| {
        entry.files.iter().map(build_rule).collect()
    });

    GameSaveRules {
        game_id: CloudSaveGameId { shop, object_id },
        manifest_key,
        rules,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_save::manifest::cache::get_manifest_index;
    use crate::cloud_save::manifest::lookup::find_manifest_entry;
    use crate::cloud_save::manifest::source::resolve_source_url;
    use tempfile::tempdir;

    #[tokio::test]
    async fn builds_balatro_save_rules_from_real_manifest() {
        let shop = "steam";
        let object_id = "2379780";
        let title = "Balatro";

        let source_url = resolve_source_url(None);
        let cache_directory = tempdir().unwrap();

        let index = get_manifest_index(cache_directory.path(), &source_url)
            .await
            .unwrap();

        let entry = find_manifest_entry(&index, object_id, None, Some(title));

        let result = build_game_save_rules(shop.to_string(), object_id.to_string(), entry);

        println!("{result:#?}");

        assert_eq!(result.game_id.shop, shop);
        assert_eq!(result.game_id.object_id, object_id);
        assert_eq!(result.manifest_key.as_deref(), Some(object_id));
        assert!(!result.rules.is_empty());

        assert!(result.rules.iter().all(|rule| rule.source == "ludusavi"));

        assert!(result
            .rules
            .iter()
            .any(|rule| rule.tags.iter().any(|tag| tag == "save")));

        assert!(result.rules.iter().any(|rule| rule.kind == "file"));

        assert!(result.rules.iter().any(|rule| rule.kind == "dir"));

        let cyberpunk = find_manifest_entry(&index, "1091500", None, Some("Cyberpunk 2077"))
            .expect("Cyberpunk 2077 should exist in the real manifest");
        assert!(cyberpunk
            .files
            .iter()
            .any(|file| { file.raw_path == "<home>/Saved Games/CD Projekt Red/Cyberpunk 2077" }));

        let tlou = find_manifest_entry(&index, "1888930", None, Some("The Last of Us Part I"))
            .expect("The Last of Us Part I should exist in the real manifest");
        assert!(tlou.files.iter().any(|file| {
            file.raw_path == "<home>/Saved Games/The Last of Us Part I/users/<storeUserId>/savedata"
        }));
    }
}
