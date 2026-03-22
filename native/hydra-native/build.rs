fn main() {
    napi_build::setup();

    let mut build = cxx_build::bridge("src/libtorrent_bridge.rs");
    build
        .file("cpp/libtorrent_bridge.cc")
        .file("cpp/bridge_state.cc")
        .file("cpp/bridge_utils.cc")
        .file("cpp/torrent_helpers.cc")
        .include(".")
        .include("cpp")
        .std("c++17");

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    if target_os == "linux" || target_os == "macos" {
        let library = pkg_config::Config::new()
            .probe("libtorrent-rasterbar")
            .unwrap_or_else(|error| {
                panic!(
                    "libtorrent-rasterbar development package is required for hydra-native: {error}"
                )
            });

        for include_path in library.include_paths {
            build.include(include_path);
        }
    } else if target_os == "windows" {
        build.define("TORRENT_ABI_VERSION", Some("3"));

        let library = vcpkg::Config::new()
            .emit_includes(true)
            .find_package("libtorrent")
            .unwrap_or_else(|error| {
                panic!(
                    "vcpkg libtorrent package is required for hydra-native (set VCPKG_ROOT and install port libtorrent): {error}"
                )
            });

        for include_path in library.include_paths {
            build.include(include_path);
        }

        for link_path in &library.link_paths {
            emit_matching_link_lib(link_path, "boost_throw_exception");
            emit_matching_link_lib(link_path, "boost_exception");

            let manual_link_path = link_path.join("manual-link");
            emit_matching_link_lib(&manual_link_path, "boost_throw_exception");
            emit_matching_link_lib(&manual_link_path, "boost_exception");
        }

        println!("cargo:rustc-link-lib=bcrypt");
        println!("cargo:rustc-link-lib=mswsock");
        println!("cargo:rustc-link-lib=ws2_32");
        println!("cargo:rustc-link-lib=iphlpapi");
        println!("cargo:rustc-link-lib=dbghelp");
        println!("cargo:rustc-link-lib=crypt32");
        println!("cargo:rustc-link-lib=user32");
    }

    build.compile("hydra_libtorrent_bridge");

    println!("cargo:rerun-if-changed=src/libtorrent_bridge.rs");
    println!("cargo:rerun-if-changed=cpp/bridge_state.h");
    println!("cargo:rerun-if-changed=cpp/bridge_state.cc");
    println!("cargo:rerun-if-changed=cpp/bridge_utils.h");
    println!("cargo:rerun-if-changed=cpp/bridge_utils.cc");
    println!("cargo:rerun-if-changed=cpp/torrent_helpers.h");
    println!("cargo:rerun-if-changed=cpp/torrent_helpers.cc");
    println!("cargo:rerun-if-changed=cpp/libtorrent_bridge.h");
    println!("cargo:rerun-if-changed=cpp/libtorrent_bridge.cc");
}

fn emit_matching_link_lib(link_path: &std::path::Path, prefix: &str) {
    let entries = match std::fs::read_dir(link_path) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let extension = path.extension().and_then(|value| value.to_str());
        if extension != Some("lib") {
            continue;
        }

        let stem = match path.file_stem().and_then(|value| value.to_str()) {
            Some(stem) => stem,
            None => continue,
        };

        if stem.starts_with(prefix) {
            println!("cargo:rustc-link-lib={stem}");
            return;
        }
    }
}
