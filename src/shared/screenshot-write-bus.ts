import type { ScreenshotPatch } from "./screenshot-feed-writes";

export interface ScreenshotBusWrite {
  screenshotId: string;
  patch: ScreenshotPatch | null;
}

type ScreenshotBusListener = (write: ScreenshotBusWrite) => void;

export function createScreenshotWriteBus() {
  const listeners = new Set<ScreenshotBusListener>();

  const subscribe = (listener: ScreenshotBusListener) => {
    listeners.add(listener);

    return {
      publish: (write: ScreenshotBusWrite) => {
        for (const other of listeners) {
          if (other !== listener) other(write);
        }
      },
      unsubscribe: () => {
        listeners.delete(listener);
      },
    };
  };

  return { subscribe };
}

export type ScreenshotWriteBus = ReturnType<typeof createScreenshotWriteBus>;
