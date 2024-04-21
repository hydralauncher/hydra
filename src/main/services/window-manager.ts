import { BrowserWindow, Menu, Tray, app } from "electron";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { t } from "i18next";
import path from "node:path";

export class WindowManager {
  public static mainWindow: Electron.BrowserWindow | null = null;

  public static createMainWindow() {
    // Create the browser window.
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 720,
      minWidth: 1024,
      minHeight: 540,
      titleBarStyle: "hidden",
      // icon: path.join(__dirname, "..", "..", "images", "icon.png"),
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

    this.mainWindow.removeMenu();

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      this.mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    } else {
      this.mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
    }

    this.mainWindow.webContents.on("did-finish-load", () => {
      if (!app.isPackaged) {
        // Open the DevTools.
        this.mainWindow.webContents.openDevTools();
      }
    });

    this.mainWindow.on("close", () => {
      WindowManager.mainWindow.setProgressBar(-1);
    });
  }

  public static redirect(path: string) {
    if (!this.mainWindow) this.createMainWindow();
    this.mainWindow.loadURL(`${MAIN_WINDOW_WEBPACK_ENTRY}#${path}`);

    if (this.mainWindow.isMinimized()) this.mainWindow.restore();
    this.mainWindow.focus();
  }

  public static createSystemTray(language: string) {
    const tray = new Tray(
      app.isPackaged
        ? path.join(process.resourcesPath, "icon_tray.png")
        : path.join(__dirname, "..", "..", "resources", "icon_tray.png")
    );

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
          if (WindowManager.mainWindow.isMinimized())
            WindowManager.mainWindow.restore();

          WindowManager.mainWindow.focus();
          return;
        }

        this.createMainWindow();
      });
    }
  }
}
