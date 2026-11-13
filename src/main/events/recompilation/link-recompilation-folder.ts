import { registerEvent } from "../register-event";
import { linkRecompilationFolder } from "./recompilation-installer";

registerEvent(
  "linkRecompilationFolder",
  (_event: Electron.IpcMainInvokeEvent, ref: unknown, directory: unknown) =>
    linkRecompilationFolder(ref, directory)
);
