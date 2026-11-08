//! pages/downloads (downloads.tsx + download-group.tsx): the download in
//! progress as a hero, the queued and paused downloads, the completed ones.

use std::cell::RefCell;
use std::collections::HashMap;

use hydra_core::repacks::Downloader;
use hydra_db::keys;
use hydra_downloads::layout::{self, Download};
use hydra_downloads::manager::Progress;
use hydra_media::images::{Loader, Op, Source};
use serde_json::Value;
use slint::{Color, ComponentHandle, Image, Model, ModelRc, SharedString, VecModel};

use crate::{AppWindow, DownloadCard, DownloadsData, shell};

/// MAX_DOWNLOAD_SPEED_HISTORY
const MAX_SPEED_HISTORY: usize = 300;
const CHART_BACKGROUND: [u8; 3] = [0x1a, 0x1a, 0x1a];
const COLOR_DISTANCE_THRESHOLD: f64 = 28.0;

struct State {
    ui: slint::Weak<AppWindow>,
    loader: Loader,
    /// download-slice: speedHistory / peakSpeeds per game id.
    speeds: HashMap<String, Vec<f64>>,
    peaks: HashMap<String, f64>,
    /// Dominant colours of hero art (color.js `average`), by game id.
    colors: HashMap<String, Option<[u8; 3]>>,
    /// Images already requested, by URL.
    images: HashMap<String, Image>,
    hero_art: Option<String>,
    queued_ids: Vec<String>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> Option<R> {
    STATE.with(|s| s.borrow_mut().as_mut().map(f))
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

fn split_id(id: &str) -> (&str, &str) {
    id.split_once(':').unwrap_or((id, ""))
}

pub fn init(ui: &AppWindow, loader: &Loader) {
    STATE.with(|s| {
        *s.borrow_mut() = Some(State {
            ui: ui.as_weak(),
            loader: loader.clone(),
            speeds: HashMap::new(),
            peaks: HashMap::new(),
            colors: HashMap::new(),
            images: HashMap::new(),
            hero_art: None,
            queued_ids: Vec::new(),
        })
    });
    let d = ui.global::<DownloadsData>();
    d.on_pause(|id| {
        let (shop, object_id) = split_id(&id);
        crate::downloads::pause_with_warning(shop, object_id);
    });
    d.on_resume(|id| {
        let (shop, object_id) = split_id(&id);
        crate::downloads::resume(shop, object_id, "interruptActive");
    });
    d.on_cancel(|id| confirm_cancel(id.to_string()));
    d.on_open_game(|id| {
        let (shop, object_id) = split_id(&id);
        crate::nav::navigate(&format!("/game/{shop}/{object_id}"));
    });
    d.on_menu(|id, x, y| crate::downloads_menu::show(&id, x, y));
    d.on_completed_action(|id, step| crate::downloads_menu::completed_action(&id, &step));
}

/// ConfirmationModal "cancel_download" (danger), then cancelGameDownload.
fn confirm_cancel(id: String) {
    let (title, description, confirm_label, cancel_label) = (
        shell::tr("downloads.cancel_download"),
        shell::tr("downloads.cancel_download_description"),
        shell::tr("downloads.yes_cancel"),
        shell::tr("downloads.keep_downloading"),
    );
    crate::dialogs::confirm(
        crate::dialogs::Confirm {
            title: &title,
            description: &description,
            body: "",
            confirm_label: &confirm_label,
            cancel_label: &cancel_label,
            danger: true,
        },
        move || {
            let (shop, object_id) = split_id(&id);
            crate::downloads::cancel(shop, object_id);
            crate::dialogs::close();
        },
    );
}

/// A new "on-download-progress" packet: speed history, then the page.
pub fn on_progress(packet: Option<&Progress>) {
    if let Some(p) = packet
        && !p.is_checking_files
        && !p.is_downloading_metadata
    {
        with(|s| {
            let peak = s.peaks.entry(p.game_id.clone()).or_insert(0.0);
            if p.download_speed > *peak {
                *peak = p.download_speed;
            }
            let history = s.speeds.entry(p.game_id.clone()).or_default();
            history.push(p.download_speed);
            if history.len() > MAX_SPEED_HISTORY {
                let excess = history.len() - MAX_SPEED_HISTORY;
                history.drain(..excess);
            }
        });
    }
    refresh();
}

/// formatDownloadProgress
pub fn format_progress(progress: f64, digits: usize) -> String {
    if progress == 0.0 || !progress.is_finite() {
        return "0%".into();
    }
    let percentage = progress * 100.0;
    let fixed = format!("{percentage:.digits$}");
    if fixed.parse::<f64>().is_ok_and(|v| v % 1.0 == 0.0) {
        return format!("{}%", percentage.floor() as i64);
    }
    format!("{fixed}%")
}

/// formatBytesToMbps / `${formatBytes(speed)}/s`
fn format_speed(speed: f64, in_megabytes: bool) -> String {
    if in_megabytes {
        format!("{}/s", crate::library_page::format_bytes(speed))
    } else {
        let mbps = speed * 8.0 / 1e6;
        let value = (mbps * 10.0).trunc() / 10.0;
        if value.fract() == 0.0 {
            format!("{} Mbps", value as i64)
        } else {
            format!("{value} Mbps")
        }
    }
}

fn pick_chart_color(dominant: Option<[u8; 3]>) -> Color {
    let Some([r, g, b]) = dominant else {
        return Color::from_rgb_u8(255, 255, 255);
    };
    let [br, bg, bb] = CHART_BACKGROUND;
    let distance = ((r as f64 - br as f64).powi(2)
        + (g as f64 - bg as f64).powi(2)
        + (b as f64 - bb as f64).powi(2))
    .sqrt();
    if distance < COLOR_DISTANCE_THRESHOLD {
        Color::from_rgb_u8(255, 255, 255)
    } else {
        Color::from_rgb_u8(r, g, b)
    }
}

/// A cached image, requested once.
fn image(url: Option<&str>, op: Op) -> Image {
    let Some(url) = url else {
        return Image::default();
    };
    let key = format!("{op:?}|{url}");
    if let Some(image) = with(|s| s.images.get(&key).cloned()).flatten() {
        return image;
    }
    let Some(loader) = with(|s| {
        s.images.insert(key.clone(), Image::default());
        s.loader.clone()
    }) else {
        return Image::default();
    };
    loader.load(Source::Url(url.to_string()), op, move |img| {
        with(|s| s.images.insert(key, img));
        refresh();
    });
    Image::default()
}

/// color.js `average(url, { amount: 1 })`: the mean colour of the image.
fn request_dominant_color(id: &str, url: &str) {
    let first = with(|s| {
        if s.colors.contains_key(id) {
            false
        } else {
            s.colors.insert(id.to_string(), None);
            true
        }
    })
    .unwrap_or(false);
    if !first {
        return;
    }
    let (id, url) = (id.to_string(), url.to_string());
    std::thread::spawn(move || {
        let client = hydra_store::http_client();
        let Some(bytes) = hydra_media::images::fetch(&client, &Source::Url(url)) else {
            return;
        };
        let Some(img) = hydra_media::images::open_bytes(&bytes) else {
            return;
        };
        let rgba = img.thumbnail(256, 256).to_rgba8();
        let (mut sum, mut count) = ([0u64; 3], 0u64);
        for px in rgba.pixels() {
            if px[3] == 0 {
                continue;
            }
            for c in 0..3 {
                sum[c] += px[c] as u64;
            }
            count += 1;
        }
        if count == 0 {
            return;
        }
        let color = [
            (sum[0] / count) as u8,
            (sum[1] / count) as u8,
            (sum[2] / count) as u8,
        ];
        let _ = slint::invoke_from_event_loop(move || {
            with(|s| s.colors.insert(id, Some(color)));
            refresh();
        });
    });
}

struct Entry {
    id: String,
    download: Download,
    game: Value,
}

/// sendDownloadsUpdated / any change: rebuild the page from the records.
pub fn refresh() {
    let Some(ui) = with(|s| s.ui.upgrade()).flatten() else {
        return;
    };
    let Some(db) = shell::db() else { return };
    let packet = crate::downloads::last_packet();
    let prefs: Option<Value> = db.get(keys::USER_PREFERENCES);
    let in_megabytes = prefs
        .as_ref()
        .and_then(|p| p.get("showDownloadSpeedInMegabytes"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let downloads = layout::all(&db);
    let layout_state = layout::normalized(&db, &downloads);
    let mut downloading = Vec::new();
    let mut queued = Vec::new();
    let mut completed = Vec::new();
    for download in downloads {
        let id = layout::id(&download);
        // The library's composed game (shop assets merged), else the raw record.
        let (shop, object_id) = split_id(&id);
        let composed = shell::find_library_game(shop, object_id).and_then(|group| {
            group
                .members
                .iter()
                .find(|m| m.identity_key() == id)
                .map(|m| Value::Object(m.0.clone()))
        });
        let Some(game) = composed.or_else(|| db.get_in::<Value>(keys::GAMES, &id)) else {
            continue;
        };
        if game.get("isDeleted").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        // getRendererDownloadBucket
        let status = layout::status(&download).to_string();
        let live = packet.as_ref().is_some_and(|p| p.game_id == id) && status == "active";
        let extracting_this =
            crate::downloads::extraction().is_some_and(|(visible, _)| visible == id);
        let entry = Entry { id, download, game };
        if status == "removed" {
            continue;
        } else if live || extracting_this || layout::is_active_like(&entry.download) {
            downloading.push(entry);
        } else if layout::is_queued(&entry.download) || layout::is_paused(&entry.download) {
            queued.push(entry);
        } else if layout::is_completed_like(&entry.download) {
            completed.push(entry);
        }
    }
    let ts = |e: &Entry| {
        e.download
            .get("timestamp")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    // Queue order, then paused order, then oldest first.
    let index = |list: &[String], id: &str| list.iter().position(|e| e == id);
    queued.sort_by(|a, b| {
        let (qa, qb) = (
            index(&layout_state.queue_order, &a.id),
            index(&layout_state.queue_order, &b.id),
        );
        let (pa, pb) = (
            index(&layout_state.paused_order, &a.id),
            index(&layout_state.paused_order, &b.id),
        );
        match (qa, qb) {
            (Some(x), Some(y)) => x.cmp(&y),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            _ => match (pa, pb) {
                (Some(x), Some(y)) => x.cmp(&y),
                _ => ts(a)
                    .partial_cmp(&ts(b))
                    .unwrap_or(std::cmp::Ordering::Equal),
            },
        }
    });
    // Finished first, then the most recent on top.
    completed.sort_by(|a, b| {
        let done = |e: &Entry| {
            if e.download.get("progress").and_then(Value::as_f64) == Some(1.0) {
                0
            } else {
                1
            }
        };
        done(a).cmp(&done(b)).then(
            ts(b)
                .partial_cmp(&ts(a))
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });
    with(|s| s.queued_ids = queued.iter().map(|e| e.id.clone()).collect());
    let all_downloads: Vec<Download> = downloading
        .iter()
        .chain(queued.iter())
        .chain(completed.iter())
        .map(|e| e.download.clone())
        .collect();
    crate::download_indicator::update(crate::download_indicator::compute(
        &all_downloads,
        packet.as_ref(),
        &layout_state.queue_order,
    ));

    let d = ui.global::<DownloadsData>();
    d.set_has_downloads(!downloading.is_empty() || !queued.is_empty() || !completed.is_empty());
    d.set_queued_title(shell::tr("downloads.queued_downloads").into());
    d.set_completed_title(shell::tr("downloads.downloads_completed").into());

    // ---- HeroDownloadView
    match downloading.first() {
        Some(entry) => apply_hero(&ui, entry, packet.as_ref(), in_megabytes),
        None => d.set_has_hero(false),
    }

    let card = |entry: &Entry, queued_group: bool| -> DownloadCard {
        let download = &entry.download;
        let game = &entry.game;
        let progress = download
            .get("progress")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let downloader = download
            .get("downloader")
            .and_then(Value::as_i64)
            .and_then(Downloader::from_i64);
        let awaiting = download.get("awaitingDebrid").and_then(Value::as_bool) == Some(true)
            && download.get("debridAutoResume").and_then(Value::as_bool) == Some(true);
        let cover = text(game, "customCoverImageUrl").or_else(|| text(game, "libraryImageUrl"));
        let finished = progress == 1.0
            && (downloader != Some(Downloader::Epic) || layout::status(download) == "complete");
        DownloadCard {
            id: entry.id.clone().into(),
            title: text(game, "title").unwrap_or_default().into(),
            cover: image(cover, Op::MaxWidth(400)),
            downloader: downloader.map(|d| d.name()).unwrap_or_default().into(),
            size:
                match crate::downloads::extraction().filter(|(visible, _)| *visible == entry.id) {
                    Some((_, progress)) => format!(
                        "{} ({}%)",
                        shell::tr("downloads.extracting"),
                        (progress * 100.0).round() as i64
                    ),
                    None => final_size(download, None),
                }
                .into(),
            extracting: crate::downloads::extraction()
                .is_some_and(|(visible, _)| visible == entry.id),
            progress: progress as f32,
            progress_text: if awaiting {
                shell::tr("downloads.waiting_for_debrid")
            } else {
                format_progress(progress, 2)
            }
            .into(),
            seeding: progress == 1.0 && layout::status(download) == "seeding",
            resumable: queued_group
                && (progress != 1.0
                    || (downloader == Some(Downloader::Epic)
                        && layout::status(download) != "complete")),
            step: if finished {
                completed_step(entry)
            } else {
                String::new()
            }
            .into(),
        }
    };
    let queued_cards: Vec<DownloadCard> = queued.iter().map(|e| card(e, true)).collect();
    let completed_cards: Vec<DownloadCard> = completed.iter().map(|e| card(e, false)).collect();
    set_cards(&d.get_queued(), queued_cards, |m| d.set_queued(m));
    set_cards(&d.get_completed(), completed_cards, |m| d.set_completed(m));
}

/// Keep the model when only rows change, so scroll and animations hold.
fn set_cards(
    current: &ModelRc<DownloadCard>,
    cards: Vec<DownloadCard>,
    set: impl FnOnce(ModelRc<DownloadCard>),
) {
    if let Some(model) = current.as_any().downcast_ref::<VecModel<DownloadCard>>()
        && model.row_count() == cards.len()
    {
        for (i, card) in cards.into_iter().enumerate() {
            if model.row_data(i).as_ref() != Some(&card) {
                model.set_row_data(i, card);
            }
        }
        return;
    }
    set(ModelRc::new(VecModel::from(cards)));
}

/// getFinalDownloadSize
fn final_size(download: &Download, live: Option<&Progress>) -> String {
    if let Some(size) = live
        .and_then(|p| p.download.get("fileSize"))
        .and_then(Value::as_f64)
        .filter(|s| *s > 0.0)
    {
        return crate::library_page::format_bytes(size);
    }
    match download
        .get("fileSize")
        .and_then(Value::as_f64)
        .filter(|s| *s > 0.0)
    {
        Some(size) => crate::library_page::format_bytes(size),
        None => "N/A".into(),
    }
}

/// getCompletedDownloadStep (getFinishedDownloadStep without installers yet).
fn completed_step(entry: &Entry) -> String {
    let download = &entry.download;
    let game = &entry.game;
    if download.get("downloader").and_then(Value::as_i64) == Some(Downloader::Epic as i64) {
        return "open-folder".into();
    }
    if download.get("extracting").and_then(Value::as_bool) == Some(true) {
        return "checking".into();
    }
    if text(game, "executablePath").is_some() {
        return if crate::games::is_running(&entry.id) {
            "close"
        } else {
            "play"
        }
        .into();
    }
    let shop = text(game, "shop").unwrap_or_default();
    if shop == "launchbox" {
        let discs = game
            .get("discs")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        return if discs > 0 { "play" } else { "open-folder" }.into();
    }
    let folder = download
        .get("folderName")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    if [".rar", ".zip", ".7z", ".tar", ".r00", ".001"]
        .iter()
        .any(|ext| folder.ends_with(ext))
    {
        return "extract".into();
    }
    if download.get("installerRunning").and_then(Value::as_bool) == Some(true) {
        return "installing".into();
    }
    // TODO(downloads): installer availability (useInstallerAvailability) for "install".
    "select-executable".into()
}

fn apply_hero(ui: &AppWindow, entry: &Entry, packet: Option<&Progress>, in_megabytes: bool) {
    let d = ui.global::<DownloadsData>();
    let game = &entry.game;
    let download = &entry.download;
    let live = packet.filter(|p| p.game_id == entry.id);
    // TODO(downloads): extraction progress (extraction.visibleId).
    let extraction = crate::downloads::extraction().filter(|(visible, _)| *visible == entry.id);
    let extracting = extraction.is_some();
    let downloading = live.is_some() && !extracting;
    let speed = if downloading {
        live.map_or(0.0, |p| p.download_speed)
    } else {
        0.0
    };
    let key = packet.map_or(entry.id.clone(), |p| p.game_id.clone());
    let (history, stored_peak, color) = with(|s| {
        (
            s.speeds.get(&key).cloned().unwrap_or_default(),
            s.peaks.get(&key).copied(),
            s.colors.get(&entry.id).copied().flatten(),
        )
    })
    .unwrap_or_default();
    let peak = stored_peak.filter(|p| *p > 0.0).unwrap_or(speed);
    let progress = if let Some((_, extraction_progress)) = extraction {
        extraction_progress
    } else if downloading {
        live.map_or(0.0, |p| p.progress)
    } else {
        download
            .get("progress")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };

    let hero_url = text(game, "customHeroImageUrl")
        .or_else(|| text(game, "libraryHeroImageUrl"))
        .or_else(|| text(game, "libraryImageUrl"));
    if let Some(url) = hero_url {
        request_dominant_color(&entry.id, url);
    }
    let logo_url = text(game, "customLogoImageUrl").or_else(|| text(game, "logoImageUrl"));

    d.set_has_hero(true);
    d.set_hero_id(entry.id.clone().into());
    d.set_hero_title(text(game, "title").unwrap_or_default().into());
    d.set_hero_image(image(hero_url, Op::MaxWidth(1920)));
    // backdrop-filter blur(12px) / blur(8px) of the art behind the glass
    d.set_hero_blur(image(
        hero_url,
        Op::Blur {
            shrink: 4,
            sigma: 2.5,
        },
    ));
    d.set_hero_logo(image(logo_url, Op::Full));
    d.set_hero_downloading(downloading);
    d.set_hero_extracting(extracting);

    let status = match live {
        _ if extracting => shell::tr("downloads.extracting"),
        Some(p) if p.is_checking_files => shell::tr("downloads.checking_files"),
        Some(p) if p.is_recovering => {
            let percent = format!("{}%", (p.recovery_progress * 100.0).round() as i64);
            shell::tr_with("downloads.recovering", &[("percentage", percent.into())])
        }
        Some(p) if p.is_reconnecting => shell::tr("downloads.reconnecting"),
        _ => String::new(),
    };
    d.set_hero_status(status.to_uppercase().into());
    let bytes = if downloading {
        live.and_then(|p| p.download.get("bytesDownloaded"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    } else {
        download
            .get("bytesDownloaded")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    d.set_hero_size(
        format!(
            "{} / {}",
            crate::library_page::format_bytes(bytes),
            final_size(download, live)
        )
        .into(),
    );

    // HeroDownloadTime
    let eta = if !downloading || live.is_some_and(|p| p.is_recovering || p.is_checking_files) {
        String::new()
    } else {
        let p = live.expect("downloading");
        let remaining = p.time_remaining;
        if remaining > 0.0 && remaining.is_finite() {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            hydra_i18n::date::format_distance(
                &shell::shop_language(),
                now + remaining as i64,
                now,
                true,
            )
        } else if p.is_downloading_metadata
            && download.get("downloader").and_then(Value::as_i64)
                == Some(Downloader::Torrent as i64)
        {
            shell::tr("downloads.downloading_metadata")
        } else {
            shell::tr("game_details.calculating_eta")
        }
    };
    d.set_hero_eta(eta.into());
    d.set_hero_progress(progress as f32);
    let percentage = format_progress(progress, 2);
    set_percentage_chars(&d, &percentage);
    d.set_hero_percentage(percentage.into());
    d.set_hero_network(
        if downloading {
            format_speed(speed, in_megabytes)
        } else {
            "0 B/s".into()
        }
        .into(),
    );
    d.set_hero_peak(
        if peak > 0.0 {
            format_speed(peak, in_megabytes)
        } else {
            "0 B/s".into()
        }
        .into(),
    );
    let downloader = download
        .get("downloader")
        .and_then(Value::as_i64)
        .and_then(Downloader::from_i64);
    d.set_hero_downloader(downloader.map(|d| d.name()).unwrap_or_default().into());
    let peers = match live {
        Some(p)
            if downloader == Some(Downloader::Torrent) && (p.num_seeds > 0 || p.num_peers > 0) =>
        {
            format!("Seeds: {}, Peers: {}", p.num_seeds, p.num_peers)
        }
        _ => String::new(),
    };
    d.set_hero_peers(SharedString::from(peers));
    let max = if peak > 0.0 {
        peak
    } else {
        history.iter().copied().fold(1.0, f64::max)
    };
    let scaled: Vec<f32> = history.iter().map(|s| (s / max) as f32).collect();
    d.set_hero_speeds(ModelRc::new(VecModel::from(scaled)));
    d.set_hero_color(pick_chart_color(color));
    with(|s| s.hero_art = hero_url.map(str::to_string));
}

/// Update the fixed 8 character slots in place.
fn set_percentage_chars(d: &DownloadsData, text: &str) {
    let chars: Vec<SharedString> = (0..8)
        .map(|i| {
            text.chars()
                .nth(i)
                .map(|c| c.to_string())
                .unwrap_or_default()
                .into()
        })
        .collect();
    let current = d.get_hero_percentage_chars();
    if let Some(model) = current.as_any().downcast_ref::<VecModel<SharedString>>()
        && model.row_count() == chars.len()
    {
        for (i, c) in chars.into_iter().enumerate() {
            if model.row_data(i).as_ref() != Some(&c) {
                model.set_row_data(i, c);
            }
        }
        return;
    }
    d.set_hero_percentage_chars(ModelRc::new(VecModel::from(chars)));
}

/// Queue order of the queued list (for "move up / down").
pub fn queued_ids() -> Vec<String> {
    with(|s| s.queued_ids.clone()).unwrap_or_default()
}
