import { openScreenshotReview } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent(
  "openScreenshotReview",
  (_event: Electron.IpcMainInvokeEvent, clientId: string) =>
    openScreenshotReview(clientId)
);
