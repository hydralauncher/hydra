//! Compiles native/hydra-native's capture, window and input modules without napi.
fn main() {
    println!("cargo:rustc-cfg=hydra_rewrite");
    println!("cargo:rustc-check-cfg=cfg(hydra_rewrite)");
    for file in [
        "desktop_duplication.rs",
        "window_bounds.rs",
        "window_order.rs",
        "window_client.rs",
        "active_window.rs",
        "kde_focus.rs",
        "linux_process.rs",
        "screenshot_input",
    ] {
        println!("cargo:rerun-if-changed=../../../native/hydra-native/src/{file}");
    }
}
