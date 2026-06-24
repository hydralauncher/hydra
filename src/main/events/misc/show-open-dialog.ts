import { BrowserWindow, dialog } from "electron";
import { PathGrants, WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const showOpenDialog = async (
  event: Electron.IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions
) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);

  const targetWindow =
    senderWindow && !senderWindow.isDestroyed()
      ? senderWindow
      : WindowManager.mainWindow;

  if (!targetWindow) {
    throw new Error("Main window is not available");
  }

  const result = await dialog.showOpenDialog(targetWindow, options);

  // Under Flatpak the portal file chooser may return document-portal FUSE
  // paths; record their host paths so the UI can show a familiar location.
  const displayPaths = await Promise.all(
    result.filePaths.map(async (filePath) => {
      const grant = await PathGrants.annotate(filePath);
      return grant.displayPath;
    })
  );

  return { ...result, displayPaths };
};

registerEvent("showOpenDialog", showOpenDialog);
