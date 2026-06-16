import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { AudioDeviceManager } from "./audio-device-manager";
import { DisplayManager } from "./display-manager";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";

type BigPictureRestoreSnapshot = {
  primaryDisplaySourceName: string | null;
  defaultAudioDeviceId: string | null;
};

export class BigPictureSessionManager {
  private static snapshot: BigPictureRestoreSnapshot | null = null;

  private static async waitForPrimaryDisplaySourceName(
    sourceName: string,
    timeoutMs = 3_000
  ) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const currentSourceName = NativeAddon.getPrimaryDisplaySourceName();

      if (currentSourceName?.toLowerCase() === sourceName.toLowerCase()) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return false;
  }

  private static async restorePrimaryDisplay(sourceName: string) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const restored = NativeAddon.setPrimaryDisplayBySourceName(sourceName);
      const settled = await this.waitForPrimaryDisplaySourceName(sourceName);

      logger.info("Big Picture primary display restore attempt", {
        sourceName,
        attempt,
        restored,
        settled,
        currentPrimary: NativeAddon.getPrimaryDisplaySourceName(),
      });

      if (restored && settled) {
        return true;
      }
    }

    return false;
  }

  public static async apply() {
    if (this.snapshot) {
      return;
    }

    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    this.snapshot = {
      primaryDisplaySourceName: NativeAddon.getPrimaryDisplaySourceName(),
      defaultAudioDeviceId: await AudioDeviceManager.getDefaultAudioDeviceId(),
    };

    logger.info("Captured Big Picture restore snapshot", this.snapshot);

    await DisplayManager.prepareBigPictureDisplayForLaunch();

    if (userPreferences?.bigPictureAudioDeviceId) {
      await AudioDeviceManager.setDefaultAudioDevice(
        userPreferences.bigPictureAudioDeviceId
      );
    }
  }

  public static async restore() {
    const snapshot = this.snapshot;
    this.snapshot = null;

    if (!snapshot) {
      return;
    }

    if (snapshot.primaryDisplaySourceName) {
      const restored = await this.restorePrimaryDisplay(
        snapshot.primaryDisplaySourceName
      );

      if (!restored) {
        logger.warn("Could not restore Big Picture primary display", {
          sourceName: snapshot.primaryDisplaySourceName,
        });
      }
    }

    if (snapshot.defaultAudioDeviceId) {
      await AudioDeviceManager.setDefaultAudioDevice(
        snapshot.defaultAudioDeviceId
      );
    }
  }
}
