const path = require("node:path");

const { buildCargoRelease } = require("./lib/native-build.cjs");

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

  const outputBinaryPath = await buildCargoRelease({
    manifestPath,
    targetDirectory: cargoTargetDir,
    sourceBinaryName,
    outputDirectory: outputDir,
  });

  console.log(`Hydra stream sidecar ready at ${outputBinaryPath}`);
};

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
