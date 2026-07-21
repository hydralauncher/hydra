import { isStaging } from "@main/constants";
import type { AchievementCustomNotificationPosition } from "@types";
import { BrowserWindow, app, screen } from "electron";
import path from "node:path";
import { AchievementNotificationPresenter } from "./achievement-notification-presenter";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";

const NOTIFICATION_WINDOW_WIDTH = 360;
const NOTIFICATION_WINDOW_HEIGHT = 140;

const getNotificationWindowPosition = (
  position: AchievementCustomNotificationPosition
) => {
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;

  const horizontal = position.endsWith("center")
    ? x + (width - NOTIFICATION_WINDOW_WIDTH) / 2
    : position.endsWith("right")
      ? x + width - NOTIFICATION_WINDOW_WIDTH
      : x;
  const vertical = position.startsWith("bottom")
    ? y + height - NOTIFICATION_WINDOW_HEIGHT
    : y;

  return { x: Math.round(horizontal), y: Math.round(vertical) };
};

class ElectronAchievementNotificationHost {
  constructor(private readonly window: BrowserWindow) {}

  public get webContentsId(): number {
    return this.window.webContents.id;
  }

  public load(): Promise<void> {
    return WindowManager.loadWindowURL(this.window, "achievement-notification");
  }

  public send(channel: string, ...args: unknown[]): void {
    this.window.webContents.send(channel, ...args);
  }

  public async setPosition(
    position: AchievementCustomNotificationPosition
  ): Promise<void> {
    const { x, y } = getNotificationWindowPosition(position);
    this.window.setPosition(x, y, false);
  }

  public showInactive(): void {
    this.window.showInactive();
  }

  public hide(): void {
    this.window.hide();
  }

  public destroy(): void {
    this.window.destroy();
  }

  public isDestroyed(): boolean {
    return this.window.isDestroyed();
  }

  public onFailure(listener: (reason: string) => void): void {
    this.window.once("focus", () =>
      listener("window unexpectedly received focus")
    );
    this.window.once("closed", () => listener("window closed unexpectedly"));
    this.window.webContents.once("render-process-gone", (_event, details) =>
      listener(`renderer process exited: ${details.reason}`)
    );
  }
}

export const achievementNotificationPresenter =
  new AchievementNotificationPresenter({
    async createHost(position) {
      const { x, y } = getNotificationWindowPosition(position);
      const notificationWindow = new BrowserWindow({
        show: false,
        transparent: true,
        maximizable: false,
        autoHideMenuBar: true,
        minimizable: false,
        backgroundColor: "#00000000",
        focusable: false,
        skipTaskbar: true,
        frame: false,
        width: NOTIFICATION_WINDOW_WIDTH,
        height: NOTIFICATION_WINDOW_HEIGHT,
        x,
        y,
        webPreferences: {
          preload: path.join(__dirname, "../preload/index.mjs"),
          sandbox: false,
        },
      });

      notificationWindow.setIgnoreMouseEvents(true);
      notificationWindow.setAlwaysOnTop(true, "screen-saver", 1);

      if (
        (!app.isPackaged || isStaging) &&
        process.env.HYDRA_NOTIFICATION_DEVTOOLS
      ) {
        notificationWindow.webContents.openDevTools({ mode: "detach" });
      }

      return new ElectronAchievementNotificationHost(notificationWindow);
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    log: (message, ...args) => logger.log(message, ...args),
    logError: (message, ...args) => logger.error(message, ...args),
  });
