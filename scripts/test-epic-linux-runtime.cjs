const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { registerHooks } = require("node:module");
const { fileURLToPath, pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const ts = require("typescript");
const source = fs.realpathSync(path.resolve(__dirname, ".."));
const sourceRoot = fs.realpathSync(path.join(source, "src"));
const portsKey = Symbol.for("hydra.epic.runtime.smoke.ports");
const portSource =
  'module.exports = global[Symbol.for("hydra.epic.runtime.smoke.ports")].get(__filename);';

function parseOptions(argv) {
  const allowed = new Set([
    "--data-dir",
    "--python-runner",
    "--umu",
    "--helper",
    "--fixture",
  ]);
  const options = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!allowed.has(name) || options.has(name))
      throw new Error("Unknown or duplicate smoke option");
    if (!value || value.startsWith("--") || value.includes("\0"))
      throw new Error("Expected --option path pairs");
    options.set(name, path.resolve(value));
  }
  return options;
}

function trustedSource(file) {
  const canonical = fs.realpathSync(file);
  const relative = path.relative(sourceRoot, canonical);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    path.extname(canonical) !== ".ts"
  )
    throw new Error("Smoke TypeScript must be inside this checkout's src");
  return canonical;
}

/** Normal Node module loading; CLI paths never select code or dependencies. */
function installSmokeLoader(overrides) {
  if (typeof registerHooks !== "function")
    throw new Error("The smoke requires Node 22.15 or newer");
  if (global[portsKey]) throw new Error("A smoke loader is already active");
  const portFiles = new Map();
  const portSpecifiers = new Map();
  Object.entries(overrides).forEach(([name, value], index) => {
    const file = path.join(__dirname, ".epic-smoke-ports", `${index}.cjs`);
    portSpecifiers.set(name, pathToFileURL(file).href);
    portFiles.set(file, value);
  });
  const loaded = new Set(portFiles.keys());
  const aliases = new Map([
    [
      "@main/events/helpers/parse-launch-options",
      path.join(
        sourceRoot,
        "main",
        "events",
        "helpers",
        "parse-launch-options.ts"
      ),
    ],
    [
      "@main/helpers/resolve-launch-command",
      path.join(sourceRoot, "main", "helpers", "resolve-launch-command.ts"),
    ],
  ]);
  global[portsKey] = portFiles;
  const hooks = registerHooks({
    resolve(name, context, nextResolve) {
      const port = portSpecifiers.get(name);
      if (port) return { url: port, shortCircuit: true };
      const alias = aliases.get(name);
      if (alias)
        return {
          url: pathToFileURL(trustedSource(alias)).href,
          shortCircuit: true,
        };
      if (name.startsWith(".") && context.parentURL?.startsWith("file:")) {
        const parent = fileURLToPath(context.parentURL);
        if (path.extname(parent) === ".ts") {
          let file = path.resolve(path.dirname(trustedSource(parent)), name);
          if (file.endsWith(".js")) file = file.slice(0, -3) + ".ts";
          else if (!path.extname(file)) file += ".ts";
          if (path.extname(file) === ".ts")
            return {
              url: pathToFileURL(trustedSource(file)).href,
              shortCircuit: true,
            };
        }
      }
      return nextResolve(name, context);
    },
    load(url, context, nextLoad) {
      if (!url.startsWith("file:")) return nextLoad(url, context);
      const file = fileURLToPath(url);
      if (portFiles.has(file))
        return { format: "commonjs", source: portSource, shortCircuit: true };
      if (path.extname(file) !== ".ts") return nextLoad(url, context);
      const canonical = trustedSource(file);
      loaded.add(canonical);
      return {
        format: "commonjs",
        source: ts.transpileModule(fs.readFileSync(canonical, "utf8"), {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
            resolveJsonModule: true,
          },
        }).outputText,
        shortCircuit: true,
      };
    },
  });
  return () => {
    hooks.deregister();
    for (const file of loaded) delete require.cache[file];
    delete global[portsKey];
  };
}

async function runSmoke(argv) {
  if (process.platform !== "linux")
    throw new Error(
      "This smoke requires Linux x64, the prepared private Python runtime, UMU, and built PE fixtures."
    );
  const options = parseOptions(argv);
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
      SystemPath: {
        getPath: (name) => (name === "home" ? os.homedir() : data),
      },
    },
    "./system-path": {
      SystemPath: {
        getPath: (name) => (name === "home" ? os.homedir() : data),
      },
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
          return require("../src/main/services/umu-supervised-process.ts").spawnSupervisedUmu(
            o
          );
        },
      },
    },
  };
  const stopLoader = installSmokeLoader(overrides);
  const previousResourcesPath = process.resourcesPath;
  process.resourcesPath = data;
  async function main() {
    await fsp.mkdir(path.join(data, "epic"), { recursive: true, mode: 0o700 });
    await fsp.copyFile(
      helper,
      path.join(data, "epic", "epic-prerequisite-runner.exe")
    );
    await fsp.mkdir(path.dirname(fixture), { recursive: true });
    await fsp.copyFile(fixtureSource, fixture);
    const api = require("../src/main/services/epic/linux-runtime.ts");
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
        environment: {
          HYDRA_EPIC_SMOKE_SENTINEL: "synthetic-environment-value",
        },
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
    assert.equal(
      await fsp.realpath(recorded.env.WINEPREFIX),
      ctx.winePrefixPath
    );
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
      for (const entry of await fsp.readdir(directory, {
        withFileTypes: true,
      })) {
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
  try {
    await main();
  } finally {
    stopLoader();
    if (previousResourcesPath === undefined) delete process.resourcesPath;
    else process.resourcesPath = previousResourcesPath;
  }
}

module.exports = { installSmokeLoader, parseOptions };
if (require.main === module)
  runSmoke(process.argv.slice(2)).catch((e) => {
    console.error("SMOKE_FAILED", e.code || e.name, e.message);
    process.exitCode = 1;
  });
