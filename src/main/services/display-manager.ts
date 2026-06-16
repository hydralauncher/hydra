import { screen } from "electron";

import { db, levelKeys } from "@main/level";
import type { HydraDisplay, UserPreferences } from "@types";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";
import { resolveDisplayId, toHydraDisplays } from "./display-manager-utils";

export class DisplayManager {
  private static async waitForPrimaryDisplay(
    display: Electron.Display,
    timeoutMs = 2_500
  ) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const primaryDisplay = screen.getPrimaryDisplay();
      const primaryBounds = primaryDisplay.bounds;

      if (
        primaryDisplay.id === display.id ||
        (primaryBounds.x === 0 &&
          primaryBounds.y === 0 &&
          Math.round(primaryBounds.width) === Math.round(display.bounds.width) &&
          Math.round(primaryBounds.height) ===
            Math.round(display.bounds.height))
      ) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return false;
  }

  public static getDisplays(): HydraDisplay[] {
    const primaryDisplay = screen.getPrimaryDisplay();
    return toHydraDisplays(screen.getAllDisplays(), primaryDisplay.id);
  }

  private static async getBigPictureDisplayId() {
    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    return userPreferences?.bigPictureDisplayId;
  }

  public static async getBigPictureDisplay(): Promise<Electron.Display> {
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();
    const selectedDisplayId = await this.getBigPictureDisplayId();

    return resolveDisplayId(selectedDisplayId, displays, primaryDisplay.id);
  }

  public static async prepareBigPictureDisplayForLaunch() {
    const display = await this.getBigPictureDisplay();

    if (process.platform !== "win32") {
      return display;
    }

    try {
      const applied = NativeAddon.setPrimaryDisplayByBounds({
        x: Math.round(display.bounds.x),
        y: Math.round(display.bounds.y),
        width: Math.round(display.size.width),
        height: Math.round(display.size.height),
      });

      if (!applied) {
        logger.warn("Could not apply Big Picture primary display", {
          displayId: display.id,
          bounds: display.bounds,
        });
      }

      const primaryDisplaySettled = await this.waitForPrimaryDisplay(display);

      if (!primaryDisplaySettled) {
        logger.warn("Timed out waiting for Big Picture primary display", {
          displayId: display.id,
          bounds: display.bounds,
          primaryDisplay: screen.getPrimaryDisplay().bounds,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      logger.warn("Failed to apply Big Picture primary display", error);
    }

    return display;
  }
}
