import { registerEvent } from "../register-event";
import { playRecompilation } from "./recompilation-installer";

registerEvent(
  "playRecompilation",
  (_event: Electron.IpcMainInvokeEvent, ref: unknown) => playRecompilation(ref)
);
