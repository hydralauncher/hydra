import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { registerEvent } from "../register-event";

const saveTempFile = async (
  _event: Electron.IpcMainInvokeEvent,
  fileName: string,
  fileData: Uint8Array
): Promise<string> => {
  try {
    const tempDir = app.getPath("temp");
    const tempFilePath = path.join(tempDir, `hydra-temp-${Date.now()}-${fileName}`);
    
    // Write the file data to temp directory
    fs.writeFileSync(tempFilePath, fileData);
    
    return tempFilePath;
  } catch (error) {
    throw new Error(`Failed to save temp file: ${error}`);
  }
};

registerEvent("saveTempFile", saveTempFile);