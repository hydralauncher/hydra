const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { execFile, spawn } = require("node:child_process");
const execute = promisify(execFile);
const {
  buildEpicPrerequisiteRunner,
  resolveCargoExecutable,
  resolveSystemExecutable,
  TARGET,
  FILE_NAME,
} = require("./build-epic-prerequisite-runner.cjs");

const WINE_COMMAND_TIMEOUT_MS = 120_000;
const WINE_COMMAND_MAX_OUTPUT_BYTES = 1024 * 1024;
const DESCENDANT_COMPLETION_DELAY_MS = 200;
const CANCELLATION_CHILD_DELAY_MS = 1200;
const CANCELLATION_START_MAX_ATTEMPTS = 100;
const CANCELLATION_START_POLL_INTERVAL_MS = 20;
const CANCELLATION_OBSERVATION_DELAY_MS = 1500;

async function smoke() {
  if (process.platform !== "linux")
    throw new Error("Wine fixture requires Linux");
  const projectDir = path.resolve(__dirname, "..");
  const [cargo, wine, wineboot, winepath, wineserver, wixl] = await Promise.all(
    [
      resolveCargoExecutable(),
      ...["wine", "wineboot", "winepath", "wineserver", "wixl"].map((name) =>
        resolveSystemExecutable(name)
      ),
    ]
  );
  const output = await buildEpicPrerequisiteRunner({ projectDir });
  await execute(
    cargo,
    [
      "build",
      "--locked",
      "--release",
      "--target",
      TARGET,
      "--manifest-path",
      path.join(projectDir, "native/epic-prerequisite-runner/Cargo.toml"),
      "--bin",
      "epic-prerequisite-fixture",
    ],
    {
      env: {
        ...process.env,
        CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER: "x86_64-w64-mingw32-gcc",
      },
    }
  );
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-epic-wine-")
  );
  const env = {
    ...process.env,
    WINEPREFIX: path.join(directory, "prefix"),
    WINEARCH: "win64",
    WINEDEBUG: "-all",
    WINEDLLOVERRIDES: "mscoree,mshtml=",
  };
  const run = (file, args, options = {}) =>
    execute(file, args, {
      env,
      timeout: WINE_COMMAND_TIMEOUT_MS,
      maxBuffer: WINE_COMMAND_MAX_OUTPUT_BYTES,
      ...options,
    });
  const windowsPath = async (file) =>
    (await run(winepath, ["-w", file])).stdout.trim();
  const quiet = (file, args) =>
    new Promise((resolve, reject) => {
      const child = spawn(file, args, { env, stdio: "ignore" });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("Wine preparation failed"))
      );
    });
  try {
    await fs.mkdir(env.WINEPREFIX, { recursive: true, mode: 0o700 });
    await quiet(wineserver, ["-p"]);
    await quiet(wineboot, ["-u"]);
    const helper = path.join(output, FILE_NAME);
    const fixture = path.join(
      projectDir,
      "native/epic-prerequisite-runner/target",
      TARGET,
      "release/epic-prerequisite-fixture.exe"
    );
    let attempt = 0;
    const request = async (args, kind = "exe", executable = fixture) => {
      const nonce = `fixture-${++attempt}`;
      const result = path.join(directory, `${nonce}.result.json`);
      const config = path.join(directory, `${nonce}.config.json`);
      await fs.writeFile(
        config,
        JSON.stringify({
          schemaVersion: 1,
          kind,
          executable: kind === "reboot" ? "" : await windowsPath(executable),
          args,
          cwd: await windowsPath(directory),
          nonce,
          resultPath: await windowsPath(result),
        }),
        { mode: 0o600 }
      );
      return { config, result, nonce };
    };
    const invoke = async (input) => {
      await run(wine, [helper, await windowsPath(input.config)]);
      const result = JSON.parse(await fs.readFile(input.result, "utf8"));
      assert.equal(result.schemaVersion, 1);
      assert.equal(result.nonce, input.nonce);
      return result;
    };
    for (const code of [0, 3010, 1641, 194, 105, 0xffffffff]) {
      const result = await invoke(await request(["--exit", String(code)]));
      assert.equal(result.exitCode, code, `Full Windows exit code ${code}`);
    }
    console.log("Wine supervisor: full exit codes passed.");
    const record = path.join(directory, "argv.json");
    const values = [
      "",
      "two words",
      'a"b',
      "C:\\trailing\\",
      "%PATH% & $(literal)",
      "á日本語",
    ];
    await invoke(
      await request(["--record", await windowsPath(record), ...values])
    );
    assert.deepEqual(
      JSON.parse(await fs.readFile(record, "utf8")).args,
      values
    );
    const marker = path.join(directory, "child-finished");
    await invoke(
      await request([
        "--spawn-child",
        String(DESCENDANT_COMPLETION_DELAY_MS),
        await windowsPath(marker),
      ])
    );
    assert.equal(await fs.readFile(marker, "utf8"), "child-complete");
    const msi = path.join(directory, "fixture.msi");
    await run(wixl, [
      "-a",
      "x64",
      "-o",
      msi,
      path.join(
        projectDir,
        "native/epic-prerequisite-runner/tests/fixture.wxs"
      ),
    ]);
    assert.equal(
      (await invoke(await request(["/qn", "/norestart"], "msi", msi))).exitCode,
      0
    );
    const registry = await run(wine, [
      "reg",
      "query",
      "HKCU\\Software\\Hydra\\EpicPrerequisiteFixture",
      "/v",
      "Installed",
    ]);
    assert.match(registry.stdout, /yes/);
    console.log("Wine supervisor: MSI installation effect verified.");
    await invoke(
      await request(["--schedule-reboot", await windowsPath(directory)])
    );
    assert.equal((await invoke(await request([], "reboot"))).exitCode, 0);
    assert.equal(
      await fs.readFile(path.join(directory, "rename-destination.txt"), "utf8"),
      "rename-applied"
    );
    assert.equal(
      await fs.stat(path.join(directory, "rename-source.txt")).then(
        () => true,
        () => false
      ),
      false
    );
    assert.equal(
      await fs.stat(path.join(directory, "delete-on-reboot.txt")).then(
        () => true,
        () => false
      ),
      false
    );
    assert.deepEqual(
      JSON.parse(
        await fs.readFile(path.join(directory, "runonce.json"), "utf8")
      ).args,
      ["runonce-executed"]
    );
    console.log(
      "Wine supervisor: reboot rename/delete and RunOnce effects verified."
    );
    const cancellationMarker = path.join(directory, "cancelled-child");
    const input = await request([
      "--spawn-child",
      String(CANCELLATION_CHILD_DELAY_MS),
      await windowsPath(cancellationMarker),
    ]);
    const child = spawn(wine, [helper, await windowsPath(input.config)], {
      env,
      stdio: "pipe",
    });
    const closed = new Promise((resolve, reject) => {
      child.once("close", resolve);
      child.once("error", reject);
    });
    const started = cancellationMarker + ".started";
    for (let index = 0; index < CANCELLATION_START_MAX_ATTEMPTS; index++) {
      if (
        await fs.stat(started).then(
          () => true,
          () => false
        )
      )
        break;
      await new Promise((resolve) =>
        setTimeout(resolve, CANCELLATION_START_POLL_INTERVAL_MS)
      );
    }
    assert.ok(
      await fs.stat(started).then(
        () => true,
        () => false
      )
    );
    child.kill("SIGKILL");
    await closed;
    await new Promise((resolve) =>
      setTimeout(resolve, CANCELLATION_OBSERVATION_DELAY_MS)
    );
    assert.equal(
      await fs.stat(input.result).then(
        () => true,
        () => false
      ),
      false
    );
    assert.equal(
      await fs.stat(cancellationMarker).then(
        () => true,
        () => false
      ),
      false
    );
    console.log(
      "Epic prerequisite Wine fixtures passed: DWORD, argv, descendants, MSI and cancellation."
    );
  } finally {
    await run(wineserver, ["-k"]).catch(() => {});
    await fs.rm(directory, { recursive: true, force: true });
  }
}
smoke().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
