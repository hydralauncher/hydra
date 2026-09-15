const fs = require("node:fs");
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

const buildCargoRelease = async ({
  manifestPath,
  targetDirectory,
  sourceBinaryName,
  outputBinaryName = sourceBinaryName,
  outputDirectory,
}) => {
  await execFile(
    "cargo",
    [
      "build",
      "--release",
      "--manifest-path",
      manifestPath,
      "--target-dir",
      targetDirectory,
    ],
    {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 10,
    }
  );

  const sourceBinaryPath = path.join(
    targetDirectory,
    "release",
    sourceBinaryName
  );

  if (!fs.existsSync(sourceBinaryPath)) {
    throw new Error(`Native build output not found at ${sourceBinaryPath}`);
  }

  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputBinaryPath = path.join(outputDirectory, outputBinaryName);
  fs.copyFileSync(sourceBinaryPath, outputBinaryPath);

  copyWindowsRuntimeDlls(path.dirname(sourceBinaryPath), outputDirectory);
  await ensureDepsResolvableOnLinux(outputBinaryPath);

  return outputBinaryPath;
};

module.exports = { buildCargoRelease };
