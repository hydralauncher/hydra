import { mountPath } from "@main/theme/path";
import { registerEvent } from "../register-event";
import { shell } from "electron";

const openPath = async (_event: Electron.IpcMainInvokeEvent) =>
  shell.openPath(mountPath(process.platform));

registerEvent("openPath", openPath);
