import { shell } from "electron";
import fs from "node:fs";
import path from "node:path";

import {
  RECOMPILATION_PORTS,
  isRecompilationPortId,
  pickRecompilationAsset,
} from "@shared";
import type {
  RecompilationInstallProgress,
  RecompilationInstallResult,
  RecompilationInstallState,
  RecompilationPort,
  RecompilationReleaseAsset,
} from "@types";
import { getDownloadsPath } from "@main/events/helpers/get-downloads-path";
import { logger, SevenZip, SystemPath, WindowManager } from "@main/services";
import {
  downloadToFile,
  removeFileQuietly,
} from "@main/services/download-to-file";

const INSTALL_MARKER_FILE = ".hydra-recompilation.json";
const EXECUTABLE_SCAN_DEPTH = 4;

interface InstallMarker {
  portId: string;
  version: string;
  assetName: string;
  installedAt: string;
}

const installsInProgress = new Set<string>();

const sendProgress = (progress: RecompilationInstallProgress) => {
  WindowManager.mainWindow?.webContents.send(
    "on-recompilation-install-progress",
    progress
  );
};

const resolvePort = (portId: unknown): RecompilationPort | null =>
  isRecompilationPortId(portId) ? RECOMPILATION_PORTS[portId] : null;

const resolveAsset = (port: RecompilationPort) => {
  const asset = pickRecompilationAsset(port, process.platform, process.arch);
  const allowedPrefix = `https://github.com/${port.repository}/releases/download/${port.release.tag}/`;

  // Only the hardcoded GitHub release files of this port can be downloaded.
  if (!asset?.url.startsWith(allowedPrefix)) return null;

  return asset;
};

/** <downloads>/recompilations/<port id>/<version> */
const getInstallDirectory = async (port: RecompilationPort) =>
  path.join(
    await getDownloadsPath(),
    "recompilations",
    port.id,
    port.release.version
  );

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

const isInstalled = async (port: RecompilationPort) => {
  const installDirectory = await getInstallDirectory(port);
  const marker = await readInstallMarker(installDirectory);

  return {
    installDirectory,
    installed:
      marker?.portId === port.id && marker.version === port.release.version,
  };
};

const EXECUTABLE_MAGIC = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O 64-bit
  [0xce, 0xfa, 0xed, 0xfe], // Mach-O 32-bit
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O universal
];

const looksExecutable = async (filePath: string) => {
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

/** Zip files do not always keep the executable bit, so restore it. */
const markExecutables = async (directory: string, depth = 0) => {
  if (process.platform === "win32" || depth > EXECUTABLE_SCAN_DEPTH) return;

  const entries = await fs.promises.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await markExecutables(entryPath, depth + 1);
    } else if (entry.isFile() && (await looksExecutable(entryPath))) {
      const { mode } = await fs.promises.stat(entryPath);
      await fs.promises.chmod(entryPath, mode | 0o111);
    }
  }
};

const extractRelease = async (
  port: RecompilationPort,
  asset: RecompilationReleaseAsset,
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
    await markExecutables(stagingDirectory);

    const marker: InstallMarker = {
      portId: port.id,
      version: port.release.version,
      assetName: asset.name,
      installedAt: new Date().toISOString(),
    };
    await fs.promises.writeFile(
      path.join(stagingDirectory, INSTALL_MARKER_FILE),
      JSON.stringify(marker, null, 2)
    );

    await fs.promises.rm(installDirectory, { recursive: true, force: true });
    await fs.promises.rename(stagingDirectory, installDirectory);
  } catch (error) {
    await fs.promises.rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
};

export const getRecompilationInstallState = async (
  portId: unknown
): Promise<RecompilationInstallState | null> => {
  const port = resolvePort(portId);
  if (!port) return null;

  const { installed, installDirectory } = await isInstalled(port);

  return {
    installed,
    isInstalling: installsInProgress.has(port.id),
    version: installed ? port.release.version : null,
    assetName: resolveAsset(port)?.name ?? null,
    installPath: installed ? installDirectory : null,
  };
};

/**
 * Downloads the release file of a port for this PC from GitHub and extracts
 * it. The renderer only sends the port id: the URL, file and folder are
 * resolved here from the hardcoded release data.
 */
export const installRecompilation = async (
  portId: unknown
): Promise<RecompilationInstallResult> => {
  const port = resolvePort(portId);
  if (!port) return { ok: false, reason: "invalid_port" };

  const asset = resolveAsset(port);
  if (!asset) return { ok: false, reason: "no_release_file" };

  if (installsInProgress.has(port.id)) {
    return { ok: false, reason: "already_installing" };
  }

  installsInProgress.add(port.id);

  const archivePath = path.join(
    SystemPath.getPath("temp"),
    `hydra-recompilation-${port.id}-${asset.name}`
  );

  try {
    const installDirectory = await getInstallDirectory(port);

    sendProgress({
      portId: port.id,
      phase: "downloading",
      loaded: 0,
      total: asset.size,
    });

    await downloadToFile(asset.url, archivePath, (loaded, total) => {
      sendProgress({
        portId: port.id,
        phase: "downloading",
        loaded,
        total: total ?? asset.size,
      });
    });

    const { size } = await fs.promises.stat(archivePath);
    if (size !== asset.size) {
      throw new Error(
        `Unexpected size for ${asset.name}: ${size} instead of ${asset.size}`
      );
    }

    sendProgress({ portId: port.id, phase: "extracting" });
    await extractRelease(port, asset, archivePath, installDirectory);

    sendProgress({ portId: port.id, phase: "done" });
    return { ok: true, path: installDirectory };
  } catch (error) {
    logger.error(`Failed to install recompilation ${port.id}`, error);
    sendProgress({
      portId: port.id,
      phase: "error",
      reason: "install_failed",
    });
    return { ok: false, reason: "install_failed" };
  } finally {
    await removeFileQuietly(archivePath);
    installsInProgress.delete(port.id);
  }
};

export const openRecompilationFolder = async (
  portId: unknown
): Promise<string> => {
  const port = resolvePort(portId);
  if (!port) return "invalid_port";

  const { installed, installDirectory } = await isInstalled(port);
  if (!installed) return "not_installed";

  return shell.openPath(installDirectory);
};
