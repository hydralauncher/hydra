import { app, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WindowManager } from "../../services/window-manager";
import {
  getEpicConnection,
  startEpicAuth,
  cancelEpicAuth,
  disconnectEpic,
  startEpicSync,
  getEpicSyncState,
  cancelEpicSync,
  syncEpicGameOnGamePage,
} from "../../services/epic";
import { registerEvent } from "../register-event";
import { isTrustedEpicSender } from "./epic-ipc-sender";

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  allowBigPicture = false
) {
  const window = allowBigPicture
    ? WindowManager.appWindows.find(
        (candidate) => candidate?.webContents.id === event.sender.id
      )
    : WindowManager.mainWindow;
  const rendererUrls = [
    pathToFileURL(path.join(__dirname, "../renderer/index.html")).href,
  ];
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    rendererUrls.push(process.env.ELECTRON_RENDERER_URL);
  }
  const subdomain = import.meta.env.MAIN_VITE_LAUNCHER_SUBDOMAIN;
  if (subdomain) {
    rendererUrls.push(
      `https://release-v${app.getVersion().replaceAll(".", "-")}.${subdomain}`
    );
  }
  if (
    !isTrustedEpicSender(
      {
        id: event.sender.id,
        isMainFrame:
          !!window && event.senderFrame === window.webContents.mainFrame,
        url: event.senderFrame?.url ?? "",
      },
      window && !window.isDestroyed() ? window.webContents.id : null,
      rendererUrls
    )
  ) {
    throw new Error("epic-ipc-untrusted");
  }
}

registerEvent("getEpicConnection", (event) => {
  assertTrustedSender(event);
  return getEpicConnection();
});
registerEvent("startEpicAuth", (event) => {
  assertTrustedSender(event);
  return startEpicAuth();
});
registerEvent("cancelEpicAuth", (event, operationId: string) => {
  assertTrustedSender(event);
  return cancelEpicAuth(operationId);
});
registerEvent("disconnectEpic", (event, connectionId: string) => {
  assertTrustedSender(event);
  return disconnectEpic(connectionId);
});

registerEvent("startEpicSync", (event, connectionId: string) => {
  assertTrustedSender(event, true);
  return startEpicSync(connectionId);
});
registerEvent("getEpicSyncState", (event) => {
  assertTrustedSender(event, true);
  return getEpicSyncState();
});
registerEvent("cancelEpicSync", (event, connectionId: string) => {
  assertTrustedSender(event, true);
  return cancelEpicSync(connectionId);
});
registerEvent("syncEpicGameOnGamePage", (event, objectId: string) => {
  assertTrustedSender(event, true);
  return syncEpicGameOnGamePage(objectId);
});
