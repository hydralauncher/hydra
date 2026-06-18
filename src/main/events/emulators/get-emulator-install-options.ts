import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorBinary } from "@types";

const getEmulatorInstallOptions = async (
  _event: Electron.IpcMainInvokeEvent,
  binary: EmulatorBinary
) => emulators.resolveEmulatorInstallOptions(binary);

registerEvent("getEmulatorInstallOptions", getEmulatorInstallOptions);
