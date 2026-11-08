//! A game's download options: game-details.context.tsx `fetchDownloadSources`
//! (download-sources API, filterDownloadableRepacks, hoster availability)
//! and modals/repacks-modal.tsx.

use std::cell::RefCell;

use hydra_core::api::Options;
use hydra_core::repacks;
use hydra_db::keys;
use serde_json::{Value, json};
use slint::{ComponentHandle, ModelRc, SharedString, VecModel};

use crate::{AppWindow, GameData, RepackRow, shell};

struct State {
    ui: slint::Weak<AppWindow>,
    /// Bumped per game, so a late response for another game is dropped.
    generation: u64,
    repacks: Vec<Value>,
    /// Download sources, newest first: (name, fingerprint).
    sources: Vec<(String, Option<String>)>,
    filter: String,
    fingerprints: Vec<String>,
    /// `downloadSourcesSinceValue`: repacks created after it are "new".
    last_check: Option<String>,
    viewed: Vec<String>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> Option<R> {
    STATE.with(|s| s.borrow_mut().as_mut().map(f))
}

pub fn init(ui: &AppWindow) {
    STATE.with(|s| {
        *s.borrow_mut() = Some(State {
            ui: ui.as_weak(),
            generation: 0,
            repacks: Vec::new(),
            sources: Vec::new(),
            filter: String::new(),
            fingerprints: Vec::new(),
            last_check: None,
            viewed: Vec::new(),
        })
    });
    let g = ui.global::<GameData>();
    g.on_repacks_filter(|text| {
        with(|s| s.filter = text.to_string());
        apply_rows();
    });
    g.on_repacks_toggle_source(|fingerprint| {
        with(|s| {
            let fp = fingerprint.to_string();
            if s.fingerprints.contains(&fp) {
                s.fingerprints.retain(|f| *f != fp);
            } else {
                s.fingerprints.push(fp);
            }
        });
        apply_rows();
    });
    g.on_repacks_opened(on_opened);
    g.on_repacks_closed(|| {
        with(|s| {
            s.filter.clear();
            s.fingerprints.clear();
        });
        apply_rows();
    });
    g.on_repack_selected(|id| {
        with(|s| {
            if !s.viewed.contains(&id.to_string()) {
                s.viewed.push(id.to_string());
            }
        });
        apply_rows();
        eprintln!("TODO(downloads): DownloadSettingsModal for repack {id}");
    });
}

fn sorted_sources(db: &hydra_db::Db) -> Vec<Value> {
    let mut sources: Vec<Value> = db.values(keys::DOWNLOAD_SOURCES).unwrap_or_default();
    sources.sort_by(|a, b| {
        let created = |v: &Value| {
            v.get("createdAt")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        created(b).cmp(&created(a))
    });
    sources
}

/// The game page opened `/game/:shop/:objectId`.
pub fn open(shop: &str, object_id: &str) {
    let Some(generation) = with(|s| {
        s.generation += 1;
        s.repacks.clear();
        s.viewed.clear();
        s.generation
    }) else {
        return;
    };
    apply_rows();
    if shop == "custom" {
        return;
    }
    let (Some(api), Some(db)) = (shell::api(), shell::db()) else {
        return;
    };
    let path = format!("/games/{shop}/{object_id}/download-sources");
    let multipart = crate::features::enabled("MULTIPART_HOSTER_DOWNLOADS");
    std::thread::spawn(move || {
        let sources = sorted_sources(&db);
        let mut query: Vec<(&str, String)> = vec![("take", "100".into()), ("skip", "0".into())];
        for source in &sources {
            if let Some(id) = source.get("id").and_then(|v| {
                v.as_str()
                    .map(str::to_string)
                    .or_else(|| v.as_i64().map(|n| n.to_string()))
            }) {
                query.push(("downloadSourceIds[]", id));
            }
        }
        let downloads = match api.get(&path, &query, Options::public()) {
            Ok(Value::Array(items)) => items,
            Ok(other) => {
                eprintln!("Expected an array from {path}, received {other}");
                Vec::new()
            }
            Err(error) => {
                eprintln!("Failed to fetch download sources: {error}");
                return;
            }
        };
        let options = repacks::filter_downloadable(downloads, multipart);
        let publish = |options: Vec<Value>| {
            let source_rows: Vec<(String, Option<String>)> = sources
                .iter()
                .map(|s| {
                    (
                        s.get("name")
                            .and_then(Value::as_str)
                            .or_else(|| s.get("url").and_then(Value::as_str))
                            .unwrap_or_default()
                            .to_string(),
                        s.get("fingerprint")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                    )
                })
                .collect();
            let _ = slint::invoke_from_event_loop(move || {
                let current = with(|s| {
                    if s.generation != generation {
                        return false;
                    }
                    s.repacks = options;
                    s.sources = source_rows;
                    true
                })
                .unwrap_or(false);
                if current {
                    apply_rows();
                }
            });
        };
        publish(options.clone());
        // fetchHosterAvailability / applyHosterAvailability
        let urls = repacks::hoster_availability_uris(&options);
        if urls.is_empty() {
            return;
        }
        if let Ok(response) = api.post(
            "/hosters/availability",
            &json!({ "urls": urls }),
            Options::public(),
        ) {
            let results: Vec<(String, bool)> = response
                .get("results")
                .and_then(Value::as_array)
                .map(|r| {
                    r.iter()
                        .filter_map(|x| {
                            Some((
                                x.get("url")?.as_str()?.to_string(),
                                x.get("available")?.as_bool()?,
                            ))
                        })
                        .collect()
                })
                .unwrap_or_default();
            if !results.is_empty() {
                let mut options = options;
                repacks::apply_hoster_availability(&mut options, &results);
                publish(options);
            }
        }
    });
}

/// The modal opened: clear the game's "new download options" count and
/// read the last download sources check (for the "New" badges).
fn on_opened() {
    let Some(db) = shell::db() else { return };
    let last_check = db.get_utf8(keys::DOWNLOAD_SOURCES_SINCE_VALUE);
    with(|s| s.last_check = last_check);
    // TODO(downloads): clear newDownloadOptionsCount on the library game (repacks-modal.tsx effect).
    apply_rows();
}

/// filteredRepacks + rows for the modal and the hero's summary.
fn apply_rows() {
    let Some(ui) = with(|s| s.ui.upgrade()).flatten() else {
        return;
    };
    let language = shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into());
    let state = with(|s| {
        // orderBy(repacks, uploadDate, desc)
        let mut sorted = s.repacks.clone();
        sorted.sort_by(|a, b| {
            let date = |v: &Value| {
                v.get("uploadDate")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            };
            date(b).cmp(&date(a))
        });
        let term = s.filter.trim().to_lowercase();
        let rows: Vec<RepackRow> = sorted
            .iter()
            .filter(|r| {
                let text = |k: &str| {
                    r.get(k)
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_lowercase()
                };
                term.is_empty()
                    || text("title").contains(&term)
                    || text("downloadSourceName").contains(&term)
            })
            .filter(|r| {
                s.fingerprints.is_empty()
                    || s.sources.iter().any(|(name, fp)| {
                        fp.as_ref().is_some_and(|fp| s.fingerprints.contains(fp))
                            && r.get("downloadSourceName").and_then(Value::as_str)
                                == Some(name.as_str())
                    })
            })
            .map(|r| {
                let text = |k: &str| {
                    r.get(k)
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string()
                };
                let id = r
                    .get("id")
                    .map(|v| {
                        v.as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| v.to_string())
                    })
                    .unwrap_or_default();
                let upload = r
                    .get("uploadDate")
                    .and_then(Value::as_str)
                    .and_then(hydra_core::library::parse_iso_millis)
                    .map(|ms| hydra_i18n::date::format_date(&language, ms))
                    .unwrap_or_default();
                let is_new = !s.viewed.contains(&id)
                    && s.last_check
                        .as_deref()
                        .zip(r.get("createdAt").and_then(Value::as_str))
                        .is_some_and(|(last, created)| {
                            hydra_core::library::parse_iso_millis(last)
                                .zip(hydra_core::library::parse_iso_millis(created))
                                .is_some_and(|(last, created)| created > last)
                        });
                RepackRow {
                    id: id.into(),
                    title: text("title").into(),
                    info: format!(
                        "{} - {} - {}",
                        text("fileSize"),
                        text("downloadSourceName"),
                        upload
                    )
                    .into(),
                    availability: r
                        .as_object()
                        .map(repacks::availability)
                        .unwrap_or("offline")
                        .into(),
                    is_new,
                    last_downloaded: false,
                }
            })
            .collect();
        let latest_update = s
            .repacks
            .first()
            .and_then(|r| r.get("uploadDate").and_then(Value::as_str))
            .and_then(hydra_core::library::parse_iso_millis)
            .map(|ms| hydra_i18n::date::format_date(&language, ms))
            .unwrap_or_default();
        let sources: Vec<crate::RepackSource> = s
            .sources
            .iter()
            .filter_map(|(name, fp)| {
                let fp = fp.clone()?;
                let label = if name.chars().count() > 16 {
                    format!("{}...", name.chars().take(16).collect::<String>())
                } else {
                    name.clone()
                };
                Some(crate::RepackSource {
                    label: label.into(),
                    fingerprint: fp.clone().into(),
                    checked: s.fingerprints.contains(&fp),
                })
            })
            .collect();
        (rows, s.repacks.len(), latest_update, sources)
    });
    let Some((rows, count, latest, sources)) = state else {
        return;
    };
    let g = ui.global::<GameData>();
    g.set_repack_rows(ModelRc::new(VecModel::from(rows)));
    g.set_repacks_count(count as i32);
    g.set_repacks_updated(SharedString::from(shell::tr_with(
        "game_details.updated_at",
        &[("updated_at", latest.into())],
    )));
    g.set_repack_sources(ModelRc::new(VecModel::from(sources)));
}
