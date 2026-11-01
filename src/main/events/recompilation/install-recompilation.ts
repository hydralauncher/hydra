import { registerEvent } from "../register-event";
import { installRecompilation } from "./recompilation-installer";

registerEvent(
  "installRecompilation",
  (_event: Electron.IpcMainInvokeEvent, portId: unknown) =>
    installRecompilation(portId)
);
