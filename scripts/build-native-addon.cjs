const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");
const childProcess = require("node:child_process");

const execFile = util.promisify(childProcess.execFile);

const projectRoot = process.cwd();
const manifestPath = path.join(
  projectRoot,
  "native",
  "hydra-native",
  "Cargo.toml"
);
const cargoTargetDir = path.join(
  projectRoot,
  "native",
  "hydra-native",
  "target"
);
const outputDir = path.join(projectRoot, "hydra-native");
const outputNodePath = path.join(outputDir, "hydra-native.node");

const sourceLibraryNameByPlatform = {
  linux: "libhydra_native.so",
  darwin: "libhydra_native.dylib",
  win32: "hydra_native.dll",
};

const run = async (command, args, options = {}) => {
  await execFile(command, args, {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024 * 10,
    ...options,
  });
};

const ensureDepsResolvableOnLinux = async () => {
  if (process.platform !== "linux") return;

  const { stdout } = await execFile("ldd", [outputNodePath], {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024 * 10,
  });

  if (stdout.includes("not found")) {
    throw new Error(
      `Unresolved dynamic dependencies found for ${outputNodePath}\n${stdout}`
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

const listUnixDependencies = async (binaryPath) => {
  if (process.platform === "linux") {
    const { stdout } = await execFile("ldd", [binaryPath], {
      cwd: projectRoot,
      maxBuffer: 1024 * 1024 * 10,
    });

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .map((line) => {
        const match = line.match(/=>\s+(\/[^\s]+)\s+\(/);
        return match ? match[1] : null;
      })
      .filter(Boolean);
  }

  return [];
};

const shouldBundleUnixDependency = (dependencyPath) => {
  const basename = path.basename(dependencyPath);

  return (
    basename.startsWith("libtorrent-rasterbar") ||
    basename.startsWith("libboost_")
  );
};

const copySidecarLibrariesOnUnix = async () => {
  if (process.platform !== "linux") return;

  const dependencies = await listUnixDependencies(outputNodePath);

  for (const dependencyPath of dependencies) {
    if (!shouldBundleUnixDependency(dependencyPath)) continue;
    if (!fs.existsSync(dependencyPath)) continue;

    const targetPath = path.join(outputDir, path.basename(dependencyPath));

    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(dependencyPath, targetPath);
    }
  }
};

const build = async () => {
  const sourceLibraryName = sourceLibraryNameByPlatform[process.platform];

  if (!sourceLibraryName) {
    throw new Error(
      `Unsupported platform for native build: ${process.platform}`
    );
  }

  console.log("Building hydra-native Rust addon (libtorrent)...");

  const cargoArgs = [
    "build",
    "--release",
    "--manifest-path",
    manifestPath,
    "--target-dir",
    cargoTargetDir,
  ];

  await run("cargo", cargoArgs);

  const sourceLibraryPath = path.join(
    cargoTargetDir,
    "release",
    sourceLibraryName
  );

  if (!fs.existsSync(sourceLibraryPath)) {
    throw new Error(`Native build output not found at ${sourceLibraryPath}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.copyFileSync(sourceLibraryPath, outputNodePath);

  await copySidecarLibrariesOnWindows(path.dirname(sourceLibraryPath));
  await copySidecarLibrariesOnUnix();
  await ensureDepsResolvableOnLinux();

  console.log(`Hydra native addon ready at ${outputNodePath}`);
};

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
