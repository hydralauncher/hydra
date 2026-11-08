fn main() {
    // Element ids are kept in debug builds so tests can find elements (ElementHandle).
    let debug = std::env::var("PROFILE").as_deref() == Ok("debug");
    let config = slint_build::CompilerConfiguration::new().with_debug_info(debug);
    slint_build::compile_with_config("ui/app.slint", config.clone()).expect("Slint build failed");

    // Small component harnesses used by the headless tests.
    let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    slint_build::compile_with_output_path(
        "tests/editor_harness.slint",
        out_dir.join("editor_harness.rs"),
        config.clone(),
    )
    .expect("Slint harness build failed");
    slint_build::compile_with_output_path(
        "tests/game_page_harness.slint",
        out_dir.join("game_page_harness.rs"),
        config.clone(),
    )
    .expect("Slint harness build failed");
    slint_build::compile_with_output_path(
        "tests/leaderboards_harness.slint",
        out_dir.join("leaderboards_harness.rs"),
        config,
    )
    .expect("Slint harness build failed");
}
