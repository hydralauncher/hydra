const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");
const childProcess = require("node:child_process");
const { buildTorrentBridge } = require("./build-torrent-bridge.cjs");

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

const copySidecarLibrariesOnWindows = async () => {
  if (process.platform !== "win32") return;

  const vswhere = path.join(
    process.env["ProgramFiles(x86)"] || String.raw`C:\Program Files (x86)`,
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe"
  );
  const { stdout } = await execFile(
    vswhere,
    [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-find",
      `VC/Redist/MSVC/*/${process.arch}/Microsoft.VC*.CRT/*.dll`,
    ],
    { windowsHide: true }
  );
  const redist = stdout.trim().split(/\r?\n/).filter(Boolean);
  if (
    !redist.some(
      (file) => path.basename(file).toLowerCase() === "vcruntime140.dll"
    )
  ) {
    throw new Error(
      "Visual C++ redistributable DLLs were not found in Build Tools; repair the C++ workload before packaging."
    );
  }
  for (const file of redist) {
    fs.copyFileSync(file, path.join(outputDir, path.basename(file)));
  }
};

const build = async () => {
  const sourceLibraryName = sourceLibraryNameByPlatform[process.platform];

  if (!sourceLibraryName) {
    throw new Error(
      `Unsupported platform for native build: ${process.platform}`
    );
  }

  const target =
    process.platform === "win32"
      ? { x64: "x86_64-pc-windows-msvc", arm64: "aarch64-pc-windows-msvc" }[
          process.arch
        ]
      : undefined;
  if (process.platform === "win32" && !target) {
    throw new Error(`Unsupported Windows architecture: ${process.arch}`);
  }

  console.log("Building hydra-native Rust addon...");
  const torrentLibraryDir = buildTorrentBridge();

  const cargoArgs = [
    "build",
    "--release",
    ...(target ? ["--target", target] : []),
    "--manifest-path",
    manifestPath,
    "--target-dir",
    cargoTargetDir,
  ];

  await run("cargo", cargoArgs, {
    env: { ...process.env, HYDRA_TORRENT_LIB_DIR: torrentLibraryDir },
  });

  const sourceLibraryPath = path.join(
    cargoTargetDir,
    ...(target ? [target] : []),
    "release",
    sourceLibraryName
  );

  if (!fs.existsSync(sourceLibraryPath)) {
    throw new Error(`Native build output not found at ${sourceLibraryPath}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.copyFileSync(sourceLibraryPath, outputNodePath);

  await copySidecarLibrariesOnWindows();
  await ensureDepsResolvableOnLinux();

  // Verify with the actual application runtime, not a potentially incompatible
  // system Node.js. Fail installation before the user opens the download UI.
  await run(
    require("electron"),
    [
      "-e",
      "try { require(process.argv[1]); } catch (error) { console.error('Electron cannot load the native addon:', error.message); process.exit(1); }",
      outputNodePath,
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: 30000,
      windowsHide: true,
    }
  );

  console.log(`Hydra native addon ready at ${outputNodePath}`);
};

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
