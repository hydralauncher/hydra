import { ScreenshotFeedback } from "@main/services/screenshots/screenshot-feedback";
import { registerEvent } from "../register-event";

registerEvent("screenshotFlashReady", (event: Electron.IpcMainInvokeEvent) => {
  ScreenshotFeedback.markFlashWindowReady(event.sender);
});
