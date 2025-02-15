import fs from "node:fs";
import path from "node:path";

import { registerEvent } from "../register-event";

const checkFolderWritePermission = async (
  _event: Electron.IpcMainInvokeEvent,
  testPath: string
) => {
  const testFilePath = path.join(testPath, ".hydra-write-test");

  try {
    fs.writeFileSync(testFilePath, "");
    fs.rmSync(testFilePath);
    return true;
  } catch (err) {
    return false;
  }
};

registerEvent("checkFolderWritePermission", checkFolderWritePermission);
