import type { Game } from "@types";
import type { GpuLuid, Overlay as NativeOverlay } from "@asdf-overlay/core";
import { BrowserWindow } from "electron";
import path from "node:path";

import { logger } from "./logger";
import { findOverlayGameProcess } from "./overlay-game-process";
import { WindowManager } from "./window-manager";

type CoreModule = typeof import("@asdf-overlay/core");
type SurfaceConnection = {
  disconnect: () => Promise<void>;
  events: { on: (name: string, listener: (error: unknown) => void) => void };
};
type InputConnection = { disconnect: () => Promise<void> };
type SurfaceModule = {
  ElectronOverlaySurface: {
    connect: (
      window: { id: number; overlay: NativeOverlay },
      luid: GpuLuid,
      contents: Electron.WebContents
    ) => SurfaceConnection;
  };
};
type InputModule = {
  ElectronOverlayInput: {
    connect: (
      window: { id: number; overlay: NativeOverlay },
      contents: Electron.WebContents
    ) => InputConnection;
  };
};

const CORE_PACKAGE = "@asdf-overlay/core";
const SURFACE_PACKAGE = "@asdf-overlay/electron/surface";
const INPUT_PACKAGE = "@asdf-overlay/electron/input";

export class InjectedOverlayManager {
  private overlay: NativeOverlay | null = null;
  private window: BrowserWindow | null = null;
  private surface: SurfaceConnection | null = null;
  private input: InputConnection | null = null;
  private windowId = 0;
  private luid: GpuLuid | null = null;
  private surfaceModule: SurfaceModule | null = null;
  private inputModule: InputModule | null = null;
  private attaching: Promise<boolean> | null = null;
  private visible = false;
  private pinned = false;
  private generation = 0;
  private toastTimeout: NodeJS.Timeout | null = null;

  public attach(game: Game) {
    this.detach();
    if (process.platform !== "win32") return Promise.resolve(false);
    const generation = this.generation;
    this.attaching = this.attachToGame(game, generation).finally(() => {
      if (this.generation === generation) this.attaching = null;
    });
    return this.attaching;
  }

  public async whenReady() {
    if (this.attaching) return this.attaching;
    return this.isReady();
  }

  public isReady() {
    return Boolean(
      this.overlay &&
        this.window &&
        !this.window.isDestroyed() &&
        this.windowId &&
        this.luid &&
        this.surfaceModule &&
        this.inputModule
    );
  }

  public isVisible() {
    return this.visible;
  }

  public async show() {
    if (!this.isReady()) return false;
    this.clearToastTimeout();
    this.visible = true;
    this.window?.webContents.send("on-overlay-mode", "full");
    await this.connectSurface();
    if (!this.input && this.window && this.overlay && this.inputModule) {
      this.input = this.inputModule.ElectronOverlayInput.connect(
        { id: this.windowId, overlay: this.overlay },
        this.window.webContents
      );
    }
    await this.overlay!.blockInput(this.windowId, true);
    this.window?.webContents.send("on-overlay-shown");
    return true;
  }

  public async hide() {
    this.clearToastTimeout();
    this.visible = false;
    if (!this.isReady()) return;
    await this.overlay!.blockInput(this.windowId, false).catch(() => undefined);
    await this.input?.disconnect().catch(() => undefined);
    this.input = null;
    if (this.pinned) {
      this.window?.webContents.send("on-overlay-mode", "pinned");
      await this.connectSurface();
      this.window?.webContents.invalidate();
    } else {
      this.window?.webContents.send("on-overlay-mode", "hidden");
      await this.disconnectSurface();
    }
  }

  public async setPinned(pinned: boolean) {
    this.pinned = pinned;
    if (!this.isReady() || this.visible) return;
    if (pinned) {
      this.window?.webContents.send("on-overlay-mode", "pinned");
      await this.connectSurface();
      this.window?.webContents.invalidate();
    } else {
      this.window?.webContents.send("on-overlay-mode", "hidden");
      await this.disconnectSurface();
    }
  }

  public send(channel: string, ...args: unknown[]) {
    this.window?.webContents.send(channel, ...args);
  }

  public detach() {
    this.clearToastTimeout();
    this.generation += 1;
    this.visible = false;
    this.pinned = false;
    this.attaching = null;
    void this.input?.disconnect().catch(() => undefined);
    void this.surface?.disconnect().catch(() => undefined);
    this.input = null;
    this.surface = null;
    const window = this.window;
    this.window = null;
    const overlay = this.overlay;
    this.overlay = null;
    window?.destroy();
    overlay?.destroy();
    this.windowId = 0;
    this.luid = null;
  }

  private async attachToGame(game: Game, generation: number) {
    try {
      const gameProcess = await findOverlayGameProcess(game);
      if (!gameProcess || generation !== this.generation) return false;

      const core = (await import(CORE_PACKAGE)) as unknown as CoreModule;
      const [surfaceModule, inputModule] = await Promise.all([
        import(SURFACE_PACKAGE) as unknown as Promise<SurfaceModule>,
        import(INPUT_PACKAGE) as unknown as Promise<InputModule>,
      ]);
      const dllDirectory = core
        .defaultDllDir()
        .replace("app.asar", "app.asar.unpacked");
      const overlay = await core.Overlay.attach(
        dllDirectory,
        gameProcess.pid,
        8_000
      );
      if (generation !== this.generation) {
        overlay.destroy();
        return false;
      }

      const [id, width, height, luid] = await this.waitForWindow(overlay);
      const window = new BrowserWindow({
        width,
        height,
        show: false,
        transparent: true,
        backgroundColor: "#00000000",
        frame: false,
        webPreferences: {
          offscreen: { useSharedTexture: true },
          preload: path.join(__dirname, "../preload/index.mjs"),
          sandbox: false,
          backgroundThrottling: false,
        },
      });
      window.webContents.setFrameRate(60);
      window.webContents.stopPainting();
      const loaded = new Promise<void>((resolve) =>
        window.webContents.once("did-finish-load", () => resolve())
      );
      await WindowManager.loadWindowURL(window, "overlay");
      await loaded;

      this.overlay = overlay;
      this.window = window;
      this.windowId = id;
      this.luid = luid;
      this.surfaceModule = surfaceModule;
      this.inputModule = inputModule;

      await Promise.all([
        overlay.setPosition(id, core.percent(0), core.percent(0)),
        overlay.setAnchor(id, core.percent(0), core.percent(0)),
        overlay.listenInput(id, true, true),
      ]);
      overlay.event.on("destroyed", () => this.detach());
      overlay.event.on("disconnected", () => this.detach());
      window.on("closed", () => {
        if (this.window === window) this.detach();
      });
      await this.showToast();
      return true;
    } catch (error) {
      logger.warn("DirectX overlay attachment failed", error);
      if (generation === this.generation) this.detach();
      return false;
    }
  }

  private waitForWindow(overlay: NativeOverlay) {
    return new Promise<[number, number, number, GpuLuid]>((resolve, reject) => {
      const listener = (
        id: number,
        width: number,
        height: number,
        luid: GpuLuid
      ) => {
        clearTimeout(timeout);
        resolve([id, width, height, luid]);
      };
      const timeout = setTimeout(() => {
        overlay.event.off("added", listener);
        reject(new Error("Timed out waiting for a supported graphics surface"));
      }, 10_000);
      overlay.event.once("added", listener);
    });
  }

  private async connectSurface() {
    if (
      this.surface ||
      !this.window ||
      !this.overlay ||
      !this.surfaceModule ||
      !this.luid
    )
      return;
    this.surface = this.surfaceModule.ElectronOverlaySurface.connect(
      { id: this.windowId, overlay: this.overlay },
      this.luid,
      this.window.webContents
    );
    this.surface.events.on("error", (error) =>
      logger.warn("DirectX overlay surface update failed", error)
    );
    this.window.webContents.startPainting();
    this.window.webContents.invalidate();
  }

  private async disconnectSurface() {
    this.window?.webContents.stopPainting();
    await this.surface?.disconnect().catch(() => undefined);
    this.surface = null;
  }

  private async showToast() {
    if (!this.isReady() || this.visible) return;
    this.window?.webContents.send("on-overlay-mode", "toast");
    await this.connectSurface();
    this.window?.webContents.invalidate();
    this.toastTimeout = setTimeout(() => {
      this.toastTimeout = null;
      if (this.visible || !this.isReady()) return;
      if (this.pinned) {
        this.window?.webContents.send("on-overlay-mode", "pinned");
        this.window?.webContents.invalidate();
      } else {
        this.window?.webContents.send("on-overlay-mode", "hidden");
        void this.disconnectSurface();
      }
    }, 8_000);
  }

  private clearToastTimeout() {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = null;
  }
}

export const injectedOverlayManager = new InjectedOverlayManager();
