import { registerEvent } from "../register-event";
import { unlinkRecompilation } from "./recompilation-installer";

registerEvent(
  "unlinkRecompilation",
  (_event: Electron.IpcMainInvokeEvent, ref: unknown) =>
    unlinkRecompilation(ref)
);
