import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { firstSyncRestoreArguments } from "./first-sync-restore-arguments.js";

describe("first emulator sync restore arguments", () => {
  it("passes selected files and unresolved IDs without a separate root gate", () => {
    const args = firstSyncRestoreArguments({
      merge: {
        restoreEntryIds: ["emulator-save"],
        unresolvedRemoteEntryIds: [],
      } as unknown as Parameters<typeof firstSyncRestoreArguments>[0]["merge"],
    });

    assert.deepEqual(args[0], ["emulator-save"]);
    assert.equal(args[1], true);
    assert.deepEqual(args[2], []);
    assert.equal(args.length, 4);
  });
});
