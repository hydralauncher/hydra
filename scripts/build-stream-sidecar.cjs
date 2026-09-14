const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");
const childProcess = require("node:child_process");

const execFile = util.promisify(childProcess.execFile);

const projectRoot = process.cwd();
const manifestPath = path.join(
  projectRoot,
  "native",
  "hydra-stream",
  "Cargo.toml"
);
const cargoTargetDir = path.join(
  projectRoot,
  "native",
  "hydra-stream",
  "target"
);
const outputDir = path.join(projectRoot, "hydra-stream");

const sourceBinaryNameByPlatform = {
  linux: "hydra-stream",
  darwin: "hydra-stream",
  win32: "hydra-stream.exe",
};

const run = async (command, args, options = {}) => {
  await execFile(command, args, {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024 * 10,
    ...options,
  });
};

const ensureDepsResolvableOnLinux = async (outputBinaryPath) => {
  if (process.platform !== "linux") return;

  const { stdout } = await execFile("ldd", [outputBinaryPath], {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024 * 10,
  });

  if (stdout.includes("not found")) {
    throw new Error(
      `Unresolved dynamic dependencies found for ${outputBinaryPath}\n${stdout}`
    );
  }
};

const copySidecarLibrariesOnWindows = async (sourceDirectory) => {
  if (process.platform !== "win32") return;

  const candidateDlls = [
    "libgcc_s_seh-1.dll",
    "libstdc++-6.dll",
    "libwinpthread-1.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "msvcp140.dll",
  ];

  for (const dll of candidateDlls) {
    const sourcePath = path.join(sourceDirectory, dll);
    if (!fs.existsSync(sourcePath)) continue;
    const targetPath = path.join(outputDir, dll);
    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
};

const build = async () => {
  // The stream sidecar is Windows-only for now (DXGI/NVENC/WASAPI).
  if (process.platform !== "win32") {
    console.log("Stream sidecar build skipped: win32 only");
    return;
  }

  const sourceBinaryName = sourceBinaryNameByPlatform[process.platform];

  if (!sourceBinaryName) {
    throw new Error(
      `Unsupported platform for native build: ${process.platform}`
    );
  }

  console.log("Building hydra-stream Rust sidecar...");

  const cargoArgs = [
    "build",
    "--release",
    "--manifest-path",
    manifestPath,
    "--target-dir",
    cargoTargetDir,
  ];

  await run("cargo", cargoArgs);

  const sourceBinaryPath = path.join(
    cargoTargetDir,
    "release",
    sourceBinaryName
  );

  if (!fs.existsSync(sourceBinaryPath)) {
    throw new Error(`Native build output not found at ${sourceBinaryPath}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const outputBinaryPath = path.join(outputDir, sourceBinaryName);
  fs.copyFileSync(sourceBinaryPath, outputBinaryPath);

  await copySidecarLibrariesOnWindows(path.dirname(sourceBinaryPath));
  await ensureDepsResolvableOnLinux(outputBinaryPath);

  console.log(`Hydra stream sidecar ready at ${outputBinaryPath}`);
};

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
