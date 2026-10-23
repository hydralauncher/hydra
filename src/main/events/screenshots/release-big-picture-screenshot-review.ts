import { releaseBigPictureScreenshotReview } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent(
  "releaseBigPictureScreenshotReview",
  (_event: Electron.IpcMainInvokeEvent, clientIds: string[]) =>
    releaseBigPictureScreenshotReview(clientIds)
);
