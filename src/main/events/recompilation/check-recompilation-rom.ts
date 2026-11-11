import { registerEvent } from "../register-event";
import {
  checkRecompilationRom,
  extractRecompilationRomPkg,
} from "./recompilation-rom";

registerEvent(
  "checkRecompilationRom",
  (_event: Electron.IpcMainInvokeEvent, ref: unknown, romPath: unknown) =>
    checkRecompilationRom(ref, romPath)
);

registerEvent(
  "extractRecompilationRomPkg",
  (_event: Electron.IpcMainInvokeEvent, ref: unknown, pkgPath: unknown) =>
    extractRecompilationRomPkg(ref, pkgPath)
);
