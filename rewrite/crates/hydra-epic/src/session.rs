//! session-provider.ts (EpicSessionProvider): one credential lease at a time
//! for the stored Legendary session, access tokens refreshed on demand and
//! rotated tokens written back to the store.
//!
//! Refreshing goes through the managed adapter's `refresh` operation on
//! Windows and Linux (index.ts `setRefreshOperation`), and through
//! `legendary status --json` with a forced expiry elsewhere.

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Map, Value};

use crate::cancel::Cancel;
use crate::error::{EpicError, Result, err};
use crate::legendary;
use crate::managed::{self, Owner};
use crate::protocol::Connection;
use crate::runner::SyncRunner;
use crate::store::{Bundle, Scope, Store, Stored};
use crate::time::now_ms;

/// EpicAuthContext: the Hydra account a call belongs to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthContext {
    pub environment: String,
    pub user_id: String,
    pub generation: u64,
}

impl AuthContext {
    pub fn scope(&self) -> Scope {
        Scope {
            environment: self.environment.clone(),
            user_id: self.user_id.clone(),
        }
    }

    pub fn owner(&self, connection: &Connection) -> Owner {
        Owner {
            environment: self.environment.clone(),
            user_id: self.user_id.clone(),
            epic_account_id: connection.epic_account_id.clone(),
        }
    }
}

/// EpicSyncContext: the account and the link an operation runs for.
#[derive(Clone, Debug, PartialEq)]
pub struct Context {
    pub auth: AuthContext,
    pub connection: Connection,
}

pub struct SessionProvider {
    pub store: Store,
    pub user_data: PathBuf,
    lease: Mutex<()>,
    refreshes: AtomicU64,
}

impl SessionProvider {
    pub fn new(store: Store, user_data: PathBuf) -> Self {
        SessionProvider {
            store,
            user_data,
            lease: Mutex::new(()),
            refreshes: AtomicU64::new(0),
        }
    }

    fn stored(&self, context: &Context) -> Result<Option<Stored>> {
        self.store.read(&context.auth.scope())
    }

    fn matching_bundle(stored: Option<Stored>, connection: &Connection) -> Option<Bundle> {
        stored
            .filter(|s| s.connection.same_link(connection))
            .and_then(|s| s.bundle)
    }

    /// serialize: one credential lease at a time.
    fn lease(&self) -> std::sync::MutexGuard<'_, ()> {
        self.lease.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn save_rotated(
        &self,
        context: &Context,
        rotated: &Bundle,
        source: &Bundle,
        is_current: &dyn Fn() -> bool,
    ) -> Result<()> {
        self.store
            .refresh_session(
                &context.auth.scope(),
                &context.connection,
                rotated,
                is_current,
                Some(source),
            )
            .map(|_| ())
    }

    /// use(): a LegendarySyncRunner with the stored session; rotated tokens
    /// are saved as the runner reports them.
    pub fn use_runner<T>(
        &self,
        context: &Context,
        cancel: &Cancel,
        is_current: &dyn Fn() -> bool,
        task: impl FnOnce(&SyncRunner, &mut dyn FnMut(Bundle) -> Result<()>) -> Result<T>,
    ) -> Result<T> {
        let _lease = self.lease();
        if cancel.is_cancelled() || !is_current() {
            return Err(EpicError::cancelled());
        }
        let source = Self::matching_bundle(self.stored(context)?, &context.connection)
            .ok_or_else(|| EpicError::new("session-expired"))?;
        if source.refresh_expires_at().is_none_or(|at| at <= now_ms()) {
            return err("session-expired");
        }
        let binary = legendary::check_binary()?;
        let runner = SyncRunner::create(
            &binary,
            &self.user_data,
            &context.connection.epic_account_id,
            &source,
            cancel,
        )?;
        let mut on_session =
            |rotated: Bundle| self.save_rotated(context, &rotated, &source, is_current);
        let result = task(&runner, &mut on_session);
        let cleaned = runner.cleanup();
        let value = result?;
        cleaned?;
        Ok(value)
    }

    /// useBundle: the stored session for a managed request.
    pub fn use_bundle<T>(
        &self,
        context: &Context,
        cancel: &Cancel,
        is_current: &dyn Fn() -> bool,
        task: impl FnOnce(&Bundle, &mut dyn FnMut(Bundle) -> Result<()>) -> Result<T>,
    ) -> Result<T> {
        let _lease = self.lease();
        if cancel.is_cancelled() || !is_current() {
            return Err(EpicError::cancelled());
        }
        let source = Self::matching_bundle(self.stored(context)?, &context.connection)
            .ok_or_else(|| EpicError::new("session-expired"))?;
        if source.refresh_expires_at().is_none_or(|at| at <= now_ms()) {
            return err("session-expired");
        }
        let mut save = |rotated: Bundle| self.save_rotated(context, &rotated, &source, is_current);
        task(&source, &mut save)
    }

    /// The refresh operation itself (index.ts: managed on Windows and Linux).
    fn refresh(
        &self,
        context: &Context,
        cancel: &Cancel,
        is_current: &dyn Fn() -> bool,
        force: bool,
    ) -> Result<()> {
        if cfg!(windows) || cfg!(target_os = "linux") {
            let command = legendary::managed_command()?;
            self.use_bundle(context, cancel, is_current, |bundle, save| {
                let rotated = managed::refresh_session(
                    &command,
                    &self.user_data,
                    &context.auth.owner(&context.connection),
                    context.auth.generation,
                    &context.connection.connection_id,
                    bundle,
                    cancel,
                    is_current,
                )?;
                if !is_current() {
                    return Err(EpicError::cancelled());
                }
                // A finished rotation must survive its last consumer leaving.
                save(rotated)?;
                cancel.check()
            })
        } else {
            self.use_runner(context, cancel, is_current, |runner, save| {
                runner.refresh(force, cancel, save)
            })
        }
    }

    /// token(): a valid access token, refreshing when expired or forced.
    /// Concurrent callers share one refresh (a caller that waited behind a
    /// refresh doesn't start another).
    pub fn token(
        &self,
        context: &Context,
        cancel: &Cancel,
        is_current: &dyn Fn() -> bool,
        force: bool,
    ) -> Result<String> {
        cancel.check()?;
        let stored = Self::matching_bundle(self.stored(context)?, &context.connection);
        let Some(bundle) = stored.filter(|_| is_current()) else {
            return err("session-expired");
        };
        if force || !bundle.access_valid() {
            let seen = self.refreshes.load(Ordering::SeqCst);
            let _gate = REFRESH_GATE.lock().unwrap_or_else(|e| e.into_inner());
            if self.refreshes.load(Ordering::SeqCst) == seen {
                self.refresh(context, cancel, is_current, force)?;
                self.refreshes.fetch_add(1, Ordering::SeqCst);
            }
        }
        cancel.check()?;
        let refreshed = Self::matching_bundle(self.stored(context)?, &context.connection)
            .filter(|b| b.access_valid() && is_current())
            .ok_or_else(|| EpicError::new("session-expired"))?;
        Ok(refreshed.access_token().to_string())
    }

    /// accessSnapshot: the access token without the refresh token, for
    /// metadata workers that must not rotate the session.
    pub fn access_snapshot(
        &self,
        context: &Context,
        cancel: &Cancel,
        is_current: &dyn Fn() -> bool,
        force: bool,
    ) -> Result<Value> {
        self.token(context, cancel, is_current, force)?;
        let bundle = Self::matching_bundle(self.stored(context)?, &context.connection)
            .filter(|b| b.access_valid() && is_current() && !cancel.is_cancelled())
            .ok_or_else(EpicError::cancelled)?;
        let user = &bundle.user;
        let mut snapshot = Map::new();
        for key in [
            "access_token",
            "account_id",
            "displayName",
            "expires_at",
            "token_type",
        ] {
            // JSON.stringify drops undefined fields
            if let Some(value) = user.get(key) {
                snapshot.insert(key.into(), value.clone());
            }
        }
        if let Some(country) = user.get("country").filter(|c| c.is_string()) {
            snapshot.insert("country".into(), country.clone());
        }
        Ok(Value::Object(snapshot))
    }

    /// useLocalIdentity: offline launches need the account, not credentials.
    pub fn local_identity(
        &self,
        context: &Context,
        is_current: &dyn Fn() -> bool,
    ) -> Result<Value> {
        let _lease = self.lease();
        if !is_current() {
            return Err(EpicError::cancelled());
        }
        let stored = self.stored(context)?;
        if !stored.is_some_and(|s| s.connection.same_link(&context.connection)) {
            return err("stale-connection");
        }
        Ok(serde_json::json!({
            "account_id": context.connection.epic_account_id,
            "displayName": context.connection.display_name,
        }))
    }
}

static REFRESH_GATE: Mutex<()> = Mutex::new(());
