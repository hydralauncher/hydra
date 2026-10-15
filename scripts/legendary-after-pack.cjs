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
const {
  verifyManagedRuntime,
  writeManagedRuntimeReceipt,
} = require("./legendary-managed-runtime.cjs");
const {
  writeEpicProcessSupervisorReceipt,
  verifyEpicProcessSupervisor,
} = require("./prepare-epic-process-supervisor.cjs");
const {
  verifyEpicPrerequisiteRunner,
} = require("./build-epic-prerequisite-runner.cjs");

async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = Arch[context.arch];
  if (
    platform === "linux" &&
    !(await verifyEpicPrerequisiteRunner({
      projectDir: context.packager.projectDir,
      directory: path.join(
        context.packager.getResourcesDir(context.appOutDir),
        "epic"
      ),
    }))
  )
    throw new Error(
      "Packaged Epic prerequisite supervisor is missing or invalid"
    );
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
  if (platform === "win32")
    await writeManagedRuntimeReceipt(path.dirname(binaryPath), sha256File);
  if (
    ["linux", "win32"].includes(platform) &&
    !(await verifyManagedRuntime(
      path.dirname(binaryPath),
      undefined,
      sha256File
    ))
  )
    throw new Error(
      `Packaged targeted Legendary runtime is incomplete: ${platform}/${arch}`
    );
  if (platform === "win32") {
    await writeEpicProcessSupervisorReceipt(path.dirname(binaryPath));
    if (!(await verifyEpicProcessSupervisor(path.dirname(binaryPath))))
      throw new Error("Packaged Epic process supervisor is incomplete");
  }
  if (platform === process.platform && arch === process.arch) {
    await verifyLegendaryVersion(binaryPath, manifest.version);
  }
}

module.exports = afterPack;
