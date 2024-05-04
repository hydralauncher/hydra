import { BrowserWindow, Menu, Tray, app } from "electron";
import { is } from "@electron-toolkit/utils";
import { t } from "i18next";
import path from "node:path";
import icon from "@resources/icon.png?asset";
import trayIcon from "@resources/tray-icon.png?asset";
import { userPreferencesRepository } from "@main/repository";

export class WindowManager {
  public static mainWindow: Electron.BrowserWindow | null = null;

  private static loadURL(hash = "") {
    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      this.mainWindow?.loadURL(
        `${process.env["ELECTRON_RENDERER_URL"]}#/${hash}`
      );
    } else {
      this.mainWindow?.loadFile(
        path.join(__dirname, "../renderer/index.html"),
        {
          hash,
        }
      );
    }
  }

  public static async createMainWindow() {
    // Create the browser window.
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 720,
      minWidth: 1024,
      minHeight: 540,
      titleBarStyle: "hidden",
      ...(process.platform === "linux" ? { icon } : {}),
      trafficLightPosition: { x: 16, y: 16 },
      titleBarOverlay: {
        symbolColor: "#DADBE1",
        color: "#151515",
        height: 34,
      },
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
    });

    this.loadURL();
    this.mainWindow.removeMenu();

    this.mainWindow.on("ready-to-show", () => {
      if (!app.isPackaged) WindowManager.mainWindow?.webContents.openDevTools();
    });

    this.mainWindow.on("close", async () => {
      const userPreferences = await userPreferencesRepository.findOne({
        where: { id: 1 },
      });

      if (userPreferences?.preferQuitInsteadOfHiding) {
        app.quit();
      }
      WindowManager.mainWindow?.setProgressBar(-1);
    });
  }

  public static redirect(hash: string) {
    if (!this.mainWindow) this.createMainWindow();
    this.loadURL(hash);

    if (this.mainWindow?.isMinimized()) this.mainWindow.restore();
    this.mainWindow?.focus();
  }

  public static createSystemTray(language: string) {
    const tray = new Tray(trayIcon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: t("open", {
          ns: "system_tray",
          lng: language,
        }),
        type: "normal",
        click: () => {
          if (this.mainWindow) {
            this.mainWindow.show();
          } else {
            this.createMainWindow();
          }
        },
      },
      {
        label: t("quit", {
          ns: "system_tray",
          lng: language,
        }),
        type: "normal",
        click: () => app.quit(),
      },
    ]);

    tray.setToolTip("Hydra");
    tray.setContextMenu(contextMenu);

    if (process.platform === "win32") {
      tray.addListener("click", () => {
        if (this.mainWindow) {
          if (WindowManager.mainWindow?.isMinimized())
            WindowManager.mainWindow.restore();

          WindowManager.mainWindow?.focus();
          return;
        }

        this.createMainWindow();
      });
    }
  }
}
