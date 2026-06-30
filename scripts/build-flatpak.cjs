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
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const manifest = path.join(repoRoot, "flatpak", "gg.hydralauncher.hydra.yaml");
const appId = "gg.hydralauncher.hydra";
const branch = "stable";

const buildDir = path.join(repoRoot, ".flatpak-builder-build");
const repoDir = path.join(repoRoot, ".flatpak-repo");
const distDir = path.join(repoRoot, "dist");

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

// Build the app into a local OSTree repo, pulling the runtime/sdk/base and the
// declared extensions from Flathub as needed.
run("flatpak-builder", [
  "--user",
  "--force-clean",
  "--install-deps-from=flathub",
  `--repo=${repoDir}`,
  buildDir,
  manifest,
]);

// Export the repo branch as a single .flatpak the release pipeline can publish.
fs.mkdirSync(distDir, { recursive: true });
run("flatpak", ["build-bundle", repoDir, bundlePath, appId, branch]);

console.log(`\nFlatpak bundle written to ${path.relative(repoRoot, bundlePath)}`);
