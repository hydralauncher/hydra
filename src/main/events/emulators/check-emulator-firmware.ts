import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const checkEmulatorFirmware = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  executablePath: string | null
) => emulators.getEmulatorFirmwareStatus(system, executablePath);

registerEvent("checkEmulatorFirmware", checkEmulatorFirmware);
