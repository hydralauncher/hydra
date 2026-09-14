use crate::cloud_save::manifest::types::CloudSaveRuleCondition;

use super::types::PathResolutionContext;

pub const FOREIGN_ENVIRONMENT_TOKEN: &str = "cloud_save_foreign_environment";

const WINDOWS_ONLY_TOKENS: [&str; 9] = [
    "<winAppData>",
    "%APPDATA%",
    "<winLocalAppData>",
    "%LOCALAPPDATA%",
    "<winDocuments>",
    "<winPublic>",
    "<winProgramData>",
    "<winDir>",
    "<windows>",
];
const UNIX_ONLY_TOKENS: [&str; 2] = ["<xdgData>", "<xdgConfig>"];

fn normalized_os(value: &str) -> &'static str {
    match value.to_ascii_lowercase().as_str() {
        "mac" | "macos" | "osx" => "mac",
        "windows" | "win" => "windows",
        "linux" => "linux",
        _ => "unknown",
    }
}

fn effective_os(context: &PathResolutionContext) -> &'static str {
    if context.windows_compatibility {
        "windows"
    } else {
        normalized_os(&context.platform)
    }
}

pub fn rule_is_applicable(
    conditions: &[CloudSaveRuleCondition],
    context: &PathResolutionContext,
) -> bool {
    conditions.is_empty()
        || conditions.iter().any(|condition| {
            let os_matches = condition
                .os
                .as_deref()
                .map_or(true, |os| normalized_os(os) == effective_os(context));
            let store_matches = condition
                .store
                .as_deref()
                .map_or(true, |store| store.eq_ignore_ascii_case(&context.shop));
            os_matches && store_matches
        })
}

pub fn path_is_foreign_environment(raw_path: &str, context: &PathResolutionContext) -> bool {
    let effective_os = effective_os(context);
    if effective_os == "windows" {
        UNIX_ONLY_TOKENS
            .iter()
            .any(|token| raw_path.contains(token))
    } else {
        WINDOWS_ONLY_TOKENS
            .iter()
            .any(|token| raw_path.contains(token))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(platform: &str, windows_compatibility: bool) -> PathResolutionContext {
        PathResolutionContext {
            shop: "steam".into(),
            object_id: "1".into(),
            platform: platform.into(),
            home_dir: "/home/hydra".into(),
            os_username: "hydra".into(),
            documents_dir: None,
            app_data_dir: None,
            local_app_data_dir: None,
            public_dir: None,
            program_data_dir: None,
            windows_dir: None,
            saved_games_dir: None,
            xdg_data_dir: None,
            xdg_config_dir: None,
            install_dir: None,
            wine_prefix_path: None,
            windows_compatibility,
            derived_steam_root: None,
            configured_steam_root: None,
            store_user_id: None,
        }
    }

    fn condition(os: Option<&str>, store: Option<&str>) -> CloudSaveRuleCondition {
        CloudSaveRuleCondition {
            os: os.map(str::to_string),
            store: store.map(str::to_string),
        }
    }

    #[test]
    fn applies_native_and_windows_compatibility_conditions() {
        let windows = context("windows", false);
        let linux = context("linux", false);
        let proton = context("linux", true);
        let windows_rule = [condition(Some("windows"), Some("steam"))];
        let linux_rule = [condition(Some("linux"), Some("steam"))];

        assert!(rule_is_applicable(&windows_rule, &windows));
        assert!(!rule_is_applicable(&linux_rule, &windows));
        assert!(rule_is_applicable(&linux_rule, &linux));
        assert!(!rule_is_applicable(&windows_rule, &linux));
        assert!(rule_is_applicable(&windows_rule, &proton));
        assert!(!rule_is_applicable(&linux_rule, &proton));
        assert!(rule_is_applicable(&[], &linux));

        assert!(path_is_foreign_environment("<xdgConfig>/Game", &windows));
        assert!(path_is_foreign_environment("<winAppData>/Game", &linux));
        assert!(!path_is_foreign_environment("<home>/Game", &linux));
        assert!(!path_is_foreign_environment("<winAppData>/Game", &proton));
    }

    #[test]
    fn treats_condition_entries_as_alternatives() {
        let windows = context("windows", false);
        let linux = context("linux", false);
        let proton = context("linux", true);
        let all_desktop_operating_systems = [
            condition(Some("windows"), None),
            condition(Some("mac"), None),
            condition(Some("linux"), None),
        ];
        let supported_stores = [
            condition(None, Some("steam")),
            condition(None, Some("uplay")),
        ];

        assert!(rule_is_applicable(&all_desktop_operating_systems, &windows));
        assert!(rule_is_applicable(&all_desktop_operating_systems, &linux));
        assert!(rule_is_applicable(&all_desktop_operating_systems, &proton));
        assert!(rule_is_applicable(&supported_stores, &windows));
    }

    #[test]
    fn requires_every_field_inside_one_condition() {
        let windows = context("windows", false);
        let linux = context("linux", false);
        let steam_on_windows = [condition(Some("windows"), Some("steam"))];
        let uplay_on_windows = [condition(Some("windows"), Some("uplay"))];

        assert!(rule_is_applicable(&steam_on_windows, &windows));
        assert!(!rule_is_applicable(&steam_on_windows, &linux));
        assert!(!rule_is_applicable(&uplay_on_windows, &windows));
    }
}
