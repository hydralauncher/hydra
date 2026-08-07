import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { executeCloudSaveCustomPathUntracking } from "./custom-path-untracking-policy.ts";

describe("cloud save custom path untracking", () => {
  it("publishes the removal before dropping the local binding", async () => {
    const calls: string[] = [];
    await executeCloudSaveCustomPathUntracking({
      publishRemoval: async () => {
        calls.push("publish");
      },
      removeBinding: async () => {
        calls.push("remove-binding");
      },
      dismissPendingApproval: () => {
        calls.push("dismiss");
      },
    });

    assert.deepEqual(calls, ["publish", "remove-binding", "dismiss"]);
  });

  it("keeps the binding when the remote removal fails", async () => {
    let removed = false;
    let dismissed = false;
    await assert.rejects(
      executeCloudSaveCustomPathUntracking({
        publishRemoval: async () => {
          throw new Error("remote unavailable");
        },
        removeBinding: async () => {
          removed = true;
        },
        dismissPendingApproval: () => {
          dismissed = true;
        },
      }),
      /remote unavailable/
    );

    assert.equal(removed, false);
    assert.equal(dismissed, false);
  });

  it("does not dismiss UI state when dropping the binding fails", async () => {
    let dismissed = false;
    await assert.rejects(
      executeCloudSaveCustomPathUntracking({
        publishRemoval: async () => undefined,
        removeBinding: async () => {
          throw new Error("leveldb unavailable");
        },
        dismissPendingApproval: () => {
          dismissed = true;
        },
      }),
      /cloud_save_custom_path_local_cleanup_failed/
    );

    assert.equal(dismissed, false);
  });
});
