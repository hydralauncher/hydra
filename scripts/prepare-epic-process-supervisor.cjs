const { execFile } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const PROTOCOL = 1;
const BINARY_NAME = "hydra-epic-process.exe";
const RECEIPT_NAME = "hydra-epic-process.json";
const BUILD_TIMEOUT_MS = 60_000;

async function hashFile(file) {
  return createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}

async function verifyEpicProcessSupervisor(directory, sourceSha256) {
  try {
    const receipt = JSON.parse(
      await fs.readFile(path.join(directory, RECEIPT_NAME), "utf8")
    );
    return (
      receipt.protocol === PROTOCOL &&
      receipt.fileName === BINARY_NAME &&
      /^[a-f0-9]{64}$/.test(receipt.sha256) &&
      /^[a-f0-9]{64}$/.test(receipt.sourceSha256) &&
      (!sourceSha256 || receipt.sourceSha256 === sourceSha256) &&
      (await hashFile(path.join(directory, BINARY_NAME))) === receipt.sha256
    );
  } catch {
    return false;
  }
}

// electron-builder can sign extraResources before afterPack. Refresh only the
// binary hash after signing, retaining the build's source and protocol identity.
async function writeEpicProcessSupervisorReceipt(directory, sourceSha256) {
  if (!sourceSha256) {
    const previous = JSON.parse(
      await fs.readFile(path.join(directory, RECEIPT_NAME), "utf8")
    );
    if (previous.protocol !== PROTOCOL || previous.fileName !== BINARY_NAME)
      throw new Error("Invalid Epic process supervisor receipt");
    sourceSha256 = previous.sourceSha256;
  }
  if (!/^[a-f0-9]{64}$/.test(sourceSha256))
    throw new Error("Invalid Epic process supervisor source hash");
  const receipt = {
    protocol: PROTOCOL,
    fileName: BINARY_NAME,
    sourceSha256,
    sha256: await hashFile(path.join(directory, BINARY_NAME)),
  };
  await fs.writeFile(
    path.join(directory, RECEIPT_NAME),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { mode: 0o644 }
  );
  return receipt;
}

async function prepareEpicProcessSupervisor({
  projectDir = path.resolve(__dirname, ".."),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  if (platform !== "win32") return null;
  if (arch !== "x64" && arch !== "arm64")
    throw new Error("Unsupported Epic process supervisor architecture");
  const directory = path.join(projectDir, "legendary", platform, arch);
  const source = path.join(
    projectDir,
    "native",
    "windows-epic-process",
    "supervisor.cs"
  );
  const sourceSha256 = await hashFile(source);
  const binaryPath = path.join(directory, BINARY_NAME);
  if (await verifyEpicProcessSupervisor(directory, sourceSha256))
    return { binaryPath, cached: true, protocol: PROTOCOL };
  if (process.platform !== "win32")
    throw new Error("Build the Epic process supervisor on a Windows builder");
  const compiler = path.join(
    process.env.SystemRoot || String.raw`C:\Windows`,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe"
  );
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `supervisor-${randomUUID()}.exe`);
  try {
    await execFileAsync(
      compiler,
      [
        "/nologo",
        "/target:exe",
        "/platform:anycpu",
        "/optimize+",
        "/debug-",
        "/reference:System.Web.Extensions.dll",
        `/out:${temporary}`,
        source,
      ],
      {
        shell: false,
        windowsHide: true,
        timeout: BUILD_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
      }
    );
    const { stdout } = await execFileAsync(temporary, ["--version"], {
      shell: false,
      windowsHide: true,
      timeout: BUILD_TIMEOUT_MS,
      maxBuffer: 1024,
    });
    if (stdout.trim() !== `hydra-epic-process protocol=${PROTOCOL}`)
      throw new Error("Unexpected Epic process supervisor protocol");
    await fs.rename(temporary, binaryPath);
    await writeEpicProcessSupervisorReceipt(directory, sourceSha256);
    if (!(await verifyEpicProcessSupervisor(directory, sourceSha256)))
      throw new Error("Epic process supervisor checksum verification failed");
    return { binaryPath, cached: false, protocol: PROTOCOL };
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

module.exports = {
  prepareEpicProcessSupervisor,
  verifyEpicProcessSupervisor,
  writeEpicProcessSupervisorReceipt,
};

if (require.main === module) {
  prepareEpicProcessSupervisor().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
