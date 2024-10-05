import { ipcMain } from "electron";

export const registerEvent = (
  name: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
) => {
  ipcMain.handle(name, async (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    return Promise.resolve(listener(event, ...args)).then((result) => {
      if (!result) return result;
      return JSON.parse(JSON.stringify(result)); // Garante que o objeto é serializável
    });
  });
};
