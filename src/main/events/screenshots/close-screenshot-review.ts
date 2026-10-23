import { closeScreenshotReview } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent("closeScreenshotReview", () => closeScreenshotReview());
