//! shared/achievement-list.ts: the achievements page's search, status filter,
//! sorting and number formatting.

use crate::achievements::Achievement;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sort {
    MostCommon,
    MostRare,
    RecentlyUnlocked,
}

impl Sort {
    pub fn parse(value: &str) -> Self {
        match value {
            "most_rare" => Sort::MostRare,
            "recently_unlocked" => Sort::RecentlyUnlocked,
            _ => Sort::MostCommon,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    All,
    Unlocked,
    Locked,
}

impl Status {
    pub fn parse(value: &str) -> Self {
        match value {
            "unlocked" => Status::Unlocked,
            "locked" => Status::Locked,
            _ => Status::All,
        }
    }
}

/// getAchievementKey
pub fn key(achievement: &Achievement) -> &str {
    achievement
        .canonical_id
        .as_deref()
        .unwrap_or(&achievement.name)
}

/// isAchievementConcealed
pub fn is_concealed(achievement: &Achievement, show_hidden: bool) -> bool {
    achievement.hidden && !achievement.unlocked && !show_hidden
}

/// getAchievementStatusCounts: (all, unlocked, locked)
pub fn status_counts(achievements: &[Achievement]) -> (usize, usize, usize) {
    let unlocked = achievements.iter().filter(|a| a.unlocked).count();
    (achievements.len(), unlocked, achievements.len() - unlocked)
}

/// normalizeSearchText: NFD minus diacritics, lowercased.
fn normalize(text: &str) -> String {
    crate::library::search_key(text)
}

fn rarity_score(a: &Achievement) -> Option<f64> {
    a.global_unlock_percentage.map(|p| 100.0 - p)
}

fn points_score(a: &Achievement) -> Option<f64> {
    a.points.map(|p| p as f64)
}

fn compare_scores(a: Option<f64>, b: Option<f64>, sort: Sort) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    match (a, b) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(a), Some(b)) => {
            let (x, y) = if sort == Sort::MostRare {
                (b, a)
            } else {
                (a, b)
            };
            x.partial_cmp(&y).unwrap_or(Ordering::Equal)
        }
    }
}

/// filterAndSortAchievements: indices into `achievements`, in display order.
/// `concealed` says whether a row shows as "Hidden achievement" (it then
/// never matches a search).
pub fn filter_and_sort(
    achievements: &[Achievement],
    search: &str,
    status: Status,
    sort: Sort,
    concealed: impl Fn(&Achievement) -> bool,
) -> Vec<usize> {
    let needle = normalize(search.trim());
    // getAchievementRarityScorer: percentages when any row has one, else points
    let score: fn(&Achievement) -> Option<f64> = if achievements
        .iter()
        .any(|a| a.global_unlock_percentage.is_some())
    {
        rarity_score
    } else {
        points_score
    };
    let by_rarity = |a: &Achievement, b: &Achievement, sort: Sort| {
        compare_scores(score(a), score(b), sort)
            .then_with(|| compare_scores(points_score(a), points_score(b), sort))
    };
    let mut visible: Vec<usize> = (0..achievements.len())
        .filter(|&i| {
            let a = &achievements[i];
            let status_ok = match status {
                Status::All => true,
                Status::Unlocked => a.unlocked,
                Status::Locked => !a.unlocked,
            };
            let search_ok = needle.is_empty()
                || (!concealed(a)
                    && (normalize(&a.display_name).contains(&needle)
                        || normalize(&a.description).contains(&needle)));
            status_ok && search_ok
        })
        .collect();
    // Array.prototype.sort is stable, so is sort_by
    visible.sort_by(|&i, &j| {
        let (a, b) = (&achievements[i], &achievements[j]);
        if sort == Sort::RecentlyUnlocked {
            if a.unlocked != b.unlocked {
                return if a.unlocked {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Greater
                };
            }
            if !a.unlocked {
                return by_rarity(a, b, Sort::MostCommon);
            }
            return b.unlock_time.unwrap_or(0).cmp(&a.unlock_time.unwrap_or(0));
        }
        by_rarity(a, b, sort)
    });
    visible
}

// ---- achievement sets ---------------------------------------------------

const NO_SET_KEY: &str = "none";

/// getAchievementSetKey
pub fn set_key(achievement: &Achievement) -> String {
    achievement
        .set
        .as_ref()
        .map_or_else(|| NO_SET_KEY.to_string(), |s| s.id.to_string())
}

/// AchievementSetGroup: indices into the full list.
#[derive(Clone, Debug, PartialEq)]
pub struct SetGroup {
    pub key: String,
    pub set: Option<crate::achievements::AchievementSet>,
    pub members: Vec<usize>,
}

/// groupAchievementsBySet: None unless there are at least two sets; sets by
/// order then id, achievements without a set last.
pub fn group_by_set(achievements: &[Achievement]) -> Option<Vec<SetGroup>> {
    let mut groups: Vec<SetGroup> = Vec::new();
    for (index, achievement) in achievements.iter().enumerate() {
        let key = set_key(achievement);
        match groups.iter_mut().find(|g| g.key == key) {
            Some(group) => group.members.push(index),
            None => groups.push(SetGroup {
                key,
                set: achievement.set.clone(),
                members: vec![index],
            }),
        }
    }
    let without_set = groups
        .iter()
        .position(|g| g.set.is_none())
        .map(|i| groups.remove(i));
    if groups.len() < 2 {
        return None;
    }
    groups.sort_by(|a, b| {
        let (a, b) = (a.set.as_ref().unwrap(), b.set.as_ref().unwrap());
        a.order.cmp(&b.order).then(a.id.cmp(&b.id))
    });
    groups.extend(without_set);
    Some(groups)
}

/// VisibleAchievementSetGroup
#[derive(Clone, Debug, PartialEq)]
pub struct VisibleSet {
    pub key: String,
    pub set: Option<crate::achievements::AchievementSet>,
    pub total: usize,
    pub unlocked: usize,
    /// visible achievements of this set, in display order
    pub visible: Vec<usize>,
}

/// getVisibleSetGroups: each set with its visible achievements (empty sets dropped).
/// `unlocked` says whether an achievement counts as unlocked for the progress.
pub fn visible_sets(
    groups: &[SetGroup],
    visible: &[usize],
    achievements: &[Achievement],
    unlocked: impl Fn(&Achievement) -> bool,
) -> Vec<VisibleSet> {
    groups
        .iter()
        .map(|group| VisibleSet {
            key: group.key.clone(),
            set: group.set.clone(),
            total: group.members.len(),
            unlocked: group
                .members
                .iter()
                .filter(|&&i| unlocked(&achievements[i]))
                .count(),
            visible: visible
                .iter()
                .copied()
                .filter(|&i| set_key(&achievements[i]) == group.key)
                .collect(),
        })
        .filter(|g| !g.visible.is_empty())
        .collect()
}

/// AchievementListEntry: a set header (index into the visible sets) or an achievement.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Entry {
    Set { set: usize, expanded: bool },
    Achievement(usize),
}

/// buildAchievementListEntries: headers followed by their achievements unless collapsed.
pub fn list_entries(
    sets: Option<&[VisibleSet]>,
    visible: &[usize],
    collapsed: &std::collections::HashSet<String>,
) -> Vec<Entry> {
    let Some(sets) = sets else {
        return visible.iter().map(|&i| Entry::Achievement(i)).collect();
    };
    let mut entries = Vec::new();
    for (index, set) in sets.iter().enumerate() {
        let expanded = !collapsed.contains(&set.key);
        entries.push(Entry::Set {
            set: index,
            expanded,
        });
        if expanded {
            entries.extend(set.visible.iter().map(|&i| Entry::Achievement(i)));
        }
    }
    entries
}

/// Intl.NumberFormat decimal separators for the app's languages.
fn decimal_comma(language: &str) -> bool {
    let base = language
        .split(['-', '_'])
        .next()
        .unwrap_or("en")
        .to_lowercase();
    matches!(
        base.as_str(),
        "pt" | "es"
            | "fr"
            | "de"
            | "it"
            | "ru"
            | "pl"
            | "tr"
            | "hu"
            | "uk"
            | "cs"
            | "da"
            | "nb"
            | "sv"
            | "fi"
            | "nl"
            | "ro"
            | "be"
            | "kk"
            | "bg"
            | "id"
            | "et"
            | "ca"
            | "sk"
            | "sl"
            | "hr"
            | "sr"
            | "lt"
            | "lv"
    )
}

fn format_number(value: f64, language: &str) -> String {
    let rounded = (value * 10.0).round() / 10.0;
    let text = if rounded.fract() == 0.0 {
        format!("{}", rounded as i64)
    } else {
        format!("{rounded:.1}")
    };
    if decimal_comma(language) {
        text.replace('.', ",")
    } else {
        text
    }
}

/// formatAchievementUnlockPercentage: one decimal at most, "<0.1%" for tiny shares.
pub fn format_percentage(percentage: f64, language: &str) -> String {
    if percentage > 0.0 && percentage < 0.1 {
        return format!("<{}%", format_number(0.1, language));
    }
    format!("{}%", format_number(percentage, language))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn achievement(
        name: &str,
        unlocked: bool,
        time: Option<i64>,
        percentage: Option<f64>,
        points: Option<i64>,
    ) -> Achievement {
        Achievement {
            name: name.into(),
            display_name: name.into(),
            description: format!("{name} description"),
            icon: String::new(),
            icon_gray: String::new(),
            hidden: false,
            unlocked,
            unlock_time: time,
            global_unlock_percentage: percentage,
            points,
            ..Achievement::default()
        }
    }

    #[test]
    fn sorts_like_the_renderer() {
        let list = vec![
            achievement("rare", false, None, Some(5.0), Some(90)),
            achievement("common", true, Some(10), Some(80.0), Some(10)),
            achievement("mid", true, Some(20), Some(40.0), Some(50)),
            achievement("unknown", false, None, None, None),
        ];
        let names = |idx: Vec<usize>| {
            idx.into_iter()
                .map(|i| list[i].name.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            names(filter_and_sort(
                &list,
                "",
                Status::All,
                Sort::MostCommon,
                |_| false
            )),
            ["common", "mid", "rare", "unknown"]
        );
        assert_eq!(
            names(filter_and_sort(
                &list,
                "",
                Status::All,
                Sort::MostRare,
                |_| false
            )),
            ["rare", "mid", "common", "unknown"]
        );
        assert_eq!(
            names(filter_and_sort(
                &list,
                "",
                Status::All,
                Sort::RecentlyUnlocked,
                |_| false
            )),
            ["mid", "common", "rare", "unknown"]
        );
        assert_eq!(
            names(filter_and_sort(
                &list,
                "",
                Status::Locked,
                Sort::MostCommon,
                |_| false
            )),
            ["rare", "unknown"]
        );
        assert_eq!(
            names(filter_and_sort(
                &list,
                "MID",
                Status::All,
                Sort::MostCommon,
                |_| false
            )),
            ["mid"]
        );
        assert!(filter_and_sort(&list, "mid", Status::All, Sort::MostCommon, |_| true).is_empty());
    }

    #[test]
    fn groups_sets_and_builds_entries() {
        use crate::achievements::AchievementSet;
        let set = |id: i64, order: i64| {
            Some(AchievementSet {
                id,
                name: Some(format!("Set {id}")),
                order,
            })
        };
        let mut list = vec![
            achievement("a", true, Some(1), None, None),
            achievement("b", false, None, None, None),
            achievement("c", true, Some(2), None, None),
            achievement("d", false, None, None, None),
        ];
        // one set only: no grouping
        list[0].set = set(5, 2);
        assert!(group_by_set(&list).is_none());
        list[1].set = set(5, 2);
        list[2].set = set(9, 1);
        let groups = group_by_set(&list).unwrap();
        let keys: Vec<&str> = groups.iter().map(|g| g.key.as_str()).collect();
        assert_eq!(keys, ["9", "5", "none"]);
        // "b" filtered out
        let visible = vec![2, 0, 3];
        let sets = visible_sets(&groups, &visible, &list, |a| a.unlocked);
        assert_eq!(sets.len(), 3);
        assert_eq!(
            (sets[1].total, sets[1].unlocked, sets[1].visible.clone()),
            (2, 1, vec![0])
        );
        let mut collapsed = std::collections::HashSet::new();
        collapsed.insert("5".to_string());
        assert_eq!(
            list_entries(Some(&sets), &visible, &collapsed),
            [
                Entry::Set {
                    set: 0,
                    expanded: true
                },
                Entry::Achievement(2),
                Entry::Set {
                    set: 1,
                    expanded: false
                },
                Entry::Set {
                    set: 2,
                    expanded: true
                },
                Entry::Achievement(3),
            ]
        );
        assert_eq!(
            list_entries(None, &visible, &collapsed),
            [
                Entry::Achievement(2),
                Entry::Achievement(0),
                Entry::Achievement(3)
            ]
        );
    }

    #[test]
    fn formats_percentages() {
        assert_eq!(format_percentage(88.5, "en"), "88.5%");
        assert_eq!(format_percentage(66.0, "en"), "66%");
        assert_eq!(format_percentage(53.74, "pt-BR"), "53,7%");
        assert_eq!(format_percentage(0.05, "en"), "<0.1%");
        assert_eq!(format_percentage(0.0, "en"), "0%");
    }
}
