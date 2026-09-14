import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { getCloudSaveFileBrowserOperationPolicy } from "./cloud-save-v2-file-browser-policy.ts";

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
