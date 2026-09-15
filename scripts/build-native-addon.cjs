const path = require("node:path");

const { buildCargoRelease } = require("./lib/native-build.cjs");

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

const sourceLibraryNameByPlatform = {
  linux: "libhydra_native.so",
  darwin: "libhydra_native.dylib",
  win32: "hydra_native.dll",
};

// The loader (src/main/services/native-addon.ts) requires a `.node` module at
// hydra-native/hydra-native.node, so the cargo artifact must be renamed on copy.
const outputLibraryName = "hydra-native.node";

const build = async () => {
  const sourceLibraryName = sourceLibraryNameByPlatform[process.platform];

  if (!sourceLibraryName) {
    throw new Error(
      `Unsupported platform for native build: ${process.platform}`
    );
  }

  console.log("Building hydra-native Rust addon...");

  const outputBinaryPath = await buildCargoRelease({
    manifestPath,
    targetDirectory: cargoTargetDir,
    sourceBinaryName: sourceLibraryName,
    outputBinaryName: outputLibraryName,
    outputDirectory: outputDir,
  });

  console.log(`Hydra native addon ready at ${outputBinaryPath}`);
};

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
