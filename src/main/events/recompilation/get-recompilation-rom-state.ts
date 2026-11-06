import { registerEvent } from "../register-event";
import { getRecompilationRomState } from "./recompilation-rom";

registerEvent(
  "getRecompilationRomState",
  (_event: Electron.IpcMainInvokeEvent, ref: unknown) =>
    getRecompilationRomState(ref)
);
