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
  // paths; resolve their host paths so the UI can show a familiar location.
  //
  // We deliberately do NOT persist a grant here: most pickers are one-off
  // (profile image, theme editor, emulator setup, memory cards, ...) and
  // their doc-portal ids are ephemeral, so persisting every pick would grow
  // the sublevel unbounded and resurface long-lapsed picks as false "folder
  // access lost" toasts on later launches. Only callers that track a path
  // long-term (downloads, wine prefix, proton, executable, backup) annotate.
  const displayPaths = await Promise.all(
    result.filePaths.map((filePath) => PathGrants.getDisplayPath(filePath))
  );

  return { ...result, displayPaths };
};

registerEvent("showOpenDialog", showOpenDialog);
