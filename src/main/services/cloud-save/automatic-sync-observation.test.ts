import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  beginAutomaticSyncObservation,
  buildCloudSaveObservationKey,
  clearAutomaticSyncObservationState,
  finishAutomaticSyncObservation,
  recordLatestCloudSaveObservation,
} from "./automatic-sync-observation.ts";

const analysis = (
  overrides: Record<string, unknown> = {}
): Parameters<typeof buildCloudSaveObservationKey>[0] =>
  ({
    environmentId: "environment",
    localSnapshot: {
      manifestKey: "manifest",
      ruleSourceRevision: "rules",
      discoveryEngineVersion: 3,
      aggregateHash: "local",
      coverage: [],
    },
    activeRemoteSnapshot: {
      id: "snapshot",
      version: 1,
      aggregateHash: "remote",
    },
    anchor: null,
    customPathBindings: { ready: [], unresolved: [] },
    mergedCustomPathRawPaths: [],
    ...overrides,
  }) as unknown as Parameters<typeof buildCloudSaveObservationKey>[0];

describe("automatic cloud save observation", () => {
  beforeEach(() => clearAutomaticSyncObservationState());

  it("keys local, remote, environment, bindings and coverage state", () => {
    const original = analysis();
    const originalKey = buildCloudSaveObservationKey(original);

    assert.notEqual(
      buildCloudSaveObservationKey(
        analysis({
          localSnapshot: { ...original.localSnapshot, aggregateHash: "new" },
        })
      ),
      originalKey
    );
    assert.notEqual(
      buildCloudSaveObservationKey(analysis({ environmentId: "other" })),
      originalKey
    );
    assert.notEqual(
      buildCloudSaveObservationKey(
        analysis({
          activeRemoteSnapshot: {
            ...original.activeRemoteSnapshot!,
            version: 2,
          },
        })
      ),
      originalKey
    );
    assert.notEqual(
      buildCloudSaveObservationKey(
        analysis({
          customPathBindings: {
            ready: [
              {
                rawPath: "<custom><windows>C:/Saves",
                path: "C:/Saves",
                platform: "windows",
              },
            ],
            unresolved: [],
          },
        })
      ),
      originalKey
    );
    assert.notEqual(
      buildCloudSaveObservationKey(
        analysis({
          localSnapshot: {
            ...original.localSnapshot,
            coverage: [
              {
                candidateId: "candidate",
                ruleId: "rule",
                selectedRoot: true,
                authority: "exact",
                outcome: "scanned",
                enumeratedCompletely: true,
                warningCodes: [],
              },
            ],
          },
        })
      ),
      originalKey
    );
  });

  it("normalizes unordered observation collections", () => {
    const original = analysis();
    const coverage = {
      candidateId: "candidate",
      ruleId: "rule",
      selectedRoot: true,
      authority: "exact",
      outcome: "scanned",
      enumeratedCompletely: true,
    };
    const withOrder = (
      unresolvedRemoteEntryIds: string[],
      ignoredCustomPathRawPaths: string[],
      warningCodes: string[]
    ) =>
      analysis({
        anchor: {
          baseSnapshotId: "base",
          baseVersion: 1,
          baseAggregateHash: "aggregate",
          unresolvedRemoteEntryIds,
        },
        ignoredCustomPathRawPaths,
        localSnapshot: {
          ...original.localSnapshot,
          coverage: [{ ...coverage, warningCodes }],
        },
      });

    assert.equal(
      buildCloudSaveObservationKey(
        withOrder(["second", "first"], ["z-path", "a-path"], ["z", "a"])
      ),
      buildCloudSaveObservationKey(
        withOrder(["first", "second"], ["a-path", "z-path"], ["a", "z"])
      )
    );
  });

  it("orders canonically equivalent text by code units", () => {
    const composed = "Caf\u00e9.sav";
    const decomposed = "Cafe\u0301.sav";
    const withUnresolvedEntries = (unresolvedRemoteEntryIds: string[]) =>
      analysis({
        anchor: {
          baseSnapshotId: "base",
          baseVersion: 1,
          baseAggregateHash: "aggregate",
          unresolvedRemoteEntryIds,
        },
      });

    assert.equal(
      buildCloudSaveObservationKey(
        withUnresolvedEntries([composed, decomposed])
      ),
      buildCloudSaveObservationKey(
        withUnresolvedEntries([decomposed, composed])
      )
    );
  });

  it("runs once for an observed state and runs again after it changes", () => {
    recordLatestCloudSaveObservation("10", "steam", "first");
    const first = beginAutomaticSyncObservation(
      "10",
      "steam",
      "game-page-open",
      1
    );
    assert.equal(first.accepted, true);
    finishAutomaticSyncObservation(
      "10",
      "steam",
      "game-page-open",
      first.observationKey,
      "settled",
      2
    );

    assert.equal(
      beginAutomaticSyncObservation("10", "steam", "game-page-open", 3)
        .accepted,
      false
    );

    recordLatestCloudSaveObservation("10", "steam", "second");
    assert.equal(
      beginAutomaticSyncObservation("10", "steam", "game-page-open", 4)
        .accepted,
      true
    );
  });

  it("runs again when a settled fingerprint returns after an intermediate state", () => {
    recordLatestCloudSaveObservation("10", "steam", "empty");
    const emptyAttempt = beginAutomaticSyncObservation(
      "10",
      "steam",
      "game-page-open",
      1
    );
    finishAutomaticSyncObservation(
      "10",
      "steam",
      "game-page-open",
      emptyAttempt.observationKey,
      "settled",
      2
    );

    recordLatestCloudSaveObservation("10", "steam", "restored");
    recordLatestCloudSaveObservation("10", "steam", "empty");

    assert.equal(
      beginAutomaticSyncObservation("10", "steam", "game-page-open", 3)
        .accepted,
      true
    );
  });

  it("retries the same failed state only after the cooldown", () => {
    recordLatestCloudSaveObservation("10", "steam", "state");
    const attempt = beginAutomaticSyncObservation(
      "10",
      "steam",
      "game-page-open",
      1
    );
    finishAutomaticSyncObservation(
      "10",
      "steam",
      "game-page-open",
      attempt.observationKey,
      "failed",
      1
    );

    assert.equal(
      beginAutomaticSyncObservation("10", "steam", "game-page-open", 30_000)
        .accepted,
      false
    );
    assert.equal(
      beginAutomaticSyncObservation("10", "steam", "game-page-open", 30_001)
        .accepted,
      true
    );
  });

  it("does not suppress a sync when no observation was recorded", () => {
    assert.deepEqual(
      beginAutomaticSyncObservation("10", "steam", "game-page-open", 1),
      { accepted: true, observationKey: null }
    );
  });
});
