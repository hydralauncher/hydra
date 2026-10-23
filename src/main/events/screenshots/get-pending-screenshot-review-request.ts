import { ScreenshotReviewSession } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent("getPendingScreenshotReviewRequest", () =>
  ScreenshotReviewSession.takePendingBigPictureRequest()
);
