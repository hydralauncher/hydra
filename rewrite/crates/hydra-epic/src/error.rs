//! EpicIntegrationError / EpicManagedError: every failure carries one of the
//! fixed codes of `EpicErrorCode` (epic-integration.types.ts) or
//! `EpicInstallError` (epic-managed.types.ts). The UI maps codes to strings.

use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EpicError(pub String);

impl EpicError {
    pub fn new(code: &str) -> Self {
        EpicError(code.to_string())
    }

    pub fn code(&self) -> &str {
        &self.0
    }

    pub fn is(&self, code: &str) -> bool {
        self.0 == code
    }

    pub fn cancelled() -> Self {
        EpicError::new("operation-cancelled")
    }
}

impl fmt::Display for EpicError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for EpicError {}

pub type Result<T> = std::result::Result<T, EpicError>;

/// `new EpicIntegrationError(code)` shorthand.
pub fn err<T>(code: &str) -> Result<T> {
    Err(EpicError::new(code))
}
