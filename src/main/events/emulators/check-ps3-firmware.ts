import { registerEvent } from "../register-event";
import { emulators } from "@main/services";

const checkPs3Firmware = async (
  _event: Electron.IpcMainInvokeEvent,
  executablePath: string | null
) => {
  const firmwarePath = await emulators.findPs3FirmwareDirectory(executablePath);
  return { installed: firmwarePath !== null, path: firmwarePath };
};

registerEvent("checkPs3Firmware", checkPs3Firmware);
