//! pages/settings Integrations: the Steam, Epic Games and RetroAchievements
//! cards (settings-steam.tsx, settings-epic.tsx, settings-retroachievements.tsx
//! over settings-integration-card.tsx) and what they call in the main process
//! (start-steam-oauth.ts, disconnect-steam.ts, the Epic connection state,
//! the RetroAchievements endpoints).
//!
//! Each card keeps its React state here; `render` turns it into the
//! `IntegrationCard` rows ui/pages/settings/integrations.slint draws.

use std::cell::RefCell;

use hydra_core::api::{ApiError, Options};
use hydra_core::integrations::{
    self as logic, EpicState, OpenIdReturn, RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT, RaStatus,
    SteamStatus, SteamSync, SteamView,
};
use hydra_db::keys;
use hydra_media::images::Op;
use serde_json::{Map, Value, json};
use slint::{ComponentHandle, Image, Model, ModelRc, SharedString, VecModel};

use crate::{
    AppWindow, IntegrationAction, IntegrationCard, IntegrationsData, prefs, shell, steam_sync,
    toast,
};

const STEAM_ENDPOINT: &str = "/profile/integrations/steam";
const RA_USER_PIC_URL: &str = "https://media.retroachievements.org/UserPic";

#[derive(Default)]
struct Steam {
    loading: bool,
    submitting: bool,
    disconnecting: bool,
    status: SteamStatus,
    avatar: Image,
    avatar_url: String,
    did_auto_start: bool,
    was_connected: bool,
}

#[derive(Default)]
struct Epic {
    loading: bool,
    submitting: bool,
    disconnecting: bool,
    state: Option<EpicState>,
    request_error: Option<String>,
    /// EpicSyncState (getEpicSyncState / onEpicSyncProgress)
    sync: hydra_epic::sync::SyncState,
    /// connection.latestSyncRun.status === "PENDING"
    latest_run_pending: bool,
}

#[derive(Default)]
struct Ra {
    loading: bool,
    submitting: bool,
    refreshing: bool,
    status: RaStatus,
    last_checked: Option<i64>,
    avatar: Image,
    avatar_for: String,
}

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    steam: Steam,
    epic: Epic,
    ra: Ra,
    note_width: f32,
    // the card mounted at least once (SettingsSteam's mount effects)
    mounted: bool,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn t(key: &str) -> String {
    shell::tr(&format!("settings.{key}"))
}

fn language() -> String {
    shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// SettingsIntegrationLastSynced
fn last_synced(at: Option<i64>) -> String {
    match at {
        Some(ms) => shell::tr_with(
            "settings.integration_last_synced",
            &[(
                "date",
                hydra_i18n::date::format_date_time(&language(), ms)
                    .as_str()
                    .into(),
            )],
        ),
        None => t("integration_never_synced"),
    }
}

fn iso_ms(text: Option<&str>) -> Option<i64> {
    text.and_then(hydra_core::library::parse_iso_millis)
}

fn api_message(error: &ApiError) -> Option<String> {
    crate::retroachievements::api_message(error)
}

pub fn init(ui: &AppWindow) {
    with(|s| s.ui = ui.as_weak());
    let data = ui.global::<IntegrationsData>();
    data.on_action(|card, action| match card.as_str() {
        "steam" => steam_action(&action),
        "epic" => epic_action(&action),
        "retroachievements" => ra_action(&action),
        _ => {}
    });
    data.on_hint(|card| {
        if card == "retroachievements" && !with(|s| s.ra.submitting) {
            crate::retroachievements::open();
        }
    });
    data.on_guide(|article| eprintln!("TODO(help): open guide article {article}"));
    data.on_note_resized(|width| {
        let changed = with(|s| {
            let changed = (s.note_width - width).abs() > 0.5;
            s.note_width = width;
            changed
        });
        if changed {
            // not while Slint instantiates the row that reported it
            slint::Timer::single_shot(std::time::Duration::ZERO, render);
        }
    });
}

fn ui() -> Option<AppWindow> {
    with(|s| s.ui.upgrade())
}

pub fn focus_main_window() {
    if let Some(ui) = ui() {
        use slint::winit_030::WinitWindowAccessor;
        ui.window().with_winit_window(|w| w.focus_window());
    }
}

/// The Integrations tab opened (the cards mount): fetch every status.
pub fn refresh() {
    let first = with(|s| !std::mem::replace(&mut s.mounted, true));
    steam_refresh(SteamRefresh {
        silent: false,
        toast_on_connect: false,
        from_mount: true,
        from_focus: false,
    });
    // useEffect: getSteamSyncState for an idle card
    let _ = first;
    epic_refresh(true);
    ra_refresh(false, false);
    render();
}

/// The settings window regained focus (SettingsSteam listens for "focus").
#[allow(dead_code)]
pub fn on_window_focus() {
    if ui().is_some_and(|ui| {
        ui.global::<crate::SettingsData>().get_category() == "integrations"
            && crate::nav::current().is_some_and(|p| p.starts_with("/settings"))
    }) {
        steam_refresh(SteamRefresh {
            silent: true,
            toast_on_connect: false,
            from_mount: false,
            from_focus: true,
        });
    }
}

// ---- Steam --------------------------------------------------------------

#[derive(Clone, Copy, Default)]
struct SteamRefresh {
    silent: bool,
    toast_on_connect: bool,
    from_mount: bool,
    from_focus: bool,
}

/// refreshStatus
fn steam_refresh(options: SteamRefresh) {
    if !shell::signed_in() {
        with(|s| {
            s.steam.status = SteamStatus::default();
            s.steam.loading = false;
            s.steam.did_auto_start = false;
            s.steam.was_connected = false;
        });
        render();
        return;
    }
    if with(|s| s.steam.disconnecting) {
        // a disconnect is pending: its own refresh follows
        with(|s| s.steam.loading = false);
        render();
        return;
    }
    if !options.silent {
        with(|s| s.steam.loading = true);
        render();
    }
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let result = api.get(STEAM_ENDPOINT, &[], Options::default());
        let _ = slint::invoke_from_event_loop(move || {
            match result {
                Ok(value) => {
                    let status = SteamStatus::parse(&value);
                    steam_sync::reconcile_persisted_run(status.latest_run_status());
                    let connected = status.connected;
                    let became_connected = with(|s| {
                        let became = !s.steam.was_connected && connected;
                        s.steam.was_connected = connected;
                        if !connected {
                            s.steam.did_auto_start = false;
                        }
                        s.steam.status = status.clone();
                        became
                    });
                    if options.toast_on_connect && connected {
                        toast::success(&t("steam_account_linked"));
                    }
                    load_steam_avatar(&status.avatar_url);
                    if options.from_mount
                        || options.toast_on_connect
                        || (options.from_focus && became_connected)
                    {
                        steam_try_auto_start(&status);
                    }
                }
                Err(error) => {
                    eprintln!("Steam integration status: {error}");
                    if !options.silent {
                        with(|s| s.steam.status = SteamStatus::default());
                    }
                }
            }
            with(|s| s.steam.loading = false);
            render();
        });
    });
}

fn load_steam_avatar(url: &str) {
    let changed = with(|s| {
        if s.steam.avatar_url == url {
            return false;
        }
        s.steam.avatar_url = url.to_string();
        // setAvatarError(false) for a new account
        s.steam.avatar = Image::default();
        true
    });
    if !changed || url.is_empty() {
        return;
    }
    let Some((loader, scale)) = shell::loader() else {
        return;
    };
    let wanted = url.to_string();
    loader.load(
        url.to_string(),
        Op::MaxWidth((38.0 * scale).ceil() as u32),
        move |img| {
            let current = with(|s| {
                if s.steam.avatar_url == wanted {
                    s.steam.avatar = img;
                    true
                } else {
                    false
                }
            });
            if current {
                render();
            }
        },
    );
}

/// tryAutoStart
fn steam_try_auto_start(status: &SteamStatus) {
    if with(|s| s.steam.did_auto_start) {
        return;
    }
    let local = steam_sync::state();
    let idle = !local.is_syncing();
    if !logic::should_auto_start_steam_sync(
        status.connected,
        if status.connected {
            status.last_synced_at.as_deref()
        } else {
            None
        },
        status.latest_run_status(),
        idle,
        idle && local.requires_reconnect(),
    ) {
        return;
    }
    with(|s| s.steam.did_auto_start = true);
    steam_sync::start(steam_sync::Origin::Manual);
}

/// onSteamSyncProgress
pub fn on_steam_sync_progress(_state: &SteamSync) {
    render();
}

/// on-steam-connected / on-steam-connect-error (the OpenID window or the
/// `hydralauncher://steam-connected` link), then redirect to the tab.
pub fn on_steam_openid_return(result: OpenIdReturn) {
    match result {
        OpenIdReturn::Success => {
            // completeSteamOpenIdConnection
            steam_sync::clear_reconnect_required();
            with(|s| s.steam.did_auto_start = false);
            crate::nav::navigate("/settings?tab=integrations");
            steam_refresh(SteamRefresh {
                silent: true,
                toast_on_connect: true,
                ..Default::default()
            });
        }
        OpenIdReturn::Error(code) => {
            toast::error(&t(if code == "already-linked" {
                "steam_account_already_linked"
            } else {
                "steam_connect_error"
            }));
            crate::nav::navigate("/settings?tab=integrations");
        }
    }
    focus_main_window();
}

/// The `hydralauncher://steam-connected` deep link (index.ts).
pub fn handle_steam_connected_link(uri: &str) {
    crate::steam_openid::close();
    let result = logic::parse_steam_openid_return(uri).unwrap_or(OpenIdReturn::Success);
    on_steam_openid_return(result);
}

fn steam_action(action: &str) {
    match action {
        "sign-in" => crate::auth::open(crate::auth::Page::SignIn),
        "connect" => steam_connect(),
        "sync" => {
            let state = steam_sync::start(steam_sync::Origin::Manual);
            let _ = state;
            render();
        }
        "cancel" => steam_sync::cancel(),
        "disconnect" => steam_confirm_disconnect(),
        _ => {}
    }
}

/// handleConnect → startSteamOAuth(lng)
fn steam_connect() {
    with(|s| s.steam.submitting = true);
    render();
    let Some(api) = shell::api() else { return };
    let lng = language();
    std::thread::spawn(move || {
        let result = api.get(
            "/profile/oauth/steam/start",
            &[
                ("return_to", logic::STEAM_CONNECTED_DEEP_LINK.to_string()),
                ("lng", lng),
            ],
            Options::default(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            with(|s| s.steam.submitting = false);
            match result {
                Ok(value) => match value.get("authorizationUrl").and_then(Value::as_str) {
                    Some(url) => crate::steam_openid::open(url),
                    None => toast::error(&t("steam_connect_error")),
                },
                Err(error) => {
                    eprintln!("Failed to start Steam OAuth: {error}");
                    let message = api_message(&error);
                    toast::error(&t(logic::steam_error_key(
                        message.as_deref(),
                        "steam_connect_error",
                    )));
                }
            }
            render();
        });
    });
}

/// The delete-data modal (connected: "Disconnect Steam?"; a preserved
/// snapshot: "Remove imported data").
fn steam_confirm_disconnect() {
    let connected = with(|s| s.steam.status.connected);
    let title = t(if connected {
        "steam_delete_confirm_title"
    } else {
        "steam_remove_imported_data"
    });
    let confirm = t(if connected {
        "steam_delete_confirm_button"
    } else {
        "steam_remove_imported_data"
    });
    crate::dialogs::confirm(
        crate::dialogs::Confirm {
            title: &title,
            description: &t("steam_delete_confirm_description"),
            body: "",
            confirm_label: &confirm,
            cancel_label: &t("cancel"),
            danger: true,
        },
        || {
            crate::dialogs::close();
            steam_disconnect();
        },
    );
}

/// handleDisconnect → disconnectSteam(deleteImportedData: true)
fn steam_disconnect() {
    with(|s| {
        s.steam.submitting = true;
        s.steam.disconnecting = true;
    });
    render();
    let (Some(api), Some(db)) = (shell::api(), shell::db()) else {
        return;
    };
    std::thread::spawn(move || {
        let result = disconnect_steam(&api, &db, true);
        let _ = slint::invoke_from_event_loop(move || {
            with(|s| {
                s.steam.disconnecting = false;
                s.steam.submitting = false;
            });
            match result {
                Ok(()) => {
                    toast::success(&t("steam_account_unlinked"));
                    shell::load_library();
                    steam_refresh(SteamRefresh {
                        silent: true,
                        ..Default::default()
                    });
                }
                Err(message) => toast::error(&t(logic::steam_error_key(
                    message.as_deref(),
                    "steam_disconnect_error",
                ))),
            }
            render();
        });
    });
}

/// events/user/disconnect-steam.ts: DELETE /profile/oauth/steam, then drop
/// the imported Steam data from the local library.
fn disconnect_steam(
    api: &hydra_core::api::HydraApi,
    db: &hydra_db::Db,
    delete_imported: bool,
) -> Result<(), Option<String>> {
    let mut steam_only: Vec<String> = Vec::new();
    if delete_imported {
        // fetchRemoteProfileGames
        if let Ok(Value::Array(games)) = api.get("/profile/games", &[], Options::default()) {
            steam_only = logic::collect_steam_only_object_ids(&games);
        }
    }
    api.delete(
        &format!("/profile/oauth/steam?deleteImportedData={delete_imported}"),
        Options::default(),
    )
    .map_err(|error| {
        eprintln!("Failed to disconnect Steam: {error}");
        api_message(&error).or(Some("steam-disconnect-failed".into()))
    })?;
    let mut restore: Vec<(String, Value)> = Vec::new();
    for (key, game) in db.entries::<Value>(keys::GAMES).unwrap_or_default() {
        let Some(mut map) = game.as_object().cloned() else {
            continue;
        };
        if !delete_imported {
            if map.get("hasActiveSteamImport").and_then(Value::as_bool) == Some(true) {
                map.insert("hasActiveSteamImport".into(), json!(false));
                let _ = db.put_in(keys::GAMES, &key, &Value::Object(map));
            }
            continue;
        }
        if logic::has_imported_steam_data(&map, &steam_only) {
            let (cleanup, fallback) = logic::steam_imported_cleanup(&map);
            restore.push((key.clone(), fallback));
            // TODO(achievements): AchievementMemoryStore.delete(shop, objectId)
            for (field, value) in cleanup {
                map.insert(field, value);
            }
            let _ = db.put_in(keys::GAMES, &key, &Value::Object(map));
        }
    }
    if !delete_imported {
        return Ok(());
    }
    // clearImportedSteamGames
    let downloads: Vec<String> = db
        .entries::<Value>(keys::DOWNLOADS)
        .unwrap_or_default()
        .into_iter()
        .map(|(key, _)| key)
        .collect();
    for (key, game) in db.entries::<Value>(keys::GAMES).unwrap_or_default() {
        let Some(mut map) = game.as_object().cloned() else {
            continue;
        };
        if !logic::should_remove_imported_steam_game(&map, &steam_only) || downloads.contains(&key)
        {
            continue;
        }
        // updateGameExecutablePath(game, null) + the custom artwork
        map.insert("executablePath".into(), Value::Null);
        map.insert("isDeleted".into(), json!(true));
        for field in [
            "customIconUrl",
            "customLogoImageUrl",
            "customHeroImageUrl",
            "customCoverImageUrl",
        ] {
            map.insert(field.into(), Value::Null);
        }
        let _ = db.put_in(keys::GAMES, &key, &Value::Object(map));
        let _ = db.delete_in(keys::ARTWORK_SELECTION, &key);
    }
    // TODO(library-sync): mergeWithRemoteGames. Without the merge, Electron
    // restores the local last-played values (its merge-failed path).
    for (key, last_played) in restore {
        if let Some(Value::Object(mut map)) = db.get_in::<Value>(keys::GAMES, &key)
            && map.get("isDeleted").and_then(Value::as_bool) != Some(true)
        {
            map.insert("lastTimePlayed".into(), last_played);
            let _ = db.put_in(keys::GAMES, &key, &Value::Object(map));
        }
    }
    Ok(())
}

fn steam_card() -> IntegrationCard {
    let signed_in = shell::signed_in();
    let sync = steam_sync::state();
    with(|s| {
        let steam = &s.steam;
        let (view, status_key, tone) = logic::steam_presentation(&steam.status, &sync);
        let account = steam.status.has_account();
        let syncing = sync.is_syncing();
        let busy = steam.submitting || steam.disconnecting;
        let needs_reconnect = view == SteamView::ReconnectRequired;
        let loading = signed_in && steam.loading;
        let mut card = base_card("steam", &t("steam"), &t(status_key), tone, loading);
        // renderActions
        let mut actions = Vec::new();
        if !signed_in {
            actions.push(action("sign-in", &t("steam_sign_in"), "primary", "", true));
        } else if !loading {
            if !account {
                actions.push(action(
                    "connect",
                    &t("integration_connect"),
                    "primary",
                    "link",
                    !busy,
                ));
            } else if view == SteamView::SnapshotPreserved {
                actions.push(action(
                    "connect",
                    &t("integration_reconnect"),
                    "primary",
                    "link",
                    !busy && !syncing,
                ));
                actions.push(action(
                    "disconnect",
                    &t("steam_remove_imported_data"),
                    "danger",
                    "",
                    !busy && !syncing,
                ));
            } else {
                if needs_reconnect {
                    actions.push(action(
                        "connect",
                        &t("integration_reconnect"),
                        "primary",
                        "link",
                        !busy,
                    ));
                } else if syncing {
                    actions.push(action(
                        "cancel",
                        &t("cancel"),
                        "outline",
                        "",
                        !matches!(sync, SteamSync::Cancelling { .. }),
                    ));
                } else {
                    actions.push(action(
                        "sync",
                        &t("integration_sync"),
                        "outline",
                        "sync",
                        !busy,
                    ));
                }
                actions.push(action(
                    "disconnect",
                    &t("integration_disconnect"),
                    "danger",
                    "",
                    !busy && !syncing,
                ));
            }
        }
        card.actions = ModelRc::new(VecModel::from(actions));
        // renderBody
        if !signed_in {
            card.plain = t("steam_sign_in_required").into();
        } else if account {
            card.show_profile = true;
            card.avatar = steam.avatar.clone();
            card.username = steam.status.username.clone().into();
            if steam.status.connected {
                card.meta = last_synced(iso_ms(steam.status.last_synced_at.as_deref())).into();
            }
            if steam.disconnecting {
                card.progress = true;
                card.progress_label = t(if steam.status.connected {
                    "steam_disconnecting"
                } else {
                    "steam_removing_imported_data"
                })
                .into();
            } else if steam.status.connected && needs_reconnect {
                card.messages = strings(&[t("steam_error_session_required")]);
            } else if steam.status.connected
                && syncing
                && let Some(progress) = logic::steam_progress(&sync)
            {
                card.progress = true;
                card.progress_label = t(progress.label_key).into();
                if progress.show_count
                    && let SteamSync::Running {
                        games_found,
                        games_processed,
                        ..
                    } = &sync
                {
                    card.progress_count = shell::tr_with(
                        "settings.steam_sync_progress",
                        &[
                            ("processed", (*games_processed as f64).into()),
                            ("found", (*games_found as f64).into()),
                        ],
                    )
                    .into();
                }
                if let Some(percentage) = progress.percentage {
                    card.progress_determinate = true;
                    card.progress_percent = percentage as f32;
                }
            }
        } else {
            card.description = t("steam_integration_description").into();
        }
        card
    })
}

// ---- Epic ---------------------------------------------------------------

/// The integration's state as the card sees it (EpicConnectionState).
fn epic_view(state: &crate::epic::PublicState) -> EpicState {
    let connection = state.connected();
    EpicState {
        hydra_logged_in: state.hydra_logged_in,
        available: state.reason.is_none(),
        availability_reason: state.reason.clone(),
        connected: connection.is_some(),
        connection_id: connection
            .map(|c| c.connection_id.clone())
            .unwrap_or_default(),
        display_name: connection
            .map(|c| c.display_name.clone())
            .unwrap_or_default(),
        last_synced_at: connection.and_then(|c| c.last_synced_at.clone()),
        confirmed: state.confirmed,
        session_state: state.session_state.as_str().into(),
        operation: state.operation_status().unwrap_or_default().into(),
        error: state.error.clone(),
    }
}

/// isEpicStateForUser
fn epic_for_user(state: &crate::epic::PublicState) -> bool {
    let user = crate::epic::auth_context().map(|c| c.user_id);
    state.hydra_user_id == user || (!state.hydra_logged_in && state.hydra_user_id.is_none())
}

/// onEpicConnectionChanged → applyState: the toasts and the card.
pub fn on_epic_state(previous: Option<&crate::epic::PublicState>, next: &crate::epic::PublicState) {
    if !epic_for_user(next) {
        return;
    }
    if let Some(previous) = previous {
        if previous.hydra_user_id == next.hydra_user_id
            && previous.operation_status() == Some("connecting")
            && next.operation.is_none()
            && next.confirmed
            && next.connected().is_some()
            && next.session_state == hydra_epic::store::SessionState::Ready
            && next.error.is_none()
        {
            toast::success(&t("epic_account_linked"));
        }
        // getEpicAuthFailure
        if let Some(error) = next.error.as_deref()
            && previous
                .operation_status()
                .is_some_and(|s| s != "disconnecting")
            && previous.hydra_user_id == next.hydra_user_id
            && next.hydra_logged_in
            && next.operation.is_none()
            && error != "operation-cancelled"
        {
            toast::error(&t(logic::epic_error_key(error)));
        }
    }
    with(|s| {
        s.epic.state = Some(epic_view(next));
        s.epic.latest_run_pending = next
            .connected()
            .and_then(|c| c.latest_sync_run.as_ref())
            .is_some_and(|r| r.status == "PENDING");
        s.epic.request_error = None;
        s.epic.loading = false;
    });
    render();
}

/// onEpicSyncProgress
pub fn on_epic_sync(state: &hydra_epic::sync::SyncState) {
    let stale = with(|s| {
        s.epic.state.as_ref().is_some_and(|v| {
            v.connected
                && state
                    .connection_id
                    .as_ref()
                    .is_some_and(|id| *id != v.connection_id)
        })
    });
    if stale {
        return;
    }
    with(|s| s.epic.sync = state.clone());
    render();
}

/// onEpicSyncFinished: toasts for a manual sync, then refreshStatus.
pub fn on_epic_sync_finished(finished: &hydra_epic::sync::Finished) {
    let same = with(|s| {
        s.epic
            .state
            .as_ref()
            .is_some_and(|v| v.connected && v.connection_id == finished.connection_id)
    });
    if !same {
        return;
    }
    if finished.origin == "manual" {
        if finished.ok {
            let summary = finished.achievement_summary.as_ref();
            let partial = summary
                .and_then(|s| s.get("status"))
                .and_then(Value::as_str)
                == Some("partial");
            let pending = summary
                .and_then(|s| s.get("gamesPending"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            toast::success(&shell::tr_with(
                if partial {
                    "settings.epic_sync_partial"
                } else {
                    "settings.epic_sync_success"
                },
                &[("count", pending.into())],
            ));
        } else if finished.error.as_deref() != Some("operation-cancelled") {
            toast::error(&t(if finished.requires_merge {
                "epic_sync_merge_pending"
            } else {
                logic::epic_error_key(finished.error.as_deref().unwrap_or("network"))
            }));
        }
    }
    epic_refresh(false);
}

/// refreshStatus → getEpicConnection
fn epic_refresh(show_loading: bool) {
    let signed_in = shell::signed_in();
    if show_loading {
        with(|s| s.epic.loading = signed_in);
        render();
    }
    if !signed_in {
        with(|s| {
            s.epic.loading = false;
            s.epic.state = None;
        });
        render();
        return;
    }
    crate::epic::get_connection(Some(Box::new(|state| {
        with(|s| {
            if epic_for_user(&state) {
                s.epic.state = Some(epic_view(&state));
            }
            s.epic.loading = false;
            if state.error.as_deref() == Some("network") {
                s.epic.request_error = Some("network".into());
            }
        });
        render();
    })));
}

/// runOperation: the submit lock, the result toasts and a refresh.
fn epic_run(start: impl FnOnce(Box<dyn FnOnce(Result<(), String>)>), disconnected: bool) {
    if with(|s| s.epic.submitting) {
        return;
    }
    with(|s| {
        s.epic.submitting = true;
        s.epic.disconnecting = disconnected;
        s.epic.request_error = None;
    });
    render();
    start(Box::new(move |result| {
        with(|s| {
            s.epic.submitting = false;
            s.epic.disconnecting = false;
        });
        match result {
            Err(error) => {
                if error != "operation-cancelled" {
                    with(|s| s.epic.request_error = Some(error.clone()));
                    toast::error(&t(logic::epic_error_key(&error)));
                }
            }
            Ok(()) if disconnected => toast::success(&t("epic_account_unlinked")),
            Ok(()) => {}
        }
        epic_refresh(false);
    }));
}

fn epic_action(action: &str) {
    match action {
        "sign-in" => crate::auth::open(crate::auth::Page::SignIn),
        // handleConnect → startEpicAuth
        "connect" => epic_run(|done| crate::epic::start_auth(done), false),
        // handleSync → startEpicSync
        "sync" => {
            let connection = with(|s| {
                s.epic
                    .state
                    .as_ref()
                    .filter(|v| v.connected)
                    .map(|v| v.connection_id.clone())
            });
            if let Some(connection) = connection {
                crate::epic::start_sync(&connection);
            }
        }
        // handleCancel (sign-in) / handleCancelSync
        "cancel" => {
            if let Some(id) = crate::epic::operation_id() {
                crate::epic::cancel_auth(&id, |result| {
                    if let Err(error) = result
                        && error != "operation-cancelled"
                    {
                        with(|s| s.epic.request_error = Some(error));
                    }
                    with(|s| s.epic.submitting = false);
                    epic_refresh(false);
                });
            } else if let Some(connection) = with(|s| {
                s.epic
                    .state
                    .as_ref()
                    .filter(|v| v.connected)
                    .map(|v| v.connection_id.clone())
            }) {
                crate::epic::cancel_sync(&connection);
            }
        }
        "check" => epic_refresh(true),
        "disconnect" => epic_confirm_disconnect(),
        _ => {}
    }
}

fn epic_confirm_disconnect() {
    let connection_id = with(|s| {
        s.epic
            .state
            .as_ref()
            .filter(|st| st.connected)
            .map(|st| st.connection_id.clone())
    });
    let Some(connection_id) = connection_id else {
        return;
    };
    crate::dialogs::confirm(
        crate::dialogs::Confirm {
            title: &t("epic_disconnect_title"),
            description: "",
            body: &t("epic_disconnect_description"),
            confirm_label: &t("integration_disconnect"),
            cancel_label: &t("cancel"),
            danger: true,
        },
        move || {
            crate::dialogs::close();
            let connection_id = connection_id.clone();
            epic_run(
                move |done| crate::epic::disconnect(connection_id, done),
                true,
            );
        },
    );
}

fn epic_card() -> IntegrationCard {
    let signed_in = shell::signed_in();
    with(|s| {
        let epic = &s.epic;
        let visible = epic.state.as_ref();
        let hydra_logged_in = signed_in && visible.is_none_or(|v| v.hydra_logged_in);
        let presentation = logic::epic_presentation(visible, hydra_logged_in);
        let connected = visible.is_some_and(|v| v.connected);
        let operation = visible.map(|v| v.operation.as_str()).unwrap_or_default();
        let disconnecting = epic.disconnecting || operation == "disconnecting";
        let sync = &epic.sync;
        let requires_reconnect = presentation.requires_reconnect || sync.requires_reconnect;
        let syncing = connected
            && (!sync.is_idle()
                || (sync.error.as_deref() == Some("sync-active") && epic.latest_run_pending));
        let (status_key, tone) = if disconnecting {
            ("epic_status_disconnecting", "neutral")
        } else if sync.requires_reconnect {
            ("epic_status_reconnect_required", "warning")
        } else {
            (presentation.status_key, presentation.tone)
        };
        let mut card = base_card("epic", &t("epic_games"), &t(status_key), tone, epic.loading);
        let mut actions = Vec::new();
        if !hydra_logged_in {
            actions.push(action("sign-in", &t("steam_sign_in"), "primary", "", true));
        } else if disconnecting {
        } else if !operation.is_empty() {
            actions.push(action("cancel", &t("cancel"), "outline", "", true));
        } else {
            if syncing {
                actions.push(action(
                    "cancel",
                    &t("cancel"),
                    "outline",
                    "",
                    sync.status != "cancelling" && !epic.submitting,
                ));
            } else if !connected || requires_reconnect {
                actions.push(action(
                    "connect",
                    &t(if connected {
                        "integration_reconnect"
                    } else {
                        "integration_connect"
                    }),
                    "primary",
                    "link",
                    presentation.can_authenticate && !epic.submitting,
                ));
            } else {
                actions.push(action(
                    "sync",
                    &t("integration_sync"),
                    "outline",
                    "sync",
                    !epic.submitting && visible.is_some_and(|v| v.confirmed),
                ));
            }
            if visible.is_some_and(|v| !v.confirmed)
                || visible.and_then(|v| v.availability_reason.as_deref()) == Some("api-unavailable")
                || epic.request_error.as_deref() == Some("network")
            {
                actions.push(action(
                    "check",
                    &t("epic_check_connection"),
                    "outline",
                    "",
                    !epic.submitting,
                ));
            }
            if connected {
                actions.push(action(
                    "disconnect",
                    &t("integration_disconnect"),
                    "danger",
                    "",
                    presentation.can_disconnect && !epic.submitting,
                ));
            }
        }
        card.actions = ModelRc::new(VecModel::from(actions));
        if connected && let Some(v) = visible {
            card.show_profile = true;
            card.username = v.display_name.clone().into();
            card.meta = last_synced(iso_ms(v.last_synced_at.as_deref())).into();
        } else {
            card.description = t("epic_description").into();
        }
        let mut messages = Vec::new();
        if disconnecting {
            card.progress = true;
            card.progress_label = t("epic_status_disconnecting").into();
        } else if !sync.is_idle() {
            card.progress = true;
            let phase = if sync.status == "cancelling" {
                "cancelling"
            } else {
                sync.phase.map_or("starting", |p| p.as_str())
            };
            card.progress_label = t(&format!("epic_sync_{phase}")).into();
            if let Some(total) = sync.total.filter(|t| *t > 0)
                && matches!(
                    sync.phase,
                    Some(
                        hydra_epic::sync::Phase::Publishing
                            | hydra_epic::sync::Phase::Achievements
                            | hydra_epic::sync::Phase::Merging
                    )
                )
            {
                card.progress_count = format!("{} / {total}", sync.processed).into();
            }
        }
        let show_reconnect = connected && requires_reconnect;
        if show_reconnect {
            messages.push(t("epic_reconnect_description"));
        }
        if operation == "awaiting-login" {
            messages.push(t("epic_login_in_window"));
        }
        let error = epic
            .request_error
            .clone()
            .or_else(|| sync.error.clone())
            .or_else(|| visible.and_then(|v| v.error.clone()))
            .or_else(|| visible.and_then(|v| v.availability_reason.clone()));
        if let Some(error) =
            error.filter(|e| e != "operation-cancelled" && e != "hydra-auth-required")
        {
            let key = logic::epic_error_key(&error);
            if !(show_reconnect && key == "epic_reconnect_description") {
                messages.push(t(key));
            }
        }
        card.messages = strings(&messages);
        card
    })
}

// ---- RetroAchievements --------------------------------------------------

fn has_ra_key() -> bool {
    prefs::get()
        .get("retroAchievementsWebApiKey")
        .and_then(Value::as_str)
        .is_some_and(|k| !k.is_empty())
}

/// refreshStatus (silent / toastOnConnect)
fn ra_refresh(silent: bool, toast_on_connect: bool) {
    if !shell::signed_in() {
        with(|s| {
            s.ra.status = RaStatus::default();
            s.ra.last_checked = None;
            s.ra.loading = false;
        });
        render();
        return;
    }
    if !silent {
        with(|s| s.ra.loading = true);
        render();
    }
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let result = api.get(
            RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT,
            &[],
            Options::default(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            match result {
                Ok(value) => {
                    let status = RaStatus::parse(&value);
                    if toast_on_connect && status.connected {
                        toast::success(&t("retroachievements_account_linked"));
                    }
                    with(|s| {
                        s.ra.status = status;
                        s.ra.last_checked = Some(now_ms());
                    });
                    load_ra_avatar();
                }
                Err(error) => {
                    eprintln!("RetroAchievements status: {error}");
                    if !silent {
                        with(|s| s.ra.status = RaStatus::default());
                    }
                }
            }
            with(|s| s.ra.loading = false);
            render();
        });
    });
}

/// `${RETRO_ACHIEVEMENTS_USER_PIC_URL}/${username}.png`, the person icon on error
fn load_ra_avatar() {
    let username = with(|s| {
        let name = if s.ra.status.connected {
            s.ra.status.username.clone()
        } else {
            String::new()
        };
        if s.ra.avatar_for == name {
            return None;
        }
        s.ra.avatar_for = name.clone();
        s.ra.avatar = Image::default();
        Some(name)
    });
    let Some(username) = username.filter(|u| !u.is_empty()) else {
        return;
    };
    let Some((loader, scale)) = shell::loader() else {
        return;
    };
    let encoded: String = reqwest::Url::parse("http://q/")
        .ok()
        .and_then(|mut u| {
            u.path_segments_mut().ok()?.push(&username);
            Some(u.path().trim_start_matches('/').to_string())
        })
        .unwrap_or_else(|| username.clone());
    let url = format!("{RA_USER_PIC_URL}/{encoded}.png");
    loader.load(
        url,
        Op::MaxWidth((38.0 * scale).ceil() as u32),
        move |img| {
            let current = with(|s| {
                if s.ra.avatar_for == username {
                    s.ra.avatar = img;
                    true
                } else {
                    false
                }
            });
            if current {
                render();
            }
        },
    );
}

/// on-retroachievements-connected (the connection window finished)
pub fn on_retroachievements_connected() {
    ra_refresh(true, true);
}

fn ra_action(action: &str) {
    match action {
        "sign-in" => crate::auth::open(crate::auth::Page::SignIn),
        "connect" => crate::retroachievements::open(),
        "sync" => ra_sync(),
        "disconnect" => crate::settings_modals::open_ra_disconnect(|delete| {
            if delete {
                ra_confirm_delete();
            } else {
                ra_disconnect(false);
            }
        }),
        _ => {}
    }
}

/// The second modal: "Delete RetroAchievements achievements?"
fn ra_confirm_delete() {
    crate::dialogs::confirm(
        crate::dialogs::Confirm {
            title: &t("retroachievements_delete_confirm_title"),
            description: &t("retroachievements_delete_confirm_description"),
            body: "",
            confirm_label: &t("retroachievements_delete_confirm_button"),
            cancel_label: &t("cancel"),
            danger: true,
        },
        || {
            crate::dialogs::close();
            ra_disconnect(true);
        },
    );
}

/// handleSync: re-read the status, toast, keep the username preference.
fn ra_sync() {
    with(|s| s.ra.refreshing = true);
    render();
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let result = api.get(
            RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT,
            &[],
            Options::default(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            match result {
                Ok(value) => {
                    let status = RaStatus::parse(&value);
                    prefs::update(Map::from_iter([(
                        "retroAchievementsUsername".to_string(),
                        if status.connected {
                            json!(status.username)
                        } else {
                            Value::Null
                        },
                    )]));
                    with(|s| {
                        s.ra.status = status;
                        s.ra.last_checked = Some(now_ms());
                    });
                    load_ra_avatar();
                    toast::success(&t("retroachievements_status_updated"));
                }
                Err(error) => {
                    eprintln!("RetroAchievements status: {error}");
                    toast::error(&t("retroachievements_connect_error"));
                }
            }
            with(|s| s.ra.refreshing = false);
            render();
        });
    });
}

/// handleDisconnect(deleteAchievements)
fn ra_disconnect(delete_achievements: bool) {
    with(|s| s.ra.submitting = true);
    render();
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        // TODO(achievements): resetRetroAchievementsAchievements(true) before and
        // resetRetroAchievementsAchievements() after (the local RA unlock cache).
        let result = api.delete(
            &format!(
                "{RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT}?deleteAchievements={delete_achievements}"
            ),
            Options::default(),
        );
        let _ = slint::invoke_from_event_loop(move || {
            match result {
                Ok(_) => {
                    with(|s| {
                        s.ra.status = RaStatus::default();
                        s.ra.last_checked = None;
                    });
                    load_ra_avatar();
                    toast::success(&t("retroachievements_account_unlinked"));
                    prefs::update(Map::from_iter([
                        ("retroAchievementsWebApiKey".to_string(), Value::Null),
                        ("retroAchievementsUsername".to_string(), Value::Null),
                    ]));
                }
                Err(error) => {
                    eprintln!("RetroAchievements disconnect: {error}");
                    toast::error(&t("retroachievements_connect_error"));
                }
            }
            with(|s| s.ra.submitting = false);
            render();
        });
    });
}

fn ra_card() -> IntegrationCard {
    let signed_in = shell::signed_in();
    let has_key = has_ra_key();
    let note_width = with(|s| s.note_width);
    with(|s| {
        let ra = &s.ra;
        let invalid = ra.status.invalid();
        let missing_key = ra.status.connected && !invalid && !has_key;
        let (status, tone) = if invalid {
            (t("retroachievements_status_invalid_credentials"), "warning")
        } else if missing_key {
            (t("retroachievements_status_missing_key"), "warning")
        } else if ra.status.connected {
            (t("retroachievements_status_active"), "success")
        } else {
            (t("integration_status_not_connected"), "neutral")
        };
        let mut card = base_card(
            "retroachievements",
            &t("retroachievements"),
            &status,
            tone,
            ra.loading,
        );
        let mut actions = Vec::new();
        if !signed_in {
            actions.push(action("sign-in", &t("steam_sign_in"), "primary", "", true));
        } else if !ra.status.connected {
            actions.push(action(
                "connect",
                &t("integration_connect"),
                "primary",
                "link",
                !ra.submitting,
            ));
        } else {
            if invalid || missing_key {
                actions.push(action(
                    "connect",
                    &t("integration_reconnect"),
                    "primary",
                    "link",
                    !ra.submitting,
                ));
            } else {
                actions.push(action(
                    "sync",
                    &t("integration_sync"),
                    "outline",
                    "sync",
                    !ra.refreshing && !ra.submitting,
                ));
            }
            actions.push(action(
                "disconnect",
                &t("integration_disconnect"),
                "danger",
                "",
                !ra.submitting && !ra.refreshing,
            ));
        }
        card.actions = ModelRc::new(VecModel::from(actions));
        if ra.status.connected {
            card.show_profile = true;
            card.avatar = ra.avatar.clone();
            card.username = ra.status.username.clone().into();
            card.meta = last_synced(ra.last_checked).into();
            if invalid {
                card.messages = strings(&[t("retroachievements_invalid_credentials_description")]);
            }
            if missing_key {
                card.hint = t("retroachievements_missing_key_description").into();
                card.hint_enabled = !ra.submitting;
            }
        } else {
            card.description = t("retroachievements_description").into();
        }
        card.note = t("retroachievements_emulator_note").into();
        card.note_article = "retroachievements-emulators".into();
        let lines = crate::text_metrics::line_widths(&card.note, 12.0, note_width.max(1.0));
        card.note_last_line = lines.last().copied().unwrap_or_default();
        card.note_lines = ModelRc::new(VecModel::from(lines));
        card
    })
}

// ---- rendering ----------------------------------------------------------

fn strings(list: &[String]) -> ModelRc<SharedString> {
    ModelRc::new(VecModel::from(
        list.iter()
            .map(|s| SharedString::from(s.as_str()))
            .collect::<Vec<_>>(),
    ))
}

fn action(id: &str, label: &str, kind: &str, icon: &str, enabled: bool) -> IntegrationAction {
    IntegrationAction {
        id: id.into(),
        label: label.into(),
        kind: kind.into(),
        icon: icon.into(),
        enabled,
    }
}

fn base_card(id: &str, title: &str, status: &str, tone: &str, loading: bool) -> IntegrationCard {
    IntegrationCard {
        id: id.into(),
        title: title.into(),
        status: status.into(),
        tone: tone.into(),
        loading,
        ..Default::default()
    }
}

/// Re-render the three cards (in-place when the rows exist, so nothing
/// re-creates and running animations keep going).
pub fn render() {
    let Some(ui) = ui() else { return };
    let data = ui.global::<IntegrationsData>();
    let cards = vec![steam_card(), epic_card(), ra_card()];
    let model = data.get_cards();
    if model.row_count() == cards.len() {
        for (i, card) in cards.into_iter().enumerate() {
            if model.row_data(i).as_ref() != Some(&card) {
                model.set_row_data(i, card);
            }
        }
    } else {
        data.set_cards(ModelRc::new(VecModel::from(cards)));
    }
}

// ---- dev hooks ----------------------------------------------------------

/// `settings-dev <what>` in a dev script: show states the account can't
/// reach on its own (sync progress, loading skeletons, errors).
pub fn dev(args: &[&str]) {
    match args.first().copied().unwrap_or_default() {
        "steam-loading" => with(|s| s.steam.loading = true),
        "steam-sync" => {
            let phase = match args.get(1).copied().unwrap_or("achievements") {
                "library" => logic::SteamPhase::Library,
                "publishing" => logic::SteamPhase::Publishing,
                "merging" => logic::SteamPhase::Merging,
                "executables" => logic::SteamPhase::Executables,
                "finishing" => logic::SteamPhase::Finishing,
                _ => logic::SteamPhase::Achievements,
            };
            let found = args.get(2).and_then(|a| a.parse().ok()).unwrap_or(120);
            let processed = args.get(3).and_then(|a| a.parse().ok()).unwrap_or(45);
            steam_sync::simulate(SteamSync::Running {
                sync_run_id: "dev".into(),
                phase,
                games_found: found,
                games_processed: processed,
            });
        }
        "steam-reconnect" => steam_sync::simulate(SteamSync::Idle {
            requires_reconnect: true,
        }),
        "steam-disconnecting" => with(|s| s.steam.disconnecting = true),
        "steam-idle" => {
            steam_sync::simulate(SteamSync::default());
            with(|s| s.steam.disconnecting = false);
        }
        "epic-connected" => with(|s| {
            if let Some(state) = s.epic.state.as_mut() {
                state.apply_connection(&json!({
                    "connected": true,
                    "connectionId": "dev1234567890",
                    "displayName": "EpicPlayer",
                    "lastSyncedAt": "2026-10-01T12:00:00.000Z",
                }));
            }
        }),
        "ra-invalid" => with(|s| s.ra.status.account_status = "invalid_credentials".into()),
        "loading" => with(|s| {
            s.steam.loading = true;
            s.epic.loading = true;
            s.ra.loading = true;
        }),
        "replace-directory" => {
            let now = hydra_core::library_actions::now_iso();
            let directories: Vec<hydra_core::download_directories::Directory> = [
                "C:\\Games",
                "D:\\Downloads\\Hydra",
                "E:\\SteamLibrary\\Hydra",
                "F:\\Backup",
            ]
            .iter()
            .map(|p| hydra_core::download_directories::Directory {
                path: p.to_string(),
                created_at: now.clone(),
                source: "manual".into(),
            })
            .collect();
            crate::settings_modals::open_replacement(
                "G:\\New Games",
                &directories,
                "F:\\Backup",
                || {},
            );
        }
        "ra-window" => crate::retroachievements::open(),
        // the real Connect flow: OAuth start + the OpenID window (no sign-in)
        "steam-connect" => steam_connect(),
        "steam-openid-close" => crate::steam_openid::close(),
        "emulation-demo" => {
            crate::settings_emulation::dev_demo();
            return;
        }
        // settings-dev ra-shot <name>: the connection window into HYDRA_DEV_SHOTS
        "ra-shot" => {
            let dir = std::env::var_os("HYDRA_DEV_SHOTS")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(std::env::temp_dir);
            crate::retroachievements::dev_snapshot(&dir, args.get(1).copied().unwrap_or("ra"));
            return;
        }
        "ra-type" => {
            crate::retroachievements::dev_fill(
                args.get(1).copied().unwrap_or_default(),
                args.get(2).copied().unwrap_or_default(),
            );
            return;
        }
        "ra-disconnect" => ra_action("disconnect"),
        "steam-disconnect" => steam_confirm_disconnect(),
        "epic-disconnect" => epic_confirm_disconnect(),
        // the real Connect (opens the Epic window; nothing is linked without a code)
        "epic-connect" => epic_action("connect"),
        "epic-cancel" => epic_action("cancel"),
        "epic-redirect" => {
            crate::epic_auth_window::dev_load_redirect();
            return;
        }
        "epic-status" => {
            eprintln!("[epic] {}", crate::epic::describe());
            return;
        }
        // settings-dev epic-sync <phase> <processed> <total>: the progress row
        "epic-sync" => {
            use hydra_epic::sync::Phase;
            let phase = match args.get(1).copied().unwrap_or("publishing") {
                "starting" => Phase::Starting,
                "library" => Phase::Library,
                "playtime" => Phase::Playtime,
                "achievements" => Phase::Achievements,
                "merging" => Phase::Merging,
                "finishing" => Phase::Finishing,
                _ => Phase::Publishing,
            };
            with(|s| {
                s.epic.sync = hydra_epic::sync::SyncState {
                    status: "running",
                    hydra_user_id: crate::epic::auth_context().map(|c| c.user_id),
                    phase: Some(phase),
                    processed: args.get(2).and_then(|a| a.parse().ok()).unwrap_or(1),
                    total: args.get(3).and_then(|a| a.parse().ok()),
                    ..Default::default()
                }
            });
        }
        "epic-sync-reconnect" => with(|s| {
            s.epic.sync = hydra_epic::sync::SyncState {
                status: "idle",
                requires_reconnect: true,
                ..Default::default()
            }
        }),
        other => eprintln!("settings-dev: unknown {other:?}"),
    }
    render();
}
