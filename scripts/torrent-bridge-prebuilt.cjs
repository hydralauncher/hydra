// Committed builds of the libtorrent bridge, so installs skip compiling
// libtorrent, Boost and OpenSSL through vcpkg. Each bundle records a hash of
// the bridge inputs; a bundle whose hash no longer matches is ignored and the
// bridge is built from source instead.
//
//   node scripts/torrent-bridge-prebuilt.cjs update  Rebuild this platform's bundle
//   node scripts/torrent-bridge-prebuilt.cjs check   Report whether it is current
//   node scripts/torrent-bridge-prebuilt.cjs verify  Fail if any bundle is stale
//
// The "Torrent bridge prebuilts" workflow runs `update` on every platform and
// commits the results. Bundles are skipped when HYDRA_TORRENT_BRIDGE_FROM_SOURCE=1
// or HYDRA_TORRENT_SANITIZE=1, and on Linux systems that cannot load them.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const {
  root,
  source,
  NOTICES,
  getTriplet,
  compileTorrentBridge,
  copyRuntimeLibraries,
  writeDependencyNotices,
  prepareTorrentBridgeOutput,
} = require("./build-torrent-bridge.cjs");

const prebuiltRoot = path.join(source, "prebuilt");
const STAMP = "inputs.sha256";
// Build output and bundles live in the source folder but never shape the binary.
const ignoredSourceDirs = new Set(["build", "prebuilt", "vcpkg_installed"]);

function listInputs() {
  const files = [path.join(__dirname, "build-torrent-bridge.cjs")];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const location = path.join(dir, entry.name);
      if (!entry.isDirectory()) files.push(location);
      else if (dir !== source || !ignoredSourceDirs.has(entry.name))
        walk(location);
    }
  };
  walk(source);
  // Code-unit order, so every machine and locale hashes files the same way.
  return files
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .sort((a, b) => Number(a > b) - Number(a < b));
}

function hashInputs() {
  const hash = crypto.createHash("sha256");
  for (const file of listInputs()) {
    // Line endings depend on the checkout, not on what gets built.
    const content = fs
      .readFileSync(path.join(root, file), "utf8")
      .replaceAll("\r\n", "\n");
    hash.update(`${file}\0${content}\0`);
  }
  return hash.digest("hex");
}

function getBundle() {
  const triplet = getTriplet();
  const dir = path.join(prebuiltRoot, triplet);
  const stampPath = path.join(dir, STAMP);
  const stamp = fs.existsSync(stampPath)
    ? fs.readFileSync(stampPath, "utf8").trim()
    : null;
  return { triplet, dir, stamp, isCurrent: stamp === hashInputs() };
}

// Sanitizer builds and explicit requests need the bridge compiled here.
function isSourceBuildForced() {
  return (
    process.env.HYDRA_TORRENT_BRIDGE_FROM_SOURCE === "1" ||
    process.env.HYDRA_TORRENT_SANITIZE === "1"
  );
}

// The Linux bundle needs the glibc and libstdc++ versions of the image that
// built it; ldd names any this system lacks.
function findMissingLinuxDependencies(dir) {
  if (process.platform !== "linux") return null;
  const ldd = ["/usr/bin/ldd", "/bin/ldd"].find((file) => fs.existsSync(file));
  if (!ldd) return "ldd was not found";
  const library = path.join(dir, "lib", "libhydra_torrent_bridge.so");
  const result = cp.spawnSync(ldd, [library], { encoding: "utf8" });
  const missing = `${result.stdout ?? ""}${result.stderr ?? ""}`
    .split("\n")
    .filter((line) => line.includes("not found"))
    .map((line) => line.trim());
  if (missing.length) return missing.join("; ");
  if (result.error || result.status !== 0) return "ldd could not inspect it";
  return null;
}

// Why this system cannot use its committed bundle, or null when it can.
function getBundleProblem({ triplet, dir, stamp, isCurrent }) {
  if (isSourceBuildForced()) return "a source build was requested";
  if (!stamp) return `there is no prebuilt torrent bridge for ${triplet}`;
  if (!isCurrent)
    return `the prebuilt torrent bridge for ${triplet} is out of date. Run the "Torrent bridge prebuilts" workflow on this branch to refresh it`;
  const missing = findMissingLinuxDependencies(dir);
  if (missing)
    return `this system cannot load the prebuilt torrent bridge (${missing})`;
  return null;
}

function warn(message) {
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message);
}

// Installs the committed bundle into hydra-native and returns the folder to
// link against, or null when the bridge must be built from source.
function installPrebuiltTorrentBridge() {
  const bundle = getBundle();
  const problem = getBundleProblem(bundle);
  if (problem) {
    // A missing bundle or a requested source build is expected; others are not.
    const report = bundle.stamp && !isSourceBuildForced() ? warn : console.log;
    report(`Building the torrent bridge from source: ${problem}.`);
    return null;
  }

  const { triplet, dir } = bundle;

  const output = prepareTorrentBridgeOutput();
  copyRuntimeLibraries(dir, output);
  fs.copyFileSync(path.join(dir, NOTICES), path.join(output, NOTICES));
  console.log(`Using the prebuilt torrent bridge for ${triplet}.`);
  return path.join(dir, "lib");
}

function updatePrebuilt() {
  const { triplet, stage, installed } = compileTorrentBridge();
  const dir = path.join(prebuiltRoot, triplet);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const name of ["bin", "lib"]) {
    const location = path.join(stage, name);
    if (fs.existsSync(location))
      fs.cpSync(location, path.join(dir, name), { recursive: true });
  }
  writeDependencyNotices(installed, triplet, path.join(dir, NOTICES));
  fs.writeFileSync(path.join(dir, STAMP), `${hashInputs()}\n`);
  console.log(`Updated the prebuilt torrent bridge in ${dir}`);
}

function check() {
  const problem = getBundleProblem(getBundle());
  const isCurrent = problem === null;
  console.log(
    isCurrent
      ? "The prebuilt torrent bridge is usable."
      : `Not usable: ${problem}.`
  );
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `current=${isCurrent}\n`);
}

// Fails unless every bundle, whatever its platform, matches the inputs.
function verify() {
  const hash = hashInputs();
  const stale = fs.readdirSync(prebuiltRoot).filter((triplet) => {
    const stampPath = path.join(prebuiltRoot, triplet, STAMP);
    return (
      !fs.existsSync(stampPath) ||
      fs.readFileSync(stampPath, "utf8").trim() !== hash
    );
  });
  if (stale.length) {
    console.error(`Out of date prebuilt torrent bridges: ${stale.join(", ")}`);
    process.exit(1);
  }
  console.log("Every prebuilt torrent bridge matches its inputs.");
}

module.exports = { installPrebuiltTorrentBridge };

if (require.main === module) {
  const command = process.argv[2];
  if (command === "update") updatePrebuilt();
  else if (command === "check") check();
  else if (command === "verify") verify();
  else {
    console.error(
      "Usage: node scripts/torrent-bridge-prebuilt.cjs <update|check|verify>"
    );
    process.exit(1);
  }
}
