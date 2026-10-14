const path = require("node:path");
const fs = require("node:fs/promises");
const manifest = require("../src/shared/legendary-manifest.json");
const {
  getLegendaryArtifact,
  verifyLegendaryVersion,
  sha256File,
} = require("./prepare-legendary.cjs");
const { verifyLinuxRuntime } = require("./legendary-linux-runtime.cjs");
const { Arch } = require("builder-util");

async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = Arch[context.arch];
  const artifact = getLegendaryArtifact(platform, arch);

  const binaryPath = path.join(
    context.packager.getResourcesDir(context.appOutDir),
    "legendary",
    artifact.fileName
  );
  // Windows signs extraResources while copying them, before afterPack. The
  // upstream checksum was checked by beforePack; signed bytes may differ here.
  if (!(await fs.stat(binaryPath)).isFile()) {
    throw new Error(
      `Packaged Legendary executable missing: ${platform}/${arch}`
    );
  }
  if (
    platform === "linux" &&
    !(await verifyLinuxRuntime(path.dirname(binaryPath), undefined, sha256File))
  )
    throw new Error(`Packaged Legendary runtime is incomplete: linux/${arch}`);
  if (platform === process.platform && arch === process.arch) {
    await verifyLegendaryVersion(binaryPath, manifest.version);
  }
}

module.exports = afterPack;
