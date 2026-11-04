import { registerEvent } from "../register-event";
import { installRecompilation } from "./recompilation-installer";

registerEvent(
  "installRecompilation",
  (
    _event: Electron.IpcMainInvokeEvent,
    ref: unknown,
    parentDirectory?: unknown
  ) => installRecompilation(ref, parentDirectory)
);
