const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
if (process.platform !== "linux")
  throw new Error(
    "This smoke requires Linux x64, the prepared private Python runtime, UMU, and built PE fixtures."
  );
const source = path.resolve(__dirname, "..");
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith("--") || !process.argv[i + 1])
    throw new Error("Expected --option path pairs");
  options.set(process.argv[i], path.resolve(process.argv[i + 1]));
}
const base = options.get("--dependencies") || source;
const ts = require(base + "/node_modules/typescript");
const modules = new Map();
const data =
  options.get("--data-dir") ||
  fs.mkdtempSync(path.join(os.tmpdir(), "hydra-epic-linux-smoke-"));
const python =
  options.get("--python-runner") ||
  path.join(source, "binaries", "legendary", "linux-x64", "python-runner");
const umu =
  options.get("--umu") || path.join(source, "binaries", "umu", "umu-run");
const helper =
  options.get("--helper") ||
  path.join(
    source,
    "binaries",
    "epic-prerequisite-runner",
    "x64",
    "epic-prerequisite-runner.exe"
  );
const fixtureSource =
  options.get("--fixture") ||
  path.join(
    source,
    "native",
    "epic-prerequisite-runner",
    "target",
    "x86_64-pc-windows-gnu",
    "release",
    "epic-prerequisite-fixture.exe"
  );
const fixture = path.join(
  data,
  "installed fixture",
  "epic-prerequisite-fixture.exe"
);
const runtimeManifest = require(
  path.join(source, "src", "shared", "epic-linux-runtime-manifest.json")
);
let calls = 0;
let configured = null;
class EpicManagedError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const overrides = {
  electron: { app: { isPackaged: true } },
  "@main/level": {
    db: { get: async () => configured },
    levelKeys: { userPreferences: "preferences" },
  },
  "../system-path": {
    SystemPath: { getPath: (name) => (name === "home" ? os.homedir() : data) },
  },
  "./system-path": {
    SystemPath: { getPath: (name) => (name === "home" ? os.homedir() : data) },
  },
  "./legendary": {
    Legendary: { getBinaryPath: () => path.dirname(python) + "/legendary" },
  },
  "./legendary-managed-runtime": {
    EpicManagedError,
    managedWorkspacePath: (_data, owner, artifact, platform) =>
      path.join(
        data,
        "workspaces",
        crypto
          .createHash("sha256")
          .update(JSON.stringify([owner, artifact, platform]))
          .digest("hex")
      ),
  },
  "@main/events/helpers/parse-launch-options": null,
  "@main/helpers/resolve-launch-command": null,
  "../umu": {
    Umu: {
      isValidProtonPath: (p) =>
        fs.existsSync(path.join(p, "proton")) &&
        fs.existsSync(path.join(p, "toolmanifest.vdf")),
      getSupervisedRuntime: () => ({
        binaryPath: umu,
        version: runtimeManifest.umu.version,
        sha256: runtimeManifest.umu.sha256,
      }),
      launchSupervised: async (o) => {
        calls++;
        return load(
          source + "/src/main/services/umu-supervised-process.ts"
        ).spawnSupervisedUmu(o);
      },
    },
  },
};
function load(file) {
  if (modules.has(file)) return modules.get(file);
  if (file.endsWith(".json")) return JSON.parse(fs.readFileSync(file, "utf8"));
  const exported = {};
  modules.set(file, exported);
  const text = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
  }).outputText;
  const customRequire = (name) => {
    if (overrides[name]) return overrides[name];
    if (name === "@main/events/helpers/parse-launch-options")
      return load(source + "/src/main/events/helpers/parse-launch-options.ts");
    if (name === "@main/helpers/resolve-launch-command")
      return load(source + "/src/main/helpers/resolve-launch-command.ts");
    if (name.startsWith("node:")) return require(name);
    if (!name.startsWith(".")) return require(base + "/node_modules/" + name);
    let resolved = path.resolve(path.dirname(file), name);
    if (resolved.endsWith(".js")) resolved = resolved.slice(0, -3) + ".ts";
    if (!path.extname(resolved)) resolved += ".ts";
    return load(resolved);
  };
  vm.runInNewContext(
    text,
    {
      exports: exported,
      require: customRequire,
      __dirname: path.dirname(file),
      process: { ...process, resourcesPath: data },
      Buffer,
      AbortController,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      console,
    },
    { filename: file }
  );
  return exported;
}
async function main() {
  await fsp.mkdir(path.join(data, "epic"), { recursive: true, mode: 0o700 });
  await fsp.copyFile(
    helper,
    path.join(data, "epic", "epic-prerequisite-runner.exe")
  );
  await fsp.mkdir(path.dirname(fixture), { recursive: true });
  await fsp.copyFile(fixtureSource, fixture);
  const api = load(source + "/src/main/services/epic/linux-runtime.ts");
  const owner = {
    environment: "staging",
    userId: "smoke-user",
    epicAccountId: "smoke-account",
  };
  const target = { owner, artifactId: "SyntheticSmoke", platform: "Windows" };
  const game = {
    shop: "epic",
    objectId: "Smoke:Fixture",
    epicInstallation: target,
  };
  const installed = {
    installPath: path.dirname(fixture),
    version: "smoke-build",
  };
  const signal = new AbortController().signal;
  console.log("prepare automatic start");
  const ctx = await api.ensureEpicLinuxPrerequisites({
    game,
    target,
    installed,
    signal,
  });
  assert.ok(path.isAbsolute(ctx.protonPath));
  assert.match(path.basename(ctx.protonPath), /^UMU-Proton-/);
  assert.ok(ctx.prefixGeneration);
  console.log(
    "prepare automatic passed",
    ctx.umuVersion,
    path.basename(ctx.protonPath)
  );
  const roundtripFile = path.join(data, "path with spaces Ω.txt");
  await fsp.writeFile(roundtripFile, "map");
  const mapped = await api.mapEpicLinuxPath(ctx, roundtripFile);
  assert.match(mapped, /^[A-Z]:\\/i);
  console.log("path roundtrip passed");
  const before = calls;
  const offline = await api.ensureEpicLinuxPrerequisites({
    game,
    target,
    installed,
    signal,
    offline: true,
  });
  assert.equal(calls, before);
  assert.equal(offline.prefixGeneration, ctx.prefixGeneration);
  console.log("offline cached receipt passed");
  const lease = await api.acquireEpicLinuxPrefixSession(ctx);
  const record = path.join(data, "launch-record.json");
  const recordWin = await api.mapEpicLinuxPath(ctx, record);
  const gameCwd = path.join(data, "game working directory");
  await fsp.mkdir(gameCwd, { recursive: true });
  const gameCwdWin = await api.mapEpicLinuxPath(ctx, gameCwd);
  const launched = await api.launchEpicLinuxGame(
    {
      executable: fixture,
      args: [
        "--record",
        recordWin,
        "-AUTH_PASSWORD=synthetic-epic-secret",
        "-epicovt=synthetic-ownership-token",
      ],
      workingDirectory: gameCwd,
      environment: { HYDRA_EPIC_SMOKE_SENTINEL: "synthetic-environment-value" },
    },
    offline,
    { lease }
  );
  assert.equal((await launched.exited).code, 0);
  await launched.waitForTreeExit();
  const output = await launched.output;
  assert.equal(output.stdout, "");
  assert.equal(output.stderr, "");
  lease.release();
  const recorded = JSON.parse(await fsp.readFile(record, "utf8"));
  await fsp.rm(record);
  assert.ok(JSON.stringify(recorded).includes("synthetic-epic-secret"));
  assert.equal(
    path.win32.normalize(recorded.cwd).toLowerCase(),
    path.win32.normalize(gameCwdWin).toLowerCase()
  );
  assert.equal(
    recorded.env.HYDRA_EPIC_SMOKE_SENTINEL,
    "synthetic-environment-value"
  );
  assert.equal(recorded.env.HYDRA_EPIC_INVOCATION_ID, launched.invocationId);
  assert.equal(recorded.env.PROTONPATH, ctx.protonPath);
  assert.equal(await fsp.realpath(recorded.env.WINEPREFIX), ctx.winePrefixPath);
  console.log(
    "supervised benign authenticated-like PE passed; private pipe output discarded"
  );
  const customGame = {
    ...game,
    winePrefixPath: path.join(data, "custom prefix"),
    protonPath: ctx.protonPath,
  };
  console.log("prepare custom start");
  const custom = await api.ensureEpicLinuxPrerequisites({
    game: customGame,
    target,
    installed,
    signal,
  });
  assert.equal(custom.winePrefixPath, customGame.winePrefixPath);
  assert.notEqual(custom.prefixGeneration, ctx.prefixGeneration);
  console.log("custom prefix + selected Proton passed");
  const receipts = [];
  async function walk(p) {
    for (const d of await fsp.readdir(p, { withFileTypes: true })) {
      const q = path.join(p, d.name);
      if (d.isDirectory()) await walk(q);
      else if (d.name === "linux-runtime.json") receipts.push(q);
    }
  }
  await walk(path.join(data, "workspaces"));
  for (const r of receipts) {
    const s = await fsp.readFile(r, "utf8");
    assert.ok(
      !/synthetic-epic-secret|synthetic-ownership-token|AUTH_PASSWORD/.test(s)
    );
  }
  async function inspectPrivateFiles(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await inspectPrivateFiles(file);
      else if (
        entry.isFile() &&
        /\.(?:log|json|reg|txt)$/.test(entry.name) &&
        (await fsp.stat(file)).size <= 2 * 1024 * 1024
      ) {
        const contents = await fsp.readFile(file, "utf8");
        assert.ok(
          !/synthetic-epic-secret|synthetic-ownership-token|synthetic-environment-value/.test(
            contents
          ),
          `Unexpected synthetic credential persisted in ${file}`
        );
      }
    }
  }
  await api.ensureEpicLinuxPrerequisites({
    game: customGame,
    target,
    installed: {
      ...installed,
      prereq_info: { path: path.basename(fixture), args: "--exit 3010" },
    },
    signal,
  });
  console.log(
    "Proton prerequisite full DWORD 3010 + supervised system reboot passed"
  );
  const sourceContext = await api.ensureEpicLinuxPrerequisites({
    game: customGame,
    target,
    installed: {
      installPath: path.dirname(fixtureSource),
      version: "mounted-source-build",
    },
    signal,
  });
  assert.match(
    await api.mapEpicLinuxPath(sourceContext, fixtureSource),
    /^[A-Z]:\\/i
  );
  console.log(
    "mounted source fixture roundtrip with fixed installation context passed"
  );
  await inspectPrivateFiles(data);
  console.log("credential-free receipts passed");
  console.log(
    JSON.stringify({
      passed: true,
      calls,
      proton: path.basename(ctx.protonPath),
      automaticPrefix: ctx.winePrefixPath,
      customPrefix: custom.winePrefixPath,
    })
  );
}
main().catch((e) => {
  console.error("SMOKE_FAILED", e.code || e.name, e.message);
  process.exitCode = 1;
});
