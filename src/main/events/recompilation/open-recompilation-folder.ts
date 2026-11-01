import { registerEvent } from "../register-event";
import { openRecompilationFolder } from "./recompilation-installer";

registerEvent(
  "openRecompilationFolder",
  (_event: Electron.IpcMainInvokeEvent, portId: unknown) =>
    openRecompilationFolder(portId)
);
