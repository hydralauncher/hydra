import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { AudioDeviceManager } from "./audio-device-manager";
import type { AudioDeviceDefaults } from "./audio-device-manager-utils";
import {
  createSessionOperationQueue,
  getBigPictureAudioOperation,
} from "./big-picture-session-manager-utils";
import { DisplayManager } from "./display-manager";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";

type BigPictureRestoreSnapshot = {
  primaryDisplaySourceName: string | null;
  defaultAudioDevices: AudioDeviceDefaults;
};

const RESTORE_PRIMARY_DISPLAY_MAX_ATTEMPTS = 3;
const RESTORE_PRIMARY_DISPLAY_TIMEOUT_MS = 3_000;
const RESTORE_PRIMARY_DISPLAY_POLL_INTERVAL_MS = 100;

export class BigPictureSessionManager {
  private static snapshot: BigPictureRestoreSnapshot | null = null;
  private static readonly sessionOperationQueue = createSessionOperationQueue(
    (error) => {
      logger.warn("Previous Big Picture session operation failed", error);
    }
  );
  private static isRestoring = false;

  private static async waitForPrimaryDisplaySourceName(
    sourceName: string,
    timeoutMs = RESTORE_PRIMARY_DISPLAY_TIMEOUT_MS
  ) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const currentSourceName = NativeAddon.getPrimaryDisplaySourceName();

      if (currentSourceName?.toLowerCase() === sourceName.toLowerCase()) {
        return true;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, RESTORE_PRIMARY_DISPLAY_POLL_INTERVAL_MS)
      );
    }

    return false;
  }

  private static async restorePrimaryDisplay(sourceName: string) {
    for (
      let attempt = 1;
      attempt <= RESTORE_PRIMARY_DISPLAY_MAX_ATTEMPTS;
      attempt++
    ) {
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

  private static enqueueSessionOperation<T>(operation: () => Promise<T>) {
    return this.sessionOperationQueue.enqueue(operation);
  }

  private static async applyInternal() {
    if (this.snapshot !== null) {
      return;
    }

    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    this.snapshot = {
      primaryDisplaySourceName: NativeAddon.getPrimaryDisplaySourceName(),
      defaultAudioDevices: await AudioDeviceManager.getDefaultAudioDevices(),
    };

    logger.info("Captured Big Picture restore snapshot", this.snapshot);

    await DisplayManager.prepareBigPictureDisplayForLaunch();

    if (
      userPreferences?.bigPictureSoundsEnabled !== false &&
      userPreferences?.bigPictureAudioDeviceId
    ) {
      await AudioDeviceManager.setDefaultAudioDevice(
        userPreferences.bigPictureAudioDeviceId
      );
    }
  }

  public static apply() {
    return this.enqueueSessionOperation(() => this.applyInternal());
  }

  public static applyAudioPreference(userPreferences: UserPreferences) {
    return this.enqueueSessionOperation(async () => {
      if (this.snapshot === null || this.isRestoring) {
        return false;
      }

      const operation = getBigPictureAudioOperation(userPreferences);

      if (operation.type === "restore") {
        return AudioDeviceManager.restoreDefaultAudioDevices(
          this.snapshot.defaultAudioDevices
        );
      }

      return AudioDeviceManager.setDefaultAudioDevice(operation.deviceId);
    });
  }

  public static applyDisplayPreference() {
    return this.enqueueSessionOperation(async () => {
      if (this.snapshot === null || this.isRestoring) {
        return;
      }

      await DisplayManager.prepareBigPictureDisplayForLaunch();
    });
  }

  private static async restoreSnapshot(snapshot: BigPictureRestoreSnapshot) {
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

    await AudioDeviceManager.restoreDefaultAudioDevices(
      snapshot.defaultAudioDevices
    );
  }

  private static async restoreInternal() {
    const snapshot = this.snapshot;

    if (snapshot === null) {
      return;
    }

    this.isRestoring = true;

    try {
      await this.restoreSnapshot(snapshot);
    } finally {
      if (this.snapshot === snapshot) {
        this.snapshot = null;
      }

      this.isRestoring = false;
    }
  }

  public static restore() {
    return this.enqueueSessionOperation(() => this.restoreInternal());
  }
}
