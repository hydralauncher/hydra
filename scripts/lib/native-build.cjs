const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const util = require("node:util");
const childProcess = require("node:child_process");

const execFile = util.promisify(childProcess.execFile);

// mingw links the Rust binaries against these; they must ship next to them.
const windowsRuntimeDlls = [
  "libgcc_s_seh-1.dll",
  "libstdc++-6.dll",
  "libwinpthread-1.dll",
  "vcruntime140.dll",
  "vcruntime140_1.dll",
  "msvcp140.dll",
];

// The GNU host toolchain compiles the C crates (ring, the vendored libopus) with
// mingw-w64, which is not installed on every machine, so Windows prefers the
// Visual Studio toolset. Its CRT is linked statically to keep the shipped
// sidecar free of runtime DLLs.
const windowsMsvcBuilds = {
  x64: {
    target: "x86_64-pc-windows-msvc",
    vcvarsScript: "VC/Auxiliary/Build/vcvars64.bat",
  },
  arm64: {
    target: "aarch64-pc-windows-msvc",
    vcvarsScript: "VC/Auxiliary/Build/vcvarsarm64.bat",
  },
};

const cargoBinDirectory = path.join(os.homedir(), ".cargo", "bin");
const staticCrtRustFlags = "-C target-feature=+crt-static";

// Cargo is always spawned by absolute path: PATH is the vcvars toolchain
// environment, so it must not decide which executable runs.
const cargoExecutable = () =>
  path.join(
    cargoBinDirectory,
    process.platform === "win32" ? "cargo.exe" : "cargo"
  );

const copyWindowsRuntimeDlls = (sourceDirectory, outputDirectory) => {
  if (process.platform !== "win32") return;

  for (const dll of windowsRuntimeDlls) {
    const sourcePath = path.join(sourceDirectory, dll);
    if (!fs.existsSync(sourcePath)) continue;
    const targetPath = path.join(outputDirectory, dll);
    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
};

const ensureDepsResolvableOnLinux = async (binaryPath) => {
  if (process.platform !== "linux") return;

  const { stdout } = await execFile("ldd", [binaryPath], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024 * 10,
  });

  if (stdout.includes("not found")) {
    throw new Error(
      `Unresolved dynamic dependencies found for ${binaryPath}\n${stdout}`
    );
  }
};

// Returns the environment an MSVC build needs for the current architecture, or
// undefined when the C++ toolset is not installed.
const findVisualStudioEnvironment = async () => {
  const msvc = windowsMsvcBuilds[process.arch];
  if (!msvc) return undefined;

  const vswhere = path.join(
    process.env["ProgramFiles(x86)"] || String.raw`C:\Program Files (x86)`,
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe"
  );
  if (!fs.existsSync(vswhere)) return undefined;

  try {
    const { stdout } = await execFile(
      vswhere,
      [
        "-latest",
        "-products",
        "*",
        "-requires",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-find",
        msvc.vcvarsScript,
      ],
      { windowsHide: true }
    );
    const vcvarsPath = stdout.trim().split(/\r?\n/).find(Boolean);
    if (!vcvarsPath) return undefined;

    const { stdout: vcvarsOutput } = await execFile(
      "cmd.exe",
      ["/d", "/c", `call "${vcvarsPath}" >nul 2>&1 && set`],
      {
        windowsHide: true,
        // cmd.exe resolves the quoted batch path itself, so its quotes must
        // reach it untouched.
        windowsVerbatimArguments: true,
      }
    );

    // vcvars prints the environment it prepared, inherited variables included.
    const environment = {};
    for (const line of vcvarsOutput.split(/\r?\n/)) {
      const separator = line.indexOf("=");
      if (separator > 0) {
        environment[line.slice(0, separator)] = line.slice(separator + 1);
      }
    }

    return environment;
  } catch {
    // The probe failed, so the toolset cannot be confirmed as usable.
    return undefined;
  }
};

const isRustupTargetInstalled = async (target) => {
  const rustup = path.join(cargoBinDirectory, "rustup.exe");
  if (!fs.existsSync(rustup)) return false;

  const { stdout } = await execFile(rustup, ["target", "list", "--installed"], {
    windowsHide: true,
  });
  return stdout.split(/\r?\n/).includes(target);
};

const isMsvcTarget = (target) => Boolean(target?.endsWith("-msvc"));

// A forced target is taken as-is; only an MSVC one needs the Visual Studio
// environment and the static CRT it implies.
const resolveForcedTarget = async (target, report) => {
  const staticCrt = isMsvcTarget(target);
  report(
    `Building the stream sidecar for ${target}${staticCrt ? " (static CRT)" : ""}`
  );
  return {
    target,
    environment: staticCrt ? await findVisualStudioEnvironment() : undefined,
  };
};

// The MSVC target is usable only when both the C++ toolset and the rustup target
// are present.
const resolveMsvcBuild = async (report) => {
  const msvc = windowsMsvcBuilds[process.arch];
  if (!msvc) return undefined;

  const environment = await findVisualStudioEnvironment();
  if (!environment) return undefined;
  if (!(await isRustupTargetInstalled(msvc.target))) return undefined;

  report(`Building the stream sidecar for ${msvc.target} (static CRT)`);
  return { target: msvc.target, environment };
};

// MSVC is the primary Windows toolchain and the GNU host is the fallback, so the
// path is decided up-front from toolchain presence: a cargo failure afterwards
// is a real build error and must surface as one. HYDRA_STREAM_CARGO_TARGET
// forces a target. `quiet` suppresses the progress line for callers that report
// the target themselves.
const resolveCargoBuild = async ({ quiet = false } = {}) => {
  const report = quiet ? () => {} : console.log;
  const forcedTarget = process.env.HYDRA_STREAM_CARGO_TARGET;
  if (forcedTarget) return resolveForcedTarget(forcedTarget, report);

  if (process.platform !== "win32") return {};

  const msvcBuild = await resolveMsvcBuild(report);
  if (msvcBuild) return msvcBuild;

  report(
    "Building the stream sidecar for the GNU host toolchain (MSVC toolchain unavailable)"
  );
  return {};
};

// The environment and target a cargo invocation needs on this host: the VS
// environment plus `+crt-static` for an MSVC target, undefined (inherit) for the
// GNU fallback and for non-Windows.
const resolveCargoEnvironment = async (options) => {
  const { target, environment } = await resolveCargoBuild(options);
  const staticCrt = isMsvcTarget(target);

  return {
    target,
    environment: staticCrt
      ? {
          ...(environment || process.env),
          RUSTFLAGS: [process.env.RUSTFLAGS, staticCrtRustFlags]
            .filter(Boolean)
            .join(" "),
        }
      : environment,
  };
};

const buildCargoRelease = async ({
  manifestPath,
  targetDirectory,
  sourceBinaryName,
  outputBinaryName = sourceBinaryName,
  outputDirectory,
}) => {
  const { target, environment: cargoEnvironment } =
    await resolveCargoEnvironment();

  await execFile(
    cargoExecutable(),
    [
      "build",
      "--release",
      ...(target ? ["--target", target] : []),
      "--manifest-path",
      manifestPath,
      "--target-dir",
      targetDirectory,
    ],
    {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 10,
      env: cargoEnvironment,
    }
  );

  const sourceBinaryPath = path.join(
    targetDirectory,
    ...(target ? [target] : []),
    "release",
    sourceBinaryName
  );

  if (!fs.existsSync(sourceBinaryPath)) {
    throw new Error(`Native build output not found at ${sourceBinaryPath}`);
  }

  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputBinaryPath = path.join(outputDirectory, outputBinaryName);
  fs.copyFileSync(sourceBinaryPath, outputBinaryPath);

  // The MSVC build links the CRT statically, so it has no runtime DLL to ship;
  // the GNU build still needs its mingw DLLs copied next to the binary.
  if (!isMsvcTarget(target)) {
    copyWindowsRuntimeDlls(path.dirname(sourceBinaryPath), outputDirectory);
  }
  await ensureDepsResolvableOnLinux(outputBinaryPath);

  return outputBinaryPath;
};

// stdin/stdout/stderr are ignored by default: `cc` probes the MSVC toolchain
// through the environment `resolveCargoEnvironment` loads, not through inherited
// pipes.
const loadCargoEnvironment = () => {
  const bootstrap = `
    const { resolveCargoEnvironment } = require(${JSON.stringify(__filename)});
    resolveCargoEnvironment({ quiet: true })
      .then(({ target, environment }) => {
        process.stdout.write(
          JSON.stringify({ target: target ?? null, environment: environment ?? null })
        );
      })
      .catch((error) => {
        process.stderr.write(String(error && error.stack ? error.stack : error));
        process.exit(1);
      });
  `;

  const { status, stdout, stderr } = childProcess.spawnSync(
    process.execPath,
    ["--input-type=commonjs", "--eval", bootstrap],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );

  if (status !== 0) {
    throw new Error(`Failed to resolve the cargo environment: ${stderr ?? ""}`);
  }

  return JSON.parse(stdout);
};

module.exports = {
  buildCargoRelease,
  cargoExecutable,
  loadCargoEnvironment,
  resolveCargoEnvironment,
};
