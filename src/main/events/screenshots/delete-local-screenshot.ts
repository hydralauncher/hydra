import { deleteLocalScreenshot } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent(
  "deleteLocalScreenshot",
  (_event: Electron.IpcMainInvokeEvent, clientId: string) =>
    deleteLocalScreenshot(clientId)
);
