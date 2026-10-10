// Committed builds of the libtorrent bridge, so installs skip compiling
// libtorrent, Boost and OpenSSL through vcpkg. Each bundle records a hash of
// the bridge inputs; a bundle whose hash no longer matches is ignored and the
// bridge is built from source instead.
//
//   node scripts/torrent-bridge-prebuilt.cjs update  Rebuild this platform's bundle
//   node scripts/torrent-bridge-prebuilt.cjs check   Report whether it is current
//
// The "Torrent bridge prebuilts" workflow runs `update` on every platform and
// commits the results. Set HYDRA_TORRENT_BRIDGE_FROM_SOURCE=1 to ignore bundles.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
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
  return files
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .sort();
}

function hashInputs() {
  const hash = crypto.createHash("sha256");
  for (const file of listInputs()) {
    // Line endings depend on the checkout, not on what gets built.
    const content = fs
      .readFileSync(path.join(root, file), "utf8")
      .replace(/\r\n/g, "\n");
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

function warn(message) {
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message);
}

// Installs the committed bundle into hydra-native and returns the folder to
// link against, or null when the bridge must be built from source.
function usePrebuiltTorrentBridge() {
  if (process.env.HYDRA_TORRENT_BRIDGE_FROM_SOURCE === "1") return null;

  const { triplet, dir, stamp, isCurrent } = getBundle();
  if (!stamp) {
    console.log(`No prebuilt torrent bridge for ${triplet}.`);
    return null;
  }
  if (!isCurrent) {
    warn(
      `The prebuilt torrent bridge for ${triplet} is out of date, so it is being built from source. Run the "Torrent bridge prebuilts" workflow on this branch to refresh it.`
    );
    return null;
  }

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
  const { triplet, isCurrent } = getBundle();
  console.log(
    `Prebuilt torrent bridge for ${triplet}: ${isCurrent ? "current" : "missing or out of date"}`
  );
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `current=${isCurrent}\n`);
}

module.exports = { usePrebuiltTorrentBridge };

if (require.main === module) {
  const command = process.argv[2];
  if (command === "update") updatePrebuilt();
  else if (command === "check") check();
  else {
    console.error(
      "Usage: node scripts/torrent-bridge-prebuilt.cjs <update|check>"
    );
    process.exit(1);
  }
}
