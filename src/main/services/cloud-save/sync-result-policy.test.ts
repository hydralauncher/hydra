import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserLocationCoverage } from "../../../types/index.ts";

import { isCloudSaveSyncPartialAfterApply } from "./sync-result-policy.ts";

const completeCoverage: UserLocationCoverage = {
  candidateId: "candidate",
  ruleId: "rule",
  selectedRoot: true,
  authority: "exact",
  outcome: "scanned",
  enumeratedCompletely: true,
  warningCodes: [],
};

describe("Cloud Save final sync state", () => {
  it("is complete after every pending remote entry was restored", () => {
    assert.equal(
      isCloudSaveSyncPartialAfterApply({
        coverage: [completeCoverage],
        unresolvedRemoteEntryIds: [],
      }),
      false
    );
  });

  it("remains partial for unresolved files, incomplete coverage or deferred changes", () => {
    assert.equal(
      isCloudSaveSyncPartialAfterApply({
        coverage: [completeCoverage],
        unresolvedRemoteEntryIds: ["remote-file"],
      }),
      true
    );
    assert.equal(
      isCloudSaveSyncPartialAfterApply({
        coverage: [
          {
            ...completeCoverage,
            outcome: "failed",
            enumeratedCompletely: false,
          },
        ],
        unresolvedRemoteEntryIds: [],
      }),
      true
    );
    assert.equal(
      isCloudSaveSyncPartialAfterApply({
        coverage: [completeCoverage],
        unresolvedRemoteEntryIds: [],
        hasDeferredLocalChanges: true,
      }),
      true
    );
  });

  it("does not mark a sync partial only because another OS has files", () => {
    assert.equal(
      isCloudSaveSyncPartialAfterApply({
        coverage: [
          {
            ...completeCoverage,
            selectedRoot: false,
            outcome: "foreign-environment",
            enumeratedCompletely: false,
          },
        ],
        unresolvedRemoteEntryIds: [],
      }),
      false
    );
  });
});
