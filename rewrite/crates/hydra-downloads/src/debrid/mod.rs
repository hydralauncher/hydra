//! The debrid services' download side (services/download/{real-debrid,
//! all-debrid,premiumize,torbox}.ts): unrestricting links, sending torrents
//! to the service and waiting for its files. Tokens come from the user's
//! preferences on every call, so a changed token applies at once (Electron
//! re-authorizes its clients when the preference changes).

pub mod all_debrid;
pub mod files;
pub mod premiumize;
pub mod real_debrid;
pub mod torbox;

use std::future::Future;
use std::time::Duration;

use hydra_db::{Db, keys};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::errors::{DlError, DlResult};

/// The API tokens saved in the user's preferences.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Tokens {
    pub real_debrid: Option<String>,
    pub torbox: Option<String>,
    pub all_debrid: Option<String>,
    pub premiumize: Option<String>,
}

pub fn tokens(db: &Db) -> Tokens {
    let prefs: Option<Value> = db.get(keys::USER_PREFERENCES);
    let token = |key: &str| {
        prefs
            .as_ref()
            .and_then(|p| p.get(key))
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty())
            .map(str::to_string)
    };
    Tokens {
        real_debrid: token("realDebridApiToken"),
        torbox: token("torBoxApiToken"),
        all_debrid: token("allDebridApiToken"),
        premiumize: token("premiumizeApiToken"),
    }
}

/// `Hydra/<version>`, the agent the debrid services see.
pub fn agent() -> String {
    format!("Hydra/{}", hydra_core::config::app_version())
}

/// signal.throwIfAborted()
pub(crate) fn check(signal: Option<&CancellationToken>) -> DlResult<()> {
    if signal.is_some_and(CancellationToken::is_cancelled) {
        return Err(DlError::Aborted);
    }
    Ok(())
}

/// Runs `future` until it ends or `signal` is cancelled.
pub(crate) async fn guarded<T>(
    signal: Option<&CancellationToken>,
    future: impl Future<Output = DlResult<T>>,
) -> DlResult<T> {
    match signal {
        Some(signal) => tokio::select! {
            _ = signal.cancelled() => Err(DlError::Aborted),
            result = future => result,
        },
        None => future.await,
    }
}

/// `sleep(ms, undefined, { signal })`
pub(crate) async fn sleep(ms: u64, signal: Option<&CancellationToken>) -> DlResult<()> {
    guarded(signal, async {
        tokio::time::sleep(Duration::from_millis(ms)).await;
        Ok(())
    })
    .await
}

/// The JSON body, or an Http error with the status and body (like axios).
pub(crate) async fn read_json(response: reqwest::Response) -> DlResult<Value> {
    let status = response.status().as_u16();
    let text = response.text().await.map_err(DlError::from)?;
    let body: Option<Value> = serde_json::from_str(&text).ok();
    if status >= 400 {
        return Err(DlError::Http { status, body });
    }
    body.ok_or_else(|| DlError::msg("The debrid service returned an invalid response."))
}

/// application/x-www-form-urlencoded (URLSearchParams.toString()).
pub(crate) fn form(pairs: &[(&str, &str)]) -> String {
    let mut serializer = form_urlencoded::Serializer::new(String::new());
    for (key, value) in pairs {
        serializer.append_pair(key, value);
    }
    serializer.finish()
}

/// multipart/form-data with text fields (FormData).
pub(crate) fn multipart(pairs: &[(&str, &str)]) -> (String, String) {
    let boundary = format!("----hydra{}", uuid::Uuid::new_v4().simple());
    let mut body = String::new();
    for (key, value) in pairs {
        body.push_str(&format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n"
        ));
    }
    body.push_str(&format!("--{boundary}--\r\n"));
    (format!("multipart/form-data; boundary={boundary}"), body)
}

/// A JSON number or numeric string as i64.
pub(crate) fn as_i64(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    value
        .as_i64()
        .or_else(|| value.as_f64().map(|f| f as i64))
        .or_else(|| value.as_str()?.parse().ok())
}

/// A JSON string (numbers rendered like `String(x)`).
pub(crate) fn as_text(value: Option<&Value>) -> Option<String> {
    let value = value?;
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Null => None,
        other => Some(other.to_string()),
    }
}
