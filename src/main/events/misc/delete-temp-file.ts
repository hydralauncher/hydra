import fs from "node:fs";
import { registerEvent } from "../register-event";

const deleteTempFile = async (
  _event: Electron.IpcMainInvokeEvent,
  filePath: string
): Promise<void> => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    // Silently fail - temp files will be cleaned up by OS eventually
    console.warn(`Failed to delete temp file: ${error}`);
  }
};

registerEvent("deleteTempFile", deleteTempFile);
