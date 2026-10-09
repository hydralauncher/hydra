import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getBigPictureCloudSaveAction,
  shouldLoadBigPictureEmulatorDetails,
} from "./cloud-save-v2-presentation.js";

describe("getBigPictureCloudSaveAction", () => {
  it("loads file details for supported emulator providers", () => {
    assert.equal(shouldLoadBigPictureEmulatorDetails(true, "retroarch"), true);
    assert.equal(shouldLoadBigPictureEmulatorDetails(true, "rpcs3"), true);
    assert.equal(shouldLoadBigPictureEmulatorDetails(true, null), false);
    assert.equal(
      shouldLoadBigPictureEmulatorDetails(false, "retroarch"),
      false
    );
  });

  it("replaces the desktop-only details action with a safe recheck", () => {
    assert.deepEqual(
      getBigPictureCloudSaveAction({
        kind: "details",
        labelKey: "cloud_save_v2_view_files",
        icon: "details",
      }),
      {
        kind: "sync",
        labelKey: "cloud_save_v2_check_again",
        icon: "spinner",
      }
    );
  });

  it("keeps conflict resolution as a dedicated action", () => {
    assert.deepEqual(getBigPictureCloudSaveAction({ kind: "conflict" }), {
      kind: "conflict",
    });
  });

  it("keeps custom path confirmation actionable in Big Picture", () => {
    assert.deepEqual(
      getBigPictureCloudSaveAction({
        kind: "confirm-location",
        labelKey: "cloud_save_v2_confirm_location",
        icon: "folder",
      }),
      {
        kind: "sync",
        labelKey: "cloud_save_v2_confirm_location",
        icon: "folder",
      }
    );
  });
});
