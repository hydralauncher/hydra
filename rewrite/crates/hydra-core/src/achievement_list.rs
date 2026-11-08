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
    &achievement.name
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
            image_url: None,
            global_unlock_percentage: percentage,
            points,
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
    fn formats_percentages() {
        assert_eq!(format_percentage(88.5, "en"), "88.5%");
        assert_eq!(format_percentage(66.0, "en"), "66%");
        assert_eq!(format_percentage(53.74, "pt-BR"), "53,7%");
        assert_eq!(format_percentage(0.05, "en"), "<0.1%");
        assert_eq!(format_percentage(0.0, "en"), "0%");
    }
}
