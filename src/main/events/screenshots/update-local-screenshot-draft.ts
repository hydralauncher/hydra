import { updateLocalScreenshotDraft } from "@main/services/screenshots";
import type { LocalScreenshotDraft } from "@types";
import { registerEvent } from "../register-event";

registerEvent(
  "updateLocalScreenshotDraft",
  (
    _event: Electron.IpcMainInvokeEvent,
    clientId: string,
    draft: LocalScreenshotDraft
  ) => updateLocalScreenshotDraft(clientId, draft)
);
