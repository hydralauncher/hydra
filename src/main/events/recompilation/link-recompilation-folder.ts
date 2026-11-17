import { registerEvent } from "../register-event";
import {
  linkRecompilationFolder,
  warmRecompilationFolderCheck,
} from "./recompilation-installer";

registerEvent(
  "linkRecompilationFolder",
  (
    _event: Electron.IpcMainInvokeEvent,
    ref: unknown,
    directory: unknown,
    options: unknown
  ) => linkRecompilationFolder(ref, directory, options)
);

registerEvent(
  "warmRecompilationFolderCheck",
  (_event: Electron.IpcMainInvokeEvent, ref: unknown) =>
    warmRecompilationFolderCheck(ref)
);
