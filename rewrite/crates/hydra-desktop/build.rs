fn main() {
    // Element ids are kept in debug builds so tests can find elements (ElementHandle).
    let debug = std::env::var("PROFILE").as_deref() == Ok("debug");
    let config = slint_build::CompilerConfiguration::new().with_debug_info(debug);
    slint_build::compile_with_config("ui/app.slint", config.clone()).expect("Slint build failed");

    // Small component harness used by tests/review_editor.rs.
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("editor_harness.rs");
    slint_build::compile_with_output_path("tests/editor_harness.slint", out, config)
        .expect("Slint harness build failed");
}
