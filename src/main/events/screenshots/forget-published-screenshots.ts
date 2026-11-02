import { forgetPublishedScreenshots } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent(
  "forgetPublishedScreenshots",
  (_event: Electron.IpcMainInvokeEvent, screenshotIds: string[]) =>
    forgetPublishedScreenshots(screenshotIds)
);
