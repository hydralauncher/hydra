import type { Game } from "@types";
import { BrowserWindow } from "electron";
import path from "node:path";

import { logger } from "./logger";
import { HydraOverlayInput } from "./hydra-overlay-input";
import { HydraOverlaySurface } from "./hydra-overlay-surface";
import { NativeAddon } from "./native-addon";
import { findOverlayGameProcesses } from "./overlay-game-process";
import { WindowManager } from "./window-manager";

type GpuLuid = { low: number; high: number };
type SharedHandle = { handle?: number };
type NativeOverlay = {
  event: {
    on: (name: string, listener: (...args: never[]) => void) => void;
    once: (name: string, listener: (...args: never[]) => void) => void;
    off: (name: string, listener: (...args: never[]) => void) => void;
  };
  setPosition: (id: number, x: unknown, y: unknown) => Promise<void>;
  setAnchor: (id: number, x: unknown, y: unknown) => Promise<void>;
  listenInput: (
    id: number,
    cursor: boolean,
    keyboard: boolean
  ) => Promise<void>;
  blockInput: (id: number, block: boolean) => Promise<void>;
  setBlockingCursor: (id: number, cursor?: number) => Promise<void>;
  updateHandle: (id: number, update: SharedHandle) => Promise<void>;
  destroy: () => void;
};
type CoreModule = {
  Overlay: {
    attach: (
      dllDirectory: string,
      pid: number,
      timeout: number
    ) => Promise<NativeOverlay>;
  };
  OverlaySurface: {
    create: (luid: GpuLuid) => {
      updateBitmap: (width: number, data: Buffer) => SharedHandle | null;
      updateShtex: (
        width: number,
        height: number,
        handle: Buffer,
        rect: {
          dstX: number;
          dstY: number;
          src: Electron.Rectangle;
        }
      ) => SharedHandle | null;
    };
  };
  defaultDllDir: () => string;
  percent: (value: number) => unknown;
};

export type InjectedOverlayStatus = {
  state:
    | "idle"
    | "locating"
    | "attaching"
    | "retrying"
    | "ready"
    | "access-denied"
    | "unsupported";
  pid?: number;
  errorCode?: number;
  detail?: string;
};

const CORE_PACKAGE = "@asdf-overlay/core";
const PROCESS_RETRY_MS = 1_000;
const ATTACH_RETRY_MS = 3_000;
const LONG_RETRY_MS = 15_000;
const INJECTION_TIMEOUT_MS = 8_000;
const GRAPHICS_TIMEOUT_MS = 30_000;
const MAX_QUICK_RETRIES_PER_PID = 3;

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const stringifyError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export class InjectedOverlayManager {
  private overlay: NativeOverlay | null = null;
  private window: BrowserWindow | null = null;
  private surface: HydraOverlaySurface | null = null;
  private input: HydraOverlayInput | null = null;
  private windowId = 0;
  private luid: GpuLuid | null = null;
  private coreModule: CoreModule | null = null;
  private attaching: Promise<boolean> | null = null;
  private game: Game | null = null;
  private visible = false;
  private requestedVisible = false;
  private pinned = false;
  private generation = 0;
  private toastTimeout: NodeJS.Timeout | null = null;
  private status: InjectedOverlayStatus = { state: "idle" };
  private onStatus: (status: InjectedOverlayStatus) => void = () => undefined;

  public setStatusHandler(handler: (status: InjectedOverlayStatus) => void) {
    this.onStatus = handler;
  }

  public getStatus() {
    return this.status;
  }

  public attach(game: Game) {
    this.detach();
    this.game = game;
    if (process.platform !== "win32") {
      this.setStatus({ state: "unsupported" });
      return Promise.resolve(false);
    }
    return this.startAttach(game);
  }

  public retry() {
    if (!this.game || process.platform !== "win32") return;
    this.generation += 1;
    this.resetRuntime();
    void this.startAttach(this.game);
  }

  public async whenReady() {
    return this.isReady();
  }

  public isReady() {
    return Boolean(
      this.overlay &&
        this.window &&
        !this.window.isDestroyed() &&
        this.windowId &&
        this.luid &&
        this.coreModule
    );
  }

  public isVisible() {
    return this.visible;
  }

  public isShowRequested() {
    return this.requestedVisible;
  }

  public async show() {
    this.requestedVisible = true;
    if (!this.isReady()) return false;
    this.clearToastTimeout();
    this.visible = true;
    this.window?.webContents.send("on-overlay-mode", "full");
    await this.connectSurface();
    if (!this.input && this.window && this.overlay) {
      this.input = HydraOverlayInput.connect(
        { id: this.windowId, overlay: this.overlay },
        this.window.webContents
      );
    }
    await this.overlay!.blockInput(this.windowId, true);
    this.window?.webContents.send("on-overlay-shown");
    return true;
  }

  public async hide() {
    this.requestedVisible = false;
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
    this.generation += 1;
    this.game = null;
    this.requestedVisible = false;
    this.pinned = false;
    this.attaching = null;
    this.resetRuntime();
    this.setStatus({ state: "idle" });
  }

  private startAttach(game: Game) {
    const generation = this.generation;
    const attaching = this.attachToGame(game, generation).finally(() => {
      if (this.generation === generation && this.attaching === attaching) {
        this.attaching = null;
      }
    });
    this.attaching = attaching;
    return attaching;
  }

  private async attachToGame(game: Game, generation: number) {
    let lastPid = 0;
    let attemptsForPid = 0;
    this.setStatus({ state: "locating" });

    while (generation === this.generation && this.game === game) {
      const candidates = await findOverlayGameProcesses(game);
      if (generation !== this.generation || this.game !== game) return false;
      if (!candidates.length) {
        await delay(PROCESS_RETRY_MS);
        continue;
      }

      let selected = candidates[0];
      let access = NativeAddon.getProcessAccessStatus(selected.pid);
      for (const candidate of candidates) {
        const candidateAccess = NativeAddon.getProcessAccessStatus(
          candidate.pid
        );
        if (candidateAccess.canInject) {
          selected = candidate;
          access = candidateAccess;
          break;
        }
      }

      if (!access.canInject) {
        logger.warn("Hydra overlay cannot access game process", {
          title: game.title,
          pid: selected.pid,
          executable: selected.exe,
          errorCode: access.errorCode,
        });
        this.setStatus({
          state: access.errorCode === 5 ? "access-denied" : "retrying",
          pid: selected.pid,
          errorCode: access.errorCode,
        });
        if (access.errorCode === 5) return false;
        await delay(ATTACH_RETRY_MS);
        continue;
      }

      if (lastPid !== selected.pid) {
        lastPid = selected.pid;
        attemptsForPid = 0;
      }
      attemptsForPid += 1;
      this.setStatus({ state: "attaching", pid: selected.pid });
      logger.info("Attaching Hydra overlay to game process", {
        title: game.title,
        pid: selected.pid,
        executable: selected.exe,
        score: selected.score,
        attempt: attemptsForPid,
      });

      try {
        await this.createRuntime(selected.pid, game, generation);
        if (generation !== this.generation || this.game !== game) return false;
        this.setStatus({ state: "ready", pid: selected.pid });
        if (this.requestedVisible) await this.show();
        else await this.showToast();
        return true;
      } catch (error) {
        if (generation !== this.generation || this.game !== game) return false;
        const detail = stringifyError(error);
        logger.warn("Windows overlay attachment failed", {
          title: game.title,
          pid: selected.pid,
          attempt: attemptsForPid,
          error: detail,
        });
        this.resetRuntime();

        if (/access denied|cannot open process/i.test(detail)) {
          this.setStatus({
            state: "access-denied",
            pid: selected.pid,
            errorCode: 5,
            detail,
          });
          return false;
        }

        this.setStatus({
          state: "retrying",
          pid: selected.pid,
          detail,
        });
        await delay(
          attemptsForPid >= MAX_QUICK_RETRIES_PER_PID
            ? LONG_RETRY_MS
            : ATTACH_RETRY_MS
        );
      }
    }

    return false;
  }

  private async createRuntime(pid: number, game: Game, generation: number) {
    const core = (await import(CORE_PACKAGE)) as unknown as CoreModule;
    const dllDirectory = core
      .defaultDllDir()
      .replace("app.asar", "app.asar.unpacked");
    const overlay = await core.Overlay.attach(
      dllDirectory,
      pid,
      INJECTION_TIMEOUT_MS
    );
    if (generation !== this.generation || this.game !== game) {
      overlay.destroy();
      throw new Error("Overlay session changed while attaching");
    }

    this.overlay = overlay;
    const [id, width, height, luid] = await this.waitForWindow(overlay);
    if (generation !== this.generation || this.game !== game) {
      throw new Error("Overlay session changed while waiting for renderer");
    }

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

    this.window = window;
    this.windowId = id;
    this.luid = luid;
    this.coreModule = core;

    await Promise.all([
      overlay.setPosition(id, core.percent(0), core.percent(0)),
      overlay.setAnchor(id, core.percent(0), core.percent(0)),
      overlay.listenInput(id, true, true),
    ]);
    overlay.event.on("destroyed", () =>
      this.recoverAfterRuntimeLoss(game, generation, "destroyed")
    );
    overlay.event.on("disconnected", () =>
      this.recoverAfterRuntimeLoss(game, generation, "disconnected")
    );
    window.on("closed", () =>
      this.recoverAfterRuntimeLoss(game, generation, "window-closed")
    );
  }

  private recoverAfterRuntimeLoss(
    game: Game,
    generation: number,
    detail: string
  ) {
    if (generation !== this.generation || this.game !== game) return;
    logger.warn("Hydra overlay runtime was lost; reconnecting", {
      title: game.title,
      detail,
    });
    this.generation += 1;
    this.resetRuntime();
    this.setStatus({ state: "retrying", detail });
    setTimeout(() => {
      if (this.game === game) void this.startAttach(game);
    }, PROCESS_RETRY_MS);
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
      }, GRAPHICS_TIMEOUT_MS);
      overlay.event.once("added", listener);
    });
  }

  private async connectSurface() {
    if (
      this.surface ||
      !this.window ||
      !this.overlay ||
      !this.coreModule ||
      !this.luid
    )
      return;
    this.surface = HydraOverlaySurface.connect(
      { id: this.windowId, overlay: this.overlay },
      this.luid,
      this.window.webContents,
      this.coreModule
    );
    this.surface.events.on("error", (error) =>
      logger.warn("Windows overlay surface update failed", error)
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

  private resetRuntime() {
    this.clearToastTimeout();
    this.visible = false;
    void this.input?.disconnect().catch(() => undefined);
    void this.surface?.disconnect().catch(() => undefined);
    this.input = null;
    this.surface = null;
    const window = this.window;
    const overlay = this.overlay;
    this.window = null;
    this.overlay = null;
    this.windowId = 0;
    this.luid = null;
    this.coreModule = null;
    window?.destroy();
    overlay?.destroy();
  }

  private clearToastTimeout() {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = null;
  }

  private setStatus(status: InjectedOverlayStatus) {
    this.status = status;
    this.onStatus(status);
  }
}

export const injectedOverlayManager = new InjectedOverlayManager();
