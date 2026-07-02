import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const checkEmulatorBios = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  executablePath: string | null,
  manualBiosPath: string | null = null
) => {
  if (system !== "ps1" && system !== "ps2") {
    const installed = await emulators.isEmulatorBiosInstalled(
      system,
      executablePath,
      manualBiosPath
    );
    return { installed, detectedPath: null };
  }

  const detectedPath = await emulators.resolveInstalledBiosDir(
    system,
    executablePath,
    manualBiosPath
  );

  if (detectedPath && detectedPath !== manualBiosPath) {
    await emulators.updateEmulatorConfig(system, (current) => ({
      ...current,
      biosPath: detectedPath,
    }));
  }

  return { installed: detectedPath !== null, detectedPath };
};

registerEvent("checkEmulatorBios", checkEmulatorBios);
