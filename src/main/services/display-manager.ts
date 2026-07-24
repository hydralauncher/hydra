import { screen } from "electron";

import { db, levelKeys } from "@main/level";
import type { HydraDisplay, UserPreferences } from "@types";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";
import { resolveDisplayId, toHydraDisplays } from "./display-manager-utils";

const PRIMARY_DISPLAY_SETTLE_TIMEOUT_MS = 2_500;
const PRIMARY_DISPLAY_POLL_INTERVAL_MS = 100;
const PRIMARY_DISPLAY_POST_APPLY_DELAY_MS = 500;

export class DisplayManager {
  private static isPrimaryDisplay(display: Electron.Display) {
    const currentDisplay =
      screen
        .getAllDisplays()
        .find((nextDisplay) => nextDisplay.id === display.id) ?? display;
    const currentBounds = currentDisplay.bounds;

    return (
      screen.getPrimaryDisplay().id === display.id ||
      (currentBounds.x === 0 && currentBounds.y === 0)
    );
  }

  private static async waitForPrimaryDisplay(
    display: Electron.Display,
    timeoutMs = PRIMARY_DISPLAY_SETTLE_TIMEOUT_MS
  ) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (this.isPrimaryDisplay(display)) {
        return true;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, PRIMARY_DISPLAY_POLL_INTERVAL_MS)
      );
    }

    return false;
  }

  public static getDisplays(): HydraDisplay[] {
    const primaryDisplay = screen.getPrimaryDisplay();
    return toHydraDisplays(screen.getAllDisplays(), primaryDisplay.id);
  }

  private static async getBigPictureDisplayPreference() {
    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    return {
      id: userPreferences?.bigPictureDisplayId,
      bounds: userPreferences?.bigPictureDisplayBounds,
    };
  }

  public static async getBigPictureDisplay(): Promise<Electron.Display> {
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();
    const selectedDisplay = await this.getBigPictureDisplayPreference();

    return resolveDisplayId(
      selectedDisplay.id,
      selectedDisplay.bounds,
      displays,
      primaryDisplay.id
    );
  }

  public static async prepareBigPictureDisplayForLaunch() {
    const display = await this.getBigPictureDisplay();

    if (process.platform !== "win32") {
      return display;
    }

    try {
      if (this.isPrimaryDisplay(display)) {
        return display;
      }

      const applied = NativeAddon.setPrimaryDisplayByBounds({
        x: Math.round(display.bounds.x),
        y: Math.round(display.bounds.y),
        width: Math.round(display.bounds.width),
        height: Math.round(display.bounds.height),
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

      await new Promise((resolve) =>
        setTimeout(resolve, PRIMARY_DISPLAY_POST_APPLY_DELAY_MS)
      );
    } catch (error) {
      logger.warn("Failed to apply Big Picture primary display", error);
    }

    return display;
  }
}
