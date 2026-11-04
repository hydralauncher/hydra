import { ipcMain } from "electron";

interface RegisterEventOptions {
  /** Skip the JSON round trip for results that are already plain JSON data. */
  jsonSafeResult?: boolean;
}

export const registerEvent = (
  name: string,
  // `any` is required here so listeners can declare their own typed arguments
  // (function parameter variance) and return arbitrary serializable results.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any,
  { jsonSafeResult = false }: RegisterEventOptions = {}
) => {
  ipcMain.handle(name, async (event: Electron.IpcMainInvokeEvent, ...args) => {
    return Promise.resolve(listener(event, ...args)).then((result) => {
      if (!result || jsonSafeResult) return result;
      return JSON.parse(JSON.stringify(result));
    });
  });
};
