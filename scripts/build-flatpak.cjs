/**
 * Builds the Flatpak from the hand-authored flatpak-builder manifest
 * (flatpak/gg.hydralauncher.hydra.yaml) and exports a single-file bundle to
 * dist/.
 *
 * We use flatpak-builder instead of electron-builder's flatpak target because
 * the manifest declares the Compat.i386 / GL32 runtime extensions that Proton's
 * pressure-vessel needs inside the sandbox — something electron-builder's
 * flatpak options can't express.
 *
 * Prerequisite: dist/linux-unpacked must already exist (run `electron-builder
 * --linux dir` first; `npm run build:flatpak` does both).
 *
 * flatpak-builder's scratch dirs (build dir, OSTree repo, and the
 * `.flatpak-builder` state/cache) are kept OUTSIDE the repo: they contain full
 * runtime payloads with unreadable entries (e.g. /var/run sockets) that break
 * electron-builder's project scan if it later walks the working tree.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const manifest = path.join(repoRoot, "flatpak", "gg.hydralauncher.hydra.yaml");
const appId = "gg.hydralauncher.hydra";
const branch = "stable";

const distDir = path.join(repoRoot, "dist");

// Scratch dirs live under the system temp dir, not the repo (see header).
const scratch = path.join(os.tmpdir(), "hydra-flatpak-build");
const buildDir = path.join(scratch, "build");
const repoDir = path.join(scratch, "repo");
const stateDir = path.join(scratch, "state");

const { version } = require(path.join(repoRoot, "package.json"));
const bundlePath = path.join(distDir, `hydralauncher-${version}.flatpak`);

const run = (cmd, args) => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: repoRoot });
};

if (!fs.existsSync(path.join(distDir, "linux-unpacked", "hydralauncher"))) {
  console.error(
    "dist/linux-unpacked is missing. Run `electron-builder --linux dir` first."
  );
  process.exit(1);
}

// cx_Freeze bundles the *build host's* glibc into the Python RPC. That breaks
// two ways inside the Flatpak: at runtime the host glibc can be newer than the
// runtime's (the `__tunable_is_initialized` GLIBC_PRIVATE crash), and at build
// time the copied files can be read-only (e.g. from the Nix store), which makes
// flatpak-builder's eu-strip fail with "Permission denied". Drop the
// version-locked glibc family so the RPC uses the runtime's loader instead; the
// frozen interpreter + libtorrent only need <= GLIBC_2.17, far below any
// runtime, so this is safe on every build host.
const stripBundledGlibc = () => {
  const GLIBC_LIBS = [
    "ld-linux-x86-64.so.2",
    "libc.so.6",
    "libdl.so.2",
    "libm.so.6",
    "libpthread.so.0",
    "librt.so.1",
    "libutil.so.1",
  ];
  const rpcLib = path.join(
    distDir,
    "linux-unpacked",
    "resources",
    "hydra-python-rpc",
    "lib"
  );
  for (const dir of [rpcLib, path.join(rpcLib, "libtorrent")]) {
    for (const lib of GLIBC_LIBS) {
      const target = path.join(dir, lib);
      if (fs.existsSync(target)) {
        fs.rmSync(target);
        console.log(`stripped bundled glibc: ${path.relative(repoRoot, target)}`);
      }
    }
  }
};

stripBundledGlibc();

fs.mkdirSync(scratch, { recursive: true });

// Build the app into a local OSTree repo, pulling the runtime/sdk/base and the
// declared extensions from Flathub as needed.
run("flatpak-builder", [
  "--user",
  "--force-clean",
  "--install-deps-from=flathub",
  `--state-dir=${stateDir}`,
  `--repo=${repoDir}`,
  buildDir,
  manifest,
]);

// Export the repo branch as a single .flatpak the release pipeline can publish.
fs.mkdirSync(distDir, { recursive: true });
run("flatpak", ["build-bundle", repoDir, bundlePath, appId, branch]);

console.log(
  `\nFlatpak bundle written to ${path.relative(repoRoot, bundlePath)}`
);
