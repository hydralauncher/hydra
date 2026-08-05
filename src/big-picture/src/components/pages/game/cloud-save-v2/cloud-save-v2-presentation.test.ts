import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { getBigPictureCloudSaveAction } from "./cloud-save-v2-presentation.ts";

describe("getBigPictureCloudSaveAction", () => {
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
