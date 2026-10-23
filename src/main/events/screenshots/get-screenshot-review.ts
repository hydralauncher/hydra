import { getScreenshotReview } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent("getScreenshotReview", () => getScreenshotReview());
