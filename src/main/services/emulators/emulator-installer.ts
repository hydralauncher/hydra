import { shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import axios from "axios";

import type {
  EmulatorBinary,
  EmulatorInstallProgress,
  EmulatorInstallResult,
  EmulatorSystem,
  ResolvedInstallOption,
} from "@types";

import { logger } from "../logger";
import { SevenZip } from "../7zip";
import { SystemPath } from "../system-path";
import { WindowManager } from "../window-manager";
import { resolveInstallOptions } from "./emulator-install-sources";
import { getEmulatorVersion } from "./get-emulator-version";
import { KNOWN_BINARIES, isKnownEmulatorBinary } from "./known-binaries";
import { updateEmulatorConfig } from "./emulators-repository";
import { isValidEmulatorExecutable } from "./validate-emulator-executable";

const PROGRESS_EMIT_BYTES = 512 * 1024;

const managedEmulatorsDir = (): string =>
  path.join(SystemPath.getPath("userData"), "emulators");

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

const downloadToFile = async (
  url: string,
  dest: string,
  onProgress: (loaded: number, total: number | null) => void
): Promise<void> => {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });

  const response = await axios.get(url, {
    responseType: "stream",
    headers: { "User-Agent": "HydraLauncher" },
  });

  const lengthHeader = Number(response.headers["content-length"]);
  const total = Number.isFinite(lengthHeader) ? lengthHeader : null;
  let received = 0;
  let lastEmit = 0;

  const writer = fs.createWriteStream(dest);

  await new Promise<void>((resolve, reject) => {
    response.data.on("data", (chunk: Buffer) => {
      received += chunk.length;
      const done = total !== null && received >= total;
      if (received - lastEmit >= PROGRESS_EMIT_BYTES || done) {
        lastEmit = received;
        onProgress(received, total);
      }
    });
    response.data.on("error", reject);
    writer.on("error", reject);
    writer.on("close", resolve);
    response.data.pipe(writer);
  });
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

const findRpcs3Executable = (root: string): string | null => {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.toLowerCase() === "rpcs3.exe") {
        return full;
      }
    }
  }
  return null;
};

const BINARY_TO_SYSTEM: Record<EmulatorBinary, EmulatorSystem> = {
  duckstation: "ps1",
  pcsx2: "ps2",
  rpcs3: "ps3",
};

const autoConfigureEmulator = async (
  system: EmulatorSystem,
  executablePath: string
): Promise<void> => {
  if (!isValidEmulatorExecutable(executablePath)) return;

  const version = getEmulatorVersion(executablePath, KNOWN_BINARIES[system]);
  await updateEmulatorConfig(system, (current) => ({
    ...current,
    executablePath,
    detectedVersion: version,
    detectedAt: Date.now(),
  }));
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
  const dest = isAppImage
    ? path.join(managedEmulatorsDir(), fileName)
    : path.join(SystemPath.getPath("temp"), fileName);

  const removeTempDownload = async () => {
    if (!isAppImage) await fs.promises.unlink(dest).catch(() => {});
  };

  try {
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
      await autoConfigureEmulator(BINARY_TO_SYSTEM[binary], dest);
      shell.showItemInFolder(dest);
      sendProgress({ binary, optionId, phase: "done", path: dest });
      return { ok: true, path: dest };
    }

    sendProgress({ binary, optionId, phase: "extracting" });
    const extractDir = path.join(managedEmulatorsDir(), binary);
    await fs.promises.mkdir(extractDir, { recursive: true });
    await SevenZip.extractFile({ filePath: dest, outputPath: extractDir });
    const rpcs3Exe = findRpcs3Executable(extractDir);
    if (rpcs3Exe) await autoConfigureEmulator("ps3", rpcs3Exe);
    await removeTempDownload();
    shell.showItemInFolder(extractDir);
    sendProgress({ binary, optionId, phase: "done", path: extractDir });
    return { ok: true, path: extractDir };
  } catch (error) {
    logger.error("Failed to install emulator", error);
    await removeTempDownload();
    sendProgress({
      binary,
      optionId,
      phase: "error",
      reason: "install_failed",
    });
    return { ok: false, reason: "install_failed" };
  }
};
