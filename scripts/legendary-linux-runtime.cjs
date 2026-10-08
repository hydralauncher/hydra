const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { Readable } = require("node:stream");
const { promisify } = require("node:util");
const manifest = require("../src/shared/legendary-manifest.json");

const execFileAsync = promisify(execFile);
const CACHE_MANIFEST = ".runtime-files.json";
const RUNTIME_FILE_CONCURRENCY = 8;
const SYSTEM_TAR = existsSync("/usr/bin/tar") ? "/usr/bin/tar" : "/bin/tar";
const TAR_EXECUTABLE =
  process.platform === "win32"
    ? path.win32.join(
        process.env.SystemRoot || String.raw`C:\Windows`,
        "System32",
        "tar.exe"
      )
    : SYSTEM_TAR;
const preparationQueues = new Map();
const templatesDirectory = path.resolve(__dirname, "../resources/legendary");

function getLinuxRuntime(arch) {
  const runtime = manifest.linuxRuntime?.artifacts?.[arch];
  if (
    !runtime ||
    !/^[a-f0-9]{64}$/.test(runtime.python?.sha256) ||
    !/^[a-f0-9]{64}$/.test(runtime.glibc?.sha256) ||
    !/^ld-linux-[a-z0-9-]+\.so\.[12]$/.test(runtime.glibc.loader) ||
    !/^lib\/[a-z0-9_-]+$/.test(runtime.glibc.libraryDirectory)
  )
    throw new Error(`Invalid Legendary Linux runtime manifest: ${arch}`);
  return runtime;
}

// Debian's ar container is read without installing dpkg/ar on the build host.
function extractDebianData(archive) {
  if (archive.subarray(0, 8).toString() !== "!<arch>\n")
    throw new Error("Invalid Legendary libc archive");
  for (let offset = 8; offset + 60 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 60);
    const name = header.subarray(0, 16).toString().trim().replace(/\/$/, "");
    const size = Number(header.subarray(48, 58).toString().trim());
    if (
      header.subarray(58, 60).toString() !== "`\n" ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      offset + 60 + size > archive.length
    )
      throw new Error("Invalid Legendary libc archive");
    if (name === "data.tar.xz")
      return archive.subarray(offset + 60, offset + 60 + size);
    offset += 60 + size + (size % 2);
  }
  throw new Error("Legendary libc archive has no data.tar.xz");
}

async function extractArchive(archive, directory) {
  await fs.mkdir(directory, { recursive: true });
  // Only pinned, SHA-256-verified official archives reach this build-time step.
  await execFileAsync(TAR_EXECUTABLE, ["-xf", archive, "-C", directory], {
    shell: false,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

async function runtimeFiles(directory, sha256File) {
  async function* visit(relativeDirectory = "") {
    const entries = await fs.readdir(path.join(directory, relativeDirectory), {
      withFileTypes: true,
    });
    entries.sort((left, right) => {
      if (left.name < right.name) return -1;
      if (left.name > right.name) return 1;
      return 0;
    });
    for (const entry of entries) {
      const name = path.posix.join(relativeDirectory, entry.name);
      if ([CACHE_MANIFEST, "LICENSE", "NOTICE.md"].includes(name)) continue;
      const file = path.join(directory, name);
      if (entry.isDirectory()) yield* visit(name);
      else yield { name, file, entry };
    }
  }
  // Stream mapping keeps the sorted traversal order and bounds active file I/O.
  return Readable.from(visit())
    .map(
      async ({ name, file, entry }) => {
        if (entry.isSymbolicLink()) {
          const target = await fs.readlink(file);
          const resolved = path.resolve(path.dirname(file), target);
          if (
            path.isAbsolute(target) ||
            !resolved.startsWith(`${path.resolve(directory)}${path.sep}`)
          )
            throw new Error("Legendary runtime contains an external symlink");
          return { name, target };
        }
        if (entry.isFile()) {
          const [sha256, info] = await Promise.all([
            sha256File(file),
            fs.stat(file),
          ]);
          return {
            name,
            sha256,
            executable: Boolean(info.mode & 0o111),
          };
        }
        throw new Error("Legendary runtime contains an unsupported file");
      },
      { concurrency: RUNTIME_FILE_CONCURRENCY }
    )
    .toArray();
}

async function verifyLinuxRuntime(directory, fingerprint, sha256File) {
  try {
    const installed = JSON.parse(
      await fs.readFile(path.join(directory, CACHE_MANIFEST), "utf8")
    );
    if (fingerprint && installed.fingerprint !== fingerprint) return false;
    const actual = await runtimeFiles(directory, sha256File);
    return JSON.stringify(actual) === JSON.stringify(installed.files);
  } catch (error) {
    if (error.code === "EACCES" || error.code === "EPERM") throw error;
    return false;
  }
}

async function prepareBundle(options) {
  const { projectDir, arch, artifact, download, sha256File } = options;
  const runtime = getLinuxRuntime(arch);
  const [launcher, pythonLauncher, sitecustomize] = await Promise.all([
    fs.readFile(path.join(templatesDirectory, "linux-legendary.sh"), "utf8"),
    fs.readFile(path.join(templatesDirectory, "linux-python.sh"), "utf8"),
    fs.readFile(
      path.join(templatesDirectory, "linux-sitecustomize.py"),
      "utf8"
    ),
  ]);
  const thirdPartyNotices = await fs.readFile(
    path.join(templatesDirectory, "THIRD_PARTY_NOTICES.txt"),
    "utf8"
  );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        format: 3,
        artifact,
        runtime,
        launcher,
        pythonLauncher,
        sitecustomize,
        thirdPartyNotices,
      })
    )
    .digest("hex");
  const parent = path.join(projectDir, "legendary", "linux");
  const directory = path.join(parent, arch);
  const binaryPath = path.join(directory, artifact.fileName);
  const result = { platform: "linux", arch, binaryPath };
  if (await verifyLinuxRuntime(directory, fingerprint, sha256File))
    return { ...result, cached: true };

  const downloads = path.join(projectDir, "legendary", ".downloads", arch);
  const zipapp = path.join(downloads, `${artifact.sha256}.pyz`);
  const pythonArchive = path.join(downloads, `${runtime.python.sha256}.tar.gz`);
  const libcArchive = path.join(downloads, `${runtime.glibc.sha256}.deb`);
  // Settle every download before returning an error or starting extraction.
  const fetched = await Promise.allSettled([
    download(artifact, zipapp),
    download(runtime.python, pythonArchive),
    download(runtime.glibc, libcArchive),
  ]);
  for (const downloadResult of fetched)
    if (downloadResult.status === "rejected") throw downloadResult.reason;

  await fs.mkdir(parent, { recursive: true });
  const staging = await fs.mkdtemp(path.join(parent, `.prepare-${arch}-`));
  const temporary = path.join(staging, ".extraction");
  const backup = `${directory}.previous-${randomUUID()}`;
  let backedUp = false;
  try {
    await extractArchive(pythonArchive, staging);
    await fs.mkdir(temporary);
    const libcData = path.join(temporary, "data.tar.xz");
    await fs.writeFile(
      libcData,
      extractDebianData(await fs.readFile(libcArchive))
    );
    const libcRoot = path.join(temporary, "libc");
    await extractArchive(libcData, libcRoot);
    await fs.cp(
      path.join(libcRoot, runtime.glibc.libraryDirectory),
      path.join(staging, "glibc"),
      { recursive: true, verbatimSymlinks: true }
    );
    await fs.mkdir(path.join(staging, "licenses"));
    const libcCopyright = await fs.readFile(
      path.join(libcRoot, "usr/share/doc/libc6/copyright"),
      "utf8"
    );
    await fs.writeFile(
      path.join(staging, "licenses/THIRD_PARTY_NOTICES.txt"),
      `${thirdPartyNotices}\n${"=".repeat(72)}\nDebian libc6 copyright notice\n${"=".repeat(72)}\n\n${libcCopyright}`
    );
    await fs.copyFile(zipapp, path.join(staging, "legendary.pyz"));
    await fs.writeFile(
      path.join(staging, "legendary"),
      launcher.replace("@CACHE_KEY@", artifact.sha256),
      { mode: 0o755 }
    );
    await fs.writeFile(
      path.join(staging, "python-runner"),
      pythonLauncher.replace("@LOADER@", runtime.glibc.loader),
      { mode: 0o755 }
    );
    const packages = path.join(staging, "python/lib/python3.13/site-packages");
    await fs.writeFile(path.join(packages, "sitecustomize.py"), sitecustomize);
    await fs.rm(temporary, { recursive: true, force: true });
    const files = await runtimeFiles(staging, sha256File);
    if (!(await fs.stat(path.join(staging, "python/bin/python3.13"))).isFile())
      throw new Error("Legendary Python runtime is incomplete");
    await fs.writeFile(
      path.join(staging, CACHE_MANIFEST),
      JSON.stringify({ fingerprint, files })
    );
    try {
      await fs.rename(directory, backup);
      backedUp = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await fs.rename(staging, directory);
    } catch (error) {
      if (backedUp) await fs.rename(backup, directory);
      backedUp = false;
      throw error;
    }
    if (backedUp) await fs.rm(backup, { recursive: true, force: true });
    return { ...result, cached: false };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

function prepareLinuxLegendary(options) {
  // Keep concurrent builders in this process from replacing the same bundle.
  const key = path.resolve(options.projectDir, "legendary/linux", options.arch);
  const previous = preparationQueues.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => prepareBundle(options));
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
  prepareLinuxLegendary,
  verifyLinuxRuntime,
};
