import fs from "node:fs";
import path from "node:path";

const EXECUTABLE_SCAN_DEPTH = 3;
const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46];
const APPIMAGE_ENTRY = "AppRun";
const NESTED_ARCHIVE = /\.(tar|tar\.gz|tgz|appimage)$/i;

export const isNestedReleaseArchive = (fileName: string) =>
  NESTED_ARCHIVE.test(fileName);

/** A release published as the program itself, like CrashBandicoot.exe. Only ports that name it as their executable opt in. */
export const isBareReleaseExecutable = (
  fileName: string,
  executableName: string | null
) => executableName !== null && path.basename(fileName) === executableName;

const looksLikeLinuxExecutable = async (filePath: string) => {
  if (filePath.toLowerCase().endsWith(".appimage")) return true;

  const handle = await fs.promises.open(filePath, "r");
  try {
    const header = Buffer.alloc(ELF_MAGIC.length);
    const { bytesRead } = await handle.read(header, 0, ELF_MAGIC.length, 0);
    return (
      bytesRead === ELF_MAGIC.length &&
      ELF_MAGIC.every((byte, index) => header[index] === byte)
    );
  } finally {
    await handle.close();
  }
};

const isExecutableCandidate = async (filePath: string) => {
  const lower = filePath.toLowerCase();
  if (
    /(unins|setup|install|crash|vc_?redist|dxsetup)/.test(path.basename(lower))
  ) {
    return false;
  }
  if (process.platform === "win32") return lower.endsWith(".exe");
  if (/\.(so(\.\d+)*|sh|txt|json|md)$/.test(lower)) return false;
  return looksLikeLinuxExecutable(filePath);
};

const collectExecutables = async (
  directory: string,
  depth = 0
): Promise<string[]> => {
  if (depth > EXECUTABLE_SCAN_DEPTH) return [];

  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const found: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectExecutables(entryPath, depth + 1)));
    } else if (entry.isFile() && (await isExecutableCandidate(entryPath))) {
      found.push(entryPath);
    }
  }

  return found;
};

const isFile = (filePath: string) =>
  fs.promises
    .stat(filePath)
    .then((stats) => stats.isFile())
    .catch(() => false);

const makeExecutable = async (filePath: string) => {
  if (process.platform === "win32") return;
  const { mode } = await fs.promises.stat(filePath);
  await fs.promises.chmod(filePath, mode | 0o111);
};

export const findDeclaredRecompilationEntry = async (
  root: string,
  override: string | null
) => {
  const entries = [
    ...(override ? [override] : []),
    ...(process.platform === "win32" ? [] : [APPIMAGE_ENTRY]),
  ];

  for (const entry of entries) {
    const entryPath = path.resolve(root, entry);
    if (!entryPath.startsWith(path.resolve(root) + path.sep)) continue;
    if (await isFile(entryPath)) {
      await makeExecutable(entryPath);
      return entryPath;
    }
  }

  return null;
};

export const findRecompilationExecutable = async (
  installDirectory: string,
  portName: string,
  override: string | null
) => {
  const declared = await findDeclaredRecompilationEntry(
    installDirectory,
    override
  );
  if (declared) return declared;

  const candidates = await collectExecutables(installDirectory);
  if (candidates.length === 0) return null;

  const words = portName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
  const depth = (filePath: string) =>
    path.relative(installDirectory, filePath).split(path.sep).length;
  const matchesName = (filePath: string) =>
    words.some((word) => path.basename(filePath).toLowerCase().includes(word));

  return (
    [...candidates].sort(
      (left, right) =>
        depth(left) - depth(right) ||
        Number(matchesName(right)) - Number(matchesName(left)) ||
        left.localeCompare(right)
    )[0] ?? null
  );
};

export const restoreExecutableBits = async (directory: string, depth = 0) => {
  if (process.platform === "win32" || depth > EXECUTABLE_SCAN_DEPTH) return;

  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await restoreExecutableBits(entryPath, depth + 1);
    } else if (entry.isFile() && (await looksLikeLinuxExecutable(entryPath))) {
      await makeExecutable(entryPath);
    }
  }
};
