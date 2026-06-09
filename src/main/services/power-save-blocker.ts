import { powerSaveBlocker } from "electron";
import { logger } from "./logger";

export class PowerSaveBlockerManager {
  private static blockerId: number | null = null;

  private static downloadActive = false;

  private static compatibilityGameActive = false;

  private static compatibilityLaunches = new Set<string>();

  private static ensureStarted() {
    if (this.blockerId !== null && powerSaveBlocker.isStarted(this.blockerId)) {
      return;
    }

    this.blockerId = powerSaveBlocker.start("prevent-display-sleep");
    logger.info("Power save blocker enabled", {
      blockerId: this.blockerId,
      downloadActive: this.downloadActive,
      compatibilityGameActive: this.compatibilityGameActive,
    });
  }

  private static ensureStopped() {
    if (
      this.blockerId === null ||
      !powerSaveBlocker.isStarted(this.blockerId)
    ) {
      this.blockerId = null;
      return;
    }

    powerSaveBlocker.stop(this.blockerId);
    logger.info("Power save blocker disabled", {
      blockerId: this.blockerId,
    });
    this.blockerId = null;
  }

  public static markCompatibilityLaunchStarted(gameKey: string) {
    this.compatibilityLaunches.add(gameKey);
  }

  public static markGameClosed(gameKey: string) {
    this.compatibilityLaunches.delete(gameKey);
  }

  public static hasRunningCompatibilityGame(runningGameKeys: Iterable<string>) {
    for (const gameKey of runningGameKeys) {
      if (this.compatibilityLaunches.has(gameKey)) {
        return true;
      }
    }

    return false;
  }

  public static syncState(options: {
    downloadActive: boolean;
    compatibilityGameActive: boolean;
  }) {
    this.downloadActive = options.downloadActive;
    this.compatibilityGameActive = options.compatibilityGameActive;

    if (this.downloadActive || this.compatibilityGameActive) {
      this.ensureStarted();
      return;
    }

    this.ensureStopped();
  }

  public static reset() {
    this.downloadActive = false;
    this.compatibilityGameActive = false;
    this.compatibilityLaunches.clear();
    this.ensureStopped();
  }
}
