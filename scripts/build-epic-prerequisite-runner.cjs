const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const TARGET = "x86_64-pc-windows-gnu";
const FILE_NAME = "epic-prerequisite-runner.exe";
const MANIFEST_NAME = ".build.json";
const SOURCE_DIRECTORY = "native/epic-prerequisite-runner";
const OUTPUT_DIRECTORY = "binaries/epic-prerequisite-runner/x64";

async function sourceDigest(projectDir) {
  const directory = path.join(projectDir, SOURCE_DIRECTORY);
  const files = ["Cargo.toml", "Cargo.lock"];
  async function walk(relative) {
    for (const entry of await fs.readdir(path.join(directory, relative), {
      withFileTypes: true,
    })) {
      const file = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Invalid supervisor source");
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  await walk("src");
  const digest = crypto.createHash("sha256");
  for (const file of files.sort()) {
    digest.update(file).update("\0");
    digest.update(await fs.readFile(path.join(directory, file))).update("\0");
  }
  return digest.digest("hex");
}

function verifyPe(bytes) {
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") return false;
  const offset = bytes.readUInt32LE(60);
  return (
    offset + 26 <= bytes.length &&
    bytes.toString("ascii", offset, offset + 4) === "PE\0\0" &&
    bytes.readUInt16LE(offset + 4) === 0x8664 &&
    bytes.readUInt16LE(offset + 24) === 0x20b
  );
}

async function verifyEpicPrerequisiteRunner({ projectDir, directory }) {
  try {
    const binary = path.join(directory, FILE_NAME);
    const stat = await fs.lstat(binary);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const manifest = JSON.parse(
      await fs.readFile(path.join(directory, MANIFEST_NAME), "utf8")
    );
    const bytes = await fs.readFile(binary);
    return (
      manifest.schemaVersion === 1 &&
      manifest.target === TARGET &&
      manifest.sourceSha256 === (await sourceDigest(projectDir)) &&
      manifest.sha256 ===
        crypto.createHash("sha256").update(bytes).digest("hex") &&
      verifyPe(bytes)
    );
  } catch {
    return false;
  }
}

async function buildEpicPrerequisiteRunner({
  projectDir = path.resolve(__dirname, ".."),
  force = false,
} = {}) {
  const directory = path.join(projectDir, OUTPUT_DIRECTORY);
  if (!force && (await verifyEpicPrerequisiteRunner({ projectDir, directory })))
    return directory;
  const source = path.join(projectDir, SOURCE_DIRECTORY);
  const rustflags = [
    `--remap-path-prefix=${projectDir}=/hydra`,
    "-C",
    "link-arg=-Wl,--no-insert-timestamp",
  ].join("\x1f");
  const result = spawnSync(
    "cargo",
    [
      "build",
      "--locked",
      "--release",
      "--target",
      TARGET,
      "--manifest-path",
      path.join(source, "Cargo.toml"),
      "--bin",
      "epic-prerequisite-runner",
    ],
    {
      cwd: projectDir,
      stdio: "inherit",
      env: {
        ...process.env,
        CARGO_INCREMENTAL: "0",
        CARGO_ENCODED_RUSTFLAGS: rustflags,
        SOURCE_DATE_EPOCH: "0",
        CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER:
          process.env.CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER ??
          "x86_64-w64-mingw32-gcc",
      },
    }
  );
  if (result.error || result.status !== 0)
    throw new Error("Epic prerequisite supervisor build failed");
  const bytes = await fs.readFile(
    path.join(source, "target", TARGET, "release", FILE_NAME)
  );
  if (!verifyPe(bytes))
    throw new Error("Invalid Epic prerequisite supervisor PE");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, FILE_NAME), bytes);
  await fs.writeFile(
    path.join(directory, MANIFEST_NAME),
    JSON.stringify({
      schemaVersion: 1,
      target: TARGET,
      sourceSha256: await sourceDigest(projectDir),
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    }) + "\n"
  );
  if (!(await verifyEpicPrerequisiteRunner({ projectDir, directory })))
    throw new Error("Epic prerequisite supervisor integrity failed");
  return directory;
}

module.exports = {
  buildEpicPrerequisiteRunner,
  verifyEpicPrerequisiteRunner,
  sourceDigest,
  verifyPe,
  TARGET,
  FILE_NAME,
  MANIFEST_NAME,
  SOURCE_DIRECTORY,
  OUTPUT_DIRECTORY,
};
if (require.main === module)
  buildEpicPrerequisiteRunner().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
