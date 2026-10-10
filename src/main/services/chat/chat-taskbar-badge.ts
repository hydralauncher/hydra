import { app, BrowserWindow, nativeImage } from "electron";
import { t } from "i18next";
import { logger } from "../logger";
import { getChatBadgeLabel, renderChatBadge } from "./chat-badge-image";

// Total unread chat messages on the taskbar button or dock icon. Windows has no
// numeric badge, so the count is drawn into an overlay icon. Overlays belong to
// a window and are lost when it hides, so they are reapplied whenever a window
// is shown or closed to keep the grouped taskbar button badged.
export class ChatTaskbarBadge {
  private static count = 0;
  private static overlay: Electron.NativeImage | null = null;
  private static readonly overlays = new Map<string, Electron.NativeImage>();
  private static isTrackingWindows = false;

  public static async setCount(count: number) {
    if (count === this.count) return;
    this.count = count;

    if (process.platform !== "win32") {
      app.setBadgeCount(count);
      return;
    }

    this.trackWindows();

    try {
      const label = getChatBadgeLabel(count);
      const overlay = label ? await this.getOverlay(label) : null;
      // A newer count may have landed while this one was rendering.
      if (count !== this.count) return;

      this.overlay = overlay;
      this.applyToAllWindows();
    } catch (error) {
      logger.error("Failed to update chat taskbar badge", error);
    }
  }

  private static async getOverlay(label: string) {
    let overlay = this.overlays.get(label);
    if (!overlay) {
      overlay = nativeImage.createFromBuffer(await renderChatBadge(label));
      this.overlays.set(label, overlay);
    }
    return overlay;
  }

  private static applyTo(window: BrowserWindow) {
    if (window.isDestroyed() || !window.isVisible()) return;

    const description = this.overlay
      ? t("chat_unread_summary_title", {
          ns: "notifications",
          count: this.count,
        })
      : "";
    window.setOverlayIcon(this.overlay, description);
  }

  private static applyToAllWindows() {
    for (const window of BrowserWindow.getAllWindows()) this.applyTo(window);
  }

  private static trackWindows() {
    if (this.isTrackingWindows) return;
    this.isTrackingWindows = true;

    const track = (window: BrowserWindow) => {
      window.on("show", () => this.applyTo(window));
      window.on("closed", () => this.applyToAllWindows());
    };

    BrowserWindow.getAllWindows().forEach(track);
    app.on("browser-window-created", (_event, window) => track(window));
  }
}
