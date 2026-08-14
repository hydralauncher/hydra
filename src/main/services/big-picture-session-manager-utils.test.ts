import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getBigPictureAudioOperation } from "./big-picture-session-manager-utils.ts";

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
});
