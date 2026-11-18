//! Custom game artwork (game-assets-settings.tsx, game-artwork-picker.tsx):
//! SteamGridDB pages from the Hydra API (services/game-artwork.ts), the
//! artwork selection record (set-game-artwork-selection.ts), the custom asset
//! fields (update-game-custom-assets.ts with reconcile-artwork-selection.ts)
//! and the cloud copies of both (services/game-artwork-cloud.ts).

use std::path::{Path, PathBuf};

use hydra_db::{Db, keys};
use serde_json::{Map, Value, json};

use crate::api::{ApiError, HydraApi, Options};
use crate::library_actions;

/// ARTWORK_PAGE_SIZE
pub const PAGE_SIZE: usize = 50;
/// MAX_ARTWORK_SIZE_IN_BYTES
const MAX_UPLOAD_BYTES: u64 = 20 * 1024 * 1024;

/// "icon" | "logo" | "hero" | "grid"
pub const ASSET_TYPES: [&str; 4] = ["icon", "logo", "hero", "grid"];

/// ARTWORK_KIND_BY_ASSET_TYPE
pub fn kind(asset_type: &str) -> &'static str {
    match asset_type {
        "grid" => "grids",
        "hero" => "heroes",
        "logo" => "logos",
        _ => "icons",
    }
}

/// The game fields of a manual (custom) asset: (url, original path).
pub fn manual_fields(asset_type: &str) -> (&'static str, &'static str) {
    match asset_type {
        "logo" => ("customLogoImageUrl", "customOriginalLogoPath"),
        "hero" => ("customHeroImageUrl", "customOriginalHeroPath"),
        "grid" => ("customCoverImageUrl", "customOriginalCoverPath"),
        _ => ("customIconUrl", "customOriginalIconPath"),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ArtworkItem {
    pub id: i64,
    pub url: String,
    pub thumb: String,
}

impl ArtworkItem {
    /// isAnimatedArtworkItem: a video in the url or the thumbnail.
    pub fn is_animated(&self) -> bool {
        is_video(&self.url) || is_video(&self.thumb)
    }

    /// getArtworkDisplaySource: the thumbnail unless it is a video.
    pub fn display_source(&self) -> &str {
        if is_video(&self.thumb) {
            &self.url
        } else {
            &self.thumb
        }
    }

    /// getRenderableArtworkUrl: `.ico` icons use the thumbnail.
    pub fn renderable_url(&self, asset_type: &str) -> &str {
        let ico = self
            .url
            .split('?')
            .next()
            .is_some_and(|u| u.to_lowercase().ends_with(".ico"));
        if asset_type == "icon" && ico && !self.thumb.is_empty() && !is_video(&self.thumb) {
            &self.thumb
        } else {
            &self.url
        }
    }
}

/// isVideoArtworkUrl
pub fn is_video(url: &str) -> bool {
    let path = url.split('?').next().unwrap_or(url).to_lowercase();
    path.ends_with(".webm") || path.ends_with(".mp4")
}

pub struct ArtworkPage {
    pub items: Vec<ArtworkItem>,
    pub has_more: bool,
}

/// fetchGameArtwork: GET /games/:shop/:objectId/artwork/:kind with the
/// per-kind filters; a 404 is an empty page.
pub fn fetch_page(
    api: &HydraApi,
    shop: &str,
    object_id: &str,
    asset_type: &str,
    page: usize,
) -> Result<ArtworkPage, ApiError> {
    let kind = kind(asset_type);
    let mut query: Vec<(&str, String)> = vec![("nsfw", "false".into())];
    match kind {
        "grids" => {
            query.push(("dimensions", "600x900,342x482,660x930".into()));
            query.push(("mimes", "image/png,image/jpeg,image/webp".into()));
        }
        "heroes" => query.push(("mimes", "image/png,image/jpeg,image/webp".into())),
        "logos" => query.push(("mimes", "image/png,image/webp".into())),
        _ => query.push(("mimes", "image/png,image/vnd.microsoft.icon".into())),
    }
    query.push(("limit", PAGE_SIZE.to_string()));
    query.push(("page", page.to_string()));
    let body = match api.get(
        &format!("/games/{shop}/{object_id}/artwork/{kind}"),
        &query,
        Options::default(),
    ) {
        Ok(body) => body,
        Err(ApiError::Status { status: 404, .. }) => {
            return Ok(ArtworkPage {
                items: Vec::new(),
                has_more: false,
            });
        }
        Err(error) => return Err(error),
    };
    let items: Vec<ArtworkItem> = body
        .get("data")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|item| {
                    Some(ArtworkItem {
                        id: item.get("id")?.as_i64()?,
                        url: item.get("url")?.as_str()?.to_string(),
                        thumb: item
                            .get("thumb")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(ArtworkPage {
        has_more: items.len() == PAGE_SIZE,
        items,
    })
}

/// getGameArtworkSelection: the selected artwork id per asset type.
pub fn selected_id(db: &Db, shop: &str, object_id: &str, asset_type: &str) -> Option<i64> {
    db.get_in::<Value>(keys::ARTWORK_SELECTION, &keys::game(shop, object_id))?
        .get("selected")?
        .get(asset_type)?
        .get("artworkId")?
        .as_i64()
}

fn write_selection(db: &Db, shop: &str, object_id: &str, selected: Map<String, Value>) {
    let key = keys::game(shop, object_id);
    if selected.is_empty() {
        let _ = db.delete_in(keys::ARTWORK_SELECTION, &key);
    } else {
        let _ = db.put_in(
            keys::ARTWORK_SELECTION,
            &key,
            &json!({
                "objectId": object_id,
                "shop": shop,
                "selected": selected,
                "updatedAt": chrono_now_ms(),
            }),
        );
    }
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

fn current_selected(db: &Db, shop: &str, object_id: &str) -> Map<String, Value> {
    db.get_in::<Value>(keys::ARTWORK_SELECTION, &keys::game(shop, object_id))
        .and_then(|v| v.get("selected").and_then(Value::as_object).cloned())
        .unwrap_or_default()
}

/// setGameArtworkSelection: pick (an animated SteamGridDB item) or clear;
/// either way the manual asset of that type goes away.
pub fn set_selection(
    db: &Db,
    shop: &str,
    object_id: &str,
    asset_type: &str,
    pick: Option<(&str, i64)>,
) {
    let mut selected = current_selected(db, shop, object_id);
    match pick {
        Some((url, id)) => {
            selected.insert(asset_type.into(), json!({ "url": url, "artworkId": id }));
        }
        None => {
            selected.remove(asset_type);
        }
    }
    let key = keys::game(shop, object_id);
    let (url_field, original_field) = manual_fields(asset_type);
    let mut local_to_delete = None;
    let _ = library_actions::update_game_record(db, &key, |game| {
        let existing = game
            .get(url_field)
            .and_then(Value::as_str)
            .map(str::to_string);
        if existing.is_some() || game.get(original_field).is_some_and(|v| !v.is_null()) {
            local_to_delete = existing.and_then(|e| e.strip_prefix("local:").map(str::to_string));
            game.insert(url_field.into(), Value::Null);
            game.insert(original_field.into(), Value::Null);
        }
    });
    write_selection(db, shop, object_id, selected);
    if let Some(path) = local_to_delete {
        let _ = std::fs::remove_file(path);
    }
}

/// One custom asset change for `update_custom_asset`.
pub struct AssetChange<'a> {
    pub asset_type: &'a str,
    /// `local:<path>` or None to remove the custom asset.
    pub url: Option<String>,
    /// customOriginal*Path: the file or artwork URL it came from.
    pub original: Option<String>,
    /// The SteamGridDB artwork the file came from.
    pub artwork_id: Option<i64>,
}

/// updateGameCustomAssets for one asset type (+ reconcileArtworkSelection),
/// deleting the replaced local file. Returns the previous URL.
pub fn update_custom_asset(
    db: &Db,
    shop: &str,
    object_id: &str,
    change: &AssetChange,
) -> Option<String> {
    let key = keys::game(shop, object_id);
    let (url_field, original_field) = manual_fields(change.asset_type);
    let mut previous = None;
    let _ = library_actions::update_game_record(db, &key, |game| {
        previous = game
            .get(url_field)
            .and_then(Value::as_str)
            .map(str::to_string);
        game.insert(
            url_field.into(),
            change.url.as_ref().map_or(Value::Null, |u| json!(u)),
        );
        game.insert(
            original_field.into(),
            change.original.as_ref().map_or(Value::Null, |o| json!(o)),
        );
    });
    // reconcileArtworkSelection
    let mut selected = current_selected(db, shop, object_id);
    let before = selected.clone();
    match (&change.url, change.artwork_id) {
        (None, _) => {
            selected.remove(change.asset_type);
        }
        (Some(url), Some(id)) if url.starts_with("local:") && previous.as_deref() != Some(url) => {
            selected.insert(
                change.asset_type.into(),
                json!({ "url": url, "artworkId": id }),
            );
        }
        (Some(url), _) if previous.as_deref() != Some(url) => {
            selected.remove(change.asset_type);
        }
        _ => {}
    }
    if selected != before {
        write_selection(db, shop, object_id, selected);
    }
    if let Some(old) = previous
        .as_deref()
        .filter(|old| Some(*old) != change.url.as_deref())
        .and_then(|old| old.strip_prefix("local:"))
    {
        let _ = std::fs::remove_file(old);
    }
    previous
}

/// copyCustomGameAsset: `<Assets>/custom-games/<type>-<id><ext>`.
pub fn copy_custom_asset(
    assets_dir: &Path,
    source: &Path,
    asset_type: &str,
) -> std::io::Result<PathBuf> {
    let dir = assets_dir.join("custom-games");
    std::fs::create_dir_all(&dir)?;
    let extension = source
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let unique = format!(
        "{:x}{:x}",
        chrono_now_ms(),
        std::process::id() as u64 ^ (source.to_string_lossy().len() as u64)
    );
    let destination = dir.join(format!("{asset_type}-{unique}{extension}"));
    std::fs::copy(source, &destination)?;
    Ok(destination)
}

/// saveSteamGridDbArtwork (subscribers): PUT the chosen URL.
pub fn sync_steamgriddb(
    api: &HydraApi,
    shop: &str,
    object_id: &str,
    asset_type: &str,
    url: &str,
) -> bool {
    api.put(
        &format!(
            "/profile/games/{shop}/{object_id}/artwork/{}",
            kind(asset_type)
        ),
        &json!({ "source": "steamgriddb", "url": url }),
        Options::default(),
    )
    .is_ok()
}

/// deleteCustomArtwork (subscribers)
pub fn delete_cloud(api: &HydraApi, shop: &str, object_id: &str, asset_type: &str) {
    let _ = api.delete(
        &format!(
            "/profile/games/{shop}/{object_id}/artwork/{}",
            kind(asset_type)
        ),
        Options::default(),
    );
}

/// uploadCustomArtwork (subscribers): upload URL, PUT the bytes, then point
/// the artwork at the uploaded image.
pub fn upload_cloud(
    api: &HydraApi,
    http: &reqwest::blocking::Client,
    shop: &str,
    object_id: &str,
    asset_type: &str,
    local_url: &str,
) -> Result<(), String> {
    let Some(path) = local_url.strip_prefix("local:") else {
        return Ok(());
    };
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_UPLOAD_BYTES {
        return Ok(());
    }
    let extension = Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let (ext, mime) = match extension.as_str() {
        "png" => ("png", "image/png"),
        "jpg" | "jpeg" => (extension.as_str(), "image/jpeg"),
        "webp" => ("webp", "image/webp"),
        "gif" => ("gif", "image/gif"),
        // fileTypeFromFile: the magic bytes
        _ if bytes.starts_with(b"\x89PNG") => ("png", "image/png"),
        _ if bytes.starts_with(b"\xFF\xD8\xFF") => ("jpg", "image/jpeg"),
        _ if bytes.starts_with(b"GIF8") => ("gif", "image/gif"),
        _ if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" => {
            ("webp", "image/webp")
        }
        _ => return Ok(()),
    };
    let kind = kind(asset_type);
    let target = api
        .post(
            &format!("/profile/games/{shop}/{object_id}/artwork/{kind}/upload-url"),
            &json!({ "imageExt": ext, "imageLength": bytes.len() }),
            Options::default(),
        )
        .map_err(|e| e.to_string())?;
    let presigned = target
        .get("presignedUrl")
        .and_then(Value::as_str)
        .ok_or("no presigned url")?;
    let image_url = target
        .get("imageUrl")
        .and_then(Value::as_str)
        .ok_or("no image url")?;
    http.put(presigned)
        .header("Content-Type", mime)
        .body(bytes)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    api.put(
        &format!("/profile/games/{shop}/{object_id}/artwork/{kind}"),
        &json!({ "source": "upload", "url": image_url }),
        Options::default(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_display_and_renderable_sources() {
        let item = ArtworkItem {
            id: 1,
            url: "https://cdn/x.webm".into(),
            thumb: "https://cdn/x.png".into(),
        };
        assert!(item.is_animated());
        assert_eq!(item.display_source(), "https://cdn/x.png");
        let ico = ArtworkItem {
            id: 2,
            url: "https://cdn/i.ico?x=1".into(),
            thumb: "https://cdn/i.png".into(),
        };
        assert_eq!(ico.renderable_url("icon"), "https://cdn/i.png");
        assert_eq!(ico.renderable_url("grid"), "https://cdn/i.ico?x=1");
        assert_eq!(kind("hero"), "heroes");
    }
}
