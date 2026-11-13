//! Compiles native/hydra-native/src/in_place_extraction.rs without napi.
fn main() {
    println!("cargo:rustc-cfg=hydra_rewrite");
    println!("cargo:rustc-check-cfg=cfg(hydra_rewrite)");
    println!("cargo:rerun-if-changed=../../../native/hydra-native/src/in_place_extraction.rs");
}
