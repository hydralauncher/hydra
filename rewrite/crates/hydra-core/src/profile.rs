//! The user profile page's data rules and requests: context/user-profile
//! (library pages, stats, souvenirs, the hero color), pages/profile helpers
//! (sort, platform, tabs, play time), and events/profile/update-profile.ts
//! (presigned image uploads, then PATCH /profile).

use std::path::Path;

use serde_json::{Map, Value, json};

use crate::api::{ApiError, HydraApi, Options};

/// PROFILE_LIBRARY_PAGE_SIZE
pub const LIBRARY_PAGE_SIZE: usize = 48;
/// LIBRARY_REQUEST_TIMEOUT_MS
pub const LIBRARY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
/// MAX_MINUTES_TO_SHOW_IN_PLAYTIME (renderer constants.ts)
pub const MAX_MINUTES_TO_SHOW_IN_PLAYTIME: f64 = 120.0;
/// DEFAULT_USER_PROFILE_BACKGROUND
pub const DEFAULT_BACKGROUND: [u8; 4] = [0x15, 0x15, 0x15, 0xb3];
/// MAX_VISIBLE_BADGES (badges-box.tsx)
pub const MAX_VISIBLE_BADGES: usize = 4;
/// MAX_VISIBLE_FRIENDS (friends-box.tsx)
pub const MAX_VISIBLE_FRIENDS: usize = 5;
/// all-friends-modal PAGE_SIZE
pub const FRIENDS_PAGE_SIZE: usize = 20;

/// ProfilePlatformFilter, saved in localStorage "profile-platform".
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Platform {
    #[default]
    All,
    Pc,
    Classics,
}

impl Platform {
    /// readStoredProfilePlatform
    pub fn parse(value: Option<&str>) -> Self {
        match value {
            Some("pc") => Platform::Pc,
            Some("classics") => Platform::Classics,
            _ => Platform::All,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Platform::All => "all",
            Platform::Pc => "pc",
            Platform::Classics => "classics",
        }
    }

    /// getProfileLibraryFilter(platform).shops
    pub fn shops(self) -> &'static [&'static str] {
        match self {
            Platform::Classics => &["launchbox"],
            Platform::Pc => &["steam", "epic"],
            Platform::All => &["steam", "epic", "launchbox"],
        }
    }
}

/// ProfileSortOption, saved in localStorage "profile-sort-by".
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Sort {
    Playtime,
    AchievementCount,
    #[default]
    PlayedRecently,
}

impl Sort {
    /// readStoredProfileSort
    pub fn parse(value: Option<&str>) -> Self {
        match value {
            Some("playtime") => Sort::Playtime,
            Some("achievementCount") => Sort::AchievementCount,
            _ => Sort::PlayedRecently,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Sort::Playtime => "playtime",
            Sort::AchievementCount => "achievementCount",
            Sort::PlayedRecently => "playedRecently",
        }
    }

    /// effectiveSortBy: achievement sorting needs the profile's subscription.
    pub fn effective(self, has_active_subscription: bool) -> Self {
        if !has_active_subscription && self == Sort::AchievementCount {
            Sort::PlayedRecently
        } else {
            self
        }
    }
}

/// The souvenir sort (localStorage "profile-souvenir-sort-by").
pub fn souvenir_sort(value: Option<&str>) -> &'static str {
    match value {
        Some("oldest") => "oldest",
        Some("rare") => "rare",
        _ => "recent",
    }
}

/// `/users/{id}/library` query: take, skip, the platform's shops, sortBy.
pub fn library_query(
    skip: usize,
    platform: Platform,
    sort: Option<Sort>,
) -> Vec<(&'static str, String)> {
    let mut query = vec![
        ("take", LIBRARY_PAGE_SIZE.to_string()),
        ("skip", skip.to_string()),
    ];
    query.extend(
        platform
            .shops()
            .iter()
            .map(|shop| ("shop", shop.to_string())),
    );
    if let Some(sort) = sort {
        query.push(("sortBy", sort.as_str().to_string()));
    }
    query
}

/// `/users/{id}/stats` query: the platform's shops.
pub fn stats_query(platform: Platform) -> Vec<(&'static str, String)> {
    platform
        .shops()
        .iter()
        .map(|shop| ("shop", shop.to_string()))
        .collect()
}

/// fetchLibraryPage: the request, retried once when it fails.
pub fn fetch_library_page(
    api: &HydraApi,
    user_id: &str,
    skip: usize,
    platform: Platform,
    sort: Option<Sort>,
) -> Result<(Vec<Value>, Vec<Value>), ApiError> {
    let path = format!("/users/{user_id}/library");
    let query = library_query(skip, platform, sort);
    let options = Options {
        needs_auth: false,
        timeout: Some(LIBRARY_TIMEOUT),
    };
    let response = api
        .get(&path, &query, options)
        .or_else(|_| api.get(&path, &query, options))?;
    let list = |key: &str| {
        response
            .get(key)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    Ok((list("library"), list("pinnedGames")))
}

/// The profile's tabs (ProfileTabType).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Tab {
    #[default]
    Library,
    Reviews,
    Souvenirs,
    Screenshots,
    Missions,
}

impl Tab {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "library" => Tab::Library,
            "reviews" => Tab::Reviews,
            "souvenirs" => Tab::Souvenirs,
            "screenshots" => Tab::Screenshots,
            "missions" => Tab::Missions,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Tab::Library => "library",
            Tab::Reviews => "reviews",
            Tab::Souvenirs => "souvenirs",
            Tab::Screenshots => "screenshots",
            Tab::Missions => "missions",
        }
    }
}

/// getRequestedProfileTab: `?tab=`, `?screenshot=` and what is enabled.
pub fn requested_tab(
    requested: Option<&str>,
    has_requested_screenshot: bool,
    screenshots_enabled: bool,
    can_show_missions: bool,
) -> Tab {
    if requested == Some("souvenirs") {
        return Tab::Souvenirs;
    }
    if screenshots_enabled && (requested == Some("screenshots") || has_requested_screenshot) {
        return Tab::Screenshots;
    }
    if requested == Some("missions") && can_show_missions {
        return Tab::Missions;
    }
    Tab::Library
}

/// The profile is locked for others: PRIVATE, or FRIENDS without a friendship.
pub fn is_locked(profile: &Value, is_me: bool) -> bool {
    if is_me {
        return false;
    }
    let visibility = profile
        .get("profileVisibility")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let friends = profile
        .get("relation")
        .and_then(|r| r.get("status"))
        .and_then(Value::as_str)
        == Some("ACCEPTED");
    visibility == "PRIVATE" || (visibility == "FRIENDS" && !friends)
}

/// Which buttons the hero panel shows (profileActions).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Relation {
    /// The signed-in user's own profile: edit, sign out.
    Me,
    /// No relation: add friend, block.
    None,
    /// Friends: undo friendship, block.
    Friends,
    /// A request the signed-in user sent: cancel.
    Sent,
    /// A request the signed-in user received: accept, ignore.
    Received,
}

pub fn relation(profile: &Value, is_me: bool) -> Relation {
    if is_me {
        return Relation::Me;
    }
    let Some(relation) = profile.get("relation").filter(|r| !r.is_null()) else {
        return Relation::None;
    };
    if relation.get("status").and_then(Value::as_str) == Some("ACCEPTED") {
        return Relation::Friends;
    }
    let id = profile.get("id").and_then(Value::as_str);
    if relation.get("BId").and_then(Value::as_str) == id {
        Relation::Sent
    } else {
        Relation::Received
    }
}

/// The play time line: minutes under two hours, else hours. `format_number`
/// is the renderer's `numberFormatter` (Intl.NumberFormat, no fractions).
/// Returns the i18n key and the amount.
pub fn play_time(
    seconds: f64,
    short: bool,
    format_number: impl Fn(f64) -> String,
) -> (&'static str, String) {
    let minutes = seconds / 60.0;
    if minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME {
        let key = if short {
            "amount_minutes_short"
        } else {
            "amount_minutes"
        };
        return (key, to_fixed(minutes, 0));
    }
    let hours = minutes / 60.0;
    if short {
        ("amount_hours_short", (hours.floor() as i64).to_string())
    } else {
        ("amount_hours", format_number(hours.round()))
    }
}

/// `Number.prototype.toFixed(digits)`.
pub fn to_fixed(value: f64, digits: usize) -> String {
    let factor = 10f64.powi(digits as i32);
    let rounded = (value * factor).round() / factor;
    format!("{rounded:.digits$}")
}

/// formatAchievementPoints (user-library-game-card.tsx)
pub fn achievement_points(points: f64, format_number: impl Fn(f64) -> String) -> String {
    if points < 100_000.0 {
        return format_number(points.round());
    }
    if points < 1_000_000.0 {
        return format!("{}K", to_fixed(points / 1000.0, 1));
    }
    format!("{}M", to_fixed(points / 1_000_000.0, 1))
}

/// isGameCompleted
pub fn is_completed(achievements: i64, unlocked: i64) -> bool {
    achievements > 0 && unlocked >= achievements
}

/// color.js `average(url, { amount: 1 })`: every 10th pixel (sample 10) of the
/// RGBA data, divided by length / 40 like the library does.
pub fn average_color(rgba: &[u8]) -> [u8; 3] {
    if rgba.len() < 4 {
        return [0, 0, 0];
    }
    let step = 4 * 10;
    let count = rgba.len() as f64 / step as f64;
    let (mut r, mut g, mut b) = (0f64, 0f64, 0f64);
    let mut i = 0;
    while i + 2 < rgba.len() {
        r += rgba[i] as f64;
        g += rgba[i + 1] as f64;
        b += rgba[i + 2] as f64;
        i += step;
    }
    let channel = |sum: f64| (sum / count).round().clamp(0.0, 255.0) as u8;
    [channel(r), channel(g), channel(b)]
}

/// `new Color(rgb).darken(amount)`: HSL lightness times (1 - amount), back
/// to RGB rounded like color-string.
pub fn darken(rgb: [u8; 3], amount: f64) -> [u8; 3] {
    let (h, s, l) = rgb_to_hsl(rgb);
    // Color#string() rounds the hsl() values to one decimal.
    let one = |v: f64| (v * 10.0).round() / 10.0;
    hsl_to_rgb(one(h), one(s), one(l - l * amount))
}

/// getHeroBackgroundFromImageUrl: linear-gradient(135deg, darken 0.5, darken 0.6 at 50% alpha).
pub fn hero_gradient(average: [u8; 3]) -> ([u8; 4], [u8; 4]) {
    let [r1, g1, b1] = darken(average, 0.5);
    let [r2, g2, b2] = darken(average, 0.6);
    ([r1, g1, b1, 255], [r2, g2, b2, 128])
}

// color-convert's rgb.hsl / hsl.rgb (h in degrees, s and l in percent).
fn rgb_to_hsl([r, g, b]: [u8; 3]) -> (f64, f64, f64) {
    let (r, g, b) = (r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0);
    let min = r.min(g).min(b);
    let max = r.max(g).max(b);
    let delta = max - min;
    let mut h = if max == min {
        0.0
    } else if r == max {
        (g - b) / delta
    } else if g == max {
        2.0 + (b - r) / delta
    } else {
        4.0 + (r - g) / delta
    };
    h = (h * 60.0).min(360.0);
    if h < 0.0 {
        h += 360.0;
    }
    let l = (min + max) / 2.0;
    let s = if max == min {
        0.0
    } else if l <= 0.5 {
        delta / (max + min)
    } else {
        delta / (2.0 - max - min)
    };
    (h, s * 100.0, l * 100.0)
}

fn hsl_to_rgb(h: f64, s: f64, l: f64) -> [u8; 3] {
    let (h, s, l) = (h / 360.0, s / 100.0, l / 100.0);
    if s == 0.0 {
        let v = (l * 255.0).round().clamp(0.0, 255.0) as u8;
        return [v, v, v];
    }
    let t2 = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let t1 = 2.0 * l - t2;
    let mut rgb = [0u8; 3];
    for (i, channel) in rgb.iter_mut().enumerate() {
        let mut t3 = h + 1.0 / 3.0 * -(i as f64 - 1.0);
        if t3 < 0.0 {
            t3 += 1.0;
        }
        if t3 > 1.0 {
            t3 -= 1.0;
        }
        let value = if 6.0 * t3 < 1.0 {
            t1 + (t2 - t1) * 6.0 * t3
        } else if 2.0 * t3 < 1.0 {
            t2
        } else if 3.0 * t3 < 2.0 {
            t1 + (t2 - t1) * (2.0 / 3.0 - t3) * 6.0
        } else {
            t1
        };
        *channel = (value * 255.0).round().clamp(0.0, 255.0) as u8;
    }
    rgb
}

/// The friend code field: trimmed, at most 8 characters.
pub fn friend_code(input: &str) -> String {
    input.trim().chars().take(8).collect()
}

/// edit-profile-modal's yup schema for the display name, as the i18n key of
/// the error (or None when valid).
pub fn display_name_error(name: &str) -> Option<&'static str> {
    let length = name.chars().count();
    if name.is_empty() {
        Some("required_field")
    } else if length < 3 {
        Some("displayname_min_length")
    } else if length > 50 {
        Some("displayname_max_length")
    } else {
        None
    }
}

/// report-profile's schema for the description.
pub const MAX_REPORT_DESCRIPTION_LENGTH: usize = 255;

/// UpdateProfileRequest's image fields: unchanged, removed, or a new file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ImageChange {
    Keep,
    Remove,
    Upload(std::path::PathBuf),
}

/// The file's MIME type from its first bytes (fileTypeFromFile for images).
pub fn sniff_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        // file-type reports animated PNGs (an acTL chunk before IDAT) as APNG.
        return Some(
            if crate::profile_image::png_is_animated(bytes) == Some(true) {
                "image/apng"
            } else {
                "image/png"
            },
        );
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF8") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

/// update-profile.ts uploadImage: POST /presigned-urls/{type} with the
/// extension and size, PUT the bytes there, and return the stored URL.
fn upload_image(
    api: &HydraApi,
    http: &reqwest::blocking::Client,
    kind: &str,
    path: &Path,
) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_string();
    let response = api
        .post(
            &format!("/presigned-urls/{kind}"),
            &json!({ "imageExt": extension, "imageLength": bytes.len() }),
            Options::default(),
        )
        .ok()?;
    let presigned = response.get("presignedUrl").and_then(Value::as_str)?;
    let mut request = http.put(presigned).body(bytes.clone());
    if let Some(mime) = sniff_mime(&bytes) {
        request = request.header("Content-Type", mime);
    }
    let status = request.send().ok()?.status();
    if !status.is_success() {
        return None;
    }
    let field = if kind == "background-image" {
        "backgroundImageUrl"
    } else {
        "profileImageUrl"
    };
    response
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// updateProfile: the other fields as given, images uploaded first (a failed
/// upload sends `undefined`, which leaves the image as it was), then
/// PATCH /profile. Returns the updated profile.
pub fn update_profile(
    api: &HydraApi,
    http: &reqwest::blocking::Client,
    fields: Map<String, Value>,
    profile_image: ImageChange,
    background_image: ImageChange,
) -> Result<Value, ApiError> {
    let mut payload = fields;
    for (change, kind, field) in [
        (profile_image, "profile-image", "profileImageUrl"),
        (background_image, "background-image", "backgroundImageUrl"),
    ] {
        match change {
            ImageChange::Keep => {}
            ImageChange::Remove => {
                payload.insert(field.into(), Value::Null);
            }
            ImageChange::Upload(path) => {
                if let Some(url) = upload_image(api, http, kind, &path) {
                    payload.insert(field.into(), Value::String(url));
                }
            }
        }
    }
    api.patch("/profile", &Value::Object(payload), Options::default())
}

/// useUserDetails.patchUser: the cached userDetails after an update keeps
/// the fields PATCH /profile doesn't return.
pub fn merge_user_details(previous: Option<&Value>, response: &Value) -> Value {
    let mut user = response.clone();
    let field = |key: &str| previous.and_then(|p| p.get(key)).cloned();
    if let Some(map) = user.as_object_mut() {
        map.insert(
            "username".into(),
            field("username").unwrap_or_else(|| Value::String(String::new())),
        );
        map.insert(
            "subscription".into(),
            field("subscription").unwrap_or(Value::Null),
        );
        map.insert(
            "workwondersJwt".into(),
            field("workwondersJwt").unwrap_or_else(|| Value::String(String::new())),
        );
        map.insert(
            "karma".into(),
            field("karma").unwrap_or_else(|| Value::from(0)),
        );
        let gifts = response
            .get("allowCloudGifts")
            .filter(|v| !v.is_null())
            .cloned()
            .or_else(|| field("allowCloudGifts").filter(|v| !v.is_null()))
            .unwrap_or(Value::Bool(true));
        map.insert("allowCloudGifts".into(), gifts);
    }
    user
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fmt(n: f64) -> String {
        // en Intl.NumberFormat with grouping
        let s = format!("{}", n as i64);
        let mut out = String::new();
        for (i, c) in s.chars().rev().enumerate() {
            if i > 0 && i % 3 == 0 {
                out.push(',');
            }
            out.push(c);
        }
        out.chars().rev().collect()
    }

    #[test]
    fn sort_and_platform_round_trip() {
        assert_eq!(Sort::parse(Some("playtime")), Sort::Playtime);
        assert_eq!(Sort::parse(Some("bogus")), Sort::PlayedRecently);
        assert_eq!(Sort::parse(None), Sort::PlayedRecently);
        assert_eq!(
            Sort::AchievementCount.effective(false),
            Sort::PlayedRecently
        );
        assert_eq!(
            Sort::AchievementCount.effective(true),
            Sort::AchievementCount
        );
        assert_eq!(Platform::parse(Some("classics")).shops(), &["launchbox"]);
        assert_eq!(Platform::parse(Some("x")), Platform::All);
        assert_eq!(souvenir_sort(Some("rare")), "rare");
        assert_eq!(souvenir_sort(Some("x")), "recent");
    }

    #[test]
    fn library_query_matches_the_renderer() {
        let q = library_query(48, Platform::Pc, Some(Sort::Playtime));
        let pairs: Vec<(&str, &str)> = q.iter().map(|(k, v)| (*k, v.as_str())).collect();
        assert_eq!(
            pairs,
            vec![
                ("take", "48"),
                ("skip", "48"),
                ("shop", "steam"),
                ("shop", "epic"),
                ("sortBy", "playtime")
            ]
        );
    }

    #[test]
    fn requested_tabs() {
        assert_eq!(
            requested_tab(Some("souvenirs"), false, false, false),
            Tab::Souvenirs
        );
        assert_eq!(
            requested_tab(Some("screenshots"), false, false, false),
            Tab::Library
        );
        assert_eq!(requested_tab(None, true, true, false), Tab::Screenshots);
        assert_eq!(
            requested_tab(Some("missions"), false, true, false),
            Tab::Library
        );
        assert_eq!(
            requested_tab(Some("missions"), false, true, true),
            Tab::Missions
        );
    }

    #[test]
    fn locks_and_relations() {
        let private = json!({ "id": "a", "profileVisibility": "PRIVATE", "relation": null });
        assert!(is_locked(&private, false));
        assert!(!is_locked(&private, true));
        let friends_only = json!({ "id": "a", "profileVisibility": "FRIENDS", "relation": { "status": "ACCEPTED", "AId": "b", "BId": "a" } });
        assert!(!is_locked(&friends_only, false));
        assert_eq!(relation(&friends_only, false), Relation::Friends);
        let sent =
            json!({ "id": "a", "relation": { "status": "PENDING", "AId": "me", "BId": "a" } });
        assert_eq!(relation(&sent, false), Relation::Sent);
        let received =
            json!({ "id": "a", "relation": { "status": "PENDING", "AId": "a", "BId": "me" } });
        assert_eq!(relation(&received, false), Relation::Received);
        assert_eq!(
            relation(&json!({ "id": "a", "relation": null }), false),
            Relation::None
        );
    }

    #[test]
    fn play_time_and_points() {
        assert_eq!(play_time(0.0, false, fmt), ("amount_minutes", "0".into()));
        assert_eq!(play_time(7334.0, false, fmt), ("amount_hours", "2".into()));
        assert_eq!(
            play_time(7334.0, true, fmt),
            ("amount_hours_short", "2".into())
        );
        assert_eq!(
            play_time(90.0, true, fmt),
            ("amount_minutes_short", "2".into())
        );
        assert_eq!(
            play_time(20619650.0, false, fmt),
            ("amount_hours", "5,728".into())
        );
        assert_eq!(achievement_points(1234.0, fmt), "1,234");
        assert_eq!(achievement_points(123_456.0, fmt), "123.5K");
        assert_eq!(achievement_points(1_138_110.0, fmt), "1.1M");
        assert!(is_completed(10, 10));
        assert!(!is_completed(0, 0));
    }

    #[test]
    fn hero_colors_match_color_js() {
        // new Color("#808080").darken(0.5) -> rgb(64, 64, 64)
        assert_eq!(darken([128, 128, 128], 0.5), [64, 64, 64]);
        // new Color("#ff0000").darken(0.5) -> rgb(128, 0, 0)
        assert_eq!(darken([255, 0, 0], 0.5), [128, 0, 0]);
        // new Color("#3366cc").darken(0.6) -> hsl(220, 60%, 20%) -> rgb(20, 41, 82)
        assert_eq!(darken([0x33, 0x66, 0xcc], 0.6), [20, 41, 82]);
        let pixels = [10u8, 20, 30, 255].repeat(20);
        assert_eq!(average_color(&pixels), [10, 20, 30]);
    }

    #[test]
    fn friend_codes_and_names() {
        assert_eq!(friend_code("  abcdefghij "), "abcdefgh");
        assert_eq!(display_name_error("ab"), Some("displayname_min_length"));
        assert_eq!(display_name_error(""), Some("required_field"));
        assert_eq!(display_name_error("abc"), None);
        assert_eq!(
            display_name_error(&"x".repeat(51)),
            Some("displayname_max_length")
        );
    }

    #[test]
    fn merges_user_details_like_patch_user() {
        let previous = json!({ "username": "u", "karma": 61, "subscription": { "expiresAt": "x" }, "allowCloudGifts": false });
        let merged = merge_user_details(Some(&previous), &json!({ "id": "a", "displayName": "B" }));
        assert_eq!(merged["username"], "u");
        assert_eq!(merged["karma"], 61);
        assert_eq!(merged["allowCloudGifts"], false);
        assert_eq!(merged["subscription"]["expiresAt"], "x");
    }

    #[test]
    fn sniffs_image_types() {
        assert_eq!(sniff_mime(&[0xff, 0xd8, 0xff, 0xe0]), Some("image/jpeg"));
        assert_eq!(sniff_mime(b"GIF89a...."), Some("image/gif"));
        assert_eq!(sniff_mime(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff_mime(b"hello"), None);
    }
}
