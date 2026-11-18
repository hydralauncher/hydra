//! `import.meta.env` and `app.getVersion()` of the Electron build.
//! Runtime environment variables win, so a build can point at staging.

fn runtime_or(name: &str, built: &'static str) -> String {
    std::env::var(name).unwrap_or_else(|_| built.to_string())
}

pub fn api_url() -> String {
    runtime_or("MAIN_VITE_API_URL", env!("HYDRA_BUILD_MAIN_VITE_API_URL"))
}

pub fn auth_url() -> String {
    runtime_or("MAIN_VITE_AUTH_URL", env!("HYDRA_BUILD_MAIN_VITE_AUTH_URL"))
}

pub fn checkout_url() -> String {
    runtime_or(
        "MAIN_VITE_CHECKOUT_URL",
        env!("HYDRA_BUILD_MAIN_VITE_CHECKOUT_URL"),
    )
}

pub fn app_version() -> &'static str {
    env!("HYDRA_APP_VERSION")
}

/// `constants.ts`: staging when the API URL says so.
pub fn is_staging() -> bool {
    api_url().contains("staging")
}
