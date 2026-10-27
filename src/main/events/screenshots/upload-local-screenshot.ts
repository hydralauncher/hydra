import { uploadLocalScreenshot } from "@main/services/screenshots";
import type { LocalScreenshotUploadOptions } from "@types";
import { registerEvent } from "../register-event";

registerEvent(
  "uploadLocalScreenshot",
  (
    _event: Electron.IpcMainInvokeEvent,
    clientId: string,
    options: LocalScreenshotUploadOptions
  ) => uploadLocalScreenshot(clientId, options)
);
