import { registerEvent } from "../register-event";
import { getRecompilationInstallState } from "./recompilation-installer";

registerEvent(
  "getRecompilationInstallState",
  (_event: Electron.IpcMainInvokeEvent, portId: unknown) =>
    getRecompilationInstallState(portId)
);
