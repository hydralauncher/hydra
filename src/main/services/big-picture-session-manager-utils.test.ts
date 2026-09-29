import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createSessionOperationQueue,
  getBigPictureAudioOperation,
} from "./big-picture-session-manager-utils.ts";

describe("Big Picture audio preference", () => {
  it("restores the original device roles when sounds are disabled", () => {
    assert.deepEqual(
      getBigPictureAudioOperation({
        bigPictureSoundsEnabled: false,
        bigPictureAudioDeviceId: "selected-device",
      }),
      { type: "restore" }
    );
  });

  it("restores the original device roles for the system-default selection", () => {
    assert.deepEqual(
      getBigPictureAudioOperation({
        bigPictureSoundsEnabled: true,
        bigPictureAudioDeviceId: null,
      }),
      { type: "restore" }
    );
  });

  it("routes both roles to the selected device when sounds are enabled", () => {
    assert.deepEqual(
      getBigPictureAudioOperation({
        bigPictureSoundsEnabled: true,
        bigPictureAudioDeviceId: "selected-device",
      }),
      { type: "set", deviceId: "selected-device" }
    );
  });

  it("serializes an audio update before the following restore", async () => {
    const events: string[] = [];
    let releaseAudioUpdate: (() => void) | undefined;
    const audioUpdateFinished = new Promise<void>((resolve) => {
      releaseAudioUpdate = resolve;
    });
    let signalAudioUpdateStarted: (() => void) | undefined;
    const audioUpdateStarted = new Promise<void>((resolve) => {
      signalAudioUpdateStarted = resolve;
    });
    const queue = createSessionOperationQueue(() => undefined);

    const audioUpdate = queue.enqueue(async () => {
      events.push("audio-update-started");
      signalAudioUpdateStarted?.();
      await audioUpdateFinished;
      events.push("audio-update-finished");
    });
    await audioUpdateStarted;

    const restore = queue.enqueue(async () => {
      events.push("restored");
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(events, ["audio-update-started"]);

    releaseAudioUpdate?.();
    await Promise.all([audioUpdate, restore]);

    assert.deepEqual(events, [
      "audio-update-started",
      "audio-update-finished",
      "restored",
    ]);
  });
});
