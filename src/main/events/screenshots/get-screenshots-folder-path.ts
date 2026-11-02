import { getScreenshotsFolderPath } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent("getScreenshotsFolderPath", () => getScreenshotsFolderPath());
