import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CloudSaveSyncAnchor,
  LocalGameSnapshotContext,
  ResolveRestoreTargetsResult,
  ResolvedRestoreTarget,
  SnapshotFile,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";
import { assertRestorePlanUnchanged } from "./emulator-restore-plan.js";
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots.js";

const action = (
  relativePath: string,
  targetPath: string
): ResolvedRestoreTarget => ({
  variantId: "a".repeat(64),
  rawPath: "<emulator>/retroarch/snes/1234ABCD",
  relativePath,
  hash: "b".repeat(64),
  sizeBytes: 4,
  lastModifiedAt: "2026-09-29T00:00:00.000Z",
  targetPath,
  restoreRootPath: "/home/user/Documents/RetroArch/saves/Snes9x",
  action: "replace",
  observedHash: "c".repeat(64),
  observedSizeBytes: 4,
  observedLastModifiedAt: "2026-09-28T00:00:00.000Z",
});

const plan = (): ResolveRestoreTargetsResult => ({
  actions: [
    action(
      "battery.srm",
      "/home/user/Documents/RetroArch/saves/Snes9x/Mario.srm"
    ),
    action(
      "state.state1",
      "/home/user/Documents/RetroArch/states/Snes9x/Mario.state1"
    ),
  ],
  blocked: [],
  deferred: [],
});

describe("emulator restore plan revalidation", () => {
  it("accepts the same destinations and file observations after download", () => {
    const before = plan();
    assert.doesNotThrow(() =>
      assertRestorePlanUnchanged(before, {
        ...before,
        actions: [...before.actions].reverse(),
      })
    );
  });

  it("rejects a changed configured destination or ROM save stem", () => {
    const before = plan();
    assert.throws(
      () =>
        assertRestorePlanUnchanged(before, {
          ...before,
          actions: [
            {
              ...before.actions[0],
              targetPath:
                "/home/user/Documents/RetroArch/saves/Snes9x/Renamed Mario.srm",
            },
            before.actions[1],
          ],
        }),
      /cloud_save_restore_destination_changed/
    );
  });

  it("rejects a local file changed while its remote blob downloaded", () => {
    const before = plan();
    assert.throws(
      () =>
        assertRestorePlanUnchanged(before, {
          ...before,
          actions: [
            {
              ...before.actions[0],
              observedHash: "d".repeat(64),
            },
            before.actions[1],
          ],
        }),
      /cloud_save_restore_destination_changed/
    );
  });

  it("rejects a destination that becomes blocked after download", () => {
    const before = plan();
    const missing = before.actions[0];
    assert.throws(
      () =>
        assertRestorePlanUnchanged(before, {
          actions: [before.actions[1]],
          blocked: [
            {
              variantId: missing.variantId,
              rawPath: missing.rawPath,
              relativePath: missing.relativePath,
              hash: missing.hash,
              sizeBytes: missing.sizeBytes,
              lastModifiedAt: missing.lastModifiedAt,
              reason: "blocked-emulator-destination-unavailable",
            },
          ],
          deferred: [],
        }),
      /cloud_save_restore_destination_changed/
    );
  });
});

describe("emulator restore plan and deletion history", () => {
  const variantId = "a".repeat(64);
  const rawPath = "<emulator>/retroarch/snes/1234ABCD";
  const file = (relativePath: string): SnapshotFile => ({
    variantId,
    rawPath,
    relativePath,
    hash: "b".repeat(64),
    sizeBytes: 4,
    lastModifiedAt: "2026-09-29T00:00:00.000Z",
  });
  const battery = file("battery.srm");
  const state = file("state.state1");
  const base: CloudSaveSyncAnchor = {
    schemaVersion: 4,
    environmentId: "host-b",
    baseSnapshotId: "snapshot",
    baseVersion: 1,
    baseAggregateHash: "c".repeat(64),
    entries: [battery, state],
    unresolvedRemoteEntryIds: [],
    updatedAt: "2026-09-29T00:00:00.000Z",
  };
  const local = (complete: boolean): LocalGameSnapshotContext => ({
    gameId: { shop: "launchbox", objectId: "game" },
    ruleSourceRevision: "retroarch-v2",
    discoveryEngineVersion: 4,
    coverage: [
      {
        candidateId: "retroarch",
        ruleId: "retroarch",
        variantId,
        rawPath,
        selectedRoot: true,
        authority: "exact",
        outcome: complete ? "scanned" : "partial",
        enumeratedCompletely: complete,
        warningCodes: complete ? [] : ["retroarch-location-partial"],
      },
    ],
    variants: [{ variantId, kind: "default" }],
    fileCount: 1,
    totalSizeBytes: state.sizeBytes,
    files: [state],
    aggregateHash: "d".repeat(64),
    sourceFiles: [],
    environmentId: "host-b",
    customPathRawPaths: [],
    pathContext: {
      shop: "launchbox",
      objectId: "game",
      platform: "mac",
      homeDir: "/home/user",
      storeUserContext: { known: [] },
    },
  });

  it("keeps a deliberate local deletion when scanning was complete", () => {
    const result = mergeUserVariantSnapshots({
      local: local(true),
      remoteVariants: [{ variantId, kind: "default" }],
      remoteFiles: [battery, state],
      base,
      restorableEmulatorEntryIds: new Set([cloudSaveFileKey(battery)]),
    });
    assert.deepEqual(result.restoreEntryIds, []);
    assert.deepEqual(result.deleteRemoteEntryIds, [cloudSaveFileKey(battery)]);
  });

  it("restores a tracked remote file when discovery was partial", () => {
    const result = mergeUserVariantSnapshots({
      local: local(false),
      remoteVariants: [{ variantId, kind: "default" }],
      remoteFiles: [battery, state],
      base,
      restorableEmulatorEntryIds: new Set([cloudSaveFileKey(battery)]),
    });
    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(battery)]);
    assert.deepEqual(result.deleteRemoteEntryIds, []);
  });
});
