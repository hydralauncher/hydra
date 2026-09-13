import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const reportThemePreviewElementClicked = async (
  event: Electron.IpcMainInvokeEvent,
  selectors: string[]
) => {
  WindowManager.handleThemePreviewElementClicked(
    event.sender.id,
    Array.isArray(selectors) ? selectors : []
  );
};

registerEvent("reportThemePreviewElementClicked", reportThemePreviewElementClicked);

const updateThemePreviewCss = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  code: string
) => {
  if (!themeId) return;
  await WindowManager.updateThemePreviewCss(themeId, code);
};

registerEvent("updateThemePreviewCss", updateThemePreviewCss);
const updateThemePreviewBounds = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  bounds: { x: number; y: number; width: number; height: number }
) => {
  if (!themeId || !bounds) return;
  WindowManager.updateThemePreviewBounds(themeId, bounds);
};
registerEvent("updateThemePreviewBounds", updateThemePreviewBounds);

