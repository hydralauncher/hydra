import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { getCloudSaveFileBrowserOperationPolicy } from "./cloud-save-v2-file-browser-policy.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import { shouldShowRpcs3ProfileWarning } from "./cloud-save-v2-file-browser-policy.ts";

const operationState = (
  overrides: Partial<
    Parameters<typeof getCloudSaveFileBrowserOperationPolicy>[0]
  > = {}
) => ({
  isAddingCustomPath: false,
  isRebindingCustomPath: false,
  isRemovingCustomPath: false,
  isDeletingCloudSave: false,
  isLoading: false,
  isGameRunning: false,
  isSyncing: false,
  ...overrides,
});

describe("cloud save file browser operation policy", () => {
  it("shows the RPCS3 warning only when no cloud profile is linked", () => {
    const profile = {
      localProfileId: "00000001",
      cloudProfileIds: ["00000001", "00000002"],
      linkedCloudProfileId: null,
    };
    assert.equal(shouldShowRpcs3ProfileWarning(profile), true);
    assert.equal(
      shouldShowRpcs3ProfileWarning({
        ...profile,
        linkedCloudProfileId: "00000001",
      }),
      false
    );
    assert.equal(
      shouldShowRpcs3ProfileWarning({
        ...profile,
        linkedCloudProfileId: "00000003",
      }),
      true
    );
    assert.equal(
      shouldShowRpcs3ProfileWarning({ ...profile, cloudProfileIds: [] }),
      false
    );
    assert.equal(shouldShowRpcs3ProfileWarning(null), false);
  });

  it("allows closing while custom path operations continue", () => {
    for (const operation of [
      "isAddingCustomPath",
      "isRebindingCustomPath",
      "isRemovingCustomPath",
    ] as const) {
      assert.deepEqual(
        getCloudSaveFileBrowserOperationPolicy(
          operationState({ [operation]: true })
        ),
        {
          actionsAreDisabled: true,
          closeIsBlocked: false,
        }
      );
    }
  });

  it("keeps the modal open while all saves are being deleted", () => {
    assert.deepEqual(
      getCloudSaveFileBrowserOperationPolicy(
        operationState({ isDeletingCloudSave: true })
      ),
      {
        actionsAreDisabled: true,
        closeIsBlocked: true,
      }
    );
  });

  it("keeps the modal open while linking an RPCS3 profile", () => {
    assert.deepEqual(
      getCloudSaveFileBrowserOperationPolicy(
        operationState({ isBindingRpcs3Profile: true })
      ),
      { actionsAreDisabled: true, closeIsBlocked: true }
    );
  });

  it("disables concurrent actions without blocking ordinary closing", () => {
    for (const operation of [
      "isLoading",
      "isGameRunning",
      "isSyncing",
    ] as const) {
      assert.deepEqual(
        getCloudSaveFileBrowserOperationPolicy(
          operationState({ [operation]: true })
        ),
        {
          actionsAreDisabled: true,
          closeIsBlocked: false,
        }
      );
    }
  });
});
