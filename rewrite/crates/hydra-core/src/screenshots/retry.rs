//! screenshots/screenshot-upload-retry-policy.ts and the error-code helpers it
//! borrows from achievements/grouped-souvenir-retry-policy.ts.

use serde_json::Value;

use crate::api::ApiError;

pub const MAX_ATTEMPTS: u32 = 6;
pub const MAX_GAME_WAITS: u32 = 30;
pub const MAX_SERVER_WAITS: u32 = 30;
pub const RETRY_BASE_DELAY_MS: u64 = 5_000;
pub const RETRY_MAX_DELAY_MS: u64 = 10 * 60_000;
pub const GAME_WAIT_DELAY_MS: u64 = 30_000;
pub const CAPACITY_WAIT_DELAY_MS: u64 = 60_000;
pub const MODERATION_DEFAULT_WAIT_MS: u64 = 30_000;
pub const MODERATION_BACKOFF_BASE_MS: u64 = 2_000;
pub const MODERATION_BACKOFF_MAX_MS: u64 = 60_000;
pub const MODERATION_MAX_WAIT_MS: u64 = 24 * 60 * 60_000;

pub const MISSING_FILE_CODE: &str = "screenshot_missing";
pub const ALREADY_UPLOADED_CODE: &str = "screenshots/already-uploaded";
pub const FEATURE_DISABLED_CODE: &str = "feature/feature-not-enabled";
/// GAME_NOT_FOUND_ERROR_CODE
pub const GAME_NOT_FOUND_CODE: &str = "game/not-found";
const SOUVENIR_CONFLICT_CODE: &str = "achievements/souvenir-conflict";
/// UploadPutError's message
pub const UPLOAD_PUT_FAILED: &str = "screenshot_upload_failed";

/// What went wrong in one upload attempt (the `error` Electron classifies).
#[derive(Debug, Clone)]
pub enum UploadError {
    /// A Hydra API call failed; `retry_after_ms` is the Retry-After header.
    Api {
        error: ApiError,
        retry_after_ms: Option<u64>,
    },
    /// UploadPutError: the presigned PUT failed.
    Put(String),
    /// A file system error, as Node's error code ("ENOENT", "EACCES", …).
    Io(String),
    /// new Error(code): game/not-found, screenshot_too_large, …
    Code(String),
    /// The upload was aborted (cancel, sign-out).
    Cancelled,
}

impl UploadError {
    pub fn io(error: &std::io::Error) -> UploadError {
        use std::io::ErrorKind;
        let code = match error.kind() {
            ErrorKind::NotFound => "ENOENT",
            ErrorKind::PermissionDenied => "EACCES",
            ErrorKind::IsADirectory => "EISDIR",
            ErrorKind::StorageFull => "ENOSPC",
            ErrorKind::ResourceBusy => "EBUSY",
            _ => "EIO",
        };
        UploadError::Io(code.to_string())
    }
}

/// ScreenshotUploadRecoveryAction
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    AlreadyUploaded,
    Wait,
    RateLimitWait,
    ModerationWait,
    Retry,
    WaitForGame,
    RecompressStandard,
    RotateClientId,
    Terminal,
    Stop,
}

/// ScreenshotUploadFailure
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
    pub code: String,
    pub action: Action,
    pub retry_after_ms: Option<u64>,
}

fn mapped_action(code: &str) -> Option<Action> {
    Some(match code {
        GAME_NOT_FOUND_CODE => Action::WaitForGame,
        ALREADY_UPLOADED_CODE => Action::AlreadyUploaded,
        "screenshots/exceeds-tier-limit" | "screenshots/cloud-subscription-required" => {
            Action::RecompressStandard
        }
        "screenshots/client-id-conflict"
        | "screenshots/upload-expired"
        | "screenshots/not-found"
        | "screenshots/upload-incomplete"
        | "screenshots/upload-mismatch" => Action::RotateClientId,
        "screenshots/upload-rate-limited" => Action::RateLimitWait,
        "screenshots/upload-capacity-reached"
        | "screenshots/text-change-rate-limit-unavailable" => Action::Wait,
        "screenshots/moderation-unavailable"
        | "screenshots/moderation-in-progress"
        | "screenshots/moderation-rate-limited" => Action::ModerationWait,
        "screenshots/limit-reached"
        | "screenshots/blocked-limit-reached"
        | "screenshot_too_large"
        | "screenshot_unreadable"
        | FEATURE_DISABLED_CODE => Action::Terminal,
        "user not logged in" => Action::Stop,
        _ => return None,
    })
}

/// getResponseCode: errorCode ?? code ?? message
fn response_code(body: Option<&Value>) -> Option<String> {
    let body = body?.as_object()?;
    ["errorCode", "code", "message"]
        .iter()
        .find_map(|key| body.get(*key).filter(|v| !v.is_null()))
        .and_then(Value::as_str)
        .map(str::to_string)
}

const CONFLICT_REASONS: [&str; 7] = [
    "reservation_not_found",
    "reservation_mismatch",
    "image_key_in_use",
    "achievement_not_found",
    "achievement_already_assigned",
    "souvenir_payload_mismatch",
    "concurrent_update",
];

/// getGroupedSouvenirErrorCode
pub fn api_error_code(error: &ApiError) -> String {
    match error {
        ApiError::NotLoggedIn => "user not logged in".to_string(),
        ApiError::Network(message) => message.clone(),
        ApiError::Status { status, body } => {
            let code = response_code(body.as_ref());
            if code.as_deref() == Some(SOUVENIR_CONFLICT_CODE) {
                let reason = body
                    .as_ref()
                    .and_then(|b| b.get("reason"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| {
                        code.clone()
                            .filter(|c| CONFLICT_REASONS.contains(&c.as_str()))
                    });
                if let Some(reason) = reason {
                    return reason;
                }
            }
            code.unwrap_or_else(|| format!("http_{status}"))
        }
    }
}

/// isRejectedGroupedSouvenirRequest: a 4xx other than 401, 408 and 429.
pub fn is_rejected_request(error: &ApiError) -> bool {
    matches!(error, ApiError::Status { status, .. }
        if (400..500).contains(status) && ![401, 408, 429].contains(status))
}

/// getScreenshotUploadFailure
pub fn failure(error: &UploadError) -> Failure {
    let (code, fallback, retry_after) = match error {
        UploadError::Io(code) if code == "ENOENT" => {
            return Failure {
                code: MISSING_FILE_CODE.into(),
                action: Action::Terminal,
                retry_after_ms: None,
            };
        }
        UploadError::Io(code) => (code.clone(), Action::Retry, None),
        UploadError::Api {
            error,
            retry_after_ms,
        } => {
            let fallback = match error {
                ApiError::Network(_) => Action::Retry,
                other if is_rejected_request(other) => Action::Terminal,
                _ => Action::Retry,
            };
            let retry_after = match error {
                ApiError::Status { .. } => *retry_after_ms,
                _ => None,
            };
            (api_error_code(error), fallback, retry_after)
        }
        UploadError::Put(_) => (UPLOAD_PUT_FAILED.to_string(), Action::Retry, None),
        UploadError::Code(code) => (code.clone(), Action::Retry, None),
        UploadError::Cancelled => ("canceled".to_string(), Action::Retry, None),
    };
    let action = mapped_action(&code).unwrap_or(fallback);
    let honors_retry_after = matches!(
        action,
        Action::ModerationWait | Action::RateLimitWait | Action::Retry
    );
    Failure {
        code,
        action,
        retry_after_ms: retry_after.filter(|_| honors_retry_after),
    }
}

/// getAlreadyUploadedScreenshot: the existing screenshot in the 409 body.
pub fn already_uploaded(error: &UploadError) -> Option<(String, Value, Value)> {
    let UploadError::Api {
        error: ApiError::Status {
            body: Some(body), ..
        },
        ..
    } = error
    else {
        return None;
    };
    let id = body.get("id")?.as_str().filter(|id| !id.is_empty())?;
    Some((
        id.to_string(),
        body.get("moderationStatus").cloned().unwrap_or(Value::Null),
        body.get("moderationReason").cloned().unwrap_or(Value::Null),
    ))
}

/// getScreenshotUploadRetryDelay: 5s doubling, at most 10 min.
pub fn retry_delay(attempt: u32) -> u64 {
    let exponent = attempt.saturating_sub(1).min(32);
    RETRY_BASE_DELAY_MS
        .saturating_mul(1u64 << exponent)
        .min(RETRY_MAX_DELAY_MS)
}

/// getScreenshotModerationWaitDelay
pub fn moderation_wait_delay(failure: &Failure, moderation_waits: u32) -> u64 {
    let backoff = MODERATION_BACKOFF_BASE_MS
        .saturating_mul(1u64 << moderation_waits.min(32))
        .min(MODERATION_BACKOFF_MAX_MS);
    (failure.retry_after_ms.unwrap_or(MODERATION_DEFAULT_WAIT_MS) + backoff)
        .min(MODERATION_MAX_WAIT_MS)
}

/// ScreenshotUploadRetryState
#[derive(Clone, Copy, Debug, Default)]
pub struct RetryState {
    pub upload_attempts: u32,
    pub game_waits: u32,
    pub moderation_waits: u32,
    pub capacity_waits: u32,
    pub rate_limit_waits: u32,
}

/// ScreenshotUploadNextStep
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NextStep {
    RetryAt {
        delay_ms: u64,
        counts_as_attempt: bool,
        rotate_client_id: bool,
    },
    /// Some("STANDARD") retries in the standard tier
    RetryNow {
        quality: Option<&'static str>,
    },
    Failed,
    Stopped,
}

fn wait_unless_capped(waits: u32, delay_ms: u64) -> NextStep {
    if waits >= MAX_SERVER_WAITS {
        NextStep::Failed
    } else {
        NextStep::RetryAt {
            delay_ms,
            counts_as_attempt: false,
            rotate_client_id: false,
        }
    }
}

fn retry_unless_out_of_attempts(state: &RetryState, step: NextStep) -> NextStep {
    if state.upload_attempts >= MAX_ATTEMPTS {
        NextStep::Failed
    } else {
        step
    }
}

/// planScreenshotUploadRecovery
pub fn plan_recovery(failure: &Failure, state: &RetryState, current_quality: &str) -> NextStep {
    match failure.action {
        Action::AlreadyUploaded => {
            retry_unless_out_of_attempts(state, NextStep::RetryNow { quality: None })
        }
        Action::Stop => NextStep::Stopped,
        Action::Terminal => NextStep::Failed,
        Action::WaitForGame => {
            if state.game_waits >= MAX_GAME_WAITS {
                NextStep::Failed
            } else {
                NextStep::RetryAt {
                    delay_ms: GAME_WAIT_DELAY_MS,
                    counts_as_attempt: false,
                    rotate_client_id: false,
                }
            }
        }
        Action::RecompressStandard => {
            if current_quality == "CLOUD" {
                NextStep::RetryNow {
                    quality: Some("STANDARD"),
                }
            } else {
                NextStep::Failed
            }
        }
        Action::RotateClientId => retry_unless_out_of_attempts(
            state,
            NextStep::RetryAt {
                delay_ms: retry_delay(state.upload_attempts),
                counts_as_attempt: true,
                rotate_client_id: true,
            },
        ),
        Action::Wait => wait_unless_capped(state.capacity_waits, CAPACITY_WAIT_DELAY_MS),
        Action::RateLimitWait => wait_unless_capped(
            state.rate_limit_waits,
            failure
                .retry_after_ms
                .unwrap_or_else(|| retry_delay(state.rate_limit_waits + 1))
                .min(RETRY_MAX_DELAY_MS),
        ),
        Action::ModerationWait => wait_unless_capped(
            state.moderation_waits,
            moderation_wait_delay(failure, state.moderation_waits),
        ),
        Action::Retry => retry_unless_out_of_attempts(
            state,
            NextStep::RetryAt {
                delay_ms: failure
                    .retry_after_ms
                    .unwrap_or_else(|| retry_delay(state.upload_attempts))
                    .min(RETRY_MAX_DELAY_MS),
                counts_as_attempt: true,
                rotate_client_id: false,
            },
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn status(status: u16, body: Value) -> UploadError {
        UploadError::Api {
            error: ApiError::Status {
                status,
                body: Some(body),
            },
            retry_after_ms: None,
        }
    }

    fn state(attempts: u32) -> RetryState {
        RetryState {
            upload_attempts: attempts,
            ..Default::default()
        }
    }

    #[test]
    fn classifies_errors() {
        let f = failure(&UploadError::Io("ENOENT".into()));
        assert_eq!(
            (f.code.as_str(), f.action),
            (MISSING_FILE_CODE, Action::Terminal)
        );
        let f = failure(&status(
            409,
            json!({ "message": "screenshots/client-id-conflict" }),
        ));
        assert_eq!(f.action, Action::RotateClientId);
        let f = failure(&status(403, json!({ "code": "screenshots/limit-reached" })));
        assert_eq!(f.action, Action::Terminal);
        let f = failure(&status(422, json!({})));
        assert_eq!((f.code.as_str(), f.action), ("http_422", Action::Terminal));
        let f = failure(&status(500, json!({})));
        assert_eq!((f.code.as_str(), f.action), ("http_500", Action::Retry));
        let f = failure(&status(429, json!({})));
        assert_eq!(f.action, Action::Retry);
        let f = failure(&UploadError::Api {
            error: ApiError::NotLoggedIn,
            retry_after_ms: None,
        });
        assert_eq!(f.action, Action::Stop);
        let f = failure(&UploadError::Api {
            error: ApiError::Network("timeout".into()),
            retry_after_ms: Some(3000),
        });
        assert_eq!(
            (f.code.as_str(), f.action, f.retry_after_ms),
            ("timeout", Action::Retry, None)
        );
        let f = failure(&UploadError::Put("socket hang up".into()));
        assert_eq!(
            (f.code.as_str(), f.action),
            (UPLOAD_PUT_FAILED, Action::Retry)
        );
        let f = failure(&UploadError::Code(GAME_NOT_FOUND_CODE.into()));
        assert_eq!(f.action, Action::WaitForGame);
        let f = failure(&UploadError::Code("screenshot_too_large".into()));
        assert_eq!(f.action, Action::Terminal);
        let f = failure(&UploadError::Io("EACCES".into()));
        assert_eq!((f.code.as_str(), f.action), ("EACCES", Action::Retry));
    }

    #[test]
    fn honors_retry_after_only_where_electron_does() {
        let error = UploadError::Api {
            error: ApiError::Status {
                status: 429,
                body: Some(json!({ "message": "screenshots/upload-rate-limited" })),
            },
            retry_after_ms: Some(12_000),
        };
        let f = failure(&error);
        assert_eq!(
            (f.action, f.retry_after_ms),
            (Action::RateLimitWait, Some(12_000))
        );
        let error = UploadError::Api {
            error: ApiError::Status {
                status: 503,
                body: Some(json!({ "message": "screenshots/upload-capacity-reached" })),
            },
            retry_after_ms: Some(12_000),
        };
        assert_eq!(failure(&error).retry_after_ms, None);
    }

    #[test]
    fn plans_recovery() {
        let retry = Failure {
            code: "http_500".into(),
            action: Action::Retry,
            retry_after_ms: None,
        };
        assert_eq!(
            plan_recovery(&retry, &state(1), "STANDARD"),
            NextStep::RetryAt {
                delay_ms: 5_000,
                counts_as_attempt: true,
                rotate_client_id: false
            }
        );
        assert_eq!(
            plan_recovery(&retry, &state(6), "STANDARD"),
            NextStep::Failed
        );
        assert_eq!(retry_delay(3), 20_000);
        assert_eq!(retry_delay(20), RETRY_MAX_DELAY_MS);

        let recompress = Failure {
            action: Action::RecompressStandard,
            ..retry.clone()
        };
        assert_eq!(
            plan_recovery(&recompress, &state(1), "CLOUD"),
            NextStep::RetryNow {
                quality: Some("STANDARD")
            }
        );
        assert_eq!(
            plan_recovery(&recompress, &state(1), "STANDARD"),
            NextStep::Failed
        );

        let game = Failure {
            action: Action::WaitForGame,
            ..retry.clone()
        };
        let waited = RetryState {
            game_waits: MAX_GAME_WAITS,
            ..state(1)
        };
        assert_eq!(plan_recovery(&game, &waited, "STANDARD"), NextStep::Failed);

        let moderation = Failure {
            action: Action::ModerationWait,
            ..retry.clone()
        };
        assert_eq!(moderation_wait_delay(&moderation, 0), 32_000);
        assert_eq!(moderation_wait_delay(&moderation, 10), 90_000);

        let rate = Failure {
            action: Action::RateLimitWait,
            ..retry
        };
        assert_eq!(
            plan_recovery(&rate, &state(0), "STANDARD"),
            NextStep::RetryAt {
                delay_ms: 5_000,
                counts_as_attempt: false,
                rotate_client_id: false
            }
        );
    }

    #[test]
    fn reads_the_already_uploaded_screenshot() {
        let error = status(
            409,
            json!({ "message": ALREADY_UPLOADED_CODE, "id": "s1", "moderationStatus": "APPROVED" }),
        );
        let (id, moderation, _) = already_uploaded(&error).unwrap();
        assert_eq!((id.as_str(), moderation), ("s1", json!("APPROVED")));
        assert!(already_uploaded(&status(409, json!({ "id": "" }))).is_none());
    }
}
