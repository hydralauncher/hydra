import { registerEvent } from "../register-event";
import { prepareRecompilation } from "./recompilation-installer";

registerEvent(
  "prepareRecompilation",
  (_event: Electron.IpcMainInvokeEvent, ref: unknown) =>
    prepareRecompilation(ref)
);
