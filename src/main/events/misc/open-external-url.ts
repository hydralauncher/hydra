import { BrowserWindow, app, shell } from "electron";
import { registerEvent } from "../register-event";

let mainWindow: BrowserWindow | null = null;

app.on("ready", () => {
  mainWindow = new BrowserWindow({});

  mainWindow.loadURL("file://" + __dirname + "/index.html");
});

const openExternalUrl = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => shell.openExternal(url);

registerEvent(openExternalUrl, {
  name: "openExternalUrl",
});