//! shared/constants.ts `DownloadError`, the error a hoster or debrid call
//! fails with, and helpers/download-error-handler.ts (`handleDownloadError`):
//! the key or message the renderer shows in the download_error toast.

use hydra_core::api::ApiError;
use hydra_core::repacks::Downloader;
use serde_json::Value;

/// DownloadError: the keys the renderer translates (`t(response.error)`).
pub mod key {
    pub const NOT_CACHED_ON_REAL_DEBRID: &str = "download_error_not_cached_on_real_debrid";
    pub const REAL_DEBRID_TORRENT_NOT_READY: &str = "download_error_real_debrid_torrent_not_ready";
    pub const REAL_DEBRID_LINKS_NOT_READY: &str = "download_error_real_debrid_links_not_ready";
    pub const NOT_CACHED_ON_TORBOX: &str = "download_error_not_cached_on_torbox";
    pub const GOFILE_QUOTA_EXCEEDED: &str = "download_error_gofile_quota_exceeded";
    pub const REAL_DEBRID_ACCOUNT_NOT_AUTHORIZED: &str =
        "download_error_real_debrid_account_not_authorized";
    pub const NOT_CACHED_ON_HYDRA: &str = "download_error_not_cached_on_hydra";
    pub const NOT_CACHED_ON_PREMIUMIZE: &str = "download_error_not_cached_on_premiumize";
    pub const PREMIUMIZE_TRANSFER_STARTED: &str = "download_error_premiumize_transfer_started";
    pub const NOT_CACHED_ON_ALLDEBRID: &str = "download_error_not_cached_on_alldebrid";
    pub const PREMIUMIZE_ACCOUNT_NOT_AUTHORIZED: &str =
        "download_error_premiumize_account_not_authorized";
    pub const ALLDEBRID_ACCOUNT_NOT_AUTHORIZED: &str =
        "download_error_alldebrid_account_not_authorized";
    pub const PREMIUMIZE_RATE_LIMIT_EXCEEDED: &str =
        "download_error_premiumize_rate_limit_exceeded";
    pub const ALLDEBRID_RATE_LIMIT_EXCEEDED: &str = "download_error_alldebrid_rate_limit_exceeded";
    pub const PREMIUMIZE_UNAVAILABLE: &str = "download_error_premiumize_unavailable";
    pub const ALLDEBRID_UNAVAILABLE: &str = "download_error_alldebrid_unavailable";
    pub const VIKINGFILE_QUOTA_EXCEEDED: &str = "download_error_vikingfile_quota_exceeded";
    pub const VIKINGFILE_SUBSCRIPTION_REQUIRED: &str =
        "download_error_vikingfile_subscription_required";
    pub const HOSTER_UNLOCK_LOGIN_REQUIRED: &str = "download_error_hoster_unlock_login_required";
    pub const HOSTER_UNLOCK_FILE_NOT_FOUND: &str = "download_error_hoster_unlock_file_not_found";
    pub const HOSTER_UNLOCK_UNAVAILABLE: &str = "download_error_hoster_unlock_unavailable";
    pub const DOWNLOAD_LINK_RETURNED_WEB_PAGE: &str = "download_error_link_returned_web_page";
    pub const INVALID_MAGNET: &str = "download_error_invalid_magnet";
    pub const TORRENT_FILES_UNAVAILABLE: &str = "download_error_torrent_files_unavailable";
    pub const ARCHIVE_ORG_INVALID_FILE_URL: &str = "download_error_archive_org_invalid_file_url";
    pub const TORBOX_ACCOUNT_NOT_AUTHORIZED: &str = "download_error_torbox_account_not_authorized";
    pub const TORBOX_RATE_LIMIT_EXCEEDED: &str = "download_error_torbox_rate_limit_exceeded";
    pub const TORBOX_UNAVAILABLE: &str = "download_error_torbox_unavailable";
    pub const TORBOX_TORRENT_NOT_READY: &str = "download_error_torbox_torrent_not_ready";
    pub const TORBOX_LINK_UNAVAILABLE: &str = "download_error_torbox_link_unavailable";
    pub const NETWORK_UNREACHABLE: &str = "download_error_network_unreachable";
    pub const NETWORK_CERTIFICATE_REJECTED: &str = "download_error_network_certificate_rejected";

    /// Object.values(DownloadError) for the keys this crate produces
    /// (isKnownDownloadError).
    pub const ALL: [&str; 38] = [
        NOT_CACHED_ON_REAL_DEBRID,
        REAL_DEBRID_TORRENT_NOT_READY,
        REAL_DEBRID_LINKS_NOT_READY,
        NOT_CACHED_ON_TORBOX,
        GOFILE_QUOTA_EXCEEDED,
        REAL_DEBRID_ACCOUNT_NOT_AUTHORIZED,
        NOT_CACHED_ON_HYDRA,
        NOT_CACHED_ON_PREMIUMIZE,
        PREMIUMIZE_TRANSFER_STARTED,
        NOT_CACHED_ON_ALLDEBRID,
        PREMIUMIZE_ACCOUNT_NOT_AUTHORIZED,
        ALLDEBRID_ACCOUNT_NOT_AUTHORIZED,
        PREMIUMIZE_RATE_LIMIT_EXCEEDED,
        ALLDEBRID_RATE_LIMIT_EXCEEDED,
        PREMIUMIZE_UNAVAILABLE,
        ALLDEBRID_UNAVAILABLE,
        VIKINGFILE_QUOTA_EXCEEDED,
        VIKINGFILE_SUBSCRIPTION_REQUIRED,
        HOSTER_UNLOCK_LOGIN_REQUIRED,
        HOSTER_UNLOCK_FILE_NOT_FOUND,
        HOSTER_UNLOCK_UNAVAILABLE,
        DOWNLOAD_LINK_RETURNED_WEB_PAGE,
        INVALID_MAGNET,
        "download_error_torrent_metadata_timeout",
        "download_error_torrent_metadata_incomplete",
        "download_error_torrent_no_files_selected",
        "download_error_torrent_invalid_file_selection",
        "download_error_torrent_too_many_files",
        TORRENT_FILES_UNAVAILABLE,
        "download_error_torrent_invalid_trackers",
        ARCHIVE_ORG_INVALID_FILE_URL,
        TORBOX_ACCOUNT_NOT_AUTHORIZED,
        TORBOX_RATE_LIMIT_EXCEEDED,
        TORBOX_UNAVAILABLE,
        TORBOX_TORRENT_NOT_READY,
        TORBOX_LINK_UNAVAILABLE,
        NETWORK_UNREACHABLE,
        NETWORK_CERTIFICATE_REJECTED,
    ];
}

/// Why resolving or starting a hoster/debrid download failed.
#[derive(Clone, Debug)]
pub enum DlError {
    /// `new Error(message)`: the message is often a [`key`].
    Message(String),
    /// A provider answered with an error status (an AxiosError).
    Http { status: u16, body: Option<Value> },
    /// A Hydra API call failed (the Datanodes / VikingFile unlocks).
    Api(ApiError),
    /// SubscriptionRequiredError (`needsSubscription` calls).
    SubscriptionRequired,
    /// A request never got an answer; `tls` when the certificate was refused.
    Network { message: String, tls: bool },
    /// The preparation was cancelled (pause, cancel, a newer start).
    Aborted,
}

pub type DlResult<T> = Result<T, DlError>;

impl DlError {
    pub fn msg(message: impl Into<String>) -> DlError {
        DlError::Message(message.into())
    }

    /// `error.message` in Electron.
    pub fn message(&self) -> String {
        match self {
            DlError::Message(m) => m.clone(),
            DlError::Http { status, .. } => format!("Request failed with status code {status}"),
            DlError::Api(error) => error.to_string(),
            DlError::SubscriptionRequired => "You need an active subscription".into(),
            DlError::Network { message, .. } => message.clone(),
            DlError::Aborted => "This operation was aborted".into(),
        }
    }

    pub fn is(&self, key: &str) -> bool {
        matches!(self, DlError::Message(m) if m == key)
    }

    pub fn status(&self) -> Option<u16> {
        match self {
            DlError::Http { status, .. } => Some(*status),
            _ => None,
        }
    }

    /// isKnownDownloadError
    pub fn is_known(&self) -> bool {
        matches!(self, DlError::Message(m) if key::ALL.contains(&m.as_str()))
    }
}

impl std::fmt::Display for DlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message())
    }
}

impl std::error::Error for DlError {}

impl From<reqwest::Error> for DlError {
    fn from(error: reqwest::Error) -> DlError {
        if let Some(status) = error.status() {
            return DlError::Http {
                status: status.as_u16(),
                body: None,
            };
        }
        let mut tls = false;
        let mut source: Option<&dyn std::error::Error> = Some(&error);
        let mut message = error.to_string();
        while let Some(current) = source {
            let text = current.to_string();
            let lower = text.to_lowercase();
            if lower.contains("certificate") || lower.contains("invalidcertificate") {
                tls = true;
            }
            if !text.is_empty() {
                message = text;
            }
            source = current.source();
        }
        if error.is_decode() || error.is_body() && !error.is_timeout() {
            return DlError::Message(message);
        }
        DlError::Network { message, tls }
    }
}

impl From<ApiError> for DlError {
    fn from(error: ApiError) -> DlError {
        match error {
            ApiError::NotLoggedIn => DlError::Api(ApiError::NotLoggedIn),
            other => DlError::Api(other),
        }
    }
}

/// isDebridPendingError: the provider is still preparing the files.
pub fn is_debrid_pending(error: &DlError, downloader: Downloader) -> bool {
    let DlError::Message(message) = error else {
        return false;
    };
    match downloader {
        Downloader::TorBox => message == key::TORBOX_TORRENT_NOT_READY,
        Downloader::RealDebrid => [
            key::NOT_CACHED_ON_REAL_DEBRID,
            key::REAL_DEBRID_TORRENT_NOT_READY,
            key::REAL_DEBRID_LINKS_NOT_READY,
        ]
        .contains(&message.as_str()),
        _ => false,
    }
}

fn hydra_unlock(downloader: Downloader) -> bool {
    matches!(downloader, Downloader::Datanodes | Downloader::VikingFile)
}

/// handleHydraUnlockError
fn hydra_unlock_error(status: u16, body: Option<&Value>, downloader: Downloader) -> Option<String> {
    if !hydra_unlock(downloader) {
        return None;
    }
    let message = body.and_then(|b| b.as_str().or_else(|| b.get("message")?.as_str()));
    Some(
        match status {
            429 if downloader == Downloader::VikingFile => key::VIKINGFILE_QUOTA_EXCEEDED,
            400 if downloader == Downloader::VikingFile && message.is_some() => {
                key::VIKINGFILE_SUBSCRIPTION_REQUIRED
            }
            401 => key::HOSTER_UNLOCK_LOGIN_REQUIRED,
            404 => key::HOSTER_UNLOCK_FILE_NOT_FOUND,
            502 => key::HOSTER_UNLOCK_UNAVAILABLE,
            _ => return None,
        }
        .to_string(),
    )
}

/// handleAxiosError (provider statuses).
fn http_error(status: u16, body: Option<&Value>, downloader: Downloader) -> Option<String> {
    use Downloader as D;
    let fixed = match (status, downloader) {
        (429, D::Gofile) => Some(key::GOFILE_QUOTA_EXCEEDED),
        (403, D::RealDebrid) => Some(key::REAL_DEBRID_ACCOUNT_NOT_AUTHORIZED),
        (401 | 403, D::Premiumize) => Some(key::PREMIUMIZE_ACCOUNT_NOT_AUTHORIZED),
        (401 | 403, D::AllDebrid) => Some(key::ALLDEBRID_ACCOUNT_NOT_AUTHORIZED),
        (429, D::Premiumize) => Some(key::PREMIUMIZE_RATE_LIMIT_EXCEEDED),
        (429, D::AllDebrid) => Some(key::ALLDEBRID_RATE_LIMIT_EXCEEDED),
        (503, D::Premiumize) => Some(key::PREMIUMIZE_UNAVAILABLE),
        (503, D::AllDebrid) => Some(key::ALLDEBRID_UNAVAILABLE),
        _ => None,
    };
    if let Some(fixed) = fixed {
        return Some(fixed.into());
    }
    if let Some(unlock) = hydra_unlock_error(status, body, downloader) {
        return Some(unlock);
    }
    if downloader == D::TorBox {
        match status {
            401 | 403 => return Some(key::TORBOX_ACCOUNT_NOT_AUTHORIZED.into()),
            429 => return Some(key::TORBOX_RATE_LIMIT_EXCEEDED.into()),
            503 => return Some(key::TORBOX_UNAVAILABLE.into()),
            _ => {}
        }
        if let Some(detail) = body
            .and_then(|b| b.get("detail"))
            .and_then(Value::as_str)
            .filter(|d| !d.is_empty())
        {
            return Some(detail.to_string());
        }
    }
    None
}

/// Gofile reports a deleted, expired or emptied link through several
/// internal messages, none of which are meant to reach the user.
const GOFILE_FILE_GONE_PATTERNS: [&str; 5] = [
    "content not found",
    "has expired",
    "no file links found",
    "failed to validate download url: 404",
    "failed to validate download url: 410",
];

/// handleHostSpecificError
fn host_specific(message: &str, downloader: Downloader) -> Option<String> {
    if downloader == Downloader::Gofile {
        if message.contains("RATE_LIMIT:") || message.contains("error-rateLimit") {
            return Some(key::GOFILE_QUOTA_EXCEEDED.into());
        }
        let lower = message.to_lowercase();
        if GOFILE_FILE_GONE_PATTERNS.iter().any(|p| lower.contains(p)) {
            return Some(key::HOSTER_UNLOCK_FILE_NOT_FOUND.into());
        }
    }
    let host = match downloader {
        Downloader::FuckingFast => "FuckingFast",
        _ => return None,
    };
    if message.contains("Rate limit") {
        return Some(format!("{host}: Rate limit exceeded"));
    }
    if message.contains("not found") || message.contains("deleted") {
        return Some(format!("{host}: File not found"));
    }
    None
}

/// handleDownloadError: the key or message for `t(response.error)`.
pub fn describe(error: &DlError, downloader: Downloader) -> String {
    match error {
        DlError::Http { status, body } => {
            if let Some(mapped) = http_error(*status, body.as_ref(), downloader) {
                return mapped;
            }
        }
        DlError::Api(ApiError::Status { status, body }) => {
            if let Some(mapped) = hydra_unlock_error(*status, body.as_ref(), downloader) {
                return mapped;
            }
        }
        DlError::Api(ApiError::NotLoggedIn) if hydra_unlock(downloader) => {
            return key::HOSTER_UNLOCK_LOGIN_REQUIRED.into();
        }
        DlError::SubscriptionRequired if downloader == Downloader::VikingFile => {
            return key::VIKINGFILE_SUBSCRIPTION_REQUIRED.into();
        }
        _ => {}
    }
    let message = error.message();
    if let Some(mapped) = host_specific(&message, downloader) {
        return mapped;
    }
    match error {
        DlError::Network { tls: true, .. } => key::NETWORK_CERTIFICATE_REJECTED.into(),
        DlError::Network { .. } | DlError::Api(ApiError::Network(_)) => {
            key::NETWORK_UNREACHABLE.into()
        }
        _ => message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pending_errors_per_provider() {
        let not_ready = DlError::msg(key::TORBOX_TORRENT_NOT_READY);
        assert!(is_debrid_pending(&not_ready, Downloader::TorBox));
        assert!(!is_debrid_pending(&not_ready, Downloader::RealDebrid));
        let links = DlError::msg(key::REAL_DEBRID_LINKS_NOT_READY);
        assert!(is_debrid_pending(&links, Downloader::RealDebrid));
        assert!(!is_debrid_pending(
            &DlError::Http {
                status: 503,
                body: None
            },
            Downloader::RealDebrid
        ));
    }

    #[test]
    fn statuses_map_like_handle_download_error() {
        let http = |status| DlError::Http { status, body: None };
        assert_eq!(
            describe(&http(429), Downloader::Gofile),
            key::GOFILE_QUOTA_EXCEEDED
        );
        assert_eq!(
            describe(&http(403), Downloader::RealDebrid),
            key::REAL_DEBRID_ACCOUNT_NOT_AUTHORIZED
        );
        assert_eq!(
            describe(&http(503), Downloader::AllDebrid),
            key::ALLDEBRID_UNAVAILABLE
        );
        assert_eq!(
            describe(&http(401), Downloader::TorBox),
            key::TORBOX_ACCOUNT_NOT_AUTHORIZED
        );
        assert_eq!(
            describe(
                &DlError::Http {
                    status: 400,
                    body: Some(json!({ "detail": "Bad magnet" }))
                },
                Downloader::TorBox
            ),
            "Bad magnet"
        );
        let api = |status| {
            DlError::Api(ApiError::Status {
                status,
                body: Some(json!({ "message": "x" })),
            })
        };
        assert_eq!(
            describe(&api(429), Downloader::VikingFile),
            key::VIKINGFILE_QUOTA_EXCEEDED
        );
        assert_eq!(
            describe(&api(400), Downloader::VikingFile),
            key::VIKINGFILE_SUBSCRIPTION_REQUIRED
        );
        assert_eq!(
            describe(&api(404), Downloader::Datanodes),
            key::HOSTER_UNLOCK_FILE_NOT_FOUND
        );
        assert_eq!(
            describe(&DlError::Api(ApiError::NotLoggedIn), Downloader::Datanodes),
            key::HOSTER_UNLOCK_LOGIN_REQUIRED
        );
    }

    #[test]
    fn host_messages() {
        assert_eq!(
            describe(
                &DlError::msg("RATE_LIMIT:Gofile rate limit reached."),
                Downloader::Gofile
            ),
            key::GOFILE_QUOTA_EXCEEDED
        );
        assert_eq!(
            describe(&DlError::msg("Content not found: abc"), Downloader::Gofile),
            key::HOSTER_UNLOCK_FILE_NOT_FOUND
        );
        assert_eq!(
            describe(
                &DlError::msg("File not found or deleted"),
                Downloader::FuckingFast
            ),
            "FuckingFast: File not found"
        );
        assert_eq!(
            describe(
                &DlError::Network {
                    message: "dns error".into(),
                    tls: false
                },
                Downloader::PixelDrain
            ),
            key::NETWORK_UNREACHABLE
        );
        assert_eq!(
            describe(&DlError::msg("plain"), Downloader::PixelDrain),
            "plain"
        );
    }
}
