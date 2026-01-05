import { ipcMain } from "electron";

export const registerEvent = <Args extends any[] = any[], R = any>(
  name: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: Args) => R
) => {
  ipcMain.handle(name, async (event: Electron.IpcMainInvokeEvent, ...args) => {
    return Promise.resolve(listener(event, ...(args as Args))).then(
      (result) => {
        if (!result) return result;
        return JSON.parse(JSON.stringify(result));
      }
    );
  });
};
