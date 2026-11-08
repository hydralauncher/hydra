//! Hydra API client: `src/main/services/hydra-api.ts`.
//!
//! Same base URL, `User-Agent`, bearer token, refresh rule (refresh when the
//! stored expiration has passed; expirations are saved 5 minutes early) and
//! sign-out on 401. Blocking: call it from worker threads only.

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use hydra_db::{Db, keys};
use reqwest::Method;
use reqwest::blocking::{Client, RequestBuilder};
use serde_json::{Value, json};

use crate::config;

const EXPIRATION_OFFSET_MS: i64 = 5 * 60 * 1000;
const AUTH_REFRESH_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone)]
pub enum ApiError {
    /// `UserNotLoggedInError`.
    NotLoggedIn,
    /// The API answered with an error status (body kept for `code`/`message`).
    Status {
        status: u16,
        body: Option<Value>,
    },
    Network(String),
}

impl ApiError {
    /// The API's error code (`{ code, message }` bodies), when there is one.
    pub fn code(&self) -> Option<&str> {
        match self {
            ApiError::Status {
                body: Some(body), ..
            } => body.get("code").and_then(Value::as_str),
            _ => None,
        }
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::NotLoggedIn => f.write_str("user not logged in"),
            ApiError::Status { status, body } => match body
                .as_ref()
                .and_then(|b| Some((b.get("code")?.as_str()?, b.get("message")?.as_str()?)))
            {
                Some((code, message)) => write!(f, "Request failed with {code} {message}"),
                None => write!(f, "Request failed with status code {status}"),
            },
            ApiError::Network(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for ApiError {}

fn with_body(
    builder: reqwest::blocking::RequestBuilder,
    body: &Value,
) -> reqwest::blocking::RequestBuilder {
    if body.is_null() {
        builder
    } else {
        builder.json(body)
    }
}

#[derive(Clone, Default)]
struct UserAuth {
    auth_token: String,
    refresh_token: String,
    expiration_timestamp: i64,
}

/// Options that `HydraApiOptions` carries in Electron.
#[derive(Clone, Copy, Debug)]
pub struct Options {
    pub needs_auth: bool,
    pub timeout: Option<Duration>,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            needs_auth: true,
            timeout: None,
        }
    }
}

impl Options {
    pub fn public() -> Self {
        Options {
            needs_auth: false,
            timeout: None,
        }
    }
}

pub struct HydraApi {
    client: Client,
    base: String,
    db: Arc<Db>,
    auth: Mutex<UserAuth>,
    /// Called after a 401 cleared the session (`sendSignOutEvent`).
    on_sign_out: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

impl HydraApi {
    /// `HydraApi.setupApi()`: base URL, `User-Agent`, and the stored session.
    pub fn new(db: Arc<Db>, client: Client) -> Self {
        let api = HydraApi {
            client,
            base: config::api_url().trim_end_matches('/').to_string(),
            db,
            auth: Mutex::new(UserAuth::default()),
            on_sign_out: Mutex::new(None),
        };
        api.reload_auth();
        api
    }

    pub fn user_agent() -> String {
        format!("Hydra Launcher v{}", config::app_version())
    }

    /// Reads `levelKeys.auth` again (after sign-in wrote it).
    pub fn reload_auth(&self) {
        let stored: Option<Value> = self.db.get(keys::AUTH);
        let field = |name: &str| stored.as_ref().and_then(|a| a.get(name)).cloned();
        let auth = UserAuth {
            auth_token: field("accessToken")
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default(),
            refresh_token: field("refreshToken")
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default(),
            expiration_timestamp: field("tokenExpirationTimestamp")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0) as i64,
        };
        if let Ok(mut current) = self.auth.lock() {
            *current = auth;
        }
    }

    pub fn set_on_sign_out(&self, callback: impl Fn() + Send + Sync + 'static) {
        if let Ok(mut slot) = self.on_sign_out.lock() {
            *slot = Some(Box::new(callback));
        }
    }

    pub fn is_logged_in(&self) -> bool {
        self.auth
            .lock()
            .map(|a| !a.auth_token.is_empty())
            .unwrap_or(false)
    }

    /// `HydraApi.handleSignIn` payload (auth window redirect): store the session.
    pub fn sign_in(&self, access_token: &str, refresh_token: &str, expires_in_seconds: f64) {
        let expiration = now_ms() + (expires_in_seconds * 1000.0) as i64 - EXPIRATION_OFFSET_MS;
        let _ = self.db.put(
            keys::AUTH,
            &json!({
                "accessToken": access_token,
                "refreshToken": refresh_token,
                "tokenExpirationTimestamp": expiration,
            }),
        );
        self.reload_auth();
    }

    /// Local half of sign-out: forget the session (`clearPersistedAuth`).
    pub fn clear_session(&self) {
        if let Ok(mut auth) = self.auth.lock() {
            *auth = UserAuth::default();
        }
        let _ = self.db.delete(keys::AUTH);
        let _ = self.db.delete(keys::USER);
    }

    fn refresh_token(&self) -> Result<(), ApiError> {
        let refresh = self
            .auth
            .lock()
            .map(|a| a.refresh_token.clone())
            .unwrap_or_default();
        let response = self
            .client
            .post(format!("{}/auth/refresh", self.base))
            .header("User-Agent", Self::user_agent())
            .json(&json!({ "refreshToken": refresh }))
            .timeout(AUTH_REFRESH_TIMEOUT)
            .send()
            .map_err(|e| ApiError::Network(e.to_string()))?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(ApiError::Status {
                status,
                body: response.json().ok(),
            });
        }
        let body: Value = response
            .json()
            .map_err(|e| ApiError::Network(e.to_string()))?;
        let access = body
            .get("accessToken")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let expires_in = body.get("expiresIn").and_then(Value::as_f64).unwrap_or(0.0);
        let expiration = now_ms() + (expires_in * 1000.0) as i64 - EXPIRATION_OFFSET_MS;
        if let Ok(mut auth) = self.auth.lock() {
            auth.auth_token = access.clone();
            auth.expiration_timestamp = expiration;
        }
        let mut stored: Value = self.db.get(keys::AUTH).unwrap_or_else(|| json!({}));
        if let Some(obj) = stored.as_object_mut() {
            obj.insert("accessToken".into(), Value::String(access));
            obj.insert("tokenExpirationTimestamp".into(), Value::from(expiration));
        }
        let _ = self.db.put(keys::AUTH, &stored);
        Ok(())
    }

    fn handle_unauthorized(&self, error: &ApiError) {
        if let ApiError::Status { status: 401, .. } = error {
            eprintln!("hydra-api: 401, signing out");
            self.clear_session();
            if let Ok(callback) = self.on_sign_out.lock()
                && let Some(callback) = callback.as_ref()
            {
                callback();
            }
        }
    }

    /// `validateOptions`: logged in, and a fresh token.
    fn validate(&self, options: Options) -> Result<(), ApiError> {
        if !options.needs_auth {
            return Ok(());
        }
        if !self.is_logged_in() {
            return Err(ApiError::NotLoggedIn);
        }
        let expired = self
            .auth
            .lock()
            .map(|a| a.expiration_timestamp < now_ms())
            .unwrap_or(true);
        if expired && let Err(error) = self.refresh_token() {
            self.handle_unauthorized(&error);
            return Err(error);
        }
        Ok(())
    }

    fn request(&self, method: Method, path: &str, options: Options) -> RequestBuilder {
        let token = self
            .auth
            .lock()
            .map(|a| a.auth_token.clone())
            .unwrap_or_default();
        let mut builder = self
            .client
            .request(method, format!("{}{}", self.base, path))
            .header("User-Agent", Self::user_agent())
            .header("Authorization", format!("Bearer {token}"));
        if let Some(timeout) = options.timeout {
            builder = builder.timeout(timeout);
        }
        builder
    }

    fn send(&self, builder: RequestBuilder, options: Options) -> Result<Value, ApiError> {
        let response = builder
            .send()
            .map_err(|e| ApiError::Network(e.to_string()))?;
        let status = response.status().as_u16();
        let text = response
            .text()
            .map_err(|e| ApiError::Network(e.to_string()))?;
        let body: Option<Value> = serde_json::from_str(&text).ok();
        if (200..300).contains(&status) {
            return Ok(body.unwrap_or(Value::Null));
        }
        let error = ApiError::Status { status, body };
        if options.needs_auth {
            self.handle_unauthorized(&error);
        }
        Err(error)
    }

    pub fn get(
        &self,
        path: &str,
        query: &[(&str, String)],
        options: Options,
    ) -> Result<Value, ApiError> {
        self.validate(options)?;
        let path = if query.is_empty() {
            path.to_string()
        } else {
            let url = reqwest::Url::parse_with_params(&format!("http://q{path}"), query)
                .map_err(|e| ApiError::Network(e.to_string()))?;
            format!("{}?{}", url.path(), url.query().unwrap_or_default())
        };
        let builder = self.request(Method::GET, &path, options);
        self.send(builder, options)
    }

    /// `body` Null sends no body (axios with no data).
    pub fn post(&self, path: &str, body: &Value, options: Options) -> Result<Value, ApiError> {
        self.validate(options)?;
        let builder = with_body(self.request(Method::POST, path, options), body);
        self.send(builder, options)
    }

    pub fn put(&self, path: &str, body: &Value, options: Options) -> Result<Value, ApiError> {
        self.validate(options)?;
        let builder = with_body(self.request(Method::PUT, path, options), body);
        self.send(builder, options)
    }

    pub fn patch(&self, path: &str, body: &Value, options: Options) -> Result<Value, ApiError> {
        self.validate(options)?;
        let builder = with_body(self.request(Method::PATCH, path, options), body);
        self.send(builder, options)
    }

    pub fn delete(&self, path: &str, options: Options) -> Result<Value, ApiError> {
        self.validate(options)?;
        let builder = self.request(Method::DELETE, path, options);
        self.send(builder, options)
    }
}
