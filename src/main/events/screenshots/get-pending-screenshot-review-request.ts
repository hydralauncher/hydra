import { ScreenshotReviewWindows } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent("getPendingScreenshotReviewRequest", () =>
  ScreenshotReviewWindows.takePendingBigPictureRequest()
);
