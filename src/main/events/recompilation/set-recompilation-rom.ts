import { registerEvent } from "../register-event";
import { setRecompilationRom } from "./recompilation-rom";

registerEvent(
  "setRecompilationRom",
  (_event: Electron.IpcMainInvokeEvent, ref: unknown, choice: unknown) =>
    setRecompilationRom(ref, choice)
);
