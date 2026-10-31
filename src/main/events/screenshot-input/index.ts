import { ScreenshotInputService } from "@main/services/screenshot-input";
import { WindowManager } from "@main/services/window-manager";

import "./get-screenshot-input-status";

ScreenshotInputService.onStatusChange((status) => {
  WindowManager.sendToAppWindows("on-screenshot-input-status-change", status);
});
