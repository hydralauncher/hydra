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
  getRecompilationInstallDirectory as getInstallDirectory,
  parseRecompilationRef as parseRef,
} from "./recompilation-paths";
import {
  markRecompilationRomLaunched,
  prepareRecompilationRom,
} from "./recompilation-rom";

const INSTALL_MARKER_FILE = ".hydra-recompilation.json";
const EXECUTABLE_SCAN_DEPTH = 3;

interface InstallMarker {
  slug: string;
  objectId: string;
  version: string;
  assetName: string;
  executablePath: string | null;
  installedAt: string;
}

const installsInProgress = new Set<string>();

const sendProgress = (progress: RecompilationInstallProgress) => {
  WindowManager.mainWindow?.webContents.send(
    "on-recompilation-install-progress",
    progress
  );
};

const apiPath = ({ objectId, slug }: RecompilationRef) =>
  `/games/launchbox/${objectId}/recompilations/${slug}`;

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

const EXECUTABLE_MAGIC = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
];

const looksLikeLinuxExecutable = async (filePath: string) => {
  if (filePath.toLowerCase().endsWith(".appimage")) return true;

  const handle = await fs.promises.open(filePath, "r");
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, 4, 0);
    if (bytesRead < 4) return false;
    return EXECUTABLE_MAGIC.some((magic) =>
      magic.every((byte, index) => header[index] === byte)
    );
  } finally {
    await handle.close();
  }
};

const isExecutableCandidate = async (filePath: string) => {
  const lower = filePath.toLowerCase();
  if (process.platform === "win32") {
    return (
      lower.endsWith(".exe") &&
      !/(unins|setup|install|crash|vc_?redist|dxsetup)/.test(
        path.basename(lower)
      )
    );
  }
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

/**
 * Picks the executable closest to the install root, preferring one whose name
 * shares a word with the port name. Returns null when nothing looks runnable.
 */
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

/** Zip files do not always keep the executable bit, so restore it. */
const markExecutables = async (directory: string, depth = 0) => {
  if (process.platform === "win32" || depth > EXECUTABLE_SCAN_DEPTH) return;

  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await markExecutables(entryPath, depth + 1);
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

/**
 * When a release zip has a single top-level folder, its contents are the
 * port. Returns the folder that holds the port files.
 */
const resolveExtractedRoot = async (stagingDirectory: string) => {
  const entries = await fs.promises.readdir(stagingDirectory, {
    withFileTypes: true,
  });
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(stagingDirectory, entries[0].name);
  }
  return stagingDirectory;
};

/**
 * Extracts into a staging folder, then copies the files over the install
 * folder. Files the release does not ship (saves, configs, mods that live in
 * the port folder) are kept.
 */
const extractRelease = async (
  archivePath: string,
  installDirectory: string
) => {
  const stagingDirectory = `${installDirectory}.partial`;
  await fs.promises.rm(stagingDirectory, { recursive: true, force: true });

  try {
    await SevenZip.extractFile({
      filePath: archivePath,
      outputPath: stagingDirectory,
    });
    const root = await resolveExtractedRoot(stagingDirectory);
    await markExecutables(root);
    await fs.promises.mkdir(installDirectory, { recursive: true });
    await fs.promises.cp(root, installDirectory, {
      recursive: true,
      force: true,
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
  };
};

/**
 * Installs or updates a port. The renderer only sends the game and port ids:
 * the release file, its checksum and the folder are resolved here from the
 * Hydra API, and only files from the port's own GitHub releases are accepted.
 */
export const installRecompilation = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };

  if (installsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }

  installsInProgress.add(ref.slug);

  let archivePath: string | null = null;
  let result: RecompilationActionResult;

  try {
    const [details, { releases }] = await Promise.all([
      HydraApi.get<RecompilationDetails>(apiPath(ref), undefined, {
        needsAuth: false,
      }),
      HydraApi.get<RecompilationReleases>(
        `${apiPath(ref)}/releases`,
        undefined,
        { needsAuth: false }
      ),
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
      throw new Error("no_release_file");
    }

    const installDirectory = await getInstallDirectory(ref.slug);
    archivePath = path.join(
      SystemPath.getPath("temp"),
      `hydra-recompilation-${ref.slug}-${path.basename(asset.name)}`
    );

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
    await extractRelease(archivePath, installDirectory);

    const marker: InstallMarker = {
      slug: ref.slug,
      objectId: ref.objectId,
      version: release.version,
      assetName: asset.name,
      executablePath: await findExecutable(installDirectory, details.name),
      installedAt: new Date().toISOString(),
    };
    await fs.promises.writeFile(
      path.join(installDirectory, INSTALL_MARKER_FILE),
      JSON.stringify(marker, null, 2)
    );

    result = { ok: true };
  } catch (error) {
    logger.error(`Failed to install recompilation ${ref.slug}`, error);
    result = {
      ok: false,
      reason:
        error instanceof Error && error.message === "no_release_file"
          ? "no_release_file"
          : "install_failed",
    };
  } finally {
    if (archivePath) await removeFileQuietly(archivePath);
    installsInProgress.delete(ref.slug);
  }

  // Sent once the port is no longer busy, so a view that refreshes on this
  // event never reads a stale isInstalling.
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
  if (installsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }

  const installDirectory = await getInstallDirectory(ref.slug);
  const marker = await readInstallMarker(installDirectory);
  if (marker?.slug !== ref.slug) return { ok: false, reason: "not_installed" };

  await fs.promises.rm(installDirectory, { recursive: true, force: true });
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

export const playRecompilation = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  const state = await getRecompilationInstallState(rawRef);
  if (!ref || !state?.installPath) {
    return { ok: false, reason: "not_installed" };
  }
  if (!state.executablePath) return { ok: false, reason: "no_executable" };

  // The marker lives inside the port folder, so only run a file under it.
  const relative = path.relative(state.installPath, state.executablePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, reason: "no_executable" };
  }

  const launch = await prepareRecompilationRom(ref, state.installPath);
  if (!launch.ok) return { ok: false, reason: launch.reason };

  return new Promise((resolve) => {
    const child = spawn(state.executablePath!, launch.args, {
      cwd: path.dirname(state.executablePath!),
      env: { ...process.env, ...launch.env },
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.once("spawn", () => {
      child.unref();
      void markRecompilationRomLaunched(state.installPath!);
      resolve({ ok: true });
    });
    child.once("error", (error) => {
      logger.error("Failed to launch recompilation", error);
      resolve({ ok: false, reason: "launch_failed" });
    });
  });
};
