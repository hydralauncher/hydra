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

  const version = resolvedPath
    ? retroarch.getRetroArchVersion(resolvedPath)
    : null;

  return retroarch.updateRetroArchConfig((current) => ({
    ...current,
    executablePath: resolvedPath,
    detectedVersion: version,
    detectedAt: resolvedPath ? Date.now() : null,
  }));
};

registerEvent("setRetroArchExecutablePath", setRetroArchExecutablePath);
