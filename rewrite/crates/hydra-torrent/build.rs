//! Links the prebuilt libtorrent bridge (native/torrent-bridge/prebuilt) and
//! copies its shared library next to the binaries.
use std::path::PathBuf;

fn main() {
    println!("cargo:rustc-cfg=hydra_rewrite");
    println!("cargo:rustc-check-cfg=cfg(hydra_rewrite)");
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let prebuilt = manifest.join("../../../native/torrent-bridge/prebuilt");
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let (lib_dir, shared) = match target_os.as_str() {
        "windows" => (prebuilt.join("x64-windows-static/lib"), prebuilt.join("x64-windows-static/bin/hydra_torrent_bridge.dll")),
        "linux" => (prebuilt.join("x64-linux/lib"), prebuilt.join("x64-linux/lib/libhydra_torrent_bridge.so")),
        other => panic!("no prebuilt torrent bridge for {other}"),
    };
    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!("cargo:rerun-if-changed={}", shared.display());
    if target_os == "linux" {
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
    }
    // target/<profile>: OUT_DIR is target/<profile>/build/<pkg>/out.
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    if let Some(profile_dir) = out.ancestors().nth(3) {
        let name = shared.file_name().unwrap();
        for dir in [profile_dir.to_path_buf(), profile_dir.join("deps")] {
            let _ = std::fs::copy(&shared, dir.join(name));
        }
    }
}
