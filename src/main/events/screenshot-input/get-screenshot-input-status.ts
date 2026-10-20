import { ScreenshotInputService } from "@main/services/screenshot-input";
import { registerEvent } from "../register-event";

const getScreenshotInputStatus = async () =>
  ScreenshotInputService.refreshStatus();

registerEvent("getScreenshotInputStatus", getScreenshotInputStatus);
