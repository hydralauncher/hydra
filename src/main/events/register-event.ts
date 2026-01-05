import { ipcMain } from "electron";

export const registerEvent = <T = unknown, R = unknown>(
  name: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: T[]) => R
) => {
  ipcMain.handle(name, async (event: Electron.IpcMainInvokeEvent, ...args) => {
    return Promise.resolve(listener(event, ...args)).then((result) => {
      if (!result) return result;
      return JSON.parse(JSON.stringify(result));
    });
  });
};
