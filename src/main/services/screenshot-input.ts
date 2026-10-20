import type { ScreenshotInputStatus, ScreenshotTriggerSource } from "@types";

type ScreenshotTriggerListener = (source: ScreenshotTriggerSource) => void;

export class ScreenshotInputService {
  private static readonly listeners = new Set<ScreenshotTriggerListener>();

  private static status: ScreenshotInputStatus = {
    active: false,
    keyboardBackend: "unavailable",
    gamepadBackend: "unavailable",
    hint: null,
  };

  public static onTrigger(listener: ScreenshotTriggerListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public static trigger(source: ScreenshotTriggerSource) {
    for (const listener of this.listeners) {
      listener(source);
    }
  }

  public static getStatus(): ScreenshotInputStatus {
    return this.status;
  }
}
