import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const detectRetroArch = async (
  _event: Electron.IpcMainInvokeEvent,
  options?: { includeDriveRoots?: boolean }
) => {
  const result = await retroarch.detectRetroArchWithFallback({
    resolveVersion: true,
    includeDriveRoots: options?.includeDriveRoots === true,
  });

  if (!result) {
    return retroarch.getRetroArchConfig();
  }

  return retroarch.updateRetroArchConfig((current) => {
    const next = {
      ...current,
      executablePath: result.executablePath,
      detectedVersion: result.detectedVersion,
      detectedAt: Date.now(),
    };

    const hasInstalledCores = Object.values(current.cores).some(
      (core) => core.installed
    );
    if (current.coresDir === null && !hasInstalledCores) {
      const autoCoresDir = retroarch.detectRetroArchCoresDir(
        result.executablePath
      );
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

registerEvent("detectRetroArch", detectRetroArch);
