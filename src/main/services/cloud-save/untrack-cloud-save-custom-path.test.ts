import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { executeCloudSaveCustomPathUntracking } from "./custom-path-untracking-policy.ts";

describe("cloud save custom path untracking", () => {
  it("persists the local ignore before clearing pending UI state", async () => {
    const calls: string[] = [];
    await executeCloudSaveCustomPathUntracking({
      ignore: async () => {
        calls.push("ignore");
      },
      dismissPendingApproval: () => {
        calls.push("dismiss");
      },
    });

    assert.deepEqual(calls, ["ignore", "dismiss"]);
  });

  it("does not clear pending state when the local ignore cannot be persisted", async () => {
    let dismissed = false;
    await assert.rejects(
      executeCloudSaveCustomPathUntracking({
        ignore: async () => {
          throw new Error("leveldb unavailable");
        },
        dismissPendingApproval: () => {
          dismissed = true;
        },
      }),
      /leveldb unavailable/
    );

    assert.equal(dismissed, false);
  });
});
