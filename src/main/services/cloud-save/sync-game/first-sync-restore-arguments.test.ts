import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { firstSyncRestoreArguments } from "./first-sync-restore-arguments.js";

describe("first emulator sync restore arguments", () => {
  it("carries verified missing-root IDs to the restore gate", () => {
    const safe = ["emulator-save"];
    const args = firstSyncRestoreArguments({
      merge: {
        restoreEntryIds: ["emulator-save"],
        unresolvedRemoteEntryIds: [],
      } as unknown as Parameters<typeof firstSyncRestoreArguments>[0]["merge"],
      safeMissingEmulatorRestoreEntryIds: safe,
    });

    assert.deepEqual(args[0], ["emulator-save"]);
    assert.equal(args[1], true);
    assert.deepEqual(args[4], safe);
  });
});
