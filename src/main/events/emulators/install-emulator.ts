import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorBinary } from "@types";

const installEmulator = async (
  _event: Electron.IpcMainInvokeEvent,
  binary: EmulatorBinary,
  optionId: string
) => emulators.downloadAndInstallEmulator(binary, optionId);

registerEvent("installEmulator", installEmulator);
