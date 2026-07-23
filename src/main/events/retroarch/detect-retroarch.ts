import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const detectRetroArch = async (_event: Electron.IpcMainInvokeEvent) => {
  const result = retroarch.detectRetroArch({ resolveVersion: true });

  if (!result) {
    return retroarch.getRetroArchConfig();
  }

  return retroarch.updateRetroArchConfig((current) => ({
    ...current,
    executablePath: result.executablePath,
    detectedVersion: result.detectedVersion,
    detectedAt: Date.now(),
  }));
};

registerEvent("detectRetroArch", detectRetroArch);
