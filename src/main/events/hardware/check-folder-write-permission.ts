import fs from "node:fs";

import { registerEvent } from "../register-event";

const checkFolderWritePermission = async (
  _event: Electron.IpcMainInvokeEvent,
  path: string
) =>
  new Promise((resolve) => {
    fs.access(path, fs.constants.W_OK, (err) => {
      resolve(!err);
    });
  });

registerEvent("checkFolderWritePermission", checkFolderWritePermission);
