import { shell } from "electron";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type {
  EmulatorBinary,
  EmulatorInstallProgress,
  EmulatorInstallResult,
  EmulatorSystem,
  ResolvedInstallOption,
} from "@types";
import { getDownloadsPath } from "@main/events/helpers/get-downloads-path";

import { logger } from "../logger";
import { SevenZip } from "../7zip";
import { SystemPath } from "../system-path";
import { WindowManager } from "../window-manager";
import { downloadToFile, removeFileQuietly } from "../download-to-file";
import { resolveInstallOptions } from "./emulator-install-sources";
import {
  findManagedEmulatorExecutable,
  requireManagedEmulatorExecutable,
} from "./find-managed-emulator-executable";
import { KNOWN_BINARIES, isKnownEmulatorBinary } from "./known-binaries";
import { assertValidEmulatorExecutable } from "./validate-emulator-executable";

const execFileAsync = promisify(execFile);

/** Same shape resolveInstallOptions returns, scoped to the current platform. */
export const resolveEmulatorInstallOptions = (
  binary: EmulatorBinary
): Promise<ResolvedInstallOption[]> =>
  resolveInstallOptions(binary, process.platform, process.arch);

const sendProgress = (progress: EmulatorInstallProgress): void => {
  WindowManager.mainWindow?.webContents.send(
    "on-emulator-install-progress",
    progress
  );
};

const runWindowsInstaller = async (filePath: string): Promise<boolean> => {
  const launched = await new Promise<boolean>((resolve) => {
    const child = spawn(filePath, [], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
    child.once("error", (error) => {
      logger.error("Failed to launch emulator installer", error);
      resolve(false);
    });
  });

  if (launched) return true;

  const openError = await shell.openPath(filePath);
  return openError.length === 0;
};

const BINARY_TO_SYSTEM: Record<EmulatorBinary, EmulatorSystem> = {
  duckstation: "ps1",
  pcsx2: "ps2",
  rpcs3: "ps3",
  ppsspp: "psp",
  dolphin: "dolphin",
};

const emulatorInstallDirectory = async (
  binary: EmulatorBinary
): Promise<string> => {
  const downloadsRoot = await getDownloadsPath();
  const system = BINARY_TO_SYSTEM[binary];
  return path.join(downloadsRoot, KNOWN_BINARIES[system].displayName);
};

const installMacosDmg = async (
  dmgPath: string,
  binary: EmulatorBinary,
  installDirectory: string
): Promise<string> => {
  const system = BINARY_TO_SYSTEM[binary];
  const mountDirectory = await fs.promises.mkdtemp(
    path.join(SystemPath.getPath("temp"), "hydra-emulator-dmg-")
  );
  let mounted = false;

  try {
    await execFileAsync(
      "/usr/bin/hdiutil",
      [
        "attach",
        dmgPath,
        "-nobrowse",
        "-readonly",
        "-mountpoint",
        mountDirectory,
      ],
      { timeout: 60_000 }
    );
    mounted = true;

    const sourceBundle = findManagedEmulatorExecutable(
      mountDirectory,
      KNOWN_BINARIES[system]
    );
    if (!sourceBundle || path.extname(sourceBundle).toLowerCase() !== ".app") {
      throw new Error(`No ${binary} app bundle found in disk image`);
    }
    assertValidEmulatorExecutable(sourceBundle);

    const destinationBundle = path.join(
      installDirectory,
      path.basename(sourceBundle)
    );
    await fs.promises.mkdir(installDirectory, { recursive: true });
    await fs.promises.rm(destinationBundle, { recursive: true, force: true });
    await fs.promises.cp(sourceBundle, destinationBundle, {
      recursive: true,
      preserveTimestamps: true,
    });
    assertValidEmulatorExecutable(destinationBundle);
    return destinationBundle;
  } finally {
    if (mounted) {
      await execFileAsync("/usr/bin/hdiutil", ["detach", mountDirectory], {
        timeout: 30_000,
      }).catch((error) => {
        logger.warn("Failed to detach emulator disk image", error);
      });
    }
    await fs.promises.rm(mountDirectory, { recursive: true, force: true });
  }
};

/**
 * Downloads the resolved installer for an emulator option and runs it. The
 * option id is re-resolved server-side so the renderer never supplies the URL.
 */
export const downloadAndInstallEmulator = async (
  binary: EmulatorBinary,
  optionId: string
): Promise<EmulatorInstallResult> => {
  if (!isKnownEmulatorBinary(binary)) {
    return { ok: false, reason: "invalid_binary" };
  }

  const options = await resolveEmulatorInstallOptions(binary);
  const option = options.find((candidate) => candidate.id === optionId);

  if (!option || option.kind === "link" || !option.downloadUrl) {
    return { ok: false, reason: "option_not_installable" };
  }

  const fileName = path.basename(option.fileName ?? option.downloadUrl);
  const isAppImage = option.kind === "linux-appimage";
  const installDirectory = await emulatorInstallDirectory(binary);
  const dest = isAppImage
    ? path.join(installDirectory, fileName)
    : path.join(SystemPath.getPath("temp"), fileName);

  const removeTempDownload = async () => {
    if (!isAppImage) await removeFileQuietly(dest);
  };

  try {
    if (isAppImage) {
      await fs.promises.mkdir(installDirectory, { recursive: true });
    }
    sendProgress({ binary, optionId, phase: "downloading", loaded: 0 });
    await downloadToFile(option.downloadUrl, dest, (loaded, total) => {
      sendProgress({
        binary,
        optionId,
        phase: "downloading",
        loaded,
        total: total ?? undefined,
      });
    });

    if (option.kind === "windows-installer") {
      sendProgress({ binary, optionId, phase: "running" });
      const ok = await runWindowsInstaller(dest);
      sendProgress({
        binary,
        optionId,
        phase: ok ? "done" : "error",
        path: dest,
        reason: ok ? undefined : "launch_failed",
      });
      await removeTempDownload();
      return ok
        ? { ok: true, path: dest }
        : { ok: false, reason: "launch_failed" };
    }

    if (option.kind === "linux-appimage") {
      const { mode } = await fs.promises.stat(dest);
      await fs.promises.chmod(dest, mode | 0o100);
      assertValidEmulatorExecutable(dest);
      shell.showItemInFolder(dest);
      sendProgress({ binary, optionId, phase: "done", path: dest });
      return { ok: true, path: dest };
    }

    if (option.kind === "macos-dmg") {
      sendProgress({ binary, optionId, phase: "extracting" });
      const appBundle = await installMacosDmg(dest, binary, installDirectory);
      await removeTempDownload();
      shell.showItemInFolder(appBundle);
      sendProgress({ binary, optionId, phase: "done", path: appBundle });
      return { ok: true, path: appBundle };
    }

    sendProgress({ binary, optionId, phase: "extracting" });
    const extractDir = installDirectory;
    await fs.promises.mkdir(extractDir, { recursive: true });
    await SevenZip.extractFile({ filePath: dest, outputPath: extractDir });
    const system = BINARY_TO_SYSTEM[binary];
    const executable = requireManagedEmulatorExecutable(
      extractDir,
      KNOWN_BINARIES[system]
    );
    await removeTempDownload();
    shell.showItemInFolder(executable);
    sendProgress({ binary, optionId, phase: "done", path: extractDir });
    return { ok: true, path: extractDir };
  } catch (error) {
    logger.error("Failed to install emulator", error);
    await removeFileQuietly(dest);
    sendProgress({
      binary,
      optionId,
      phase: "error",
      reason: "install_failed",
    });
    return { ok: false, reason: "install_failed" };
  }
};
