//! The debrid clients' getUser (services/download/{real-debrid,torbox,
//! all-debrid,premiumize}.ts), used to check an API token before saving it.

use reqwest::blocking::Client;
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    RealDebrid,
    TorBox,
    AllDebrid,
    Premiumize,
}

impl Provider {
    pub fn parse(key: &str) -> Option<Provider> {
        Some(match key {
            "realDebrid" => Provider::RealDebrid,
            "torbox" => Provider::TorBox,
            "allDebrid" => Provider::AllDebrid,
            "premiumize" => Provider::Premiumize,
            _ => return None,
        })
    }

    /// The userPreferences key that holds the token.
    pub fn token_key(self) -> &'static str {
        match self {
            Provider::RealDebrid => "realDebridApiToken",
            Provider::TorBox => "torBoxApiToken",
            Provider::AllDebrid => "allDebridApiToken",
            Provider::Premiumize => "premiumizeApiToken",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum AuthError {
    /// Real-Debrid free accounts can't be used (the username).
    FreeAccount(String),
    Invalid,
}

/// The name shown in "debrid_linked_message" (username, email or customer id).
pub fn authenticate(
    client: &Client,
    provider: Provider,
    token: &str,
    app_version: &str,
) -> Result<String, AuthError> {
    let json = |request: reqwest::blocking::RequestBuilder| -> Result<Value, AuthError> {
        let response = request.send().map_err(|_| AuthError::Invalid)?;
        if !response.status().is_success() {
            return Err(AuthError::Invalid);
        }
        response.json::<Value>().map_err(|_| AuthError::Invalid)
    };
    let text = |v: &Value, key: &str| {
        v.get(key).map(|x| {
            x.as_str()
                .map(str::to_string)
                .unwrap_or_else(|| x.to_string())
        })
    };
    match provider {
        Provider::RealDebrid => {
            let user = json(
                client
                    .get("https://api.real-debrid.com/rest/1.0/user")
                    .bearer_auth(token),
            )?;
            let username = text(&user, "username").unwrap_or_default();
            if user.get("type").and_then(Value::as_str) == Some("free") {
                return Err(AuthError::FreeAccount(username));
            }
            Ok(username)
        }
        Provider::TorBox => {
            let body = json(
                client
                    .get("https://api.torbox.app/v1/api/user/me")
                    .bearer_auth(token)
                    .header("User-Agent", format!("Hydra/{app_version}")),
            )?;
            body.get("data")
                .and_then(|d| text(d, "email"))
                .ok_or(AuthError::Invalid)
        }
        Provider::AllDebrid => {
            let agent = format!("Hydra/{app_version}");
            let url = reqwest::Url::parse_with_params(
                "https://api.alldebrid.com/v4/user",
                &[("apikey", token), ("agent", agent.as_str())],
            )
            .map_err(|_| AuthError::Invalid)?;
            let body = json(client.get(url).bearer_auth(token))?;
            if body.get("status").and_then(Value::as_str) != Some("success") {
                return Err(AuthError::Invalid);
            }
            body.get("data")
                .and_then(|d| d.get("user"))
                .and_then(|u| text(u, "username"))
                .ok_or(AuthError::Invalid)
        }
        Provider::Premiumize => {
            let url = reqwest::Url::parse_with_params(
                "https://www.premiumize.me/api/account/info",
                &[("apikey", token)],
            )
            .map_err(|_| AuthError::Invalid)?;
            let body = json(client.get(url))?;
            if body.get("status").and_then(Value::as_str) != Some("success") {
                return Err(AuthError::Invalid);
            }
            Ok(body
                .get("customer_id")
                .map(|v| {
                    v.as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| v.to_string())
                })
                .unwrap_or_default())
        }
    }
}
