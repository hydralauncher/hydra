import { ipcMain } from "electron";

import { stateManager } from "@main/state-manager";

interface EventArgs {
  name: string;
  memoize?: boolean;
}

export const registerEvent = (
  listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any,
  { name, memoize = false }: EventArgs
) => {
  ipcMain.handle(name, (event: Electron.IpcMainInvokeEvent, ...args) => {
    const eventResults = stateManager.getValue("eventResults");
    const keys = Array.from(eventResults.keys());

    const key = [name, args] as [string, any[]];

    const memoizationKey = keys.find(([memoizedEvent, memoizedArgs]) => {
      const sameEvent = name === memoizedEvent;
      const sameArgs = memoizedArgs.every((arg, index) => arg === args[index]);

      return sameEvent && sameArgs;
    });

    if (memoizationKey) return eventResults.get(memoizationKey);

    return Promise.resolve(listener(event, ...args)).then((result) => {
      if (memoize) {
        eventResults.set(key, JSON.parse(JSON.stringify(result)));
        stateManager.setValue("eventResults", eventResults);
      }

      if (!result) return result;
      return JSON.parse(JSON.stringify(result));
    });
  });
};
