//! The Epic Games integration in the app: services/epic/index.ts,
//! integration-core.ts (connection state, sign-in, disconnect) and
//! sync-runtime.ts (library sync, startup sync), over `hydra-epic`.
//!
//! State lives on the UI thread like the other services; Legendary, the
//! session store and the Hydra API run on worker threads that report back
//! with `invoke_from_event_loop`. Workers check `is_current` (the Hydra
//! account and the confirmed link) before every write, like Electron's
//! `current()` guards.
//!
//! `HYDRA_EPIC_DRY_RUN=1` skips the integration's writes to the Hydra API
//! (link, unlink and sync runs) so test runs never touch a real account's
//! Epic link; reads and local work still happen.

use std::cell::RefCell;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use hydra_core::api::{ApiError, HydraApi, Options};
use hydra_db::{Db, keys};
use hydra_epic::imports::{self, LinkFilter};
use hydra_epic::library::{self, SnapshotGame};
use hydra_epic::protocol::{self, Connection, SyncRun};
use hydra_epic::runner::{self, AuthRunner};
use hydra_epic::session::{AuthContext, Context, SessionProvider};
use hydra_epic::snapshot::{Chunk, build_chunks};
use hydra_epic::sources::{self, PlaytimeSource};
use hydra_epic::store::{Bundle, SessionState, Store, Stored};
use hydra_epic::sync::{self as orchestrator, Finished, Journal, SyncState};
use hydra_epic::{Cancel, EpicError, legendary, managed};
use serde_json::{Value, json};
use slint::ComponentHandle;

use crate::epic_auth_window::{self as window, Outcome};
use crate::{AppWindow, Session, shell};

const EPIC_ENDPOINT: &str = protocol::EPIC_ENDPOINT;
const HYDRA_TIMEOUT: Duration = Duration::from_secs(20);

fn hydra_options() -> Options {
    Options {
        needs_auth: true,
        timeout: Some(HYDRA_TIMEOUT),
    }
}

fn dry_run() -> bool {
    std::env::var_os("HYDRA_EPIC_DRY_RUN").is_some()
}

/// The HYDRA_EPIC_DRY_RUN guard for writes to the Epic endpoints.
fn write_guard(what: &str) -> Result<(), ApiError> {
    if dry_run() {
        eprintln!("[epic] dry run: skipped {what}");
        return Err(ApiError::Status {
            status: 503,
            body: None,
        });
    }
    Ok(())
}

/// encodeURIComponent
fn encode(text: &str) -> String {
    text.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

// ---- shared services (thread-safe) ------------------------------------

struct Shared {
    provider: SessionProvider,
    playtime: PlaytimeSource,
    user_data: PathBuf,
}

static SHARED: OnceLock<Arc<Shared>> = OnceLock::new();

fn shared() -> Option<Arc<Shared>> {
    SHARED.get().cloned()
}

/// HydraApi.getAuthContext: the API environment, the JWT's userId and the
/// generation (bumped on every account change).
static AUTH: Mutex<Option<AuthContext>> = Mutex::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(1);
static QUERY_REVISION: AtomicU64 = AtomicU64::new(0);

pub fn auth_context() -> Option<AuthContext> {
    AUTH.lock().ok().and_then(|a| a.clone())
}

fn is_auth_current(context: &AuthContext) -> bool {
    auth_context().as_ref() == Some(context)
}

fn jwt_user_id(token: &str) -> Option<String> {
    use base64::Engine;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    claims
        .get("userId")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn compute_auth(db: &Db, generation: u64) -> Option<AuthContext> {
    let auth: Value = db.get(keys::AUTH)?;
    let user_id = jwt_user_id(auth.get("accessToken")?.as_str()?)?;
    Some(AuthContext {
        environment: hydra_core::config::api_url()
            .trim_end_matches('/')
            .to_string(),
        user_id,
        generation,
    })
}

/// The confirmed link the workers check (lastPublicState).
#[derive(Clone, Debug, PartialEq)]
struct Link {
    hydra_user_id: Option<String>,
    confirmed: bool,
    busy: bool,
    connection: Option<Connection>,
}

static LINK: Mutex<Option<Link>> = Mutex::new(None);

/// EpicSyncRuntime.current
fn sync_current(context: &Context) -> bool {
    is_auth_current(&context.auth)
        && LINK
            .lock()
            .ok()
            .and_then(|l| l.clone())
            .is_some_and(|link| {
                link.confirmed
                    && !link.busy
                    && link
                        .connection
                        .as_ref()
                        .is_some_and(|c| c.same_link(&context.connection))
            })
}

// ---- the public state (EpicConnectionState) -----------------------------

#[derive(Clone, Debug, PartialEq)]
pub struct PublicState {
    pub hydra_logged_in: bool,
    pub hydra_user_id: Option<String>,
    /// availability.reason (None: available)
    pub reason: Option<String>,
    /// connection: None is `null`, Some(None) `{ connected: false }`
    pub connection: Option<Option<Connection>>,
    pub confirmed: bool,
    pub session_state: SessionState,
    /// operation: (id, status)
    pub operation: Option<(String, &'static str)>,
    pub error: Option<String>,
}

impl PublicState {
    pub fn connected(&self) -> Option<&Connection> {
        self.connection.as_ref().and_then(Option::as_ref)
    }

    pub fn operation_status(&self) -> Option<&'static str> {
        self.operation.as_ref().map(|(_, s)| *s)
    }
}

struct Cached {
    context: AuthContext,
    connection: Option<Connection>,
    session_state: SessionState,
    refresh_expires_at: Option<i64>,
    error: Option<String>,
}

impl Cached {
    fn from_stored(context: &AuthContext, stored: Option<&Stored>) -> Cached {
        Cached {
            context: context.clone(),
            connection: stored.map(|s| s.connection.clone()),
            session_state: stored.map_or(SessionState::Missing, |s| s.session_state),
            refresh_expires_at: stored
                .and_then(|s| s.bundle.as_ref())
                .and_then(Bundle::refresh_expires_at),
            error: None,
        }
    }
}

struct Operation {
    id: String,
    context: AuthContext,
    cancel: Cancel,
    status: &'static str,
    cancelled: bool,
    runner: Option<Arc<AuthRunner>>,
    task: bool,
    finished: bool,
}

struct SyncOp {
    context: Context,
    cancel: Cancel,
}

#[derive(Default)]
struct Epic {
    ui: slint::Weak<AppWindow>,
    state: Option<PublicState>,
    state_context: Option<AuthContext>,
    cached: Option<Cached>,
    operation: Option<Operation>,
    first_link_pending: bool,
    sync: SyncState,
    sync_op: Option<SyncOp>,
    sync_preparing: bool,
    startup_attempted: HashSet<String>,
}

type Then = Box<dyn FnOnce(PublicState)>;
type Done = Box<dyn FnOnce(OperationResult)>;

thread_local! {
    static EPIC: RefCell<Epic> = RefCell::new(Epic::default());
    /// getConnection continuations by query token (they stay on this thread).
    static THEN: RefCell<std::collections::HashMap<u64, Then>> = RefCell::new(Default::default());
    /// The pending result of startAuth / disconnect, by operation id.
    static DONE: RefCell<std::collections::HashMap<String, Done>> = RefCell::new(Default::default());
}

static TOKENS: AtomicU64 = AtomicU64::new(0);

fn with<R>(f: impl FnOnce(&mut Epic) -> R) -> R {
    EPIC.with(|e| f(&mut e.borrow_mut()))
}

fn register_done(id: &str, done: impl FnOnce(OperationResult) + 'static) {
    DONE.with(|d| d.borrow_mut().insert(id.to_string(), Box::new(done)));
}

/// Resolves the startAuth/disconnect promise of an operation (once).
fn resolve_done(id: &str, result: OperationResult) {
    if let Some(done) = DONE.with(|d| d.borrow_mut().remove(id)) {
        done(result);
    }
}

/// managedCleanupFailed / temporaryCleanupFailed (read inside `with`, so not in Epic).
static CLEANUP_FAILED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn availability() -> Option<String> {
    if CLEANUP_FAILED.load(Ordering::SeqCst) {
        return Some("cleanup-failed".into());
    }
    legendary::availability().map(str::to_string)
}

fn now_ms() -> i64 {
    hydra_epic::time::now_ms()
}

/// The current public state (getConnection's snapshot).
pub fn state() -> Option<PublicState> {
    with(|e| e.state.clone())
}

pub fn sync_state() -> SyncState {
    with(|e| e.sync.clone())
}

fn matches(a: Option<&AuthContext>, b: &AuthContext) -> bool {
    a == Some(b)
}

/// snapshot(context)
fn snapshot(e: &Epic, context: Option<&AuthContext>) -> PublicState {
    let reason = availability();
    let Some(context) = context else {
        return PublicState {
            hydra_logged_in: false,
            hydra_user_id: None,
            reason,
            connection: None,
            confirmed: false,
            session_state: SessionState::Missing,
            operation: None,
            error: None,
        };
    };
    let cached = e
        .cached
        .as_ref()
        .filter(|c| matches(Some(&c.context), context));
    let previous = e
        .state
        .as_ref()
        .filter(|_| matches(e.state_context.as_ref(), context));
    let active = e
        .operation
        .as_ref()
        .filter(|op| !op.cancelled && is_auth_current(&op.context));
    let error = cached
        .and_then(|c| c.error.clone())
        .or_else(|| previous.and_then(|p| p.error.clone()));
    let session_state = match cached {
        Some(c)
            if c.session_state == SessionState::Ready
                && c.refresh_expires_at.is_some_and(|at| at <= now_ms()) =>
        {
            SessionState::Expired
        }
        Some(c) => c.session_state,
        None => SessionState::Missing,
    };
    PublicState {
        hydra_logged_in: true,
        hydra_user_id: Some(context.user_id.clone()),
        reason,
        connection: Some(
            previous
                .and_then(|p| p.connection.clone())
                .or_else(|| cached.map(|c| c.connection.clone()))
                .unwrap_or(None),
        ),
        confirmed: previous.is_some_and(|p| p.confirmed),
        session_state,
        operation: active.map(|op| (op.id.clone(), op.status)),
        error,
    }
}

/// The new state goes public (index.ts emit + integration-core emit).
fn publish(next: PublicState, context: Option<AuthContext>) {
    let old = with(|e| {
        let old = e.state.clone();
        e.state = Some(next.clone());
        e.state_context = context.clone();
        old
    });
    if let Ok(mut link) = LINK.lock() {
        *link = Some(Link {
            hydra_user_id: next.hydra_user_id.clone(),
            confirmed: next.confirmed,
            busy: next.operation.is_some(),
            connection: next.connected().cloned(),
        });
    }
    // firstLinkPending and the startup/authenticated sync trigger
    let connected = next.connected().cloned();
    let old_connected = old.as_ref().and_then(|o| o.connected().cloned());
    if next.confirmed
        && connected.is_some()
        && old_connected.is_none()
        && next.operation_status() == Some("connecting")
    {
        with(|e| e.first_link_pending = true);
    }
    if next.confirmed
        && let Some(connection) = &connected
        && next.operation.is_none()
    {
        let changed = with(|e| e.first_link_pending)
            || old.as_ref().is_none_or(|o| {
                !o.confirmed
                    || o.hydra_user_id != next.hydra_user_id
                    || o.connected()
                        .is_none_or(|c| c.connection_id != connection.connection_id)
                    || o.operation.is_some()
            });
        if changed {
            let first_link = with(|e| std::mem::replace(&mut e.first_link_pending, false));
            let authenticated = old.as_ref().and_then(PublicState::operation_status)
                == Some("connecting")
                && next.session_state == SessionState::Ready;
            slint::Timer::single_shot(Duration::ZERO, move || {
                if authenticated {
                    sync_authenticated(first_link);
                } else {
                    sync_startup(first_link);
                }
            });
        }
    }
    if old.as_ref() != Some(&next) {
        crate::settings_integrations::on_epic_state(old.as_ref(), &next);
    }
}

/// emit(context, error?)
fn emit(context: Option<&AuthContext>, error: Option<&str>) {
    if let Some(context) = context
        && !is_auth_current(context)
    {
        return;
    }
    let mut next = with(|e| snapshot(e, context));
    if let Some(error) = error {
        next.error = Some(error.into());
    }
    publish(next, context.cloned());
}

// ---- init and the auth context ------------------------------------------

/// initializeEpicIntegration (+ startEpicSyncOnStartup when signed in).
pub fn init(ui: &AppWindow, user_data: &Path) {
    with(|e| e.ui = ui.as_weak());
    let store = Store::new(user_data);
    let _ = SHARED.set(Arc::new(Shared {
        provider: SessionProvider::new(store, user_data.to_path_buf()),
        playtime: PlaytimeSource::default(),
        user_data: user_data.to_path_buf(),
    }));
    if let Some(db) = shell::db()
        && let Ok(mut auth) = AUTH.lock()
    {
        *auth = compute_auth(&db, GENERATION.load(Ordering::SeqCst));
    }
    let user_data = user_data.to_path_buf();
    std::thread::spawn(move || {
        // Crash recovery touches only our own folders; Legendary never runs here.
        let temporary = runner::cleanup_temporary_sessions(&user_data);
        let managed = managed::cleanup_all_credentials(&user_data);
        let opened = shared().map(|s| s.provider.store.open().map(|_| ()));
        let _ = slint::invoke_from_event_loop(move || {
            if temporary.is_err() || managed.is_err() {
                CLEANUP_FAILED.store(true, Ordering::SeqCst);
            }
            if let Some(Err(error)) = opened {
                eprintln!("[epic] session store: {error}");
            }
            if auth_context().is_some() {
                // startEpicSyncOnStartup
                sync_startup(false);
            } else {
                emit(None, None);
            }
        });
    });
}

/// HydraApi.onAuthContextChanged: called whenever the user may have
/// changed (sign-in, sign-out, a refreshed /profile/me).
pub fn on_auth_maybe_changed() {
    let Some(db) = shell::db() else { return };
    let previous = auth_context();
    let next = compute_auth(&db, previous.as_ref().map_or(0, |p| p.generation));
    let same = match (&previous, &next) {
        (Some(a), Some(b)) => a.environment == b.environment && a.user_id == b.user_id,
        (None, None) => true,
        _ => false,
    };
    if same {
        return;
    }
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let next = next.map(|mut c| {
        c.generation = generation;
        c
    });
    if let Ok(mut auth) = AUTH.lock() {
        *auth = next.clone();
    }
    // handleSignIn / handleSignOut: imports of another account go.
    let changed = imports::clear_stale_imports(&db, None, LinkFilter::Any, &|| true);
    if changed > 0 {
        shell::load_library();
    }
    auth_context_changed();
}

/// authContextChanged + runtime.invalidate
fn auth_context_changed() {
    QUERY_REVISION.fetch_add(1, Ordering::SeqCst);
    invalidate_sync();
    cancel_active();
    with(|e| {
        e.state = None;
        e.state_context = None;
        e.cached = None;
        e.first_link_pending = false;
        e.sync = SyncState::idle(auth_context().map(|c| c.user_id));
    });
    let context = auth_context();
    emit(context.as_ref(), None);
    if context.is_some() {
        get_connection(None);
    }
}

// ---- getConnection -------------------------------------------------------

struct QueryResult {
    stored: Result<Option<Stored>, EpicError>,
    remote: Result<Option<Connection>, EpicError>,
    applied: Result<Option<Stored>, EpicError>,
    cleaned: bool,
}

/// getConnection: the stored link and GET /profile/integrations/epic,
/// then the store and the imports follow the server. `then` gets the state.
pub fn get_connection(then: Option<Then>) {
    let context = auth_context();
    let skip = context.is_none()
        || matches!(
            with(|e| e.operation.as_ref().map(|op| op.status)),
            Some("connecting" | "disconnecting")
        );
    if skip {
        let state = with(|e| snapshot(e, context.as_ref()));
        if let Some(then) = then {
            then(state);
        }
        return;
    }
    let context = context.expect("checked");
    let (Some(api), Some(db), Some(shared)) = (shell::api(), shell::db(), shared()) else {
        return;
    };
    let revision = QUERY_REVISION.fetch_add(1, Ordering::SeqCst) + 1;
    let previous_cached = with(|e| {
        e.cached
            .as_ref()
            .filter(|c| c.context == context)
            .and_then(|c| c.connection.clone())
    });
    let last_public = with(|e| e.state.clone());
    let sync_cancel = with(|e| e.sync_op.as_ref().map(|op| op.cancel.clone()));
    let subscribed = has_subscription();
    let token = TOKENS.fetch_add(1, Ordering::SeqCst);
    if let Some(then) = then {
        THEN.with(|t| t.borrow_mut().insert(token, then));
    }
    std::thread::spawn(move || {
        let current =
            || is_auth_current(&context) && QUERY_REVISION.load(Ordering::SeqCst) == revision;
        let scope = context.scope();
        let stored = shared.provider.store.read(&scope);
        let remote = api
            .get(EPIC_ENDPOINT, &[], hydra_options())
            .map_err(|e| protocol::connection_error(&e))
            .and_then(|value| protocol::validate_connection(&value));
        let mut applied = Err(EpicError::cancelled());
        let mut cleaned = false;
        if let Ok(connection) = &remote
            && current()
        {
            // applyRemote: the store follows the confirmed link.
            applied = match connection {
                Some(connection) => shared
                    .provider
                    .store
                    .cache_connection(&scope, connection, &current)
                    .map(Some),
                None => shared
                    .provider
                    .store
                    .remove(&scope, &current, None)
                    .map(|_| None),
            };
            let previous = match &stored {
                Ok(stored) => stored.as_ref().map(|s| s.connection.clone()),
                Err(_) => previous_cached,
            };
            cleaned = connection_changed(
                &api,
                &db,
                &context,
                previous.as_ref(),
                connection.as_ref(),
                last_public.as_ref(),
                sync_cancel.as_ref(),
                subscribed,
                &current,
            );
        }
        let result = QueryResult {
            stored,
            remote,
            applied,
            cleaned,
        };
        let _ = slint::invoke_from_event_loop(move || {
            let state = finish_query(&context, revision, result);
            if let Some(then) = THEN.with(|t| t.borrow_mut().remove(&token)) {
                then(state);
            }
        });
    });
}

/// connectionChanged (index.ts): a link that changed drops the old imports;
/// stale imports go either way; a change merges the remote library.
#[allow(clippy::too_many_arguments)]
fn connection_changed(
    api: &HydraApi,
    db: &Db,
    context: &AuthContext,
    previous: Option<&Connection>,
    next: Option<&Connection>,
    last_public: Option<&PublicState>,
    sync_cancel: Option<&Cancel>,
    subscribed: bool,
    current: &(dyn Fn() -> bool + Sync),
) -> bool {
    if !current() {
        return false;
    }
    let moved = |c: &Connection| next.is_none_or(|n| n.connection_id != c.connection_id);
    let transitioned = previous.is_some_and(moved)
        || last_public.is_some_and(|s| {
            s.hydra_user_id.as_deref() == Some(context.user_id.as_str())
                && s.connected().is_some_and(moved)
        });
    if transitioned {
        if let Some(cancel) = sync_cancel {
            cancel.cancel();
        }
        if let Some(previous) = previous {
            imports::clear_imports(
                db,
                Some((&context.environment, &context.user_id)),
                Some(&previous.connection_id),
                false,
                current,
            );
        }
    }
    let link = match next {
        Some(connection) => LinkFilter::Only(&connection.connection_id),
        None => LinkFilter::None,
    };
    let cleaned = imports::clear_stale_imports(db, Some(context), link, current);
    if transitioned || cleaned > 0 {
        hydra_core::remote_library::merge_with_remote_games(
            api,
            db,
            &hydra_core::remote_library::MergeOptions {
                can_reconcile_custom_artwork: subscribed,
                context: Some(hydra_core::remote_library::EpicScope {
                    environment: context.environment.clone(),
                    user_id: context.user_id.clone(),
                }),
                epic_connection_id: None,
                current,
                progress: None,
                api_options: hydra_options(),
            },
        );
        return true;
    }
    false
}

fn finish_query(context: &AuthContext, revision: u64, result: QueryResult) -> PublicState {
    let current = is_auth_current(context) && QUERY_REVISION.load(Ordering::SeqCst) == revision;
    if !current {
        return with(|e| snapshot(e, auth_context().as_ref()));
    }
    // hydrate
    with(|e| match &result.stored {
        Ok(stored) => e.cached = Some(Cached::from_stored(context, stored.as_ref())),
        Err(error) => {
            let connection = e
                .cached
                .as_ref()
                .filter(|c| &c.context == context)
                .and_then(|c| c.connection.clone());
            e.cached = Some(Cached {
                context: context.clone(),
                connection,
                session_state: SessionState::Unavailable,
                refresh_expires_at: None,
                error: Some(error.0.clone()),
            });
        }
    });
    if result.cleaned {
        shell::load_library();
    }
    match result.remote {
        Err(error) => {
            let mut state = with(|e| snapshot(e, Some(context)));
            state.confirmed = false;
            state.error = Some(error.0);
            publish(state.clone(), Some(context.clone()));
            state
        }
        Ok(connection) => {
            let error = match &result.applied {
                Ok(stored) => {
                    with(|e| e.cached = Some(Cached::from_stored(context, stored.as_ref())));
                    None
                }
                Err(error) => {
                    with(|e| {
                        e.cached = Some(Cached {
                            context: context.clone(),
                            connection: connection.clone(),
                            session_state: SessionState::Unavailable,
                            refresh_expires_at: None,
                            error: Some(error.0.clone()),
                        })
                    });
                    Some(error.0.clone())
                }
            };
            remote_state(context, connection, error)
        }
    }
}

/// remoteState: the server's link, confirmed.
fn remote_state(
    context: &AuthContext,
    connection: Option<Connection>,
    error: Option<String>,
) -> PublicState {
    let mut state = with(|e| snapshot(e, Some(context)));
    state.connection = Some(connection);
    state.confirmed = true;
    match error {
        Some(error) => {
            state.error = Some(error);
            state.session_state = SessionState::Unavailable;
        }
        None => state.error = None,
    }
    QUERY_REVISION.fetch_add(1, Ordering::SeqCst);
    publish(state.clone(), Some(context.clone()));
    state
}

fn has_subscription() -> bool {
    with(|e| e.ui.upgrade())
        .map(|ui| ui.global::<Session>().get_has_subscription())
        .unwrap_or(false)
}

// ---- sign-in (startAuth → window → auth --code → POST) -------------------

/// EpicOperationResult as the card handles it.
pub type OperationResult = Result<(), String>;

fn operation_active(id: &str) -> bool {
    with(|e| {
        e.operation
            .as_ref()
            .is_some_and(|op| op.id == id && !op.cancelled && is_auth_current(&op.context))
    })
}

/// startAuth: the login window opens once the link and Legendary check out.
pub fn start_auth(done: impl FnOnce(OperationResult) + 'static) {
    invalidate_sync();
    if with(|e| e.operation.is_some()) {
        return done(Err("operation-in-progress".into()));
    }
    let Some(context) = auth_context() else {
        return done(Err("hydra-auth-required".into()));
    };
    if let Some(reason) = availability() {
        return done(Err(reason));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let cancel = Cancel::new();
    with(|e| {
        e.operation = Some(Operation {
            id: id.clone(),
            context: context.clone(),
            cancel: cancel.clone(),
            status: "awaiting-login",
            cancelled: false,
            runner: None,
            task: false,
            finished: false,
        })
    });
    register_done(&id, done);
    // prepareAuth: getConnection + checkBinary + the runner's folder
    let prepared_id = id.clone();
    get_connection(Some(Box::new(move |state: PublicState| {
        if !operation_active(&prepared_id) {
            return finish_operation(&prepared_id, Some("operation-cancelled"));
        }
        if !state.confirmed || state.error.is_some() {
            let error = state.error.unwrap_or_else(|| "api-unavailable".into());
            return finish_operation(&prepared_id, Some(&error));
        }
        let Some(shared) = shared() else { return };
        let worker_cancel = cancel.clone();
        std::thread::spawn(move || {
            let runner = legendary::check_binary()
                .and_then(|binary| AuthRunner::create(&binary, &shared.user_data, &worker_cancel));
            let _ = slint::invoke_from_event_loop(move || {
                let runner = match runner {
                    Ok(runner) => Arc::new(runner),
                    Err(error) => return finish_operation(&prepared_id, Some(&error.0)),
                };
                if !operation_active(&prepared_id) {
                    let _ = runner.cleanup();
                    return finish_operation(&prepared_id, Some("operation-cancelled"));
                }
                with(|e| {
                    if let Some(op) = e.operation.as_mut() {
                        op.runner = Some(runner);
                    }
                });
                let opened = window::open(&prepared_id, |operation, outcome| match outcome {
                    Outcome::Code(code) => complete_auth(&operation, code),
                    Outcome::Cancelled => cancel_auth(&operation, |_| {}),
                    Outcome::Failed(error) => fail_window(&operation, error),
                });
                if !opened {
                    return finish_operation(&prepared_id, Some("auth-failed"));
                }
                emit(Some(&context), None);
                resolve_done(&prepared_id, Ok(()));
            });
        });
    })));
}

/// failWindow
fn fail_window(id: &str, error: &'static str) {
    if !operation_active(id) || with(|e| e.operation.as_ref().is_some_and(|op| op.task)) {
        return;
    }
    with(|e| {
        if let Some(op) = e.operation.as_mut() {
            op.cancelled = true;
            op.cancel.cancel();
        }
    });
    window::close();
    finish_operation(id, Some(error));
}

/// completeAuth: `auth --code`, then POST the account, then save the session.
fn complete_auth(id: &str, code: String) {
    if !operation_active(id) {
        return;
    }
    let Ok(code) = protocol::validate_authorization_code(&code) else {
        return fail_window(id, "invalid-response");
    };
    let (context, cancel, runner) = match with(|e| {
        e.operation.as_mut().map(|op| {
            op.status = "authenticating";
            op.task = true;
            (op.context.clone(), op.cancel.clone(), op.runner.clone())
        })
    }) {
        Some(parts) => parts,
        None => return,
    };
    window::close();
    emit(Some(&context), None);
    let Some(runner) = runner else {
        return finish_operation(id, Some("auth-failed"));
    };
    let id = id.to_string();
    std::thread::spawn(move || {
        let bundle = runner.authenticate(&code, &cancel);
        let _ = slint::invoke_from_event_loop(move || {
            let bundle = match bundle {
                Ok(bundle) => bundle,
                Err(error) => return finish_operation(&id, Some(&error.0)),
            };
            if !operation_active(&id) {
                return finish_operation(&id, Some("operation-cancelled"));
            }
            let account = match connect_payload(&bundle.user) {
                Ok(account) => account,
                Err(error) => return finish_operation(&id, Some(&error.0)),
            };
            let linked = with(|e| e.state.as_ref().and_then(|s| s.connected().cloned()));
            if linked.is_some_and(|l| l.epic_account_id != account["epicAccountId"]) {
                return finish_operation(&id, Some("different-account"));
            }
            with(|e| {
                if let Some(op) = e.operation.as_mut() {
                    op.status = "connecting";
                }
            });
            QUERY_REVISION.fetch_add(1, Ordering::SeqCst);
            emit(Some(&context), None);
            connect(id, context, cancel, runner, bundle, account);
        });
    });
}

/// getEpicConnectPayload
fn connect_payload(user: &Value) -> Result<Value, EpicError> {
    let account = user
        .get("account_id")
        .and_then(Value::as_str)
        .filter(|a| a.len() == 32 && a.chars().all(|c| c.is_ascii_hexdigit()))
        .ok_or_else(|| EpicError::new("invalid-response"))?
        .to_ascii_lowercase();
    let display = user
        .get("displayName")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if display.is_empty() || display.encode_utf16().count() > protocol::EPIC_DISPLAY_NAME_MAX_LENGTH
    {
        return Err(EpicError::new("invalid-account-data"));
    }
    let token = user
        .get("access_token")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let expires = user
        .get("expires_at")
        .and_then(Value::as_str)
        .and_then(hydra_epic::time::parse_ms);
    if token.is_empty()
        || token.len() > protocol::EPIC_ACCESS_TOKEN_MAX_LENGTH
        || token.bytes().any(|b| !(0x21..=0x7e).contains(&b))
        || expires.is_none_or(|at| at <= now_ms())
    {
        return Err(EpicError::new("auth-failed"));
    }
    Ok(json!({ "epicAccountId": account, "displayName": display, "accessToken": token }))
}

/// connect: confirmConnection (POST, reconciled with GET when the answer is
/// lost), then the session is saved for the confirmed link.
fn connect(
    id: String,
    context: AuthContext,
    cancel: Cancel,
    runner: Arc<AuthRunner>,
    bundle: Bundle,
    account: Value,
) {
    let (Some(api), Some(shared)) = (shell::api(), shared()) else {
        return;
    };
    let account_id = account["epicAccountId"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    std::thread::spawn(move || {
        let posted = write_guard("POST /profile/integrations/epic")
            .and_then(|()| api.post(EPIC_ENDPOINT, &account, hydra_options()));
        let confirmed: Result<Connection, EpicError> = match posted {
            Ok(value) => protocol::validate_connection(&value).and_then(|c| {
                c.filter(|c| c.epic_account_id == account_id)
                    .ok_or_else(|| EpicError::new("invalid-response"))
            }),
            Err(error) => {
                let cause = protocol::connection_error(&error);
                if cause.is("different-account") || cause.is("stale-connection") {
                    Err(cause)
                } else if protocol::has_http_response(&error)
                    || !(cause.is("network") || cause.is("timeout") || cause.is("invalid-response"))
                {
                    Err(cause)
                } else {
                    // The POST may have committed before its answer was lost.
                    match api
                        .get(EPIC_ENDPOINT, &[], hydra_options())
                        .map_err(|e| protocol::connection_error(&e))
                        .and_then(|v| protocol::validate_connection(&v))
                    {
                        Ok(Some(c)) if c.epic_account_id == account_id => Ok(c),
                        _ => Err(cause),
                    }
                }
            }
        };
        let cleanup = runner.cleanup();
        let saved = confirmed.as_ref().ok().map(|connection| {
            let current = || is_auth_current(&context) && !cancel.is_cancelled();
            cleanup.clone().and_then(|()| {
                shared
                    .provider
                    .store
                    .save(&context.scope(), connection, &bundle, &current)
            })
        });
        let _ = slint::invoke_from_event_loop(move || {
            let connection = match confirmed {
                Ok(connection) => connection,
                Err(error) => {
                    if error.is("different-account") || error.is("stale-connection") {
                        // reconcileConnect: the server's current link wins.
                        get_connection(None);
                    }
                    return finish_operation(&id, Some(&error.0));
                }
            };
            if !operation_active(&id) {
                return finish_operation(&id, Some("operation-cancelled"));
            }
            // The server link is real even if local persistence fails.
            remote_state(&context, Some(connection.clone()), None);
            match saved.expect("confirmed") {
                Ok(stored) => {
                    with(|e| {
                        e.cached = Some(Cached::from_stored(&context, Some(&stored)));
                        if let Some(op) = e.operation.as_mut() {
                            op.finished = true;
                        }
                        e.operation = None;
                    });
                    let mut state = with(|e| snapshot(e, Some(&context)));
                    state.connection = Some(Some(connection));
                    state.confirmed = true;
                    state.error = None;
                    publish(state, Some(context.clone()));
                }
                Err(error) => {
                    let code = error.0.clone();
                    if code == "persistence-failed" || code == "cleanup-failed" {
                        with(|e| {
                            e.cached = Some(Cached {
                                context: context.clone(),
                                connection: Some(connection),
                                session_state: SessionState::Unavailable,
                                refresh_expires_at: None,
                                error: Some(code.clone()),
                            })
                        });
                    }
                    finish_operation(&id, Some(&code));
                }
            }
        });
    });
}

/// finish(operation, error): cleanup, release, emit.
fn finish_operation(id: &str, error: Option<&str>) {
    let operation = with(|e| {
        if e.operation.as_ref().is_some_and(|op| op.id == id) {
            e.operation.take()
        } else {
            None
        }
    });
    let Some(operation) = operation else {
        resolve_done(id, error.map_or(Ok(()), |e| Err(e.to_string())));
        return;
    };
    window::close();
    let runner = operation.runner.clone();
    let context = operation.context.clone();
    let error = error.map(str::to_string);
    let id = id.to_string();
    std::thread::spawn(move || {
        let cleanup_failed = runner.is_some_and(|r| r.cleanup().is_err());
        let _ = slint::invoke_from_event_loop(move || {
            let code = if cleanup_failed {
                Some("cleanup-failed".to_string())
            } else {
                error
            };
            if is_auth_current(&context) {
                with(|e| {
                    if let Some(state) = e.state.as_mut() {
                        state.error = None;
                    }
                });
                emit(Some(&context), code.as_deref());
            }
            resolve_done(&id, code.map_or(Ok(()), Err));
        });
    });
}

/// cancelActive
fn cancel_active() {
    let id = with(|e| {
        e.operation.as_mut().map(|op| {
            op.cancelled = true;
            op.cancel.cancel();
            op.id.clone()
        })
    });
    QUERY_REVISION.fetch_add(1, Ordering::SeqCst);
    window::close();
    if let Some(id) = id {
        let running = with(|e| e.operation.as_ref().is_some_and(|op| op.task));
        // A running task finishes on its own and reports the cancel.
        if !running {
            finish_operation(&id, Some("operation-cancelled"));
        }
    }
}

/// cancelAuth(operationId)
pub fn cancel_auth(id: &str, done: impl FnOnce(OperationResult) + 'static) {
    let matches = with(|e| {
        e.operation
            .as_ref()
            .is_some_and(|op| op.id == id && is_auth_current(&op.context))
    });
    if !matches {
        return done(Err("invalid-operation".into()));
    }
    cancel_active();
    done(Ok(()));
}

/// The running sign-in's id (the card's Cancel).
pub fn operation_id() -> Option<String> {
    with(|e| e.operation.as_ref().map(|op| op.id.clone()))
}

// ---- disconnect ----------------------------------------------------------

/// disconnectEpic: DELETE /profile/integrations/epic?connectionId=, then the
/// local link, session and imports go.
pub fn disconnect(connection_id: String, done: impl FnOnce(OperationResult) + 'static) {
    invalidate_sync();
    let Some(context) = auth_context() else {
        return done(Err("hydra-auth-required".into()));
    };
    if !protocol::is_connection_id(&connection_id) {
        return done(Err("stale-connection".into()));
    }
    if with(|e| e.operation.as_ref().map(|op| op.status)) == Some("disconnecting") {
        return done(Err("operation-in-progress".into()));
    }
    cancel_active();
    if with(|e| e.operation.is_some()) {
        return done(Err("operation-in-progress".into()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let cancel = Cancel::new();
    with(|e| {
        e.operation = Some(Operation {
            id: id.clone(),
            context: context.clone(),
            cancel: cancel.clone(),
            status: "disconnecting",
            cancelled: false,
            runner: None,
            task: true,
            finished: false,
        })
    });
    register_done(&id, done);
    QUERY_REVISION.fetch_add(1, Ordering::SeqCst);
    emit(Some(&context), None);
    let cached = with(|e| snapshot(e, Some(&context)).connected().cloned());
    if cached.is_some_and(|c| c.connection_id != connection_id) {
        return finish_operation(&id, Some("stale-connection"));
    }
    let (Some(api), Some(db), Some(shared)) = (shell::api(), shell::db(), shared()) else {
        return;
    };
    let last_public = with(|e| e.state.clone());
    let subscribed = has_subscription();
    std::thread::spawn(move || {
        let current = || is_auth_current(&context) && !cancel.is_cancelled();
        let path = format!("{EPIC_ENDPOINT}?connectionId={}", encode(&connection_id));
        let deleted = write_guard("DELETE /profile/integrations/epic")
            .and_then(|()| api.delete(&path, hydra_options()).map(|_| ()));
        let outcome: Result<(), EpicError> = match deleted {
            Ok(()) => Ok(()),
            Err(error) => {
                // reconcileDisconnect
                let cause = protocol::connection_error(&error);
                let stale = cause.is("account-in-use")
                    || cause.is("stale-connection")
                    || cause.is("different-account");
                if !stale
                    && (protocol::has_http_response(&error)
                        || !(cause.is("network") || cause.is("timeout")))
                {
                    Err(cause)
                } else {
                    match api
                        .get(EPIC_ENDPOINT, &[], hydra_options())
                        .map_err(|e| protocol::connection_error(&e))
                        .and_then(|v| protocol::validate_connection(&v))
                    {
                        Ok(None) if !stale => Ok(()),
                        Ok(Some(latest)) if !stale => {
                            Err(EpicError::new(if latest.connection_id == connection_id {
                                cause.code()
                            } else {
                                "stale-connection"
                            }))
                        }
                        Ok(_) => Err(EpicError::new("stale-connection")),
                        Err(error) => Err(error),
                    }
                }
            }
        };
        let mut removed = Err(EpicError::cancelled());
        let mut previous = None;
        if outcome.is_ok() && current() {
            let scope = context.scope();
            previous = shared
                .provider
                .store
                .read(&scope)
                .ok()
                .flatten()
                .map(|s| s.connection);
            removed = shared
                .provider
                .store
                .remove(&scope, &current, Some(&connection_id));
            connection_changed(
                &api,
                &db,
                &context,
                previous.as_ref(),
                None,
                last_public.as_ref(),
                None,
                subscribed,
                &current,
            );
        }
        let _ = slint::invoke_from_event_loop(move || {
            let _ = previous;
            match outcome {
                Err(error) => {
                    get_connection(None);
                    finish_operation(&id, Some(&error.0));
                }
                Ok(()) => {
                    with(|e| e.cached = Some(Cached::from_stored(&context, None)));
                    let error = removed.err().map(|e| e.0);
                    if let Some(error) = &error {
                        with(|e| {
                            if let Some(cached) = e.cached.as_mut() {
                                cached.session_state = SessionState::Unavailable;
                                cached.error = Some(error.clone());
                            }
                        });
                    }
                    remote_state(&context, None, error.clone());
                    shell::load_library();
                    finish_operation(&id, error.as_deref());
                }
            }
        });
    });
}

// ---- the library sync (EpicSyncRuntime) ----------------------------------

fn journal_key(context: &Context) -> String {
    orchestrator::journal_key(context)
}

/// The orchestrator's dependencies over the real services.
struct Deps {
    shared: Arc<Shared>,
    api: Arc<HydraApi>,
    db: Arc<Db>,
    context: Context,
    subscribed: bool,
}

impl Deps {
    fn current(&self) -> bool {
        sync_current(&self.context)
    }

    fn options(&self) -> Options {
        hydra_options()
    }
}

impl orchestrator::Dependencies for Deps {
    fn current(&self) -> bool {
        Deps::current(self)
    }

    fn library(&self, cancel: &Cancel) -> hydra_epic::error::Result<Vec<SnapshotGame>> {
        let current = || self.current();
        self.shared
            .provider
            .use_runner(&self.context, cancel, &current, |runner, save| {
                let platforms = runner.library(cancel, save)?;
                library::normalize_library(&platforms, &mut |diagnostic| {
                    eprintln!("[epic] Epic library validation failed: {diagnostic:?}");
                })
            })
    }

    fn playtime(
        &self,
        cancel: &Cancel,
        fresh: bool,
    ) -> hydra_epic::error::Result<std::collections::HashMap<String, i64>> {
        let current = || self.current();
        self.shared.playtime.get(
            &self.shared.provider,
            &self.context,
            cancel,
            &current,
            fresh,
        )
    }

    fn achievements(
        &self,
        games: Vec<SnapshotGame>,
        cancel: &Cancel,
        progress: &(dyn Fn(usize, usize) + Sync),
        budget: Duration,
    ) -> hydra_epic::error::Result<(Vec<SnapshotGame>, bool)> {
        let key = format!("{}:achievementPending", journal_key(&self.context));
        let pending: Vec<String> = self.db.get(&key).unwrap_or_default();
        let current = || self.current();
        let targets = |object_ids: &[String], _cancel: &Cancel| {
            let body = json!({
                "connectionId": self.context.connection.connection_id,
                "objectIds": object_ids,
            });
            let value = self
                .api
                .post(
                    &format!("{EPIC_ENDPOINT}/achievement-targets"),
                    &body,
                    self.options(),
                )
                .map_err(|e| protocol::sync_http_error(&e))?;
            sources::parse_achievement_targets(&value, object_ids)
        };
        let mut result = sources::collect_achievements(
            &self.shared.provider,
            &self.context,
            &games,
            cancel,
            &current,
            &targets,
            &pending,
            progress,
            budget,
        )?;
        if !self.current() || cancel.is_cancelled() {
            return Err(EpicError::cancelled());
        }
        if let Err(error) = build_chunks(&self.context.connection.connection_id, &result.games) {
            if !error.is("snapshot-too-large") {
                return Err(error);
            }
            for game in &mut result.games {
                game.achievements = Some(None);
            }
            build_chunks(&self.context.connection.connection_id, &result.games)?;
            result.pending_object_ids = result.games.iter().map(SnapshotGame::object_id).collect();
        }
        if self.current() {
            let _ = self.db.put(&key, &result.pending_object_ids);
        }
        Ok((result.games, result.requires_reconnect))
    }

    fn start(&self, trigger: &str, cancel: &Cancel) -> hydra_epic::error::Result<String> {
        let mut body = json!({
            "connectionId": self.context.connection.connection_id,
            "trigger": trigger,
        });
        if self.context.connection.achievements_snapshot_version {
            body["achievementSnapshotVersion"] = json!(1);
        }
        let started = write_guard("POST /profile/integrations/epic/sync").and_then(|()| {
            self.api
                .post(&format!("{EPIC_ENDPOINT}/sync"), &body, self.options())
        });
        let value = match started {
            Ok(value) => value,
            Err(error) => {
                if self.current() && !cancel.is_cancelled() {
                    let latest = self
                        .api
                        .get(EPIC_ENDPOINT, &[], self.options())
                        .ok()
                        .and_then(|v| protocol::validate_connection(&v).ok().flatten());
                    if self.current()
                        && latest.as_ref().is_some_and(|c| {
                            c.connection_id == self.context.connection.connection_id
                                && c.latest_sync_run
                                    .as_ref()
                                    .is_some_and(|r| r.status == "PENDING" || r.status == "RUNNING")
                        })
                    {
                        return Err(EpicError::new("sync-active"));
                    }
                }
                return Err(protocol::sync_http_error(&error));
            }
        };
        value
            .get("syncRunId")
            .and_then(Value::as_str)
            .filter(|id| protocol::is_run_id(id))
            .map(str::to_string)
            .ok_or_else(|| EpicError::new("invalid-response"))
    }

    fn run(&self, id: &str, _cancel: &Cancel) -> hydra_epic::error::Result<SyncRun> {
        let value = self
            .api
            .get(&format!("{EPIC_ENDPOINT}/sync/{id}"), &[], self.options())
            .map_err(|e| protocol::sync_http_error(&e))?;
        protocol::parse_sync_run(&value)
    }

    fn upload(
        &self,
        id: &str,
        index: usize,
        chunk: &Chunk,
        _cancel: &Cancel,
    ) -> hydra_epic::error::Result<()> {
        let body = serde_json::to_value(chunk).map_err(|_| EpicError::new("invalid-response"))?;
        write_guard("PUT …/snapshot/chunks")
            .and_then(|()| {
                self.api.put(
                    &format!("{EPIC_ENDPOINT}/sync/{id}/snapshot/chunks/{index}"),
                    &body,
                    self.options(),
                )
            })
            .map(|_| ())
            .map_err(|e| protocol::sync_http_error(&e))
    }

    fn commit(&self, id: &str, _cancel: &Cancel) -> hydra_epic::error::Result<()> {
        let body = json!({ "connectionId": self.context.connection.connection_id });
        write_guard("POST …/snapshot/commit")
            .and_then(|()| {
                self.api.post(
                    &format!("{EPIC_ENDPOINT}/sync/{id}/snapshot/commit"),
                    &body,
                    self.options(),
                )
            })
            .map(|_| ())
            .map_err(|e| protocol::sync_http_error(&e))
    }

    fn cancel_run(&self, id: &str, _cancel: &Cancel) -> hydra_epic::error::Result<()> {
        let path = format!(
            "{EPIC_ENDPOINT}/sync/{id}?connectionId={}",
            encode(&self.context.connection.connection_id)
        );
        write_guard("DELETE …/sync/:id")
            .and_then(|()| self.api.delete(&path, self.options()))
            .map(|_| ())
            .map_err(|e| protocol::sync_http_error(&e))
    }

    fn journal(&self) -> Option<Journal> {
        let key = journal_key(&self.context);
        let journal: Journal = self.db.get(&key)?;
        if protocol::is_legacy_run_id(&journal.sync_run_id) {
            if self.current() {
                let _ = self.db.delete(&key);
            }
            return None;
        }
        (protocol::is_run_id(&journal.sync_run_id) && journal.total_chunks.is_none_or(|n| n > 0))
            .then_some(journal)
    }

    fn save_journal(&self, journal: Option<&Journal>) -> hydra_epic::error::Result<()> {
        if !self.current() {
            return Err(EpicError::cancelled());
        }
        let key = journal_key(&self.context);
        match journal {
            Some(journal) => self.db.put(&key, journal),
            None => self.db.delete(&key),
        }
        .map_err(|_| EpicError::new("persistence-failed"))
    }

    fn merge(
        &self,
        progress: &(dyn Fn(usize, usize) + Sync),
        cancel: &Cancel,
    ) -> hydra_epic::error::Result<bool> {
        let current = || self.current() && !cancel.is_cancelled();
        let report = |processed: usize, total: usize| progress(processed, total);
        let merged = hydra_core::remote_library::merge_with_remote_games(
            &self.api,
            &self.db,
            &hydra_core::remote_library::MergeOptions {
                can_reconcile_custom_artwork: self.subscribed,
                context: Some(hydra_core::remote_library::EpicScope {
                    environment: self.context.auth.environment.clone(),
                    user_id: self.context.auth.user_id.clone(),
                }),
                epic_connection_id: Some(self.context.connection.connection_id.clone()),
                current: &current,
                progress: Some(&report),
                api_options: self.options(),
            },
        );
        if merged && !cancel.is_cancelled() {
            // getConnection(): lastSyncedAt and the latest run
            let _ = slint::invoke_from_event_loop(|| get_connection(None));
            // TODO(epic): importEpicStoreInstallations (EGS-installed games as installed)
        }
        Ok(merged)
    }

    fn emit(&self, state: SyncState) {
        let _ = slint::invoke_from_event_loop(move || set_sync_state(state));
    }
}

fn set_sync_state(state: SyncState) {
    let user = auth_context().map(|c| c.user_id);
    if state.hydra_user_id != user {
        return;
    }
    with(|e| e.sync = state.clone());
    crate::settings_integrations::on_epic_sync(&state);
}

/// EpicSyncRuntime.invalidate: running work stops; cached sources go.
fn invalidate_sync() {
    if let Some(shared) = shared() {
        shared.playtime.clear_cache();
    }
    with(|e| {
        if let Some(op) = e.sync_op.as_ref() {
            op.cancel.cancel();
        }
    });
}

fn startup_key(context: &Context) -> String {
    json!([
        context.auth.environment,
        context.auth.user_id,
        context.auth.generation,
        context.connection.connection_id
    ])
    .to_string()
}

/// capture(): the confirmed link of the current account, after a fresh read.
fn capture(then: impl FnOnce(Result<Context, String>) + 'static) {
    let Some(auth) = auth_context() else {
        return then(Err("hydra-auth-required".into()));
    };
    get_connection(Some(Box::new(move |state: PublicState| {
        if !is_auth_current(&auth) || !state.confirmed {
            return then(Err("stale-connection".into()));
        }
        let Some(connection) = state.connected().cloned() else {
            return then(Err("stale-connection".into()));
        };
        if state.operation.is_some() {
            return then(Err("operation-in-progress".into()));
        }
        then(Ok(Context { auth, connection }))
    })));
}

/// runtime.startup(firstLink): once per account, generation and link.
fn sync_startup(first_link: bool) {
    capture(move |context| {
        let Ok(context) = context else { return };
        let key = startup_key(&context);
        if !with(|e| e.startup_attempted.insert(key)) {
            return;
        }
        start_sync_for(context, if first_link { "FIRST_LINK" } else { "STARTUP" });
    });
}

/// runtime.authenticated(firstLink): a new sign-in syncs again.
fn sync_authenticated(first_link: bool) {
    let Some(auth) = auth_context() else { return };
    let Some(connection) = state().and_then(|s| s.connected().cloned()) else {
        return;
    };
    if let Some(shared) = shared() {
        shared.playtime.clear_cache();
    }
    let key = startup_key(&Context {
        auth: auth.clone(),
        connection,
    });
    with(|e| {
        e.startup_attempted.remove(&key);
        if e.sync_op.is_none() {
            e.sync = SyncState::idle(Some(auth.user_id.clone()));
        }
    });
    crate::settings_integrations::on_epic_sync(&sync_state());
    sync_startup(first_link);
}

/// startEpicSync(connectionId): the card's Sync.
pub fn start_sync(connection_id: &str) {
    if !protocol::is_connection_id(connection_id) {
        return;
    }
    let expected = connection_id.to_string();
    capture(move |context| match context {
        Ok(context) if context.connection.connection_id == expected => {
            start_sync_for(context, "MANUAL")
        }
        Ok(_) | Err(_) => {
            eprintln!("[epic] sync not started: stale connection");
        }
    });
}

/// orchestrator.start → prepare → execute (on a worker).
fn start_sync_for(context: Context, trigger: &'static str) {
    if with(|e| e.sync_preparing) {
        return;
    }
    if let Some(running) = with(|e| e.sync_op.as_ref().map(|op| op.context.clone())) {
        if sync_current(&running) {
            return;
        }
        invalidate_sync();
    }
    let (Some(api), Some(db), Some(shared)) = (shell::api(), shell::db(), shared()) else {
        return;
    };
    if !sync_current(&context) {
        return;
    }
    let cancel = Cancel::new();
    with(|e| {
        e.sync_op = Some(SyncOp {
            context: context.clone(),
            cancel: cancel.clone(),
        })
    });
    set_sync_state(SyncState {
        status: "running",
        hydra_user_id: Some(context.auth.user_id.clone()),
        connection_id: Some(context.connection.connection_id.clone()),
        phase: Some(orchestrator::Phase::Starting),
        ..Default::default()
    });
    let deps = Deps {
        shared,
        api,
        db,
        context: context.clone(),
        subscribed: has_subscription(),
    };
    std::thread::spawn(move || {
        let finished = orchestrator::execute(&deps, &context, trigger, &cancel);
        let _ = slint::invoke_from_event_loop(move || {
            with(|e| {
                if e.sync_op.as_ref().is_some_and(|op| op.context == context) {
                    e.sync_op = None;
                }
            });
            on_sync_finished(finished);
        });
    });
}

fn on_sync_finished(finished: Finished) {
    if finished.error.is_some() {
        eprintln!(
            "[epic] sync finished: {:?} ({}, {})",
            finished.error, finished.origin, finished.publication
        );
    }
    crate::settings_integrations::on_epic_sync_finished(&finished);
    // on-library-batch-complete
    shell::load_library();
}

/// cancelEpicSync(connectionId)
pub fn cancel_sync(connection_id: &str) {
    let running = with(|e| {
        e.sync_op.as_ref().map(|op| {
            (
                op.context.connection.connection_id.clone(),
                op.cancel.clone(),
            )
        })
    });
    if let Some((id, cancel)) = running {
        if id != connection_id {
            return;
        }
        cancel.cancel();
        let mut state = sync_state();
        state.status = "cancelling";
        set_sync_state(state);
        return;
    }
    // A PENDING run with no local operation (left by a previous session).
    let expected = connection_id.to_string();
    capture(move |context| {
        let context = match context {
            Ok(context) if context.connection.connection_id == expected => context,
            _ => return,
        };
        let pending = context
            .connection
            .latest_sync_run
            .as_ref()
            .filter(|r| r.status == "PENDING")
            .map(|r| r.id.clone());
        let user = context.auth.user_id.clone();
        if let (Some(id), Some(api), Some(db), Some(shared)) =
            (pending, shell::api(), shell::db(), shared())
        {
            let deps = Deps {
                shared,
                api,
                db,
                context,
                subscribed: false,
            };
            std::thread::spawn(move || {
                use orchestrator::Dependencies;
                if deps.cancel_run(&id, &Cancel::new()).is_ok() {
                    let _ = deps.save_journal(None);
                }
                let _ = slint::invoke_from_event_loop(move || {
                    set_sync_state(SyncState::idle(Some(user)))
                });
            });
        } else {
            set_sync_state(SyncState::idle(Some(user)));
        }
    });
}

/// A removal closure for an Epic download (deleteGameFolder's Epic branch),
/// built on the UI thread (running state, account) and run on a worker.
#[allow(clippy::type_complexity)]
pub fn removal_context(key: &str) -> Option<Box<dyn FnOnce(&Db) -> Result<(), String> + Send>> {
    let db = shell::db()?;
    hydra_epic::removal::epic_download(&db, key)?;
    let user_data = shared()?.user_data.clone();
    let context = auth_context();
    // isGameRunning || hasManagedEpicSession (no managed launches in the rewrite yet)
    let running = crate::games::is_running(key);
    let key = key.to_string();
    Some(Box::new(move |db: &Db| {
        hydra_epic::removal::remove_epic_installation(
            db,
            &user_data,
            &key,
            context.as_ref(),
            &|| running,
        )
        .map_err(|e| e.0)?;
        // syncAfterDownloadRemoved
        let downloads = hydra_downloads::layout::all(db);
        hydra_downloads::layout::remove(db, &key, &downloads);
        Ok(())
    }))
}

/// Used by the dev hooks: Legendary's availability line for logs.
pub fn describe() -> String {
    let state = state();
    format!(
        "legendary={:?} managed={:?} connected={} session={:?} confirmed={} operation={:?} sync={} window={} page={:?}",
        legendary::availability(),
        legendary::managed_installation_support(),
        state.as_ref().and_then(|s| s.connected()).is_some(),
        state.as_ref().map(|s| s.session_state),
        state.as_ref().is_some_and(|s| s.confirmed),
        state.as_ref().and_then(PublicState::operation_status),
        sync_state().status,
        window::is_open(),
        window::current_page(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jwt_user_ids() {
        use base64::Engine;
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(br#"{"userId":"abc123","exp":1}"#);
        assert_eq!(
            jwt_user_id(&format!("h.{payload}.s")).as_deref(),
            Some("abc123")
        );
        assert_eq!(jwt_user_id("garbage"), None);
    }

    #[test]
    fn connect_payloads() {
        let user = json!({
            "account_id": "0123456789ABCDEF0123456789abcdef",
            "displayName": " Player ",
            "access_token": "eg1~token",
            "expires_at": "2099-01-01T00:00:00.000Z",
        });
        let payload = connect_payload(&user).unwrap();
        assert_eq!(payload["epicAccountId"], "0123456789abcdef0123456789abcdef");
        assert_eq!(payload["displayName"], "Player");
        let mut expired = user.clone();
        expired["expires_at"] = json!("2001-01-01T00:00:00.000Z");
        assert_eq!(connect_payload(&expired).unwrap_err().code(), "auth-failed");
        let mut spaced = user.clone();
        spaced["access_token"] = json!("a b");
        assert_eq!(connect_payload(&spaced).unwrap_err().code(), "auth-failed");
        assert_eq!(encode("a b:c"), "a%20b%3Ac");
    }
}
