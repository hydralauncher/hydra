import { registerEvent } from "../register-event";
import { emulators, retroarch } from "@main/services";
import type { RetroArchExecutablePreview } from "@types";
import path from "node:path";

const previewRetroArchExecutable = async (
  _event: Electron.IpcMainInvokeEvent,
  executablePath?: string | null
): Promise<RetroArchExecutablePreview | null> => {
  if (executablePath) {
    const normalizedPath = path.normalize(executablePath);
    const resolvedPath =
      emulators.findMacAppBundleRoot(normalizedPath) ?? normalizedPath;

    if (!emulators.isValidEmulatorExecutable(resolvedPath)) return null;

    return {
      executablePath: resolvedPath,
      detectedVersion: retroarch.getRetroArchVersion(resolvedPath),
    };
  }

  const result = retroarch.detectRetroArch({ resolveVersion: true });
  if (!result) return null;

  return {
    executablePath: result.executablePath,
    detectedVersion: result.detectedVersion,
  };
};

registerEvent("previewRetroArchExecutable", previewRetroArchExecutable);
