import { shell } from "electron";
import { registerEvent } from "../register-event";

const openExternal = async (_event: Electron.IpcMainInvokeEvent, src: string) =>
  shell.openExternal(src);

registerEvent("openExternal", openExternal);
