# Epic prerequisite supervisor

This small Windows PE runs inside the game's Proton prefix. It does not receive Epic credentials. The launcher passes one Windows path to a private UTF-8 JSON request:

```json
{
  "schemaVersion": 1,
  "kind": "exe",
  "executable": "C:\\Game\\setup.exe",
  "args": [],
  "cwd": "C:\\Game",
  "nonce": "attempt-id",
  "resultPath": "C:\\Private\\result.json"
}
```

The request and result must share a private directory. `kind: "msi"` resolves `msiexec.exe` through `GetSystemDirectoryW` and prepends `/i`; `kind: "reboot"` requires an empty executable and argument array and resolves `wineboot.exe -r` internally. No command shell or caller-selected reboot command is accepted.

The root starts suspended and joins a job before it can spawn children. The supervisor waits for the root and every member of that job, then atomically publishes `{schemaVersion:1,nonce,exitCode}`. `exitCode` is the complete Windows DWORD, including failures. The helper's own zero exit only means this result was published; the launcher decides whether the installer succeeded. Closing or killing the supervisor kills its job and does not publish a result. An isolated `--probe` invocation exits zero without reading or writing a request, for the initial Proton bootstrap.

On Linux, install the Rust `x86_64-pc-windows-gnu` target and `gcc-mingw-w64-x86-64`, then run `node scripts/build-epic-prerequisite-runner.cjs` from the project root. This builds locked dependencies, removes the PE timestamp, verifies PE32+ x64 and writes a source/binary SHA-256 manifest alongside the ignored development output. Packaging rebuilds stale output and verifies the copied resource again.

Run native Windows tests with `cargo test --locked --manifest-path native/epic-prerequisite-runner/Cargo.toml`. Linux CI additionally runs `xvfb-run -a node scripts/test-epic-prerequisite-wine.cjs` with Wine, wixl and MinGW installed. These disposable-prefix fixtures cover full exit codes, argument preservation, descendants, cancellation, a real MSI registry effect, and reboot rename/delete and RunOnce effects. Wine tests complement validation with the actual UMU/Proton selected by Hydra; they do not replace it.
