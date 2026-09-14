import { shell } from "electron";
import fs from "node:fs";
import { registerEvent } from "../register-event";

const openFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  folderPath: string
) => {
  await fs.promises.mkdir(folderPath, { recursive: true });

  return shell.openPath(folderPath);
};

registerEvent("openFolder", openFolder);
