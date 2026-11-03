import { registerEvent } from "../register-event";
import { uninstallRecompilation } from "./recompilation-installer";

registerEvent(
  "uninstallRecompilation",
  (_event: Electron.IpcMainInvokeEvent, ref: unknown) =>
    uninstallRecompilation(ref)
);
