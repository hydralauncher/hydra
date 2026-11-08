//! Classics (`launchbox`) game pages: get-game-shop-details.ts
//! `getLaunchboxShopDetails` (Hydra API basic info + shop details, cached in
//! the same LevelDB sublevels as Electron) and the hero's cover/platform data
//! from game-details-content.tsx.

use std::sync::Arc;

use hydra_core::api::{HydraApi, Options};
use hydra_db::{Db, keys};
use serde_json::{Value, json};

/// What the classics hero needs besides the shop details.
#[derive(Clone, Debug, Default)]
pub struct Classics {
    pub title: String,
    pub platform: Option<String>,
    /// `launchboxCover`: the box art shown in the hero and its blurred backdrop.
    pub cover: Option<String>,
}

fn non_empty(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// mapLaunchboxToShopDetails: the Steam appdetails shape the page renders.
fn map_details(
    object_id: &str,
    basic: Option<&Value>,
    entry: Option<&Value>,
    cached: Option<&Value>,
    language: &str,
) -> Value {
    let data = entry.and_then(|e| e.get("data")).filter(|d| !d.is_null());
    let field = |key: &str| data.and_then(|d| d.get(key));
    let strings = |key: &str| {
        field(key)
            .filter(|v| v.is_array())
            .cloned()
            .unwrap_or_else(|| json!([]))
    };
    let description = field("description")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let genres: Vec<Value> = field("genres")
        .and_then(Value::as_array)
        .map(|g| {
            g.iter()
                .enumerate()
                .map(|(i, name)| json!({ "id": i.to_string(), "name": name }))
                .collect()
        })
        .unwrap_or_default();
    let screenshots: Vec<Value> = field("screenshots")
        .and_then(Value::as_array)
        .map(|s| {
            s.iter()
                .enumerate()
                .map(|(i, url)| json!({ "id": i, "path_thumbnail": url, "path_full": url }))
                .collect()
        })
        .unwrap_or_default();
    let mut details = json!({
        "objectId": object_id,
        "name": field("title").and_then(Value::as_str).or_else(|| basic.and_then(|b| b.get("title")).and_then(Value::as_str)).unwrap_or_default(),
        "retroAchievementsGameId": basic
            .and_then(|b| b.get("retroAchievementsGameId"))
            .filter(|v| !v.is_null())
            .or_else(|| cached.and_then(|c| c.get("retroAchievementsGameId")))
            .cloned()
            .unwrap_or(Value::Null),
        "steam_appid": 0,
        "detailed_description": description,
        "about_the_game": description,
        "short_description": "",
        "developers": strings("developers"),
        "publishers": strings("publishers"),
        "genres": genres,
        "supported_languages": "",
        "screenshots": screenshots,
        "pc_requirements": { "minimum": "", "recommended": "" },
        "mac_requirements": { "minimum": "", "recommended": "" },
        "linux_requirements": { "minimum": "", "recommended": "" },
        "release_date": {
            "coming_soon": false,
            "date": field("releaseDate").and_then(Value::as_str)
                .or_else(|| basic.and_then(|b| b.get("releaseDate")).and_then(Value::as_str))
                .unwrap_or_default(),
        },
        "content_descriptors": { "ids": [] },
    });
    let map = details.as_object_mut().expect("object");
    if data.is_some() {
        map.insert("descriptionLanguage".into(), json!(language));
    }
    if let Some(platform) = entry
        .and_then(|e| e.get("platform"))
        .filter(|v| !v.is_null())
        .or_else(|| field("platform").filter(|v| !v.is_null()))
    {
        map.insert("platform".into(), platform.clone());
    }
    if let Some(skus) = entry.and_then(|e| e.get("skus")).filter(|v| !v.is_null()) {
        map.insert("skus".into(), skus.clone());
    }
    details
}

/// The shop details and assets of a classics game, from the cache when it has
/// the newer fields, else from the API (and written back to the cache).
pub fn fetch(
    db: Option<&Arc<Db>>,
    api: Option<&Arc<HydraApi>>,
    object_id: &str,
    language: &str,
) -> (Option<Value>, Option<Value>) {
    let shop = "launchbox";
    let cache_key = keys::game_shop_cache_item(shop, object_id, language);
    let game_key = keys::game(shop, object_id);
    let cached: Option<Value> = db.and_then(|db| db.get_in(keys::GAME_SHOP_CACHE, &cache_key));
    let cached_assets: Option<Value> =
        db.and_then(|db| db.get_in(keys::GAME_SHOP_ASSETS, &game_key));

    let cache_has_new_fields = cached.as_ref().is_some_and(|c| {
        (truthy(c.get("platform")) || truthy(c.get("skus")))
            && c.get("retroAchievementsGameId")
                .is_some_and(Value::is_number)
            && c.get("descriptionLanguage").and_then(Value::as_str) == Some(language)
    });
    if cache_has_new_fields {
        return (cached, cached_assets);
    }

    let Some(api) = api else {
        return (cached, cached_assets);
    };
    let basic_path = format!("/games/{shop}/{object_id}");
    let (basic, entries) = std::thread::scope(|scope| {
        let basic = scope.spawn(|| match api.get(&basic_path, &[], Options::public()) {
            Ok(value) if value.is_object() => Some(value),
            Ok(_) => None,
            Err(error) => {
                eprintln!("Failed to fetch launchbox basic game info: {error}");
                None
            }
        });
        let entries = scope.spawn(|| {
            match api.post(
                "/games/shop-details",
                &json!({ "shop": shop, "objectIds": [object_id], "language": language }),
                Options::public(),
            ) {
                Ok(Value::Array(entries)) => entries,
                Ok(_) => Vec::new(),
                Err(error) => {
                    eprintln!("Failed to fetch launchbox shop details: {error}");
                    Vec::new()
                }
            }
        });
        (
            basic.join().ok().flatten(),
            entries.join().unwrap_or_default(),
        )
    });
    let entry = entries
        .iter()
        .find(|e| e.get("objectId").and_then(Value::as_str) == Some(object_id));
    let data = entry.and_then(|e| e.get("data")).filter(|d| !d.is_null());
    if data.is_none() && basic.is_none() {
        return (None, None);
    }
    let mapped = map_details(object_id, basic.as_ref(), entry, cached.as_ref(), language);
    if let Some(db) = db
        && let Err(error) = db.put_in(keys::GAME_SHOP_CACHE, &cache_key, &mapped)
    {
        eprintln!("Could not cache launchbox game details: {error}");
    }

    let asset = |key: &str| {
        data.and_then(|d| d.get("assets"))
            .and_then(|a| a.get(key))
            .filter(|v| !v.is_null())
            .or_else(|| {
                basic
                    .as_ref()
                    .and_then(|b| b.get(key))
                    .filter(|v| !v.is_null())
            })
            .cloned()
            .unwrap_or(Value::Null)
    };
    let has_assets = data
        .and_then(|d| d.get("assets"))
        .is_some_and(|a| !a.is_null())
        || basic.is_some();
    let assets = if has_assets {
        let title = data
            .and_then(|d| d.get("assets"))
            .and_then(|a| a.get("title"))
            .and_then(Value::as_str)
            .or_else(|| {
                basic
                    .as_ref()
                    .and_then(|b| b.get("title"))
                    .and_then(Value::as_str)
            })
            .or_else(|| mapped.get("name").and_then(Value::as_str))
            .unwrap_or_default();
        let assets = json!({
            "objectId": object_id,
            "shop": shop,
            "title": title,
            "iconUrl": asset("iconUrl"),
            "libraryHeroImageUrl": asset("libraryHeroImageUrl"),
            "libraryImageUrl": asset("libraryImageUrl"),
            "logoImageUrl": asset("logoImageUrl"),
            "logoPosition": basic.as_ref().and_then(|b| b.get("logoPosition")).cloned().unwrap_or(Value::Null),
            "coverImageUrl": basic.as_ref().and_then(|b| b.get("coverImageUrl")).cloned().unwrap_or(Value::Null),
            "downloadSources": [],
        });
        if let Some(db) = db {
            let mut stored = assets.clone();
            stored["updatedAt"] = json!(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0)
            );
            if let Err(error) = db.put_in(keys::GAME_SHOP_ASSETS, &game_key, &stored) {
                eprintln!("Could not cache launchbox assets: {error}");
            }
        }
        Some(assets)
    } else {
        cached_assets
    };
    (Some(mapped), assets)
}

/// game-details-content.tsx: `launchboxCover`, `launchboxPlatform`, `launchboxTitle`.
pub fn classics(details: Option<&Value>, assets: Option<&Value>, game: Option<&Value>) -> Classics {
    let game_field = |key: &str| non_empty(game.and_then(|g| g.get(key)));
    let asset_field = |key: &str| non_empty(assets.and_then(|a| a.get(key)));
    Classics {
        title: game_field("title")
            .or_else(|| non_empty(details.and_then(|d| d.get("name"))))
            .unwrap_or_default(),
        platform: game_field("platform")
            .or_else(|| non_empty(details.and_then(|d| d.get("platform")))),
        cover: game_field("customCoverImageUrl")
            .or_else(|| asset_field("coverImageUrl"))
            .or_else(|| asset_field("libraryImageUrl"))
            .or_else(|| game_field("libraryImageUrl"))
            .or_else(|| asset_field("iconUrl"))
            .or_else(|| game_field("iconUrl")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_launchbox_details() {
        let basic = json!({ "title": "God of War", "retroAchievementsGameId": 2782, "releaseDate": "2005-03-22T00:00:00.000Z" });
        let entry = json!({
            "objectId": "23", "platform": "Sony Playstation 2", "skus": ["SCUS97399"],
            "data": { "title": "God of War", "description": "Kratos.", "releaseDate": "2005-03-22",
                      "developers": ["SCE"], "publishers": ["Sony"], "genres": ["Action"], "screenshots": ["a.jpg"] }
        });
        let mapped = map_details("23", Some(&basic), Some(&entry), None, "en-US");
        assert_eq!(mapped["release_date"]["date"], "2005-03-22");
        assert_eq!(mapped["retroAchievementsGameId"], 2782);
        assert_eq!(mapped["platform"], "Sony Playstation 2");
        assert_eq!(mapped["screenshots"][0]["path_full"], "a.jpg");
        assert_eq!(mapped["genres"][0], json!({ "id": "0", "name": "Action" }));
        assert_eq!(mapped["descriptionLanguage"], "en-US");
    }
}
