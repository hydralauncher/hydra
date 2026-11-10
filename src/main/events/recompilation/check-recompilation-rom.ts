import { registerEvent } from "../register-event";
import { checkRecompilationRom } from "./recompilation-rom";

registerEvent(
  "checkRecompilationRom",
  (_event: Electron.IpcMainInvokeEvent, ref: unknown, romPath: unknown) =>
    checkRecompilationRom(ref, romPath)
);
