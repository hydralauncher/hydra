import { registerEvent } from "../register-event";
import { emulators, retroarch } from "@main/services";
import path from "node:path";

const setRetroArchExecutablePath = async (
  _event: Electron.IpcMainInvokeEvent,
  executablePath: string | null
) => {
  const normalizedPath = executablePath ? path.normalize(executablePath) : null;
  const resolvedPath = normalizedPath
    ? (emulators.findMacAppBundleRoot(normalizedPath) ?? normalizedPath)
    : null;

  if (resolvedPath && !emulators.isValidEmulatorExecutable(resolvedPath)) {
    return null;
  }
  if (resolvedPath && !retroarch.isLikelyRetroArchExecutable(resolvedPath)) {
    return null;
  }

  const version = resolvedPath
    ? retroarch.getRetroArchVersion(resolvedPath)
    : null;

  return retroarch.updateRetroArchConfig((current) => {
    const next = {
      ...current,
      executablePath: resolvedPath,
      detectedVersion: version,
      detectedAt: resolvedPath ? Date.now() : null,
    };

    const hasInstalledCores = Object.values(current.cores).some(
      (core) => core.installed
    );
    if (resolvedPath && current.coresDir === null && !hasInstalledCores) {
      const autoCoresDir = retroarch.detectRetroArchCoresDir(resolvedPath);
      if (autoCoresDir) {
        next.coresDir = autoCoresDir;
        next.cores = retroarch.buildCoresStateForDir(
          autoCoresDir,
          current.cores
        );
      }
    }

    return next;
  });
};

registerEvent("setRetroArchExecutablePath", setRetroArchExecutablePath);
