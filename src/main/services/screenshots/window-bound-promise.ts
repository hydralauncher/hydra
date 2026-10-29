import type { BrowserWindow } from "electron";

export const whileWindowAlive = <T>(
  window: BrowserWindow,
  closedMessage: string,
  start: () => Promise<T>
): Promise<T> => {
  if (window.isDestroyed()) return Promise.reject(new Error(closedMessage));

  const { webContents } = window;
  return new Promise<T>((resolve, reject) => {
    const onGone = () => reject(new Error(closedMessage));
    webContents.once("destroyed", onGone);
    webContents.once("render-process-gone", onGone);
    start()
      .then(resolve, reject)
      .finally(() => {
        webContents.removeListener("destroyed", onGone);
        webContents.removeListener("render-process-gone", onGone);
      });
  });
};

export const executeWhileWindowAlive = (
  window: BrowserWindow,
  closedMessage: string,
  expression: string
) =>
  whileWindowAlive(window, closedMessage, () =>
    window.webContents.executeJavaScript(expression)
  );

export const executeWithinDeadline = (
  window: BrowserWindow,
  closedMessage: string,
  expression: string,
  timeoutMs: number,
  onTimeout: () => void
) => {
  const timer = setTimeout(onTimeout, timeoutMs);
  return executeWhileWindowAlive(window, closedMessage, expression).finally(
    () => clearTimeout(timer)
  );
};
