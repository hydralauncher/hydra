const { createHash, randomUUID } = require("node:crypto");
const { createReadStream, createWriteStream } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const manifest = require("../src/shared/legendary-manifest.json");

const DOWNLOAD_TIMEOUT_MS = 60_000;
// Build checks allow cold PyInstaller/macOS library validation to complete.
const VERSION_TIMEOUT_MS = 60_000;
const execFileAsync = promisify(execFile);

function getLegendaryArtifact(platform, arch) {
  if (!["linux", "win32", "darwin"].includes(platform)) {
    throw new Error(`Unsupported Legendary platform: ${platform}`);
  }

  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`Unsupported Legendary architecture: ${arch}`);
  }

  const artifact = manifest.artifacts?.[platform]?.[arch];
  if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
    throw new Error(`Invalid Legendary artifact manifest: ${platform}/${arch}`);
  }

  return artifact;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function hasExpectedChecksum(filePath, expectedChecksum) {
  try {
    return (await sha256File(filePath)) === expectedChecksum;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function downloadVerifiedArtifact(
  artifact,
  filePath,
  executable = false
) {
  if (await hasExpectedChecksum(filePath, artifact.sha256)) {
    if (executable) await fs.chmod(filePath, 0o755);
    return true;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.download-${randomUUID()}`;

  try {
    const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const response = await fetch(artifact.url, { signal });

    if (!response.ok || !response.body)
      throw new Error(`Legendary download failed: HTTP ${response.status}`);

    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
      { signal }
    );

    if (!(await hasExpectedChecksum(temporaryPath, artifact.sha256)))
      throw new Error("Legendary runtime checksum mismatch");

    if (executable) await fs.chmod(temporaryPath, 0o755);
    try {
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      // A concurrent preparation may have installed the same verified artifact.
      if (!(await hasExpectedChecksum(filePath, artifact.sha256))) throw error;
    }
    return false;
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function prepareLegendary({
  projectDir = path.resolve(__dirname, ".."),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const artifact = getLegendaryArtifact(platform, arch);
  if (platform === "linux") {
    const { prepareLinuxLegendary } = require("./legendary-linux-runtime.cjs");
    return prepareLinuxLegendary({
      projectDir,
      arch,
      artifact,
      download: downloadVerifiedArtifact,
      sha256File,
    });
  }

  const binaryPath = path.join(
    projectDir,
    "legendary",
    platform,
    arch,
    artifact.fileName
  );
  const cached = await downloadVerifiedArtifact(
    artifact,
    binaryPath,
    platform === "darwin"
  );
  return { binaryPath, cached, platform, arch };
}

async function verifyLegendaryVersion(
  binaryPath,
  expectedVersion = manifest.version
) {
  const { stdout } = await execFileAsync(binaryPath, ["--version"], {
    shell: false,
    windowsHide: true,
    timeout: VERSION_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
  });
  const version = /legendary version ["']([^"']+)["']/i.exec(stdout)?.[1];
  if (version !== expectedVersion) {
    throw new Error(`Unexpected Legendary version: ${version || "unknown"}`);
  }
  return version;
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name !== "--platform" && name !== "--arch") {
      throw new Error(`Unknown Legendary preparation argument: ${name}`);
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${name}`);
    }
    options[name.slice(2)] = value;
  }
  return options;
}

async function main() {
  const result = await prepareLegendary(parseArguments(process.argv.slice(2)));
  // Never execute a foreign-platform/architecture binary on the build machine.
  if (result.platform === process.platform && result.arch === process.arch) {
    await verifyLegendaryVersion(result.binaryPath);
  }
  console.log(
    `Legendary ${manifest.version} prepared for ${result.platform}/${result.arch}${result.cached ? " (cache verified)" : ""}.`
  );
}

module.exports = {
  getLegendaryArtifact,
  prepareLegendary,
  sha256File,
  verifyLegendaryVersion,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
