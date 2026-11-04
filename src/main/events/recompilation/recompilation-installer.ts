import { shell } from "electron";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  isRecompilationAssetFromRepository,
  pickRecompilationInstallAsset,
} from "@shared";
import type {
  RecompilationActionResult,
  RecompilationDetails,
  RecompilationInstallProgress,
  RecompilationInstallState,
  RecompilationRef,
  RecompilationReleases,
} from "@types";
import {
  HydraApi,
  logger,
  SevenZip,
  SystemPath,
  WindowManager,
} from "@main/services";
import {
  downloadToFile,
  removeFileQuietly,
} from "@main/services/download-to-file";
import {
  forgetRecompilationInstallDirectory,
  getRecompilationInstallDirectory as getInstallDirectory,
  parseRecompilationRef as parseRef,
  saveRecompilationInstallDirectory,
} from "./recompilation-paths";
import {
  markRecompilationRomLaunched,
  prepareRecompilationRom,
} from "./recompilation-rom";
import recompilationSaves from "./recompilation-saves.json";

const INSTALL_MARKER_FILE = ".hydra-recompilation.json";
const EXECUTABLE_SCAN_DEPTH = 3;
const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46];

interface InstallMarker {
  slug: string;
  objectId: string;
  version: string;
  assetName: string;
  executablePath: string | null;
  installedAt: string;
}

class RecompilationInstallError extends Error {}

const installsInProgress = new Set<string>();
const launchesInProgress = new Set<string>();

const sendProgress = (progress: RecompilationInstallProgress) => {
  WindowManager.mainWindow?.webContents.send(
    "on-recompilation-install-progress",
    progress
  );
};

const apiPath = ({ objectId, slug }: RecompilationRef) =>
  `/games/launchbox/${objectId}/recompilations/${slug}`;

const loadSession = () => import("./recompilation-session");

const readInstallMarker = async (
  installDirectory: string
): Promise<InstallMarker | null> => {
  try {
    const raw = await fs.promises.readFile(
      path.join(installDirectory, INSTALL_MARKER_FILE),
      "utf-8"
    );
    return JSON.parse(raw) as InstallMarker;
  } catch {
    return null;
  }
};

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

const findExecutable = async (installDirectory: string, portName: string) => {
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

const restoreExecutableBits = async (directory: string, depth = 0) => {
  if (process.platform === "win32" || depth > EXECUTABLE_SCAN_DEPTH) return;

  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await restoreExecutableBits(entryPath, depth + 1);
    } else if (entry.isFile() && (await looksLikeLinuxExecutable(entryPath))) {
      const { mode } = await fs.promises.stat(entryPath);
      await fs.promises.chmod(entryPath, mode | 0o111);
    }
  }
};

const hashFile = (filePath: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });

const isExecutableInUse = async (executablePath: string | null) => {
  if (!executablePath) return false;
  try {
    const handle = await fs.promises.open(executablePath, "r+");
    await handle.close();
    return false;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    return code === "EBUSY" || code === "ETXTBSY";
  }
};

const isPortRunning = async (
  ref: RecompilationRef,
  executablePath: string | null
) => {
  if (launchesInProgress.has(ref.slug)) return true;
  const { isRecompilationRunning } = await loadSession();
  return isRecompilationRunning(ref) || isExecutableInUse(executablePath);
};

const getSingleEntry = async (directory: string) => {
  const entries = await fs.promises.readdir(directory, {
    withFileTypes: true,
  });
  return entries.length === 1 ? entries[0] : null;
};

const extractNestedTar = async (stagingDirectory: string) => {
  const entry = await getSingleEntry(stagingDirectory);
  if (!entry?.isFile() || !entry.name.toLowerCase().endsWith(".tar")) return;

  const tarPath = path.join(stagingDirectory, entry.name);
  await SevenZip.extractFile({
    filePath: tarPath,
    outputPath: stagingDirectory,
  });
  await fs.promises.rm(tarPath, { force: true });
};

const resolveExtractedRoot = async (stagingDirectory: string) => {
  const entry = await getSingleEntry(stagingDirectory);
  return entry?.isDirectory()
    ? path.join(stagingDirectory, entry.name)
    : stagingDirectory;
};

const extractRelease = async (
  archivePath: string,
  installDirectory: string,
  portName: string
) => {
  const stagingDirectory = `${installDirectory}.partial`;
  await fs.promises.rm(stagingDirectory, { recursive: true, force: true });

  try {
    await SevenZip.extractFile({
      filePath: archivePath,
      outputPath: stagingDirectory,
    });
    await extractNestedTar(stagingDirectory);
    const root = await resolveExtractedRoot(stagingDirectory);
    await restoreExecutableBits(root);
    if (!(await findExecutable(root, portName))) {
      throw new RecompilationInstallError("no_executable");
    }
    await fs.promises.mkdir(installDirectory, { recursive: true });
    await fs.promises.cp(root, installDirectory, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
  } finally {
    await fs.promises.rm(stagingDirectory, { recursive: true, force: true });
  }
};

export const getRecompilationInstallState = async (
  rawRef: unknown
): Promise<RecompilationInstallState | null> => {
  const ref = parseRef(rawRef);
  if (!ref) return null;

  const installDirectory = await getInstallDirectory(ref.slug);
  const marker = await readInstallMarker(installDirectory);
  const installed = marker?.slug === ref.slug;

  return {
    installed,
    isInstalling: installsInProgress.has(ref.slug),
    version: installed ? marker.version : null,
    installPath: installed ? installDirectory : null,
    executablePath: installed ? marker.executablePath : null,
    hasCloudSaves: Object.hasOwn(recompilationSaves, ref.slug),
  };
};

const fetchRelease = async (ref: RecompilationRef) => {
  const [details, { releases }] = await Promise.all([
    HydraApi.get<RecompilationDetails>(apiPath(ref), undefined, {
      needsAuth: false,
    }),
    HydraApi.get<RecompilationReleases>(`${apiPath(ref)}/releases`, undefined, {
      needsAuth: false,
    }),
  ]);
  const release =
    releases.find((item) => item.isLatest) ?? releases.at(0) ?? null;
  const asset = release
    ? pickRecompilationInstallAsset(release.assets, process.platform)
    : null;

  if (
    !release ||
    !asset ||
    !isRecompilationAssetFromRepository(
      asset,
      details.repository.fullName,
      release.tag
    )
  ) {
    throw new RecompilationInstallError("no_release_file");
  }

  return { details, release, asset };
};

const downloadAndInstall = async (
  ref: RecompilationRef,
  onArchivePath: (archivePath: string) => void
) => {
  const { details, release, asset } = await fetchRelease(ref);
  const installDirectory = await getInstallDirectory(ref.slug);
  const archivePath = path.join(
    SystemPath.getPath("temp"),
    `hydra-recompilation-${ref.slug}-${path.basename(asset.name)}`
  );
  onArchivePath(archivePath);

  sendProgress({
    slug: ref.slug,
    phase: "downloading",
    loaded: 0,
    total: asset.size,
  });

  await downloadToFile(asset.url, archivePath, (loaded, total) => {
    sendProgress({
      slug: ref.slug,
      phase: "downloading",
      loaded,
      total: total ?? asset.size,
    });
  });

  const { size } = await fs.promises.stat(archivePath);
  if (size !== asset.size) {
    throw new Error(`Unexpected size for ${asset.name}: ${size}`);
  }
  if (asset.sha256 && (await hashFile(archivePath)) !== asset.sha256) {
    throw new Error(`Checksum mismatch for ${asset.name}`);
  }

  sendProgress({ slug: ref.slug, phase: "extracting" });
  await extractRelease(archivePath, installDirectory, details.name);

  const executablePath = await findExecutable(installDirectory, details.name);
  if (!executablePath) throw new RecompilationInstallError("no_executable");

  const marker: InstallMarker = {
    slug: ref.slug,
    objectId: ref.objectId,
    version: release.version,
    assetName: asset.name,
    executablePath,
    installedAt: new Date().toISOString(),
  };
  await fs.promises.writeFile(
    path.join(installDirectory, INSTALL_MARKER_FILE),
    JSON.stringify(marker, null, 2)
  );
  await saveRecompilationInstallDirectory(ref.slug, installDirectory);
};

export const installRecompilation = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };
  if (installsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }

  installsInProgress.add(ref.slug);

  let archivePath = null as string | null;
  let result: RecompilationActionResult;

  try {
    const current = await getRecompilationInstallState(ref);
    if (await isPortRunning(ref, current?.executablePath ?? null)) {
      return { ok: false, reason: "running" };
    }

    await downloadAndInstall(ref, (downloadPath) => {
      archivePath = downloadPath;
    });
    result = { ok: true };
  } catch (error) {
    logger.error(`Failed to install recompilation ${ref.slug}`, error);
    result = {
      ok: false,
      reason:
        error instanceof RecompilationInstallError
          ? error.message
          : "install_failed",
    };
  } finally {
    if (archivePath) await removeFileQuietly(archivePath);
    installsInProgress.delete(ref.slug);
  }

  sendProgress(
    result.ok
      ? { slug: ref.slug, phase: "done" }
      : { slug: ref.slug, phase: "error", reason: result.reason }
  );

  return result;
};

export const uninstallRecompilation = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };

  const installDirectory = await getInstallDirectory(ref.slug);
  const marker = await readInstallMarker(installDirectory);
  if (marker?.slug !== ref.slug) return { ok: false, reason: "not_installed" };

  if (installsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }
  if (await isPortRunning(ref, marker.executablePath)) {
    return { ok: false, reason: "running" };
  }

  await fs.promises.rm(installDirectory, { recursive: true, force: true });
  await forgetRecompilationInstallDirectory(ref.slug);
  return { ok: true };
};

export const openRecompilationFolder = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const state = await getRecompilationInstallState(rawRef);
  if (!state?.installPath) return { ok: false, reason: "not_installed" };

  const error = await shell.openPath(state.installPath);
  return error ? { ok: false, reason: error } : { ok: true };
};

const spawnPort = (
  executablePath: string,
  launch: { args: string[]; env: Record<string, string> }
) =>
  new Promise<
    | { ok: true; child: ReturnType<typeof spawn> }
    | { ok: false; error: unknown }
  >((resolve) => {
    const child = spawn(executablePath, launch.args, {
      cwd: path.dirname(executablePath),
      env: { ...process.env, ...launch.env },
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.once("spawn", () => {
      child.unref();
      resolve({ ok: true, child });
    });
    child.once("error", (error) => resolve({ ok: false, error }));
  });

const launchRecompilation = async (
  ref: RecompilationRef
): Promise<RecompilationActionResult> => {
  const state = await getRecompilationInstallState(ref);
  if (!state?.installPath) return { ok: false, reason: "not_installed" };
  if (!state.executablePath) return { ok: false, reason: "no_executable" };

  const relative = path.relative(state.installPath, state.executablePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, reason: "no_executable" };
  }

  const {
    clearRecompilationCloudSaveGuard,
    isRecompilationRunning,
    prepareRecompilationCloudSave,
    startRecompilationSession,
  } = await loadSession();
  if (
    isRecompilationRunning(ref) ||
    (await isExecutableInUse(state.executablePath))
  ) {
    return { ok: false, reason: "running" };
  }

  const launch = await prepareRecompilationRom(ref, state.installPath);
  if (!launch.ok) return { ok: false, reason: launch.reason };

  if (!(await prepareRecompilationCloudSave(ref))) {
    return { ok: false, reason: "cloud_save_conflict" };
  }

  const spawned = await spawnPort(state.executablePath, launch);
  if (!spawned.ok) {
    logger.error("Failed to launch recompilation", spawned.error);
    clearRecompilationCloudSaveGuard(ref);
    return { ok: false, reason: "launch_failed" };
  }

  void markRecompilationRomLaunched(state.installPath);
  void startRecompilationSession(ref, spawned.child);
  return { ok: true };
};

export const playRecompilation = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return { ok: false, reason: "not_installed" };
  if (launchesInProgress.has(ref.slug)) return { ok: false, reason: "running" };
  if (installsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }

  launchesInProgress.add(ref.slug);
  try {
    return await launchRecompilation(ref);
  } finally {
    launchesInProgress.delete(ref.slug);
  }
};
