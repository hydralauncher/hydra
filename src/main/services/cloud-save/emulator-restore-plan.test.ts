import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type {
  CloudSavePathContext,
  CloudSaveSyncAnchor,
  LocalGameSnapshotContext,
  ResolveRestoreTargetsResult,
  ResolvedRestoreTarget,
  SnapshotFile,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";
import {
  assertRestorePlanUnchanged,
  filterUnsafeEmulatorRestoreTargets,
} from "./emulator-restore-plan.js";
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

describe("emulator restore destination safety", () => {
  it("lets RPCS3 saves create a missing user under dev_hdd0/home only", async () => {
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "hydra-restore-"))
    );
    try {
      const homeRoot = path.join(root, "RPCS3", "dev_hdd0", "home");
      await fs.mkdir(path.join(homeRoot, "00000001"), { recursive: true });
      const target = (
        rawPath: string,
        restoreRootPath: string,
        relativePath: string
      ): ResolvedRestoreTarget => ({
        ...action(relativePath, path.join(restoreRootPath, relativePath)),
        rawPath,
        restoreRootPath,
        action: "create",
      });
      const rpcs3 = target(
        "<emulator>/rpcs3/BLUS30443/00000002",
        path.join(homeRoot, "00000002", "savedata"),
        path.join("BLUS30443-SLOT01", "DATA.BIN")
      );
      const retroArch = target(
        "<emulator>/retroarch/snes/1234ABCD",
        path.join(root, "RetroArch", "saves", "Snes9x"),
        "Mario.srm"
      );
      const result = await filterUnsafeEmulatorRestoreTargets(
        true,
        {
          homeDir: path.join(root, "user-home"),
          platform: process.platform === "win32" ? "windows" : "linux",
        } as CloudSavePathContext,
        { actions: [rpcs3, retroArch], blocked: [], deferred: [] }
      );
      assert.deepEqual(
        result.actions.map((item) => item.rawPath),
        [rpcs3.rawPath]
      );
      assert.deepEqual(
        result.blocked.map((item) => [item.rawPath, item.reason]),
        [[retroArch.rawPath, "blocked-emulator-destination-unavailable"]]
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("lets RPCS3 game data create a missing game directory under dev_hdd0", async () => {
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "hydra-restore-"))
    );
    try {
      const hdd0 = path.join(root, "RPCS3", "dev_hdd0");
      await fs.mkdir(hdd0, { recursive: true });
      const relativePath = path.join("BLUS30443_USER1", "USRDIR", "PROFILE");
      const gamedata: ResolvedRestoreTarget = {
        ...action(relativePath, path.join(hdd0, "game", relativePath)),
        rawPath: "<emulator>/rpcs3-gamedata/BLUS30443",
        restoreRootPath: path.join(hdd0, "game"),
        action: "create",
      };
      const outsideHdd0: ResolvedRestoreTarget = {
        ...gamedata,
        restoreRootPath: path.join(root, "missing", "game"),
        targetPath: path.join(root, "missing", "game", relativePath),
      };
      const result = await filterUnsafeEmulatorRestoreTargets(
        true,
        {
          homeDir: path.join(root, "user-home"),
          platform: process.platform === "win32" ? "windows" : "linux",
        } as CloudSavePathContext,
        { actions: [gamedata, outsideHdd0], blocked: [], deferred: [] }
      );
      assert.deepEqual(
        result.actions.map((item) => item.targetPath),
        [gamedata.targetPath]
      );
      assert.deepEqual(
        result.blocked.map((item) => item.reason),
        ["blocked-emulator-destination-unavailable"]
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
