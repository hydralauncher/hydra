import { ScreenshotReviewWindows } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent(
  "getScreenshotReviewItems",
  (event: Electron.IpcMainInvokeEvent) =>
    ScreenshotReviewWindows.getReviewItemsForSender(event.sender)
);
