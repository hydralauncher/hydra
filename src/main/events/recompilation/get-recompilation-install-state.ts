import { registerEvent } from "../register-event";
import { getRecompilationInstallState } from "./recompilation-installer";

registerEvent(
  "getRecompilationInstallState",
  (_event: Electron.IpcMainInvokeEvent, ref: unknown) =>
    getRecompilationInstallState(ref)
);
