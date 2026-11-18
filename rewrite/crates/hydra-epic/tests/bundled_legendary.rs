//! Runs the real bundled Legendary (no Epic account involved): point
//! `HYDRA_LEGENDARY_DIR` at a prepared bundle, e.g.
//! `HYDRA_LEGENDARY_DIR=<repo>/legendary/win32/x64 cargo test -p hydra-epic -- --ignored`.

use std::time::Duration;

use hydra_epic::Cancel;
use hydra_epic::legendary;
use hydra_epic::process::{self, Spawn};
use hydra_epic::runner::{CommandOptions, OperationDir, execute_legendary};

#[test]
#[ignore = "needs HYDRA_LEGENDARY_DIR"]
fn the_bundle_is_available_and_verified() {
    assert_eq!(legendary::availability(), None);
    let command = legendary::managed_command().expect("managed runtime verifies");
    assert!(command.binary.is_file());
    // managed.py --capabilities: the adapter boots the pinned Legendary core
    let mut args = command.prefix_args.clone();
    args.push("--capabilities".into());
    let finished = process::run(Spawn {
        program: &command.binary,
        args,
        env: vec![],
        timeout: Some(Duration::from_secs(60)),
        stall_timeout: None,
        max_output: 1 << 20,
        cancel: Cancel::new(),
        on_line: None,
    });
    assert_eq!(finished.code, Some(0), "{}", finished.stderr);
    let value: serde_json::Value = serde_json::from_str(&finished.stdout).unwrap();
    assert_eq!(value["protocolVersion"], 1);
    assert_eq!(value["legendaryVersion"], "0.21.1");
}

#[test]
#[ignore = "needs HYDRA_LEGENDARY_DIR"]
fn legendary_runs_in_a_private_config_folder() {
    let user_data = tempfile::tempdir().unwrap();
    let dir = OperationDir::create(user_data.path()).unwrap();
    let binary = legendary::check_binary().unwrap();
    let output = execute_legendary(
        &binary,
        &[
            "--api-timeout".into(),
            "15".into(),
            "status".into(),
            "--offline".into(),
            "--json".into(),
        ],
        CommandOptions {
            timeout: Duration::from_secs(60),
            max_output: 128 * 1024,
            cancel: &Cancel::new(),
            session_required: true,
            config_path: dir.path(),
        },
    )
    .expect("status runs without an account");
    let value: serde_json::Value = serde_json::from_str(&output).unwrap();
    assert_eq!(value["account"], "<not logged in>");
    // nothing was written outside the private folder
    assert!(dir.path().join("config.ini").is_file());
    dir.remove().unwrap();
}
