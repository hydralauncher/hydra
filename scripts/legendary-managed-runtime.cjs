const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { inflateRawSync } = require("node:zlib");
const manifest = require("../src/shared/legendary-manifest.json");

const INDEX = "managed-runtime.json";
const templates = path.resolve(__dirname, "../resources/legendary");
const preparationQueues = new Map();

// Only pinned public archives enter this extractor. Central-directory sizes
// support the data-descriptor ZIPs emitted by official wheel/zipapp builders.
async function extractZip(archive, directory, accept = () => true) {
  const data = await fs.readFile(archive);
  let end = data.length - 22;
  while (end >= Math.max(0, data.length - 65557)) {
    if (data.readUInt32LE(end) === 0x06054b50) break;
    end--;
  }
  if (end < 0 || data.readUInt32LE(end) !== 0x06054b50)
    throw new Error("Invalid managed runtime archive");
  const count = data.readUInt16LE(end + 10);
  let offset = data.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    if (data.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("Invalid managed runtime archive entry");
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const size = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const local = data.readUInt32LE(offset + 42);
    const name = data
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString();
    offset += 46 + nameLength + extraLength + commentLength;
    if (!accept(name) || name.endsWith("/")) continue;
    const output = path.resolve(directory, name);
    if (
      name.includes("\\") ||
      !output.startsWith(`${path.resolve(directory)}${path.sep}`)
    )
      throw new Error("Managed runtime archive contains an unsafe path");
    if (data.readUInt32LE(local) !== 0x04034b50)
      throw new Error("Invalid managed runtime local entry");
    const start =
      local +
      30 +
      data.readUInt16LE(local + 26) +
      data.readUInt16LE(local + 28);
    const compressed = data.subarray(start, start + compressedSize);
    const bytes =
      method === 0
        ? compressed
        : method === 8
          ? inflateRawSync(compressed)
          : null;
    if (!bytes || bytes.length !== size)
      throw new Error("Invalid managed runtime archive compression");
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, bytes);
  }
}

async function fileEntries(directory, sha256File) {
  const files = [];
  async function visit(relative) {
    const absolute = path.join(directory, relative);
    const info = await fs.lstat(absolute);
    if (info.isDirectory()) {
      const names = (await fs.readdir(absolute)).sort();
      for (const name of names) await visit(path.posix.join(relative, name));
    } else if (info.isFile()) {
      files.push({ name: relative, sha256: await sha256File(absolute) });
    } else throw new Error("Managed runtime has an unsupported file");
  }
  for (const name of [
    "managed.py",
    "managed-legendary.pyz",
    "managed-native",
    "python",
  ]) {
    // Linux's existing private Python has its own complete checksum receipt.
    if (
      name === "python" &&
      !(await fs
        .stat(path.join(directory, name, "python.exe"))
        .catch(() => null))
    )
      continue;
    await visit(name);
  }
  return files;
}

async function verifyManagedRuntime(directory, fingerprint, sha256File) {
  try {
    const index = JSON.parse(
      await fs.readFile(path.join(directory, INDEX), "utf8")
    );
    if (
      index.protocolVersion !== manifest.managedRuntime.protocolVersion ||
      index.legendaryVersion !== manifest.version ||
      (fingerprint && index.fingerprint !== fingerprint)
    )
      return false;
    if (
      !Array.isArray(index.files) ||
      !index.files.some((file) => file.name === "managed.py") ||
      !index.files.some((file) => file.name === "managed-legendary.pyz")
    )
      return false;
    return (
      JSON.stringify(await fileEntries(directory, sha256File)) ===
      JSON.stringify(index.files)
    );
  } catch (error) {
    if (error.code === "EACCES" || error.code === "EPERM") throw error;
    return false;
  }
}

async function writeManagedRuntimeReceipt(directory, sha256File) {
  const indexPath = path.join(directory, INDEX);
  const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  // Windows packaging can sign the private interpreter/DLLs while copying
  // resources. Only those PE files may differ from beforePack's verified bytes.
  for (const file of index.files) {
    if (/\.(exe|dll|pyd)$/i.test(file.name))
      file.sha256 = await sha256File(path.join(directory, file.name));
  }
  await fs.writeFile(indexPath, JSON.stringify(index));
}

async function prepareBundle({
  projectDir,
  platform,
  arch,
  download,
  sha256File,
}) {
  if (!["linux", "win32"].includes(platform)) return;
  if (!["x64", "arm64"].includes(arch))
    throw new Error("Unsupported managed runtime architecture");
  const config = manifest.managedRuntime;
  const windows = platform === "win32" ? config.windows[arch] : null;
  if (platform === "win32" && !windows)
    throw new Error("Unsupported managed runtime architecture");
  const directory = path.join(projectDir, "legendary", platform, arch);
  const script = await fs.readFile(path.join(templates, "managed.py"));
  const scriptHash = createHash("sha256").update(script).digest("hex");
  if (scriptHash !== config.adapterSha256)
    throw new Error("Managed Legendary adapter checksum mismatch");
  const artifact = manifest.artifacts.linux[arch];
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ format: 2, config, platform, arch, artifact }))
    .digest("hex");
  if (await verifyManagedRuntime(directory, fingerprint, sha256File)) return;
  const downloads = path.join(projectDir, "legendary", ".downloads", arch);
  await fs.mkdir(directory, { recursive: true });
  const zipapp = path.join(downloads, `${artifact.sha256}.pyz`);
  await download(artifact, zipapp);
  await fs.copyFile(zipapp, path.join(directory, "managed-legendary.pyz"));
  await fs.writeFile(path.join(directory, "managed.py"), script);
  const native = path.join(directory, "managed-native");
  // Rebuild private, generated directories only, after checking their absolute
  // containment. Stale bytecode or native modules must never survive upgrades.
  for (const name of windows
    ? ["managed-native", "python"]
    : ["managed-native"]) {
    const generated = path.resolve(directory, name);
    if (!generated.startsWith(`${path.resolve(directory)}${path.sep}`))
      throw new Error("Invalid managed runtime directory");
    await fs.rm(generated, { force: true, recursive: true });
  }
  await fs.mkdir(native, { recursive: true });
  if (windows) {
    const python = path.join(downloads, `${windows.python.sha256}.zip`);
    const crypto = path.join(downloads, `${windows.crypto.sha256}.whl`);
    await download(windows.python, python);
    await download(windows.crypto, crypto);
    await extractZip(python, path.join(directory, "python"));
    await extractZip(
      crypto,
      native,
      (name) => name.startsWith("Cryptodome/") || name.includes(".dist-info/")
    );
  } else {
    await extractZip(zipapp, native, (name) => name.startsWith("Cryptodome/"));
  }
  await fs.writeFile(
    path.join(directory, INDEX),
    JSON.stringify({
      protocolVersion: config.protocolVersion,
      legendaryVersion: manifest.version,
      capabilities: config.capabilities,
      fingerprint,
      files: await fileEntries(directory, sha256File),
    })
  );
  if (platform === "linux") {
    const { runtimeFiles } = require("./legendary-linux-runtime.cjs");
    const receiptPath = path.join(directory, ".runtime-files.json");
    const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
    receipt.files = await runtimeFiles(directory, sha256File);
    await fs.writeFile(receiptPath, JSON.stringify(receipt));
  }
}

function prepareManagedLegendary(options) {
  const key = path.resolve(
    options.projectDir,
    "legendary",
    options.platform,
    options.arch
  );
  const operation = (preparationQueues.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => prepareBundle(options));
  preparationQueues.set(key, operation);
  void operation
    .finally(() => {
      if (preparationQueues.get(key) === operation)
        preparationQueues.delete(key);
    })
    .catch(() => {});
  return operation;
}

module.exports = {
  prepareManagedLegendary,
  verifyManagedRuntime,
  writeManagedRuntimeReceipt,
  extractZip,
};
