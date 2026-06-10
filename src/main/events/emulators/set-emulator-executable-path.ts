import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const setEmulatorExecutablePath = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  executablePath: string | null
) => {
  const binary = emulators.KNOWN_BINARIES[system];
  const version = executablePath
    ? emulators.getEmulatorVersion(executablePath, binary)
    : null;

  return emulators.updateEmulatorConfig(system, (current) => ({
    ...current,
    executablePath,
    detectedVersion: version,
    detectedAt: executablePath ? Date.now() : null,
  }));
};

registerEvent("setEmulatorExecutablePath", setEmulatorExecutablePath);
