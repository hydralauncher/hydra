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

const RESTORE_PRIMARY_DISPLAY_MAX_ATTEMPTS = 3;
const RESTORE_PRIMARY_DISPLAY_TIMEOUT_MS = 3_000;
const RESTORE_PRIMARY_DISPLAY_POLL_INTERVAL_MS = 100;

export class BigPictureSessionManager {
  private static snapshot: BigPictureRestoreSnapshot | null = null;
  private static sessionOperationQueue: Promise<void> = Promise.resolve();
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

  private static enqueueSessionOperation(operation: () => Promise<void>) {
    const operationPromise = this.sessionOperationQueue
      .catch((error) => {
        logger.warn("Previous Big Picture session operation failed", error);
      })
      .then(operation);

    this.sessionOperationQueue = operationPromise.then(
      () => undefined,
      () => undefined
    );

    return operationPromise;
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

  public static apply() {
    return this.enqueueSessionOperation(() => this.applyInternal());
  }

  public static async applyAudioPreference(userPreferences: UserPreferences) {
    if (this.snapshot === null || this.isRestoring) {
      return false;
    }

    const targetAudioDeviceId =
      userPreferences.bigPictureSoundsEnabled === false
        ? this.snapshot.defaultAudioDeviceId
        : (userPreferences.bigPictureAudioDeviceId ??
          this.snapshot.defaultAudioDeviceId);

    return AudioDeviceManager.setDefaultAudioDevice(targetAudioDeviceId);
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

    if (snapshot.defaultAudioDeviceId) {
      await AudioDeviceManager.setDefaultAudioDevice(
        snapshot.defaultAudioDeviceId
      );
    }
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
