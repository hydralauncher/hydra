import { WindowManager } from "@main/services";
import { ipcMain } from "electron";

const TOAST_TYPES = new Set(["success", "error", "warning"]);

interface MainWindowToast {
  title: string;
  message?: string;
  type: "success" | "error" | "warning";
  duration?: number;
}

const isMainWindowToast = (value: unknown): value is MainWindowToast => {
  if (!value || typeof value !== "object") return false;

  const toast = value as Record<string, unknown>;
  return (
    typeof toast.title === "string" &&
    typeof toast.type === "string" &&
    TOAST_TYPES.has(toast.type) &&
    (toast.message === undefined || typeof toast.message === "string") &&
    (toast.duration === undefined || typeof toast.duration === "number")
  );
};

ipcMain.handle("showToastInMainWindow", (_event, toast: unknown) => {
  const mainWindow = WindowManager.mainWindow;
  if (
    !isMainWindowToast(toast) ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !mainWindow.isVisible() ||
    mainWindow.isMinimized()
  ) {
    return false;
  }

  mainWindow.webContents.send("on-show-toast", toast);
  return true;
});
