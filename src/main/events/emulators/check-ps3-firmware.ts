import { registerEvent } from "../register-event";
import { emulators } from "@main/services";

const checkPs3Firmware = async (
  _event: Electron.IpcMainInvokeEvent,
  executablePath: string | null
) => {
  const installed = await emulators.isPs3FirmwareInstalled(executablePath);
  return { installed };
};

registerEvent("checkPs3Firmware", checkPs3Firmware);
