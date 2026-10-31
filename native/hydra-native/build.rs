fn main() {
    napi_build::setup();

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-env-changed=HYDRA_TORRENT_LIB_DIR");
    let dir = std::env::var("HYDRA_TORRENT_LIB_DIR").expect(
        "Run node scripts/build-native-addon.cjs to build the pinned libtorrent bridge first",
    );
    println!("cargo:rustc-link-search=native={dir}");
    match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
        Ok("linux") => println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN"),
        Ok("macos") => println!("cargo:rustc-link-arg=-Wl,-rpath,@loader_path"),
        _ => (),
    }
}
