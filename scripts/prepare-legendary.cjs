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
// The launcher service keeps its separate 15-second timeout.
const VERSION_TIMEOUT_MS = 60_000;
const execFileAsync = promisify(execFile);

function getLegendaryArtifact(platform, arch, artifactManifest = manifest) {
  if (platform === "linux") return null;
  if (platform !== "win32" && platform !== "darwin") {
    throw new Error(`Unsupported Legendary platform: ${platform}`);
  }
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`Unsupported Legendary architecture: ${arch}`);
  }
  const artifact = artifactManifest.artifacts[platform][arch];
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

async function prepareLegendary({
  projectDir = path.resolve(__dirname, ".."),
  platform = process.platform,
  arch = process.arch,
  artifactManifest = manifest,
  fetchImpl = global.fetch,
} = {}) {
  const artifact = getLegendaryArtifact(platform, arch, artifactManifest);
  // Linux must not touch the filesystem or network, including a foreign cache.
  if (!artifact) return { skipped: true, platform, arch };

  const directory = path.join(projectDir, "legendary", platform, arch);
  const binaryPath = path.join(directory, artifact.fileName);
  if (await hasExpectedChecksum(binaryPath, artifact.sha256)) {
    if (platform === "darwin") await fs.chmod(binaryPath, 0o755);
    return { skipped: false, binaryPath, cached: true, platform, arch };
  }

  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.download-${randomUUID()}`);
  try {
    const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const response = await fetchImpl(artifact.url, { signal });
    if (!response.ok || !response.body) {
      throw new Error(`Legendary download failed: HTTP ${response.status}`);
    }
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporaryPath, { flags: "wx", mode: 0o755 }),
      { signal }
    );
    if (!(await hasExpectedChecksum(temporaryPath, artifact.sha256))) {
      throw new Error(`Legendary checksum mismatch: ${platform}/${arch}`);
    }
    if (platform === "darwin") await fs.chmod(temporaryPath, 0o755);
    try {
      await fs.rename(temporaryPath, binaryPath);
    } catch (error) {
      // Another preparation may have atomically installed the same artifact.
      if (!(await hasExpectedChecksum(binaryPath, artifact.sha256)))
        throw error;
    }
    return { skipped: false, binaryPath, cached: false, platform, arch };
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
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
  if (result.skipped) {
    console.log("Legendary preparation skipped on Linux.");
    return;
  }
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
  hasExpectedChecksum,
  verifyLegendaryVersion,
  parseArguments,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
