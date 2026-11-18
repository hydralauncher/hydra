//! Steam store API, mirroring `getSteamAppDetails` in `src/main/services/steam.ts`.

use reqwest::blocking::Client;
use serde_json::Value;

#[derive(Debug, Clone, Default)]
pub struct Screenshot {
    pub thumbnail: String,
    pub full: String,
}

/// Progressive fallback sources (`mp4` / `webm` objects in appdetails).
#[derive(Debug, Clone, Default)]
pub struct VideoSource {
    pub max: Option<String>,
    pub sd: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Movie {
    pub id: u64,
    pub name: String,
    pub thumbnail: String,
    pub hls_h264: Option<String>,
    pub dash_h264: Option<String>,
    pub dash_av1: Option<String>,
    pub mp4: Option<VideoSource>,
    pub webm: Option<VideoSource>,
}

impl Movie {
    /// Source preference of `getSteamMovieSource` (gallery-media-sources.ts):
    /// HLS, then DASH, then progressive MP4, then WebM.
    pub fn best_source(&self) -> Option<&str> {
        self.hls_h264
            .as_deref()
            .or(self.dash_h264.as_deref())
            .or(self.dash_av1.as_deref())
            .or(self.mp4.as_ref().and_then(|s| s.max.as_deref()))
            .or(self.webm.as_ref().and_then(|s| s.max.as_deref()))
    }
}

#[derive(Debug, Clone, Default)]
pub struct Requirements {
    pub minimum: Option<String>,
    pub recommended: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControllerSupport {
    Full,
    Partial,
    None,
}

#[derive(Debug, Clone)]
pub struct AppDetails {
    pub app_id: u64,
    pub name: String,
    pub release_date: String,
    pub coming_soon: bool,
    pub developers: Vec<String>,
    pub publishers: Vec<String>,
    pub about_the_game: String,
    pub short_description: String,
    pub supported_languages: String,
    pub controller_support: ControllerSupport,
    pub pc_requirements: Requirements,
    pub screenshots: Vec<Screenshot>,
    pub movies: Vec<Movie>,
    pub genres: Vec<String>,
    pub content_descriptor_ids: Vec<u64>,
}

/// Hydra locale -> Steam language (`steamLanguageByLocale` in steam.ts).
pub fn steam_language(locale: &str) -> &'static str {
    const MAP: &[(&str, &str)] = &[
        ("ar", "arabic"),
        ("bg", "bulgarian"),
        ("cs", "czech"),
        ("da", "danish"),
        ("de", "german"),
        ("en", "english"),
        ("es", "spanish"),
        ("fi", "finnish"),
        ("fr", "french"),
        ("hu", "hungarian"),
        ("id", "indonesian"),
        ("it", "italian"),
        ("ja", "japanese"),
        ("ko", "koreana"),
        ("nb", "norwegian"),
        ("nl", "dutch"),
        ("pl", "polish"),
        ("pt-BR", "brazilian"),
        ("pt-PT", "portuguese"),
        ("ro", "romanian"),
        ("ru", "russian"),
        ("sv", "swedish"),
        ("tr", "turkish"),
        ("uk", "ukrainian"),
        ("zh-CN", "schinese"),
        ("zh-TW", "tchinese"),
        ("zh", "schinese"),
    ];
    let lookup = |key: &str| MAP.iter().find(|(k, _)| *k == key).map(|(_, v)| *v);
    lookup(locale)
        .or_else(|| lookup(locale.split('-').next().unwrap_or(locale)))
        .unwrap_or("english")
}

/// `GET store.steampowered.com/api/appdetails?appids=..&l=..&cc=us`.
/// Returns `Ok(None)` when Steam reports `success: false` (unknown/hidden app).
pub fn app_details(
    client: &Client,
    app_id: u64,
    locale: &str,
) -> Result<Option<AppDetails>, String> {
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={app_id}&l={}&cc=us",
        steam_language(locale)
    );
    let body: Value = client
        .get(&url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|e| format!("appdetails {app_id}: {e}"))?;
    Ok(parse_app_details(&body, app_id))
}

pub fn parse_app_details(body: &Value, app_id: u64) -> Option<AppDetails> {
    let entry = body.get(app_id.to_string())?;
    if entry.get("success").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let data = entry.get("data")?;
    let text = |key: &str| {
        data.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let strings = |key: &str| -> Vec<String> {
        data.get(key)
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    };
    // Steam sends `[]` instead of an object when a game has no requirements.
    let requirements = data.get("pc_requirements").filter(|v| v.is_object());
    let requirement = |key: &str| {
        requirements
            .and_then(|r| r.get(key))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let video_source = |movie: &Value, key: &str| {
        movie
            .get(key)
            .filter(|v| v.is_object())
            .map(|v| VideoSource {
                max: v.get("max").and_then(Value::as_str).map(https),
                sd: v.get("480").and_then(Value::as_str).map(https),
            })
    };

    Some(AppDetails {
        app_id,
        name: text("name"),
        release_date: data
            .pointer("/release_date/date")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        coming_soon: data
            .pointer("/release_date/coming_soon")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        developers: strings("developers"),
        publishers: strings("publishers"),
        about_the_game: text("about_the_game"),
        short_description: text("short_description"),
        supported_languages: text("supported_languages"),
        controller_support: match data.get("controller_support").and_then(Value::as_str) {
            Some("full") => ControllerSupport::Full,
            Some("partial") => ControllerSupport::Partial,
            _ => ControllerSupport::None,
        },
        pc_requirements: Requirements {
            minimum: requirement("minimum"),
            recommended: requirement("recommended"),
        },
        screenshots: data
            .get("screenshots")
            .and_then(Value::as_array)
            .map(|shots| {
                shots
                    .iter()
                    .filter_map(|s| {
                        Some(Screenshot {
                            thumbnail: https(s.get("path_thumbnail")?.as_str()?),
                            full: https(s.get("path_full")?.as_str()?),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default(),
        movies: data
            .get("movies")
            .and_then(Value::as_array)
            .map(|movies| {
                movies
                    .iter()
                    .map(|m| Movie {
                        id: m.get("id").and_then(Value::as_u64).unwrap_or_default(),
                        name: m
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        thumbnail: m
                            .get("thumbnail")
                            .and_then(Value::as_str)
                            .map(https)
                            .unwrap_or_default(),
                        hls_h264: m.get("hls_h264").and_then(Value::as_str).map(https),
                        dash_h264: m.get("dash_h264").and_then(Value::as_str).map(https),
                        dash_av1: m.get("dash_av1").and_then(Value::as_str).map(https),
                        mp4: video_source(m, "mp4"),
                        webm: video_source(m, "webm"),
                    })
                    .filter(|m| m.best_source().is_some())
                    .collect()
            })
            .unwrap_or_default(),
        genres: data
            .get("genres")
            .and_then(Value::as_array)
            .map(|g| {
                g.iter()
                    .filter_map(|x| x.get("description")?.as_str())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        content_descriptor_ids: data
            .pointer("/content_descriptors/ids")
            .and_then(Value::as_array)
            .map(|ids| ids.iter().filter_map(Value::as_u64).collect())
            .unwrap_or_default(),
    })
}

/// `toHttps` in gallery-media-sources.ts.
fn https(url: &str) -> String {
    url.strip_prefix("http://")
        .map_or_else(|| url.to_string(), |rest| format!("https://{rest}"))
}

/// Library artwork for a game (the fields of Hydra's `ShopAssets`).
#[derive(Debug, Clone, Default)]
pub struct Assets {
    pub hero: Option<String>,
    pub logo: Option<String>,
    pub cover: Option<String>,
    pub library: Option<String>,
    pub icon: Option<String>,
}

/// Hydra API `GET {api}/games/{shop}/{objectId}/assets` (get-game-assets.ts).
/// `api_url` is the same value as `MAIN_VITE_API_URL` in the Electron app.
pub fn hydra_assets(client: &Client, api_url: &str, shop: &str, object_id: &str) -> Option<Assets> {
    let url = format!(
        "{}/games/{shop}/{object_id}/assets",
        api_url.trim_end_matches('/')
    );
    let body: Value = client
        .get(url)
        .send()
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .ok()?;
    let field = |key: &str| {
        body.get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    Some(Assets {
        hero: field("libraryHeroImageUrl"),
        logo: field("logoImageUrl"),
        cover: field("coverImageUrl"),
        library: field("libraryImageUrl"),
        icon: field("iconUrl"),
    })
    .filter(|a| a.hero.is_some() || a.logo.is_some() || a.cover.is_some())
}

/// Steam CDN artwork, used when the Hydra API isn't configured or has nothing.
pub fn steam_cdn_assets(app_id: u64) -> Assets {
    let base =
        format!("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{app_id}");
    Assets {
        hero: Some(format!("{base}/library_hero.jpg")),
        logo: Some(format!("{base}/logo.png")),
        cover: Some(format!("{base}/library_600x900.jpg")),
        library: Some(format!("{base}/header.jpg")),
        icon: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_locales_like_hydra() {
        assert_eq!(steam_language("pt-BR"), "brazilian");
        assert_eq!(steam_language("pt"), "english");
        assert_eq!(steam_language("de-AT"), "german");
        assert_eq!(steam_language("zh-TW"), "tchinese");
    }

    #[test]
    fn parses_appdetails() {
        let body = serde_json::json!({
            "10": { "success": true, "data": {
                "name": "Game",
                "release_date": { "coming_soon": false, "date": "Sep 4, 2025" },
                "publishers": ["Pub"],
                "about_the_game": "<p>Hi</p>",
                "supported_languages": "English",
                "controller_support": "full",
                "pc_requirements": [],
                "screenshots": [{ "id": 0, "path_thumbnail": "http://x/t.jpg", "path_full": "http://x/f.jpg" }],
                "movies": [
                    { "id": 1, "name": "Trailer", "thumbnail": "http://x/m.jpg", "hls_h264": "http://x/m.m3u8" },
                    { "id": 2, "name": "No sources", "thumbnail": "http://x/n.jpg" }
                ]
            }}
        });
        let details = parse_app_details(&body, 10).unwrap();
        assert_eq!(details.name, "Game");
        assert_eq!(details.controller_support, ControllerSupport::Full);
        assert!(details.pc_requirements.minimum.is_none());
        assert_eq!(details.screenshots[0].full, "https://x/f.jpg");
        assert_eq!(details.movies.len(), 1);
        assert_eq!(details.movies[0].best_source(), Some("https://x/m.m3u8"));
    }

    #[test]
    fn unknown_app_is_none() {
        let body = serde_json::json!({ "10": { "success": false } });
        assert!(parse_app_details(&body, 10).is_none());
    }
}
