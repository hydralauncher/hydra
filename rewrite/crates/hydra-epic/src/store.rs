//! store.ts (EpicConnectionStore): the Epic link and Legendary session per
//! Hydra account, in `<userData>/epic-sessions-db` (its own LevelDB with
//! JSON values, keyed by sha256 of `JSON.stringify([environment, userId])`).
//!
//! Records are `{ schemaVersion: 1, connection, bundle?: { user, version } }`,
//! where `bundle` holds Legendary's `user.json` and `version.json`. Only the
//! main process reads them; the UI never sees a token.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use hydra_db::Db;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::error::{EpicError, Result, err};
use crate::protocol::{
    Connection, parse_stored_connection, validate_legendary_session, validate_legendary_version,
};
use crate::time::{now_ms, parse_ms};

pub const EPIC_STORE_MAX_RECORD_BYTES: usize = 1024 * 1024;
pub const STORE_DIRECTORY: &str = "epic-sessions-db";

/// EpicStoreScope: the Hydra environment (API URL) and user.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Scope {
    pub environment: String,
    pub user_id: String,
}

/// Legendary's `user.json` and `version.json` (EpicSessionBundle).
#[derive(Clone, Debug, PartialEq)]
pub struct Bundle {
    pub user: Value,
    pub version: Value,
}

impl Bundle {
    pub fn account_id(&self) -> String {
        self.user
            .get("account_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase()
    }

    fn field_ms(&self, key: &str) -> Option<i64> {
        self.user
            .get(key)
            .and_then(Value::as_str)
            .and_then(parse_ms)
    }

    pub fn expires_at(&self) -> Option<i64> {
        self.field_ms("expires_at")
    }

    pub fn refresh_expires_at(&self) -> Option<i64> {
        self.field_ms("refresh_expires_at")
    }

    pub fn access_token(&self) -> &str {
        self.user
            .get("access_token")
            .and_then(Value::as_str)
            .unwrap_or_default()
    }

    pub fn refresh_token(&self) -> &str {
        self.user
            .get("refresh_token")
            .and_then(Value::as_str)
            .unwrap_or_default()
    }

    /// `Date.parse(expires_at) > Date.now()`
    pub fn access_valid(&self) -> bool {
        self.expires_at().is_some_and(|at| at > now_ms())
    }

    pub fn to_json(&self) -> Value {
        json!({ "user": self.user, "version": self.version })
    }
}

/// isBundle: valid Legendary files for this Epic account.
pub fn parse_bundle(value: &Value, epic_account_id: &str) -> Option<Bundle> {
    let user = value.get("user")?;
    let version = value.get("version")?;
    validate_legendary_session(user).ok()?;
    validate_legendary_version(version).ok()?;
    let bundle = Bundle {
        user: user.clone(),
        version: version.clone(),
    };
    (bundle.account_id() == epic_account_id).then_some(bundle)
}

/// EpicSessionState
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionState {
    Ready,
    Expired,
    Missing,
    Unavailable,
}

impl SessionState {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionState::Ready => "ready",
            SessionState::Expired => "expired",
            SessionState::Missing => "missing",
            SessionState::Unavailable => "unavailable",
        }
    }
}

/// EpicStoredConnection
#[derive(Clone, Debug, PartialEq)]
pub struct Stored {
    pub connection: Connection,
    pub session_state: SessionState,
    pub bundle: Option<Bundle>,
}

struct Record {
    connection: Connection,
    bundle: Option<Value>,
}

impl Record {
    fn to_json(&self) -> Value {
        let mut value = json!({ "schemaVersion": 1, "connection": self.connection.to_json() });
        if let Some(bundle) = &self.bundle {
            value["bundle"] = bundle.clone();
        }
        value
    }

    /// describe
    fn describe(&self) -> Stored {
        let connection = self.connection.clone();
        let Some(raw) = &self.bundle else {
            return Stored {
                connection,
                session_state: SessionState::Missing,
                bundle: None,
            };
        };
        let Some(bundle) = parse_bundle(raw, &connection.epic_account_id) else {
            return Stored {
                connection,
                session_state: SessionState::Unavailable,
                bundle: None,
            };
        };
        if bundle.refresh_expires_at().is_none_or(|at| at <= now_ms()) {
            return Stored {
                connection,
                session_state: SessionState::Expired,
                bundle: None,
            };
        }
        Stored {
            connection,
            session_state: SessionState::Ready,
            bundle: Some(bundle),
        }
    }
}

fn trim_trailing_slashes(text: &str) -> &str {
    text.trim_end_matches('/')
}

/// getEpicStoreScopeKey
pub fn scope_key(scope: &Scope) -> Result<String> {
    let invalid = || EpicError::new("invalid-response");
    let environment = reqwest::Url::parse(&scope.environment).map_err(|_| invalid())?;
    if !["http", "https"].contains(&environment.scheme())
        || !environment.username().is_empty()
        || environment.password().is_some()
        || environment.query().is_some_and(|q| !q.is_empty())
        || environment.fragment().is_some_and(|f| !f.is_empty())
        || scope.user_id.is_empty()
        || scope.user_id.trim() != scope.user_id
    {
        return Err(invalid());
    }
    let canonical = serde_json::to_string(&[
        trim_trailing_slashes(environment.as_str()),
        scope.user_id.as_str(),
    ])
    .map_err(|_| invalid())?;
    Ok(format!("{:x}", Sha256::digest(canonical.as_bytes())))
}

/// EpicConnectionStore. Writes are serialized by one lock (the per-key queue
/// of store.ts); `is_current` is checked under it like `assertCurrent`.
pub struct Store {
    directory: PathBuf,
    db: Mutex<Option<Arc<Db>>>,
    lock: Mutex<()>,
    blocked: Mutex<std::collections::HashSet<String>>,
}

impl Store {
    pub fn new(user_data: &Path) -> Self {
        Store {
            directory: user_data.join(STORE_DIRECTORY),
            db: Mutex::new(None),
            lock: Mutex::new(()),
            blocked: Mutex::new(Default::default()),
        }
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    /// open(): the private directory must exist before LevelDB opens.
    pub fn open(&self) -> Result<Arc<Db>> {
        let mut slot = self
            .db
            .lock()
            .map_err(|_| EpicError::new("persistence-failed"))?;
        if let Some(db) = slot.as_ref() {
            return Ok(db.clone());
        }
        let persistence = |_| EpicError::new("persistence-failed");
        std::fs::create_dir_all(&self.directory).map_err(persistence)?;
        let meta = std::fs::symlink_metadata(&self.directory).map_err(persistence)?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return err("persistence-failed");
        }
        restrict_directory(&self.directory);
        let db =
            Arc::new(Db::open(&self.directory).map_err(|_| EpicError::new("persistence-failed"))?);
        *slot = Some(db.clone());
        Ok(db)
    }

    fn assert_unblocked(&self, key: &str) -> Result<()> {
        if self.blocked.lock().is_ok_and(|b| b.contains(key)) {
            return err("cleanup-failed");
        }
        Ok(())
    }

    fn read_record(&self, db: &Db, key: &str) -> Option<Record> {
        let value: Value = db.get(key)?;
        if serde_json::to_vec(&value).map_or(0, |v| v.len()) > EPIC_STORE_MAX_RECORD_BYTES
            || value.get("schemaVersion") != Some(&json!(1))
        {
            return None;
        }
        let connection = parse_stored_connection(value.get("connection")?)?;
        Some(Record {
            connection,
            bundle: value.get("bundle").cloned(),
        })
    }

    pub fn read(&self, scope: &Scope) -> Result<Option<Stored>> {
        let key = scope_key(scope)?;
        let _guard = self
            .lock
            .lock()
            .map_err(|_| EpicError::new("persistence-failed"))?;
        self.assert_unblocked(&key)?;
        let db = self.open()?;
        Ok(self.read_record(&db, &key).map(|r| r.describe()))
    }

    fn write_record(
        &self,
        db: &Db,
        key: &str,
        previous: Option<&Record>,
        record: &Record,
        is_current: &dyn Fn() -> bool,
    ) -> Result<Stored> {
        let value = record.to_json();
        if serde_json::to_vec(&value).map_or(usize::MAX, |v| v.len()) > EPIC_STORE_MAX_RECORD_BYTES
        {
            return err("invalid-response");
        }
        if !is_current() {
            return Err(EpicError::cancelled());
        }
        db.put(key, &value)
            .map_err(|_| EpicError::new("persistence-failed"))?;
        if !is_current() {
            let restored = match previous {
                Some(previous) => db.put(key, &previous.to_json()),
                None => db.delete(key),
            };
            if restored.is_err() {
                if let Ok(mut blocked) = self.blocked.lock() {
                    blocked.insert(key.to_string());
                }
                return err("cleanup-failed");
            }
            return Err(EpicError::cancelled());
        }
        Ok(record.describe())
    }

    /// cacheConnection: confirmed API metadata, keeping the bundle of the same link.
    pub fn cache_connection(
        &self,
        scope: &Scope,
        connection: &Connection,
        is_current: &dyn Fn() -> bool,
    ) -> Result<Stored> {
        let key = scope_key(scope)?;
        let _guard = self
            .lock
            .lock()
            .map_err(|_| EpicError::new("persistence-failed"))?;
        self.assert_unblocked(&key)?;
        if !is_current() {
            return Err(EpicError::cancelled());
        }
        let db = self.open()?;
        let previous = self.read_record(&db, &key);
        let same = previous
            .as_ref()
            .is_some_and(|p| p.connection.same_link(connection));
        let record = Record {
            connection: connection.clone(),
            bundle: if same {
                previous.as_ref().and_then(|p| p.bundle.clone())
            } else {
                None
            },
        };
        self.write_record(&db, &key, previous.as_ref(), &record, is_current)
    }

    /// save: a new login for this link.
    pub fn save(
        &self,
        scope: &Scope,
        connection: &Connection,
        bundle: &Bundle,
        is_current: &dyn Fn() -> bool,
    ) -> Result<Stored> {
        let key = scope_key(scope)?;
        let _guard = self
            .lock
            .lock()
            .map_err(|_| EpicError::new("persistence-failed"))?;
        self.assert_unblocked(&key)?;
        if !is_current() {
            return Err(EpicError::cancelled());
        }
        if parse_bundle(&bundle.to_json(), &connection.epic_account_id).is_none() {
            return err("invalid-response");
        }
        let db = self.open()?;
        let previous = self.read_record(&db, &key);
        let record = Record {
            connection: connection.clone(),
            bundle: Some(bundle.to_json()),
        };
        self.write_record(&db, &key, previous.as_ref(), &record, is_current)
    }

    /// refreshSession: credentials Legendary rotated. A finished operation
    /// can't overwrite credentials rotated meanwhile by another one.
    pub fn refresh_session(
        &self,
        scope: &Scope,
        connection: &Connection,
        bundle: &Bundle,
        is_current: &dyn Fn() -> bool,
        source: Option<&Bundle>,
    ) -> Result<Stored> {
        let key = scope_key(scope)?;
        let _guard = self
            .lock
            .lock()
            .map_err(|_| EpicError::new("persistence-failed"))?;
        self.assert_unblocked(&key)?;
        if !is_current() {
            return Err(EpicError::cancelled());
        }
        let db = self.open()?;
        let Some(previous) = self
            .read_record(&db, &key)
            .filter(|p| p.connection.same_link(connection))
        else {
            return err("stale-connection");
        };
        if parse_bundle(&bundle.to_json(), &connection.epic_account_id).is_none() {
            return err("invalid-response");
        }
        if let Some(source) = source
            && let Some(current) = previous
                .bundle
                .as_ref()
                .and_then(|b| parse_bundle(b, &connection.epic_account_id))
            && (current.refresh_token() != source.refresh_token()
                || current.access_token() != source.access_token())
        {
            return Ok(previous.describe());
        }
        let record = Record {
            connection: previous.connection.clone(),
            bundle: Some(bundle.to_json()),
        };
        self.write_record(&db, &key, Some(&previous), &record, is_current)
    }

    /// remove
    pub fn remove(
        &self,
        scope: &Scope,
        is_current: &dyn Fn() -> bool,
        expected_connection_id: Option<&str>,
    ) -> Result<()> {
        let key = scope_key(scope)?;
        let _guard = self
            .lock
            .lock()
            .map_err(|_| EpicError::new("persistence-failed"))?;
        if !is_current() {
            return Err(EpicError::cancelled());
        }
        let db = self.open()?;
        let previous = self.read_record(&db, &key);
        if !is_current() {
            return Err(EpicError::cancelled());
        }
        if let (Some(expected), Some(previous)) = (expected_connection_id, previous.as_ref())
            && previous.connection.connection_id != expected
        {
            return err("stale-connection");
        }
        match db.delete(&key) {
            Ok(()) => {
                if let Ok(mut blocked) = self.blocked.lock() {
                    blocked.remove(&key);
                }
                Ok(())
            }
            Err(_) => {
                if let Ok(mut blocked) = self.blocked.lock() {
                    blocked.insert(key);
                }
                err("cleanup-failed")
            }
        }
    }
}

/// mode 0o700 on POSIX (Windows keeps the profile folder's ACL).
pub fn restrict_directory(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700));
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// mode 0o600 on POSIX.
pub fn restrict_file(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn scope() -> Scope {
        Scope {
            environment: "https://api.example.com".into(),
            user_id: "user-1".into(),
        }
    }

    pub fn connection() -> Connection {
        crate::protocol::validate_connection(&json!({
            "connected": true,
            "connectionId": "conn12345678",
            "epicAccountId": "0123456789abcdef0123456789abcdef",
            "displayName": "Player",
            "connectedAt": "2026-01-01T00:00:00.000Z",
        }))
        .unwrap()
        .unwrap()
    }

    pub fn bundle(access: &str, refresh: &str) -> Bundle {
        Bundle {
            user: json!({
                "account_id": "0123456789ABCDEF0123456789abcdef",
                "displayName": "Player",
                "access_token": access,
                "refresh_token": refresh,
                "expires_at": "2099-01-01T00:00:00.000Z",
                "refresh_expires_at": "2099-01-02T00:00:00.000Z",
            }),
            version: json!({ "data": {} }),
        }
    }

    #[test]
    fn scope_key_matches_electron() {
        // node -e 'crypto.createHash("sha256").update(JSON.stringify(["https://api.example.com","user-1"])).digest("hex")'
        let expected = format!(
            "{:x}",
            Sha256::digest(br#"["https://api.example.com","user-1"]"#)
        );
        assert_eq!(scope_key(&scope()).unwrap(), expected);
        let slash = Scope {
            environment: "https://API.example.com/".into(),
            user_id: "user-1".into(),
        };
        assert_eq!(scope_key(&slash).unwrap(), expected);
        assert!(
            scope_key(&Scope {
                environment: "https://a.b/?x=1".into(),
                user_id: "u".into()
            })
            .is_err()
        );
        assert!(
            scope_key(&Scope {
                environment: "https://a.b".into(),
                user_id: " u".into()
            })
            .is_err()
        );
    }

    #[test]
    fn records_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        let yes = || true;
        assert_eq!(store.read(&scope()).unwrap(), None);
        let cached = store
            .cache_connection(&scope(), &connection(), &yes)
            .unwrap();
        assert_eq!(cached.session_state, SessionState::Missing);
        let saved = store
            .save(&scope(), &connection(), &bundle("a1", "r1"), &yes)
            .unwrap();
        assert_eq!(saved.session_state, SessionState::Ready);
        // the same link keeps its session when the API metadata is cached again
        let again = store
            .cache_connection(&scope(), &connection(), &yes)
            .unwrap();
        assert_eq!(again.session_state, SessionState::Ready);
        // rotation from a stale source is ignored
        let stale = store
            .refresh_session(
                &scope(),
                &connection(),
                &bundle("a3", "r3"),
                &yes,
                Some(&bundle("old", "old")),
            )
            .unwrap();
        assert_eq!(stale.bundle.unwrap().access_token(), "a1");
        let rotated = store
            .refresh_session(
                &scope(),
                &connection(),
                &bundle("a2", "r2"),
                &yes,
                Some(&bundle("a1", "r1")),
            )
            .unwrap();
        assert_eq!(rotated.bundle.unwrap().refresh_token(), "r2");
        // a cancelled write is rolled back
        let no = || false;
        assert!(
            store
                .save(&scope(), &connection(), &bundle("x", "y"), &no)
                .is_err()
        );
        assert_eq!(
            store
                .read(&scope())
                .unwrap()
                .unwrap()
                .bundle
                .unwrap()
                .access_token(),
            "a2"
        );
        assert!(store.remove(&scope(), &yes, Some("other12345")).is_err());
        store.remove(&scope(), &yes, Some("conn12345678")).unwrap();
        assert_eq!(store.read(&scope()).unwrap(), None);
    }

    #[test]
    fn session_states() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        let db = store.open().unwrap();
        let key = scope_key(&scope()).unwrap();
        let mut expired = bundle("a", "r");
        expired.user["refresh_expires_at"] = json!("2001-01-01T00:00:00.000Z");
        db.put(
            &key,
            &json!({"schemaVersion": 1, "connection": connection().to_json(), "bundle": expired.to_json()}),
        )
        .unwrap();
        assert_eq!(
            store.read(&scope()).unwrap().unwrap().session_state,
            SessionState::Expired
        );
        db.put(
            &key,
            &json!({"schemaVersion": 1, "connection": connection().to_json(), "bundle": {"user": {}}}),
        )
        .unwrap();
        assert_eq!(
            store.read(&scope()).unwrap().unwrap().session_state,
            SessionState::Unavailable
        );
        db.put(&key, &json!({"schemaVersion": 2})).unwrap();
        assert_eq!(store.read(&scope()).unwrap(), None);
    }
}
