//! Signed-in smoke test: `/profile/me` with the session imported from Electron.
//! `cargo run -p hydra-core --example api_me -- <electron userData>`

use std::sync::Arc;

use hydra_core::api::{HydraApi, Options};
use hydra_db::import;

fn main() {
    let electron = std::path::PathBuf::from(std::env::args().nth(1).expect("electron userData folder"));
    let native = std::env::temp_dir().join(format!("hydra-api-me-{}", std::process::id()));
    let (db, _) = import::open_or_import(&native, Some(&electron), "hydra-db").expect("open");
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::blocking::Client::builder().build().expect("client");
    let api = HydraApi::new(Arc::new(db), client);
    println!("logged in: {}", api.is_logged_in());
    match api.get("/profile/me", &[], Options::default()) {
        Ok(me) => println!(
            "id={} displayName={} subscription={}",
            me["id"], me["displayName"], !me["subscription"].is_null()
        ),
        Err(error) => println!("error: {error}"),
    }
    let _ = std::fs::remove_dir_all(&native);
}
