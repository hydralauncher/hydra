//! Store data for the Rust rewrite of Hydra.
//!
//! - [`steam`]: the Steam store API (`appdetails`), the same call Hydra's main
//!   process makes in `src/main/services/steam.ts`, plus library artwork.
//! - [`html`]: Steam's HTML (description, requirements, languages) converted
//!   into native blocks and CommonMark for Slint's `StyledText`.

pub mod html;
pub mod steam;

/// Install the TLS crypto provider (ring), like `native/hydra-native` does.
/// Call once at startup before making HTTP requests.
pub fn init_tls() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

/// Shared blocking HTTP client. Use it from worker threads only.
pub fn http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .user_agent(concat!("Hydra/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .expect("HTTP client")
}
