import {
  getScreenshotsFolderPath,
  openScreenshotsFolder,
} from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent("openScreenshotsFolder", () => openScreenshotsFolder());
registerEvent("getScreenshotsFolderPath", () => getScreenshotsFolderPath());
