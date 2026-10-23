import { openScreenshotReview } from "@main/services/screenshots";
import type { ScreenshotReviewScope } from "@types";
import { registerEvent } from "../register-event";

registerEvent(
  "openScreenshotReview",
  (
    _event: Electron.IpcMainInvokeEvent,
    clientId: string,
    scope?: ScreenshotReviewScope
  ) => openScreenshotReview(clientId, scope)
);
