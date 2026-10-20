import { skipLocalScreenshot } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent(
  "skipLocalScreenshot",
  (_event: Electron.IpcMainInvokeEvent, clientId: string) =>
    skipLocalScreenshot(clientId)
);
