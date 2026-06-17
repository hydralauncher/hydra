import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const checkEmulatorBios = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  executablePath: string | null
) => {
  const installed = await emulators.isEmulatorBiosInstalled(
    system,
    executablePath
  );
  return { installed };
};

registerEvent("checkEmulatorBios", checkEmulatorBios);
