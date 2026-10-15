#![cfg(windows)]
use std::{
    fs,
    path::PathBuf,
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const DESCENDANT_COMPLETION_DELAY_MS: u64 = 150;
const CANCELLATION_CHILD_DELAY_MS: u64 = 1000;
const CANCELLATION_START_MAX_ATTEMPTS: usize = 100;
const CANCELLATION_START_POLL_INTERVAL_MS: u64 = 20;
const CANCELLATION_OBSERVATION_DELAY_MS: u64 = 1200;

fn fixture(args: &[String], kind: &str) -> (PathBuf, PathBuf, PathBuf) {
    let dir = std::env::temp_dir().join(format!(
        "hydra prerequisite {} {}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    let executable = env!("CARGO_BIN_EXE_epic-prerequisite-fixture");
    let config = dir.join("config.json");
    let result = dir.join("result.json");
    fs::write(
        &config,
        serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 1, "kind": kind, "executable": executable,
            "args": args, "cwd": dir, "nonce": "fixture-attempt", "resultPath": result,
        }))
        .unwrap(),
    )
    .unwrap();
    (dir, config, result)
}

#[test]
fn probe_confirms_a_real_pe_can_start_without_mutating_a_request() {
    assert!(Command::new(env!("CARGO_BIN_EXE_epic-prerequisite-runner"))
        .arg("--probe")
        .status()
        .unwrap()
        .success());
}

#[test]
fn actual_process_results_preserve_success_reboot_and_failure_dwords() {
    for code in [0u32, 3010, 1641, 194, 105, u32::MAX] {
        let (dir, config, result) = fixture(&["--exit".into(), code.to_string()], "exe");
        let output = Command::new(env!("CARGO_BIN_EXE_epic-prerequisite-runner"))
            .arg(&config)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&result).unwrap()).unwrap();
        assert_eq!(value["exitCode"].as_u64(), Some(u64::from(code)));
        assert_eq!(value["nonce"], "fixture-attempt");
        fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn actual_process_preserves_argv_unicode_cwd_and_waits_for_children() {
    let (dir, config, result) = fixture(&[], "exe");
    let record = dir.join("argv.json");
    let args = [
        "",
        "two words",
        "quote\"value",
        "C:\\trailing\\",
        "%PATH% & $(literal)",
        "á日本語",
    ];
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
    let mut record_args = vec!["--record".to_owned(), record.to_string_lossy().into_owned()];
    record_args.extend(args.iter().map(|s| (*s).to_owned()));
    value["args"] = serde_json::json!(record_args);
    fs::write(&config, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(Command::new(env!("CARGO_BIN_EXE_epic-prerequisite-runner"))
        .arg(&config)
        .status()
        .unwrap()
        .success());
    let value: serde_json::Value = serde_json::from_slice(&fs::read(&record).unwrap()).unwrap();
    assert_eq!(value["args"], serde_json::json!(args));
    assert_eq!(
        PathBuf::from(value["cwd"].as_str().unwrap())
            .canonicalize()
            .unwrap(),
        dir.canonicalize().unwrap()
    );
    fs::remove_file(result).unwrap();
    let marker = dir.join("child-finished");
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
    value["args"] = serde_json::json!([
        "--spawn-child",
        DESCENDANT_COMPLETION_DELAY_MS.to_string(),
        marker
    ]);
    fs::write(&config, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(Command::new(env!("CARGO_BIN_EXE_epic-prerequisite-runner"))
        .arg(&config)
        .status()
        .unwrap()
        .success());
    assert_eq!(fs::read(marker).unwrap(), b"child-complete");
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn killing_supervisor_terminates_the_installer_job_without_publishing_a_result() {
    let (dir, config, result) = fixture(&[], "exe");
    let marker = dir.join("child-finished");
    let started = marker.with_extension("started");
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
    value["args"] = serde_json::json!([
        "--spawn-child",
        CANCELLATION_CHILD_DELAY_MS.to_string(),
        marker
    ]);
    fs::write(&config, serde_json::to_vec(&value).unwrap()).unwrap();
    let mut supervisor = Command::new(env!("CARGO_BIN_EXE_epic-prerequisite-runner"))
        .arg(&config)
        .spawn()
        .unwrap();
    for _ in 0..CANCELLATION_START_MAX_ATTEMPTS {
        if started.exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(CANCELLATION_START_POLL_INTERVAL_MS));
    }
    assert!(started.exists());
    supervisor.kill().unwrap();
    supervisor.wait().unwrap();
    std::thread::sleep(Duration::from_millis(CANCELLATION_OBSERVATION_DELAY_MS));
    assert!(!marker.exists());
    assert!(!result.exists());
    fs::remove_dir_all(dir).unwrap();
}
