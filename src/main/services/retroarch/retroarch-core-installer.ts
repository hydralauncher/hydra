import { shell } from "electron";
import fs from "node:fs";
import path from "node:path";

import type {
  RetroArchCoreInstallProgress,
  RetroArchCoreInstallResult,
  RetroArchCoreName,
  RetroArchInstallProgress,
  RetroArchInstallResult,
} from "@types";

import { logger } from "../logger";
import { SevenZip } from "../7zip";
import { SystemPath } from "../system-path";
import { WindowManager } from "../window-manager";
import { downloadToFile, removeFileQuietly } from "../download-to-file";
import { getRetroArchVersion } from "./detect-retroarch";
import { RETROARCH_CORE_NAMES, isRetroArchCoreName } from "./retroarch-cores";
import {
  buildCoreDownloadUrl,
  coreLibraryFileName,
  resolveRetroArchInstallOptions,
} from "./retroarch-install-sources";
import { updateRetroArchConfig } from "./retroarch-repository";

export const managedRetroArchDir = (): string =>
  path.join(SystemPath.getPath("userData"), "retroarch");

export const managedCoresDir = (): string =>
  path.join(managedRetroArchDir(), "cores");

const sendCoreProgress = (progress: RetroArchCoreInstallProgress): void => {
  WindowManager.mainWindow?.webContents.send(
    "on-retroarch-core-install-progress",
    progress
  );
};

const sendInstallProgress = (progress: RetroArchInstallProgress): void => {
  WindowManager.mainWindow?.webContents.send(
    "on-retroarch-install-progress",
    progress
  );
};

export const downloadAndInstallCore = async (
  core: RetroArchCoreName
): Promise<RetroArchCoreInstallResult> => {
  if (!isRetroArchCoreName(core)) {
    return { ok: false, core, reason: "invalid_core" };
  }

  const downloadUrl = buildCoreDownloadUrl(core);
  if (!downloadUrl) {
    sendCoreProgress({ core, phase: "error", reason: "unsupported_platform" });
    return { ok: false, core, reason: "unsupported_platform" };
  }

  const libraryFileName = coreLibraryFileName(core);
  const archivePath = path.join(
    SystemPath.getPath("temp"),
    `${libraryFileName}.zip`
  );
  const coresDir = managedCoresDir();
  const libraryPath = path.join(coresDir, libraryFileName);

  const removeArchive = async () => {
    await removeFileQuietly(archivePath);
  };

  try {
    sendCoreProgress({ core, phase: "downloading", loaded: 0 });
    const { lastModified } = await downloadToFile(
      downloadUrl,
      archivePath,
      (loaded, total) => {
        sendCoreProgress({
          core,
          phase: "downloading",
          loaded,
          total: total ?? undefined,
        });
      }
    );

    sendCoreProgress({ core, phase: "extracting" });
    await fs.promises.mkdir(coresDir, { recursive: true });
    await SevenZip.extractFile({
      filePath: archivePath,
      outputPath: coresDir,
    });
    await removeArchive();

    if (!fs.existsSync(libraryPath)) {
      sendCoreProgress({ core, phase: "error", reason: "extract_failed" });
      return { ok: false, core, reason: "extract_failed" };
    }

    await updateRetroArchConfig((current) => ({
      ...current,
      cores: {
        ...current.cores,
        [core]: {
          name: core,
          installed: true,
          version: lastModified,
          path: libraryPath,
          installedAt: Date.now(),
        },
      },
    }));

    sendCoreProgress({ core, phase: "done", path: libraryPath });
    return { ok: true, core, path: libraryPath };
  } catch (error) {
    logger.error(`Failed to install RetroArch core ${core}`, error);
    await removeArchive();
    sendCoreProgress({ core, phase: "error", reason: "install_failed" });
    return { ok: false, core, reason: "install_failed" };
  }
};

export const downloadAndInstallAllCores = async (): Promise<
  RetroArchCoreInstallResult[]
> => {
  const results: RetroArchCoreInstallResult[] = [];
  for (const core of RETROARCH_CORE_NAMES) {
    results.push(await downloadAndInstallCore(core));
  }
  return results;
};

const findExecutableInDir = (
  root: string,
  matcher: (name: string) => boolean
): string | null => {
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
      } else if (matcher(entry.name.toLowerCase())) {
        return full;
      }
    }
  }
  return null;
};

export const downloadAndInstallRetroArch = async (
  optionId: string
): Promise<RetroArchInstallResult> => {
  const options = await resolveRetroArchInstallOptions();
  const option = options.find((candidate) => candidate.id === optionId);

  if (!option || option.kind === "link" || !option.downloadUrl) {
    return { ok: false, reason: "option_not_installable" };
  }

  const fileName = path.basename(option.fileName ?? option.downloadUrl);
  const archivePath = path.join(SystemPath.getPath("temp"), fileName);
  const extractDir = path.join(managedRetroArchDir(), "emulator");
  const stagingDir = `${extractDir}-staging`;

  const removeArchive = async () => {
    await removeFileQuietly(archivePath);
  };

  const removeStaging = async () => {
    await fs.promises
      .rm(stagingDir, { recursive: true, force: true })
      .catch(() => {});
  };

  try {
    sendInstallProgress({ optionId, phase: "downloading", loaded: 0 });
    await downloadToFile(option.downloadUrl, archivePath, (loaded, total) => {
      sendInstallProgress({
        optionId,
        phase: "downloading",
        loaded,
        total: total ?? undefined,
      });
    });

    sendInstallProgress({ optionId, phase: "extracting" });
    await removeStaging();
    await fs.promises.mkdir(stagingDir, { recursive: true });
    await SevenZip.extractFile({
      filePath: archivePath,
      outputPath: stagingDir,
    });
    await removeArchive();

    const stagedExecutable =
      process.platform === "win32"
        ? findExecutableInDir(stagingDir, (name) => name === "retroarch.exe")
        : findExecutableInDir(stagingDir, (name) => name.endsWith(".appimage"));

    if (!stagedExecutable) {
      await removeStaging();
      sendInstallProgress({
        optionId,
        phase: "error",
        reason: "executable_not_found",
      });
      return { ok: false, reason: "executable_not_found" };
    }

    const relativeExecutable = path.relative(stagingDir, stagedExecutable);
    await fs.promises.rm(extractDir, { recursive: true, force: true });
    await fs.promises.rename(stagingDir, extractDir);
    const executablePath = path.join(extractDir, relativeExecutable);

    if (process.platform !== "win32") {
      const { mode } = await fs.promises.stat(executablePath);
      await fs.promises.chmod(executablePath, mode | 0o100);
    }

    await updateRetroArchConfig((current) => ({
      ...current,
      executablePath,
      detectedVersion:
        getRetroArchVersion(executablePath) ?? option.version ?? null,
      detectedAt: Date.now(),
    }));

    shell.showItemInFolder(executablePath);
    sendInstallProgress({ optionId, phase: "done", path: executablePath });
    return { ok: true, path: executablePath };
  } catch (error) {
    logger.error("Failed to install RetroArch", error);
    await removeArchive();
    await removeStaging();
    sendInstallProgress({ optionId, phase: "error", reason: "install_failed" });
    return { ok: false, reason: "install_failed" };
  }
};
