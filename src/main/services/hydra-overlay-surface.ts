import { EventEmitter } from "node:events";
import type { NativeImage, Rectangle, WebContents } from "electron";

type GpuLuid = { low: number; high: number };
type SharedHandle = { handle?: number };
type OverlaySurface = {
  updateBitmap: (width: number, data: Buffer) => SharedHandle | null;
  updateShtex: (
    width: number,
    height: number,
    handle: Buffer,
    rect: {
      dstX: number;
      dstY: number;
      src: Rectangle;
    }
  ) => SharedHandle | null;
};
type SurfaceCore = {
  OverlaySurface: { create: (luid: GpuLuid) => OverlaySurface };
};
type SurfaceOverlay = {
  updateHandle: (id: number, update: SharedHandle) => Promise<void>;
};
type OverlayWindow = { id: number; overlay: SurfaceOverlay };
type PaintDetails = Electron.Event<Electron.WebContentsPaintEventParams>;

export class HydraOverlaySurface {
  public readonly events = new EventEmitter();
  private readonly surface: OverlaySurface;
  private readonly paintHandler: (
    details: PaintDetails,
    dirtyRect: Rectangle,
    image: NativeImage
  ) => void;

  private constructor(
    private readonly window: OverlayWindow,
    private readonly contents: WebContents,
    core: SurfaceCore,
    luid: GpuLuid
  ) {
    this.surface = core.OverlaySurface.create(luid);
    this.paintHandler = (details, dirtyRect, image) => {
      try {
        const update = details.texture
          ? this.paintTexture(details.texture)
          : this.paintBitmap(dirtyRect, image);
        if (update) {
          void this.window.overlay
            .updateHandle(this.window.id, update)
            .catch((error) => this.events.emit("error", error));
        }
      } catch (error) {
        this.events.emit("error", error);
      }
    };
    contents.on("paint", this.paintHandler);
    contents.invalidate();
  }

  public static connect(
    window: OverlayWindow,
    luid: GpuLuid,
    contents: WebContents,
    core: SurfaceCore
  ) {
    return new HydraOverlaySurface({ ...window }, contents, core, luid);
  }

  public async disconnect() {
    this.contents.off("paint", this.paintHandler);
    await this.window.overlay.updateHandle(this.window.id, {});
  }

  private paintTexture(texture: Electron.OffscreenSharedTexture) {
    const info = texture.textureInfo;
    try {
      if (info.widgetType !== "frame" || !info.handle.ntHandle) return null;
      const rect = info.metadata.captureUpdateRect ?? info.contentRect;
      return this.surface.updateShtex(
        info.codedSize.width,
        info.codedSize.height,
        info.handle.ntHandle,
        { dstX: rect.x, dstY: rect.y, src: rect }
      );
    } finally {
      texture.release();
    }
  }

  private paintBitmap(_dirtyRect: Rectangle, image: NativeImage) {
    const size = image.getSize();
    if (!size.width || !size.height) return null;
    return this.surface.updateBitmap(size.width, image.toBitmap());
  }
}
