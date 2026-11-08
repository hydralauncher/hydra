// Build-time configuration, like electron-vite's `import.meta.env`: values
// come from the environment or from the repository's `.env` (never committed),
// and the app version from the root `package.json`.

use std::path::Path;

const KEYS: &[&str] = &[
    "MAIN_VITE_API_URL",
    "MAIN_VITE_AUTH_URL",
    "MAIN_VITE_CHECKOUT_URL",
    "MAIN_VITE_EXTERNAL_RESOURCES_URL",
    "RENDERER_VITE_EXTERNAL_RESOURCES_URL",
];

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let dotenv = root.join(".env");
    println!("cargo:rerun-if-changed={}", dotenv.display());
    let file = std::fs::read_to_string(&dotenv).unwrap_or_default();
    for key in KEYS {
        println!("cargo:rerun-if-env-changed={key}");
        let value = std::env::var(key).ok().or_else(|| {
            file.lines().find_map(|line| {
                let (k, v) = line.split_once('=')?;
                (k.trim() == *key)
                    .then(|| v.trim().trim_matches('"').trim_matches('\'').to_string())
            })
        });
        println!(
            "cargo:rustc-env=HYDRA_BUILD_{key}={}",
            value.unwrap_or_default()
        );
    }

    let package = root.join("package.json");
    println!("cargo:rerun-if-changed={}", package.display());
    let version = std::fs::read_to_string(&package)
        .ok()
        .and_then(|text| {
            let start = text.find("\"version\"")?;
            let rest = &text[start + 9..];
            let open = rest.find('"')? + 1;
            let close = rest[open..].find('"')?;
            Some(rest[open..open + close].to_string())
        })
        .unwrap_or_else(|| "0.0.0".into());
    println!("cargo:rustc-env=HYDRA_APP_VERSION={version}");
}
