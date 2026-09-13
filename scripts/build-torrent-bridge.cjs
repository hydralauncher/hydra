const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const os = require("node:os");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "native", "torrent-bridge");
const manifest = require(path.join(source, "vcpkg.json"));
const baseline = manifest["builtin-baseline"];
const run = (command, args, options = {}) => {
  const result = cp.spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status})`);
};

function resolveCmakeTools(vcpkgExecutable) {
  // vcpkg fetch prints the executable path after any download progress. Use
  // its tool bundle so CMake and CTest need not be installed on PATH.
  console.log("Resolving CMake through vcpkg...");
  const result = cp.spawnSync(vcpkgExecutable, ["fetch", "cmake"], {
    cwd: path.dirname(vcpkgExecutable),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to obtain CMake through vcpkg: ${result.error?.message || result.stdout?.trim() || `exit ${result.status}`}`
    );
  }
  const cmake = result.stdout.trim().split(/\r?\n/).at(-1);
  const ctest = path.join(
    path.dirname(cmake || ""),
    process.platform === "win32" ? "ctest.exe" : "ctest"
  );
  if (
    !cmake ||
    !path.isAbsolute(cmake) ||
    !fs.existsSync(cmake) ||
    !fs.existsSync(ctest)
  ) {
    throw new Error(
      `vcpkg returned an incomplete CMake/CTest bundle: ${result.stdout.trim()}`
    );
  }
  return { cmake, ctest };
}

function buildTorrentBridge() {
  // Never use an unpinned system libtorrent. Cache the package manager itself
  // at the manifest baseline, which also locks Boost, OpenSSL and WebRTC.
  const cache =
    process.env.HYDRA_NATIVE_CACHE ||
    path.join(os.homedir(), ".cache", "hydra");
  const vcpkg = path.join(cache, `v-${baseline.slice(0, 8)}`);
  if (!fs.existsSync(path.join(vcpkg, ".git"))) {
    fs.mkdirSync(vcpkg, { recursive: true });
    run("git", ["init", vcpkg]);
  }
  const current = cp.spawnSync("git", ["-C", vcpkg, "rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (current.status !== 0 || current.stdout.trim() !== baseline) {
    run("git", [
      "-C",
      vcpkg,
      "fetch",
      "--depth=1",
      "https://github.com/microsoft/vcpkg.git",
      baseline,
    ]);
    run("git", ["-C", vcpkg, "checkout", "--detach", baseline]);
  }
  const executable = path.join(
    vcpkg,
    process.platform === "win32" ? "vcpkg.exe" : "vcpkg"
  );
  if (!fs.existsSync(executable)) {
    if (process.platform === "win32") {
      run("cmd.exe", ["/d", "/c", "bootstrap-vcpkg.bat", "-disableMetrics"], {
        cwd: vcpkg,
      });
    } else {
      run(path.join(vcpkg, "bootstrap-vcpkg.sh"), ["-disableMetrics"]);
    }
  }
  const { cmake, ctest } = resolveCmakeTools(executable);
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (!["x64", "arm64"].includes(process.arch))
    throw new Error(`Unsupported architecture: ${process.arch}`);
  const platform = {
    win32: "windows-static",
    linux: "linux",
    darwin: "osx",
  }[process.platform];
  if (!platform) throw new Error(`Unsupported platform: ${process.platform}`);
  const generatorArgs = [];
  if (process.platform === "win32") {
    let generator = process.env.CMAKE_GENERATOR;
    if (!generator) {
      const vswhere = path.join(
        process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
        "Microsoft Visual Studio",
        "Installer",
        "vswhere.exe"
      );
      const discovery = cp.spawnSync(
        vswhere,
        [
          "-latest",
          "-products",
          "*",
          "-requires",
          "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
          "-format",
          "json",
        ],
        { encoding: "utf8", windowsHide: true }
      );
      if (discovery.error || discovery.status !== 0) {
        throw new Error(
          "Install Visual Studio C++ Build Tools with the Desktop development with C++ workload."
        );
      }
      const installation = JSON.parse(discovery.stdout)[0];
      if (!installation?.catalog?.productLineVersion) {
        throw new Error(
          "No Visual Studio C++ toolchain found. Install the Desktop development with C++ workload."
        );
      }
      generator = `Visual Studio ${installation.installationVersion.split(".")[0]} ${installation.catalog.productLineVersion}`;
    }
    generatorArgs.push("-G", generator);
    if (generator.startsWith("Visual Studio ")) {
      generatorArgs.push("-A", arch === "arm64" ? "ARM64" : "x64");
    }
  }
  const triplet = `${arch}-${platform}`;
  const build = path.join(
    source,
    "build",
    `${triplet}-${baseline.slice(0, 8)}`
  );
  const stage = path.join(build, "stage");
  const installed = path.join(cache, `i-${baseline.slice(0, 8)}`);
  run(cmake, [
    "--fresh",
    "-S",
    source,
    "-B",
    build,
    ...generatorArgs,
    `-DCMAKE_TOOLCHAIN_FILE=${path.join(vcpkg, "scripts", "buildsystems", "vcpkg.cmake")}`,
    `-DVCPKG_INSTALLED_DIR=${installed}`,
    `-DVCPKG_TARGET_TRIPLET=${triplet}`,
    "-DCMAKE_BUILD_TYPE=Release",
    `-DHYDRA_TORRENT_SANITIZE=${process.env.HYDRA_TORRENT_SANITIZE === "1" ? "ON" : "OFF"}`,
    `-DCMAKE_INSTALL_PREFIX=${stage}`,
  ]);
  run(cmake, ["--build", build, "--config", "Release", "--parallel"]);
  run(ctest, ["--test-dir", build, "-C", "Release", "--output-on-failure"]);
  run(cmake, ["--install", build, "--config", "Release"]);

  const output = path.join(root, "hydra-native");
  fs.mkdirSync(output, { recursive: true });
  for (const dir of ["bin", "lib"]) {
    const location = path.join(stage, dir);
    if (!fs.existsSync(location)) continue;
    for (const name of fs.readdirSync(location)) {
      if (/\.(dll|dylib|so)(\.\d+)*$/.test(name))
        fs.copyFileSync(path.join(location, name), path.join(output, name));
    }
  }
  const share = path.join(installed, triplet, "share");
  const licenses = path.join(output, "licenses");
  fs.mkdirSync(licenses, { recursive: true });
  for (const name of fs.readdirSync(share)) {
    const copyright = path.join(share, name, "copyright");
    if (fs.existsSync(copyright))
      fs.copyFileSync(copyright, path.join(licenses, `${name}.txt`));
  }
  fs.copyFileSync(
    path.join(source, "vcpkg.json"),
    path.join(output, "torrent-dependencies.json")
  );
  return path.join(stage, "lib");
}

module.exports = { buildTorrentBridge };
if (require.main === module) buildTorrentBridge();
